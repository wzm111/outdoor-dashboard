/* 户外助手看板 — 纯 vanilla JS，无构建步骤、无第三方库。
 *
 * 数据流：api_secret → POST /api/auth/token → JWT → POST /api/sync {action:"export"}
 * 一次性拉全量数据，客户端渲染。密钥仅存浏览器 localStorage，绝不入库。
 */
'use strict';

// 运行时版本号：每次改前端 bump 一次，方便在 Console 里核对当前跑的是不是新版（window.__APP_VERSION）
const APP_VERSION = 'v13-2026-07-01';
window.__APP_VERSION = APP_VERSION;
console.log('%c[户外看板] app.js 已加载 版本=' + APP_VERSION, 'background:#4fb477;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold');

const LS_KEY = 'outdoor-dashboard-config';
const CACHE_KEY = 'outdoor-dashboard-snapshot';
const DEFAULT_API = 'https://oxjqquwbnvhgulpkboli.supabase.co/functions/v1';

const state = {
  apiUrl: '',
  token: null,
  data: null, // { profile, gear[], routes[], activities[], body_logs[], plans[], segments[] }
};

// 装备库搜索/筛选/排序状态：跨重渲染保留（淘汰/恢复后 loadAndRender 不丢用户当前的筛选）
const gearFilter = {
  q: '',            // 搜索关键词（名称/品牌/型号/slug/备注）
  category: 'all',  // 类别筛选
  status: 'active', // active(仅在用) / retired(仅淘汰) / all(全部)
  sort: 'category', // category / name / weight / usage
};

// ---------- 工具 ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** 从用户粘贴的商品规格文本中，尽可能提取结构化字段。 */
function parseSpecText(text) {
  const out = {};
  if (!text) return out;
  const t = String(text);

  // 重量：匹配 "重量：380g" / "约 380 克" / "380g" 等
  const weightMatch = t.match(/(?:重量|净重|约)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(g|克|kg|千克|lb|磅)/i);
  if (weightMatch) {
    const v = Number(weightMatch[1]);
    const unit = weightMatch[2].toLowerCase();
    out.weight_g = unit.startsWith('kg') || unit.startsWith('千克') ? Math.round(v * 1000)
      : unit.startsWith('lb') || unit.startsWith('磅') ? Math.round(v * 453.592)
      : Math.round(v);
  }

  // 防水 / 透气
  if (/gore-tex|event|pertex|h2no|dry.q|防水|waterproof/i.test(t)) {
    out.waterproof = true;
  }
  if (/gore-tex|透气|breathable|吸湿排汗/i.test(t)) {
    if (out.breathable == null) out.breathable = true;
  }

  // 材质 / 面料
  const matMatch = t.match(/(?:材质|面料|fabric|material)[:：]?\s*([^\n，。]+)/i);
  if (matMatch) out.material = matMatch[1].trim();

  // 价格
  const priceMatch = t.match(/(?:价格|售价|京东价|天猫价|到手价)[:：]?\s*[¥￥$€]?\s*(\d+(?:\.\d+)?)/);
  if (priceMatch) out.price = Number(priceMatch[1]);

  // 颜色 / 尺码
  const colorMatch = t.match(/(?:颜色|适用性别|颜色类别)[:：]?\s*([^\n，。]+)/i);
  if (colorMatch) out.color = colorMatch[1].trim();
  const sizeMatch = t.match(/(?:尺码|尺寸|size)[:：]?\s*([^\n，。]+)/i);
  if (sizeMatch) out.size = sizeMatch[1].trim();

  // 户外相关：保暖等级、季节、适用地形
  const warmthMatch = t.match(/(?:保暖|厚度|warmth)[:：]?\s*(none|light|medium|heavy|无|轻|中|厚)/i);
  if (warmthMatch) {
    const map = { 无: 'none', 轻: 'light', 中: 'medium', 厚: 'heavy' };
    out.warmth = map[warmthMatch[1]] || warmthMatch[1].toLowerCase();
  }
  const seasonMatch = t.match(/(?:季节|seasons?)[:：]?\s*([^\n，。]+)/i);
  if (seasonMatch) {
    out.seasons = seasonMatch[1].split(/[,，/、]/).map((s) => s.trim()).filter(Boolean);
  }
  const terrainMatch = t.match(/(?:地形|terrain)[:：]?\s*([^\n，。]+)/i);
  if (terrainMatch) {
    out.terrain = terrainMatch[1].split(/[,，/、]/).map((s) => s.trim()).filter(Boolean);
  }

  return out;
}

/** 创建并显示一个模态弹窗。返回关闭函数。 */
function showModal(title, contentNode, buttons = []) {
  const overlay = el('div', { class: 'modal-overlay' });
  const box = el('div', { class: 'modal-box' });
  const header = el('div', { class: 'modal-header' },
    el('span', {}, title),
    el('button', { class: 'modal-close', 'aria-label': '关闭' }, '×')
  );
  const body = el('div', { class: 'modal-body' });
  body.appendChild(contentNode);
  const footer = el('div', { class: 'modal-footer' });

  box.appendChild(header);
  box.appendChild(body);
  if (buttons.length) box.appendChild(footer);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const closeBtn = $('.modal-close', overlay);
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  for (const b of buttons) {
    // 底部按钮默认点击关闭弹窗；调用方可额外绑定自己的逻辑
    b.addEventListener('click', close);
  }

  return close;
}

/** 把两个对象浅合并：src 非 null 字段覆盖 dst。 */
function mergeGearData(dst, src) {
  const out = { ...dst };
  for (const [k, v] of Object.entries(src)) {
    if (v != null && v !== '') out[k] = v;
  }
  return out;
}

