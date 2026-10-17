import express from 'express';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { isAddress,zeroAddress } from 'viem';
import { z } from 'zod';
import type { Address,RecordId,Snapshot } from '../shared/types.js';
import { loadConfig,appRoot } from './config.js';
import { ChainGateway } from './chain.js';
import { Journal } from './journal.js';
import { Runner } from './runner.js';
import { planMission,plannerMode,recordIds } from './planner.js';
import { deliverRecord,type DeliveryRequest } from './service.js';
import { AppError } from './errors.js';
import { createMarketplaceRouter } from './marketplace.js';
const recordSchema=z.enum(recordIds);
const labels=['wBSC is a six-decimal test token with no monetary value.','Fixed demo corpus; both sellers are builder-operated.','Payment confirms entitlement, not delivery. No refunds in this prototype.'];
export function createApi(){
 const api=express();api.disable('x-powered-by');api.use(express.json({limit:'256kb'}));
 let gateway:ChainGateway|undefined;let runner:Runner|undefined;let setupError='';let scenarioBusy=false;
 try{const config=loadConfig();gateway=new ChainGateway(config);runner=new Runner(gateway,new Journal(appRoot+'data/journal-'+config.chainId+'-'+config.checkoutAddress.toLowerCase()+'-'+config.buyerRole+'.jsonl'),planMission,config.maxSpend,plannerMode(),config.gasCap);}
 catch(error){setupError=error instanceof AppError?error.message:'Local deployment configuration is invalid. Run setup:local.';}
 api.use((req,res,next)=>{
  const host=(req.headers.host??'').split(':')[0];
  if(host!=='localhost'&&host!=='127.0.0.1'){res.status(403).json({error:'BAD_ORIGIN',message:'Use the loopback address for this local API.'});return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){
   const origin=req.headers.origin;
   const allowed=new Set(['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:4173','http://localhost:4173','http://127.0.0.1:3001','http://localhost:3001']);
   if(origin&&!allowed.has(origin)){res.status(403).json({error:'BAD_ORIGIN',message:'Unexpected browser origin.'});return;}
  }next();
 });
 function configured(){if(!gateway||!runner)throw new AppError('NOT_READY',setupError||'Run setup:local first.',503);return {gateway,runner};}
 api.use(createMarketplaceRouter(()=>configured().gateway));
 function plannerAvailable(){return plannerMode()==='deterministic'||Boolean(process.env.LLM_MODEL);}
 async function snapshot():Promise<Snapshot>{
  const fallback:Snapshot={ready:false,mode:'unconfigured',network:{chainId:Number(process.env.CHAIN_ID||31337),name:'Not configured',explorerUrl:''},planner:{mode:plannerMode(),available:plannerAvailable()},buyer:{address:zeroAddress,role:process.env.ACTIVE_BUYER_ROLE||'rehearsal',tokenBalance:'0',gasBalance:'0'},merchants:[],history:[],checkoutAddress:zeroAddress,tokenAddress:zeroAddress,freshQuotes:[],recordId:'bnb-budget',labels,maxSpendUnits:'300000',error:setupError||'Run npm run setup:local to prepare a real local EVM.'};
  if(!gateway||!runner)return fallback;
  const {config}=gateway;
  Object.assign(fallback,{mode:config.chainId===31337?'local':'bsc-testnet',network:{chainId:config.chainId,name:config.chain.name,explorerUrl:config.chainId===97?'https://testnet.bscscan.com':''},buyer:{...fallback.buyer,address:gateway.buyer,role:config.buyerRole},checkoutAddress:config.checkoutAddress,tokenAddress:config.tokenAddress,maxSpendUnits:config.maxSpend.toString(),latestRun:runner.latest()});
  try{
   const [quotes,freshQuotes,balances,history]=await Promise.all([gateway.quotes('bnb-budget'),gateway.quotes('bnb-budget',config.deployment.buyers.fresh.address),gateway.balances(),gateway.history()]);
   fallback.ready=true;fallback.error=undefined;fallback.buyer={...fallback.buyer,...balances};fallback.history=history;fallback.freshQuotes=freshQuotes;
   fallback.merchants=quotes.map(q=>({id:q.merchantId,name:q.name,address:q.merchant,basePrice:q.basePrice,price:q.amount,appliedBps:q.appliedBps,priorPaid:q.priorPaid,purchaseCount:q.purchaseCount,offerVersion:q.offerVersion}));
   if(!plannerAvailable()){fallback.ready=false;fallback.error='ANTHROPIC_API_KEY is set; configure LLM_MODEL to enable model planning.';}
  }catch(error){fallback.error=error instanceof AppError?error.message:'RPC is unavailable or contract state could not be read. Start the local EVM and retry.';}
  return fallback;
 }
 api.get('/api/state',async(_req,res)=>res.json(await snapshot()));
 api.get('/api/quotes',async(req,res)=>{
  const {gateway}=configured();const recordId=recordSchema.parse(req.query.recordId??'bnb-budget');const buyer=req.query.buyer??gateway.buyer;
  if(typeof buyer!=='string'||!isAddress(buyer))throw new AppError('INVALID_BUYER','Provide a valid buyer address.');
  res.json(await gateway.quotes(recordId,buyer));
 });
 api.post('/api/runs',async(req,res)=>{
  const {gateway,runner}=configured();if(scenarioBusy)throw new AppError('RUN_ACTIVE','Wait for the seller offer update before running a mission.',409);
  if(!plannerAvailable())throw new AppError('NOT_READY','Configure LLM_MODEL for the supplied Anthropic API key.',503);
  await gateway.assertReady();
  const body=z.object({mission:z.string().min(1).max(2000),maxSpend:z.string()}).strict().parse(req.body);
  const requestId=req.header('Idempotency-Key');if(requestId&&(!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)))throw new AppError('INVALID_REQUEST','Invalid idempotency key.');
  const run=runner.start(body.mission,body.maxSpend,requestId);res.status(202).json(run);
 });
 api.get('/api/runs/:id',(req,res)=>{const {runner}=configured();const run=runner.get(req.params.id);if(!run)throw new AppError('NOT_FOUND','Mission not found.',404);res.json(run);});
 api.post('/api/runs/:id/stop',(req,res)=>{const {runner}=configured();res.json(runner.stop(req.params.id));});
 api.post('/api/scenario',async(req,res)=>{
  const {gateway,runner}=configured();if(runner.isBusy()||scenarioBusy)throw new AppError('RUN_ACTIVE','Wait for the active operation before changing a seller offer.',409);
  const body=z.object({recordId:recordSchema,sellerBPrice:z.enum(['35000','45000','55000'])}).strict().parse(req.body);
  scenarioBusy=true;
  try{await gateway.assertReady();await gateway.scenario(body.recordId,BigInt(body.sellerBPrice));scenarioBusy=false;res.json(await snapshot());}
  catch{throw new AppError('TX_PENDING','Seller update outcome needs inspection. Demo signing is paused until the API is restarted after checking the transaction.',409);}
 });
 api.post('/service/:merchant/data',async(req,res)=>{
  const {gateway}=configured();
  res.json(await deliverRecord({chainId:gateway.config.chainId,checkoutAddress:gateway.config.checkoutAddress,merchants:Object.fromEntries(Object.entries(gateway.config.deployment.merchants).map(([id,m])=>[id,m.address])),paidOrder:(buyer,orderId)=>gateway.paidOrder(buyer,orderId)},req.params.merchant,req.body as DeliveryRequest));
 });
 api.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(error&&typeof error==='object'&&'type' in error&&(error.type==='entity.parse.failed'||error.type==='entity.too.large')){res.status(400).json({error:'INVALID_REQUEST',message:'Provide valid JSON within the supported request size.'});return;}
  if(error instanceof z.ZodError){res.status(400).json({error:'INVALID_REQUEST',message:'Request does not match the supported API schema.'});return;}
  if(error instanceof AppError){res.status(error.status).json({error:error.code,message:error.message});return;}
  res.status(500).json({error:'SERVER_ERROR',message:'The operation failed. Check local configuration and RPC availability.'});
 });
 return api;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(fileURLToPath(pathToFileURL(process.argv[1]))).href){
 const port=Number(process.env.API_PORT||3001);createApi().listen(port,'127.0.0.1',()=>console.log('Repeat API listening at http://127.0.0.1:'+port+' (wallet marketplace + local demo lab)'));
}
