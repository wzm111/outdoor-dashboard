/* 通用工具函数 */
'use strict';

// ---------- 工具 ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------- 身体不适标签中文映射（保留原始英文 key 用于存储，仅展示时翻译） ----------

const ISSUE_LABEL_MAP = {
  knee: '膝盖',
  knee_sore_downhill: '下坡膝盖疼',
  knee_left: '左膝',
  knee_right: '右膝',
  knee_mild_swelling: '膝盖轻微肿胀',
  it_band: '髂胫束',
  it_band_left: '左侧髂胫束',
  it_band_right: '右侧髂胫束',
  ankle: '脚踝',
  ankle_left: '左脚踝',
  ankle_right: '右脚踝',
  ankle_minor_rollover: '脚踝轻微扭伤',
  blisters: '水泡',
  blisters_left_foot: '左脚水泡',
  blisters_right_foot: '右脚水泡',
  chafing: '摩擦伤',
  sunburn: '晒伤',
  headache: '头痛',
  stomach: '肠胃不适',
  fatigue: '疲劳',
  muscle_soreness: '肌肉酸痛',
  back: '腰背',
  hip: '髋部',
  shoulder: '肩膀',
  foot: '脚',
  heel: '脚跟',
  arch: '足弓',
  toe: '脚趾',
  shin: '胫骨痛',
  shin_splints: '胫骨应力综合征',
  calf: '小腿',
  achilles: '跟腱',
  cramp: '抽筋',
  dehydration: '脱水',
  altitude: '高反',
  cold: '受寒',
  heat: '中暑',
  wind: '受风',
  plantar_fasciitis: '足底筋膜炎',
  neck: '颈部',
  other: '其他',
};

function issueLabel(raw) {
  if (!raw) return '—';
  const key = String(raw).toLowerCase();
  if (ISSUE_LABEL_MAP[key]) return ISSUE_LABEL_MAP[key];
  // 兜底：下划线变空格 + 首字母大写，避免直接显示字段名
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number'
      ? document.createTextNode(c)
      : c);
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

let modalOpenCount = 0;
let savedModalScrollY = 0;

/** 给表格每个 <td> 注入 data-label，供移动端 CSS 卡片化显示。 */
function labelTableCells(table, headers) {
  const rows = table.querySelectorAll('tbody tr');
  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    for (let i = 0; i < cells.length; i++) {
      cells[i].dataset.label = headers[i] || '操作';
    }
  }
}

/** 创建并显示一个模态弹窗。返回关闭函数。
 *  @param onClose 可选；弹窗关闭（含点击遮罩/×/非 data-no-autoclose 按钮）后调用。
 *  @param boxClass 可选；追加到 .modal-box 的额外 CSS 类。 */
function showModal(title, contentNode, buttons = [], onClose = null, boxClass = '') {
  if (modalOpenCount === 0) {
    savedModalScrollY = window.scrollY;
    document.body.style.setProperty('--modal-scroll-top', `-${savedModalScrollY}px`);
    document.body.classList.add('modal-open');
  }
  modalOpenCount++;

  const overlay = el('div', { class: 'modal-overlay' });
  const box = el('div', { class: 'modal-box' + (boxClass ? ' ' + boxClass : '') });
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

  function onKey(e) {
    if (e.key === 'Escape') {
      const all = $$('.modal-overlay');
      if (all[all.length - 1] === overlay) close();
    }
  }

  function onResize() {
    if (!window.visualViewport) return;
    const h = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
    document.documentElement.style.setProperty('--keyboard-height', `${h}px`);
  }

  function onFocus(e) {
    const target = e.target;
    if (!target || !/^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName)) return;
    setTimeout(() => {
      const boxRect = box.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (targetRect.bottom > boxRect.bottom - 24) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 300);
  }

  const close = () => {
    document.removeEventListener('keydown', onKey);
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', onResize);
    body.removeEventListener('focusin', onFocus);
    overlay.remove();
    modalOpenCount--;
    if (modalOpenCount <= 0) {
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('--modal-scroll-top');
      if (savedModalScrollY) window.scrollTo(0, savedModalScrollY);
      modalOpenCount = 0;
      savedModalScrollY = 0;
    }
    if (typeof onClose === 'function') onClose();
  };

  const closeBtn = $('.modal-close', overlay);
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  for (const b of buttons) {
    // 底部按钮默认点击关闭弹窗；带 data-no-autoclose 的按钮由调用方自行控制关闭时机
    footer.appendChild(b);
    if (b.getAttribute && b.getAttribute('data-no-autoclose') != null) continue;
    b.addEventListener('click', close);
  }

  document.addEventListener('keydown', onKey);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize);
    onResize();
  }
  body.addEventListener('focusin', onFocus);

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

