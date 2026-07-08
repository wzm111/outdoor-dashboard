/* 应用入口：加载、渲染、视图切换与初始化 */
'use strict';

// ---------- 加载 + 渲染 ----------

/** 数据上屏后原子切换到看板：隐藏登录框、显示看板、关闭加载浮层。
 *  只要 render 成功就必须调用，避免出现"数据出来了但登录框/spinner 还盖着"。 */
function showDashboard() {
  $('#auth-screen').hidden = true;
  $('#app').hidden = false;
  $('#loading').hidden = true;
  console.log('🟢 [showDashboard] 已切看板 → ' + dbgState());
}

async function loadAndRender(isRefresh = false) {
  console.log('🔵 [loadAndRender] 开始 isRefresh=' + isRefresh);
  // 数据拉取阶段用 app 内骨架屏替代全局 spinner，提前露出顶栏/导航，感知更快。
  $('#loading').hidden = true;
  $('#app').hidden = false;
  $('#sync-status').textContent = '';
  showSkeletons();

  const cached = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; } })();
  const meta = loadSyncMeta();
  // 仅当缓存里确实有过数据时才走增量；空缓存（或只有空数组）必须全量，
  // 否则一旦 meta.lastSyncAt 晚于数据库记录更新时间，增量会返回空并永远覆盖为空。
  const hasCachedData = cached && (
    (Array.isArray(cached.gear) && cached.gear.length > 0) ||
    (Array.isArray(cached.routes) && cached.routes.length > 0) ||
    (Array.isArray(cached.activities) && cached.activities.length > 0) ||
    (Array.isArray(cached.body_logs) && cached.body_logs.length > 0) ||
    (Array.isArray(cached.plans) && cached.plans.length > 0) ||
    (Array.isArray(cached.segments) && cached.segments.length > 0) ||
    cached.profile != null
  );
  const canIncremental = !!hasCachedData && !!meta && !!meta.lastSyncAt && meta.schemaVersion === window.__APP_VERSION;

  try {
    let raw;
    let isDelta = false;
    if (canIncremental) {
      console.log('🔵 [loadAndRender] 尝试增量同步 since=' + meta.lastSyncAt);
      raw = await fetchExport(state.apiUrl, state.token, meta.lastSyncAt);
      isDelta = !!raw.delta;
      console.log('🟢 [loadAndRender] 增量响应 delta=' + isDelta + ' gear=' + (raw.gear ? raw.gear.length : 0));
    } else {
      console.log('🔵 [loadAndRender] 走全量同步');
      raw = await fetchExport(state.apiUrl, state.token);
    }

    if (isDelta) {
      state.data = applySyncDelta(cached || state.data, raw);
      // 兜底：若增量后仍有实体类型为空（且服务端也没给这部分数据），很可能是历史损坏缓存。
      // 自动再跑一次全量同步补全，避免用户必须手动点「清除缓存」。
      const stillMissing = ['gear', 'routes', 'segments'].filter((k) => {
        const cachedEmpty = !cached || !Array.isArray(cached[k]) || cached[k].length === 0;
        const deltaEmpty = !Array.isArray(raw[k]) || raw[k].length === 0;
        const deletedEmpty = !raw.deleted || !Array.isArray(raw.deleted[k]) || raw.deleted[k].length === 0;
        return cachedEmpty && deltaEmpty && deletedEmpty;
      });
      if (stillMissing.length > 0 && !isRefresh) {
        console.log('🟡 [loadAndRender] 增量后 ' + stillMissing.join('/') + ' 仍为空，自动回退全量同步');
        raw = await fetchExport(state.apiUrl, state.token);
        isDelta = false;
        state.data = {
          profile: unwrap(raw.profile),
          gear: unwrapList(raw.gear),
          routes: unwrapList(raw.routes),
          activities: unwrapList(raw.activities),
          body_logs: unwrapList(raw.body_logs),
          plans: unwrapList(raw.plans),
          segments: unwrapList(raw.segments),
        };
      }
    } else {
      state.data = {
        profile: unwrap(raw.profile),
        gear: unwrapList(raw.gear),
        routes: unwrapList(raw.routes),
        activities: unwrapList(raw.activities),
        body_logs: unwrapList(raw.body_logs),
        plans: unwrapList(raw.plans),
        segments: unwrapList(raw.segments),
      };
    }

    await saveSnapshot();
    saveSyncMeta({ lastSyncAt: raw.server_now || new Date().toISOString() });
    hideSkeletons();
    renderAll();
    showDashboard();
    $('#sync-status').textContent = isDelta ? '✓ 已增量同步' : '✓ 已同步';
  } catch (err) {
    console.log('🔴 [loadAndRender] 失败: ' + (err && err.message ? err.message : err));
    hideSkeletons();
    // 失败时尝试用缓存快照（离线/PWA）
    if (cached) {
      state.data = cached;
      renderAll();
      showDashboard();
      $('#sync-status').textContent = '离线快照';
    } else if (!isRefresh) {
      throw err;
    } else {
      $('#sync-status').textContent = '刷新失败';
    }
  } finally {
    hideSkeletons(); // 确保任何情况下骨架屏都被清理
  }
}

