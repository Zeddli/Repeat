import type { Quote } from '../shared/types.js';
import { AppError } from './errors.js';
export function chooseQuote(quotes: Quote[], remainingBudget: bigint): Quote|null {
 return quotes.filter(q=>/^\d+$/.test(q.amount)&&BigInt(q.amount)>0n&&BigInt(q.amount)<=remainingBudget).sort((a,b)=>BigInt(a.amount)<BigInt(b.amount)?-1:BigInt(a.amount)>BigInt(b.amount)?1:a.merchant.toLowerCase().localeCompare(b.merchant.toLowerCase()))[0]??null;
}
export function validateBudget(value: unknown, ceiling: bigint): bigint {
 if(typeof value!=='string'||!/^\d+$/.test(value)||BigInt(value)<=0n||BigInt(value)>ceiling) throw new AppError('BUDGET_EXCEEDED','Choose a positive integer budget within the application ceiling.');
 return BigInt(value);
}

export function boundedGas(estimate:bigint,gasPrice:bigint,cap:bigint,balance:bigint):{gas:bigint;gasPrice:bigint}{const gas=estimate*2n;if(estimate<=0n||gasPrice<0n||gas*gasPrice>cap||gas*gasPrice>balance)throw new AppError('INSUFFICIENT_GAS','INSUFFICIENT_GAS: transaction gas maximum exceeds the separate cap or native balance.');return {gas,gasPrice};}
