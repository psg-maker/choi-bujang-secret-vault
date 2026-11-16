// 설치형 웹앱 상태와 기기 승인 상태를 따로 보여 줍니다.
// 설치 여부는 기기 승인과 무관합니다. 승인 결과는 서버 확인을 거친 「기기 승인」 칸에서만 보여 줍니다.
export const DEVICE_APPROVAL_TEXT = '기기 승인: 로그인 뒤 「기기 승인」 칸에서 서버가 확인합니다. 앱으로 설치했다고 기기 승인이 끝난 것은 아닙니다.';

export function describeAppStatus({ standalone, online }) {
  return {
    install: standalone ? '앱 실행: 설치한 앱 화면으로 열렸습니다.' : '앱 실행: 브라우저 탭에서 열렸습니다.',
    network: online ? '연결: 온라인' : '연결: 오프라인 — 로그인과 메모 조회를 할 수 없습니다.',
    device: DEVICE_APPROVAL_TEXT,
  };
}

export function mountAppStatus(win = globalThis.window, doc = globalThis.document) {
  const render = () => {
    const status = describeAppStatus({
      standalone: Boolean(win.matchMedia?.('(display-mode: standalone)').matches || win.navigator?.standalone),
      online: win.navigator?.onLine !== false,
    });
    for (const [key, text] of Object.entries(status)) {
      const element = doc.getElementById(`app-${key}`);
      if (element) element.textContent = text;
    }
  };
  render();
  win.addEventListener?.('online', render);
  win.addEventListener?.('offline', render);
  if ('serviceWorker' in (win.navigator ?? {})) {
    win.navigator.serviceWorker.register('/sw.js').catch(() => { /* Offline notice is optional; the app still works online. */ });
  }
}

if (globalThis.document?.getElementById?.('app-status')) mountAppStatus();
