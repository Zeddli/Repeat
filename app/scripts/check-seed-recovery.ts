import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicClient,http,parseAbi,keccak256,toBytes} from 'viem';
import {foundry} from 'viem/chains';
import {deployDemo,type Deployment} from './deploy.js';
const file=new URL('../deployments/31337.json',import.meta.url);
const original=await readFile(file,'utf8');
const metadata=JSON.parse(original) as Deployment;
assert.equal(metadata.chainId,31337);
assert.ok(metadata.warmupOrders.length>=6);
assert.ok(metadata.warmupOrders.filter(o=>o.buyerRole==='judge'&&o.recordId==='bnb-budget').length>=3,'This check requires an explicit v2 same-service seed. It will not create new warm-up payments while recovering legacy metadata.');
const client=createPublicClient({chain:foundry,transport:http(metadata.rpcUrl)});
assert.equal(await client.getChainId(),31337);
const abi=parseAbi(['function stats(address,address,bytes32) view returns((uint256 paid,uint256 purchaseCount))']);
const before=await client.readContract({address:metadata.checkoutAddress,abi,functionName:'stats',args:[metadata.buyers.judge.address,metadata.merchants.a.address,keccak256(toBytes('bnb-budget'))]});
try{
  metadata.warmupOrders.shift();
  await writeFile(file,JSON.stringify(metadata,null,2));
  const recovered=await deployDemo({local:true});
  assert.equal(recovered.warmupOrders.length,metadata.warmupOrders.length+1,'An already-paid order missing metadata must be recovered');
  const expected=(JSON.parse(original) as Deployment).warmupOrders[0];
  assert.equal(recovered.warmupOrders.find(o=>o.orderId===expected.orderId)?.transactionHash,expected.transactionHash);
  const after=await client.readContract({address:metadata.checkoutAddress,abi,functionName:'stats',args:[metadata.buyers.judge.address,metadata.merchants.a.address,keccak256(toBytes('bnb-budget'))]});
  assert.deepEqual(after,before,'Metadata recovery must not pay again');
  console.log('PASS: recovered paid seed receipt; no additional purchase or lost history');
}finally{await writeFile(file,original);}
