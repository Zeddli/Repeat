import { build } from 'esbuild';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../', import.meta.url));
export async function buildAgentClient() {
  const outfile = path.join(app, 'generated', 'repeat-agent.mjs');
  const result = await build({
    entryPoints: [path.join(app, 'scripts', 'market-agent.ts')],
    outfile, bundle: true, packages: 'bundle', platform: 'node', format: 'esm',
    target: 'node22', minify: true, sourcemap: false, legalComments: 'eof',
    metafile: true, write: false,
    banner: { js: '// Repeat standalone agent client. Node.js 22.12+; no npm install required.\nimport { createRequire as repeatCreateRequire } from "node:module"; const require = repeatCreateRequire(import.meta.url);' },
  });
  const dependencies = Object.values(result.metafile.outputs).flatMap(output => output.imports).filter(item => item.external && !isBuiltin(item.path));
  if (dependencies.length) throw new Error('Standalone client has unbundled dependencies: ' + dependencies.map(item => item.path).join(', '));
  const output = result.outputFiles.find(file => file.path.endsWith('.mjs'));
  if (!output) throw new Error('Agent bundle was not generated.');
  await mkdir(path.dirname(outfile), { recursive: true });
  const temporary = outfile + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, output.contents);
  await rename(temporary, outfile);
  const manifest = { filename: 'repeat-agent.mjs', bytes: output.contents.length, sha256: createHash('sha256').update(output.contents).digest('hex'), node: '>=22.12', externalPackages: [] };
  await writeFile(path.join(app, 'generated', 'repeat-agent.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await buildAgentClient()));
