// Independent reader: no server imports, journal, dotenv or signing keys.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, keccak256, stringToHex, parseAbi, isAddress, formatUnits } from 'viem';
import { foundry, bscTestnet } from 'viem/chains';
import type { Deployment } from './deploy.js';
const args = process.argv.slice(2);
const arg = (name: string) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
const chainId = Number(arg('--chain') || '31337');
if (![97, 31337].includes(chainId)) throw new Error('Only --chain97 and --chain31337 are supported.');
const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await readFile(path.join(app, 'deployments', chainId + '.json'), 'utf8')) as Deployment;
const buyer = arg('--buyer') || metadata.buyers.rehearsal.address;
if (!isAddress(buyer)) throw new Error('Provide a valid --buyer address.');
const recordId = arg('--record') || 'bnb-budget';
if (!['bnb-agents','bnb-identity','bnb-commerce','bnb-budget'].includes(recordId)) throw new Error('Unknown record.');
const client = createPublicClient({ chain: chainId === 97 ? bscTestnet : foundry, transport: http(arg('--rpc') || metadata.rpcUrl) });
if (await client.getChainId() !== chainId) throw new Error('WRONG_CHAIN');
const abi = parseAbi(['function preview(address buyer,address merchant,bytes32 sku) view returns (uint256 price,uint16 appliedBps,uint256 priorPaid,uint256 purchaseCount,uint64 offerVersion)']);
const blockNumber = await client.getBlockNumber();
const quotes = [];
for (const [id, merchant] of Object.entries(metadata.merchants)) {
  const [price, bps, paid, count, version] = await client.readContract({ address: metadata.checkoutAddress, abi, functionName:'preview', args:[buyer, merchant.address, keccak256(stringToHex(recordId))], blockNumber });
  quotes.push({ id, merchant: merchant.name, address:merchant.address, price:formatUnits(price,6), discountPercent:bps/100, priorPaid:formatUnits(paid,6), purchases:count.toString(), offerVersion:version.toString() });
}
console.log(JSON.stringify({ reader:'independent RPC reader',chainId,blockNumber:blockNumber.toString(),buyer,recordId,quotes }, null, 2));