/** 从活动的 gear_used 中提取干净的 slug 列表。
 *  gear_used 元素混合：多为 slug 字符串，少数是 dict（{slug:...} 或空 {}）。
 *  两种都兼容，过滤掉 {} / 空值。 */
function gearSlugsOf(activity) {
  const gu = activity && activity.gear_used;
  if (!Array.isArray(gu)) return [];
  return gu
    .map((e) => (typeof e === 'string' ? e : (e && e.slug) || ''))
    .filter(Boolean);
}

/** 反查：某件装备（按 slug）上过哪些活动，按日期倒序。 */
function activitiesUsingGear(slug) {
  if (!slug) return [];
  return (state.data.activities || [])
    .filter((a) => gearSlugsOf(a).includes(slug))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** 计算同一天同路线下的下一个 sequence：自动让多条活动并存。 */
function nextActivitySequence(date, route) {
  const same = (state.data.activities || []).filter(
    (a) => String(a.date) === String(date) && String(a.route) === String(route)
  );
  const maxSeq = same.reduce((m, a) => Math.max(m, Number(a.sequence) || 0), -1);
  return maxSeq + 1;
}
function toast(msg, type = 'info') {
  const t = el('div', { class: `toast toast-${type}` }, msg);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, 3000);
}

/** 显示所有视图内的骨架屏（数据加载阶段替代 spinner）。 */
function showSkeletons() {
  $$('.view .skeleton-screen').forEach((s) => { s.hidden = false; });
}

/** 隐藏所有骨架屏。 */
function hideSkeletons() {
  $$('.view .skeleton-screen').forEach((s) => { s.hidden = true; });
}

