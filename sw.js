// 时间尺 (time-logger)
// Copyright © 2026 wowayou — https://github.com/wowayou/time-logger
// SPDX-License-Identifier: AGPL-3.0-or-later
// Commercial licensing available on request; contact via the repository above.
// CacheStorage 按 **origin** 分区，不按 Service Worker scope——同源下别的项目的
// 缓存也会出现在 caches.keys() 里。`wowayou.github.io` 上就同时住着本项目的旧
// 只读站（/time-logger/）和另一个 PWA（/six-pm-sprint/）。因此清理必须按前缀
// 限定在**自己拥有的**缓存上：原来的 `k !== CACHE` 会把邻居的离线缓存一并删掉，
// 两边都静默失去离线能力，而且从表象几乎无法回溯到成因（缓存没命中就走网络，
// 联网时一切正常）。
// CACHE 保持字面量形态：版本仪式的 `bump_version.py` 与 audit 都按
// `CACHE = 'timelog-vN'` 逐字匹配它，改成模板字符串会把六锚点联动打断。
// 前缀因此单独声明；两者一致性由 audit 断言（见 audit_service_worker）。
const CACHE_PREFIX = 'timelog-';
const CACHE = 'timelog-v88';
const FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './sw.js',
  './src/app.js',
  './src/i18n.js',
  './src/locales/zh.js',
  './src/locales/en.js',
  './src/entry_model.js',
  './src/io_actions.js',
  './src/sheet_controller.js',
  './src/time.js',
  './src/storage.js',
  './src/stats.js',
  './src/pickers.js',
  './src/ui.js',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/splash-750x1334.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(FILES))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
