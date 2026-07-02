/* 户外助手看板 — 纯 vanilla JS，无构建步骤、无第三方库。
 *
 * 数据流：api_secret → POST /api/auth/token → JWT → POST /api/sync {action:"export"}
 * 一次性拉全量数据，客户端渲染。密钥仅存浏览器 localStorage，绝不入库。
 */
'use strict';

// 运行时版本号：每次改前端 bump 一次，方便在 Console 里核对当前跑的是不是新版（window.__APP_VERSION）
const APP_VERSION = 'v21-2026-07-02';
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
    // 底部按钮默认点击关闭弹窗；带 data-no-autoclose 的按钮由调用方自行控制关闭时机
    footer.appendChild(b);
    if (b.getAttribute && b.getAttribute('data-no-autoclose') != null) continue;
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

// ---------- 活动 gear_used 写回 ----------

/** 把编辑后的 slug 列表序列化成 frontmatter 里的 gear_used YAML 块。
 *  空列表 → `gear_used: []`；非空 → 多行 `  - slug`。不含末尾换行。 */
function serializeGearUsedBlock(slugs) {
  if (!slugs || !slugs.length) return 'gear_used: []';
  return 'gear_used:\n' + slugs.map((s) => `  - ${s}`).join('\n');
}

/** 只替换 raw_markdown 里 frontmatter（首个 ---...---）内的 gear_used 块，正文散文原样保留。
 *  - 兼容原块是多行列表（gear_used:\n  - x\n  - y）或空数组（gear_used: []）。
 *  - frontmatter 里没有 gear_used 键时，在 frontmatter 末尾追加。
 *  - 整段 raw 没有 frontmatter 围栏时，返回原文不动（无法安全定位，交由调用方决定）。
 *  返回 { text, changed }。 */
function replaceGearUsedInMarkdown(raw, slugs) {
  const src = String(raw == null ? '' : raw);
  const block = serializeGearUsedBlock(slugs);
  // 定位首个 frontmatter 围栏：^---\n ... \n---(\n|$)
  const fm = src.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/);
  if (!fm) return { text: src, changed: false };
  const head = fm[1];
  let body = fm[2];
  const tail = fm[3];
  // 在 frontmatter body 内匹配 gear_used 块：从行首 gear_used: 起，
  // 吃掉后续所有更深缩进的列表行（  - ...），到下一个顶层键或 body 结束前。
  const guRe = /^gear_used:[ \t]*(?:\r?\n(?:[ \t]+-.*(?:\r?\n|$))*|\[\s*\].*(?:\r?\n|$)?|.*(?:\r?\n|$))/m;
  let newBody;
  if (guRe.test(body)) {
    newBody = body.replace(guRe, (m) => {
      // 保留原块尾部的换行数：若原匹配以换行结尾则补一个换行
      const endsNl = /\r?\n$/.test(m);
      return block + (endsNl ? '\n' : '');
    });
  } else {
    // frontmatter 里没有 gear_used，追加到 body 末尾
    newBody = body.replace(/\s*$/, '') + '\n' + block;
  }
  const changed = newBody !== body;
  return { text: head + newBody + tail + src.slice(fm[0].length), changed };
}

/** 构建写回用的完整活动 data：剔除看板注入的非持久字段，并用编辑后的干净 slug 数组替换 gear_used。 */
function packActivityData(activity, slugs) {
  const copy = { ...activity };
  delete copy._raw_markdown;
  delete copy._updated_at;
  delete copy._path;
  delete copy.slug;
  copy.gear_used = slugs.slice();
  return copy;
}

/** 弹窗手动添加一条活动记录。 */
function openAddActivity() {
  if (!state.token) { toast('请先连接后再添加活动', 'warn'); return; }

  const today = new Date().toISOString().slice(0, 10);
  const routeSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（无路线 / 手动输入）')
  );
  const routes = [...(state.data.routes || [])].sort((a, b) => String(a.name || a.slug).localeCompare(String(b.name || b.slug)));
  for (const r of routes) {
    routeSel.appendChild(el('option', { value: r.name }, r.name || r.slug));
  }

  const dateInput = el('input', { type: 'date', class: 'gear-select', value: today, style: 'width:100%;' });
  const routeInput = el('input', { type: 'text', class: 'gear-select', placeholder: '路线名称', style: 'width:100%;' });
  const typeSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: 'running' }, '路跑 running'),
    el('option', { value: 'trail_running' }, '越野跑 trail_running'),
    el('option', { value: 'hiking', selected: 'selected' }, '徒步 hiking'),
    el('option', { value: 'climbing' }, '攀岩 climbing'),
    el('option', { value: 'cycling' }, '骑行 cycling'),
    el('option', { value: 'other' }, '其他 other')
  );
  const distInput = el('input', { type: 'number', class: 'gear-select', value: '', step: '0.01', placeholder: '公里', style: 'width:100%;' });
  const gainInput = el('input', { type: 'number', class: 'gear-select', value: '', placeholder: '米', style: 'width:100%;' });
  const lossInput = el('input', { type: 'number', class: 'gear-select', value: '', placeholder: '米（可选）', style: 'width:100%;' });
  const durationInput = el('input', { type: 'number', class: 'gear-select', value: '', step: '0.01', placeholder: '小时', style: 'width:100%;' });
  const hrInput = el('input', { type: 'number', class: 'gear-select', value: '', placeholder: '次/分', style: 'width:100%;' });
  const feltSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（未选择）'),
    el('option', { value: 'easy' }, '轻松 easy'),
    el('option', { value: 'moderate' }, '适中 moderate'),
    el('option', { value: 'hard' }, '辛苦 hard'),
    el('option', { value: 'extreme' }, '极限 extreme')
  );
  const notesInput = el('textarea', { class: 'gear-select', rows: 3, placeholder: '备注、膝盖状态、装备反馈等', style: 'width:100%;' });

  function updateRouteInput() {
    if (routeSel.value) {
      routeInput.value = routeSel.value;
      routeInput.disabled = true;
    } else {
      routeInput.disabled = false;
    }
  }
  routeSel.addEventListener('change', updateRouteInput);

  const form = el('div', { class: 'recommend-form' },
    el('div', { class: 'form-row' }, el('label', {}, '日期 *'), dateInput),
    el('div', { class: 'form-row' }, el('label', {}, '路线'), el('div', {}, routeSel, routeInput)),
    el('div', { class: 'form-row' }, el('label', {}, '类型 *'), typeSel),
    el('div', { class: 'form-row' }, el('label', {}, '距离 (km) *'), distInput),
    el('div', { class: 'form-row' }, el('label', {}, '爬升 (m)'), gainInput),
    el('div', { class: 'form-row' }, el('label', {}, '下降 (m)'), lossInput),
    el('div', { class: 'form-row' }, el('label', {}, '时长 (h)'), durationInput),
    el('div', { class: 'form-row' }, el('label', {}, '平均心率'), hrInput),
    el('div', { class: 'form-row' }, el('label', {}, '感受'), feltSel),
    el('div', { class: 'form-row' }, el('label', {}, '备注'), notesInput)
  );

  const saveBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, '保存活动');
  saveBtn.addEventListener('click', async () => {
    const date = dateInput.value;
    const route = routeInput.value.trim();
    const type = typeSel.value;
    const distance = Number(distInput.value);
    if (!date || !route || isNaN(distance) || distance <= 0) {
      toast('请填写日期、路线和有效距离', 'warn');
      return;
    }
    const data = {
      date,
      route,
      type,
      distance_km: distance,
      elevation_gain_m: Number(gainInput.value) || 0,
      elevation_loss_m: Number(lossInput.value) || 0,
      duration_hours: Number(durationInput.value) || undefined,
      avg_hr: hrInput.value ? Number(hrInput.value) : undefined,
      felt: feltSel.value || undefined,
      notes: notesInput.value.trim() || undefined,
      gear_used: [],
    };
    const rawMarkdown = buildActivityMarkdown(data);
    const payload = {
      date: data.date,
      route: data.route,
      data,
      raw_markdown: rawMarkdown,
    };
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      await fetchSaveActivity(state.apiUrl, state.token, payload);
      toast('活动已保存', 'success');
      close();
      await loadAndRender(true);
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '保存活动';
    }
  });

  const close = showModal('记录活动', form, [saveBtn, el('button', { class: 'btn' }, '关闭')]);
}

