const reasons = {
  invalid_credentials: '이메일 또는 비밀번호가 올바르지 않습니다.',
  email_not_confirmed: '이메일 인증이 완료되지 않았습니다. 인증 메일을 확인해 주세요.',
  user_banned: '사용이 제한된 계정입니다. 관리자에게 문의해 주세요.',
  signup_disabled: '이 프로젝트에서 계정 등록을 허용하지 않습니다.',
  email_provider_disabled: '이 프로젝트의 이메일 로그인이 비활성화되어 있습니다.',
  over_request_rate_limit: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  over_email_send_rate_limit: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
};

function failureReason(error) {
  if (reasons[error?.code]) return reasons[error.code];
  if (error?.name === 'AuthRetryableFetchError' || error instanceof TypeError) {
    return '인증 서버에 연결할 수 없습니다. 네트워크 연결과 프로젝트 설정을 확인해 주세요.';
  }
  return '인증 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

// Session state controls this screen only; it is not API authorization.
export async function mountAuth(supabase, document) {
  const form = document.getElementById('login-form');
  const email = document.getElementById('login-email');
  const password = document.getElementById('login-password');
  const submit = document.getElementById('login-submit');
  const logout = document.getElementById('logout-button');
  const status = document.getElementById('auth-status');
  const errorBox = document.getElementById('auth-error');
  let busy = false;
  let revision = 0;

  function render(session) {
    const signedIn = Boolean(session?.user);
    form.hidden = signedIn;
    logout.hidden = !signedIn;
    status.textContent = signedIn
      ? `로그인됨 · ${session.user.email ?? '사용자'}` : '로그아웃 상태입니다.';
    if (!signedIn) password.value = '';
  }

  function setBusy(value) {
    busy = value;
    submit.disabled = value;
    logout.disabled = value;
    email.disabled = value;
    password.disabled = value;
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    revision += 1;
    render(session);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    errorBox.textContent = '';
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.value.trim(), password: password.value,
      });
      if (error) throw error;
      if (!data?.session?.user) throw new Error('missing_session');
      render(data.session);
    } catch (error) {
      errorBox.textContent = `로그인에 실패했습니다. ${failureReason(error)}`;
    } finally {
      password.value = '';
      setBusy(false);
    }
  });

  logout.addEventListener('click', async () => {
    if (busy) return;
    errorBox.textContent = '';
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      render(null);
    } catch (error) {
      errorBox.textContent = `로그아웃하지 못했습니다. ${failureReason(error)}`;
    } finally {
      setBusy(false);
    }
  });

  setBusy(true);
  const initialRevision = revision;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (revision === initialRevision) render(data.session);
  } finally {
    setBusy(false);
  }
}
