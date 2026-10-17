import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData, encodeFunctionResult, keccak256, stringToHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { expect, it } from 'vitest';
import { checkoutAbi, tokenAbi } from '../shared/abi.js';
import { MarketAuth } from '../server/market-auth.js';
import { AgentJournal } from './market-agent-lib.js';

it('recovers paid delivery and an existing buy intent when the seller listing is disabled', async () => {
  const key = generatePrivateKey(), buyer = privateKeyToAccount(key).address;
  const seller = '0x3333333333333333333333333333333333333333';
  const checkout = '0x4444444444444444444444444444444444444444';
  const token = '0x5555555555555555555555555555555555555555';
  const serviceId = 'disabled-service', sku = keccak256(stringToHex(serviceId));
  const orderId = `0x${'ac'.repeat(32)}` as const, intentId = 'recover-disabled';
  const auth = new MarketAuth(31337);
  let listingRequests = 0, paymentRequests = 0, deliveries = 0, origin = '';
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const part of request) parts.push(Buffer.from(part));
    const body = parts.length ? JSON.parse(Buffer.concat(parts).toString()) : undefined;
    response.setHeader('Content-Type', 'application/json');
    const reply = (value: unknown) => response.end(JSON.stringify(value));
    if (request.url === '/rpc') {
      const handle = (rpc: {id:number;method:string;params?:{data:string}[]}) => {
        let result: unknown;
        if (rpc.method === 'eth_chainId') result = '0x7a69';
        else if (rpc.method === 'eth_getCode') result = '0x6000';
        else if (rpc.method === 'eth_call') {
          const selector = rpc.params?.[0]?.data?.slice(0, 10);
          if (selector === encodeFunctionData({ abi: checkoutAbi, functionName: 'paymentToken' })) result = encodeFunctionResult({ abi: checkoutAbi, functionName: 'paymentToken', result: token });
          else if (selector === encodeFunctionData({ abi: tokenAbi, functionName: 'decimals' })) result = encodeFunctionResult({ abi: tokenAbi, functionName: 'decimals', result: 6 });
          else result = encodeFunctionResult({ abi: checkoutAbi, functionName: 'orders', result: { merchant: seller, sku, amount: 50000n, offerVersion: 1n } });
        } else { paymentRequests++; result = null; }
        return { jsonrpc: '2.0', id: rpc.id, result };
      };
      reply(Array.isArray(body) ? body.map(handle) : handle(body)); return;
    }
    if (request.url === '/api/market/config') { reply({ ready: true, chainId: 31337, chainName: 'Anvil', rpcUrl: origin + '/rpc', nativeSymbol: 'ETH', tokenAddress: token, checkoutAddress: checkout, explorerUrl: '', localFaucet: true, tokenSymbol: 'wBSC', tokenDecimals: 6 }); return; }
    if (request.url === '/api/auth/challenge') { reply(auth.challenge(body)); return; }
    if (request.url === '/api/auth/verify') { reply(await auth.verify(body)); return; }
    if (request.url === `/api/market/services/${serviceId}/deliver`) {
      auth.session(request.headers.authorization); deliveries++;
      reply({ serviceId, orderId, buyer, seller, amount: '50000', response: 'Already paid content', deliveredAt: new Date().toISOString() }); return;
    }
    listingRequests++; response.statusCode = 404; reply({ error: 'NOT_FOUND', message: 'Seller disabled this offer.' });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const journal = new AgentJournal(path.join(app, 'data'), { chainId: 31337, checkout, buyer });
  try {
    await journal.append({ event: 'intent', intentId, serviceId, orderId, seller, sku, amount: '50000', maxSpend: '60000', offerVersion: '1', deadline: '1' });
    await journal.append({ event: 'paid', intentId });
    const run = async (args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/market-agent.ts', ...args, '--api', origin], {
      cwd: app, env: { ...process.env, MARKET_AGENT_PRIVATE_KEY: key }, timeout: 15000,
    })).stdout);
    expect((await run(['deliver', '--service', serviceId, '--order', orderId])).response).toBe('Already paid content');
    const recovered = await run(['buy', '--service', serviceId, '--max-spend', '0.06', '--intent', intentId]);
    expect(recovered.recovered).toBe(true);
    expect(recovered.delivery.orderId).toBe(orderId);
    expect(deliveries).toBe(2);
    expect(listingRequests).toBe(0);
    expect(paymentRequests).toBe(0);
  } finally { server.close(); await once(server, 'close'); await rm(journal.file, { force: true }); }
}, 30000);
