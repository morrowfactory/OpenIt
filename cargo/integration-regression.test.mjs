import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Script } from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('all inline planner scripts parse', () => {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!match[1].includes('src=')) new Script(match[2]);
  }
});

test('browser separates pallet deck thickness from loaded height', () => {
  assert.match(html, /\.\.\.palletSafetyFromForm\(\),maxH:/);
  const builder = html.slice(html.indexOf('function cargoInputFromForm'), html.indexOf('function acceptCargoResult'));
  assert.doesNotMatch(builder, /h:\+document\.getElementById\('palletH'\)/);
});

test('unknown top-load capacity stays blank when restoring legacy snapshots', () => {
  assert.match(html, /products=snapshot\.products\.map\(product=>\(\{group:1,stackable:true,maxLayers:99,maxTopKg:null/);
});

test('viewer bundle no longer contains an obsolete second packing algorithm', () => {
  const source = readFileSync(new URL('./assets/index-D5jndoPs.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /window\.cargoSolver|const gl =/);
  assert.match(source, /window\.cargoViewer/);
});

test('async calculation freezes inputs and saves its captured configuration', () => {
  assert.match(html, /locked\.forEach\(\(\[element\]\)=>element\.disabled=true\)/);
  assert.match(html, /persistCargoSnapshot\(\{\.\.\.snapshot,result:window\.latestCargoAudit\}\)/);
  assert.match(html, /runCargoPlan\(input/);
  assert.doesNotMatch(html, /await solvePlan\(input\)/);
});
