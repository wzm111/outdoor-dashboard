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

/** 序列化一个变更请求到 IndexedDB 队列。 */
async function enqueueMutation({ method, url, headers, body }) {
  const record = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random(),
    createdAt: new Date().toISOString(),
    method,
    url,
    headers,
    body,
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

/** 按顺序重放队列中的请求。 */
async function flushQueue() {
  if (offlineState.flushing || !navigator.onLine) return;
  offlineState.flushing = true;
  updateOfflineBanner();

  try {
    let queue = await idbGetAll();
    queue.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    while (queue.length > 0) {
      const item = queue[0];
      try {
        const res = await fetchWithTimeout(item.url, {
          method: item.method,
          headers: item.headers,
          body: item.body,
        }, 30000, '同步离线修改');

        if (res.status === 401) {
          toast('离线同步暂停：登录已过期，请重新连接', 'error');
          break;
        }
        if (!res.ok) {
          // 非 401 错误先跳过，下次再试
          throw new Error(`HTTP ${res.status}`);
        }
        await idbDelete(item.id);
      } catch (err) {
        console.log('离线同步单项失败:', err.message || err);
        break; // 顺序执行，失败则暂停，下次再试
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
    // 同步完成后拉取一次最新服务端状态
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
