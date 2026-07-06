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
  const loading = $('#loading');
  loading.hidden = false;
  $('#sync-status').textContent = '';
  try {
    const raw = await fetchExport(state.apiUrl, state.token);
    console.log('🟢 [loadAndRender] 拿到数据 gear=' + (raw.gear ? raw.gear.length : '?') + ' activities=' + (raw.activities ? raw.activities.length : '?'));
    state.data = {
      profile: unwrap(raw.profile),
      gear: unwrapList(raw.gear),
      routes: unwrapList(raw.routes),
      activities: unwrapList(raw.activities),
      body_logs: unwrapList(raw.body_logs),
      plans: unwrapList(raw.plans),
      segments: unwrapList(raw.segments),
    };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(state.data));
      offlineState.cachedAt = new Date().toISOString();
      try { localStorage.setItem(CACHE_KEY + '-meta', JSON.stringify({ cachedAt: offlineState.cachedAt })); } catch {}
    } catch {}
    renderAll();
    showDashboard();
    $('#sync-status').textContent = '✓ 已同步';
  } catch (err) {
    // 失败时尝试用缓存快照（离线/PWA）
    const cached = (() => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; } })();
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
    loading.hidden = true;
  }
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
// ---------- tab 切换 ----------

function switchView(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
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

  // 应急备份导出/导入
  $('#export-backup-btn').addEventListener('click', exportBackup);
  $('#import-backup-btn').addEventListener('click', () => $('#import-backup-input').click());
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
  if (preUrl && preSecret) {
    console.log('🟢 [init] 触发自动连接');
    connect(preUrl, preSecret, $('#remember').checked);
  } else {
    console.log('🟡 [init] 不自动连接，停在登录框等手动点击');
  }

  // 注册 service worker（PWA）
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }

  initOffline();
}

init();
