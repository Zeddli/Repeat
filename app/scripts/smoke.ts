import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, stringToHex, type Hex } from 'viem';
import { foundry, bscTestnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import dotenv from 'dotenv';
import type { Snapshot, Run } from '../shared/types.js';
dotenv.config({ path: '.env.local', quiet: true });
const base = process.env.API_URL || 'http://127.0.0.1:3001';
async function api<T>(url: string, body?: unknown, extraHeaders: Record<string,string> = {}): Promise<T> {
  const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type':'application/json', ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data as T;
}
const initial = await api<Snapshot>('/api/state');
assert.equal(initial.ready, true, 'Complete local setup before smoke test');
assert.equal(initial.mode, 'local', 'Smoke performs paid test operations only on the local chain');
await api('/api/scenario', { recordId:'bnb-budget', sellerBPrice:'45000' });
const before = await api<Snapshot>('/api/state');
const a = before.merchants.find((merchant) => merchant.id === 'a')!;
const b = before.merchants.find((merchant) => merchant.id === 'b')!;
assert.equal(a.price,'40000');
assert.equal(b.price,'45000');
assert.equal(before.freshQuotes.find((quote) => quote.merchantId === 'a')?.amount,'50000');
assert.equal(before.freshQuotes.find((quote) => quote.merchantId === 'b')?.amount,'45000');
const chain = before.network.chainId === 97 ? bscTestnet : foundry;
const publicClient = createPublicClient({chain,transport:http(process.env.RPC_URL)});
const tokenAbi=parseAbi(['function balanceOf(address) view returns(uint256)']);
const balanceBefore = await publicClient.readContract({address:before.tokenAddress,abi:tokenAbi,functionName:'balanceOf',args:[a.address]});
const requestId=randomUUID();
const payload={ mission:'Get this BNB research record. Spend no more than 0.06 wBSC.', maxSpend:'60000' };
const run = await api<Run>('/api/runs', payload, {'Idempotency-Key':requestId});
let final = run;
for (let i=0; i<120 && !['completed','failed','stopped'].includes(final.status); i++) {
  await new Promise((resolve)=>setTimeout(resolve,500));
  final=await api<Run>('/api/runs/'+run.id);
}
assert.equal(final.status,'completed', final.error || 'Mission did not finish');
assert.equal(final.spent,'40000');
assert.equal(final.remaining,'20000');
assert.equal(final.results.length,1);
assert.equal(final.results[0].merchantId,'a');
assert.equal(final.results[0].paymentStatus,'confirmed');
assert.equal(final.results[0].deliveryStatus,'returned');
assert.equal(final.results[0].data?.recordId,'bnb-budget');
assert.ok(BigInt(final.gasSpent) >= BigInt(final.results[0].gasCost), 'Mission gas includes checkout and any approval');
const sameRun=await api<Run>('/api/runs',payload,{'Idempotency-Key':requestId});
assert.equal(sameRun.id,run.id,'Retry must return the existing mission, including after completion');
const conflict=await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':requestId},body:JSON.stringify({...payload,maxSpend:'50000'})});
assert.equal(conflict.status,409);
const balanceAfter=await publicClient.readContract({address:before.tokenAddress,abi:tokenAbi,functionName:'balanceOf',args:[a.address]});
assert.equal(balanceAfter-balanceBefore,40000n);
const receipt=await publicClient.getTransactionReceipt({hash:final.results[0].transactionHash});
assert.equal(receipt.status,'success');
assert.equal(receipt.to?.toLowerCase(),before.checkoutAddress.toLowerCase());
const after=await api<Snapshot>('/api/state');
assert.equal(BigInt(after.merchants.find((merchant)=>merchant.id==='a')!.priorPaid)-BigInt(a.priorPaid),40000n);
const key=process.env.ACTIVE_BUYER_ROLE==='judge'?process.env.JUDGE_BUYER_PRIVATE_KEY:process.env.BUYER_PRIVATE_KEY;
assert.ok(key);
const account=privateKeyToAccount(key as Hex);
const checkoutAbi=parseAbi(['function checkout(address merchant,bytes32 sku,bytes32 orderId,uint256 maxAmount,uint64 expectedVersion,uint256 deadline)']);
await assert.rejects(()=>publicClient.simulateContract({
  address:before.checkoutAddress,abi:checkoutAbi,functionName:'checkout',account,
  args:[a.address,keccak256(stringToHex('bnb-budget')),final.results[0].orderId,40000n,BigInt(a.offerVersion),BigInt(Math.floor(Date.now()/1000)+120)]
}));
const stateAfterReplay=await api<Snapshot>('/api/state');
assert.equal(stateAfterReplay.merchants.find((merchant)=>merchant.id==='a')!.priorPaid,after.merchants.find((merchant)=>merchant.id==='a')!.priorPaid);
const invalidBudgetResponse=await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mission:'bnb-budget',maxSpend:'300001'})});
assert.equal(invalidBudgetResponse.ok,false);
const invalidOrigin=await fetch(base+'/api/scenario',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:JSON.stringify({recordId:'bnb-budget',sellerBPrice:'35000'})});
assert.equal(invalidOrigin.ok,false);
const declined=await api<Run>('/api/runs',{mission:'bnb-budget',maxSpend:'20000'});
let declinedFinal=declined;
for(let i=0;i<80&&!['completed','failed','stopped'].includes(declinedFinal.status);i++){
  await new Promise((resolve)=>setTimeout(resolve,250));
  declinedFinal=await api<Run>('/api/runs/'+declined.id);
}
assert.equal(declinedFinal.spent,'0','Unaffordable work must not pay');
assert.equal(declinedFinal.results.length,0);
console.log(JSON.stringify({
  result:'PASS',chainId:before.network.chainId,planner:final.plannerMode,
  paid:final.spent,remaining:final.remaining,
  transactionHash:final.results[0].transactionHash,merchantBalanceDelta:(balanceAfter-balanceBefore).toString(),
  delivery:'returned',replay:'rejected',budget:'enforced',origin:'rejected',idempotency:'same mission; conflicting body rejected',gasSpent:final.gasSpent
},null,2));
