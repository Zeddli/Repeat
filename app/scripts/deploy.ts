import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, parseAbi, parseAbiItem, type Address, type Hex } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { foundry, bscTestnet } from 'viem/chains';
import dotenv from 'dotenv';
import { assertLocalEnvironmentSafe, testnetSigningKey, assertDistinctRoles } from './deployment-safety.js';
import type { RecordId } from '../shared/types.js';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(app);
const mnemonic = 'test test test test test test test test test test test junk';
const records = ['bnb-agents', 'bnb-identity', 'bnb-commerce', 'bnb-budget'] as const;
const tokenAbi = parseAbi([
  'function mint(address to,uint256 amount)',
  'function approve(address spender,uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)'
]);
const checkoutAbi = parseAbi([
  'function setOffer(bytes32 sku,uint256 basePrice,uint256 spendThreshold,uint16 discountBps,bool enabled)',
  'function checkout(address merchant,bytes32 sku,bytes32 orderId,uint256 maxAmount,uint64 expectedVersion,uint256 deadline)',
  'function offer(address merchant,bytes32 sku) view returns ((uint256 basePrice,uint256 spendThreshold,uint16 discountBps,uint64 version,bool enabled))',
  'function loyaltyScope() pure returns (bytes32)',
  'function stats(address buyer,address merchant,bytes32 sku) view returns ((uint256 paid,uint256 purchaseCount))',
  'function orders(address buyer,bytes32 orderId) view returns ((address merchant,bytes32 sku,uint256 amount,uint64 offerVersion))'
]);
export type Deployment = {
  loyaltyScope?: 'service'; previousCheckoutAddress?: Address; previousDeploymentBlock?: string; previousCreatedAt?: string;
  chainId: number; rpcUrl: string; checkoutAddress: Address; tokenAddress: Address;
  deploymentBlock: string; createdAt: string;
  merchants: Record<'a'|'b', { address: Address; name: string }>;
  buyers: Record<'rehearsal'|'judge'|'fresh', { address: Address }>;
  warmupOrders: Array<{ buyerRole: string; buyer: Address; merchant: Address; recordId: RecordId; orderId: Hex; transactionHash: Hex }>;
};
export async function deployDemo({ local = false, force = false }: { local?: boolean; force?: boolean } = {}) {
  if (local) {
    let existing = '';
    try { existing = await readFile(path.join(app, '.env.local'), 'utf8'); } catch {}
    assertLocalEnvironmentSafe(existing);
  }
  dotenv.config({ path: path.join(app, '.env.local'), quiet: true });
  const chain = local ? foundry : bscTestnet;
  const rpcUrl = local ? 'http://127.0.0.1:8545' : process.env.RPC_URL;
  if (!rpcUrl) throw new Error('Set RPC_URL and disposable funded keys in app/.env.local first.');
  if (!local && process.env.CHAIN_ID !== '97') throw new Error('Testnet deployment requires CHAIN_ID=97. No mainnet deployment path exists.');
  const localAccount = (index: number) => mnemonicToAccount(mnemonic, { addressIndex: index });
  function key(name: string, index: number) {
    if (local) return localAccount(index);
    return privateKeyToAccount(testnetSigningKey(process.env[name], name));
  }
  const deployer = key('DEPLOYER_PRIVATE_KEY', 0);
  const rehearsal = key('BUYER_PRIVATE_KEY', 1);
  const judge = key('JUDGE_BUYER_PRIVATE_KEY', 2);
  const merchantA = key('MERCHANT_A_PRIVATE_KEY', 3);
  const merchantB = key('MERCHANT_B_PRIVATE_KEY', 4);
  assertDistinctRoles({deployer:deployer.address,rehearsal:rehearsal.address,judge:judge.address,merchantA:merchantA.address,merchantB:merchantB.address});
  const fresh = localAccount(5).address;
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl), pollingInterval: local ? 250 : 3000 });
  if (await publicClient.getChainId() !== chain.id) throw new Error('WRONG_CHAIN: RPC does not match the selected chain.');
  const wallet = (account: typeof deployer) => createWalletClient({ account, chain, transport: http(rpcUrl) });
  const wait = async (hash: Hex) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: local ? 1 : 2 });
    if (receipt.status !== 'success') throw new Error('Transaction reverted: ' + hash);
    return receipt;
  };
  await mkdir(path.join(app, 'deployments'), { recursive: true });
  const metadataPath = path.join(app, 'deployments', chain.id + '.json');
  let deployment: Deployment | undefined;
  if (!force) {
    try {
      const saved = JSON.parse(await readFile(metadataPath, 'utf8')) as Deployment;
      if (await publicClient.getBytecode({ address: saved.checkoutAddress })) deployment = saved;
    } catch {}
  }
  if (!deployment) {
    const token = JSON.parse(await readFile(path.join(root, 'contracts/out/MockWBSC.sol/MockWBSC.json'), 'utf8'));
    const checkout = JSON.parse(await readFile(path.join(root, 'contracts/out/LoyaltyCheckout.sol/LoyaltyCheckout.json'), 'utf8'));
    const tokenReceipt = await wait(await wallet(deployer).deployContract({ abi: token.abi, bytecode: token.bytecode.object as Hex }));
    if (!tokenReceipt.contractAddress) throw new Error('Token deployment returned no address.');
    const checkoutReceipt = await wait(await wallet(deployer).deployContract({ abi: checkout.abi, bytecode: checkout.bytecode.object as Hex, args: [tokenReceipt.contractAddress] }));
    if (!checkoutReceipt.contractAddress) throw new Error('Checkout deployment returned no address.');
    deployment = {
      loyaltyScope: 'service', chainId: chain.id, rpcUrl, tokenAddress: tokenReceipt.contractAddress, checkoutAddress: checkoutReceipt.contractAddress,
      deploymentBlock: checkoutReceipt.blockNumber.toString(), createdAt: new Date().toISOString(),
      merchants: { a: { address: merchantA.address, name: 'Atlas Research' }, b: { address: merchantB.address, name: 'Beacon Data' } },
      buyers: { rehearsal: { address: rehearsal.address }, judge: { address: judge.address }, fresh: { address: fresh } }, warmupOrders: []
    };
    await writeFile(metadataPath, JSON.stringify(deployment, null, 2));
  } else {
    if (deployment.merchants.a.address.toLowerCase() !== merchantA.address.toLowerCase() ||
        deployment.merchants.b.address.toLowerCase() !== merchantB.address.toLowerCase() ||
        deployment.buyers.rehearsal.address.toLowerCase() !== rehearsal.address.toLowerCase() ||
        deployment.buyers.judge.address.toLowerCase() !== judge.address.toLowerCase()) {
      throw new Error('Configured wallets differ from saved deployment. Select correct configuration; do not silently replace history.');
    }
  }
  const scope = await publicClient.readContract({ address: deployment.checkoutAddress, abi: checkoutAbi, functionName:'loyaltyScope' }).catch(() => undefined);
  if (scope !== keccak256(stringToHex('repeat:service-loyalty:v2'))) throw new Error('Saved checkout uses seller-wide loyalty. Run upgrade:loyalty on local chain before seeding.');
  const save = () => writeFile(metadataPath, JSON.stringify(deployment, null, 2));
  const storeWarmup = async (item: Deployment['warmupOrders'][number]) => {
    const index = deployment!.warmupOrders.findIndex(order => order.orderId === item.orderId && order.buyer.toLowerCase() === item.buyer.toLowerCase());
    if (index === -1) deployment!.warmupOrders.push(item);
    else deployment!.warmupOrders[index] = item;
    await save();
  };
  const orderPaidEvent = parseAbiItem('event OrderPaid(address indexed buyer,address indexed merchant,bytes32 indexed orderId,bytes32 sku,uint256 basePrice,uint256 amount,uint16 appliedBps,uint256 priorPaid,uint256 newPaid,uint64 offerVersion)');
  for (const [merchant, price, discount] of [[merchantA, 50000n, 2000], [merchantB, 55000n, 0]] as const) {
    for (const recordId of records) {
      const sku = keccak256(stringToHex(recordId));
      const offer = await publicClient.readContract({ address: deployment.checkoutAddress, abi: checkoutAbi, functionName: 'offer', args: [merchant.address, sku] });
      if (offer.version === 0n) {
        await wait(await wallet(merchant).writeContract({ address: deployment.checkoutAddress, abi: checkoutAbi, functionName: 'setOffer', args: [sku, price, 150000n, discount, true] }));
      }
    }
  }
  for (const [role, buyer] of [['rehearsal', rehearsal], ['judge', judge]] as const) {
    const balance = await publicClient.readContract({ address: deployment.tokenAddress, abi: tokenAbi, functionName: 'balanceOf', args: [buyer.address] });
    if (balance < 300000n) await wait(await wallet(deployer).writeContract({ address: deployment.tokenAddress, abi: tokenAbi, functionName: 'mint', args: [buyer.address, 1000000n] }));
    await wait(await wallet(buyer).writeContract({ address: deployment.tokenAddress, abi: tokenAbi, functionName: 'approve', args: [deployment.checkoutAddress, 300000n] }));
    for (const [seedIndex, recordId] of (['bnb-budget','bnb-budget','bnb-budget'] as const).entries()) {
      const orderId = keccak256(stringToHex('repeat-setup:' + chain.id + ':' + role + ':' + recordId + ':service-v2:' + seedIndex));
      const order = await publicClient.readContract({ address: deployment.checkoutAddress, abi: checkoutAbi, functionName: 'orders', args: [buyer.address, orderId] });
      if (order.amount > 0n) {
        if (!deployment.warmupOrders.some(item=>item.orderId===orderId && item.buyer.toLowerCase()===buyer.address.toLowerCase())) {
          const logs = await publicClient.getLogs({address:[deployment.checkoutAddress,...(deployment.previousCheckoutAddress?[deployment.previousCheckoutAddress]:[])],event:orderPaidEvent,args:{buyer:buyer.address,orderId},fromBlock:BigInt(deployment.previousDeploymentBlock??deployment.deploymentBlock)});
          const log = logs.at(-1);
          if (!log) throw new Error('Paid setup order exists but its receipt cannot yet be recovered. Retry after RPC indexing catches up.');
          await storeWarmup({buyerRole:role,buyer:buyer.address,merchant:merchantA.address,recordId,orderId,transactionHash:log.transactionHash});
        }
        continue;
      }
      const sku = keccak256(stringToHex(recordId));
      const offer = await publicClient.readContract({ address: deployment.checkoutAddress, abi: checkoutAbi, functionName: 'offer', args: [merchantA.address, sku] });
      const deadline = (await publicClient.getBlock()).timestamp + 120n;
      const hash = await wallet(buyer).writeContract({ address: deployment.checkoutAddress, abi: checkoutAbi, functionName: 'checkout', args: [merchantA.address, sku, orderId, 50000n, offer.version, deadline] });
      await storeWarmup({ buyerRole: role, buyer: buyer.address, merchant: merchantA.address, recordId, orderId, transactionHash: hash });
      await wait(hash);
    }
  }
  if (local) {
    let current = '';
    try { current = await readFile(path.join(app, '.env.local'), 'utf8'); } catch {}
    const preserved = current.split('\n').filter((line) => /^(ANTHROPIC_API_KEY|LLM_MODEL)=/.test(line)).join('\n');
    const privateKey = (index: number) => localAccount(index).getHdKey().privateKey!;
    const hexKey = (index: number) => '0x' + Buffer.from(privateKey(index)).toString('hex');
    const env = [
      '# Disposable Anvil development keys only. Never use these on a public network.',
      'CHAIN_ID=31337', 'RPC_URL=' + rpcUrl,
      'CHECKOUT_ADDRESS=' + deployment.checkoutAddress, 'TOKEN_ADDRESS=' + deployment.tokenAddress,
      'DEPLOYER_PRIVATE_KEY=' + hexKey(0), 'BUYER_PRIVATE_KEY=' + hexKey(1), 'JUDGE_BUYER_PRIVATE_KEY=' + hexKey(2),
      'MERCHANT_A_PRIVATE_KEY=' + hexKey(3), 'MERCHANT_B_PRIVATE_KEY=' + hexKey(4),
      'ACTIVE_BUYER_ROLE=rehearsal', 'MAX_SPEND_UNITS=300000', 'API_HOST=127.0.0.1', 'API_PORT=3001', preserved, ''
    ].join('\n');
    await writeFile(path.join(app, '.env.local'), env, { mode: 0o600 });
  }
  console.log(JSON.stringify({ chainId: chain.id, checkoutAddress: deployment.checkoutAddress, tokenAddress: deployment.tokenAddress, warmupReceipts: deployment.warmupOrders.length }, null, 2));
  return deployment;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await deployDemo({ local: process.argv.includes('--local'), force: process.argv.includes('--new-deployment') });
}
