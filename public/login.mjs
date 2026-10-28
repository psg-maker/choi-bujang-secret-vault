import { SUPABASE_PROJECT_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.mjs';
import { mountAuth } from './auth-ui.mjs';
import { createNotesView } from './notes-ui.mjs';

const status = document.getElementById('auth-status');
const errorBox = document.getElementById('auth-error');

try {
  const url = new URL(SUPABASE_PROJECT_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash || !SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) {
    throw new Error('invalid_public_config');
  }
} catch {
  status.textContent = '로그인 설정이 필요합니다.';
  errorBox.textContent = 'Supabase Project URL과 공개용 publishable key를 설정해 주세요.';
}

if (!errorBox.textContent) {
  try {
    // Same exact SDK version as package.json. Auth owns password verification and session storage.
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm');
    const supabase = createClient(SUPABASE_PROJECT_URL, SUPABASE_PUBLISHABLE_KEY);
    await mountAuth(supabase, document, createNotesView(document));
  } catch {
    status.textContent = '로그인을 시작하지 못했습니다.';
    errorBox.textContent = '인증 SDK 또는 세션을 불러오지 못했습니다. 네트워크 연결과 프로젝트 설정을 확인해 주세요.';
    document.getElementById('login-submit').disabled = true;
    document.getElementById('logout-button').disabled = true;
  }
}
