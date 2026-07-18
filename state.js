/* 全局状态、配置、认证、备份与变更请求 */
'use strict';

const LS_KEY = 'outdoor-dashboard-config';
const CACHE_KEY = 'outdoor-dashboard-snapshot';
const DEFAULT_API = 'https://oxjqquwbnvhgulpkboli.supabase.co/functions/v1';
window.LS_KEY = LS_KEY;
window.CACHE_KEY = CACHE_KEY;
window.DEFAULT_API = DEFAULT_API;
window.state = {
  apiUrl: '',
  token: null,
  data: null, // { profile, gear[], routes[], activities[], body_logs[], plans[], segments[], reports[] }
};

// 离线状态与队列（B2）
window.offlineState = {
  isOnline: navigator.onLine,
  cachedAt: null,
  pendingCount: 0,
  flushing: false,
};
const IDB_NAME = 'outdoor-dashboard';
const IDB_STORE = 'mutation-queue';
const IDB_VERSION = 1;

// 装备库搜索/筛选/排序状态：跨重渲染保留（淘汰/恢复后 loadAndRender 不丢用户当前的筛选）
window.gearFilter = {
  q: '',            // 搜索关键词（名称/品牌/型号/slug/备注）
  category: 'all',  // 类别筛选
  status: 'active', // active(仅在用) / retired(仅淘汰) / all(全部)
  sort: 'category', // category / name / weight / usage
};
function loadConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveConfig(apiUrl, secret) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ apiUrl, secret }));
  } catch { /* 隐私模式可能禁用，忽略 */ }
}

function clearConfig() {
  try {
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_KEY + '-meta');
  } catch { /* ignore */ }
}