/** 把扁平对象重新包成 Edge Function 保存 gear 时需要的 { data, raw_markdown? } 结构。 */
function packGearPayload(data) {
  const copy = { ...data };
  delete copy.slug;
  delete copy._raw_markdown;
  delete copy._updated_at;
  delete copy._path;
  return { data: copy };
}

/** 从装备对象里取出可用的商品 URL。 */
function getGearSourceUrl(g) {
  return g.source_url || g.url || g.link || g.purchase_url || '';
}

/** 把装备数据渲染成只读键值列表。 */
function gearFactList(g) {
  const facts = [
    ['slug', g.slug],
    ['名称', g.name],
    ['类别', g.category],
    ['类型', g.type],
    ['品牌', g.brand],
    ['型号', g.model],
    ['重量', g.weight_g != null ? num(g.weight_g, 0) + ' g' : null],
    ['防水', g.waterproof === true ? '是' : g.waterproof === false ? '否' : null],
    ['透气', g.breathable === true ? '是' : g.breathable === false ? '否' : null],
    ['材质', g.material],
    ['保暖', g.warmth],
    ['季节', Array.isArray(g.seasons) ? g.seasons.join('、') : g.seasons],
    ['地形', Array.isArray(g.terrain) ? g.terrain.join('、') : g.terrain],
    ['使用次数', g.usage_count],
    ['状态', g.condition],
    ['价格', g.price != null ? '¥' + num(g.price, 0) : null],
    ['颜色', g.color],
    ['尺码', g.size],
    ['备注', g.notes],
    ['商品链接', g.source_url],
  ].filter(([, v]) => v != null && v !== '');

  const list = el('ul', { class: 'detail-list' });
  for (const [k, v] of facts) {
    const li = el('li', {}, el('strong', {}, k + '：'));
    if (k === '商品链接' && String(v).startsWith('http')) {
      li.appendChild(el('a', { href: v, target: '_blank', rel: 'noopener' }, v));
    } else {
      li.appendChild(document.createTextNode(v));
    }
    list.appendChild(li);
  }
  return list;
}

/** 通用消息提示。 */
function toast(msg, type = 'info') {
  const t = el('div', { class: `toast toast-${type}` }, msg);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, 3000);
}

/** 把 export 返回的 DB 行 {slug/date, data, raw_markdown} 解包成扁平结构，对齐脚本侧 _unwrap。 */
function unwrap(row) {
  if (!row || typeof row !== 'object') return row;
  if (!('data' in row)) return row;
  let inner = row.data;
  while (inner && typeof inner === 'object' && inner.data && typeof inner.data === 'object') {
    inner = inner.data;
  }
  if (!inner || typeof inner !== 'object') return row;
  const flat = { ...inner };
  if ('slug' in row) flat.slug = row.slug;
  if ('date' in row) flat.date = row.date;
  if ('route' in row && flat.route == null) flat.route = row.route;
  if ('name' in row && flat.name == null) flat.name = row.name;
  if ('plan_type' in row) flat.plan_type = row.plan_type;
  return flat;
}

function unwrapList(rows) {
  return Array.isArray(rows) ? rows.map(unwrap) : [];
}

function num(v, digits = 1) {
  if (v == null || v === '' || isNaN(Number(v))) return '—';
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

function fmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

/** 把小时数格式化为 HH:MM:SS，用于跑步等需要精确到秒的场景。 */
function fmtDuration(hours) {
  if (hours == null || isNaN(Number(hours))) return '—';
  const totalSec = Math.round(Number(hours) * 3600);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/** 计算配速（分钟/公里）。 */
function paceMinPerKm(distanceKm, hours) {
  const d = Number(distanceKm);
  const t = Number(hours);
  if (!d || !t || d <= 0 || t <= 0) return null;
  const minPerKm = (t * 60) / d;
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}/km`;
}

/** 判断活动是否为跑步。 */
function isRunning(a) {
  return /run|跑步|配速/i.test(String(a.type || ''));
}

// ---------- 网络 ----------

function apiBase(url) {
  let b = (url || '').trim().replace(/\/+$/, '');
  if (!b.endsWith('/api')) b += '/api';
  return b;
}

/** 带超时的 fetch：超时主动 abort，避免请求无限 pending 导致页面永久“加载中”。 */
async function fetchWithTimeout(url, options, timeoutMs, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`${label}超时（${Math.round(timeoutMs / 1000)}s）。请检查网络或 API 地址是否可达。`);
    }
    // 跨域/网络层失败时浏览器只给 "Failed to fetch"，补充可能原因
    throw new Error(`${label}失败：${err && err.message ? err.message : err}（可能是网络不通或 CORS）`);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchToken(apiUrl, secret) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ secret }),
  }, 15000, '认证');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`认证失败 (${res.status})${text ? ': ' + text.slice(0, 120) : ''}`);
  }
  const json = await res.json();
  if (!json.token) throw new Error('认证响应缺少 token');
  return json.token;
}

async function fetchExport(apiUrl, token) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 'export' }),
  }, 30000, '拉取数据');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`拉取数据失败 (${res.status})${text ? ': ' + text.slice(0, 120) : ''}`);
  }
  return res.json();
}

async function fetchSaveGear(apiUrl, token, slug, data) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/gear/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  }, 15000, '保存装备');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`保存装备失败 (${res.status})${text ? ': ' + text.slice(0, 120) : ''}`);
  }
  return res.json();
}

async function fetchScrapeGear(apiUrl, token, url) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/scrape/gear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ url }),
  }, 30000, '抓取装备信息');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`抓取失败 (${res.status})${text ? ': ' + text.slice(0, 120) : ''}`);
  }
  return res.json();
}

async function fetchAiGear(apiUrl, token, text, sourceUrl) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/ai/gear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ text, source_url: sourceUrl }),
  }, 45000, 'AI 识别装备');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI 识别失败 (${res.status})${text ? ': ' + text.slice(0, 120) : ''}`);
  }
  return res.json();
}

