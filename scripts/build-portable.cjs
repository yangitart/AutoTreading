const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(root, 'release', `LLM-Trader-${stamp}`);
if (fs.existsSync(output)) throw new Error('El destino ya existe.');
fs.cpSync(path.join(root, 'node_modules/electron/dist'), output, { recursive: true, errorOnExist: true });
fs.renameSync(path.join(output, 'electron.exe'), path.join(output, 'LLM Trader.exe'));
const app = path.join(output, 'resources/app');
fs.mkdirSync(app, { recursive: true });
fs.cpSync(path.join(root, 'src'), path.join(app, 'src'), { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(app, 'package.json'));
function inventory(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? inventory(path.join(dir,e.name)) : [path.join(dir,e.name)]); }
const hashes = Object.fromEntries(inventory(path.join(app,'src')).sort().map(file => [path.relative(app,file),crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
fs.writeFileSync(path.join(output,'build-info.json'), JSON.stringify({ builtAt:new Date().toISOString(), version:require('../package.json').version, hashes },null,2));
console.log(path.join(output, 'LLM Trader.exe'));
