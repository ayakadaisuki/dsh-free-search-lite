import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

const portable = path => path.replaceAll('\\', '/');
const licenseFile = /^(licen[cs]e|copying|notice)([._-]|$)/i;

export async function writeNotices(root, metafile, legalComments = '') {
  if (!metafile?.outputs) throw new Error('License inventory requires the current esbuild metafile');
  root = resolve(root);
  const packages = new Map();
  const owners = new Map();
  async function owner(directory) {
    if (directory === root || dirname(directory) === directory) return null;
    if (owners.has(directory)) return owners.get(directory);
    let pkg;
    try {
      pkg = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    // Some packages have type-only package.json files inside cjs/esm directories.
    const found = pkg?.name && pkg?.version ? { directory, pkg } : await owner(dirname(directory));
    owners.set(directory, found);
    return found;
  }
  // Output contributions, not the dependency graph: exclude tree-shaken inputs.
  const inputs = new Set(Object.values(metafile.outputs).flatMap(output =>
    Object.entries(output.inputs ?? {}).filter(([, info]) => info.bytesInOutput > 0).map(([path]) => path)));
  for (const input of [...inputs].sort()) {
    const source = resolve(root, input);
    const found = await owner(dirname(source));
    if (!found) continue;
    if (!packages.has(found.directory)) packages.set(found.directory, { ...found, directories: new Set() });
    const entry = packages.get(found.directory);
    // Preserve licenses for vendored subtrees as well as the package-root license.
    for (let directory = dirname(source); ; directory = dirname(directory)) {
      entry.directories.add(directory);
      if (directory === found.directory) break;
    }
  }
  if (!packages.size) throw new Error('No bundled third-party packages found');
  const notices = ['# Third-party notices', '',
    'Generated from the current esbuild output contributions. Each installed package path is inventoried separately, including nested versions. Build-only dependencies are not included. Package and applicable subtree license/notice files are reproduced below.', '',
    '## free-search-mcp 0.13.1', '', 'Upstream: https://github.com/sweetcornna/free-search-mcp', '',
    await readFile(resolve(root, 'legal/free-search-mcp-LICENSE'), 'utf8')];
  let apache = false;
  for (const { directory, pkg, directories } of [...packages.values()].sort((a, b) =>
    portable(relative(root, a.directory)).localeCompare(portable(relative(root, b.directory)), 'en'))) {
    notices.push(`\n## ${pkg.name} ${pkg.version}\n`,
      `Bundled package path: \`${portable(relative(root, directory))}\`\n`,
      `Declared license: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? 'unspecified')}\n`);
    apache ||= /Apache-2\.0/i.test(JSON.stringify(pkg.license));
    let rootLicense = false;
    for (const folder of [...directories].sort()) {
      const files = (await readdir(folder, { withFileTypes: true }))
        .filter(file => file.isFile() && licenseFile.test(file.name)).map(file => file.name).sort();
      for (const file of files) {
        rootLicense ||= folder === directory && /^(licen[cs]e|copying)/i.test(file);
        const text = await readFile(resolve(folder, file), 'utf8');
        if (!text.trim()) throw new Error(`Empty license/notice: ${resolve(folder, file)}`);
        apache ||= /Apache License,?\s+(?:Version\s+)?2\.0/i.test(text);
        notices.push(`### ${portable(relative(directory, resolve(folder, file)))}\n`, text);
      }
    }
    if (!rootLicense) throw new Error(`Missing package license text: ${directory}`);
  }
  if (apache) notices.push('\n## Apache License 2.0 — full text\n',
    'Source: https://www.apache.org/licenses/LICENSE-2.0.txt\n',
    await readFile(resolve(root, 'legal/Apache-2.0.txt'), 'utf8'));
  if (legalComments.trim()) {
    notices.push('\n## Embedded source notices retained by esbuild\n', '```text\n' + legalComments.trimEnd() + '\n```');
    for (const [marker, name, source] of [
      ['formdata-polyfill.', 'formdata-polyfill', 'https://github.com/jimmywarting/FormData/blob/master/LICENSE'],
      ['ws. MIT License.', 'ws', 'https://github.com/websockets/ws/blob/master/LICENSE'],
    ]) {
      if (legalComments.includes(marker)) notices.push(`\n### ${name} — full MIT license for embedded code\n`,
        `Source: ${source}\n`, await readFile(resolve(root, `legal/${name}-LICENSE`), 'utf8'));
    }
  }
  await writeFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), notices.join('\n').trimEnd() + '\n', 'utf8');
  return packages.size;
}
