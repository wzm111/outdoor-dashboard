/* IndexedDB 离线队列与后台同步 */
'use strict';

// ---------- 离线支持（B2） ----------

function openIdb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return resolve(null);
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAll() {
  const db = await openIdb();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbAdd(record) {
  const db = await openIdb();
  if (!db) throw new Error('浏览器不支持 IndexedDB，无法离线排队');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.add(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(id) {
  const db = await openIdb();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await openIdb();
  if (!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** 序列化一个变更请求到 IndexedDB 队列。 */
async function enqueueMutation({ method, url, headers, body, expectedUpdatedAt }) {
  const record = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    method,
    url,
    headers,
    body,
    expectedUpdatedAt,
  };
  await idbAdd(record);
  offlineState.pendingCount = (await idbGetAll()).length;
  updateOfflineBanner();
  registerBackgroundSync();
  return record;
}

/** 把当前 state.data 写回 localStorage 作为离线快照。 */
async function saveSnapshot() {
  if (!state.data) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state.data));
    offlineState.cachedAt = new Date().toISOString();
  } catch { /* 隐私模式/容量满时忽略 */ }
}

/** 注册后台同步，让浏览器在联网后自动唤醒 flush（PWA/移动端有效）。 */
function registerBackgroundSync() {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
  navigator.serviceWorker.ready
    .then((reg) => reg.sync.register('flush-mutations'))
    .catch(() => {});
}

/** 刷新顶部离线/同步状态条。 */
function updateOfflineBanner() {
  let banner = $('#offline-banner');
  if (!banner) {
    banner = el('div', { id: 'offline-banner', class: 'offline-banner' });
    document.body.insertBefore(banner, document.body.firstChild);
  }

  const age = offlineState.cachedAt
    ? Math.max(0, Math.round((Date.now() - new Date(offlineState.cachedAt).getTime()) / 60000))
    : null;

  if (offlineState.isOnline && offlineState.pendingCount === 0) {
    banner.hidden = true;
    banner.className = 'offline-banner';
    return;
  }

  if (!offlineState.isOnline) {
    banner.hidden = false;
    banner.className = 'offline-banner offline';
    banner.textContent = age != null
      ? `当前离线，显示 ${age} 分钟前缓存数据 · ${offlineState.pendingCount} 条修改待同步`
      : `当前离线 · ${offlineState.pendingCount} 条修改待同步`;
    return;
  }

  if (offlineState.pendingCount > 0) {
    banner.hidden = false;
    banner.className = 'offline-banner syncing';
    banner.textContent = `正在同步 ${offlineState.pendingCount} 条修改…`;
  }
}

/** 解析队列项对应的实体类型与业务主键，用于压缩与冲突提示。
 *  POST 到集合端点（无 URL id）时不做主键压缩，避免误合并多条新记录。 */
function mutationKey(item) {
  try {
    const url = new URL(item.url);
    const parts = url.pathname.replace('/api/', '').split('/').filter(Boolean);
    const entity = parts[0];
    const id = parts[1];
    // 集合级 POST（如新建计划/活动）没有路径 id，使用完整 URL 避免新记录被合并
    if (!id && item.method === 'POST') return `${item.method}:${item.url}:${hashBody(item.body)}`;
    return `${item.method}:${entity}:${decodeURIComponent(id || '')}`;
  } catch {
    return `${item.method}:${item.url}`;
  }
}

/** 对身体做简单稳定哈希，用于区分不同 POST 请求。 */
function hashBody(body) {
  if (!body) return '';
  const str = String(body);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

/** 压缩离线队列：同一实体的多次更新合并为最后一次；更新后删除只保留删除；删除后再更新保留更新。 */
async function compressQueue() {
  const queue = await idbGetAll();
  if (queue.length < 2) return;

  const byKey = new Map();
  queue.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  for (const item of queue) {
    const key = mutationKey(item);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, item);
      continue;
    }

    // PUT 后 PUT：保留后一个（合并所有变更）
    if (item.method === 'PUT' && prev.method === 'PUT') {
      await idbDelete(prev.id);
      byKey.set(key, item);
      continue;
    }

    // PUT 后 DELETE：删除前面的 PUT，保留 DELETE
    if (item.method === 'DELETE' && prev.method === 'PUT') {
      await idbDelete(prev.id);
      byKey.set(key, item);
      continue;
    }

    // DELETE 后 PUT：保留 PUT（等价于最终创建/更新）
    if (item.method === 'PUT' && prev.method === 'DELETE') {
      await idbDelete(prev.id);
      byKey.set(key, item);
      continue;
    }

    // DELETE 后 DELETE：去重，保留后一个
    if (item.method === 'DELETE' && prev.method === 'DELETE') {
      await idbDelete(prev.id);
      byKey.set(key, item);
    }
  }
}

