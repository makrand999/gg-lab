'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'public/major2/vendor');
fs.mkdirSync(destination, { recursive: true });
const manifest = {};
for (const name of fs.readdirSync(path.join(root, 'public/lib')).filter(name => name.endsWith('.js')).sort()) {
  const source = fs.readFileSync(path.join(root, 'public/lib', name));
  fs.writeFileSync(path.join(destination, name), source);
  manifest[name] = crypto.createHash('sha256').update(source).digest('hex');
}
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Major 2: packaged ' + Object.keys(manifest).length + ' existing engine modules.');
