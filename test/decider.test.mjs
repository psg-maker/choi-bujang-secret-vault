import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, RULE_IDS } from '../src/decider.mjs';
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