/** 将服务端增量包合并到本地 state.data：updated 按主键 upsert，deleted 按主键移除。 */
function applySyncDelta(currentData, delta) {
  if (!currentData || !delta) return currentData;
  const result = { ...currentData };

  const upsertByKey = (arr, rows, keyFn) => {
    if (!Array.isArray(rows) || !Array.isArray(arr)) return arr;
    const list = arr.slice();
    for (const row of rows) {
      const item = unwrap(row);
      const key = keyFn(item);
      const idx = list.findIndex((x) => String(keyFn(x)) === String(key));
      if (idx >= 0) list[idx] = item;
      else list.push(item);
    }
    return list;
  };

  const removeByKey = (arr, keys, keyFn) => {
    if (!Array.isArray(keys) || !keys.length || !Array.isArray(arr)) return arr;
    const keySet = new Set(keys.map(String));
    return arr.filter((x) => !keySet.has(String(keyFn(x))));
  };

  if (delta.profile) result.profile = unwrap(delta.profile);

  result.gear = upsertByKey(result.gear, delta.gear, (g) => g.slug);
  result.routes = upsertByKey(result.routes, delta.routes, (r) => r.slug);
  result.activities = upsertByKey(result.activities, delta.activities, (a) => a.id);
  result.body_logs = upsertByKey(result.body_logs, delta.body_logs, (b) => b.date);
  result.plans = upsertByKey(result.plans, delta.plans, (p) => p.id);
  result.segments = upsertByKey(result.segments, delta.segments, (s) => s.slug);

  const deleted = delta.deleted || {};
  result.gear = removeByKey(result.gear, deleted.gear, (g) => g.slug);
  result.routes = removeByKey(result.routes, deleted.routes, (r) => r.slug);
  result.activities = removeByKey(result.activities, deleted.activities, (a) => a.id);
  result.body_logs = removeByKey(result.body_logs, deleted.body_logs, (b) => b.date);
  result.plans = removeByKey(result.plans, deleted.plans, (p) => p.id);
  result.segments = removeByKey(result.segments, deleted.segments, (s) => s.slug);

  return result;
}

function renderAll() {
  renderOverview();
  renderActivities();
  renderBody();
  renderGear();
  renderRoutes();
  renderPlans();
  renderReports();
  const d = state.data;
  $('#data-meta').textContent =
    `装备 ${d.gear.length} · 路线 ${d.routes.length} · 活动 ${d.activities.length} · ` +
    `身体记录 ${d.body_logs.length} · 计划 ${d.plans.length} · 路段 ${d.segments.length}`;
}

function viewEl(name) { return $(`.view[data-view="${name}"]`); }

/** 清除本地缓存与同步元数据，并立即重新拉取全量数据。用于修复“增量同步为空”等缓存不一致问题。 */
async function clearCacheAndReload() {
  if (!confirm('确定清除本地缓存并重新从云端拉取全量数据吗？\n（不会删除云端数据）')) return;
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_KEY + '-meta');
  } catch { /* ignore */ }
  state.data = null;
  await loadAndRender(true);
  toast('已清除缓存并重新同步', 'success');
}

