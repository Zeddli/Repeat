import {describe,it,expect} from 'vitest';
import {Runner} from '../server/runner.js';
import {verifyPaymentReceipt} from '../server/receipt.js';
import type {Quote,Hex,DeliveryResult} from '../shared/types.js';
const buyer='0x0000000000000000000000000000000000000001' as const;
const merchant='0x0000000000000000000000000000000000000002' as const;
const checkout='0x0000000000000000000000000000000000000003' as const;
const hash=('0x'+'11'.repeat(32)) as `0x${string}`;
const quote:Quote={buyer,merchant,merchantId:'a',name:'A',sku:('0x'+'22'.repeat(32)) as Hex,amount:'40000',basePrice:'50000',appliedBps:2000,priorPaid:'150000',purchaseCount:'3',offerVersion:'1',blockNumber:'1'};
const data:DeliveryResult={recordId:'bnb-budget',title:'Budget',sourceUrl:'https://example.org',corpusTimestamp:'2026-10-17',facts:['fact'],orderId:hash,merchant,deliveryStatus:'returned'};
function setup(options:{unknown?:boolean;invalidPlan?:boolean;deliveryFailure?:boolean}={}){
 const entries:any[]=[];let paid=0n;let deliveries=0;
 const gateway={buyer,quotes:async()=>[quote],approve:async()=>0n,pay:async(intent:any,onHash:(h:Hex)=>void)=>{paid+=40000n;onHash(hash);if(options.unknown)throw new Error('connection lost');return {transactionHash:hash,amount:40000n,basePrice:50000n,appliedBps:2000,gasCost:123n};},recover:async()=>({status:'pending' as const}),delivery:async()=>{deliveries++;if(options.deliveryFailure&&deliveries===1)throw new Error('timeout');return data;}};
 const journal={append:(entry:any)=>entries.push(entry),read:()=>entries};
 const planner=async()=>({mission:'Read budget',recordIds:options.invalidPlan?['unknown']:['bnb-budget']});
 const runner=new Runner(gateway,journal,planner,300000n,'deterministic');
 return {runner,entries,gateway,getPaid:()=>paid};
}
describe('mission orchestration',()=>{
 it('deducts only confirmed actual payments and retries paid delivery',async()=>{const {runner,getPaid}=setup({deliveryFailure:true});const r=runner.start('Read','60000');await runner.wait(r.id);expect(r.status).toBe('completed');expect(r.spent).toBe('40000');expect(r.remaining).toBe('20000');expect(r.results[0].deliveryStatus).toBe('returned');expect(getPaid()).toBe(40000n);});
 it('invalid planner output never changes paid ledger',async()=>{const {runner,getPaid}=setup({invalidPlan:true});const r=runner.start('Read','60000');await runner.wait(r.id);expect(r.status).toBe('failed');expect(r.error).toContain('INVALID_PLAN');expect(getPaid()).toBe(0n);});
 it('unknown payment outcomes pause signing across new missions',async()=>{const {runner,getPaid,entries}=setup({unknown:true});const r=runner.start('Read','60000');await runner.wait(r.id);expect(r.error).toContain('TX_PENDING');expect(entries.find(e=>e.kind==='intent')).toBeTruthy();expect(()=>runner.start('Read again','60000')).toThrow('TX_PENDING');expect(getPaid()).toBe(40000n);});
 it('idempotent request reuses the existing run',async()=>{const {runner}=setup();const r=runner.start('Read','60000','owner-request-1');expect(runner.start('Read','60000','owner-request-1').id).toBe(r.id);await runner.wait(r.id);});
 it('rejects reuse of an idempotency key for changed owner instructions',async()=>{const {runner}=setup();const r=runner.start('Read','60000','owner-key');expect(()=>runner.start('Different mission','60000','owner-key')).toThrow('IDEMPOTENCY_CONFLICT');await runner.wait(r.id);});
 it('honors stop while quote reads are in flight',async()=>{
 let resolveQuotes!:(quotes:Quote[])=>void;let quoteStarted!:()=>void;const reading=new Promise<void>(r=>quoteStarted=r);let paid=0n;
 const gateway={buyer,quotes:async()=>{quoteStarted();return new Promise<Quote[]>(r=>resolveQuotes=r);},approve:async()=>0n,pay:async()=>{paid+=40000n;return {transactionHash:hash,amount:40000n,basePrice:50000n,appliedBps:2000,gasCost:1n};},recover:async()=>({status:'pending' as const}),delivery:async()=>data};
 const runner=new Runner(gateway,{append:()=>{},read:()=>[]},async()=>({mission:'Read',recordIds:['bnb-budget']}),300000n,'deterministic');
 const run=runner.start('Read','60000');await reading;runner.stop(run.id);resolveQuotes([quote]);await runner.wait(run.id);expect(run.status).toBe('stopped');expect(run.spent).toBe('0');expect(paid).toBe(0n);
 });
 it('deducts confirmed approval gas from the whole mission gas allowance',async()=>{
 const gateway={buyer,quotes:async()=>[quote],approve:async()=>100n,pay:async(intent:any)=>{if(intent.gasRemaining!=='100')throw new Error('approval gas was not reserved');return {transactionHash:hash,amount:40000n,basePrice:50000n,appliedBps:2000,gasCost:60n};},recover:async()=>({status:'not-submitted' as const}),delivery:async()=>data};
 const runner=new Runner(gateway,{append:()=>{},read:()=>[]},async()=>({mission:'Read',recordIds:['bnb-budget']}),300000n,'deterministic',200n);
 const run=runner.start('Read','60000');await runner.wait(run.id);expect(run.status).toBe('completed');expect(run.gasSpent).toBe('160');expect(run.spent).toBe('40000');
 });
 it.each(['planning','running'] as const)('allows a new mission after an interrupted %s run with no unresolved payment',async(status)=>{
 const {runner,gateway}=setup();const first=runner.start('Read','60000');await runner.wait(first.id);
 const saved=[{kind:'run',run:{...first,status}}];
 const recovered=new Runner(gateway,{append:()=>{},read:()=>saved},async()=>({mission:'Read',recordIds:['bnb-budget']}),300000n,'deterministic');
 expect(recovered.get(first.id)?.status).toBe('failed');const next=recovered.start('New explicitly requested mission','60000');await recovered.wait(next.id);expect(next.status).toBe('completed');
 });
 it('keeps signing blocked after restart when a payment intent is unresolved',async()=>{
 const {runner,gateway,entries}=setup({unknown:true});const first=runner.start('Read','60000');await runner.wait(first.id);
 const recovered=new Runner(gateway,{append:()=>{},read:()=>entries},async()=>({mission:'Read',recordIds:['bnb-budget']}),300000n,'deterministic');
 expect(()=>recovered.start('New mission','60000')).toThrow('TX_PENDING');
 });
 it('rejects receipts from the wrong chain or contract',()=>{expect(()=>verifyPaymentReceipt({status:'success',to:merchant,logs:[]},{chainId:97,actualChainId:56,checkoutAddress:checkout,buyer,merchant,orderId:hash,sku:quote.sku,maxAmount:40000n})).toThrow('WRONG_CHAIN');expect(()=>verifyPaymentReceipt({status:'success',to:merchant,logs:[]},{chainId:97,actualChainId:97,checkoutAddress:checkout,buyer,merchant,orderId:hash,sku:quote.sku,maxAmount:40000n})).toThrow('PAYMENT_FAILED');});
});
