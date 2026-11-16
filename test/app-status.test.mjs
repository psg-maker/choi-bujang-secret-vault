import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { describeAppStatus, DEVICE_APPROVAL_TEXT, mountAppStatus } from '../public/app-status.mjs';

const read = path => readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');

test('install state never reports the device as approved', () => {
  for (const standalone of [true, false]) for (const online of [true, false]) {
    const status = describeAppStatus({ standalone, online });
    assert.equal(status.device, DEVICE_APPROVAL_TEXT);
    assert.doesNotMatch(Object.values(status).join(' '), /승인(되었|됨|완료)|확인 완료|등록 완료/u);
  }
  assert.match(DEVICE_APPROVAL_TEXT, /설치했다고 기기 승인이 끝난 것은 아닙니다/u);
});

test('mount fills status text, listens for network changes and registers only the offline worker', () => {
  const elements = Object.fromEntries(['app-install', 'app-network', 'app-device'].map(id => [id, { textContent: '' }]));
  const listeners = {};
  const registered = [];
  const win = { matchMedia: () => ({ matches: true }), navigator: { onLine: false,
    serviceWorker: { register: url => { registered.push(url); return Promise.resolve(); } } },
  addEventListener: (type, fn) => { listeners[type] = fn; } };
  mountAppStatus(win, { getElementById: id => elements[id] });
  assert.match(elements['app-install'].textContent, /설치한 앱/u);
  assert.match(elements['app-network'].textContent, /오프라인/u);
  assert.equal(elements['app-device'].textContent, DEVICE_APPROVAL_TEXT);
  win.navigator.onLine = true; listeners.online();
  assert.match(elements['app-network'].textContent, /온라인/u);
  assert.deepEqual(registered, ['/sw.js']);
});

test('manifest names the app and the worker never caches API responses', async () => {
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.name, 'BYTE BACK 자료실');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length > 0);
  const html = await read('index.html');
  assert.match(html, /<link rel="manifest" href="\/manifest.webmanifest">/u);
  assert.match(html, /src="\/login.mjs"/u);
  const worker = await read('sw.js');
  assert.match(worker, /mode !== 'navigate'\) return;/u);
  // The worker caches only the offline page at install; it never stores fetched responses.
  assert.doesNotMatch(worker, /cache\.put|cache\.addAll/u);
  assert.match(await read('offline.html'), /오프라인/u);
});
