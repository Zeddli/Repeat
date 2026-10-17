import { describe,it,expect,vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256,toBytes,zeroAddress } from 'viem';
import { deliverRecord,deliveryMessage,type DeliveryContext } from '../server/service.js';
const account=privateKeyToAccount(('0x'+'11'.repeat(32)) as `0x${string}`);
const other=privateKeyToAccount(('0x'+'22'.repeat(32)) as `0x${string}`);
const checkout='0x0000000000000000000000000000000000000001' as const;
const merchant='0x0000000000000000000000000000000000000002' as const;
const orderId=('0x'+'33'.repeat(32)) as `0x${string}`;
function context():DeliveryContext{return {chainId:31337,checkoutAddress:checkout,merchants:{a:merchant},paidOrder:async(buyer)=>({merchant:buyer===account.address?merchant:zeroAddress,sku:keccak256(toBytes('bnb-budget')),amount:buyer===account.address?40000n:0n,offerVersion:1n})};}
async function request(signer=account,recordId:'bnb-budget'|'bnb-identity'='bnb-budget',expiresAt=Math.floor(Date.now()/1000)+60){const r={orderId,recordId,expiresAt};return {...r,buyerSignature:await signer.signMessage({message:deliveryMessage(31337,checkout,merchant,r)})};}
describe('payment-bound delivery',()=>{
 it('returns paid record and permits delivery retry for the same order',async()=>{const r=await request();const first=await deliverRecord(context(),'a',r);expect(first.recordId).toBe('bnb-budget');expect(await deliverRecord(context(),'a',r)).toEqual(first);});
 it('rejects another wallet',async()=>expect(deliverRecord(context(),'a',await request(other))).rejects.toThrow('UNPAID_ORDER'));
 it('rejects another record even with a valid signature',async()=>expect(deliverRecord(context(),'a',await request(account,'bnb-identity'))).rejects.toThrow('UNPAID_ORDER'));
 it('rejects expired access',async()=>expect(deliverRecord(context(),'a',await request(account,'bnb-budget',1))).rejects.toThrow('BAD_DELIVERY_SIGNATURE'));
 it('rejects an access grant at its exact expiry',async()=>{vi.useFakeTimers();try{vi.setSystemTime(new Date('2026-10-17T00:00:00Z'));await expect(deliverRecord(context(),'a',await request(account,'bnb-budget',1792195200))).rejects.toThrow('BAD_DELIVERY_SIGNATURE');}finally{vi.useRealTimers();}});
 it('rejects signature modified to a different record',async()=>{const r=await request();await expect(deliverRecord(context(),'a',{...r,recordId:'bnb-identity'})).rejects.toThrow();});
});
