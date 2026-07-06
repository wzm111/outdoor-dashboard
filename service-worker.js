/* 户外助手看板 Service Worker
 *
 * 策略：
 * - 静态外壳（HTML/CSS/JS/manifest）走 **network-first**：优先拉网络最新版并写回缓存，
 *   只有网络失败（离线）才回退缓存。彻底避免旧外壳被 cache-first 钉死导致用户看到旧页面。
 * - API 请求（/auth/token、/sync）一律走网络，绝不缓存（含密钥/JWT，且数据要新鲜）。
 *   离线时的数据回退由 app.js 用 localStorage 快照处理，不在 SW 层缓存响应。
 */
const CACHE = 'outdoor-dashboard-v34.3';
// 核心外壳：必须全部缓存成功（addAll 原子操作），缺一不可离线运行
const SHELL = [
  './',
  './index.html',
  './version.js',
  './utils.js',
  './state.js',
  './idb.js',
  './api.js',
  './ui-common.js',
  './body-age.js',
  './activity-core.js',
  './activity-form.js',
  './gear-utils.js',
  './chart-utils.js',
  './view-overview.js',
  './view-activities.js',
  './view-body.js',
  './view-gear.js',
  './view-routes.js',
  './view-plans.js',
  './view-reports.js',
  './recommend-core.js',
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

  // 静态外壳：network-first —— 优先网络最新版并写回缓存，网络失败才回退缓存。
  // 这样每次改前端文件后，用户一联网打开就拿到新版，不会被旧缓存钉死。
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && url.origin === self.location.origin) {
        const clone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, clone));
      }
      return res;
    }).catch(() => caches.match(req)) // 离线兜底：回退到缓存的外壳
  );
});

// 后台同步：浏览器联网后唤醒页面 flush 离线变更队列
self.addEventListener('sync', (event) => {
  if (event.tag === 'flush-mutations') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'FLUSH_QUEUE' }));
      })
    );
  }
});
