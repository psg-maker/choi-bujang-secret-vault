// 11단계: 로그인 뒤 기기 승인을 서버에서 확인하기 전에는 자료실을 열지 않습니다.
// 기기 토큰은 이 변수(메모리)에만 두고 localStorage·sessionStorage·쿠키에 넣지 않습니다.
const enc = text => new TextEncoder().encode(text);
const toB64url = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer)))
  .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const fromB64url = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));

const messages = {
  DEVICE_NOT_APPROVED: '이 기기는 아직 승인되지 않았습니다(대기). 관리자 승인 뒤 「승인 확인」을 눌러 주세요.',
  DEVICE_NOT_FOUND: '이 계정에 등록된 이 기기의 패스키가 없습니다. 먼저 「이 기기 승인 요청」을 눌러 주세요.',
  SIGNATURE_INVALID: '패스키 서명을 확인하지 못했습니다.',
  SIGN_COUNT_INVALID: '패스키 사용 횟수가 맞지 않아 거부했습니다.',
  CREDENTIAL_OWNED_BY_OTHER: '다른 계정에 등록된 패스키입니다.',
};

export function createDeviceGate(document, notesView, { fetchImpl = fetch, credentials = globalThis.navigator?.credentials } = {}) {
  const panel = document.getElementById('device-gate');
  const status = document.getElementById('device-status');
  const errorBox = document.getElementById('device-error');
  const register = document.getElementById('device-register');
  const check = document.getElementById('device-check');
  const list = document.getElementById('notes');
  let session = null;
  let busy = false;

  function lock(text) {
    notesView(null);
    const item = document.createElement('li');
    item.textContent = text;
    list.replaceChildren(item);
  }
  async function post(path, body) {
    const response = await fetchImpl(path, { method: 'POST', cache: 'no-store',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(messages[data.error] ?? '기기 승인 요청을 처리하지 못했습니다.'), { code: data.error });
    return data;
  }
  async function run(task) {
    if (busy || !session) return;
    busy = true; register.disabled = true; check.disabled = true; errorBox.textContent = '';
    const active = session;
    try { await task(active); } catch (error) {
      if (session === active) {
        errorBox.textContent = error.name === 'NotAllowedError' ? '패스키 확인이 취소되었습니다.' : error.message;
        if (error.code === 'DEVICE_NOT_APPROVED') status.textContent = '기기 승인 상태: 대기 — 자료실이 잠겨 있습니다.';
      }
    } finally { busy = false; register.disabled = false; check.disabled = false; }
  }

  register.addEventListener('click', () => run(async active => {
    if (!credentials?.create) throw new Error('이 브라우저는 패스키를 지원하지 않습니다.');
    const options = await post('/api/device/challenge', { kind: 'register' });
    const credential = await credentials.create({ publicKey: {
      challenge: enc(options.challenge), rp: { id: options.rpId, name: 'BYTE BACK 자료실' },
      user: { id: enc(options.userId), name: active.user?.email ?? '자료실 사용자', displayName: '자료실 사용자' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], attestation: 'none', timeout: 60000,
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' } } });
    const result = await post('/api/device/register', { challenge: options.challenge, credentialId: toB64url(credential.rawId),
      clientDataJSON: toB64url(credential.response.clientDataJSON), authenticatorData: toB64url(credential.response.getAuthenticatorData()),
      publicKey: toB64url(credential.response.getPublicKey()), alg: credential.response.getPublicKeyAlgorithm() });
    if (session !== active) return;
    // Registering never opens the vault; only a server-verified approval does.
    status.textContent = result.status === 'approved'
      ? '기기 승인 상태: 이미 승인된 패스키입니다. 「승인 확인」을 눌러 주세요.'
      : '기기 승인 상태: 대기 — 승인 요청을 보냈습니다. 관리자 승인 전에는 자료가 열리지 않습니다.';
  }));

  check.addEventListener('click', () => run(async active => {
    if (!credentials?.get) throw new Error('이 브라우저는 패스키를 지원하지 않습니다.');
    const options = await post('/api/device/challenge', { kind: 'assert' });
    if (!options.credentialIds.length) throw new Error(messages.DEVICE_NOT_FOUND);
    const credential = await credentials.get({ publicKey: { challenge: enc(options.challenge), rpId: options.rpId,
      allowCredentials: options.credentialIds.map(id => ({ type: 'public-key', id: fromB64url(id) })),
      userVerification: 'preferred', timeout: 60000 } });
    const result = await post('/api/device/assert', { challenge: options.challenge, credentialId: toB64url(credential.rawId),
      clientDataJSON: toB64url(credential.response.clientDataJSON),
      authenticatorData: toB64url(credential.response.authenticatorData), signature: toB64url(credential.response.signature) });
    if (session !== active || result.status !== 'approved' || typeof result.deviceToken !== 'string') return;
    status.textContent = `기기 승인 상태: 서버가 승인된 기기로 확인했습니다(${Math.round(result.expiresInSeconds / 60)}분 유효).`;
    await notesView({ ...active, device_token: result.deviceToken });
  }));

  return function updateSession(next) {
    session = next?.access_token ? next : null;
    panel.hidden = !session;
    errorBox.textContent = '';
    if (!session) { notesView(null); return; }
    status.textContent = '기기 승인 상태: 확인 전 — 「승인 확인」을 눌러야 자료실이 열립니다.';
    lock('기기 승인을 서버에서 확인하기 전에는 자료를 표시하지 않습니다.');
  };
}