// ---------- 登录流程 ----------

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
  } catch { /* ignore */ }
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
    // 失败必须复位到干净的登录态：关掉 spinner、露出登录框、显示错误。
    // 否则会出现"spinner 卡着 / 登录框和加载浮层同时盖着"的观感。
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
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.data)); } catch {}
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
      $('#sync-status').textContent = '⚠ 离线快照';
    } else if (!isRefresh) {
      throw err;
    } else {
      $('#sync-status').textContent = '⚠ 刷新失败';
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
  const d = state.data;
  $('#data-meta').textContent =
    `装备 ${d.gear.length} · 路线 ${d.routes.length} · 活动 ${d.activities.length} · ` +
    `身体记录 ${d.body_logs.length} · 计划 ${d.plans.length} · 路段 ${d.segments.length}`;
}

function viewEl(name) { return $(`.view[data-view="${name}"]`); }

// ---------- 总览 ----------

function renderOverview() {
  const d = state.data;
  const acts = d.activities;
  const totalDist = acts.reduce((s, a) => s + (Number(a.distance_km) || 0), 0);
  const totalGain = acts.reduce((s, a) => s + (Number(a.elevation_gain_m) || 0), 0);
  const totalHours = acts.reduce((s, a) => s + (Number(a.duration_hours) || 0), 0);

  // 最近 30 天里程
  const now = new Date();
  const ms30 = 30 * 24 * 3600 * 1000;
  const dist30 = acts
    .filter((a) => a.date && (now - new Date(a.date)) <= ms30)
    .reduce((s, a) => s + (Number(a.distance_km) || 0), 0);

  const profile = d.profile || {};

  const view = viewEl('overview');
  view.innerHTML = '';
  view.appendChild(
    el('div', { class: 'stat-grid' },
      statCard('总活动', acts.length, '次'),
      statCard('累计里程', num(totalDist, 1), 'km'),
      statCard('近 30 天里程', num(dist30, 1), 'km'),
      statCard('累计爬升', num(totalGain, 0), 'm'),
      statCard('累计时长', num(totalHours, 1), 'h'),
      statCard('装备数', d.gear.length, '件'),
    )
  );

  // 档案卡片
  if (Object.keys(profile).length) {
    view.appendChild(el('div', { class: 'section-title' }, '👤 体能档案'));
    const rows = [
      ['体能水平', profile.fitness_level],
      ['周里程目标', profile.weekly_mileage_km != null ? profile.weekly_mileage_km + ' km' : null],
      ['平路配速', profile.typical_pace_flat],
      ['爬坡配速', profile.typical_pace_climb],
      ['怕冷', profile.cold_tolerance],
      ['常见不适', Array.isArray(profile.common_issues) ? profile.common_issues.join('、') : profile.common_issues],
    ].filter(([, v]) => v != null && v !== '');
    const card = el('div', { class: 'card' });
    for (const [k, v] of rows) {
      card.appendChild(el('div', {}, el('span', { class: 'badge' }, k), ' ', String(v)));
    }
    view.appendChild(card);
  }

  // 最近活动
  view.appendChild(el('div', { class: 'section-title' }, '🗓️ 最近活动'));
  const recent = [...acts].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5);
  if (recent.length) {
    view.appendChild(activityTable(recent));
  } else {
    view.appendChild(el('div', { class: 'empty' }, '暂无活动记录'));
  }
}

function statCard(label, value, unit) {
  return el('div', { class: 'stat-card' },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, String(value), unit ? el('span', { class: 'unit' }, ' ' + unit) : null),
  );
}

// ---------- 活动 ----------

