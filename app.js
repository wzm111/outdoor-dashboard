/* 户外助手看板 — 纯 vanilla JS，无构建步骤、无第三方库。
 *
 * 数据流：api_secret → POST /api/auth/token → JWT → POST /api/sync {action:"export"}
 * 一次性拉全量数据，客户端渲染。密钥仅存浏览器 localStorage，绝不入库。
 */
'use strict';

// 运行时版本号：每次改前端 bump 一次，方便在 Console 里核对当前跑的是不是新版（window.__APP_VERSION）
const APP_VERSION = 'v3-2026-07-01';
window.__APP_VERSION = APP_VERSION;

const LS_KEY = 'outdoor-dashboard-config';
const CACHE_KEY = 'outdoor-dashboard-snapshot';
const DEFAULT_API = 'https://oxjqquwbnvhgulpkboli.supabase.co/functions/v1';

const state = {
  apiUrl: '',
  token: null,
  data: null, // { profile, gear[], routes[], activities[], body_logs[], plans[], segments[] }
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
  const btn = $('#connect-btn');
  btn.disabled = true;
  btn.textContent = '连接中…';
  $('#auth-error').hidden = true;
  try {
    const token = await fetchToken(apiUrl, secret);
    state.apiUrl = apiUrl;
    state.token = token;
    if (remember) saveConfig(apiUrl, secret);
    else clearConfig();
    await loadAndRender();
    // UI 切换已收进 loadAndRender 的 showDashboard()，此处无需重复
  } catch (err) {
    showAuthError(err.message || String(err));
  } finally {
    btn.disabled = false;
    btn.textContent = '连接';
  }
}

// ---------- 加载 + 渲染 ----------

/** 数据上屏后原子切换到看板：隐藏登录框、显示看板、关闭加载浮层。
 *  只要 render 成功就必须调用，避免出现"数据出来了但登录框/spinner 还盖着"。 */
function showDashboard() {
  $('#auth-screen').hidden = true;
  $('#app').hidden = false;
  $('#loading').hidden = true;
}

async function loadAndRender(isRefresh = false) {
  const loading = $('#loading');
  loading.hidden = false;
  $('#sync-status').textContent = '';
  try {
    const raw = await fetchExport(state.apiUrl, state.token);
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
  table.appendChild(el('thead', {}, el('tr', {},
    el('th', {}, '日期'), el('th', {}, '路线'), el('th', {}, '类型'),
    el('th', {}, '距离'), el('th', {}, '爬升'), el('th', {}, '时长'),
    el('th', {}, '平均心率'), el('th', {}, '感受'),
  )));
  const tbody = el('tbody');
  for (const a of acts) {
    tbody.appendChild(el('tr', {},
      el('td', {}, fmtDate(a.date)),
      el('td', {}, a.route || '—'),
      el('td', {}, a.type || '—'),
      el('td', { class: 'num' }, num(a.distance_km) + ' km'),
      el('td', { class: 'num' }, num(a.elevation_gain_m, 0) + ' m'),
      el('td', { class: 'num' }, num(a.duration_hours) + ' h'),
      el('td', { class: 'num' }, a.avg_hr ? num(a.avg_hr, 0) : '—'),
      el('td', {}, feltBadge(a.felt)),
    ));
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function feltBadge(felt) {
  if (!felt) return '—';
  const cls = felt === 'hard' || felt === 'extreme' ? 'hard'
    : felt === 'moderate' ? 'moderate' : 'easy';
  return el('span', { class: 'badge ' + cls }, felt);
}

function renderActivities() {
  const acts = [...state.data.activities].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const view = viewEl('activities');
  view.innerHTML = '';
  view.appendChild(el('div', { class: 'section-title' }, `🏃 全部活动（${acts.length}）`));
  view.appendChild(acts.length ? activityTable(acts) : el('div', { class: 'empty' }, '暂无活动记录'));
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
  const gear = [...state.data.gear].sort((a, b) =>
    String(a.category || '').localeCompare(String(b.category || '')) ||
    String(a.slug || '').localeCompare(String(b.slug || '')));
  const view = viewEl('gear');
  view.innerHTML = '';
  view.appendChild(el('div', { class: 'section-title' }, `🎒 装备库（${gear.length}）`));

  if (!gear.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无装备'));
    return;
  }

  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {},
    el('th', {}, '名称'), el('th', {}, '类别'), el('th', {}, '品牌'),
    el('th', {}, '重量'), el('th', {}, '防水'), el('th', {}, '使用次数'), el('th', {}, '状态'),
  )));
  const tbody = el('tbody');
  for (const g of gear) {
    tbody.appendChild(el('tr', {},
      el('td', {}, g.name || g.slug || '—'),
      el('td', {}, el('span', { class: 'badge' }, g.category || '—')),
      el('td', {}, g.brand || '—'),
      el('td', { class: 'num' }, g.weight_g != null ? num(g.weight_g, 0) + ' g' : '—'),
      el('td', {}, g.waterproof === true ? '✓' : g.waterproof === false ? '—' : '?'),
      el('td', { class: 'num' }, g.usage_count != null ? num(g.usage_count, 0) : '0'),
      el('td', {}, g.condition || '—'),
    ));
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  view.appendChild(wrap);
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
  )));
  const tbody = el('tbody');
  for (const r of routes) {
    const diff = r.difficulty;
    const cls = diff === 'hard' || diff === 'extreme' ? 'hard'
      : diff === 'moderate' ? 'moderate' : 'easy';
    tbody.appendChild(el('tr', {},
      el('td', {}, r.name || r.slug || '—'),
      el('td', {}, r.location || '—'),
      el('td', { class: 'num' }, num(r.distance_km) + ' km'),
      el('td', { class: 'num' }, num(r.elevation_gain_m, 0) + ' m'),
      el('td', {}, diff ? el('span', { class: 'badge ' + cls }, diff) : '—'),
      el('td', { class: 'num' }, r.estimated_hours != null ? num(r.estimated_hours) + ' h' : '—'),
    ));
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  view.appendChild(wrap);
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
  });

  // 已记住密钥则自动连接
  if (saved && saved.apiUrl && saved.secret) {
    connect(saved.apiUrl, saved.secret, true);
  }

  // 注册 service worker（PWA）
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
