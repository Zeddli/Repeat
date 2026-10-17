import { readFileSync } from 'node:fs';
import { keccak256,recoverMessageAddress,toBytes,zeroAddress } from 'viem';
import { z } from 'zod';
import type { Address, CorpusRecord, DeliveryResult, Hex, RecordId } from '../shared/types.js';
import { AppError } from './errors.js';
import { recordIds } from './planner.js';
export type DeliveryRequest={orderId:Hex;recordId:RecordId;expiresAt:number;buyerSignature:Hex};
export type PaidOrder={merchant:Address;sku:Hex;amount:bigint;offerVersion:bigint};
export type DeliveryContext={chainId:number;checkoutAddress:Address;merchants:Record<string,Address>;paidOrder:(buyer:Address,orderId:Hex)=>Promise<PaidOrder>};
const corpus=JSON.parse(readFileSync(new URL('../data/corpus.json',import.meta.url),'utf8')) as CorpusRecord[];
const requestSchema=z.object({orderId:z.string().regex(/^0x[0-9a-fA-F]{64}$/),recordId:z.enum(recordIds),expiresAt:z.number().int().positive(),buyerSignature:z.string().regex(/^0x[0-9a-fA-F]{130}$/)}).strict();
export function deliveryMessage(chainId:number,checkout:Address,merchant:Address,request:Pick<DeliveryRequest,'orderId'|'recordId'|'expiresAt'>):string {
 return ['Repeat data access v1','chainId='+chainId,'checkout='+checkout.toLowerCase(),'merchant='+merchant.toLowerCase(),'orderId='+request.orderId.toLowerCase(),'recordId='+request.recordId,'expiresAt='+request.expiresAt].join('\n');
}
export async function deliverRecord(context:DeliveryContext,merchantId:string,input:DeliveryRequest):Promise<DeliveryResult> {
 const merchant=context.merchants[merchantId];
 if(!merchant)throw new AppError('UNKNOWN_MERCHANT','UNKNOWN_MERCHANT: choose a configured seller.');
 const parsed=requestSchema.safeParse(input);
 const now=Math.floor(Date.now()/1000);
 if(!parsed.success||input.expiresAt<=now||input.expiresAt>now+300)throw new AppError('BAD_DELIVERY_SIGNATURE','BAD_DELIVERY_SIGNATURE: access signature is malformed or expired.',401);
 let buyer:Address;
 try {buyer=await recoverMessageAddress({message:deliveryMessage(context.chainId,context.checkoutAddress,merchant,input),signature:input.buyerSignature});}
 catch{throw new AppError('BAD_DELIVERY_SIGNATURE','BAD_DELIVERY_SIGNATURE: invalid access signature.',401);}
 const order=await context.paidOrder(buyer,input.orderId);
 if(order.merchant===zeroAddress||order.merchant.toLowerCase()!==merchant.toLowerCase()||order.sku.toLowerCase()!==keccak256(toBytes(input.recordId)).toLowerCase()||order.amount<=0n)throw new AppError('UNPAID_ORDER','UNPAID_ORDER: this wallet has no confirmed payment for this record.',403);
 const record=corpus.find(r=>r.recordId===input.recordId);
 if(!record)throw new AppError('UNPAID_ORDER','UNPAID_ORDER: unknown record.',403);
 return {...record,orderId:input.orderId,merchant,deliveryStatus:'returned'};
}
