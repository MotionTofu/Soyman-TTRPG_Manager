import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCatalog } from './app/catalog.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--catalog')) throw Error('Usage: node package-server.mjs [--catalog path/to/catalog.json]');
// Validate the explicitly selected public catalog before building; never copy private/.
const catalog = args.length ? parseCatalog(JSON.parse(await readFile(path.resolve(args[1]), 'utf8'))) : null;
const result = spawnSync(process.execPath, ['run-app.mjs', '--build'], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) throw Error('Site build failed');
const name = `soyman-server-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const directory = path.join(root, 'releases', name);
await mkdir(directory, { recursive: true });
await cp(path.join(root, 'deploy'), directory, { recursive: true });
await cp(path.join(root, 'app-dist'), path.join(directory, 'site'), { recursive: true });
await cp(path.join(root, 'DEPLOY.md'), path.join(directory, 'README.md'));
await writeFile(path.join(directory, 'site/server-config.json'), JSON.stringify({ catalog: catalog ? '/catalog.json' : null }));
if (catalog) await writeFile(path.join(directory, 'site/catalog.json'), JSON.stringify(catalog));
const archive = path.join(root, 'releases', `${name}.tar.gz`);
const packed = spawnSync('tar', ['-czf', archive, '-C', directory, '.'], { stdio: 'inherit' });
if (packed.status !== 0) throw Error(`Archive failed; ready directory: ${directory}`);
console.log(`Server package: ${archive}`);