/** 清空 view 内容但保留预置的骨架屏容器，避免 renderXxx 把 .skeleton-screen 一起删掉。 */
function clearViewKeepSkeleton(view) {
  if (!view) return;
  const skeleton = $('.skeleton-screen', view);
  view.innerHTML = '';
  if (skeleton) view.appendChild(skeleton);
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
  if ('id' in row) flat.id = row.id;
  if ('sequence' in row) flat.sequence = row.sequence;
  // 保留原始 Markdown（脚本侧 _unwrap 同名约定）：写回时需回传，且要在其中同步 frontmatter 的 gear_used 块。
  if ('raw_markdown' in row) flat._raw_markdown = row.raw_markdown;
  // 保留服务端时间戳，供增量同步与调试使用
  if ('updated_at' in row) flat._updated_at = row.updated_at;
  if ('created_at' in row) flat._created_at = row.created_at;
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

/** 把可能包含空对象的字符串数组格式化为「、」分隔的可读文本。 */
function fmtStringList(arr) {
  if (!Array.isArray(arr)) return arr;
  const filtered = arr.map((x) => (x && typeof x === 'object' ? '' : String(x))).filter((s) => s && s !== '[object Object]');
  return filtered.length ? filtered.join('、') : null;
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

/** 把用户输入的时长解析为小时。支持 "29:38"、"1:30:00"、"29分38秒"、"1小时30分"、"1.5h"、纯数字（小时）。 */
function parseDurationToHours(str) {
  if (str == null || str === '') return null;
  const s = String(str).trim();
  if (!s) return null;
  // H:MM:SS 或 MM:SS
  const colon = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    const a = Number(colon[1]);
    const b = Number(colon[2]);
    const c = colon[3] != null ? Number(colon[3]) : null;
    if (b >= 60 || (c != null && c >= 60)) return null;
    const sec = c != null ? a * 3600 + b * 60 + c : a * 60 + b;
    return sec / 3600;
  }
  // 中文/单位组合：1小时30分 / 1h30m / 29分38秒 / 90秒
  const unit = s.match(/^(?:(\d+(?:\.\d+)?)\s*(?:小时|h))?\s*(?:(\d+(?:\.\d+)?)\s*(?:分钟|分|min|m))?\s*(?:(\d+(?:\.\d+)?)\s*(?:秒钟|秒|s))?$/i);
  if (unit && (unit[1] != null || unit[2] != null || unit[3] != null)) {
    const h = Number(unit[1] || 0);
    const m = Number(unit[2] || 0);
    const sec = Number(unit[3] || 0);
    return h + m / 60 + sec / 3600;
  }
  // 纯数字按小时（兼容旧习惯）
  const n = Number(s);
  if (!isNaN(n) && n >= 0) return n;
  return null;
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

/** 把配速字符串解析为分钟/公里。支持 "5:55"、"5分55秒"、"5'55\""、"5.55"/km 等。 */
function parsePaceToMinPerKm(pace) {
  if (pace == null || pace === '') return null;
  const s = String(pace).trim().replace(/\s*\/km$/i, '');
  // 5:55 / 5'55" / 5′55″ / 5分55秒
  const colon = s.match(/^(\d+)[':分′](\d+)\s*(?:秒|″|"|')?$/);
  if (colon) {
    const m = Number(colon[1]);
    const sec = Number(colon[2]);
    if (sec >= 60) return null;
    return m + sec / 60;
  }
  // 纯数字视为分钟/公里（如 "5.92"）
  const num = Number(s);
  if (!isNaN(num) && num > 0) return num;
  return null;
}

/** 由距离和配速计算时长（小时）。 */
function paceToDurationHours(distanceKm, pace) {
  const d = Number(distanceKm);
  const p = parsePaceToMinPerKm(pace);
  if (!d || d <= 0 || !p || p <= 0) return null;
  return Math.round(((d * p) / 60) * 100) / 100;
}

/** 规范化配速输入为 "M:SS/km" 存储形式；无法解析时返回原文。 */
function normalizePaceForSave(pace) {
  if (pace == null || pace === '') return undefined;
  const p = parsePaceToMinPerKm(pace);
  if (!p || p <= 0) return String(pace).trim() || undefined;
  const m = Math.floor(p);
  const s = Math.round((p - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}/km`;
}

/** 判断活动是否为跑步。 */
function isRunning(a) {
  return /run|跑步|配速/i.test(String(a.type || ''));
}

/** 判断活动是否为攀岩/抱石。 */
function isClimbing(a) {
  return /climb|攀岩|抱石|boulder/i.test(String(a.type || ''));
}

/** 判断活动是否为骑行。 */
function isCycling(a) {
  return /cycl|骑行|骑车/i.test(String(a.type || ''));
}

/** 由距离和时长计算平均速度（km/h）。 */
function avgSpeedKmh(distanceKm, hours) {
  const d = Number(distanceKm);
  const t = Number(hours);
  if (!d || !t || d <= 0 || t <= 0) return null;
  return d / t;
}

/** 把速度格式化为 "32.1 km/h"。 */
function fmtSpeed(kmh) {
  const n = Number(kmh);
  if (kmh == null || isNaN(n)) return '—';
  return num(n, 1) + ' km/h';
}
