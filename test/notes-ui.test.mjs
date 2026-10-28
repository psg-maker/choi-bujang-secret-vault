import assert from 'node:assert/strict';
import { test } from 'node:test';
function screen() {
  const list = { children: [], replaceChildren(...nodes) { this.children = nodes; } };
  return { list, document: { getElementById: () => list, createElement: () => ({ append(...nodes) { this.children = nodes; } }) } };
}
test('notes use the session token and disappear on logout', async () => {
  const { createNotesView } = await import('../public/notes-ui.mjs');
  const { list, document } = screen();
  let calls = 0;
  const update = createNotesView(document, async (url, options) => {
    calls += 1;
    assert.equal(url, '/api/notes');
    assert.equal(options.headers.Authorization, 'Bearer test-session-value');
    return Response.json({ notes: [{ title: '<b>Title</b>', content: 'Synthetic content' }] });
  });
  await update(null);
  assert.equal(calls, 0);
  await update({ access_token: 'test-session-value' });
  assert.equal(list.children[0].children[0].textContent, '<b>Title</b>');
  await update(null);
  assert.equal(calls, 1);
  assert.equal(list.children[0].children, undefined);
  assert.match(list.children[0].textContent, /로그인/);
});
test('late responses after logout cannot restore notes', async () => {
  const { createNotesView } = await import('../public/notes-ui.mjs');
  const { list, document } = screen();
  let resolve;
  const update = createNotesView(document, () => new Promise(done => { resolve = done; }));
  const pending = update({ access_token: 'test-session-value' });
  await update(null);
  resolve(Response.json({ notes: [{ title: 'Synthetic title', content: 'Synthetic content' }] }));
  await pending;
  assert.match(list.children[0].textContent, /로그인/);
  assert.equal(list.children[0].children, undefined);
});
test('rejected sessions display no notes and prompt login again', async () => {
  const { createNotesView } = await import('../public/notes-ui.mjs');
  const { list, document } = screen();
  const update = createNotesView(document, async () => Response.json({ error: 'UNAUTHORIZED' }, { status: 401 }));
  await update({ access_token: 'test-session-value' });
  assert.match(list.children[0].textContent, /다시 로그인/);
  assert.equal(list.children[0].children, undefined);
});
