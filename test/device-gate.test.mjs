import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeviceGate } from '../public/device-gate.mjs';

function screen() {
  const node = () => ({ textContent: '', hidden: false, disabled: false, children: [],
    replaceChildren(...n) { this.children = n; }, addEventListener(type, fn) { this[type] = fn; } });
  const elements = Object.fromEntries(['device-gate', 'device-status', 'device-error', 'device-register', 'device-check', 'notes']
    .map(id => [id, node()]));
  return { elements, document: { getElementById: id => elements[id], createElement: node } };
}
const buffer = text => new TextEncoder().encode(text).buffer;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('vault stays locked until the server approves; the request button alone opens nothing', async () => {
  const { elements, document } = screen();
  const views = [];
  let approved = false;
  const server = async (path) => {
    if (path === '/api/device/challenge') return Response.json({ challenge: 'c', rpId: 'vault.test', userId: 'u', credentialIds: ['AQID'] });
    if (path === '/api/device/register') return Response.json({ status: 'pending' }, { status: 201 });
    return approved ? Response.json({ status: 'approved', deviceToken: 'device-token-value', expiresInSeconds: 900 })
      : Response.json({ error: 'DEVICE_NOT_APPROVED', status: 'pending' }, { status: 403 });
  };
  const credentials = {
    create: async () => ({ rawId: buffer('id'), response: { clientDataJSON: buffer('{}'), getAuthenticatorData: () => buffer('a'),
      getPublicKey: () => buffer('k'), getPublicKeyAlgorithm: () => -7 } }),
    get: async () => ({ rawId: buffer('id'), response: { clientDataJSON: buffer('{}'), authenticatorData: buffer('a'), signature: buffer('s') } }),
  };
  const update = createDeviceGate(document, session => views.push(session), { fetchImpl: server, credentials });

  update({ access_token: 'session', user: { email: 'a@test.invalid' } });
  assert.equal(elements['device-gate'].hidden, false);
  assert.deepEqual(views, [null]);
  assert.match(elements.notes.children[0].textContent, /자료를 표시하지 않습니다/u);

  elements['device-register'].click(); await tick(); await tick();
  assert.match(elements['device-status'].textContent, /대기/u);
  elements['device-check'].click(); await tick(); await tick();
  assert.match(elements['device-error'].textContent, /승인되지 않았습니다/u);
  assert.deepEqual(views, [null], 'no session reaches the notes view before approval');

  approved = true;
  elements['device-check'].click(); await tick(); await tick(); await tick();
  assert.equal(views.length, 2);
  assert.equal(views[1].access_token, 'session');
  assert.equal(views[1].device_token, 'device-token-value');
  assert.match(elements['device-status'].textContent, /서버가 승인된 기기로 확인/u);

  update(null);
  assert.equal(views.at(-1), null);
  assert.equal(elements['device-gate'].hidden, true);
});
