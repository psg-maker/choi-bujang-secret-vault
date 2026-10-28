export function createNotesView(document, fetchNotes = fetch) {
  const list = document.getElementById('notes');
  const editor = document.getElementById('note-editor');
  const form = document.getElementById('note-form');
  const titleInput = document.getElementById('note-title');
  const bodyInput = document.getElementById('note-body');
  const save = document.getElementById('note-save');
  const cancel = document.getElementById('note-cancel');
  const errorBox = document.getElementById('note-error');
  const status = document.getElementById('note-status');
  let token;
  let generation = 0;
  let loadVersion = 0;
  let pending;
  let editingId = null;
  let busy = false;

  function message(text) {
    const item = document.createElement('li');
    item.textContent = text;
    list.replaceChildren(item);
  }
  function resetEditor() {
    editingId = null;
    titleInput.value = '';
    bodyInput.value = '';
    save.textContent = '메모 추가';
    cancel.hidden = true;
  }
  function setBusy(value) {
    busy = value;
    for (const element of [save, cancel, titleInput, bodyInput]) element.disabled = value;
  }
  const current = value => value === generation && Boolean(token);
  function validNote(note) {
    return note && typeof note.id === 'string' && typeof note.title === 'string' && typeof note.body === 'string';
  }
  async function api(path, method = 'GET', body, accessToken = token) {
    const response = await fetchNotes(path, {
      method, cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401) throw new Error('로그인 확인에 실패했습니다. 다시 로그인해 주세요.');
    if (response.status === 404) throw new Error('메모가 없습니다. 목록을 새로 확인해 주세요.');
    if (response.status === 409) throw new Error('같은 ID의 메모가 이미 있습니다.');
    if (response.status === 400 || response.status === 415) throw new Error('제목과 본문 입력을 확인해 주세요.');
    if (!response.ok) throw new Error('메모 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    return response.status === 204 ? null : response.json();
  }
  function report(error) {
    errorBox.textContent = error instanceof TypeError
      ? '자료 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.' : error.message;
  }

  async function edit(id) {
    if (busy || !token) return;
    const active = generation;
    setBusy(true);
    errorBox.textContent = '';
    try {
      const note = await api(`/api/notes/${encodeURIComponent(id)}`);
      if (!current(active)) return;
      if (!validNote(note)) throw new Error('자료 형식이 맞지 않습니다.');
      editingId = note.id;
      titleInput.value = note.title;
      bodyInput.value = note.body;
      save.textContent = '수정 저장';
      cancel.hidden = false;
      status.textContent = '메모를 수정하고 있습니다.';
    } catch (error) { if (current(active)) report(error); }
    finally { if (current(active)) { setBusy(false); titleInput.focus(); } }
  }
  async function remove(id) {
    if (busy || !token) return;
    const active = generation;
    setBusy(true);
    errorBox.textContent = '';
    try {
      await api(`/api/notes/${encodeURIComponent(id)}`, 'DELETE');
      if (!current(active)) return;
      if (editingId === id) resetEditor();
      status.textContent = '메모를 삭제했습니다.';
      await load();
    } catch (error) { if (current(active)) report(error); }
    finally { if (current(active)) setBusy(false); }
  }
  async function load() {
    const active = generation;
    const version = ++loadVersion;
    message('자료를 불러오는 중입니다.');
    try {
      const notes = await api('/api/notes');
      if (!current(active) || version !== loadVersion) return;
      if (!Array.isArray(notes) || notes.some(note => !validNote(note))) throw new Error('자료 형식이 맞지 않습니다.');
      if (!notes.length) { message('아직 작성한 메모가 없습니다. 위에서 첫 메모를 추가해 보세요.'); return; }
      list.replaceChildren(...notes.map(note => {
        const item = document.createElement('li');
        const title = document.createElement('strong');
        const body = document.createElement('span');
        title.textContent = note.title;
        body.textContent = note.body;
        const actions = document.createElement('div');
        actions.className = 'note-actions';
        const editButton = document.createElement('button');
        editButton.type = 'button'; editButton.textContent = '수정';
        editButton.addEventListener('click', () => edit(note.id));
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button'; deleteButton.textContent = '삭제';
        deleteButton.className = 'delete-note';
        deleteButton.addEventListener('click', () => remove(note.id));
        actions.append(editButton, deleteButton);
        item.append(title, body, actions);
        return item;
      }));
    } catch (error) {
      if (!current(active) || version !== loadVersion) return;
      report(error);
      message(errorBox.textContent);
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !token) return;
    const active = generation;
    const id = editingId;
    setBusy(true);
    errorBox.textContent = '';
    try {
      await api(id ? `/api/notes/${encodeURIComponent(id)}` : '/api/notes', id ? 'PUT' : 'POST',
        { title: titleInput.value.trim(), body: bodyInput.value });
      if (!current(active)) return;
      resetEditor();
      status.textContent = id ? '메모를 수정했습니다.' : '메모를 추가했습니다.';
      await load();
    } catch (error) { if (current(active)) report(error); }
    finally { if (current(active)) setBusy(false); }
  });
  cancel.addEventListener('click', () => {
    if (busy) return;
    resetEditor(); status.textContent = '수정을 취소했습니다.'; errorBox.textContent = '';
  });

  return function updateNotes(session) {
    const nextToken = session?.access_token ?? null;
    if (nextToken === token) return pending;
    token = nextToken;
    generation++;
    loadVersion++;
    setBusy(false);
    resetEditor();
    errorBox.textContent = '';
    status.textContent = '';
    editor.hidden = !token;
    if (!token) { message('자료를 보려면 로그인해 주세요.'); return; }
    pending = load();
    return pending;
  };
}