const DEFAULT_VIEW = 'overview';
const VALID_VIEWS = ['overview', 'activities', 'body', 'gear', 'routes', 'plans', 'reports'];
const MORE_VIEWS = ['routes', 'plans', 'reports'];

/** 从 URL hash 解析当前视图，非法或空时回退到总览。 */
function viewFromHash() {
  const hash = window.location.hash.replace(/^#/, '').trim();
  return VALID_VIEWS.includes(hash) ? hash : DEFAULT_VIEW;
}

// ---------- tab 切换 ----------

function switchView(name, { updateHash = true } = {}) {
  const target = VALID_VIEWS.includes(name) ? name : DEFAULT_VIEW;

  // 顶部 tab（桌面端）
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === target));

  // 底部 tab（移动端）
  $$('.bottom-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === target);
  });
  $$('.bottom-tab-more').forEach((t) => {
    t.classList.toggle('active', MORE_VIEWS.includes(target));
  });

  // 「更多」菜单项
  $$('.bottom-more-item').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === target);
  });

  // 视图显隐
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== target; });
  if (updateHash) {
    const newHash = target === DEFAULT_VIEW ? '' : `#${target}`;
    // 仅在真正变化时更新 hash，避免把空 hash 写成 '#overview'
    if (newHash !== window.location.hash) {
      history.replaceState(null, '', newHash || window.location.pathname + window.location.search);
    }
  }
}

// ---------- 移动端底部导航「更多」菜单 ----------

function toggleBottomMore() {
  const menu = $('#bottom-more-menu');
  const btn = $('#bottom-tab-more');
  if (!menu || !btn) return;
  const willOpen = !menu.classList.contains('open');
  menu.classList.toggle('open', willOpen);
  menu.hidden = !willOpen;
  btn.setAttribute('aria-expanded', String(willOpen));
}

function closeBottomMore() {
  const menu = $('#bottom-more-menu');
  const btn = $('#bottom-tab-more');
  if (!menu) return;
  menu.classList.remove('open');
  menu.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

// ---------- Service Worker 更新提示 ----------

function initServiceWorkerUpdates(registration) {
  let promptShown = false;
  let pendingVersion = null;

  function showUpdatePrompt(version) {
    if (promptShown) return;
    promptShown = true;

    const versionLabel = version ? `（${version}）` : '';
    const content = el('p', {}, `检测到新版本${versionLabel}，是否立即刷新？`);
    const refreshBtn = el(
      'button',
      { class: 'btn btn-primary', 'data-no-autoclose': '' },
      '立即刷新'
    );
    const dismissBtn = el('button', { class: 'btn' }, '稍后再说');

    const close = showModal('新版本可用', content, [refreshBtn, dismissBtn], () => {
      promptShown = false;
    });

    refreshBtn.addEventListener('click', () => window.location.reload());
  }

  // 新版 SW 安装完成后会主动通知我们它的版本
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event && event.data;
    if (!data || data.type !== 'SW_UPDATE_AVAILABLE') return;
    pendingVersion = data.version || pendingVersion;
    if (navigator.serviceWorker.controller) {
      showUpdatePrompt(pendingVersion);
    }
  });

  // 浏览器自己发现新版 SW 并进入 installed 状态时的兜底
  registration.addEventListener('updatefound', () => {
    const newWorker = registration.installing;
    if (!newWorker) return;
    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
        showUpdatePrompt(pendingVersion);
      }
    });
  });

  // 其他标签页已接受更新，新 SW 接管本页时给出轻量提示
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('[SW] controllerchange');
    toast('应用已更新，刷新后使用最新版本', 'info');
  });

  // 长运行会话：每小时主动检查一次更新
  setInterval(() => {
    registration.update().catch((err) => console.warn('[SW] 主动检查更新失败', err));
  }, 60 * 60 * 1000);
}