function buildActivityMarkdown(data) {
  const lines = ['---'];
  lines.push(`date: "${data.date}"`);
  lines.push(`route: "${data.route}"`);
  lines.push(`type: ${data.type}`);
  lines.push(`distance_km: ${data.distance_km}`);
  if (data.elevation_gain_m) lines.push(`elevation_gain_m: ${data.elevation_gain_m}`);
  if (data.elevation_loss_m) lines.push(`elevation_loss_m: ${data.elevation_loss_m}`);
  if (data.duration_hours != null) lines.push(`duration_hours: ${data.duration_hours}`);
  if (data.avg_hr) lines.push(`avg_hr: ${data.avg_hr}`);
  if (data.felt) lines.push(`felt: ${data.felt}`);
  if (data.gear_used && data.gear_used.length) {
    lines.push('gear_used:');
    for (const s of data.gear_used) lines.push(`  - ${s}`);
  }
  if (data.notes) lines.push(`notes: "${data.notes}"`);
  lines.push('---');
  return lines.join('\n');
}

/** 写回单条活动的 gear_used：走 /sync import 的 activities upsert（onConflict date+route，无需 id）。
 *  整行覆盖，故必须回传完整 data 和 raw_markdown。 */
async function fetchSaveActivity(apiUrl, token, payload) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 'import', data: { activities: [payload] } }),
  }, 15000, '保存活动装备');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`保存失败 (${res.status})${text ? ': ' + text.slice(0, 120) : ''}`);
  }
  const json = await res.json().catch(() => ({}));
  // import 返回 { activities: { success, count } | { error } }
  const r = json && (json.activities || (json.results && json.results.activities));
  if (r && r.error) throw new Error(`保存失败: ${String(r.error).slice(0, 120)}`);
  return json;
}


// ---------- 装备使用统计 / 磨损·闲置提醒 ----------

// 按类别的经验寿命阈值（里程 km）。仅作参考、非精确值；找不到的类别不按里程判磨损。
const GEAR_KM_LIFESPAN = {
  shoes: 600,      // 跑鞋/徒步鞋经验寿命
  backpack: 1500,
  poles: 8000,
  pants: 1200,
  jacket: 1500,
};
const IDLE_WARN_DAYS = 180; // 用过但超过半年没再用 → 闲置提醒

/** 两个日期（YYYY-MM-DD 或可被 Date.parse 解析）相差的天数，解析失败返回 null。 */
function daysBetween(fromDate, toDate) {
  const a = Date.parse(String(fromDate).slice(0, 10));
  const b = Date.parse(String(toDate).slice(0, 10));
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** 计算一件装备的磨损/闲置状态（启发式，非精确）。
 *  返回 { level:'ok'|'warn'|'alert'|'idle', reasons:[中文], pctOfLife:0-1|null, idleDays:number|null }
 *  - retired 装备直接判 ok（已退役不预警）。
 *  - 磨损：total_distance_km / 类别阈值 ≥0.8→warn，≥1.0→alert。
 *  - 闲置：用过（usage_count>0）且 last_used_date 距今 > IDLE_WARN_DAYS。从没用过的不算闲置。 */
function gearWearStatus(g, today) {
  const reasons = [];
  if (!g || g.condition === 'retired') return { level: 'ok', reasons, pctOfLife: null, idleDays: null };

  // 磨损（仅对有经验阈值的类别 + 有里程数据）
  let level = 'ok';
  let pctOfLife = null;
  const limit = GEAR_KM_LIFESPAN[g.category];
  const km = Number(g.total_distance_km);
  if (limit && !isNaN(km) && km > 0) {
    pctOfLife = km / limit;
    const pctTxt = Math.round(pctOfLife * 100);
    if (pctOfLife >= 1.0) {
      level = 'alert';
      reasons.push(`里程 ${num(km, 1)} / ${limit} km（${pctTxt}%，已达经验寿命）`);
    } else if (pctOfLife >= 0.8) {
      level = 'warn';
      reasons.push(`里程 ${num(km, 1)} / ${limit} km（${pctTxt}%，接近经验寿命）`);
    }
  }

  // 闲置（只对用过的装备判；磨损预警优先级更高，磨损已 warn/alert 时不再叠加闲置为主状态）
  let idleDays = null;
  const usage = Number(g.usage_count) || 0;
  if (usage > 0 && g.last_used_date && today) {
    const d = daysBetween(g.last_used_date, today);
    if (d != null && d > IDLE_WARN_DAYS) {
      idleDays = d;
      reasons.push(`已 ${d} 天未使用`);
      if (level === 'ok') level = 'idle';
    }
  }

  return { level, reasons, pctOfLife, idleDays };
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
  // 保留原始 Markdown（脚本侧 _unwrap 同名约定）：写回时需回传，且要在其中同步 frontmatter 的 gear_used 块。
  if ('raw_markdown' in row) flat._raw_markdown = row.raw_markdown;
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

/** 通用删除请求。 */
async function fetchDelete(apiUrl, token, entity, id) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/${entity}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  }, 15000, '删除');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`删除失败 (${res.status})${t ? ': ' + t.slice(0, 120) : ''}`);
  }
  return res.json().catch(() => ({ deleted: true }));
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

/** AI 解析路线自然语言描述 → 结构化字段（后端 /ai/route，双 AI 取优）。 */
async function fetchAiRoute(apiUrl, token, text, sourceUrl) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/ai/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ text, source_url: sourceUrl }),
  }, 45000, 'AI 识别路线');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI 识别失败 (${res.status})${t ? ': ' + t.slice(0, 120) : ''}`);
  }
  return res.json();
}

/** 保存单条路线：PUT /routes/:slug（存在则更新、不存在则插入）。body = { data, raw_markdown? }。 */
async function fetchSaveRoute(apiUrl, token, slug, payload) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/routes/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  }, 15000, '保存路线');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`保存路线失败 (${res.status})${t ? ': ' + t.slice(0, 120) : ''}`);
  }
  return res.json();
}

/** 请求装备推荐：POST /recommend。 */
async function fetchRecommend(apiUrl, token, payload) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/recommend`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  }, 45000, '生成装备推荐');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`推荐失败 (${res.status})${t ? ': ' + t.slice(0, 120) : ''}`);
  }
  return res.json();
}

