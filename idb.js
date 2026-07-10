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

/** 解析队列项对应的实体类型、业务主键与操作语义，用于 UI 展示与压缩。 */
function mutationMeta(item) {
  try {
    const url = new URL(item.url);
    const parts = url.pathname.replace('/api/', '').split('/').filter(Boolean);
    const entity = parts[0] || 'unknown';
    const id = parts[1] ? decodeURIComponent(parts[1]) : '';
    const method = String(item.method || '').toUpperCase();
    const op = method === 'POST' ? '新增' : method === 'PUT' ? '编辑' : method === 'DELETE' ? '删除' : method;
    return { entity, id, op, method };
  } catch {
    return { entity: 'unknown', id: item.url || '', op: item.method || '操作', method: item.method || '' };
  }
}

/** 把实体名映射为中文标签。 */
function entityLabel(entity) {
  return {
    gear: '装备', routes: '路线', activities: '活动', body: '身体', plans: '计划',
    segments: '路段', price: '价格',
  }[String(entity).toLowerCase()] || entity;
}

/** 从队列项 body 中尽量提取可读的名称/日期摘要。 */
function mutationSummary(item) {
  try {
    const body = item.body ? JSON.parse(item.body) : {};
    const data = body.data || body;
    if (data.name) return data.name;
    if (data.route && data.date) return `${data.date} · ${data.route}`;
    if (data.date) return String(data.date);
    if (data.route) return String(data.route);
    if (data.slug) return String(data.slug);
    if (data.plan_type) return `${data.plan_type} · ${data.date || ''}`;
    return item.id.slice(0, 8);
  } catch {
    return item.id.slice(0, 8);
  }
}

/** 刷新顶部离线/同步状态条，并同步「同步状态」按钮徽标。 */
function updateOfflineBanner() {
  let banner = $('#offline-banner');
  if (!banner) {
    banner = el('div', { id: 'offline-banner', class: 'offline-banner' });
    document.body.insertBefore(banner, document.body.firstChild);
  }

  const age = offlineState.cachedAt
    ? Math.max(0, Math.round((Date.now() - new Date(offlineState.cachedAt).getTime()) / 60000))
    : null;

  // 顶部工具栏按钮徽标
  updateSyncBadge(offlineState.pendingCount);

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
    banner.textContent = offlineState.flushing
      ? `正在同步 ${offlineState.pendingCount} 条修改…`
      : `${offlineState.pendingCount} 条修改待同步`;
  }
}

/** 更新同步状态按钮上的徽标。 */
function updateSyncBadge(count) {
  const btn = $('#sync-detail-btn');
  if (!btn) return;
  const existing = $('.sync-badge', btn);
  if (existing) existing.remove();
  if (count > 0) {
    const badge = el('span', { class: 'sync-badge' }, String(count));
    btn.appendChild(badge);
  }
  btn.classList.toggle('has-pending', count > 0);
}