function activityTable(acts) {
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  const headerCells = [
    el('th', {}, '日期'), el('th', {}, '路线'), el('th', {}, '类型'),
    el('th', {}, '距离'), el('th', {}, '爬升'),
  ];
  // 跑步显示精确时长 + 配速；徒步/爬山显示普通时长
  const hasRun = acts.some(isRunning);
  headerCells.push(el('th', {}, '时长'));
  if (hasRun) headerCells.push(el('th', {}, '配速'));
  headerCells.push(el('th', {}, '平均心率'), el('th', {}, '感受'));
  table.appendChild(el('thead', {}, el('tr', {}, ...headerCells)));

  const tbody = el('tbody');
  for (const a of acts) {
    const running = isRunning(a);
    const pace = running ? paceMinPerKm(a.distance_km, a.duration_hours) : null;
    const duration = running ? fmtDuration(a.duration_hours) : num(a.duration_hours) + ' h';
    const cells = [
      el('td', {}, fmtDate(a.date)),
      el('td', {}, a.route || '—'),
      el('td', {}, a.type || '—'),
      el('td', { class: 'num' }, num(a.distance_km) + ' km'),
      el('td', { class: 'num' }, num(a.elevation_gain_m, 0) + ' m'),
      el('td', { class: 'num' }, duration),
    ];
    if (hasRun) cells.push(el('td', { class: 'num' }, pace || '—'));
    cells.push(
      el('td', { class: 'num' }, a.avg_hr ? num(a.avg_hr, 0) : '—'),
      el('td', {}, feltStars(a.felt))
    );
    tbody.appendChild(el('tr', {}, ...cells));
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function feltStars(felt) {
  const map = { easy: 1, moderate: 2, hard: 3, 'very hard': 4, extreme: 5 };
  const n = map[String(felt || '').toLowerCase().trim()] || 0;
  if (!n) return '—';
  const filled = '★'.repeat(n);
  const empty = '☆'.repeat(5 - n);
  return el('span', { class: 'stars', title: felt }, filled + empty);
}

function activityTypeGroup(type) {
  const t = String(type || '').toLowerCase();
  if (/run|跑步|配速/.test(t)) return 'running';
  if (/hike|hiking|徒步|爬山|登山|trail/.test(t)) return 'hiking';
  return 'other';
}

function activityGroupLabel(group) {
  return { running: '🏃 跑步', hiking: '🥾 徒步/爬山', other: '📌 其他' }[group] || '📌 其他';
}

function renderActivities() {
  const acts = [...state.data.activities].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const view = viewEl('activities');
  view.innerHTML = '';
  view.appendChild(el('div', { class: 'section-title' }, `🏃 全部活动（${acts.length}）`));

  if (!acts.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无活动记录'));
    return;
  }

  const groups = { running: [], hiking: [], other: [] };
  for (const a of acts) {
    const g = activityTypeGroup(a.type);
    groups[g].push(a);
  }

  for (const key of ['running', 'hiking', 'other']) {
    const list = groups[key];
    if (!list.length) continue;
    view.appendChild(el('div', { class: 'subsection-title' }, `${activityGroupLabel(key)}（${list.length}）`));
    view.appendChild(activityTable(list));
  }
}

// ---------- 身体趋势（canvas 折线） ----------

function renderBody() {
  const logs = [...state.data.body_logs]
    .filter((b) => b.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const view = viewEl('body');
  view.innerHTML = '';
  view.appendChild(el('div', { class: 'section-title' }, `💪 身体趋势（${logs.length} 条记录）`));

  if (!logs.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无身体记录'));
    return;
  }

  view.appendChild(lineChartCard('体重 (kg)', logs, 'weight_kg', '#5aa9e6'));
  view.appendChild(lineChartCard('疲劳度 (1-10)', logs, 'fatigue', '#e0a458', 0, 10));
  view.appendChild(lineChartCard('睡眠 (小时)', logs, 'sleep_hours', '#4fb477', 0, 12));
  view.appendChild(lineChartCard('肌肉酸痛 (1-10)', logs, 'muscle_soreness', '#e06c75', 0, 10));
}

function lineChartCard(title, logs, field, color, forceMin, forceMax) {
  const card = el('div', { class: 'chart-card' });
  card.appendChild(el('h3', {}, title));
  const points = logs
    .map((l) => ({ date: l.date, v: Number(l[field]) }))
    .filter((p) => !isNaN(p.v));
  if (!points.length) {
    card.appendChild(el('div', { class: 'empty' }, '无数据'));
    return card;
  }
  const canvas = el('canvas');
  card.appendChild(canvas);
  // 延迟到插入 DOM 后绘制（拿得到宽度）
  requestAnimationFrame(() => drawLine(canvas, points, color, forceMin, forceMax));
  return card;
}

function drawLine(canvas, points, color, forceMin, forceMax) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = 180;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const padL = 44, padR = 12, padT = 12, padB = 26;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  const vals = points.map((p) => p.v);
  let min = forceMin != null ? forceMin : Math.min(...vals);
  let max = forceMax != null ? forceMax : Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.1;
  if (forceMin == null) min -= pad;
  if (forceMax == null) max += pad;

  const x = (i) => padL + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v) => padT + h - ((v - min) / (max - min)) * h;

  const css = getComputedStyle(document.body);
  const gridColor = css.getPropertyValue('--border').trim() || '#2a3340';
  const dimColor = css.getPropertyValue('--text-dim').trim() || '#9aa7b4';

  // 网格 + Y 轴刻度
  ctx.strokeStyle = gridColor;
  ctx.fillStyle = dimColor;
  ctx.font = '11px sans-serif';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gv = min + ((max - min) * i) / 4;
    const gy = y(gv);
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(cssW - padR, gy);
    ctx.stroke();
    ctx.fillText(gv.toFixed(gv >= 100 ? 0 : 1), 4, gy + 4);
  }

  // 折线
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = x(i), py = y(p.v);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // 数据点
  ctx.fillStyle = color;
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(p.v), 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // X 轴首尾日期
  ctx.fillStyle = dimColor;
  ctx.fillText(fmtDate(points[0].date), padL, cssH - 8);
  if (points.length > 1) {
    const lastLabel = fmtDate(points[points.length - 1].date);
    const tw = ctx.measureText(lastLabel).width;
    ctx.fillText(lastLabel, cssW - padR - tw, cssH - 8);
  }
}

// ---------- 装备 ----------

function renderGear() {
  const allGear = state.data.gear;
  const view = viewEl('gear');
  view.innerHTML = '';

  // 顶部标题 + AI 添加按钮
  const headerRow = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, `🎒 装备库（${allGear.length}）`),
    el('button', { class: 'btn-sm btn-primary', 'data-action': 'add-ai' }, '✨ AI 添加')
  );
  view.appendChild(headerRow);
  $('.btn-sm[data-action="add-ai"]', headerRow).addEventListener('click', () => openAddGearByAi());

  if (!allGear.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无装备'));
    return;
  }

  // 搜索/筛选/排序工具条 + 结果计数容器（计数在 applyGearFilter 内更新）
  const countLabel = el('span', { class: 'gear-filter-count' }, '');
  view.appendChild(buildGearToolbar(allGear, view, countLabel));

  // 结果渲染区：独立容器，改动筛选条件时只重渲染这里，不动工具条（否则输入框会失焦）
  const resultsBox = el('div', { class: 'gear-results' });
  view.appendChild(resultsBox);

  applyGearFilter(allGear, resultsBox, countLabel);
}

