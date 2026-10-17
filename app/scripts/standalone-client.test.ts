import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { encodeFunctionData, encodeFunctionResult, keccak256, toBytes } from 'viem';
import { expect, it } from 'vitest';
import { checkoutAbi, tokenAbi } from '../shared/abi.js';

it('runs downloaded help and keyless discovery from an empty directory without tsx or node_modules', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'repeat-standalone-test-'));
  const client = path.join(folder, 'repeat-agent.mjs');
  await copyFile(fileURLToPath(new URL('../generated/repeat-agent.mjs', import.meta.url)), client);
  const token = '0x1111111111111111111111111111111111111111';
  const checkout = '0x2222222222222222222222222222222222222222';
  const seller = '0x3333333333333333333333333333333333333333';
  let origin = '';
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const part of request) parts.push(Buffer.from(part));
    response.setHeader('Content-Type', 'application/json');
    const reply = (value: unknown) => response.end(JSON.stringify(value));
    if (request.url === '/api/market/config') {
      reply({ ready: true, chainId: 31337, chainName: 'Local', rpcUrl: origin + '/rpc', nativeSymbol: 'ETH', tokenAddress: token, checkoutAddress: checkout, explorerUrl: '', localFaucet: true, tokenSymbol: 'wBSC', tokenDecimals: 6 }); return;
    }
    if (request.url?.startsWith('/api/market/services?')) {
      reply({ services: [{ id: 'public-report', seller, sku: keccak256(toBytes('public-report')), title: 'Research report', description: 'Ready-made content', category: 'research', basePrice: '50000', spendThreshold: '100000', discountBps: 2000, offerVersion: '1', kind: 'hosted', createdAt: '2026-10-17T00:00:00Z' }] }); return;
    }
    if (request.url === '/rpc') {
      const input = JSON.parse(Buffer.concat(parts).toString()) as { id:number; method:string; params?:{data:string}[] };
      const processRpc = (rpc: typeof input) => {
        if (rpc.method === 'eth_chainId') return { jsonrpc: '2.0', id: rpc.id, result: '0x7a69' };
        if (rpc.method === 'eth_getCode') return { jsonrpc: '2.0', id: rpc.id, result: '0x6000' };
        const selector = rpc.params?.[0]?.data?.slice(0,10);
        if (rpc.method === 'eth_call' && selector === encodeFunctionData({ abi: checkoutAbi, functionName: 'paymentToken' })) return { jsonrpc: '2.0', id: rpc.id, result: encodeFunctionResult({ abi: checkoutAbi, functionName: 'paymentToken', result: token }) };
        if (rpc.method === 'eth_call' && selector === encodeFunctionData({ abi: tokenAbi, functionName: 'decimals' })) return { jsonrpc: '2.0', id: rpc.id, result: encodeFunctionResult({ abi: tokenAbi, functionName: 'decimals', result: 6 }) };
        return { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: 'Unexpected RPC operation' } };
      };
      reply(Array.isArray(input) ? input.map(processRpc) : processRpc(input)); return;
    }
    response.statusCode = 404; reply({ error: 'NOT_FOUND' });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = 'http://127.0.0.1:' + (server.address() as {port:number}).port;
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_PATH: '' }; delete env.MARKET_AGENT_PRIVATE_KEY;
  try {
    const help = await promisify(execFile)(process.execPath, [client, 'help'], { cwd:folder, env, timeout:15000 });
    expect(help.stdout).toContain('Usage: node repeat-agent.mjs');
    const output = await promisify(execFile)(process.execPath, [client, 'discover', '--query', 'research', '--api', origin], { cwd:folder, env, timeout:15000 });
    expect(JSON.parse(output.stdout).services).toMatchObject([{ id:'public-report', title:'Research report' }]);
  } finally { server.close(); await once(server, 'close'); await rm(folder, {recursive:true,force:true}); }
}, 30000);