/** 判断失败是否值得自动重试（5xx / 网络超时 / 限流）。 */
function isRetryableError(status, message) {
  if (status >= 500 && status < 600) return true;
  if (status === 429) return true;
  if (!status && message && /超时|网络|CORS|abort|Failed to fetch/i.test(message)) return true;
  return false;
}

/** 指数退避延迟（秒），最多约 5 分钟。 */
function backoffDelay(attempts) {
  const base = 2;
  const max = 300;
  return Math.min(max, Math.pow(base, attempts) + Math.random());
}

/** 按顺序重放队列中的请求，支持压缩、冲突检测、指数退避重试。 */
async function flushQueue() {
  if (offlineState.flushing || !navigator.onLine) return;
  offlineState.flushing = true;
  updateOfflineBanner();

  try {
    await compressQueue();
    let queue = await idbGetAll();
    queue.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    while (queue.length > 0) {
      const item = queue[0];
      let status = 0;
      let errorMessage = '';
      try {
        const res = await fetchWithTimeout(item.url, {
          method: item.method,
          headers: item.headers,
          body: item.body,
        }, 30000, '同步离线修改');

        status = res.status;
        if (status === 401) {
          toast('离线同步暂停：登录已过期，请重新连接', 'error');
          break;
        }

        if (status === 409) {
          const body = await res.json().catch(() => ({}));
          console.warn('离线同步冲突:', item.url, body.server_updated_at);
          toast('检测到服务端有更新，已暂停同步，请刷新后确认', 'warn');
          // 标记冲突次数，达到阈值可丢弃；当前保留在队列，等待用户手动处理
          item.attempts = (item.attempts || 0) + 1;
          item.lastError = `Conflict: server updated_at=${body.server_updated_at || 'unknown'}`;
          await idbPut(item);
          break;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}${text ? ': ' + text.slice(0, 120) : ''}`);
        }

        await idbDelete(item.id);
      } catch (err) {
        errorMessage = err && err.message ? err.message : String(err);
        console.log('离线同步单项失败:', errorMessage);

        if (isRetryableError(status, errorMessage)) {
          item.attempts = (item.attempts || 0) + 1;
          if (item.attempts >= 6) {
            console.warn('离线同步项重试次数过多，已丢弃:', item.url);
            await idbDelete(item.id);
            toast('某条离线修改多次同步失败，已跳过', 'warn');
          } else {
            item.lastError = errorMessage;
            await idbPut(item);
            const delaySec = backoffDelay(item.attempts);
            toast(`同步失败，${Math.round(delaySec)} 秒后重试`, 'warn');
            await new Promise((r) => setTimeout(r, delaySec * 1000));
          }
        } else {
          // 4xx 且非 409：请求本身有问题，跳过避免无限阻塞
          console.warn('离线同步项客户端错误，已丢弃:', item.url, errorMessage);
          await idbDelete(item.id);
          toast('某条离线修改格式错误，已跳过：' + errorMessage, 'warn');
        }
      }

      queue = await idbGetAll();
      queue.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      offlineState.pendingCount = queue.length;
      updateOfflineBanner();
    }
  } finally {
    offlineState.flushing = false;
    offlineState.pendingCount = (await idbGetAll()).length;
    updateOfflineBanner();
    // 同步完成后拉取一次最新服务端状态（会走增量同步）
    if (navigator.onLine && state.token) {
      try { await loadAndRender(true); } catch { /* ignore */ }
    }
  }
}

/** 初始化离线检测与同步监听。 */
function initOffline() {
  window.addEventListener('online', () => {
    offlineState.isOnline = true;
    updateOfflineBanner();
    flushQueue();
  });
  window.addEventListener('offline', () => {
    offlineState.isOnline = false;
    updateOfflineBanner();
  });

  // Service Worker 后台同步消息
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'FLUSH_QUEUE') {
        flushQueue();
      }
    });
  }

  // 页面加载时若已有快照，记录缓存时间
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const meta = localStorage.getItem(CACHE_KEY + '-meta');
      offlineState.cachedAt = meta ? JSON.parse(meta).cachedAt : new Date().toISOString();
    }
  } catch {}

  updateOfflineBanner();
}
