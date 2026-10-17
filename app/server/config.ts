import { readFileSync,existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as dotenv } from 'dotenv';
import { getAddress,isAddress,isHex,defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address,Hex,MerchantId,RecordId } from '../shared/types.js';
import { AppError } from './errors.js';
export const appRoot=fileURLToPath(new URL('../',import.meta.url));
dotenv({path:appRoot+'.env.local',quiet:true});dotenv({path:appRoot+'.env',quiet:true});
export type Deployment={loyaltyScope?:'service';previousCheckoutAddress?:Address;previousDeploymentBlock?:string;previousCreatedAt?:string;chainId:number;rpcUrl:string;checkoutAddress:Address;tokenAddress:Address;deploymentBlock:string;merchants:Record<MerchantId,{address:Address;name:string}>;buyers:Record<string,{address:Address}>;warmupOrders:Array<{buyerRole:string;buyer:Address;merchant:Address;recordId:RecordId;orderId:Hex;transactionHash:Hex}>;createdAt:string};
export type ChainConfig={chainId:97|31337;rpcUrl:string;checkoutAddress:Address;tokenAddress:Address;deployment:Deployment;buyerKey:Hex;buyerRole:string;merchantBKey?:Hex;maxSpend:bigint;gasCap:bigint;chain:ReturnType<typeof defineChain>};
function positive(value:string|undefined,fallback:string){if(!/^\d+$/.test(value??fallback)||BigInt(value??fallback)<=0n)throw new AppError('NOT_READY','Invalid local spending configuration.',503);return BigInt(value??fallback);}
function address(value:unknown):Address{if(typeof value!=='string'||!isAddress(value))throw new AppError('NOT_READY','Deployment addresses are missing or invalid. Run setup:local.',503);return getAddress(value);}
function key(value:string|undefined):Hex{if(!value||!isHex(value)||value.length!==66)throw new AppError('NOT_READY','A local disposable buyer key is required. Run setup:local or configure testnet keys.',503);return value;}
export function loadConfig():ChainConfig {
 const chainId=Number(process.env.CHAIN_ID||31337);
 if(chainId!==31337&&chainId!==97)throw new AppError('WRONG_CHAIN','WRONG_CHAIN: only local chain 31337 or BSC testnet 97 is allowed.',503);
 const path=appRoot+'deployments/'+chainId+'.json';
 if(!existsSync(path))throw new AppError('NOT_READY','Run npm run setup:local to deploy and seed the local EVM, or configure BSC testnet.',503);
 const deployment=JSON.parse(readFileSync(path,'utf8')) as Deployment;
 if(deployment.chainId!==chainId)throw new AppError('WRONG_CHAIN','WRONG_CHAIN: deployment metadata does not match configuration.',503);
 const buyerRole=process.env.ACTIVE_BUYER_ROLE||'rehearsal';
 const buyerKey=key(buyerRole==='judge'?process.env.JUDGE_BUYER_PRIVATE_KEY:process.env.BUYER_PRIVATE_KEY);
 const account=privateKeyToAccount(buyerKey);
 const expected=deployment.buyers[buyerRole]?.address;
 if(!expected||account.address.toLowerCase()!==address(expected).toLowerCase())throw new AppError('NOT_READY','Buyer key does not match the selected deployment wallet.',503);
 const checkoutAddress=address(process.env.CHECKOUT_ADDRESS||deployment.checkoutAddress),tokenAddress=address(process.env.TOKEN_ADDRESS||deployment.tokenAddress);
 if(checkoutAddress.toLowerCase()!==address(deployment.checkoutAddress).toLowerCase()||tokenAddress.toLowerCase()!==address(deployment.tokenAddress).toLowerCase())throw new AppError('NOT_READY','Configured contracts differ from deployment metadata.',503);
 for(const merchant of Object.values(deployment.merchants))address(merchant.address);
 const rpcUrl=process.env.RPC_URL||deployment.rpcUrl;if(!rpcUrl)throw new AppError('NOT_READY','RPC_URL is required.',503);
 const chain=defineChain({id:chainId,name:chainId===97?'BSC testnet':'Local Anvil',nativeCurrency:{name:chainId===97?'Test BNB':'Test Ether',symbol:chainId===97?'tBNB':'ETH',decimals:18},rpcUrls:{default:{http:[rpcUrl]}}});
 return {chainId,rpcUrl,checkoutAddress,tokenAddress,deployment,buyerKey,buyerRole,merchantBKey:process.env.MERCHANT_B_PRIVATE_KEY as Hex|undefined,maxSpend:positive(process.env.MAX_SPEND_UNITS,'300000'),gasCap:positive(process.env.MAX_GAS_WEI,'10000000000000000'),chain};
}