/** 读取同步元数据：用于决定是否可增量同步。 */
function loadSyncMeta() {
  try {
    const raw = localStorage.getItem(CACHE_KEY + '-meta');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** 保存同步元数据，包含服务端返回的 lastSyncAt 与当前 App 版本。 */
function saveSyncMeta({ lastSyncAt, cachedAt } = {}) {
  try {
    const meta = {
      cachedAt: cachedAt || new Date().toISOString(),
      lastSyncAt: lastSyncAt || new Date().toISOString(),
      schemaVersion: window.__APP_VERSION || '',
    };
    localStorage.setItem(CACHE_KEY + '-meta', JSON.stringify(meta));
    offlineState.cachedAt = meta.cachedAt;
  } catch { /* 隐私模式可能禁用，忽略 */ }
}

function showAuthError(msg) {
  const e = $('#auth-error');
  e.textContent = msg;
  e.hidden = false;
}

async function connect(apiUrl, secret, remember) {
  console.log('🔵 [connect] 开始，来源=' + (new Error().stack || '').split('\n')[2]?.trim());
  const btn = $('#connect-btn');
  btn.disabled = true;
  btn.textContent = '连接中…';
  $('#auth-error').hidden = true;
  // 关键：一进入连接就立刻切到"纯加载态"——藏登录框、藏看板、只显 spinner。
  // 否则 auth+export 的几秒网络往返期间，#auth-screen 仍亮着且 #loading 浮层叠加，
  // 会出现"登录框 + 转圈 + 上一轮数据"三者同框（用户截图定格的正是这个中间态）。
  $('#auth-screen').hidden = true;
  $('#app').hidden = true;
  $('#loading').hidden = false;
  console.log('🟢 [connect] 已切纯加载态 → ' + dbgState());
  try {
    console.log('🔵 [connect] 请求 token…');
    const token = await fetchToken(apiUrl, secret);
    console.log('🟢 [connect] 拿到 token，长度=' + (token ? token.length : 0));
    state.apiUrl = apiUrl;
    state.token = token;
    if (remember) saveConfig(apiUrl, secret);
    else clearConfig();
    await loadAndRender();
    console.log('🟢 [connect] loadAndRender 完成 → ' + dbgState());
    // UI 切换已收进 loadAndRender 的 showDashboard()，此处无需重复
  } catch (err) {
    console.log('🔴 [connect] 失败: ' + (err && err.message ? err.message : err));
    // 失败必须复位到干净的登录态：关掉 spinner/骨架屏、露出登录框、显示错误。
    // 否则会出现"spinner 卡着 / 骨架屏残留 / 登录框和加载浮层同时盖着"的观感。
    hideSkeletons();
    $('#loading').hidden = true;
    $('#app').hidden = true;
    $('#auth-screen').hidden = false;
    console.log('🟡 [connect] 已复位登录态 → ' + dbgState());
    showAuthError(err.message || String(err));
  } finally {
    btn.disabled = false;
    btn.textContent = '连接';
  }
}

/** 调试用：一行输出当前三态 hidden，方便在 Console 里对照。 */
function dbgState() {
  const a = $('#auth-screen'), p = $('#app'), l = $('#loading');
  return 'auth-screen.hidden=' + (a ? a.hidden : 'nil') +
         ' | app.hidden=' + (p ? p.hidden : 'nil') +
         ' | loading.hidden=' + (l ? l.hidden : 'nil');
}
async function exportBackup() {
  const queue = await idbGetAll();
  const blob = {
    version: window.__APP_VERSION,
    exportedAt: new Date().toISOString(),
    data: state.data,
    pendingQueue: queue,
  };
  const dataStr = JSON.stringify(blob, null, 2);
  const blobObj = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blobObj);
  const a = el('a', { href: url, download: `outdoor-dashboard-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('已导出 JSON 应急备份', 'success');
}
async function importBackup(file) {
  if (!file) return;
  let blob;
  try {
    const text = await file.text();
    blob = JSON.parse(text);
  } catch (err) {
    toast('备份文件解析失败：' + (err.message || err), 'error');
    return;
  }

  if (!blob.data) {
    toast('备份文件缺少 data 字段', 'error');
    return;
  }

  // 1. 恢复本地快照
  state.data = blob.data;
  await saveSnapshot();
  renderAll();

  // 2. 处理待同步队列（如果有）
  const queue = Array.isArray(blob.pendingQueue) ? blob.pendingQueue : [];
  for (const item of queue) {
    if (item && item.method && item.url) {
      await enqueueMutation({ method: item.method, url: item.url, headers: item.headers, body: item.body });
    }
  }

  // 3. 在线时整体再推一次 sync import（更可靠）
  if (navigator.onLine && state.token) {
    try {
      const payload = {
        action: 'import',
        data: {
          gear: (state.data.gear || []).map((g) => ({ slug: g.slug, data: g })),
          routes: (state.data.routes || []).map((r) => ({ slug: r.slug, data: r })),
          activities: (state.data.activities || []).map((a) => ({ date: a.date, route: a.route || '', data: a })),
          body: (state.data.body_logs || []).map((b) => ({ date: b.date, data: b })),
          plans: (state.data.plans || []).map((p) => ({ id: p.id, plan_type: p.plan_type || 'trip', date: p.date, route: p.route || '', data: p })),
          reports: (state.data.reports || []).map((r) => ({ id: r.id, report_type: r.report_type || 'week', period_key: r.period_key, start_date: r.start_date, end_date: r.end_date, data: r, raw_markdown: r._raw_markdown || r.raw_markdown })),
        },
      };
      await fetchWithTimeout(`${apiBase(state.apiUrl)}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${state.token}`,
        },
        body: JSON.stringify(payload),
      }, 60000, '导入备份');
      toast('备份已同步到云端', 'success');
      await loadAndRender(true);
      return;
    } catch (err) {
      toast('在线同步备份失败，已加入离线队列：' + (err.message || err), 'warn');
    }
  }

  updateOfflineBanner();
  toast('备份已恢复到本地，联网后将自动同步', 'info');
}
async function mutateRequest({ url, options, label, optimistic, expectedUpdatedAt }) {
  if (navigator.onLine) {
    const res = await fetchWithTimeout(url, options, 30000, label);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${label}失败 (${res.status})${text ? ': ' + text.slice(0, 120) : ''}`);
    }
    return res.json().catch(() => ({ ok: true }));
  }

  await enqueueMutation({
    method: options.method,
    url,
    headers: options.headers,
    body: options.body,
    expectedUpdatedAt,
  });
  if (optimistic) optimistic();
  updateOfflineBanner();
  return { ok: true, queued: true };
}
