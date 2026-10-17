import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,readFile,mkdir,unlink,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicClient,http,type Hex} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {checkoutAbi,tokenAbi} from '../shared/abi.js';
import type {MarketConfig} from '../shared/marketplace.js';

const app=fileURLToPath(new URL('../',import.meta.url)),root=path.resolve(app,'..');
const config=await (await fetch('http://127.0.0.1:3001/api/market/config')).json() as MarketConfig;
assert.ok(config.ready);assert.equal(config.chainId,31337,'Only disposable local chain testing is permitted.');
const pub=createPublicClient({transport:http(config.rpcUrl)});
assert.equal(await pub.getChainId(),31337);
const standalone=process.argv.includes('--standalone');
let clientFile:string|undefined,runCwd=app,clientSha256:string|undefined;
if(standalone){
 runCwd=await mkdtemp(path.join(tmpdir(),'repeat-agent-live-'));
 clientFile=path.join(runCwd,'repeat-agent.mjs');
 const downloaded=await fetch('http://127.0.0.1:5173/api/market/client');
 assert.equal(downloaded.status,200);
 const source=Buffer.from(await downloaded.arrayBuffer());
 clientSha256=createHash('sha256').update(source).digest('hex');
 assert.equal(downloaded.headers.get('x-content-sha256'),clientSha256);
 await writeFile(clientFile,source);
}
const sellerKey=generatePrivateKey(),buyerKey=generatePrivateKey();
const seller=privateKeyToAccount(sellerKey),buyer=privateKeyToAccount(buyerKey);
async function cli(key:Hex|undefined,args:string[],failure=false){
 const env:NodeJS.ProcessEnv={...process.env};
 if(standalone){env.NODE_PATH='';env.MARKET_AGENT_DATA_DIR=path.join(runCwd,'.repeat-agent');}
 delete env.MARKET_AGENT_PRIVATE_KEY;
 if(key)env.MARKET_AGENT_PRIVATE_KEY=key;
 try{
  const output=await promisify(execFile)(process.execPath,clientFile?[clientFile,...args]:['node_modules/tsx/dist/cli.mjs','scripts/market-agent.ts',...args],{cwd:runCwd,env,timeout:120000,maxBuffer:1024*1024});
  if(failure)assert.fail('Expected budget rejection.');
  return JSON.parse(output.stdout);
 }catch(error){
  if(!failure)throw new Error('Agent CLI failed during '+args[0]+': '+String((error as {stderr?:string}).stderr??'see local configuration').slice(-1500));
  assert.match(String((error as {stderr?:string}).stderr??''),/exceeds --max-spend/);
  return null;
 }
}
await cli(sellerKey,['faucet']);await cli(buyerKey,['faucet']);
const stamp=Date.now().toString(),idA='agent-proof-'+stamp+'-a',idB='agent-proof-'+stamp+'-b';
const temp=path.join(app,'data/runtime/service-proof-'+stamp+'.json');
await mkdir(path.dirname(temp),{recursive:true});
const published=[];
for(const id of [idA,idB]){
 await writeFile(temp,JSON.stringify({id,title:'Agent service proof '+stamp+' '+id.slice(-1),description:'Disposable local test of agent publication, discovery and per-service loyalty.',category:'data',basePrice:'50000',spendThreshold:'100000',discountBps:2000,response:'Purchased response for '+id}),{mode:0o600});
 published.push(await cli(sellerKey,['publish','--file',temp]));
}
await unlink(temp);
const discovery=await cli(undefined,['discover','--query','Agent service proof '+stamp]);
assert.equal(discovery.services.length,2);
const quote=(id:string)=>cli(undefined,['quote','--service',id,'--buyer',buyer.address]);
assert.equal((await quote(idA)).amount,'50000');
const initialNonce=await pub.getTransactionCount({address:buyer.address});
const initialBalance=await pub.readContract({address:config.tokenAddress,abi:tokenAbi,functionName:'balanceOf',args:[buyer.address]});
await cli(buyerKey,['buy','--service',idA,'--max-spend','0.000001','--intent','denied-'+stamp],true);
assert.equal(await pub.getTransactionCount({address:buyer.address}),initialNonce);
assert.equal(await pub.readContract({address:config.tokenAddress,abi:tokenAbi,functionName:'balanceOf',args:[buyer.address]}),initialBalance);
const purchases=[];
for(let i=0;i<3;i++){
 const intent='proof-'+stamp+'-'+i;
 const bought=await cli(buyerKey,['buy','--service',idA,'--max-spend','0.06','--intent',intent]);
 assert.equal(bought.delivery.amount,i<2?'50000':'40000');
 assert.equal(bought.delivery.response,'Purchased response for '+idA);
 purchases.push(bought);
 if(i===1){
  const a=await quote(idA),b=await quote(idB);
  assert.equal(a.amount,'40000');assert.equal(a.priorPaid,'100000');assert.equal(a.purchaseCount,'2');
  assert.equal(b.amount,'50000');assert.equal(b.appliedBps,0);assert.equal(b.priorPaid,'0');assert.equal(b.purchaseCount,'0');
 }
}
const nonce=await pub.getTransactionCount({address:buyer.address});
const recovered=await cli(buyerKey,['buy','--service',idA,'--max-spend','0.06','--intent','proof-'+stamp+'-2']);
assert.equal(recovered.recovered,true);
assert.equal(await pub.getTransactionCount({address:buyer.address}),nonce);
const orderId=purchases[2].delivery.orderId;
assert.equal((await cli(buyerKey,['deliver','--service',idA,'--order',orderId])).response,'Purchased response for '+idA);
const other=await cli(buyerKey,['buy','--service',idB,'--max-spend','0.06','--intent','proof-other-'+stamp]);
assert.equal(other.delivery.amount,'50000');
const aAfter=await quote(idA),bAfter=await quote(idB);
assert.equal(aAfter.priorPaid,'140000');assert.equal(aAfter.purchaseCount,'3');
assert.equal(bAfter.priorPaid,'50000');assert.equal(bAfter.purchaseCount,'1');assert.equal(bAfter.appliedBps,0);
const payload={clientMode:standalone?'downloaded standalone client':'repository CLI',workingDirectory:runCwd,clientSha256,verifiedAt:new Date().toISOString(),status:'PASS',chainId:31337,checkoutAddress:config.checkoutAddress,tokenAddress:config.tokenAddress,seller:seller.address,buyer:buyer.address,serviceA:idA,serviceB:idB,publishTransactions:published.map(p=>p.transactionHash),purchasesA:purchases.map(p=>({hash:p.transactionHash,orderId:p.delivery.orderId,amount:p.delivery.amount})),firstPurchaseB:{hash:other.transactionHash,orderId:other.delivery.orderId,amount:other.delivery.amount},after:{a:{amount:aAfter.amount,priorPaid:aAfter.priorPaid,purchases:aAfter.purchaseCount},b:{amount:bAfter.amount,priorPaid:bAfter.priorPaid,purchases:bAfter.purchaseCount}},checks:['keyless discovery and personalized quote','wallet nonce sign-in','seller-owned service creation','buyer-owned signed approval and checkout','budget rejection submits zero transactions','same service earns discount after repeated payments','other service at same seller stays full price','paid private response delivery','same intent recovery submits zero new transactions','reconnected delivery'],note:'Follows the portable skill CLI workflow with disposable local EOA keys. No separate LLM/autonomous skill loader or browser extension was exercised.'};
const evidence=standalone?'evidence/marketplace-cli-standalone.json':'evidence/marketplace-cli.json';
await writeFile(path.join(root,evidence),JSON.stringify(payload,null,2)+'\n');
console.log(JSON.stringify({ok:true,serviceA:idA,serviceB:idB,pricesA:purchases.map(p=>p.delivery.amount),priceB:other.delivery.amount,after:payload.after,evidence}));