// ---------- 初始化 ----------

function init() {
  // 预填配置
  const saved = loadConfig();
  $('#api-url').value = (saved && saved.apiUrl) || DEFAULT_API;
  if (saved && saved.secret) $('#api-secret').value = saved.secret;

  $('#connect-btn').addEventListener('click', () => {
    const apiUrl = $('#api-url').value.trim();
    const secret = $('#api-secret').value.trim();
    const remember = $('#remember').checked;
    if (!apiUrl || !secret) { showAuthError('请填写 API 地址和访问密钥'); return; }
    connect(apiUrl, secret, remember);
  });

  $('#api-secret').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#connect-btn').click();
  });

  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) switchView(btn.dataset.view);
  });

  // 底部 tab（移动端）
  const bottomNav = $('#bottom-nav');
  if (bottomNav) {
    bottomNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.bottom-tab');
      if (!btn) return;
      if (btn.id === 'bottom-tab-more') {
        toggleBottomMore();
        return;
      }
      closeBottomMore();
      switchView(btn.dataset.view);
    });
  }

  // 「更多」菜单项
  const bottomMoreMenu = $('#bottom-more-menu');
  if (bottomMoreMenu) {
    bottomMoreMenu.addEventListener('click', (e) => {
      const btn = e.target.closest('.bottom-more-item');
      if (!btn) return;
      closeBottomMore();
      switchView(btn.dataset.view);
    });
  }

  // 点击外部或按 Esc 关闭「更多」菜单
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#bottom-nav') && !e.target.closest('#bottom-more-menu')) {
      closeBottomMore();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('.modal-overlay')) closeBottomMore();
  });

  // 浏览器前进/后退时根据 hash 切换视图
  window.addEventListener('hashchange', () => {
    switchView(viewFromHash(), { updateHash: false });
    closeBottomMore();
  });

  $('#refresh-btn').addEventListener('click', () => loadAndRender(true));

  $('#logout-btn').addEventListener('click', () => {
    clearConfig();
    state.token = null;
    state.data = null;
    $('#api-secret').value = '';
    $('#app').hidden = true;
    $('#auth-screen').hidden = false;
    $('#loading').hidden = true;
  });

  // 应急备份导出/导入 + 清除缓存强制全量同步
  $('#export-backup-btn').addEventListener('click', exportBackup);
  $('#import-backup-btn').addEventListener('click', () => $('#import-backup-input').click());
  $('#clear-cache-btn').addEventListener('click', clearCacheAndReload);
  $('#import-backup-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importBackup(file);
    e.target.value = ''; // 允许重复导入同一文件
  });

  // 自动连接：只要输入框里已有 API 地址 + 密钥就尝试连一次。
  // 不只看 localStorage——即便密钥还没被「记住」（saveConfig 未跑过），
  // 只要框里预填了值也自动连，避免用户以为填了就行、却停在登录框干等。
  const preUrl = $('#api-url').value.trim();
  const preSecret = $('#api-secret').value.trim();
  console.log('🔵 [init] DOM就绪 初始三态 → ' + dbgState() +
    ' | 预填 url=' + (preUrl ? '有' : '无') + ' secret=' + (preSecret ? '有(len=' + preSecret.length + ')' : '无') +
    ' | localStorage=' + (loadConfig() ? '有配置' : '空'));

  // 根据 URL hash 预选中对应 tab（刷新后保留当前视图）
  switchView(viewFromHash(), { updateHash: false });

  if (preUrl && preSecret) {
    console.log('🟢 [init] 触发自动连接');
    connect(preUrl, preSecret, $('#remember').checked);
  } else {
    console.log('🟡 [init] 不自动连接，停在登录框等手动点击');
  }

  // 注册 service worker（PWA），加版本戳避免旧 SW 被 CDN/浏览器缓存钉死
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register(`service-worker.js?v=${window.__APP_VERSION || Date.now()}`)
        .then((reg) => initServiceWorkerUpdates(reg))
        .catch((err) => console.warn('[SW] 注册失败', err));
    });
  }

  initOffline();
}

init();
