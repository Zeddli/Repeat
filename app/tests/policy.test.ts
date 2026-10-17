import { describe, expect, it } from 'vitest';
import { chooseQuote, validateBudget,boundedGas } from '../server/policy.js';
import type { Quote, Address } from '../shared/types.js';
const a:Address='0x0000000000000000000000000000000000000001';
const b:Address='0x0000000000000000000000000000000000000002';
function q(amount:string, merchant:Address=a): Quote { return {buyer:a,merchant,merchantId:merchant===a?'a':'b',name:'Seller',sku:'0x01',amount,basePrice:'50000',appliedBps:0,priorPaid:'0',purchaseCount:'0',offerVersion:'1',blockNumber:'1'}; }
describe('bounded effective-price decisions',()=>{
 it.each([['40000','45000',a],['40000','35000',b],['50000','45000',b]])('compares %s with %s', (ap,bp,winner)=>expect(chooseQuote([q(ap),q(bp,b as Address)],60000n)?.merchant).toBe(winner));
 it('uses a stable address tie break',()=>expect(chooseQuote([q('40000',b),q('40000')],60000n)?.merchant).toBe(a));
 it('rejects a new 35000 purchase with only 20000 left',()=>expect(chooseQuote([q('35000',b)],60000n-40000n)).toBeNull());
 it('allows the same purchase in a newly approved mission',()=>expect(60000n-BigInt(chooseQuote([q('40000'),q('35000',b)],60000n)!.amount)).toBe(25000n));
 it.each(['0','-1','60000.0','300001','NaN'])('rejects invalid owner cap %s',(value)=>expect(()=>validateBudget(value,300000n)).toThrow());
});

it('bounds the signed gas maximum against the separate cap and native balance',()=>{expect(boundedGas(100000n,2n,500000n,500000n)).toEqual({gas:200000n,gasPrice:2n});expect(()=>boundedGas(100000n,2n,399999n,500000n)).toThrow('INSUFFICIENT_GAS');expect(()=>boundedGas(100000n,2n,500000n,399999n)).toThrow('INSUFFICIENT_GAS');});