/** 构建装备工具条：搜索框 + 类别 + 状态 + 排序。改动即重算结果。 */
function buildGearToolbar(allGear, view, countLabel) {
  const bar = el('div', { class: 'gear-toolbar' });

  // 关键：重算时只重渲染结果区，不重建工具条，避免搜索框失焦
  const rerun = () => {
    const resultsBox = $('.gear-results', view);
    if (resultsBox) applyGearFilter(allGear, resultsBox, countLabel);
  };

  // 搜索框
  const search = el('input', {
    class: 'gear-search', type: 'search', value: gearFilter.q,
    placeholder: '🔍 搜索名称 / 品牌 / 型号 / 备注',
  });
  search.addEventListener('input', () => { gearFilter.q = search.value; rerun(); });
  bar.appendChild(search);

  // 类别下拉：从现有装备动态收集
  const cats = Array.from(new Set(allGear.map((g) => g.category || '未分类'))).sort();
  const catSel = el('select', { class: 'gear-select' },
    el('option', { value: 'all' }, '全部类别'),
    ...cats.map((c) => el('option', gearFilter.category === c ? { value: c, selected: 'selected' } : { value: c }, categoryLabel(c)))
  );
  catSel.value = gearFilter.category;
  catSel.addEventListener('change', () => { gearFilter.category = catSel.value; rerun(); });
  bar.appendChild(catSel);

  // 状态下拉：在用 / 淘汰 / 全部
  const statusSel = el('select', { class: 'gear-select', 'data-role': 'status' },
    el('option', { value: 'active' }, '仅在用'),
    el('option', { value: 'retired' }, '仅淘汰'),
    el('option', { value: 'all' }, '全部状态')
  );
  statusSel.value = gearFilter.status;
  statusSel.addEventListener('change', () => { gearFilter.status = statusSel.value; rerun(); });
  bar.appendChild(statusSel);

  // 排序下拉
  const sortSel = el('select', { class: 'gear-select' },
    el('option', { value: 'category' }, '按类别'),
    el('option', { value: 'name' }, '按名称'),
    el('option', { value: 'weight' }, '按重量（重→轻）'),
    el('option', { value: 'usage' }, '按使用次数（多→少）')
  );
  sortSel.value = gearFilter.sort;
  sortSel.addEventListener('change', () => { gearFilter.sort = sortSel.value; rerun(); });
  bar.appendChild(sortSel);

  // 计数标签放到工具条末尾
  bar.appendChild(countLabel);

  return bar;
}

