import { createPublicClient,createWalletClient,http,keccak256,toBytes,parseEventLogs,getAddress,type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { checkoutAbi,tokenAbi } from '../shared/abi.js';
import type { Address,DeliveryResult,HistoryOrder,Quote,RecordId } from '../shared/types.js';
import { type ChainConfig } from './config.js';
import { boundedGas } from './policy.js';
import { AppError,messageOf } from './errors.js';
import { deliveryMessage,type PaidOrder } from './service.js';
import { verifyPaymentReceipt } from './receipt.js';
import type { BuyerGateway,ConfirmedPayment,OrderIntent,Recovery } from './runner.js';
export const skuFor=(recordId:RecordId)=>keccak256(toBytes(recordId));
export class ChainGateway implements BuyerGateway {
 public readonly publicClient;public readonly walletClient;public readonly account;public readonly buyer:Address;
 constructor(public readonly config:ChainConfig){
  this.account=privateKeyToAccount(config.buyerKey);this.buyer=this.account.address;
  this.publicClient=createPublicClient({chain:config.chain,transport:http(config.rpcUrl,{timeout:15000,retryCount:1})});
  this.walletClient=createWalletClient({account:this.account,chain:config.chain,transport:http(config.rpcUrl,{timeout:15000,retryCount:0})});
 }
 get confirmations(){return this.config.chainId===97?2:1;}
 async assertReady(){
  if(await this.publicClient.getChainId()!==this.config.chainId)throw new AppError('WRONG_CHAIN','WRONG_CHAIN: RPC chain does not match the selected deployment.',503);
  const [checkoutCode,tokenCode,token,decimals]=await Promise.all([this.publicClient.getCode({address:this.config.checkoutAddress}),this.publicClient.getCode({address:this.config.tokenAddress}),this.publicClient.readContract({address:this.config.checkoutAddress,abi:checkoutAbi,functionName:'paymentToken'}),this.publicClient.readContract({address:this.config.tokenAddress,abi:tokenAbi,functionName:'decimals'})]);
  if(!checkoutCode||checkoutCode==='0x'||!tokenCode||tokenCode==='0x'||token.toLowerCase()!==this.config.tokenAddress.toLowerCase()||decimals!==6)throw new AppError('NOT_READY','Configured six-decimal token and checkout were not found on this chain.',503);
  await this.assertServiceScope();
 }
 async assertServiceScope(){
  let scope:Hex;
  try{scope=await this.publicClient.readContract({address:this.config.checkoutAddress,abi:checkoutAbi,functionName:'loyaltyScope'});}
  catch{throw new AppError('LOYALTY_UPGRADE_REQUIRED','The old checkout shares loyalty across services. Run npm --prefix app run upgrade:loyalty for local chain, then restart the API.',503);}
  if(scope!==keccak256(toBytes('repeat:service-loyalty:v2')))throw new AppError('LOYALTY_UPGRADE_REQUIRED','This checkout does not enforce service-specific loyalty.',503);
 }
 async quotes(recordId:RecordId,buyer:Address=this.buyer):Promise<Quote[]> {
  await this.assertReady();const blockNumber=await this.publicClient.getBlockNumber({cacheTime:0});const sku=skuFor(recordId);
  const values=await Promise.all(Object.entries(this.config.deployment.merchants).map(async([merchantId,m])=>{
   const offer=await this.publicClient.readContract({address:this.config.checkoutAddress,abi:checkoutAbi,functionName:'offer',args:[m.address,sku],blockNumber});
   if(!offer.enabled)return null;
   const [amount,appliedBps,priorPaid,purchaseCount,offerVersion]=await this.publicClient.readContract({address:this.config.checkoutAddress,abi:checkoutAbi,functionName:'preview',args:[buyer,m.address,sku],blockNumber});
   return {buyer:getAddress(buyer),merchant:m.address,merchantId:merchantId as 'a'|'b',name:m.name,sku,amount:amount.toString(),basePrice:offer.basePrice.toString(),appliedBps,priorPaid:priorPaid.toString(),purchaseCount:purchaseCount.toString(),offerVersion:offerVersion.toString(),blockNumber:blockNumber.toString()} satisfies Quote;
  }));return values.filter((q):q is Quote=>q!==null);
 }
 async balances(){const [tokenBalance,gasBalance]=await Promise.all([this.publicClient.readContract({address:this.config.tokenAddress,abi:tokenAbi,functionName:'balanceOf',args:[this.buyer]}),this.publicClient.getBalance({address:this.buyer})]);return {tokenBalance:tokenBalance.toString(),gasBalance:gasBalance.toString()};}
 async approve(budget:bigint){
  await this.assertReady();const balance=await this.publicClient.readContract({address:this.config.tokenAddress,abi:tokenAbi,functionName:'balanceOf',args:[this.buyer]});
  if(balance<budget)throw new AppError('BUDGET_EXCEEDED','Buyer wBSC balance is below the approved mission cap.');
  const allowance=await this.publicClient.readContract({address:this.config.tokenAddress,abi:tokenAbi,functionName:'allowance',args:[this.buyer,this.config.checkoutAddress]});
  if(allowance===budget)return 0n;
  const args=[this.config.checkoutAddress,budget] as const;
  const gas=await this.publicClient.estimateContractGas({address:this.config.tokenAddress,abi:tokenAbi,functionName:'approve',args,account:this.account});
  const fees=await this.checkGas(gas,this.config.gasCap);
  const {request}=await this.publicClient.simulateContract({address:this.config.tokenAddress,abi:tokenAbi,functionName:'approve',args,account:this.account,type:'legacy'});
  const hash=await this.walletClient.writeContract({address:this.config.tokenAddress,abi:tokenAbi,functionName:'approve',args,...fees,type:'legacy',chain:this.config.chain});
  const receipt=await this.publicClient.waitForTransactionReceipt({hash,confirmations:this.confirmations,timeout:90000});
  if(receipt.status!=='success')throw new AppError('PAYMENT_FAILED','Bounded token approval failed.');
  return BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice);
 }
 private async checkGas(gas:bigint,cap:bigint){
  const [gasPrice,balance]=await Promise.all([this.publicClient.getGasPrice(),this.publicClient.getBalance({address:this.buyer})]);
  return boundedGas(gas,gasPrice,cap,balance);
 }
 async pay(intent:OrderIntent,onHash:(hash:Hex)=>void,shouldStop?:()=>boolean):Promise<ConfirmedPayment> {
  await this.assertReady();const q=intent.quote;
  const allowlisted=Object.values(this.config.deployment.merchants).some(m=>m.address.toLowerCase()===q.merchant.toLowerCase());
  if(!allowlisted||q.buyer.toLowerCase()!==this.buyer.toLowerCase()||q.sku!==skuFor(intent.recordId))throw new AppError('UNKNOWN_MERCHANT','UNKNOWN_MERCHANT: payment intent is not allowlisted.');
  const block=await this.publicClient.getBlock();const deadline=block.timestamp+120n;
  const args=[q.merchant,q.sku,intent.orderId,BigInt(intent.maxAmount),BigInt(q.offerVersion),deadline] as const;
  let simulation;
  try{simulation=await this.publicClient.simulateContract({address:this.config.checkoutAddress,abi:checkoutAbi,functionName:'checkout',args,account:this.account,type:'legacy'});}
  catch(error){const message=messageOf(error);if(message.includes('StaleOffer'))throw new AppError('STALE_OFFER','STALE_OFFER: seller changed its offer.');if(message.includes('ExpiredQuote'))throw new AppError('EXPIRED_QUOTE','EXPIRED_QUOTE: quote expired.');throw new AppError('PAYMENT_REJECTED','PAYMENT_REJECTED: checkout simulation failed; nothing was submitted.');}
  const gas=await this.publicClient.estimateContractGas({address:this.config.checkoutAddress,abi:checkoutAbi,functionName:'checkout',args,account:this.account});
  const fees=await this.checkGas(gas,BigInt(intent.gasRemaining??this.config.gasCap));
  if(shouldStop?.())throw new AppError('STOP_REQUESTED','Stop requested before submitting payment.');
  const hash=await this.walletClient.writeContract({address:this.config.checkoutAddress,abi:checkoutAbi,functionName:'checkout',args,...fees,type:'legacy',chain:this.config.chain});onHash(hash);
  return this.confirm(intent,hash);
 }
 private async confirm(intent:OrderIntent,hash:Hex):Promise<ConfirmedPayment>{
  const receipt=await this.publicClient.waitForTransactionReceipt({hash,confirmations:this.confirmations,timeout:90000});
  const actualChainId=await this.publicClient.getChainId();
  const event=verifyPaymentReceipt(receipt,{chainId:this.config.chainId,actualChainId,checkoutAddress:this.config.checkoutAddress,buyer:this.buyer,merchant:intent.quote.merchant,orderId:intent.orderId,sku:skuFor(intent.recordId),maxAmount:BigInt(intent.maxAmount)});
  return {transactionHash:hash,amount:event.amount,basePrice:event.basePrice,appliedBps:event.appliedBps,gasCost:BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice)};
 }
 async paidOrder(buyer:Address,orderId:Hex):Promise<PaidOrder>{
  await this.assertReady();const current=await this.publicClient.getBlockNumber({cacheTime:0});const blockNumber=current-BigInt(this.confirmations-1);
  return this.publicClient.readContract({address:this.config.checkoutAddress,abi:checkoutAbi,functionName:'orders',args:[buyer,orderId],blockNumber:blockNumber<0n?0n:blockNumber});
 }
 async recover(intent:OrderIntent,hash?:Hex):Promise<Recovery>{
  const order=await this.paidOrder(this.buyer,intent.orderId);
  if(hash){try{const receipt=await this.publicClient.getTransactionReceipt({hash});if(receipt.status==='reverted')return {status:'failed'};return {status:'confirmed',payment:await this.confirm(intent,hash)};}catch{return {status:'pending'};}}
  if(order.amount>0n){const logs=await this.publicClient.getLogs({address:this.config.checkoutAddress,event:checkoutAbi.find(x=>x.type==='event'&&x.name==='OrderPaid')!,args:{buyer:this.buyer,orderId:intent.orderId},fromBlock:BigInt(this.config.deployment.deploymentBlock)});const match=logs.at(-1);if(match)return {status:'confirmed',payment:await this.confirm(intent,match.transactionHash)};}
  return {status:'pending'};
 }
 async delivery(intent:OrderIntent){
  const expiresAt=Math.floor(Date.now()/1000)+120;
  const access={orderId:intent.orderId,recordId:intent.recordId,expiresAt};
  const buyerSignature=await this.account.signMessage({message:deliveryMessage(this.config.chainId,this.config.checkoutAddress,intent.quote.merchant,access)});
  const response=await fetch('http://127.0.0.1:'+Number(process.env.API_PORT||3001)+'/service/'+intent.quote.merchantId+'/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...access,buyerSignature}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new AppError('DELIVERY_TIMEOUT','DELIVERY_TIMEOUT: paid data service did not return the record.');
  return await response.json() as DeliveryResult;
 }
 async scenario(recordId:RecordId,price:bigint){
  if(!this.config.merchantBKey)throw new AppError('NOT_READY','The local Seller B key is required for this demo control.',503);
  const account=privateKeyToAccount(this.config.merchantBKey);
  if(account.address.toLowerCase()!==this.config.deployment.merchants.b.address.toLowerCase())throw new AppError('NOT_READY','Seller B signer does not match deployment metadata.',503);
  const wallet=createWalletClient({account,chain:this.config.chain,transport:http(this.config.rpcUrl,{retryCount:0})});
  const {request}=await this.publicClient.simulateContract({address:this.config.checkoutAddress,abi:checkoutAbi,functionName:'setOffer',args:[skuFor(recordId),price,150000n,0,true],account});
  const hash=await wallet.writeContract(request);const receipt=await this.publicClient.waitForTransactionReceipt({hash,confirmations:this.confirmations,timeout:90000});
  if(receipt.status!=='success')throw new AppError('PAYMENT_FAILED','Seller B offer update failed.');
  return hash;
 }
 async history():Promise<HistoryOrder[]>{
  const latest=await this.publicClient.getBlockNumber({cacheTime:0});const toBlock=latest-BigInt(this.confirmations-1);
  const sources=[{address:this.config.checkoutAddress,fromBlock:this.config.deployment.deploymentBlock},...(this.config.deployment.previousCheckoutAddress?[{address:this.config.deployment.previousCheckoutAddress,fromBlock:this.config.deployment.previousDeploymentBlock??'0'}]:[])];
  const logs=(await Promise.all(sources.map(source=>this.publicClient.getLogs({address:source.address,event:checkoutAbi.find(x=>x.type==='event'&&x.name==='OrderPaid')!,args:{buyer:this.buyer},fromBlock:BigInt(source.fromBlock),toBlock})))).flat().sort((a,b)=>a.blockNumber<b.blockNumber?-1:a.blockNumber>b.blockNumber?1:a.logIndex-b.logIndex);
  const known=['bnb-agents','bnb-identity','bnb-commerce','bnb-budget'] as RecordId[];
  return logs.flatMap(log=>{const recordId=known.find(id=>skuFor(id)===log.args.sku);if(!recordId||!log.args.merchant||!log.args.orderId||log.args.amount===undefined)return [];return [{buyerRole:this.config.buyerRole,buyer:this.buyer,merchant:log.args.merchant,recordId,orderId:log.args.orderId,transactionHash:log.transactionHash,amount:log.args.amount.toString(),setup:this.config.deployment.warmupOrders.some(o=>o.orderId===log.args.orderId)}];});
 }
}
