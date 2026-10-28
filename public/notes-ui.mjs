export function createNotesView(document, fetchNotes = fetch) {
  const list = document.getElementById('notes');
  let revision = 0;
  let previousToken;
  let pending;

  function message(text) {
    const item = document.createElement('li');
    item.textContent = text;
    list.replaceChildren(item);
  }

  return function updateNotes(session) {
    const token = session?.access_token ?? null;
    if (token === previousToken) return pending;
    previousToken = token;
    const current = ++revision;
    // Clear synchronously, including on logout while a query is still running.
    if (!token) {
      message('자료를 보려면 로그인해 주세요.');
      return;
    }
    message('자료를 불러오는 중입니다.');
    pending = (async () => {
      try {
        const response = await fetchNotes('/api/notes', {
          cache: 'no-store', headers: { Authorization: `Bearer ${token}` },
        });
        if (current !== revision) return;
        if (response.status === 401) throw new Error('로그인 확인에 실패했습니다. 다시 로그인해 주세요.');
        if (!response.ok) throw new Error('자료를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.');
        const data = await response.json();
        if (current !== revision) return;
        if (!Array.isArray(data.notes) || data.notes.some(note => !note
            || typeof note.title !== 'string' || typeof note.content !== 'string')) {
          throw new Error('자료 형식이 맞지 않습니다.');
        }
        if (!data.notes.length) {
          message('등록된 자료가 없습니다.');
          return;
        }
        list.replaceChildren(...data.notes.map(note => {
          const item = document.createElement('li');
          const title = document.createElement('strong');
          const content = document.createElement('span');
          title.textContent = note.title;
          content.textContent = note.content;
          item.append(title, content);
          return item;
        }));
      } catch (error) {
        if (current !== revision) return;
        previousToken = undefined;
        message(error instanceof TypeError
          ? '자료 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.' : error.message);
      }
    })();
    return pending;
  };
}
