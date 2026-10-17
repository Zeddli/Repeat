import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toBytes, parseEventLogs, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { checkoutAbi, tokenAbi } from '../shared/abi.js';
import type { AuthChallenge, WalletSession, MarketConfig, PublishService, ServiceListing, ServiceQuote, MarketDelivery, FaucetResult } from '../shared/marketplace.js';

const base='http://127.0.0.1:3001';
async function call<T>(path:string,body?:unknown,token?:string,expected=200):Promise<T>{
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const payload=await response.json();
 assert.equal(response.status,expected,JSON.stringify(payload));
 return payload as T;
}
const config=await call<MarketConfig>('/api/market/config');
assert.equal(config.ready,true);assert.equal(config.chainId,31337,'Integration test is only allowed on local chain31337.');
const chain=defineChain({id:31337,name:'Local Anvil',nativeCurrency:{name:'Test Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[config.rpcUrl]}}});
const pub=createPublicClient({chain,transport:http(config.rpcUrl)});
assert.equal(await pub.getChainId(),31337);
// Fresh disposable wallets generated only after enforcing local chain31337.
const seller=privateKeyToAccount(generatePrivateKey());
const buyer=privateKeyToAccount(generatePrivateKey());
const stranger=privateKeyToAccount(generatePrivateKey());
const sellerWallet=createWalletClient({account:seller,chain,transport:http(config.rpcUrl)});
const buyerWallet=createWalletClient({account:buyer,chain,transport:http(config.rpcUrl)});
async function login(account:typeof seller){
 const challenge=await call<AuthChallenge>('/api/auth/challenge',{address:account.address,chainId:31337});
 assert.match(challenge.message,/Chain ID: 31337/);
 assert.match(challenge.message,/Nonce: /);
 const signature=await account.signMessage({message:challenge.message});
 const session=await call<WalletSession>('/api/auth/verify',{challengeId:challenge.challengeId,signature});
 assert.equal(session.address.toLowerCase(),account.address.toLowerCase());
 await call('/api/auth/verify',{challengeId:challenge.challengeId,signature},undefined,401);
 return session;
}
await call('/api/auth/challenge',{address:buyer.address,chainId:97},undefined,400);
const invalid=await call<AuthChallenge>('/api/auth/challenge',{address:buyer.address,chainId:31337});
await call('/api/auth/verify',{challengeId:invalid.challengeId,signature:await stranger.signMessage({message:invalid.message})},undefined,401);
const sellerSession=await login(seller),buyerSession=await login(buyer),strangerSession=await login(stranger);
await call('/api/market/wallet',undefined,undefined,401);
const sellerFunding=await call<FaucetResult>('/api/market/faucet',{},sellerSession.token);
const buyerFunding=await call<FaucetResult>('/api/market/faucet',{},buyerSession.token);
assert.ok(BigInt(buyerFunding.wallet.tokenBalance)>=1000000n);
const id='check-'+randomUUID();
const responseText='Private purchased output '+randomUUID();
const service:PublishService={id,title:'Wallet marketplace integration proof',description:'A real seller-created hosted response, paid directly by a separate buyer wallet.',category:'data',basePrice:'50000',spendThreshold:'100000',discountBps:2000,response:responseText};
const sku=keccak256(toBytes(id));
await call('/api/market/services',service,undefined,401);
const offerHash=await sellerWallet.writeContract({address:config.checkoutAddress,abi:checkoutAbi,functionName:'setOffer',args:[sku,50000n,100000n,2000,true]});
assert.equal((await pub.waitForTransactionReceipt({hash:offerHash})).status,'success');
await call('/api/market/services',{...service,basePrice:'50001'},sellerSession.token,409);
const listed=await call<ServiceListing>('/api/market/services',service,sellerSession.token,201);
assert.equal(listed.seller.toLowerCase(),seller.address.toLowerCase());
assert.equal(listed.sku,sku);
const search=await call<{services:ServiceListing[]}>('/api/market/services?q='+encodeURIComponent(service.title));
assert.ok(search.services.some(s=>s.id===id));
assert.ok(!JSON.stringify(search).includes(responseText));
assert.ok(!Object.hasOwn(search.services.find(s=>s.id===id)!,'response'));
const detail=await call<ServiceListing>('/api/market/services/'+id);
assert.ok(!JSON.stringify(detail).includes(responseText));
const noOrder=('0x'+randomBytes(32).toString('hex')) as Hex;
await call('/api/market/services/'+id+'/deliver',{orderId:noOrder},buyerSession.token,403);
const startSeller=await pub.readContract({address:config.tokenAddress,abi:tokenAbi,functionName:'balanceOf',args:[seller.address]});
const orders:Array<{orderId:Hex;hash:Hex;amount:string;appliedBps:number}>=[];
const evidencePath=new URL('../../evidence/marketplace-e2e.json',import.meta.url);
mkdirSync(new URL('../../evidence/',import.meta.url),{recursive:true});
function save(complete=false){writeFileSync(evidencePath,JSON.stringify({verifiedAt:new Date().toISOString(),complete,chainId:31337,tokenAddress:config.tokenAddress,checkoutAddress:config.checkoutAddress,seller:seller.address,buyer:buyer.address,serviceId:id,offerHash,orders,checks:['SIWE sign-in','nonce replay rejected','wrong signer rejected','wrong chain rejected','anonymous publish rejected','on-chain offer mismatch rejected','paid content hidden','unpaid delivery rejected'],note:'Disposable local wallets; six-decimal mock wBSC, no monetary value. No browser-extension signature automation claimed.'},null,2)+'\n');}
save();
for(const expected of [50000n,50000n,40000n]){
 const quote=await call<ServiceQuote>('/api/market/services/'+id+'/quote?buyer='+buyer.address);
 assert.equal(BigInt(quote.amount),expected);
 assert.equal(quote.appliedBps,expected===40000n?2000:0);
 const approval=await buyerWallet.writeContract({address:config.tokenAddress,abi:tokenAbi,functionName:'approve',args:[config.checkoutAddress,expected]});
 assert.equal((await pub.waitForTransactionReceipt({hash:approval})).status,'success');
 const orderId=('0x'+randomBytes(32).toString('hex')) as Hex;
 const block=await pub.getBlock();
 const hash=await buyerWallet.writeContract({address:config.checkoutAddress,abi:checkoutAbi,functionName:'checkout',args:[seller.address,sku,orderId,expected,BigInt(quote.offerVersion),block.timestamp+120n]});
 orders.push({orderId,hash,amount:expected.toString(),appliedBps:quote.appliedBps});save();
 const receipt=await pub.waitForTransactionReceipt({hash});
 assert.equal(receipt.status,'success');
 const logs=parseEventLogs({abi:checkoutAbi,logs:receipt.logs,eventName:'OrderPaid'});
 assert.equal(logs.length,1);assert.equal(logs[0].args.amount,expected);assert.equal(logs[0].args.buyer.toLowerCase(),buyer.address.toLowerCase());
 const delivery=await call<MarketDelivery>('/api/market/services/'+id+'/deliver',{orderId},buyerSession.token);
 assert.equal(delivery.response,responseText);assert.equal(BigInt(delivery.amount),expected);
 await call('/api/market/services/'+id+'/deliver',{orderId},strangerSession.token,403);
 // Repeating delivery recovers the result without a new payment.
 assert.equal((await call<MarketDelivery>('/api/market/services/'+id+'/deliver',{orderId},buyerSession.token)).response,responseText);
 console.log('Confirmed '+expected.toString()+' units; transaction '+hash);
}
const endSeller=await pub.readContract({address:config.tokenAddress,abi:tokenAbi,functionName:'balanceOf',args:[seller.address]});
assert.equal(endSeller-startSeller,140000n);
const stats=await pub.readContract({address:config.checkoutAddress,abi:checkoutAbi,functionName:'stats',args:[buyer.address,seller.address,sku]});
assert.equal(stats.paid,140000n);assert.equal(stats.purchaseCount,3n);
await call('/api/auth/logout',{},strangerSession.token);
await call('/api/market/wallet',undefined,strangerSession.token,401);
save(true);
console.log(JSON.stringify({ok:true,serviceId:id,seller:seller.address,buyer:buyer.address,amounts:orders.map(o=>o.amount),sellerRevenueDelta:'140000',faucet:{seller:!!sellerFunding.wallet,buyer:!!buyerFunding.wallet},evidence:'evidence/marketplace-e2e.json'}));