/** 按 gearFilter 过滤 + 排序，把结果渲染进 resultsBox，并更新计数标签。 */
function applyGearFilter(allGear, resultsBox, countLabel) {
  const q = gearFilter.q.trim().toLowerCase();

  let list = allGear.filter((g) => {
    // 状态
    const retired = g.condition === 'retired';
    if (gearFilter.status === 'active' && retired) return false;
    if (gearFilter.status === 'retired' && !retired) return false;
    // 类别
    if (gearFilter.category !== 'all' && (g.category || '未分类') !== gearFilter.category) return false;
    // 关键词：名称/品牌/型号/slug/备注
    if (q) {
      const hay = [g.name, g.brand, g.model, g.slug, g.notes].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // 排序
  const byStr = (a, b) => String(a || '').localeCompare(String(b || ''));
  if (gearFilter.sort === 'name') {
    list.sort((a, b) => byStr(a.name || a.slug, b.name || b.slug));
  } else if (gearFilter.sort === 'weight') {
    list.sort((a, b) => (Number(b.weight_g) || 0) - (Number(a.weight_g) || 0));
  } else if (gearFilter.sort === 'usage') {
    list.sort((a, b) => (Number(b.usage_count) || 0) - (Number(a.usage_count) || 0));
  } else {
    // category：先类别再 slug
    list.sort((a, b) => byStr(a.category, b.category) || byStr(a.slug, b.slug));
  }

  countLabel.textContent = `匹配 ${list.length} / ${allGear.length} 件`;

  resultsBox.innerHTML = '';
  if (!list.length) {
    resultsBox.appendChild(el('div', { class: 'empty' }, '没有符合条件的装备，试试放宽筛选或清空搜索。'));
    return;
  }

  // 排序为 name/weight/usage 时用平铺列表（不分组），category 时按类别分组
  if (gearFilter.sort === 'category') {
    renderGearGroups(resultsBox, list);
  } else {
    const flat = el('div', { class: 'gear-group-body gear-flat' });
    for (const g of list) flat.appendChild(buildGearCard(g));
    resultsBox.appendChild(flat);
  }

  // 可发现性：默认只看在用装备时，若另有淘汰装备，底部给一个切换入口
  if (gearFilter.status === 'active') {
    const retiredCount = allGear.filter((g) => g.condition === 'retired').length;
    if (retiredCount) {
      const link = el('button', { class: 'gear-retired-link' }, `🗑 另有 ${retiredCount} 件已淘汰装备，点击查看`);
      link.addEventListener('click', () => {
        gearFilter.status = 'retired';
        // 同步更新工具条上的状态下拉，再重算
        const statusSel = $('.gear-toolbar .gear-select[data-role="status"]');
        if (statusSel) statusSel.value = 'retired';
        applyGearFilter(allGear, resultsBox, countLabel);
      });
      resultsBox.appendChild(link);
    }
  }
}

/** 渲染装备分类分组 */
function renderGearGroups(container, gearList) {
  const groups = new Map();
  for (const g of gearList) {
    const cat = g.category || '未分类';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(g);
  }
  for (const [cat, items] of groups) {
    const group = el('div', { class: 'gear-group' });
    const header = el('div', { class: 'gear-group-header' },
      el('span', {}, categoryLabel(cat)),
      el('span', { class: 'gear-count' }, `${items.length} 件`)
    );
    const body = el('div', { class: 'gear-group-body' });
    for (const g of items) body.appendChild(buildGearCard(g));
    header.addEventListener('click', () => {
      const hidden = body.classList.toggle('collapsed');
      header.classList.toggle('collapsed', hidden);
    });
    group.appendChild(header);
    group.appendChild(body);
    container.appendChild(group);
  }
}

/** 构建单个装备卡片 */
function buildGearCard(g) {
  const card = el('div', { class: 'gear-card' + (g.condition === 'retired' ? ' gear-retired' : '') });
  const main = el('div', { class: 'gear-card-main' });
  main.appendChild(el('div', { class: 'gear-name' }, g.name || g.slug || '—'));
  main.appendChild(el('div', { class: 'gear-brief' },
    [g.brand, g.weight_g != null ? num(g.weight_g, 0) + ' g' : null, g.condition]
      .filter(Boolean).join(' · ') || '—'
  ));
  const actions = el('div', { class: 'gear-card-actions' });
  actions.appendChild(el('button', { class: 'btn-sm', 'data-action': 'detail' }, '详情'));
  actions.appendChild(el('button', { class: 'btn-sm btn-primary', 'data-action': 'update' }, '更新'));
  const isRetired = g.condition === 'retired';
  const retireBtn = el('button', { class: 'btn-sm' + (isRetired ? ' btn-primary' : ''), 'data-action': isRetired ? 'restore' : 'retire' }, isRetired ? '↩ 恢复' : '🗑 淘汰');
  actions.appendChild(retireBtn);

  card.appendChild(main);
  card.appendChild(actions);

  // 事件绑定
  $('.btn-sm[data-action="detail"]', card).addEventListener('click', () => openGearDetail(g));
  $('.btn-sm[data-action="update"]', card).addEventListener('click', () => openGearUpdate(g));
  retireBtn.addEventListener('click', async () => {
    const nextCondition = isRetired ? 'good' : 'retired';
    retireBtn.disabled = true;
    retireBtn.textContent = isRetired ? '恢复中…' : '淘汰中…';
    try {
      await fetchSaveGear(state.apiUrl, state.token, g.slug, packGearPayload({ ...g, condition: nextCondition }));
      toast(isRetired ? '已恢复装备' : '已淘汰装备', 'success');
      await loadAndRender(true);
    } catch (err) {
      toast(err.message || '操作失败', 'error');
      retireBtn.disabled = false;
      retireBtn.textContent = isRetired ? '↩ 恢复' : '🗑 淘汰';
    }
  });
  return card;
}

function categoryLabel(cat) {
  const map = {
    shoes: '👟 鞋类', backpack: '🎒 背包', jacket: '🧥 夹克/外套',
    pants: '👖 裤子', poles: '🦯 登山杖', light: '🔦 照明',
    sleeping: '🛏️ 睡眠系统', cooking: '🍳 炊具', electronics: '🔋 电子/导航',
    firstaid: '🩹 急救/安全', hydration: '💧 水具', accessory: '🔧 配件/其他',
  };
  return map[String(cat).toLowerCase()] || `📦 ${cat}`;
}

function openGearDetail(g) {
  const wrap = el('div', {});
  wrap.appendChild(gearFactList(g));
  showModal(g.name || g.slug || '装备详情', wrap, [el('button', { class: 'btn', 'data-action': 'close' }, '关闭')]);
}

async function openGearUpdate(g) {
  const sourceUrl = getGearSourceUrl(g);
  const content = el('div', {});

  // 结果展示区（三个选项卡共用）
  const resultArea = el('div', { class: 'scrape-result' });

  // 选项卡按钮
  const tabs = el('div', { class: 'modal-tabs' });
  const panels = {};

  function switchTab(name) {
    for (const [n, btn] of Object.entries(buttons)) {
      btn.classList.toggle('active', n === name);
    }
    for (const [n, panel] of Object.entries(panels)) {
      panel.hidden = n !== name;
    }
  }

  const buttons = {};

  // ---------- 面板 1：网页抓取 ----------
  panels.scrape = el('div', {});
  const urlRow = el('div', { class: 'form-row' },
    el('label', {}, '商品 URL（REI / 品牌官网等）'),
    el('input', { id: 'update-url', type: 'url', value: sourceUrl, placeholder: 'https://www.rei.com/product/...' })
  );
  const scrapeBtn = el('button', { class: 'btn btn-primary' }, '🔍 从网页抓取');

  scrapeBtn.addEventListener('click', async () => {
    const url = $('#update-url').value.trim();
    if (!url) { toast('请先填写商品 URL', 'warn'); return; }
    scrapeBtn.disabled = true;
    scrapeBtn.textContent = '抓取中…';
    resultArea.innerHTML = '';
    try {
      const data = await fetchScrapeGear(state.apiUrl, state.token, url);
      const merged = mergeGearData(g, { ...data, source_url: url });
      renderScrapeResult(resultArea, merged, g);
    } catch (err) {
      resultArea.appendChild(el('div', { class: 'error-text' }, err.message || '抓取失败'));
    } finally {
      scrapeBtn.disabled = false;
      scrapeBtn.textContent = '🔍 从网页抓取';
    }
  });

  panels.scrape.appendChild(urlRow);
  panels.scrape.appendChild(scrapeBtn);

  // ---------- 面板 2：AI 识别 ----------
  panels.ai = el('div', {});
  const aiDefault = buildAiPrompt(g);
  const aiLabel = el('label', {}, '🤖 已根据当前装备生成描述，可直接识别，也可补充/修改后识别');
  const aiArea = el('textarea', { id: 'update-ai', rows: 6, placeholder: '例如：始祖鸟 Beta LT 硬壳冲锋衣，黑色 M 码，GORE-TEX 面料，重约 350g，价格 4500 元' }, aiDefault);
  const aiActions = el('div', { class: 'gear-card-actions' });
  const aiBtn = el('button', { class: 'btn btn-primary' }, '✨ AI 识别');
  const aiAutoBtn = el('button', { class: 'btn' }, '🔄 重新生成描述');
  aiActions.appendChild(aiBtn);
  aiActions.appendChild(aiAutoBtn);

  async function runAiRecognition() {
    const text = $('#update-ai').value.trim();
    if (!text) { toast('请先输入装备描述', 'warn'); return; }
    aiBtn.disabled = true;
    aiBtn.textContent = '识别中…';
    resultArea.innerHTML = '';
    try {
      const url = $('#update-url').value.trim();
      const res = await fetchAiGear(state.apiUrl, state.token, text, url);
      if (!res.ok || !res.data) {
        throw new Error(res.error || 'AI 未返回有效字段');
      }
      const merged = mergeGearData(g, { ...res.data, source_url: url || undefined });
      renderScrapeResult(resultArea, merged, g, res.provider);
    } catch (err) {
      resultArea.appendChild(el('div', { class: 'error-text' }, err.message || 'AI 识别失败'));
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = '✨ AI 识别';
    }
  }

  aiBtn.addEventListener('click', runAiRecognition);
  aiAutoBtn.addEventListener('click', () => {
    $('#update-ai').value = buildAiPrompt(g);
    toast('已重新生成描述', 'info');
  });

  panels.ai.appendChild(el('div', { class: 'form-row' }, aiLabel, aiArea));
  panels.ai.appendChild(aiActions);

  // ---------- 面板 3：粘贴规格 ----------
  panels.paste = el('div', {});
  const pasteLabel = el('label', {}, '📋 粘贴商品规格文本（京东/天猫详情页复制即可）');
  const pasteArea = el('textarea', { id: 'update-spec', rows: 6, placeholder: '重量：380g\n面料：GORE-TEX 3L\n…' });
  const parseBtn = el('button', { class: 'btn' }, '📋 解析粘贴文本');

  parseBtn.addEventListener('click', () => {
    const text = $('#update-spec').value.trim();
    if (!text) { toast('请先粘贴规格文本', 'warn'); return; }
    const parsed = parseSpecText(text);
    const merged = mergeGearData(g, parsed);
    renderScrapeResult(resultArea, merged, g);
  });

  panels.paste.appendChild(el('div', { class: 'form-row' }, pasteLabel, pasteArea));
  panels.paste.appendChild(parseBtn);

  // 组装选项卡：AI 识别放第一位
  for (const [name, label] of [['ai', '✨ AI 识别'], ['scrape', '🔍 网页抓取'], ['paste', '📋 粘贴规格']]) {
    const btn = el('button', { class: 'modal-tab' + (name === 'ai' ? ' active' : ''), type: 'button' }, label);
    btn.addEventListener('click', () => switchTab(name));
    buttons[name] = btn;
    tabs.appendChild(btn);
  }

  content.appendChild(tabs);
  for (const panel of Object.values(panels)) {
    panel.className = 'modal-tab-panel';
    content.appendChild(panel);
  }
  // 默认显示 AI 识别选项卡
  switchTab('ai');
  content.appendChild(resultArea);

  showModal(g.name || g.slug || '更新装备', content, []);
}

/** 根据装备对象生成 AI 识别提示：只保留名称/品牌/型号，让 AI 自己检索参数。
 *  不把已知参数（重量、材质等）写进去，避免干扰 AI 反填更完整/准确的数据。
 */
function buildAiPrompt(g) {
  const parts = [];
  // 名称里通常已包含品牌/型号，避免重复；若名称缺失再用 brand/model 兜底
  if (g && g.name) {
    parts.push(g.name);
  } else if (g) {
    if (g.brand && g.model) parts.push(`${g.brand} ${g.model}`);
    else if (g.brand) parts.push(g.brand);
    else if (g.model) parts.push(g.model);
  }
  return parts.join(' ');
}

/** 生成 URL 安全的装备 slug，支持中英文混排 */
function slugifyGear(name, brand, model) {
  const raw = [brand, model, name].filter(Boolean).join(' ').trim().toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return slug || 'gear-' + Date.now();
}

/** 通过 AI 添加新装备 */
function openAddGearByAi() {
  const content = el('div', {});
  const resultArea = el('div', { class: 'scrape-result' });
  const label = el('label', {}, '🤖 输入装备描述，AI 会自动识别名称、品牌、重量、材质等字段');
  const textarea = el('textarea', { id: 'add-gear-ai', rows: 6, placeholder: '例如：始祖鸟 Beta LT 硬壳冲锋衣，黑色 M 码，GORE-TEX 面料，重约 350g，价格 4500 元' });
  const actions = el('div', { class: 'gear-card-actions' });
  const aiBtn = el('button', { class: 'btn btn-primary' }, '✨ AI 识别并生成');
  actions.appendChild(aiBtn);

  async function run() {
    const text = textarea.value.trim();
    if (!text) { toast('请先输入装备描述', 'warn'); return; }
    aiBtn.disabled = true;
    aiBtn.textContent = '识别中…';
    resultArea.innerHTML = '';
    try {
      const res = await fetchAiGear(state.apiUrl, state.token, text);
      if (!res.ok || !res.data) {
        throw new Error(res.error || 'AI 未返回有效字段');
      }
      const merged = { ...res.data, condition: 'good' };
      const slug = slugifyGear(merged.name, merged.brand, merged.model);
      const original = { slug };
      renderScrapeResult(resultArea, merged, original, res.provider);
    } catch (err) {
      resultArea.appendChild(el('div', { class: 'error-text' }, err.message || 'AI 识别失败'));
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = '✨ AI 识别并生成';
    }
  }

  aiBtn.addEventListener('click', run);
  content.appendChild(el('div', { class: 'form-row' }, label, textarea));
  content.appendChild(actions);
  content.appendChild(resultArea);
  showModal('✨ AI 添加装备', content, []);
}

function renderScrapeResult(container, merged, original, provider) {
  container.innerHTML = '';
  const titleText = provider ? `AI 识别结果（${provider === 'moonshot' ? 'Kimi' : 'DeepSeek'}）` : '抓取结果';
  const title = el('div', { class: 'section-title' }, `${titleText}（确认后保存）`);
  container.appendChild(title);
  container.appendChild(gearFactList(merged));

  const changed = [];
  for (const k of Object.keys(merged)) {
    if (JSON.stringify(merged[k]) !== JSON.stringify(original[k])) changed.push(k);
  }
  if (!changed.length) {
    container.appendChild(el('div', { class: 'empty' }, '没有识别到新字段，请尝试输入更完整的描述或规格文本。'));
    return;
  }

  const saveBtn = el('button', { class: 'btn btn-primary' }, `💾 保存（更新 ${changed.length} 个字段）`);
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      await fetchSaveGear(state.apiUrl, state.token, original.slug, packGearPayload(merged));
      toast('保存成功，正在刷新…', 'success');
      await loadAndRender(true);
      // 关闭所有 modal（简单做法）
      $$('.modal-overlay').forEach((m) => m.remove());
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = `💾 保存（更新 ${changed.length} 个字段）`;
    }
  });
  container.appendChild(saveBtn);
}

