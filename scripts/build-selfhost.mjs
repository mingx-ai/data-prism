import {build} from 'esbuild';
import {mkdir,cp} from 'node:fs/promises';
import {resolve} from 'node:path';
await mkdir('dist-selfhost',{recursive:true});
await build({entryPoints:['selfhost/server.ts'],outfile:'dist-selfhost/server.mjs',bundle:true,platform:'node',target:'node22',format:'esm',alias:{'cloudflare:workers':resolve('selfhost/runtime.ts'),'next/server':resolve('selfhost/runtime.ts')},external:['node:sqlite']});
await cp('drizzle','dist-selfhost/drizzle',{recursive:true});
