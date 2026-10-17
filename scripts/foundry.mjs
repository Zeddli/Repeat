import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [tool,...args]=process.argv.slice(2);
if(!['forge','anvil'].includes(tool)) { console.error('Choose forge or anvil.'); process.exit(2); }
const arch=process.arch==='x64'?'amd64':process.arch;
const executable=path.join(root,'node_modules','@foundry-rs',tool+'-'+process.platform+'-'+arch,'bin',tool+(process.platform==='win32'?'.exe':''));
const result=spawnSync(executable,args,{cwd:root,stdio:'inherit',env:process.env});
if(result.error){console.error('Could not run local '+tool+': '+result.error.message);process.exit(1);}
process.exit(result.status??1);
