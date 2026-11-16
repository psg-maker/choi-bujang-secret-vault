import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readEvents } from '../src/detect.mjs';

test('detect input keeps only at, method and identity.sub', () => {
  const event = { at: '2026-10-01T00:00:00.000Z', method: 'GET', identity: { sub: 'learner_fixture', name: '실명' },
    body: '메모 본문', token: 'secret', network: 'unusual', device: 'x', region: 'foreign' };
  assert.deepEqual(readEvents([event]), [{ at: Date.UTC(2026, 9, 1), method: 'GET', sub: 'learner_fixture' }]);
  // Malformed events are dropped, never filled in.
  assert.deepEqual(readEvents([null, {}, { ...event, at: 'x' }, { ...event, method: 1 },
    { ...event, identity: null }, { ...event, identity: { sub: ' ' } }]), []);
  assert.throws(() => readEvents('x'), /invalid_detection_events/u);
});

test('burst_read flags only one sub with more than 120 GETs inside 10 minutes', async () => {
  const { detect } = await import('../src/detect.mjs');
  const start = Date.UTC(2026, 9, 1);
  const reads = (n, { gap = 2000, sub = 'a', method = 'GET', from = start } = {}) => Array.from({ length: n },
    (_, i) => ({ at: new Date(from + i * gap).toISOString(), method, identity: { sub } }));
  const burst = { action: 'propose_revocation', reasonCode: 'burst_read', subject: 'a' };
  assert.deepEqual(detect(reads(121)), burst);
  assert.deepEqual(detect(reads(121).reverse()), burst);
  for (const events of [[], reads(120), reads(200, { gap: 7000 }), [...reads(100), ...reads(100, { sub: 'b' })],
    reads(200, { method: 'POST' }), [...reads(120), ...reads(1, { from: start + 600000 })]]) {
    assert.deepEqual(detect(events), { action: 'observe' });
  }
  // 121st read just inside the 10-minute window counts.
  assert.deepEqual(detect([...reads(120), ...reads(1, { from: start + 599999 })]), burst);
});
