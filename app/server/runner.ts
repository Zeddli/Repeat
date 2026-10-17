import { randomUUID } from 'node:crypto';
import {keccak256,toBytes} from 'viem';
import type { Address,DeliveryResult,Hex,PlannerMode,Quote,RecordId,Run,RunEvent,TaskResult } from '../shared/types.js';
import type { JournalStore } from './journal.js';
import { AppError,messageOf } from './errors.js';
import { chooseQuote,validateBudget } from './policy.js';
import { validatePlan } from './planner.js';
export type OrderIntent={runId:string;recordId:RecordId;orderId:Hex;quote:Quote;maxAmount:string;gasRemaining?:string};
export type ConfirmedPayment={transactionHash:Hex;amount:bigint;basePrice:bigint;appliedBps:number;gasCost:bigint};
export type Recovery={status:'confirmed'|'pending'|'not-submitted'|'failed';payment?:ConfirmedPayment};
export interface BuyerGateway { buyer:Address; quotes(recordId:RecordId):Promise<Quote[]>; approve(budget:bigint):Promise<bigint>;pay(intent:OrderIntent,onHash:(hash:Hex)=>void,shouldStop?:()=>boolean):Promise<ConfirmedPayment>;recover(intent:OrderIntent,hash?:Hex):Promise<Recovery>;delivery(intent:OrderIntent):Promise<DeliveryResult>; }
export class Runner {
 runs=new Map<string,Run>();private jobs=new Map<string,Promise<void>>();private requests=new Map<string,string>();private active?:string;private blocked=false;private stopIds=new Set<string>();
 constructor(private gateway:BuyerGateway,private journal:JournalStore,private planner:(mission:string)=>Promise<unknown>,private ceiling=300000n,private mode:PlannerMode='deterministic',private gasCap=10000000000000000n){
  const entries=journal.read();
  for(const e of entries){if(e.kind==='run'&&e.run&&(!e.buyer||e.buyer.toLowerCase()===gateway.buyer.toLowerCase()))this.runs.set(e.run.id,e.run);if(e.kind==='request'&&e.requestId&&e.runId)this.requests.set(e.requestId,e.runId);}
  const unresolved=new Map<string,OrderIntent>();
  for(const e of entries){if(e.kind==='intent'&&e.intent&&e.intent.quote.buyer.toLowerCase()===gateway.buyer.toLowerCase())unresolved.set(e.intent.orderId,e.intent);if(e.kind==='settled'&&e.orderId)unresolved.delete(e.orderId);}
  this.blocked=unresolved.size>0;
  for(const run of this.runs.values())if(run.status==='running'||run.status==='planning'){run.status='failed';run.error=this.blocked?'TX_PENDING: process restarted with an unresolved payment; inspect the saved order before starting another mission.':'INTERRUPTED: process restarted. Confirmed payments remain recorded; a new mission may be requested.';this.save(run);}
 }
 latest(){return [...this.runs.values()].at(-1);}
 get(id:string){return this.runs.get(id);}
 isBusy(){return Boolean(this.active);}
 start(mission:string,maxSpend:unknown,requestId?:string):Run{
  if(requestId&&this.requests.has(requestId)){const prior=this.runs.get(this.requests.get(requestId)!);if(prior){if(prior.mission!==mission.trim()||prior.maxSpend!==maxSpend)throw new AppError('IDEMPOTENCY_CONFLICT','IDEMPOTENCY_CONFLICT: this request key belongs to different owner instructions.',409);return prior;}}
  if(this.blocked)throw new AppError('TX_PENDING','TX_PENDING: an unresolved transaction is saved in the journal; inspect it before another payment.',409);
  if(this.active)throw new AppError('RUN_ACTIVE','A mission is already running. Wait or stop it first.',409);
  if(typeof mission!=='string'||mission.trim().length===0||mission.length>2000)throw new AppError('INVALID_PLAN','INVALID_PLAN: enter a short research mission.');
  const budget=validateBudget(maxSpend,this.ceiling);
  const now=new Date().toISOString();
  const run:Run={id:randomUUID(),status:'planning',mission:mission.trim(),maxSpend:budget.toString(),spent:'0',remaining:budget.toString(),gasSpent:'0',plannerMode:this.mode,taskRecordIds:[],events:[],results:[],createdAt:now,updatedAt:now};
  this.runs.set(run.id,run);this.active=run.id;this.save(run);
  if(requestId){this.requests.set(requestId,run.id);this.journal.append({kind:'request',requestId,runId:run.id,buyer:this.gateway.buyer});}
  const job=this.execute(run).finally(()=>{this.active=undefined;this.save(run);});this.jobs.set(run.id,job);
  return run;
 }
 wait(id:string){return this.jobs.get(id)??Promise.resolve();}
 stop(id:string){const run=this.runs.get(id);if(!run)throw new AppError('NOT_FOUND','Mission not found.',404);if(run.status==='planning'||run.status==='running'){this.stopIds.add(id);this.event(run,'stopped','Stop requested. A submitted payment will be resolved before stopping.');}return run;}
 private save(run:Run){run.updatedAt=new Date().toISOString();this.journal.append({kind:'run',run,buyer:this.gateway.buyer});}
 private event(run:Run,type:RunEvent['type'],message:string,extra:Partial<RunEvent>={}){run.events.push({id:randomUUID(),at:new Date().toISOString(),type,message,...extra});this.save(run);}
 private checkStop(run:Run){if(this.stopIds.has(run.id)){run.status='stopped';return true;}return false;}
 private async execute(run:Run){
  try{
   const plan=validatePlan(await this.planner(run.mission));run.taskRecordIds=plan.recordIds;
   this.event(run,'plan',(this.mode==='anthropic'?'Model':'Deterministic planner')+' validated '+plan.recordIds.length+' requested record(s): '+plan.recordIds.join(', '));
   if(this.checkStop(run))return;
   run.status='running';let gasSpent=await this.gateway.approve(BigInt(run.maxSpend));run.gasSpent=gasSpent.toString();this.save(run);
   if(gasSpent>this.gasCap)throw new AppError('INSUFFICIENT_GAS','INSUFFICIENT_GAS: token approval exhausted the whole mission gas cap.');
   for(const recordId of plan.recordIds){
    if(this.checkStop(run))return;
    const orderId=keccak256(toBytes(randomUUID()));let payment:ConfirmedPayment|undefined;let intent:OrderIntent|undefined;
    for(let attempt=0;attempt<2&&!payment;attempt++){
     const quotes=await this.gateway.quotes(recordId);if(this.checkStop(run))return;this.event(run,'quotes','Read both eligible prices from the same block.',{recordId});
     const quote=chooseQuote(quotes,BigInt(run.remaining));if(!quote)throw new AppError('BUDGET_EXCEEDED','BUDGET_EXCEEDED: no approved seller fits the remaining mission budget.');
     this.event(run,'decision',quote.name+' is the cheapest eligible seller at '+quote.amount+' base units.',{recordId,merchantId:quote.merchantId,amount:quote.amount});
     intent={runId:run.id,recordId,orderId,quote,maxAmount:quote.amount,gasRemaining:(this.gasCap-gasSpent).toString()};
     this.journal.append({kind:'intent',runId:run.id,intent});
     let hash:Hex|undefined;
     try{payment=await this.gateway.pay(intent,h=>{hash=h;this.journal.append({kind:'hash',runId:run.id,orderId,hash:h});this.event(run,'submitted','Payment transaction submitted.',{recordId,merchantId:quote.merchantId,transactionHash:h});},()=>this.stopIds.has(run.id));}
     catch(error){
      if(error instanceof AppError&&(error.code==='STALE_OFFER'||error.code==='EXPIRED_QUOTE')&&!hash){this.journal.append({kind:'settled',runId:run.id,orderId});if(attempt===0){this.event(run,'recovery','Offer changed; reading fresh quotes once.',{recordId});continue;}throw error;}
      if(error instanceof AppError&&error.code==='STOP_REQUESTED'&&!hash){this.journal.append({kind:'settled',runId:run.id,orderId});run.status='stopped';return;}
      if(error instanceof AppError&&['PAYMENT_REJECTED','INSUFFICIENT_GAS','WRONG_CHAIN','UNKNOWN_MERCHANT'].includes(error.code)&&!hash){this.journal.append({kind:'settled',runId:run.id,orderId});throw error;}
      const recovery=await this.gateway.recover(intent,hash).catch(()=>({status:'pending'} as Recovery));
      if(recovery.status==='confirmed'&&recovery.payment)payment=recovery.payment;
      else if(recovery.status==='failed'||recovery.status==='not-submitted'){this.journal.append({kind:'settled',runId:run.id,orderId});throw error;}
      else {this.blocked=true;throw new AppError('TX_PENDING','TX_PENDING: payment outcome is uncertain. Signing paused; the saved order will not be charged again.',409);}
     }
    }
    if(!payment||!intent)throw new AppError('PAYMENT_FAILED','PAYMENT_FAILED: no confirmed payment.');
    if(payment.amount>BigInt(run.remaining)||payment.amount>BigInt(intent.maxAmount)){this.blocked=true;throw new AppError('PAYMENT_FAILED','PAYMENT_FAILED: confirmed amount exceeded owner limits.');}
    run.spent=(BigInt(run.spent)+payment.amount).toString();run.remaining=(BigInt(run.maxSpend)-BigInt(run.spent)).toString();gasSpent+=payment.gasCost;run.gasSpent=gasSpent.toString();
    const result:TaskResult={recordId,merchantId:intent.quote.merchantId,merchant:intent.quote.merchant,orderId,transactionHash:payment.transactionHash,amount:payment.amount.toString(),basePrice:payment.basePrice.toString(),appliedBps:payment.appliedBps,gasCost:payment.gasCost.toString(),paymentStatus:'confirmed',deliveryStatus:'failed'};
    run.results.push(result);this.event(run,'confirmed','Payment confirmed; requesting the paid record.',{recordId,transactionHash:payment.transactionHash,amount:result.amount});
    this.journal.append({kind:'settled',runId:run.id,orderId});
    for(let retry=0;retry<2;retry++){try{result.data=await this.gateway.delivery(intent);result.deliveryStatus='returned';result.error=undefined;break;}catch(error){result.error=messageOf(error);}}
    this.event(run,'delivery',result.deliveryStatus==='returned'?'Source record returned.':'Payment confirmed; delivery failed. No refund is available in this demo.',{recordId,merchantId:result.merchantId});
   }
   if(!this.checkStop(run))run.status='completed';
  }catch(error){run.status='failed';run.error=error instanceof AppError?(error.message.startsWith(error.code+':')?error.message:error.code+': '+error.message):'MISSION_FAILED: execution failed. Inspect local server diagnostics.';this.event(run,'error',run.error);}
 }
}
