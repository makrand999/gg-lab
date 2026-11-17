#!/usr/bin/env node
'use strict';


var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var kernel = require(path.join(root, 'public/lib/educad-kernel.js'));
var manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/lib/educad-api.json'), 'utf8'));
var pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
var failures = [];

function fail(message) { failures.push(message); }

if (kernel.apiVersion !== manifest.apiVersion)
  fail('apiVersion mismatch: kernel ' + kernel.apiVersion + ', manifest ' + manifest.apiVersion);
if (kernel.version !== pkg.version)
  fail('version mismatch: kernel ' + kernel.version + ', package ' + pkg.version);
if (!kernel.contracts || typeof kernel.contracts !== 'object')
  fail('kernel has no contracts map');
manifest.contracts.forEach(function (contract) {
  var values = kernel.contracts && typeof kernel.contracts === 'object' ?
    Object.keys(kernel.contracts).map(function (key) { return kernel.contracts[key]; }) : [];
  if (values.indexOf(contract) === -1)
    fail('missing contract ' + contract);
});
Object.keys(manifest.modules).forEach(function (name) {
  var api = kernel[name];
  if (!api) { fail('missing module ' + name); return; }
  manifest.modules[name].forEach(function (member) {
    if (typeof api[member] !== 'function')
      fail('missing export ' + name + '.' + member);
  });
});
if (!kernel.capabilities || !Array.isArray(kernel.capabilities.surfaces))
  fail('kernel has no capability list');

if (failures.length) {
  failures.forEach(function (message) { console.error('api: ' + message); });
  process.exit(1);
}
console.log('api: ' + Object.keys(manifest.modules).length + ' modules, ' +
  manifest.contracts.length + ' contracts, version ' + kernel.version + ' — OK');
