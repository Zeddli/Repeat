import { parseEventLogs,type TransactionReceipt } from 'viem';
import { checkoutAbi } from '../shared/abi.js';
import type { Address,Hex } from '../shared/types.js';
import { AppError } from './errors.js';
export type ReceiptExpectation={chainId:number;actualChainId:number;checkoutAddress:Address;buyer:Address;merchant:Address;orderId:Hex;sku:Hex;maxAmount:bigint};
export function verifyPaymentReceipt(receipt:Pick<TransactionReceipt,'status'|'to'|'logs'>,expected:ReceiptExpectation){
 if(expected.chainId!==expected.actualChainId)throw new AppError('WRONG_CHAIN','WRONG_CHAIN: receipt provider does not match configured network.');
 if(receipt.status!=='success'||receipt.to?.toLowerCase()!==expected.checkoutAddress.toLowerCase())throw new AppError('PAYMENT_FAILED','PAYMENT_FAILED: transaction was reverted or sent to the wrong contract.');
 const events=parseEventLogs({abi:checkoutAbi,eventName:'OrderPaid',logs:receipt.logs.filter(l=>l.address.toLowerCase()===expected.checkoutAddress.toLowerCase()),strict:true});
 const match=events.find(e=>e.args.buyer.toLowerCase()===expected.buyer.toLowerCase()&&e.args.merchant.toLowerCase()===expected.merchant.toLowerCase()&&e.args.orderId.toLowerCase()===expected.orderId.toLowerCase()&&e.args.sku.toLowerCase()===expected.sku.toLowerCase());
 if(!match||match.args.amount<=0n||match.args.amount>expected.maxAmount)throw new AppError('PAYMENT_FAILED','PAYMENT_FAILED: no matching bounded OrderPaid event.');
 return match.args;
}
