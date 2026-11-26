import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkWrangler } from '../../scripts/check-wrangler.mjs';
test('all Wrangler environments explicitly bind assets and their own SQLite classes with distinct media namespaces', () => {
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  assert.equal(checkWrangler(config).length, 3);
  for (const corrupt of [value => { value.env.staging.vars.LIVEKIT_ROOM_NAMESPACE = 'production'; }, value => { value.env.staging.durable_objects.bindings[0].script_name = 'watchly-production'; }, value => { delete value.env.staging.assets; }]) {
    const copy = structuredClone(config); corrupt(copy); assert.throws(() => checkWrangler(copy));
  }
  assert.match(readFileSync('render.yaml', 'utf8'), /LIVEKIT_ROOM_NAMESPACE\s+value: legacy-render/);
});
