import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http } from 'viem';
import { foundry } from 'viem/chains';
import { deployDemo } from './deploy.js';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(app);
const publicClient = createPublicClient({ chain: foundry, transport: http('http://127.0.0.1:8545') });
await mkdir(path.join(root, '.runtime'), { recursive: true });
let alive = false;
try {
  const chainId = await publicClient.getChainId();
  if (chainId !== 31337) throw new Error('Port8545 serves a different chain. Stop it or select a different local RPC.');
  alive = true;
} catch (error) {
  if (error instanceof Error && error.message.includes('different chain')) throw error;
}
if (!alive) {
  const log = await open(path.join(root, '.runtime/anvil.log'), 'a');
  const child = spawn(process.execPath, [
    path.join(root, 'node_modules/@foundry-rs/anvil/bin.mjs'),
    '--host', '127.0.0.1', '--port', '8545', '--chain-id', '31337', '--block-time', '1', '--silent'
  ], { cwd: root, detached: true, stdio: ['ignore', log.fd, log.fd] });
  child.unref();
  await writeFile(path.join(root, '.runtime/anvil.pid'), String(child.pid));
  await log.close();
  for (let i = 0; i < 40; i++) {
    try { if (await publicClient.getChainId() === 31337) { alive = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!alive) throw new Error('Anvil did not start; inspect .runtime/anvil.log.');
}
const build = spawnSync(process.execPath, [path.join(root, 'scripts/foundry.mjs'), 'forge', 'build', '--root', 'contracts'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) throw new Error('Contract compilation failed.');
await deployDemo({ local: true, force: process.argv.includes('--new-deployment') });
console.log('Local EVM ready. Next: npm run dev (from project root).');
