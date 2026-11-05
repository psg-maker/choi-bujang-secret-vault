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

test('connection inspection preserves fixture provenance and never fills missing evidence', () => {
  const { suspicious } = fixtureRequests();
  assert.deepEqual(inspectConnection(suspicious), {
    source: 'judge_fixture', region: 'foreign', network: 'unusual', hour: 3,
    recentEvents: [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }],
  });
  assert.deepEqual(inspectConnection({ signals: { source: 'judge_fixture' } }), {
    source: 'judge_fixture', region: null, network: null, hour: null, recentEvents: null,
  });
  assert.deepEqual(inspectConnection({ signals: {
    source: 'judge_fixture', region: 1, network: '', hour: '14',
  }, recentEvents: [{ kind: 'risk_signal', ageSeconds: -1, count: 20 }] }), {
    source: 'judge_fixture', region: null, network: null, hour: null, recentEvents: null,
  });
});

test('client headers cannot supply connection evidence or change device decisions', async () => {
  const { normal } = fixtureRequests();
  const headers = { 'x-signal-source': 'judge_fixture', 'x-region': 'local',
    'x-network': 'usual', 'x-hour': '14', 'x-device-registered': 'true' };
  for (const source of [undefined, 'client', 'none']) {
    const request = { ...normal, headers, signals: {
      source, region: 'local', network: 'usual', hour: 14,
    } };
    assert.deepEqual(inspectConnection(request), {
      source: source === 'none' ? 'none' : 'unknown',
      region: null, network: null, hour: null, recentEvents: null,
    });
    assert.deepEqual(await decide(request), await decide(normal));
  }
  assert.equal((await decide({ ...normal, deviceRegistered: false, headers })).decision, 'deny');
});

test('compound fixture reads require step-up while device denial takes priority', async () => {
  const { normal, suspicious } = fixtureRequests();
  assert.equal((await decide(normal)).decision, 'allow');
  assert.deepEqual(await decide(suspicious), {
    schema: 'aleph.decision.v1', requestId: suspicious.requestId,
    decision: 'step_up', reasonCode: 'step_up_required',
    ruleIds: ['device_registered', 'step_up_required'],
  });
  const denied = await decide({ ...suspicious, deviceRegistered: false });
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.reasonCode, 'device_not_registered');
  assert.equal((await decide({ ...suspicious,
    stepUp: { verified: true, authAgeSeconds: 60 },
  })).decision, 'step_up');
});

test('region alone, partial evidence and untrusted sources never trigger the compound rule', async () => {
  const { normal, suspicious } = fixtureRequests();
  for (const request of [
    { ...normal, signals: { ...normal.signals, region: 'foreign' } },
    { ...suspicious, signals: { ...suspicious.signals, hour: 6 } },
    { ...suspicious, signals: { ...suspicious.signals, hour: null } },
    { ...suspicious, signals: { ...suspicious.signals, network: 'usual' } },
    { ...suspicious, signals: { ...suspicious.signals, network: undefined } },
    { ...suspicious, signals: { ...suspicious.signals, source: 'client' } },
    { ...suspicious, recentEvents: undefined },
    { ...suspicious, recentEvents: [{ kind: 'risk_signal', ageSeconds: 61, count: 20 }] },
    { ...suspicious, recentEvents: [{ kind: 'risk_signal', ageSeconds: 60, count: 19 }] },
    { ...suspicious, recentEvents: [{ kind: 'other', ageSeconds: 60, count: 20 }] },
    { ...suspicious, method: 'POST' },
    { ...suspicious, service: 'other' },
  ]) assert.equal((await decide(request)).decision, 'allow');
  for (const hour of [0, 5]) {
    assert.equal((await decide({ ...suspicious, signals: {
      ...suspicious.signals, hour, region: 'local',
    } })).decision, 'step_up');
  }
});
