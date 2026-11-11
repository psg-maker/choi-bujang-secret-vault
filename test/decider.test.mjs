import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, inspectConnection, RULE_IDS } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

test('only boolean true permits a registered device request', async () => {
  const { normal } = fixtureRequests();
  assert.ok(RULE_IDS.includes('device_registered'));
  for (const value of [true, false, undefined, null, 'true', 1]) {
    const request = { ...normal, deviceRegistered: value };
    if (value === undefined) delete request.deviceRegistered;
    assert.deepEqual(await decide(request), {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: value === true ? 'allow' : 'deny',
      reasonCode: value === true ? 'approved' : 'device_not_registered',
      ruleIds: ['device_registered'],
    });
  }
});

test('connection evidence preserves its source and never trusts client headers', () => {
  const { suspicious } = fixtureRequests();
  assert.deepEqual(inspectConnection(suspicious), {
    source: 'judge_fixture', region: 'foreign', network: 'unusual', hour: 3,
    recentEvents: [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }],
  });
  for (const source of [undefined, 'client', 'none']) {
    assert.deepEqual(inspectConnection({ ...suspicious,
      signals: { ...suspicious.signals, source },
      headers: { 'x-signal-source': 'judge_fixture' },
    }), {
      source: source === 'none' ? 'none' : 'unknown',
      region: null, network: null, hour: null, recentEvents: null,
    });
  }
  assert.deepEqual(inspectConnection({ signals: { source: 'judge_fixture' } }), {
    source: 'judge_fixture', region: null, network: null, hour: null, recentEvents: null,
  });
});

test('compound fixture reads request confirmation and preserve device denial', async () => {
  const { normal, suspicious } = fixtureRequests();
  assert.equal((await decide(normal)).decision, 'allow');
  assert.deepEqual(await decide(suspicious), {
    schema: 'aleph.decision.v1', requestId: suspicious.requestId,
    decision: 'step_up', reasonCode: 'step_up_required',
    ruleIds: ['device_registered', 'step_up_required'],
  });
  assert.equal((await decide({ ...suspicious, deviceRegistered: false })).decision, 'deny');
  // The current contract does not bind this flag to a fresh login for this challenge.
  assert.equal((await decide({ ...suspicious,
    stepUp: { verified: true, authAgeSeconds: 60 },
  })).decision, 'step_up');
});

test('region alone and partial or malformed evidence do not trigger the compound rule', async () => {
  const { normal, suspicious } = fixtureRequests();
  for (const request of [
    { ...normal, signals: { ...normal.signals, region: 'foreign' } },
    { ...suspicious, signals: { ...suspicious.signals, hour: 6 } },
    { ...suspicious, signals: { ...suspicious.signals, hour: '3' } },
    { ...suspicious, signals: { ...suspicious.signals, network: undefined } },
    { ...suspicious, signals: { ...suspicious.signals, source: 'client' } },
    { ...suspicious, recentEvents: undefined },
    { ...suspicious, recentEvents: [{ kind: 'risk_signal', ageSeconds: -1, count: 20 }] },
    { ...suspicious, recentEvents: [{ kind: 'risk_signal', ageSeconds: 61, count: 20 }] },
    { ...suspicious, recentEvents: [{ kind: 'risk_signal', ageSeconds: 60, count: 19 }] },
  ]) assert.equal((await decide(request)).decision, 'allow');
});