// ---------- 路线 ----------

function renderRoutes() {
  const routes = [...state.data.routes].sort((a, b) =>
    (Number(b.distance_km) || 0) - (Number(a.distance_km) || 0));
  const view = viewEl('routes');
  view.innerHTML = '';
  view.appendChild(el('div', { class: 'section-title' }, `🗺️ 路线库（${routes.length}）`));

  if (!routes.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无路线'));
    return;
  }

  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {},
    el('th', {}, '名称'), el('th', {}, '地点'), el('th', {}, '距离'),
    el('th', {}, '爬升'), el('th', {}, '难度'), el('th', {}, '预计时长'),
    el('th', {}, '操作'),
  )));
  const tbody = el('tbody');
  for (const r of routes) {
    const diff = r.difficulty;
    const cls = diff === 'hard' || diff === 'extreme' ? 'hard'
      : diff === 'moderate' ? 'moderate' : 'easy';
    const tr = el('tr', { class: 'route-row' },
      el('td', {}, r.name || r.slug || '—'),
      el('td', {}, r.location || '—'),
      el('td', { class: 'num' }, num(r.distance_km) + ' km'),
      el('td', { class: 'num' }, num(r.elevation_gain_m, 0) + ' m'),
      el('td', {}, diff ? el('span', { class: 'badge ' + cls }, diff) : '—'),
      el('td', { class: 'num' }, r.estimated_hours != null ? num(r.estimated_hours) + ' h' : '—'),
      el('td', {}, el('button', { class: 'btn-sm', 'data-action': 'detail' }, '详情'))
    );
    $('.btn-sm[data-action="detail"]', tr).addEventListener('click', () => openRouteDetail(r));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  view.appendChild(wrap);
}

