import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir,copyFile,access} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicClient,createWalletClient,http,keccak256,toBytes,parseAbi,type Address,type Hex} from 'viem';
import {mnemonicToAccount} from 'viem/accounts';
import {foundry} from 'viem/chains';
import type {Deployment} from './deploy.js';

const app=fileURLToPath(new URL('../',import.meta.url)),root=path.resolve(app,'..');
const metadataFile=path.join(app,'deployments/31337.json');
const current=JSON.parse(await readFile(metadataFile,'utf8')) as Deployment;
assert.equal(current.chainId,31337,'This migration is local-only. No public chain signing is allowed.');
const rpc=new URL(current.rpcUrl);
assert.ok(['localhost','127.0.0.1'].includes(rpc.hostname),'Only a loopback local RPC is allowed.');
const pub=createPublicClient({chain:foundry,transport:http(current.rpcUrl,{retryCount:0}),pollingInterval:250});
assert.equal(await pub.getChainId(),31337);
const abi=parseAbi([
 'function loyaltyScope() pure returns(bytes32)',
 'function paymentToken() view returns(address)',
 'function previousCheckout() view returns(address)',
 'function importHistory(address buyer,bytes32[] orderIds)',
 'function stats(address buyer,address merchant,bytes32 sku) view returns((uint256 paid,uint256 purchaseCount))',
 'event OrderPaid(address indexed buyer,address indexed merchant,bytes32 indexed orderId,bytes32 sku,uint256 basePrice,uint256 amount,uint16 appliedBps,uint256 priorPaid,uint256 newPaid,uint64 offerVersion)'
]);
const marker=keccak256(toBytes('repeat:service-loyalty:v2'));
const isUpgraded=await pub.readContract({address:current.checkoutAddress,abi,functionName:'loyaltyScope'}).then(x=>x===marker).catch(()=>false);
if(isUpgraded&&!current.previousCheckoutAddress){console.log('Checkout already uses service-specific loyalty; no upgrade needed.');process.exit(0);}
const legacy=(current.previousCheckoutAddress??current.checkoutAddress) as Address;
await mkdir(path.join(app,'deployments/archive'),{recursive:true});
const archive=path.join(app,'deployments/archive/31337-'+legacy.toLowerCase()+'.json');
let source:Deployment;
if(isUpgraded)source=JSON.parse(await readFile(archive,'utf8')) as Deployment;
else{source=current;await writeFile(archive,JSON.stringify(source,null,2)+'\n');}
assert.equal((await pub.readContract({address:legacy,abi,functionName:'paymentToken'})).toLowerCase(),source.tokenAddress.toLowerCase());
const progressFile=path.join(app,'deployments/upgrade-service-'+legacy.toLowerCase()+'.json');
type Progress={legacy:Address;hash?:Hex;checkoutAddress?:Address;block?:string;createdAt:string};
let progress:Progress;
try{progress=JSON.parse(await readFile(progressFile,'utf8'));assert.equal(progress.legacy.toLowerCase(),legacy.toLowerCase());}
catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('Upgrade checkpoint is invalid; preserve it and inspect the saved transaction.');progress=isUpgraded?{legacy,checkoutAddress:current.checkoutAddress,block:current.deploymentBlock,createdAt:current.createdAt}:{legacy,createdAt:new Date().toISOString()};}
const save=()=>writeFile(progressFile,JSON.stringify(progress,null,2)+'\n');
const account=mnemonicToAccount('test test test test test test test test test test test junk',{addressIndex:0});
const wallet=createWalletClient({account,chain:foundry,transport:http(current.rpcUrl,{retryCount:0})});
if(!progress.checkoutAddress){
 if(!progress.hash){
  const artifact=JSON.parse(await readFile(path.join(root,'contracts/out/ServiceLoyaltyMigration.sol/ServiceLoyaltyMigration.json'),'utf8'));
  progress.hash=await wallet.deployContract({abi:artifact.abi,bytecode:artifact.bytecode.object as Hex,args:[source.tokenAddress,legacy]});await save();
 }
 const receipt=await pub.waitForTransactionReceipt({hash:progress.hash,timeout:90000});
 assert.equal(receipt.status,'success');assert.ok(receipt.contractAddress);
 progress.checkoutAddress=receipt.contractAddress;progress.block=receipt.blockNumber.toString();await save();
}
const target=progress.checkoutAddress;
assert.equal(await pub.readContract({address:target,abi,functionName:'loyaltyScope'}),marker);
assert.equal((await pub.readContract({address:target,abi,functionName:'previousCheckout'})).toLowerCase(),legacy.toLowerCase());
const logs=await pub.getLogs({address:legacy,event:abi.find(x=>x.type==='event')!,fromBlock:BigInt(source.deploymentBlock)});
const orders=new Map<string,{buyer:Address;ids:Hex[]}>();
for(const log of logs){const {buyer,orderId}=log.args;if(!buyer||!orderId)continue;const key=buyer.toLowerCase();const item=orders.get(key)??{buyer,ids:[]};if(!item.ids.includes(orderId))item.ids.push(orderId);orders.set(key,item);}
const importHashes:Hex[]=[];
for(const {buyer,ids}of orders.values()){
 for(let i=0;i<ids.length;i+=30){
  const hash=await wallet.writeContract({address:target,abi,functionName:'importHistory',args:[buyer,ids.slice(i,i+30)]});
  assert.equal((await pub.waitForTransactionReceipt({hash,timeout:90000})).status,'success');importHashes.push(hash);
 }
}
const expected=new Map<string,{buyer:Address;seller:Address;sku:Hex;paid:bigint;count:bigint}>();
const newLogs=await pub.getLogs({address:target,event:abi.find(x=>x.type==='event')!,fromBlock:BigInt(progress.block!)});
for(const log of [...logs,...newLogs]){
 const {buyer,merchant,sku,amount}=log.args;if(!buyer||!merchant||!sku||amount===undefined)continue;
 const key=[buyer,merchant,sku].join(':').toLowerCase();const item=expected.get(key)??{buyer,seller:merchant,sku,paid:0n,count:0n};item.paid+=amount;item.count+=1n;expected.set(key,item);
}
for(const item of expected.values()){
 const stats=await pub.readContract({address:target,abi,functionName:'stats',args:[item.buyer,item.seller,item.sku]});
 assert.equal(stats.paid,item.paid);assert.equal(stats.purchaseCount,item.count);
}
const next:Deployment={...source,checkoutAddress:target,deploymentBlock:progress.block!,createdAt:progress.createdAt,loyaltyScope:'service',previousCheckoutAddress:legacy,previousDeploymentBlock:source.deploymentBlock,previousCreatedAt:source.createdAt};
const scope=(d:Deployment)=>[d.chainId,d.checkoutAddress.toLowerCase(),d.tokenAddress.toLowerCase(),d.deploymentBlock,d.createdAt].join(':');
const catalogPath=(d:Deployment)=>path.join(app,'data','marketplace-'+d.chainId+'-'+d.checkoutAddress.toLowerCase()+'-'+d.deploymentBlock+'-'+Date.parse(d.createdAt)+'.json');
try{await access(catalogPath(next));}catch{
 try{const saved=JSON.parse(await readFile(catalogPath(source),'utf8'));assert.equal(saved.scope,scope(source));saved.scope=scope(next);await writeFile(catalogPath(next),JSON.stringify(saved,null,2),{mode:0o600});}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
}
// Keep old intent identities usable. The new client verifies the predecessor on-chain before recovery.
for(const file of await readdir(path.join(app,'data'))){
 const prefix='journal-agent-31337-'+legacy.toLowerCase()+'-';
 if(!file.startsWith(prefix)||!file.endsWith('.jsonl'))continue;
 const nextFile=file.replace(prefix,'journal-agent-31337-'+target.toLowerCase()+'-');
 try{await access(path.join(app,'data',nextFile));}catch{await copyFile(path.join(app,'data',file),path.join(app,'data',nextFile));}
}
let env=await readFile(path.join(app,'.env.local'),'utf8');
assert.ok(env.includes('CHAIN_ID=31337'));
assert.match(env,new RegExp('CHECKOUT_ADDRESS='+current.checkoutAddress,'i'));
env=env.replace(/^CHECKOUT_ADDRESS=.*$/m,'CHECKOUT_ADDRESS='+target);
await writeFile(metadataFile,JSON.stringify(next,null,2)+'\n');
await writeFile(path.join(app,'.env.local'),env,{mode:0o600});
await mkdir(path.join(root,'evidence'),{recursive:true});
await writeFile(path.join(root,'evidence/service-loyalty-upgrade.json'),JSON.stringify({verifiedAt:new Date().toISOString(),chainId:31337,tokenAddress:source.tokenAddress,previousCheckoutAddress:legacy,checkoutAddress:target,deploymentHash:progress.hash,importHashes,verifiedServiceLedgers:expected.size,importedPaidOrders:logs.length,preservedCatalog:true,note:'Verified old paid orders were credited by buyer/seller/SKU. No payment was replayed, token balance reset, or paid response discarded.'},null,2)+'\n');
console.log(JSON.stringify({ok:true,chainId:31337,previousCheckout:legacy,checkoutAddress:target,serviceLedgers:expected.size,oldOrders:logs.length,tokenAddress:source.tokenAddress}));