/** 打开同步状态详情弹窗：展示连接状态、缓存时间、队列列表与操作。 */
async function openSyncDetail() {
  const queue = await idbGetAll();
  const meta = loadSyncMeta();
  const cachedAt = offlineState.cachedAt || (meta && meta.cachedAt);

  const wrap = el('div', { class: 'sync-detail' });

  // 状态摘要
  const statusCard = el('div', { class: 'chart-card sync-status-card' });
  const onlineRow = el('div', { class: 'sync-status-row' },
    el('span', { class: 'sync-status-label' }, '网络状态'),
    el('span', { class: 'sync-status-value ' + (offlineState.isOnline ? 'sync-online' : 'sync-offline') },
      offlineState.isOnline ? '在线' : '离线')
  );
  const pendingRow = el('div', { class: 'sync-status-row' },
    el('span', { class: 'sync-status-label' }, '待同步'),
    el('span', { class: 'sync-status-value' }, `${queue.length} 条`)
  );
  const cachedRow = el('div', { class: 'sync-status-row' },
    el('span', { class: 'sync-status-label' }, '本地快照'),
    el('span', { class: 'sync-status-value' },
      cachedAt ? `${Math.max(0, Math.round((Date.now() - new Date(cachedAt).getTime()) / 60000))} 分钟前` : '无')
  );
  statusCard.appendChild(onlineRow);
  statusCard.appendChild(pendingRow);
  statusCard.appendChild(cachedRow);
  wrap.appendChild(statusCard);

  // 操作按钮
  const actionRow = el('div', { class: 'sync-detail-actions' });
  const flushBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, '立即同步');
  flushBtn.disabled = !offlineState.isOnline || queue.length === 0 || offlineState.flushing;
  flushBtn.addEventListener('click', async () => {
    if (!navigator.onLine) { toast('当前离线，恢复网络后将自动同步', 'warn'); return; }
    flushBtn.disabled = true;
    flushBtn.textContent = '同步中…';
    try {
      await flushQueue();
      close();
      toast('同步完成', 'success');
    } catch (err) {
      toast(err.message || '同步失败', 'error');
    }
  });
  const compressBtn = el('button', { class: 'btn', 'data-no-autoclose': '1' }, '压缩队列');
  compressBtn.disabled = queue.length < 2 || offlineState.flushing;
  compressBtn.addEventListener('click', async () => {
    compressBtn.disabled = true;
    compressBtn.textContent = '压缩中…';
    await compressQueue();
    close();
    openSyncDetail();
    toast('队列已压缩', 'info');
  });
  actionRow.appendChild(flushBtn);
  actionRow.appendChild(compressBtn);
  wrap.appendChild(actionRow);

  // 队列列表
  wrap.appendChild(el('div', { class: 'section-title rel-heading' }, `变更队列（${queue.length}）`));
  if (!queue.length) {
    wrap.appendChild(el('div', { class: 'empty' }, '没有待同步的修改'));
  } else {
    const sorted = [...queue].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const list = el('div', { class: 'rel-list sync-queue-list' });
    for (const item of sorted) {
      const meta = mutationMeta(item);
      const summary = mutationSummary(item);
      const isConflict = (item.attempts || 0) > 0 && item.lastError && /Conflict|409/i.test(item.lastError);
      const isError = !isConflict && item.lastError;
      const itemEl = el('div', { class: 'rel-item sync-queue-item' + (isConflict ? ' sync-conflict' : isError ? ' sync-error' : '') });
      const info = el('div', { class: 'rel-info' });
      const top = el('div', { class: 'rel-name' },
        el('span', { class: 'sync-queue-op' }, meta.op),
        ' · ',
        el('span', { class: 'sync-queue-entity' }, entityLabel(meta.entity)),
        ' · ',
        el('span', { class: 'sync-queue-id' }, summary)
      );
      info.appendChild(top);
      const bottom = el('div', { class: 'rel-brief sync-queue-meta' },
        `创建于 ${new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}`
      );
      if (item.attempts) {
        bottom.appendChild(document.createTextNode(` · 已尝试 ${item.attempts} 次`));
      }
      if (isConflict) {
        bottom.appendChild(document.createTextNode(' · 冲突'));
      } else if (isError) {
        bottom.appendChild(document.createTextNode(' · 失败'));
      }
      info.appendChild(bottom);
      if (item.lastError) {
        info.appendChild(el('div', { class: 'sync-queue-error' }, item.lastError));
      }
      itemEl.appendChild(info);

      const actions = el('div', { class: 'sync-queue-actions' });
      if (isConflict || isError) {
        const retryBtn = el('button', { class: 'btn-sm', title: '立即重试' }, '重试');
        retryBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          retryBtn.disabled = true;
          retryBtn.textContent = '…';
          try {
            if (!navigator.onLine) throw new Error('当前离线');
            const res = await fetchWithTimeout(item.url, {
              method: item.method,
              headers: item.headers,
              body: item.body,
            }, 30000, '重试同步');
            if (res.status === 409) {
              const body = await res.json().catch(() => ({}));
              item.attempts = (item.attempts || 0) + 1;
              item.lastError = `Conflict: server updated_at=${body.server_updated_at || 'unknown'}`;
              await idbPut(item);
              throw new Error('与服务端数据冲突');
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            await idbDelete(item.id);
            offlineState.pendingCount = (await idbGetAll()).length;
            updateOfflineBanner();
            close();
            openSyncDetail();
            toast('已同步', 'success');
          } catch (err) {
            toast(err.message || '重试失败', 'error');
            retryBtn.disabled = false;
            retryBtn.textContent = '重试';
          }
        });
        actions.appendChild(retryBtn);
      }
      const dropBtn = el('button', { class: 'btn-sm btn-danger-outline', title: '丢弃此条修改' }, '丢弃');
      dropBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('确定丢弃这条本地修改吗？丢弃后无法恢复。')) return;
        await idbDelete(item.id);
        offlineState.pendingCount = (await idbGetAll()).length;
        updateOfflineBanner();
        close();
        openSyncDetail();
        toast('已丢弃', 'info');
      });
      actions.appendChild(dropBtn);
      itemEl.appendChild(actions);
      list.appendChild(itemEl);
    }
    wrap.appendChild(list);
  }

  const closeBtn = el('button', { class: 'btn' }, '关闭');
  const close = showModal('同步状态', wrap, [closeBtn]);
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