function openRouteDetail(r) {
  const facts = [
    ['slug', r.slug],
    ['名称', r.name],
    ['地点', r.location],
    ['距离', r.distance_km != null ? num(r.distance_km) + ' km' : null],
    ['爬升', r.elevation_gain_m != null ? num(r.elevation_gain_m, 0) + ' m' : null],
    ['下降', r.elevation_loss_m != null ? num(r.elevation_loss_m, 0) + ' m' : null],
    ['最高海拔', r.max_altitude_m != null ? num(r.max_altitude_m, 0) + ' m' : null],
    ['难度', r.difficulty],
    ['预计时长', r.estimated_hours != null ? num(r.estimated_hours) + ' h' : null],
    ['地形', Array.isArray(r.terrain) ? r.terrain.join('、') : r.terrain],
    ['最佳季节', Array.isArray(r.best_seasons) ? r.best_seasons.join('、') : r.best_seasons],
    ['水源', Array.isArray(r.water_sources) ? r.water_sources.join('、') : r.water_sources],
    ['GPX', r.gpx_file],
    ['来源', r.source_url],
    ['备注', r.notes],
  ].filter(([, v]) => v != null && v !== '');

  const list = el('ul', { class: 'detail-list' });
  for (const [k, v] of facts) {
    const li = el('li', {}, el('strong', {}, k + '：'));
    if ((k === '来源' || k === 'GPX') && String(v).startsWith('http')) {
      li.appendChild(el('a', { href: v, target: '_blank', rel: 'noopener' }, v));
    } else {
      li.appendChild(document.createTextNode(v));
    }
    list.appendChild(li);
  }
  showModal(r.name || r.slug || '路线详情', list, [el('button', { class: 'btn' }, '关闭')]);
}

// ---------- 计划 ----------

function renderPlans() {
  const plans = [...state.data.plans].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const view = viewEl('plans');
  view.innerHTML = '';
  view.appendChild(el('div', { class: 'section-title' }, `📋 计划（${plans.length}）`));

  if (!plans.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无计划'));
    return;
  }

  for (const p of plans) {
    const card = el('div', { class: 'card' });
    const typeLabel = p.plan_type === 'recovery' ? '🩹 恢复' : '🎯 行程';
    card.appendChild(el('div', { class: 'section-title' },
      `${typeLabel} · ${p.route || p.issue || '计划'} · ${fmtDate(p.date)}`));
    const facts = [
      ['距离', p.distance_km != null ? p.distance_km + ' km' : null],
      ['爬升', p.elevation_gain_m != null ? p.elevation_gain_m + ' m' : null],
      ['预计时长', p.estimated_hours != null ? p.estimated_hours + ' h' : null],
      ['恢复天数', p.recovery_days != null ? p.recovery_days + ' 天' : null],
      ['强度', p.intensity_level],
    ].filter(([, v]) => v != null && v !== '');
    for (const [k, v] of facts) {
      card.appendChild(el('div', {}, el('span', { class: 'badge' }, k), ' ', String(v)));
    }
    view.appendChild(card);
  }
}

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
}

document.addEventListener('DOMContentLoaded', init);
