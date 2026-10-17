import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildAgentClient } = await import(pathToFileURL(path.join(root, 'app/scripts/build-agent-client.mjs')).href);
await buildAgentClient();
const children = [];
function start(name, args, cwd) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('error', (error) => { console.error(name + ': ' + error.message); shutdown(1); });
  child.on('exit', (code, signal) => { if (!stopping && (code || signal)) shutdown(code || 1); });
}
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 250).unref();
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
start('API', ['--watch', '--import', 'tsx', 'server/index.ts'], path.join(root, 'app'));
start('console', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], path.join(root, 'app'));
