import type { Address, Hex } from './types.js';
export type ServiceCategory = 'research' | 'data' | 'automation' | 'other';
export type ServiceListing = {
 id:string; seller:Address; sku:Hex; title:string; description:string; category:ServiceCategory;
 basePrice:string; spendThreshold:string; discountBps:number; offerVersion:string;
 kind:'hosted'|'fixture'; createdAt:string;
};
export type PublishService = {
 id:string; title:string; description:string; category:ServiceCategory;
 basePrice:string; spendThreshold:string; discountBps:number; response:string;
};
export type MarketConfig = {
 ready:boolean; chainId:number; chainName:string; rpcUrl:string; nativeSymbol:string;
 tokenAddress:Address; checkoutAddress:Address; explorerUrl:string; localFaucet:boolean;
 tokenSymbol:'wBSC'; tokenDecimals:6; error?:string; previousCheckoutAddress?:Address; loyaltyScope?:'service';
};
export type WalletSession = {token:string;address:Address;expiresAt:string;chainId:number};
export type AuthChallenge = {challengeId:string;message:string;expiresAt:string};
export type ServiceQuote = {
 serviceId:string; buyer:Address; seller:Address; sku:Hex; amount:string; basePrice:string;
 appliedBps:number; priorPaid:string; purchaseCount:string; offerVersion:string; blockNumber:string;
};
export type MarketDelivery = {serviceId:string;orderId:Hex;buyer:Address;seller:Address;amount:string;response:string;deliveredAt:string};
export type MarketWallet = {address:Address;tokenBalance:string;gasBalance:string};
export type FaucetResult = {tokenHash?:Hex;gasHash?:Hex;wallet:MarketWallet};
