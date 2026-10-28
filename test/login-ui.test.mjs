import assert from 'node:assert/strict';
import { test } from 'node:test';

// The Auth service is external; exercise our real screen handlers with its SDK boundary stubbed.
async function screen({ initialSession = null, loginError = null, logoutError = null } = {}) {
  const { mountAuth } = await import('../public/auth-ui.mjs');
  const elements = Object.fromEntries(['login-form', 'login-email', 'login-password',
    'login-submit', 'logout-button', 'auth-status', 'auth-error', 'login-notice'].map(id => [id, {
    hidden: false, disabled: false, textContent: '', value: '',
    addEventListener(type, callback) { this[type] = callback; },
  }]));
  let changed;
  const sessions = [];
  const auth = {
    onAuthStateChange(callback) { changed = callback; },
    async getSession() { return { data: { session: initialSession }, error: null }; },
    async signInWithPassword({ email, password }) {
      assert.equal(email, 'a@example.test');
      assert.equal(password, 'test-input-only');
      if (loginError) return { data: { session: null }, error: loginError };
      const session = { user: { email }, access_token: 'test-session-value' };
      changed('SIGNED_IN', session);
      return { data: { session }, error: null };
    },
    async signOut(options) {
      assert.deepEqual(options, { scope: 'local' });
      if (logoutError) return { error: logoutError };
      changed('SIGNED_OUT', null);
      return { error: null };
    },
  };
  await mountAuth({ auth }, { getElementById: id => elements[id] }, session => sessions.push(session));
  elements['login-email'].value = ' a@example.test ';
  elements['login-password'].value = 'test-input-only';
  return { elements, changed, sessions, submit: () => elements['login-form'].submit({ preventDefault() {} }) };
}

test('login and logout change visible controls and clear the password field', async () => {
  const { elements: e, submit, sessions } = await screen();
  assert.equal(e['login-form'].hidden, false);
  assert.equal(e['logout-button'].hidden, true);
  assert.equal(e['login-notice'].hidden, false);
  await submit();
  assert.equal(e['login-form'].hidden, true);
  assert.equal(e['logout-button'].hidden, false);
  assert.equal(e['login-notice'].hidden, true);
  assert.match(e['auth-status'].textContent, /a@example\.test/);
  assert.equal(e['login-password'].value, '');
  assert.equal(sessions.at(-1).access_token, 'test-session-value');
  await e['logout-button'].click();
  assert.equal(e['login-form'].hidden, false);
  assert.equal(e['logout-button'].hidden, true);
  assert.doesNotMatch(e['auth-status'].textContent, /a@example\.test/);
  assert.equal(e['login-notice'].hidden, false);
  assert.equal(sessions.at(-1), null);
});

test('failed login shows a reason and keeps the login form available', async () => {
  const { elements: e, submit } = await screen({ loginError: { code: 'invalid_credentials', message: 'Invalid login credentials' } });
  await submit();
  assert.equal(e['login-form'].hidden, false);
  assert.equal(e['logout-button'].hidden, true);
  assert.match(e['auth-error'].textContent, /이메일.*비밀번호/);
  assert.equal(e['login-password'].value, '');
  assert.equal(e['login-submit'].disabled, false);
});

test('restored sessions and external sign-out update the screen', async () => {
  const { elements: e, changed } = await screen({ initialSession: { user: { email: 'a@example.test' } } });
  assert.equal(e['login-form'].hidden, true);
  changed('SIGNED_OUT', null);
  assert.equal(e['login-form'].hidden, false);
  assert.equal(e['logout-button'].hidden, true);
});

test('failed logout preserves the signed-in screen and explains failure', async () => {
  const { elements: e } = await screen({ initialSession: { user: { email: 'a@example.test' } },
    logoutError: { code: 'unexpected_failure', message: 'Service unavailable' } });
  await e['logout-button'].click();
  assert.equal(e['login-form'].hidden, true);
  assert.equal(e['logout-button'].hidden, false);
  assert.match(e['auth-error'].textContent, /로그아웃/);
  assert.equal(e['logout-button'].disabled, false);
});
