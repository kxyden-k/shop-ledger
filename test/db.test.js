const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { createStore, SCHEMA } = require('../db');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'));

test('fresh install gives blank data', () => {
  assert.equal(createStore(tmp()).load().data.v, SCHEMA);
});
test('save then load round-trips', () => {
  const s = createStore(tmp()), d = s.load().data;
  d.products.push({ id: 1, name: 'A' }); s.save(d);
  assert.equal(s.load().data.products[0].name, 'A');
  assert.equal(fs.existsSync(s.file + '.tmp'), false);
});
test('corrupt file falls back to the last backup', () => {
  const s = createStore(tmp()), d = s.load().data;
  d.products.push({ id: 1, name: 'A' }); s.save(d);
  d.cur = '$'; s.save(d);
  fs.writeFileSync(s.file, '{broken');
  const r = s.load();
  assert.ok(r.from.includes('backups'));
  assert.equal(r.data.products.length, 1);
});
test('old unversioned data is upgraded and keeps its records', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ products: [{ id: 1 }], orders: [], expenses: [], cur: 'R', n: 2 }));
  const r = createStore(dir).load();
  assert.equal(r.data.v, SCHEMA); assert.equal(r.data.products.length, 1);
});
test('data from a newer app is refused, not overwritten', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ v: SCHEMA + 1, products: [], orders: [] }));
  assert.throws(() => createStore(dir).load(), /newer version/);
});
