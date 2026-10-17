import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Deployment } from './deploy.js';

let apiUnavailable=false;
try { await fetch('http://127.0.0.1:3001/api/state',{signal:AbortSignal.timeout(1000)}); } catch { apiUnavailable=true; }
assert.equal(apiUnavailable,true,'Stop the API to prove reader independence.');
const app=fileURLToPath(new URL('../',import.meta.url));
const metadata=JSON.parse(await readFile(path.join(app,'deployments/31337.json'),'utf8')) as Deployment;
const results=[];
for(const role of ['rehearsal','fresh'] as const){
 const run=spawnSync(process.execPath,['--import','tsx','scripts/quote.ts','--chain','31337','--buyer',metadata.buyers[role].address,'--record','bnb-budget'],{cwd:app,encoding:'utf8',env:{...process.env,BUYER_PRIVATE_KEY:'intentionally-unavailable'}});
 assert.equal(run.status,0,run.stderr);
 const quote=JSON.parse(run.stdout);
 assert.equal(quote.quotes.find((q:{id:string})=>q.id==='a').price,role==='fresh'?'0.05':'0.04');
 assert.equal(quote.quotes.find((q:{id:string})=>q.id==='b').price,'0.045');
 results.push({role,...quote});
}
await mkdir(new URL('../../evidence/',import.meta.url),{recursive:true});
await writeFile(new URL('../../evidence/independent-quotes.json',import.meta.url),JSON.stringify(results,null,2));
console.log('PASS: with API stopped and no usable signing key, independent RPC reader preserves returning price and fresh-wallet isolation.');
