import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeNotices } from './licenses.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  absWorkingDir: root, entryPoints: ['src/index.mjs'], outfile: 'lib/index.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node24', minify: true,
  legalComments: 'linked', metafile: true, write: false,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
const legalComments = result.outputFiles.find(file => file.path.endsWith('.LEGAL.txt'))?.text ?? '';
const count = await writeNotices(root, result.metafile, legalComments);
for (const file of result.outputFiles) {
  await mkdir(dirname(file.path), { recursive: true });
  await writeFile(file.path, file.contents);
}
console.log(`Built lib/index.js with ${count} bundled package paths; license inventory verified.`);
