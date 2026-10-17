import { Router } from 'express';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createWalletClient, getAddress, http, isAddress, keccak256, toBytes, zeroAddress } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { z } from 'zod';
import { checkoutAbi, tokenAbi } from '../shared/abi.js';
import type { Address, Hex } from '../shared/types.js';
import type { MarketConfig, MarketDelivery, MarketWallet, PublishService, ServiceListing, ServiceQuote, WalletSession, FaucetResult } from '../shared/marketplace.js';
import { appRoot } from './config.js';
import type { ChainGateway } from './chain.js';
import { AppError } from './errors.js';
import { MarketAuth } from './market-auth.js';
import { MarketStore, type StoredService } from './market-store.js';

const addressSchema=z.string().refine(isAddress).transform(address=>getAddress(address));
const units=z.string().regex(/^[1-9][0-9]{0,77}$/).refine(value=>BigInt(value)<2n**256n);
const categorySchema=z.enum(['research','data','automation','other']);
const publishSchema=z.object({id:z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),title:z.string().trim().min(1).max(160),description:z.string().trim().min(1).max(2000),category:categorySchema,basePrice:units,spendThreshold:units,discountBps:z.number().int().min(0).max(2000),response:z.string().min(1).max(50000)}).strict();
const deliverySchema=z.object({orderId:z.string().regex(/^0x[0-9a-fA-F]{64}$/)}).strict();
const sameAddress=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const tokenCap=1000000n,gasCap=50000000000000000n;
// Account zero is the public disposable Anvil deployer, never a personal wallet.
const localMnemonic='test test test test test test test test test test test junk';
type Options={storePath?:string;now?:()=>number};
export function createMarketplaceRouter(getGateway:()=>ChainGateway,options:Options={}){
 const router=Router(),now=options.now??Date.now;let auth:MarketAuth|undefined,store:MarketStore|undefined;let faucetQueue:Promise<unknown>=Promise.resolve();
 function context(){const gateway=getGateway(),c=gateway.config;auth??=new MarketAuth(c.chainId,now);const scope=[c.chainId,c.checkoutAddress.toLowerCase(),c.tokenAddress.toLowerCase(),c.deployment.deploymentBlock,c.deployment.createdAt].join(':');store??=new MarketStore(options.storePath??appRoot+'data/marketplace-'+c.chainId+'-'+c.checkoutAddress.toLowerCase()+'-'+c.deployment.deploymentBlock+'-'+Date.parse(c.deployment.createdAt)+'.json',scope,c.deployment);return {gateway,auth,store};}
 function session(header?:string){return context().auth.session(header);}
 async function confirmedBlock(gateway:ChainGateway){const latest=await gateway.publicClient.getBlockNumber({cacheTime:0}),depth=BigInt((gateway.config.chainId===97?2:1)-1);return latest>depth?latest-depth:0n;}
 async function currentListing(gateway:ChainGateway,item:StoredService,blockNumber:bigint):Promise<ServiceListing|null>{
  const offer=await gateway.publicClient.readContract({address:gateway.config.checkoutAddress,abi:checkoutAbi,functionName:'offer',args:[item.listing.seller,item.listing.sku],blockNumber});
  if(!offer.enabled||offer.version===0n)return null;
  return {...store!.public(item),basePrice:offer.basePrice.toString(),spendThreshold:offer.spendThreshold.toString(),discountBps:offer.discountBps,offerVersion:offer.version.toString()};
 }
 function service(id:string){const result=context().store.get(id);if(!result)throw new AppError('NOT_FOUND','Service not found.',404);return result;}
 async function wallet(gateway:ChainGateway,address:Address):Promise<MarketWallet>{await gateway.assertReady();const [tokenBalance,gasBalance]=await Promise.all([gateway.publicClient.readContract({address:gateway.config.tokenAddress,abi:tokenAbi,functionName:'balanceOf',args:[address]}),gateway.publicClient.getBalance({address})]);return {address,tokenBalance:tokenBalance.toString(),gasBalance:gasBalance.toString()};}
 router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 for(const [route,file] of [['skill','SKILL.md'],['docs','references/api.md']] as const)router.get('/api/market/'+route,(_req,res)=>{try{res.type('text/plain; charset=utf-8').set('Content-Disposition','inline').send(readFileSync(appRoot+'../skills/repeat-marketplace/'+file,'utf8'));}catch{throw new AppError('NOT_READY','The marketplace agent documentation is not available yet.',503);}});

 router.get('/api/market/client',(_req,res)=>{
  try{
   const client=readFileSync(appRoot+'generated/repeat-agent.mjs');
   res.type('application/javascript').setHeader('Content-Disposition','attachment; filename="repeat-agent.mjs"');
   res.setHeader('X-Content-SHA256',createHash('sha256').update(client).digest('hex'));
   res.send(client);
  }catch{throw new AppError('NOT_READY','Build the downloadable client with npm run build:agent in app/, then retry.',503);}
 });
 router.post('/api/auth/challenge',(req,res)=>{res.json(context().auth.challenge(req.body,req.header('Origin')));});
 router.post('/api/auth/verify',async(req,res)=>{res.json(await context().auth.verify(req.body,req.header('Origin')));});
 router.get('/api/auth/session',(req,res)=>{const {address,expiresAt,chainId}=session(req.header('Authorization'));res.json({address,expiresAt,chainId});});
 router.post('/api/auth/logout',(req,res)=>{z.object({}).strict().parse(req.body);context().auth.logout(req.header('Authorization'));res.json({ok:true});});
 router.get('/api/market/config',async(_req,res)=>{
  try{const {gateway}=context(),c=gateway.config;const result:MarketConfig={ready:false,chainId:c.chainId,chainName:c.chain.name,rpcUrl:c.rpcUrl,nativeSymbol:c.chain.nativeCurrency.symbol,tokenAddress:c.tokenAddress,checkoutAddress:c.checkoutAddress,explorerUrl:c.chainId===97?'https://testnet.bscscan.com':'',localFaucet:c.chainId===31337,tokenSymbol:'wBSC',tokenDecimals:6,loyaltyScope:'service',previousCheckoutAddress:c.deployment.previousCheckoutAddress};try{await gateway.assertReady();result.ready=true;}catch(error){result.error=error instanceof AppError?error.message:'RPC is unavailable. Start the configured chain and retry.';}res.json(result);}
  catch(error){const result:MarketConfig={ready:false,chainId:Number(process.env.CHAIN_ID||31337),chainName:'Not configured',rpcUrl:'',nativeSymbol:'ETH',tokenAddress:zeroAddress,checkoutAddress:zeroAddress,explorerUrl:'',localFaucet:false,tokenSymbol:'wBSC',tokenDecimals:6,error:error instanceof AppError?error.message:'Run setup:local to configure the marketplace.'};res.json(result);}
 });
 router.get('/api/market/services',async(req,res)=>{
  const query=z.object({q:z.string().max(200).optional(),category:categorySchema.optional()}).strict().parse(req.query);const {gateway,store}=context();await gateway.assertReady();const block=await confirmedBlock(gateway),needle=(query.q??'').toLowerCase();
  const candidates=store.all().filter(item=>(!query.category||item.listing.category===query.category)&&(!needle||[item.listing.title,item.listing.description,item.listing.id,item.listing.seller].join(' ').toLowerCase().includes(needle)));
  const listings=await Promise.all(candidates.map(item=>currentListing(gateway,item,block)));res.json({services:listings.filter((item):item is ServiceListing=>item!==null)});
 });
 router.get('/api/market/services/:id',async(req,res)=>{const item=service(req.params.id),{gateway}=context();await gateway.assertReady();const listing=await currentListing(gateway,item,await confirmedBlock(gateway));if(!listing)throw new AppError('NOT_FOUND','This service offer is disabled.',404);res.json(listing);});
 router.post('/api/market/services',async(req,res)=>{
  const signed=session(req.header('Authorization')),body:PublishService=publishSchema.parse(req.body),{gateway,store}=context(),previous=store.get(body.id);
  if(previous&&!sameAddress(previous.listing.seller,signed.address))throw new AppError('WRONG_OWNER','This service id belongs to a different seller.',403);
  if(body.id.startsWith('fixture-'))throw new AppError('SERVICE_EXISTS','Builder fixture ids are reserved.',409);
  if(previous&&(['title','description','category','basePrice','spendThreshold','discountBps'].some(key=>previous.listing[key as keyof ServiceListing]!==body[key as keyof PublishService])||previous.response!==body.response))throw new AppError('SERVICE_EXISTS','Published services are immutable. Publish a new service id.',409);
  await gateway.assertReady();const sku=keccak256(toBytes(body.id)),offer=await gateway.publicClient.readContract({address:gateway.config.checkoutAddress,abi:checkoutAbi,functionName:'offer',args:[signed.address,sku],blockNumber:await confirmedBlock(gateway)});
  if(!offer.enabled||offer.version===0n||offer.basePrice!==BigInt(body.basePrice)||offer.spendThreshold!==BigInt(body.spendThreshold)||offer.discountBps!==body.discountBps)throw new AppError('OFFER_MISMATCH','Confirm a matching setOffer transaction from this seller wallet before publishing.',409);
  const listing:ServiceListing={id:body.id,seller:signed.address,sku,title:body.title,description:body.description,category:body.category,basePrice:body.basePrice,spendThreshold:body.spendThreshold,discountBps:body.discountBps,offerVersion:offer.version.toString(),kind:'hosted',createdAt:previous?.listing.createdAt??new Date(now()).toISOString()};
  if(!previous)store.add({listing,response:body.response});res.status(201).json(listing);
 });
 router.get('/api/market/services/:id/quote',async(req,res)=>{
  const query=z.object({buyer:addressSchema}).strict().parse(req.query),item=service(req.params.id),{gateway}=context();await gateway.assertReady();const block=await confirmedBlock(gateway),listing=await currentListing(gateway,item,block);if(!listing)throw new AppError('OFFER_DISABLED','This seller disabled the service.',409);
  const [amount,appliedBps,priorPaid,purchaseCount,offerVersion]=await gateway.publicClient.readContract({address:gateway.config.checkoutAddress,abi:checkoutAbi,functionName:'preview',args:[query.buyer,listing.seller,listing.sku],blockNumber:block});
  const quote:ServiceQuote={serviceId:listing.id,buyer:query.buyer,seller:listing.seller,sku:listing.sku,amount:amount.toString(),basePrice:listing.basePrice,appliedBps,priorPaid:priorPaid.toString(),purchaseCount:purchaseCount.toString(),offerVersion:offerVersion.toString(),blockNumber:block.toString()};res.json(quote);
 });
 router.get('/api/market/wallet',async(req,res)=>{res.setHeader('Cache-Control','no-store');const signed=session(req.header('Authorization'));res.json(await wallet(context().gateway,signed.address));});
 router.post('/api/market/services/:id/deliver',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');const signed=session(req.header('Authorization')),body=deliverySchema.parse(req.body),item=service(req.params.id),{gateway}=context();const paid=await gateway.paidOrder(signed.address,body.orderId as Hex);
  if(paid.amount<=0n||!sameAddress(paid.merchant,item.listing.seller)||paid.sku.toLowerCase()!==item.listing.sku.toLowerCase())throw new AppError('UNPAID_ORDER','This wallet has no confirmed payment for this service and seller.',403);
  const delivered:MarketDelivery={serviceId:item.listing.id,orderId:body.orderId as Hex,buyer:signed.address,seller:item.listing.seller,amount:paid.amount.toString(),response:item.response,deliveredAt:new Date(now()).toISOString()};res.json(delivered);
 });
 async function faucet(signed:WalletSession):Promise<FaucetResult>{
  const {gateway,store}=context(),c=gateway.config;if(c.chainId!==31337)throw new AppError('FAUCET_DISABLED','Free local funding is available only on chain 31337.',403);
  if(c.deployment.buyers.judge&&sameAddress(signed.address,c.deployment.buyers.judge.address))throw new AppError('PROTECTED_WALLET','Use a fresh disposable wallet for marketplace funding.',403);
  await gateway.assertReady();const initial=await wallet(gateway,signed.address),previous=store.grant(signed.address),time=now();if(previous&&time-previous.lastAt<60000)throw new AppError('FAUCET_RATE_LIMIT','Wait one minute between local funding requests.',429);
  const availableToken=tokenCap-BigInt(previous?.tokenGranted??'0'),availableGas=gasCap-BigInt(previous?.gasGranted??'0');
  const neededToken=tokenCap>BigInt(initial.tokenBalance)?tokenCap-BigInt(initial.tokenBalance):0n,neededGas=gasCap>BigInt(initial.gasBalance)?gasCap-BigInt(initial.gasBalance):0n;
  const tokenAmount=neededToken<availableToken?neededToken:availableToken,gasAmount=neededGas<availableGas?neededGas:availableGas;
  if(tokenAmount<=0n&&gasAmount<=0n)return {wallet:initial};
  // Persist the reservation before broadcast: an uncertain receipt must not trigger duplicate grants after restart.
  store.reserveGrant(signed.address,{lastAt:time,tokenGranted:(BigInt(previous?.tokenGranted??'0')+tokenAmount).toString(),gasGranted:(BigInt(previous?.gasGranted??'0')+gasAmount).toString()});
  const account=mnemonicToAccount(localMnemonic,{addressIndex:0}),client=createWalletClient({account,chain:c.chain,transport:http(c.rpcUrl,{retryCount:0})});let gasHash:Hex|undefined,tokenHash:Hex|undefined;
  if(gasAmount>0n){gasHash=await client.sendTransaction({to:signed.address,value:gasAmount,chain:c.chain});const receipt=await gateway.publicClient.waitForTransactionReceipt({hash:gasHash,confirmations:1,timeout:90000});if(receipt.status!=='success')throw new AppError('FAUCET_FAILED','Local gas funding failed. Inspect the transaction before retrying.',409);}
  if(tokenAmount>0n){const {request}=await gateway.publicClient.simulateContract({address:c.tokenAddress,abi:tokenAbi,functionName:'mint',args:[signed.address,tokenAmount],account});tokenHash=await client.writeContract(request);const receipt=await gateway.publicClient.waitForTransactionReceipt({hash:tokenHash,confirmations:1,timeout:90000});if(receipt.status!=='success')throw new AppError('FAUCET_FAILED','Local token funding failed. Inspect the transaction before retrying.',409);}
  return {gasHash,tokenHash,wallet:await wallet(gateway,signed.address)};
 }
 router.post('/api/market/faucet',async(req,res)=>{res.setHeader('Cache-Control','no-store');const signed=session(req.header('Authorization'));z.object({}).strict().parse(req.body);const operation=faucetQueue.then(()=>faucet(signed));faucetQueue=operation.catch(()=>{});res.json(await operation);});
 return router;
}