/** 保存计划：POST /plans。 */
async function fetchSavePlan(apiUrl, token, payload) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/plans`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  }, 15000, '保存计划');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`保存计划失败 (${res.status})${t ? ': ' + t.slice(0, 120) : ''}`);
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
    view.appendChild(el('div', { class: 'section-title' }, '体能档案'));
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
  view.appendChild(el('div', { class: 'section-title' }, '最近活动'));
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
  // slug → 装备对象，供行点击时快速取装备（避免每行 O(n) 查找）
  const gearMap = new Map((state.data.gear || []).map((g) => [g.slug, g]));
  // 跑步显示精确时长 + 配速；徒步/爬山显示普通时长
  const hasRun = acts.some(isRunning);

  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  const headerCells = [
    el('th', {}, '日期'),
    // 跑步活动地点/备注比路线名更实用；徒步/爬山仍显示路线
    el('th', { class: 'col-location' }, hasRun ? '地点/备注' : '路线'),
    el('th', {}, '类型'),
    el('th', {}, '距离'),
    el('th', {}, '爬升'),
  ];
  headerCells.push(el('th', {}, '时长'));
  if (hasRun) headerCells.push(el('th', {}, '配速'));
  headerCells.push(el('th', {}, '平均心率'), el('th', {}, '感受'), el('th', {}, '装备'));
  table.appendChild(el('thead', {}, el('tr', {}, ...headerCells)));

  const tbody = el('tbody');
  for (const a of acts) {
    const running = isRunning(a);
    const pace = running ? paceMinPerKm(a.distance_km, a.duration_hours) : null;
    const duration = running ? fmtDuration(a.duration_hours) : num(a.duration_hours) + ' h';
    const gearCount = gearSlugsOf(a).length;
    const cells = [
      el('td', {}, fmtDate(a.date)),
      el('td', { class: 'col-location' }, hasRun ? (a.notes || a.route || '—') : (a.route || '—')),
      el('td', {}, a.type || '—'),
      el('td', { class: 'num' }, running ? num(a.distance_km, 2) + ' km' : num(a.distance_km) + ' km'),
      el('td', { class: 'num' }, num(a.elevation_gain_m, 0) + ' m'),
      el('td', { class: 'num' }, duration),
    ];
    if (hasRun) cells.push(el('td', { class: 'num' }, pace || '—'));
    cells.push(
      el('td', { class: 'num' }, a.avg_hr ? num(a.avg_hr, 0) : '—'),
      el('td', {}, feltStars(a.felt)),
      // 装备列：显示件数，可点整行查看
      el('td', { class: 'num' }, gearCount ? el('span', { class: 'gear-count-badge' }, `🎒 ${gearCount}`) : '—')
    );
    const tr = el('tr', { class: 'activity-row', title: '点击查看本次装备' }, ...cells);
    tr.addEventListener('click', () => openActivityGear(a, gearMap));
    tbody.appendChild(tr);
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

/** 活动 → 装备：弹窗列出本次活动用过的装备，可点进装备详情。
 *  gearMap 可选（slug→装备）；不传时现场构建，保证从装备详情反向进来也能用。 */
function openActivityGear(activity, gearMap) {
  const map = gearMap || new Map((state.data.gear || []).map((g) => [g.slug, g]));
  // 工作副本：编辑不直接改 activity，保存成功后才写回内存
  let working = gearSlugsOf(activity);
  const wrap = el('div', {});

  // 活动概要（距离/爬升/时长/感受）
  const meta = [
    activity.type,
    activity.distance_km != null ? num(activity.distance_km) + ' km' : null,
    activity.elevation_gain_m != null ? num(activity.elevation_gain_m, 0) + ' m 爬升' : null,
  ].filter(Boolean).join(' · ');
  if (meta) wrap.appendChild(el('div', { class: 'rel-summary' }, meta));

  // 可重绘区：装备列表 + 添加下拉 + 合计
  const editArea = el('div', {});
  wrap.appendChild(editArea);

  // 保存按钮引用（rebuild 时据是否有改动启用/禁用）
  let saveBtn = null;
  const origSlugs = gearSlugsOf(activity);
  const dirty = () => working.length !== origSlugs.length || working.some((s, i) => s !== origSlugs[i]);

  function rebuild() {
    editArea.innerHTML = '';

    if (!working.length) {
      editArea.appendChild(el('div', { class: 'empty' }, '本次活动未记录装备，可在下方添加'));
    } else {
      const list = el('div', { class: 'rel-list' });
      let totalWeight = 0, weighed = 0;
      working.forEach((slug) => {
        const g = map.get(slug);
        if (g && g.weight_g != null && !isNaN(Number(g.weight_g))) { totalWeight += Number(g.weight_g); weighed += 1; }
        const item = el('div', { class: 'rel-item gear-edit-row' + (g ? '' : ' rel-item-missing') });
        const info = el('div', { class: 'rel-info' });
        if (g) {
          info.appendChild(el('div', { class: 'rel-name' }, g.name || g.slug));
          info.appendChild(el('div', { class: 'rel-brief' },
            [g.brand, g.weight_g != null ? num(g.weight_g, 0) + ' g' : null, categoryLabel(g.category || '未分类')]
              .filter(Boolean).join(' · ') || '—'));
        } else {
          info.appendChild(el('div', { class: 'rel-name' }, '未知装备'));
          info.appendChild(el('div', { class: 'rel-brief' }, slug + '（装备库中未找到）'));
        }
        item.appendChild(info);
        const actions = el('div', { class: 'gear-edit-actions' });
        if (g) {
          const detailBtn = el('button', { class: 'btn-sm' }, '详情');
          detailBtn.addEventListener('click', () => openGearDetail(g));
          actions.appendChild(detailBtn);
        }
        const rmBtn = el('button', { class: 'btn-sm btn-danger-outline' }, '✕ 移除');
        rmBtn.addEventListener('click', () => { working = working.filter((s) => s !== slug); rebuild(); });
        actions.appendChild(rmBtn);
        item.appendChild(actions);
        list.appendChild(item);
      });
      editArea.appendChild(list);

      const summaryText = weighed
        ? `本次共 ${working.length} 件，其中 ${weighed} 件有重量，合计约 ${num(totalWeight, 0)} g`
        : `本次共 ${working.length} 件`;
      editArea.appendChild(el('div', { class: 'rel-summary rel-summary-total' }, summaryText));
    }

    // 添加下拉：装备库在用装备（排除已选、排除已淘汰），按类别分组
    const addable = (state.data.gear || [])
      .filter((g) => g.condition !== 'retired' && !working.includes(g.slug));
    const addRow = el('div', { class: 'gear-add-row' });
    if (addable.length) {
      const sel = el('select', { class: 'gear-select' });
      sel.appendChild(el('option', { value: '' }, '+ 添加装备…'));
      // 按类别分组
      const byCat = new Map();
      addable.forEach((g) => {
        const c = g.category || '未分类';
        if (!byCat.has(c)) byCat.set(c, []);
        byCat.get(c).push(g);
      });
      Array.from(byCat.keys()).sort().forEach((cat) => {
        const og = el('optgroup', { label: categoryLabel(cat) });
        byCat.get(cat)
          .sort((a, b) => String(a.name || a.slug).localeCompare(String(b.name || b.slug)))
          .forEach((g) => og.appendChild(el('option', { value: g.slug },
            (g.name || g.slug) + (g.weight_g != null ? ` · ${num(g.weight_g, 0)}g` : ''))));
        sel.appendChild(og);
      });
      sel.addEventListener('change', () => {
        const v = sel.value;
        if (v && !working.includes(v)) { working = working.concat([v]); rebuild(); }
      });
      addRow.appendChild(sel);
    } else {
      addRow.appendChild(el('div', { class: 'rel-brief' }, '装备库中已无更多可添加的在用装备'));
    }
    editArea.appendChild(addRow);

    if (saveBtn) {
      saveBtn.disabled = !dirty();
      saveBtn.textContent = dirty() ? '保存' : '未修改';
    }
  }

  saveBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, '保存');
  const closeBtn = el('button', { class: 'btn' }, '关闭');
  const close = showModal(`${fmtDate(activity.date)} · ${activity.route || '活动'} 的装备`, wrap, [saveBtn, closeBtn]);
  saveBtn.addEventListener('click', async () => {
    if (!dirty()) { close(); return; } // 没改动直接关
    await saveActivityGear();
  });

  async function saveActivityGear() {
    if (!state.token) { toast('未连接，无法保存', 'error'); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      const cleanSlugs = working.slice();
      const data = packActivityData(activity, cleanSlugs);
      const rawRes = replaceGearUsedInMarkdown(activity._raw_markdown || '', cleanSlugs);
      const payload = {
        date: activity.date,
        route: activity.route,
        data,
        raw_markdown: rawRes.text,
      };
      await fetchSaveActivity(state.apiUrl, state.token, payload);
      // 就地更新内存，避免整表重拉
      activity.gear_used = cleanSlugs.slice();
      activity._raw_markdown = rawRes.text;
      toast('已更新本次活动的装备', 'info');
      close();
      // 重渲染活动视图（件数徽标随之更新）
      if (typeof renderActivities === 'function') renderActivities();
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
    }
  }

  rebuild();
}


function activityTypeGroup(type) {
  const t = String(type || '').toLowerCase();
  if (/run|跑步|配速/.test(t)) return 'running';
  if (/hike|hiking|徒步|爬山|登山|trail/.test(t)) return 'hiking';
  return 'other';
}

function activityGroupLabel(group) {
  return { running: '跑步', hiking: '徒步/爬山', other: '其他' }[group] || '其他';
}

function renderActivities() {
  const acts = [...state.data.activities].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const view = viewEl('activities');
  view.innerHTML = '';
  const headerRow = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, `全部活动（${acts.length}）`),
    el('button', { class: 'btn-sm btn-primary', 'data-action': 'add-activity' }, '记录活动')
  );
  view.appendChild(headerRow);
  $('.btn-sm[data-action="add-activity"]', headerRow).addEventListener('click', () => openAddActivity());

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
  view.appendChild(el('div', { class: 'section-title' }, `身体趋势（${logs.length} 条记录）`));

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

/** 装备使用概览：统计卡片 + 使用排行（DOM 比例条）+ 磨损/闲置预警。
 *  只吃在用装备（condition!=='retired'），纯读已加载字段，不发 API、不写回。 */
function gearUsageOverview(gearList) {
  const box = el('div', { class: 'gear-usage-overview' });
  const active = (gearList || []).filter((g) => g.condition !== 'retired');
  if (!active.length) return box; // 无在用装备则不显示概览

  const today = fmtDate(new Date().toISOString());

  // ---- 汇总统计 ----
  let totalKm = 0, totalUse = 0, totalHours = 0;
  let mostUsed = null;
  const wearMap = new Map(); // slug -> status
  let attentionCount = 0;
  for (const g of active) {
    const km = Number(g.total_distance_km); if (!isNaN(km)) totalKm += km;
    const uc = Number(g.usage_count); if (!isNaN(uc)) totalUse += uc;
    const hr = Number(g.total_duration_hours); if (!isNaN(hr)) totalHours += hr;
    if ((Number(g.usage_count) || 0) > (mostUsed ? Number(mostUsed.usage_count) || 0 : -1)) mostUsed = g;
    const st = gearWearStatus(g, today);
    wearMap.set(g.slug, st);
    if (st.level !== 'ok') attentionCount++;
  }

  // ---- (a) 统计卡片行 ----
  const statGrid = el('div', { class: 'stat-grid' });
  const statCard = (label, value, unit) =>
    el('div', { class: 'stat-card' },
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, value, unit ? el('span', { class: 'unit' }, ' ' + unit) : '')
    );
  statGrid.appendChild(statCard('累计总里程', num(totalKm, 0), 'km'));
  statGrid.appendChild(statCard('累计出勤', String(totalUse), `次 · ${num(totalHours, 0)}h`));
  statGrid.appendChild(statCard('最常用装备',
    mostUsed && (Number(mostUsed.usage_count) || 0) > 0 ? (mostUsed.name || mostUsed.slug) : '—',
    mostUsed && (Number(mostUsed.usage_count) || 0) > 0 ? `${mostUsed.usage_count} 次` : ''));
  // 待关注卡片：可点击滚动到预警区
  const attnCard = statCard('待关注', String(attentionCount), '件');
  if (attentionCount > 0) {
    attnCard.classList.add('stat-card-clickable');
    attnCard.addEventListener('click', () => {
      const w = $('.wear-warn-section', box);
      if (w) w.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  statGrid.appendChild(attnCard);
  box.appendChild(statGrid);

  // ---- (b) 使用排行（比例条，Top 8）----
  const ranked = active
    .filter((g) => (Number(g.usage_count) || 0) > 0)
    .sort((a, b) => (Number(b.usage_count) || 0) - (Number(a.usage_count) || 0))
    .slice(0, 8);
  const rankCard = el('div', { class: 'chart-card' });
  rankCard.appendChild(el('h3', {}, '使用排行（按次数）'));
  if (!ranked.length) {
    rankCard.appendChild(el('div', { class: 'empty' }, '暂无使用记录'));
  } else {
    const maxUse = Number(ranked[0].usage_count) || 1;
    const rank = el('div', { class: 'usage-rank' });
    for (const g of ranked) {
      const uc = Number(g.usage_count) || 0;
      const km = Number(g.total_distance_km) || 0;
      const pct = Math.max(4, Math.round((uc / maxUse) * 100)); // 至少 4% 可见
      const row = el('div', { class: 'usage-rank-row', title: '点击查看详情' },
        el('div', { class: 'usage-rank-label' }, g.name || g.slug),
        el('div', { class: 'usage-bar-track' }, el('div', { class: 'usage-bar-fill', style: `width:${pct}%;` })),
        el('div', { class: 'usage-rank-meta' }, `${uc} 次${km > 0 ? ' · ' + num(km, 0) + ' km' : ''}`)
      );
      row.addEventListener('click', () => openGearDetail(g));
      rank.appendChild(row);
    }
    rankCard.appendChild(rank);
  }
  box.appendChild(rankCard);

  // ---- (c) 磨损/闲置预警列表 ----
  const order = { alert: 0, warn: 1, idle: 2 };
  const warned = active
    .map((g) => ({ g, st: wearMap.get(g.slug) }))
    .filter((x) => x.st && x.st.level !== 'ok')
    .sort((a, b) => (order[a.st.level] - order[b.st.level]) ||
      ((b.st.pctOfLife || 0) - (a.st.pctOfLife || 0)));

  const warnCard = el('div', { class: 'chart-card wear-warn-section' });
  warnCard.appendChild(el('h3', {}, '磨损 / 闲置提醒（经验参考）'));
  if (!warned.length) {
    warnCard.appendChild(el('div', { class: 'empty' }, '所有在用装备状态良好'));
  } else {
    const list = el('div', { class: 'rel-list' });
    const badgeOf = (lvl) => lvl === 'alert' ? ['status-dot status-alert', 'wear-badge wear-alert', '已达经验寿命']
      : lvl === 'warn' ? ['status-dot status-warn', 'wear-badge wear-warn', '接近经验寿命']
      : ['status-dot status-idle', 'wear-badge wear-idle', '久未使用'];
    for (const { g, st } of warned) {
      const [dotCls, cls, label] = badgeOf(st.level);
      const item = el('div', { class: 'rel-item' },
        el('div', { class: 'rel-info' },
          el('div', { class: 'rel-name' },
            el('span', { class: cls }, [el('span', { class: dotCls }), ' ' + label]),
            ' ' + (g.name || g.slug)),
          el('div', { class: 'rel-brief' }, st.reasons.join(' · '))
        ),
        (() => {
          const btn = el('button', { class: 'btn-sm' }, '详情');
          btn.addEventListener('click', () => openGearDetail(g));
          return btn;
        })()
      );
      list.appendChild(item);
    }
    warnCard.appendChild(list);
    warnCard.appendChild(el('div', { class: 'rel-summary rel-summary-total' },
      '阈值为按类别的经验参考值，非精确寿命；请结合实际磨损情况判断。'));
  }
  box.appendChild(warnCard);

  return box;
}

function renderGear() {
  const allGear = state.data.gear;
  const view = viewEl('gear');
  view.innerHTML = '';

  // 顶部标题 + AI 添加按钮
  const headerRow = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, `装备库（${allGear.length}）`),
    el('button', { class: 'btn-sm btn-primary', 'data-action': 'add-ai' }, 'AI 添加')
  );
  view.appendChild(headerRow);
  $('.btn-sm[data-action="add-ai"]', headerRow).addEventListener('click', () => openAddGearByAi());

  if (!allGear.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无装备'));
    return;
  }

  // 使用统计概览：统计卡片 + 使用排行 + 磨损/闲置预警（放在筛选工具条之上）
  view.appendChild(gearUsageOverview(allGear));

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
    placeholder: '搜索名称 / 品牌 / 型号 / 备注',
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
    el('option', { value: 'usage' }, '按使用次数（多→少）'),
    el('option', { value: 'distance' }, '按里程（多→少）'),
    el('option', { value: 'recent' }, '按最近使用')
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
  } else if (gearFilter.sort === 'distance') {
    list.sort((a, b) => (Number(b.total_distance_km) || 0) - (Number(a.total_distance_km) || 0));
  } else if (gearFilter.sort === 'recent') {
    // 最近使用在前；从没用过的（无 last_used_date）排最后，平局用 slug 稳定
    list.sort((a, b) => byStr(b.last_used_date, a.last_used_date) || byStr(a.slug, b.slug));
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

  // 排序为 name/weight/usage/distance/recent 时用平铺列表（不分组），category 时按类别分组
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
      const link = el('button', { class: 'gear-retired-link' }, `另有 ${retiredCount} 件已淘汰装备，点击查看`);
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
  const retireBtn = el('button', { class: 'btn-sm' + (isRetired ? ' btn-primary' : ''), 'data-action': isRetired ? 'restore' : 'retire' }, isRetired ? '恢复' : '淘汰');
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
      retireBtn.textContent = isRetired ? '恢复' : '淘汰';
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

  // 装备 → 活动：反查这件装备上过哪些活动，形成双向导航闭环
  const used = activitiesUsingGear(g.slug);
  wrap.appendChild(el('div', { class: 'section-title rel-heading' }, `用过的活动（${used.length}）`));
  if (!used.length) {
    wrap.appendChild(el('div', { class: 'empty' }, '暂无关联活动记录'));
  } else {
    const list = el('div', { class: 'rel-list' });
    for (const a of used) {
      const item = el('div', { class: 'rel-item' });
      const info = el('div', { class: 'rel-info' });
      info.appendChild(el('div', { class: 'rel-name' }, `${fmtDate(a.date)} · ${a.route || '活动'}`));
      info.appendChild(el('div', { class: 'rel-brief' },
        [a.type, a.distance_km != null ? num(a.distance_km) + ' km' : null,
         a.elevation_gain_m != null ? num(a.elevation_gain_m, 0) + ' m' : null]
          .filter(Boolean).join(' · ') || '—'));
      item.appendChild(info);
      const btn = el('button', { class: 'btn-sm' }, '查看');
      btn.addEventListener('click', () => openActivityGear(a));
      item.appendChild(btn);
      list.appendChild(item);
    }
    wrap.appendChild(list);
  }

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
  const scrapeBtn = el('button', { class: 'btn btn-primary' }, '从网页抓取');

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
      scrapeBtn.textContent = '从网页抓取';
    }
  });

  panels.scrape.appendChild(urlRow);
  panels.scrape.appendChild(scrapeBtn);

  // ---------- 面板 2：AI 识别 ----------
  panels.ai = el('div', {});
  const aiDefault = buildAiPrompt(g);
  const aiLabel = el('label', {}, '已根据当前装备生成描述，可直接识别，也可补充/修改后识别');
  const aiArea = el('textarea', { id: 'update-ai', rows: 6, placeholder: '例如：始祖鸟 Beta LT 硬壳冲锋衣，黑色 M 码，GORE-TEX 面料，重约 350g，价格 4500 元' }, aiDefault);
  const aiActions = el('div', { class: 'gear-card-actions' });
  const aiBtn = el('button', { class: 'btn btn-primary' }, 'AI 识别');
  const aiAutoBtn = el('button', { class: 'btn' }, '重新生成描述');
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
      aiBtn.textContent = 'AI 识别';
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
  const pasteLabel = el('label', {}, '粘贴商品规格文本（京东/天猫详情页复制即可）');
  const pasteArea = el('textarea', { id: 'update-spec', rows: 6, placeholder: '重量：380g\n面料：GORE-TEX 3L\n…' });
  const parseBtn = el('button', { class: 'btn' }, '解析粘贴文本');

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
  for (const [name, label] of [['ai', 'AI 识别'], ['scrape', '网页抓取'], ['paste', '粘贴规格']]) {
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
  const label = el('label', {}, '输入装备描述，AI 会自动识别名称、品牌、重量、材质等字段');
  const textarea = el('textarea', { id: 'add-gear-ai', rows: 6, placeholder: '例如：始祖鸟 Beta LT 硬壳冲锋衣，黑色 M 码，GORE-TEX 面料，重约 350g，价格 4500 元' });
  const actions = el('div', { class: 'gear-card-actions' });
  const aiBtn = el('button', { class: 'btn btn-primary' }, 'AI 识别并生成');
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
      aiBtn.textContent = 'AI 识别并生成';
    }
  }

  aiBtn.addEventListener('click', run);
  content.appendChild(el('div', { class: 'form-row' }, label, textarea));
  content.appendChild(actions);
  content.appendChild(resultArea);
  showModal('AI 添加装备', content, []);
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

  const saveBtn = el('button', { class: 'btn btn-primary' }, `保存（更新 ${changed.length} 个字段）`);
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
      saveBtn.textContent = `保存（更新 ${changed.length} 个字段）`;
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
  // 顶部标题 + AI 添加 + 推荐装备按钮（空列表时按钮也保留）
  const headerRow = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, `路线库（${routes.length}）`),
    el('div', { style: 'display:flex;gap:8px;' },
      el('button', { class: 'btn-sm btn-primary', 'data-action': 'recommend-gear' }, '推荐装备'),
      el('button', { class: 'btn-sm btn-primary', 'data-action': 'add-route-ai' }, 'AI 添加')
    )
  );
  view.appendChild(headerRow);
  $('.btn-sm[data-action="add-route-ai"]', headerRow).addEventListener('click', () => openAddRouteByAi());
  $('.btn-sm[data-action="recommend-gear"]', headerRow).addEventListener('click', () => openRecommendGear());

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
      el('td', {},
        el('button', { class: 'btn-sm', 'data-action': 'detail', style: 'margin-right:6px;' }, '详情'),
        el('button', { class: 'btn-sm btn-primary', 'data-action': 'recommend', style: 'margin-right:6px;' }, '推荐'),
        el('button', { class: 'btn-sm btn-danger', 'data-action': 'delete' }, '删除')
      )
    );
    $('.btn-sm[data-action="detail"]', tr).addEventListener('click', () => openRouteDetail(r));
    $('.btn-sm[data-action="recommend"]', tr).addEventListener('click', () => openRecommendGear(r));
    $('.btn-sm[data-action="delete"]', tr).addEventListener('click', async () => {
      const used = state.data.activities.filter((a) => a.route === r.name || a.route === r.slug).length;
      const msg = used
        ? `路线「${r.name || r.slug}」已被 ${used} 条活动记录引用。删除路线不会影响已有活动，但活动详情中的路线名会保留。确认删除？`
        : `确认删除路线「${r.name || r.slug}」？`;
      if (!confirm(msg)) return;
      try {
        await fetchDelete(state.apiUrl, state.token, 'routes', r.slug);
        toast('路线已删除', 'success');
        await loadAndRender(true);
      } catch (err) {
        toast(err.message || '删除失败', 'error');
      }
    });
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
    ['天气城市', r.weather_city],
    ['距离', r.distance_km != null ? num(r.distance_km) + ' km' : null],
    ['爬升', r.elevation_gain_m != null ? num(r.elevation_gain_m, 0) + ' m' : null],
    ['下降', r.elevation_loss_m != null ? num(r.elevation_loss_m, 0) + ' m' : null],
    ['最高海拔', r.max_altitude_m != null ? num(r.max_altitude_m, 0) + ' m' : null],
    ['难度', r.difficulty],
    ['预计时长', r.estimated_hours != null ? num(r.estimated_hours) + ' h' : null],
    ['地形', Array.isArray(r.terrain) ? r.terrain.join('、') : r.terrain],
    ['最佳季节', fmtStringList(r.best_seasons)],
    ['水源', fmtStringList(r.water_sources)],
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

/** 生成 URL 安全的路线 slug，支持中英文混排（参照 slugifyGear）。 */
function slugifyRoute(name) {
  const raw = String(name || '').trim().toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return slug || 'route-' + Date.now();
}

/** 把扁平路线对象包成 PUT /routes/:slug 需要的 { data } 结构（剔除注入字段）。 */
function packRoutePayload(data) {
  const copy = { ...data };
  delete copy.slug;
  delete copy._raw_markdown;
  delete copy._updated_at;
  delete copy._path;
  return { data: copy };
}

/** 路线字段预览表（保存前确认用）。 */
function routeFactList(r) {
  const facts = [
    ['名称', r.name],
    ['地点', r.location],
    ['天气城市', r.weather_city],
    ['距离', r.distance_km != null ? num(r.distance_km) + ' km' : null],
    ['爬升', r.elevation_gain_m != null ? num(r.elevation_gain_m, 0) + ' m' : null],
    ['下降', r.elevation_loss_m != null ? num(r.elevation_loss_m, 0) + ' m' : null],
    ['最高海拔', r.max_altitude_m != null ? num(r.max_altitude_m, 0) + ' m' : null],
    ['难度', r.difficulty],
    ['预计时长', r.estimated_hours != null ? num(r.estimated_hours) + ' h' : null],
    ['地形', Array.isArray(r.terrain) ? r.terrain.join('、') : r.terrain],
    ['最佳季节', fmtStringList(r.best_seasons)],
    ['水源', fmtStringList(r.water_sources)],
    ['备注', r.notes],
  ].filter(([, v]) => v != null && v !== '');
  const list = el('ul', { class: 'detail-list' });
  for (const [k, v] of facts) {
    list.appendChild(el('li', {}, el('strong', {}, k + '：'), document.createTextNode(String(v))));
  }
  return list;
}

/** 渲染 AI 路线解析结果 + slug 输入 + 保存按钮。 */
function renderRouteAiResult(container, parsed, provider) {
  container.innerHTML = '';
  if (!parsed || !parsed.name) {
    container.appendChild(el('div', { class: 'empty' }, '没有识别到路线名称，请补充更完整的描述（至少给出路线名）。'));
    return;
  }
  const titleText = provider ? `AI 识别结果（${provider === 'moonshot' ? 'Kimi' : 'DeepSeek'}）` : '识别结果';
  container.appendChild(el('div', { class: 'section-title' }, `${titleText}（确认后保存）`));
  container.appendChild(routeFactList(parsed));

  // slug 可编辑（默认按名称生成）；若与已有路线重名，保存即为覆盖更新，给出提示。
  const existing = new Set((state.data.routes || []).map((r) => r.slug));
  const defSlug = slugifyRoute(parsed.name);
  const slugInput = el('input', { type: 'text', class: 'gear-select', value: defSlug, style: 'width:100%;' });
  const slugRow = el('div', { class: 'form-row' },
    el('label', {}, '路线 ID（slug，可修改；与已有路线相同则覆盖更新）'), slugInput);
  container.appendChild(slugRow);

  const dupHint = el('div', { class: 'wear-badge warn', style: 'display:none;margin:6px 0;' }, '');
  container.appendChild(dupHint);
  const refreshDup = () => {
    if (existing.has(slugInput.value.trim())) {
      dupHint.style.display = ''; dupHint.textContent = '已存在同 ID 路线，保存将覆盖它';
    } else { dupHint.style.display = 'none'; }
  };
  slugInput.addEventListener('input', refreshDup);
  refreshDup();

  const saveBtn = el('button', { class: 'btn btn-primary' }, '保存路线');
  saveBtn.addEventListener('click', async () => {
    const slug = slugInput.value.trim();
    if (!slug) { toast('请填写路线 ID', 'warn'); return; }
    if (!state.token) { toast('未连接，无法保存', 'error'); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      await fetchSaveRoute(state.apiUrl, state.token, slug, packRoutePayload(parsed));
      toast('保存成功，正在刷新…', 'success');
      await loadAndRender(true);
      $$('.modal-overlay').forEach((m) => m.remove());
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '保存路线';
    }
  });
  container.appendChild(saveBtn);
}

/** 通过 AI 一句话添加新路线。 */
function openAddRouteByAi() {
  if (!state.token) { toast('请先连接后再添加路线', 'warn'); return; }
  const content = el('div', {});
  const resultArea = el('div', { class: 'scrape-result' });
  const label = el('label', {}, '用一句话描述路线，AI 会识别名称、距离、爬升、难度等字段');
  const textarea = el('textarea', { id: 'add-route-ai', rows: 5, placeholder: '例如：武功山反穿，江西萍乡，24km 爬升1800m，山脊草甸地形，预计10小时' });
  const actions = el('div', { class: 'gear-card-actions' });
  const aiBtn = el('button', { class: 'btn btn-primary' }, 'AI 识别并生成');
  actions.appendChild(aiBtn);

  async function run() {
    const text = textarea.value.trim();
    if (!text) { toast('请先输入路线描述', 'warn'); return; }
    aiBtn.disabled = true;
    aiBtn.textContent = '识别中…';
    resultArea.innerHTML = '';
    try {
      const res = await fetchAiRoute(state.apiUrl, state.token, text);
      if (!res.ok || !res.data) {
        throw new Error(res.error || 'AI 未返回有效字段');
      }
      renderRouteAiResult(resultArea, res.data, res.provider);
    } catch (err) {
      resultArea.appendChild(el('div', { class: 'error-text' }, err.message || 'AI 识别失败'));
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = 'AI 识别并生成';
    }
  }

  aiBtn.addEventListener('click', run);
  content.appendChild(el('div', { class: 'form-row' }, label, textarea));
  content.appendChild(actions);
  content.appendChild(resultArea);
  showModal('AI 添加路线', content, []);
}

// ---------- 装备推荐 ----------

/** 打开"为路线推荐装备"弹窗。preselectedRoute 为可选的默认路线对象。 */
function openRecommendGear(preselectedRoute) {
  if (!state.token) { toast('请先连接后再使用推荐', 'warn'); return; }

  const routes = [...(state.data.routes || [])].sort((a, b) => String(a.name || a.slug).localeCompare(String(b.name || b.slug)));
  if (!routes.length) { toast('没有路线，请先添加路线', 'warn'); return; }

  const gearMap = new Map((state.data.gear || []).map((g) => [g.slug, g]));
  const today = new Date().toISOString().slice(0, 10);

  const content = el('div', {});

  // --- 表单 ---
  const routeSel = el('select', { class: 'gear-select', style: 'width:100%;' });
  for (const r of routes) {
    routeSel.appendChild(el('option', { value: r.slug }, r.name || r.slug));
  }
  if (preselectedRoute && preselectedRoute.slug) routeSel.value = preselectedRoute.slug;

  const dateInput = el('input', { type: 'date', class: 'gear-select', value: today, style: 'width:100%;' });

  const typeSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: 'hiking' }, '徒步 hiking'),
    el('option', { value: 'trail_running' }, '越野跑 trail_running'),
    el('option', { value: 'running' }, '路跑 running'),
    el('option', { value: 'camping' }, '露营 camping')
  );
  if (preselectedRoute && preselectedRoute.type) typeSel.value = preselectedRoute.type;

  const daysInput = el('input', { type: 'number', class: 'gear-select', value: '1', min: '1', max: '30', style: 'width:100%;' });

  const weatherAuto = el('input', { type: 'radio', name: 'weather-source', value: 'auto', checked: 'checked' });
  const weatherManual = el('input', { type: 'radio', name: 'weather-source', value: 'manual' });

  const manualWeatherBox = el('div', { class: 'form-row', style: 'display:none;flex-wrap:wrap;gap:10px;' });
  const tempLowInput = el('input', { type: 'number', class: 'gear-select', value: '15', placeholder: '最低温 °C', style: 'flex:1;min-width:80px;' });
  const tempHighInput = el('input', { type: 'number', class: 'gear-select', value: '25', placeholder: '最高温 °C', style: 'flex:1;min-width:80px;' });
  const rainInput = el('input', { type: 'number', class: 'gear-select', value: '0', min: '0', max: '100', placeholder: '降水概率 %', style: 'flex:1;min-width:80px;' });
  const windInput = el('input', { type: 'number', class: 'gear-select', value: '10', placeholder: '最大风速 km/h', style: 'flex:1;min-width:80px;' });
  const uvInput = el('input', { type: 'number', class: 'gear-select', value: '5', placeholder: 'UV', style: 'flex:1;min-width:80px;' });
  manualWeatherBox.append(tempLowInput, tempHighInput, rainInput, windInput, uvInput);

  function updateWeatherSource() {
    manualWeatherBox.style.display = weatherManual.checked ? 'flex' : 'none';
  }
  weatherAuto.addEventListener('change', updateWeatherSource);
  weatherManual.addEventListener('change', updateWeatherSource);

  const form = el('div', { class: 'recommend-form' },
    el('div', { class: 'form-row' }, el('label', {}, '路线'), routeSel),
    el('div', { class: 'form-row' }, el('label', {}, '日期'), dateInput),
    el('div', { class: 'form-row' }, el('label', {}, '活动类型'), typeSel),
    el('div', { class: 'form-row' }, el('label', {}, '天数'), daysInput),
    el('div', { class: 'form-row', style: 'align-items:center;gap:14px;' },
      el('label', { style: 'display:flex;align-items:center;gap:6px;' }, weatherAuto, '自动天气'),
      el('label', { style: 'display:flex;align-items:center;gap:6px;' }, weatherManual, '手动天气')
    ),
    manualWeatherBox
  );

  // --- 结果区 ---
  const resultArea = el('div', { class: 'scrape-result', style: 'margin-top:14px;' });
  const genBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, '生成装备推荐');

  content.appendChild(form);
  content.appendChild(genBtn);
  content.appendChild(resultArea);

  let lastResult = null;
  let workingGear = []; // { originalSlug, currentSlug, checked }

  function renderResult() {
    resultArea.innerHTML = '';
    if (!lastResult) return;

    const { weather, backpack, total_weight_g, total_volume_l, risks, route } = lastResult;

    // 摘要卡片
    const summary = el('div', { class: 'recommend-summary card', style: 'margin-bottom:12px;padding:12px;' });
    summary.appendChild(el('div', { class: 'section-title' }, `🌤 ${weather.summary} · ${weather.temp_low_c}°C ~ ${weather.temp_high_c}°C`));
    summary.appendChild(el('div', { class: 'rel-brief' }, `降水 ${weather.precipitation_chance}% · 风速 ${weather.wind_speed_kmh}km/h · UV ${weather.uv_index}`));
    if (backpack) {
      summary.appendChild(el('div', { class: 'rel-brief' }, `🎒 ${backpack.name}（${backpack.capacity_l} L）：${backpack.reason}`));
    }
    summary.appendChild(el('div', { class: 'rel-brief' }, `总重量 ${(total_weight_g / 1000).toFixed(2)} kg · 总体积 ${Number(total_volume_l).toFixed(1)} L`));
    resultArea.appendChild(summary);

    // 全选
    const listHeader = el('div', { class: 'gear-card-actions', style: 'margin-bottom:8px;' });
    const selectAllBtn = el('button', { class: 'btn-sm' }, '全选');
    const deselectAllBtn = el('button', { class: 'btn-sm' }, '取消全选');
    listHeader.appendChild(selectAllBtn);
    listHeader.appendChild(deselectAllBtn);
    resultArea.appendChild(listHeader);

    selectAllBtn.addEventListener('click', () => { workingGear.forEach((x) => x.checked = true); renderList(); updateTotals(); });
    deselectAllBtn.addEventListener('click', () => { workingGear.forEach((x) => x.checked = false); renderList(); updateTotals(); });

    const list = el('div', { class: 'rel-list' });
    resultArea.appendChild(list);

    function updateTotals() {
      let w = 0, v = 0;
      for (const item of workingGear) {
        if (!item.checked) continue;
        const g = gearMap.get(item.currentSlug);
        if (g) {
          w += Number(g.weight_g) || 0;
          v += Number(g.packed_volume_l) || 0;
        }
      }
      summary.querySelector('.rel-brief:last-child').textContent = `总重量 ${(w / 1000).toFixed(2)} kg · 总体积 ${v.toFixed(1)} L`;
    }

    function renderList() {
      list.innerHTML = '';
      for (const item of workingGear) {
        const g = gearMap.get(item.currentSlug);
        if (!g) continue;
        const row = el('div', { class: 'rel-item gear-edit-row' });
        const cb = el('input', { type: 'checkbox' });
        cb.checked = item.checked;
        cb.addEventListener('change', () => { item.checked = cb.checked; updateTotals(); });

        const info = el('div', { class: 'rel-info', style: 'flex:1;' });
        info.appendChild(el('div', { class: 'rel-name' }, g.name || g.slug));
        info.appendChild(el('div', { class: 'rel-brief' },
          [g.weight_g ? num(g.weight_g, 0) + ' g' : null, categoryLabel(g.category), item.originalSlug !== item.currentSlug ? '已替换' : null]
            .filter(Boolean).join(' · ')));

        // 替换下拉：同类别、在用、不是当前项
        const subSel = el('select', { class: 'gear-select', style: 'min-width:120px;' },
          el('option', { value: '' }, '替换为…')
        );
        const alternatives = (state.data.gear || [])
          .filter((x) => x.category === g.category && x.condition !== 'retired' && x.slug !== item.currentSlug);
        for (const alt of alternatives) {
          subSel.appendChild(el('option', { value: alt.slug }, `${alt.name || alt.slug}${alt.weight_g ? ' (' + num(alt.weight_g, 0) + 'g)' : ''}`));
        }
        subSel.value = '';
        subSel.addEventListener('change', () => {
          if (!subSel.value) return;
          item.currentSlug = subSel.value;
          renderList();
          updateTotals();
        });

        row.appendChild(el('label', { style: 'display:flex;align-items:center;gap:10px;flex:1;' }, cb, info));
        row.appendChild(subSel);
        list.appendChild(row);
      }
    }

    renderList();

    // 风险提醒
    if (risks && risks.length) {
      const riskBox = el('div', { class: 'wear-badge wear-alert', style: 'margin-top:12px;' });
      for (const r of risks) riskBox.appendChild(el('div', {}, r));
      resultArea.appendChild(riskBox);
    }
  }

  async function runRecommend() {
    const routeSlug = routeSel.value;
    if (!routeSlug) { toast('请选择路线', 'warn'); return; }

    const payload = {
      route_slug: routeSlug,
      date: dateInput.value,
      type: typeSel.value,
      days: Number(daysInput.value) || 1,
    };

    if (weatherManual.checked) {
      payload.weather_manual = {
        temp_low_c: Number(tempLowInput.value),
        temp_high_c: Number(tempHighInput.value),
        precipitation_chance: Number(rainInput.value),
        wind_speed_kmh: Number(windInput.value),
        uv_index: Number(uvInput.value),
        summary: '手动设置',
      };
    }

    genBtn.disabled = true;
    genBtn.textContent = '推荐中…';
    resultArea.innerHTML = '';
    try {
      const res = await fetchRecommend(state.apiUrl, state.token, payload);
      if (!res.ok) throw new Error(res.error || '推荐失败');
      lastResult = res;
      workingGear = (res.gear || []).map((g) => ({ originalSlug: g.slug, currentSlug: g.slug, checked: true }));
      if (res.backpack) {
        workingGear.push({ originalSlug: res.backpack.slug, currentSlug: res.backpack.slug, checked: true });
      }
      renderResult();
      saveBtn.disabled = false;
      saveBtn.textContent = '保存计划';
    } catch (err) {
      resultArea.appendChild(el('div', { class: 'error-text' }, err.message || '推荐失败'));
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = '生成装备推荐';
    }
  }

  genBtn.addEventListener('click', runRecommend);

  // --- 保存按钮 ---
  const saveBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, '保存计划');
  saveBtn.disabled = true;
  saveBtn.addEventListener('click', async () => {
    if (!lastResult) { toast('请先生成推荐', 'warn'); return; }
    const slugs = workingGear.filter((x) => x.checked).map((x) => x.currentSlug);
    if (!slugs.length) { toast('请至少选择一件装备', 'warn'); return; }

    const route = routes.find((r) => r.slug === routeSel.value);
    const planData = {
      plan_type: 'trip',
      date: dateInput.value,
      route: route ? route.name : routeSel.value,
      type: typeSel.value,
      distance_km: lastResult.route.distance_km,
      elevation_gain_m: lastResult.route.elevation_gain_m,
      elevation_loss_m: lastResult.route.elevation_loss_m,
      estimated_hours: lastResult.route.estimated_hours,
      days: Number(daysInput.value) || 1,
      weather: lastResult.weather,
      gear_recommended: slugs,
      backpack_recommended: lastResult.backpack ? lastResult.backpack.slug : null,
      total_weight_g: lastResult.total_weight_g,
      total_volume_l: lastResult.total_volume_l,
      risks: lastResult.risks,
      generated_at: lastResult.generated_at,
    };

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      await fetchSavePlan(state.apiUrl, state.token, { data: planData, raw_markdown: lastResult.raw_markdown });
      toast('计划已保存', 'success');
      close();
      await loadAndRender(true);
      switchView('plans');
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '保存计划';
    }
  });

  const closeBtn = el('button', { class: 'btn' }, '关闭');
  const close = showModal('推荐装备与计划', content, [saveBtn, closeBtn]);
}

// ---------- 计划 ----------

function renderPlans() {
  const plans = [...state.data.plans].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const view = viewEl('plans');
  view.innerHTML = '';
  view.appendChild(el('div', { class: 'section-title' }, `计划（${plans.length}）`));

  if (!plans.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无计划'));
    return;
  }

  for (const p of plans) {
    const card = el('div', { class: 'card' });
    const typeLabel = p.plan_type === 'recovery' ? '🩹 恢复' : '🎯 行程';
    const titleRow = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
      el('span', {}, `${typeLabel} · ${p.route || p.issue || '计划'} · ${fmtDate(p.date)}`),
      el('button', { class: 'btn-sm btn-danger', 'data-action': 'delete-plan', 'data-id': String(p.id) }, '删除')
    );
    card.appendChild(titleRow);
    const facts = [
      ['距离', p.distance_km != null ? p.distance_km + ' km' : null],
      ['爬升', p.elevation_gain_m != null ? p.elevation_gain_m + ' m' : null],
      ['预计时长', p.estimated_hours != null ? p.estimated_hours + ' h' : null],
      ['恢复天数', p.recovery_days != null ? p.recovery_days + ' 天' : null],
      ['强度', p.intensity_level],
      ['总重量', p.total_weight_g != null ? (p.total_weight_g / 1000).toFixed(2) + ' kg' : null],
      ['总体积', p.total_volume_l != null ? Number(p.total_volume_l).toFixed(1) + ' L' : null],
      ['装备数', Array.isArray(p.gear_recommended) ? p.gear_recommended.length + ' 件' : null],
    ].filter(([, v]) => v != null && v !== '');
    for (const [k, v] of facts) {
      card.appendChild(el('div', {}, el('span', { class: 'badge' }, k), ' ', String(v)));
    }
    if (p.backpack_recommended) {
      const bp = state.data.gear.find((g) => g.slug === p.backpack_recommended);
      card.appendChild(el('div', {}, el('span', { class: 'badge' }, '推荐背包'), ' ', bp ? bp.name : p.backpack_recommended));
    }
    view.appendChild(card);
  }

  // 删除计划按钮事件委托
  view.querySelectorAll('.btn-sm[data-action="delete-plan"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const p = plans.find((x) => String(x.id) === id);
      if (!p) return;
      if (!confirm(`确认删除计划「${p.route || '未命名'} · ${fmtDate(p.date)}」？`)) return;
      try {
        await fetchDelete(state.apiUrl, state.token, 'plans', id);
        toast('计划已删除', 'success');
        await loadAndRender(true);
      } catch (err) {
        toast(err.message || '删除失败', 'error');
      }
    });
  });
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
