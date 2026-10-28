import assert from 'node:assert/strict';
import { test } from 'node:test';
function screen() {
  const node = () => ({ children: [], value: '', textContent: '', hidden: false,
    append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(type, callback) { this[type] = callback; }, focus() {} });
  const elements = Object.fromEntries(['notes', 'note-editor', 'note-form', 'note-title', 'note-body',
    'note-save', 'note-cancel', 'note-error', 'note-status'].map(id => [id, node()]));
  return { list: elements.notes, elements, document: { getElementById: id => elements[id], createElement: node } };
}
test('notes use the session token and disappear on logout', async () => {
  const { createNotesView } = await import('../public/notes-ui.mjs');
  const { list, document } = screen();
  let calls = 0;
  const update = createNotesView(document, async (url, options) => {
    calls += 1;
    assert.equal(url, '/api/notes');
    assert.equal(options.headers.Authorization, 'Bearer test-session-value');
    return Response.json([{ id: '22222222-2222-4222-8222-222222222222', title: '<b>Title</b>', body: 'Synthetic content' }]);
  });
  await update(null);
  assert.equal(calls, 0);
  await update({ access_token: 'test-session-value' });
  assert.equal(list.children[0].children[0].textContent, '<b>Title</b>');
  await update(null);
  assert.equal(calls, 1);
  assert.equal(list.children[0].children.length, 0);
  assert.match(list.children[0].textContent, /로그인/);
});
test('late responses after logout cannot restore notes', async () => {
  const { createNotesView } = await import('../public/notes-ui.mjs');
  const { list, document } = screen();
  let resolve;
  const update = createNotesView(document, () => new Promise(done => { resolve = done; }));
  const pending = update({ access_token: 'test-session-value' });
  await update(null);
  resolve(Response.json([{ id: '22222222-2222-4222-8222-222222222222', title: 'Synthetic title', body: 'Synthetic content' }]));
  await pending;
  assert.match(list.children[0].textContent, /로그인/);
  assert.equal(list.children[0].children.length, 0);
});
test('rejected sessions display no notes and prompt login again', async () => {
  const { createNotesView } = await import('../public/notes-ui.mjs');
  const { list, document } = screen();
  const update = createNotesView(document, async () => Response.json({ error: 'UNAUTHORIZED' }, { status: 401 }));
  await update({ access_token: 'test-session-value' });
  assert.match(list.children[0].textContent, /다시 로그인/);
  assert.equal(list.children[0].children.length, 0);
});

test('editor creates, reads for editing, updates and deletes using the documented routes', async () => {
  const { createNotesView } = await import('../public/notes-ui.mjs');
  const { list, elements: e, document } = screen();
  const id = '22222222-2222-4222-8222-222222222222';
  let note;
  const methods = [];
  const update = createNotesView(document, async (url, options) => {
    const method = options.method ?? 'GET';
    methods.push(`${method} ${url}`);
    assert.equal(options.headers.Authorization, 'Bearer test-session-value');
    if (method === 'POST') { note = { id, ...JSON.parse(options.body) }; return Response.json({ id }, { status: 201 }); }
    if (method === 'PUT') { note = { id, ...JSON.parse(options.body) }; return Response.json(note); }
    if (method === 'DELETE') { note = undefined; return new Response(null, { status: 204 }); }
    return Response.json(url.endsWith(id) ? note : note ? [note] : []);
  });
  await update(null);
  assert.equal(e['note-editor'].hidden, true);
  await update({ access_token: 'test-session-value' });
  assert.equal(e['note-editor'].hidden, false);
  e['note-title'].value = 'Synthetic'; e['note-body'].value = 'Original';
  await e['note-form'].submit({ preventDefault() {} });
  assert.equal(list.children[0].children[0].textContent, 'Synthetic');
  await list.children[0].children[2].children[0].click();
  assert.equal(e['note-body'].value, 'Original');
  e['note-body'].value = 'Updated';
  await e['note-form'].submit({ preventDefault() {} });
  assert.equal(list.children[0].children[1].textContent, 'Updated');
  await list.children[0].children[2].children[1].click();
  assert.equal(note, undefined);
  assert.ok(methods.includes(`GET /api/notes/${id}`));
  assert.ok(methods.includes(`PUT /api/notes/${id}`));
  assert.ok(methods.includes(`DELETE /api/notes/${id}`));
  await update(null);
  assert.equal(e['note-body'].value, '');
  assert.equal(e['note-editor'].hidden, true);
});
