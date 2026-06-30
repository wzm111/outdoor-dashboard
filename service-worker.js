/* 户外助手看板 Service Worker
 *
 * 策略：
 * - 静态外壳（HTML/CSS/JS/manifest）走 cache-first，离线可打开应用。
 * - API 请求（/auth/token、/sync）一律走网络，绝不缓存（含密钥/JWT，且数据要新鲜）。
 *   离线时的数据回退由 app.js 用 localStorage 快照处理，不在 SW 层缓存响应。
 */
const CACHE = 'outdoor-dashboard-v2';
// 核心外壳：必须全部缓存成功（addAll 原子操作），缺一不可离线运行
const SHELL = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json',
];
// 可选资源：尽力缓存，单个失败不阻断 SW 安装
const OPTIONAL = [
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(SHELL).then(() =>
        // 图标尽力缓存：任一失败也不让整个安装失败
        Promise.all(OPTIONAL.map((u) => cache.add(u).catch(() => {})))
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST（auth/sync）直接走网络，不拦截

  const url = new URL(req.url);

  // API 调用绝不进缓存（即使是 GET）：包含敏感数据，且要保持新鲜
  if (url.pathname.includes('/auth/') || url.pathname.includes('/sync') ||
      url.pathname.includes('/functions/')) {
    return; // 交给浏览器默认网络处理
  }

  // 静态外壳：cache-first，回源后写回缓存
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
