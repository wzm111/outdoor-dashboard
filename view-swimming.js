/* 游泳进阶分析视图：KPI / 泳姿分布 / SWOLF 趋势 / 距离档 PB / 同水域对比 */
'use strict';

// ---------- 数据加工 ----------

/** 距离档（米）→ 文本说明。 */
const SWIM_PB_DISTANCES = [200, 400, 800, 1000, 1500, 3000];
const SWIM_PB_TOLERANCE = 0.05; // 5% 误差容忍

/** 距离米数 + 时长 → 平均游泳配速（分钟/100m）。 */
function swimPaceMinPer100m(distanceM, hours) {
  const d = Number(distanceM);
  const t = Number(hours);
  if (d <= 0 || t <= 0) return null;
  return (t * 60 * 100) / d;
}

/** 距离米数 + 时长 → 平均游泳速度（m/min）。 */
function swimSpeedMPerMin(distanceM, hours) {
  const d = Number(distanceM);
  const t = Number(hours);
  if (d <= 0 || t <= 0) return null;
  return d / (t * 60);
}

/** 汇总游泳活动：按日期升序，附泳姿/水域/距离米数/配速/SWOLF。 */
function collectSwims(activities) {
  return (activities || [])
    .filter((a) => isSwimming(a))
    .map((a) => {
      const distanceM = Number(a.distance_m) || (Number(a.distance_km) > 0 ? Number(a.distance_km) * 1000 : 0);
      const dur = Number(a.duration_hours) || 0;
      const pace = distanceM > 0 && dur > 0 ? swimPaceMinPer100m(distanceM, dur) : null;
      return {
        ...a,
        _distanceM: distanceM,
        _pace: pace,
        _speed: swimSpeedMPerMin(distanceM, dur),
        _laps: a.pool_length && distanceM > 0 ? Math.round(distanceM / Number(a.pool_length)) : null,
        _waterType: a.water_type || (a.type === 'open_water_swim' ? 'open_water' : 'pool'),
        _swimStyle: a.swim_style || 'mixed',
        _swolf: a.swolf != null ? Number(a.swolf) : null,
      };
    })
    .filter((a) => a._distanceM > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.sequence || 0) - (b.sequence || 0));
}

const SWIM_STYLE_COLORS = {
  freestyle: '#3b82f6',
  breaststroke: '#10b981',
  backstroke: '#a78bfa',
  butterfly: '#ef4444',
  mixed: '#9ca3af',
};

function swimStyleColor(style) {
  return SWIM_STYLE_COLORS[style] || SWIM_STYLE_COLORS.mixed;
}

function swimStyleDisplayName(style) {
  return {
    freestyle: '自由泳',
    breaststroke: '蛙泳',
    backstroke: '仰泳',
    butterfly: '蝶泳',
    mixed: '混合泳',
  }[style] || style || '—';
}

// ---------- 配速趋势图 ----------

function drawSwimPaceTrend(canvas, swims) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = 200;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const padL = 56, padR = 14, padT = 14, padB = 28;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  const points = swims.filter((s) => s._pace != null);
  if (!points.length) return;

  const vals = points.map((p) => p._pace);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.12;
  lo = Math.max(0, lo - pad);
  hi += pad;

  const x = (i) => padL + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  // 反向 Y：配速值小（快）在上方
  const y = (v) => padT + ((v - lo) / (hi - lo)) * h;

  const css = getComputedStyle(document.body);
  const gridColor = css.getPropertyValue('--border').trim() || '#2a3340';
  const dimColor = css.getPropertyValue('--text-dim').trim() || '#9aa7b4';
  const accent = css.getPropertyValue('--accent').trim() || '#3b82f6';

  ctx.strokeStyle = gridColor;
  ctx.fillStyle = dimColor;
  ctx.font = '11px sans-serif';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gv = lo + ((hi - lo) * i) / 4;
    const gy = y(gv);
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(cssW - padR, gy);
    ctx.stroke();
    ctx.fillText(`${gv.toFixed(2)}`, 6, gy + 4);
  }
  ctx.fillText('快 ↑', cssW - padR - 32, padT + 4);

  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = dimColor;
  ctx.beginPath();
  ctx.moveTo(padL, y(avg));
  ctx.lineTo(cssW - padR, y(avg));
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = dimColor;
  ctx.fillText(`均值 ${avg.toFixed(2)} 分/100m`, padL + 4, y(avg) - 5);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = x(i), py = y(p._pace);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();

  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.fillStyle = swimStyleColor(p._swimStyle);
    ctx.arc(x(i), y(p._pace), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f141a';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  ctx.fillStyle = dimColor;
  ctx.fillText(fmtDate(points[0].date), padL, cssH - 8);
  if (points.length > 1) {
    const lastLabel = fmtDate(points[points.length - 1].date);
    const tw = ctx.measureText(lastLabel).width;
    ctx.fillText(lastLabel, cssW - padR - tw, cssH - 8);
  }
}

// ---------- SWOLF 趋势 ----------

function drawSwolfTrend(canvas, swims) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = 200;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const padL = 40, padR = 14, padT = 14, padB = 28;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  const points = swims.filter((s) => s._swolf != null);
  if (!points.length) return;

  const vals = points.map((p) => p._swolf);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) { lo -= 5; hi += 5; }
  const pad = (hi - lo) * 0.12;
  lo = Math.max(0, lo - pad);
  hi += pad;

  const x = (i) => padL + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v) => padT + ((v - lo) / (hi - lo)) * h;

  const css = getComputedStyle(document.body);
  const gridColor = css.getPropertyValue('--border').trim() || '#2a3340';
  const dimColor = css.getPropertyValue('--text-dim').trim() || '#9aa7b4';
  const accent = css.getPropertyValue('--accent').trim() || '#3b82f6';

  ctx.strokeStyle = gridColor;
  ctx.fillStyle = dimColor;
  ctx.font = '11px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const gv = lo + ((hi - lo) * i) / 4;
    const gy = y(gv);
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(cssW - padR, gy);
    ctx.stroke();
    ctx.fillText(`${Math.round(gv)}`, 6, gy + 4);
  }

  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = dimColor;
  ctx.beginPath();
  ctx.moveTo(padL, y(avg));
  ctx.lineTo(cssW - padR, y(avg));
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = dimColor;
  ctx.fillText(`均值 ${avg.toFixed(1)}`, padL + 4, y(avg) - 5);

  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = x(i), py = y(p._swolf);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();

  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.fillStyle = swimStyleColor(p._swimStyle);
    ctx.arc(x(i), y(p._swolf), 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f141a';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  ctx.fillStyle = dimColor;
  ctx.fillText(fmtDate(points[0].date), padL, cssH - 8);
  if (points.length > 1) {
    const lastLabel = fmtDate(points[points.length - 1].date);
    const tw = ctx.measureText(lastLabel).width;
    ctx.fillText(lastLabel, cssW - padR - tw, cssH - 8);
  }
}

// ---------- 视图渲染 ----------

function renderSwimming() {
  const view = viewEl('swimming');
  clearViewKeepSkeleton(view);

  const swims = collectSwims(state.data.activities);

  view.appendChild(el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, '游泳分析'),
    el('span', { class: 'text-dim' }, `共 ${swims.length} 次`)
  ));

  if (!swims.length) {
    view.appendChild(el('div', { class: 'empty' }, '还没有游泳记录，记录几次后再来看分析'));
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const d30 = new Date(); d30.setDate(d30.getDate() - 30);
  const d30Str = d30.toISOString().slice(0, 10);
  const swims30 = swims.filter((s) => String(s.date) >= d30Str && String(s.date) <= today);

  const totalDistM = swims.reduce((s, x) => s + x._distanceM, 0);
  const dist30M = swims30.reduce((s, x) => s + x._distanceM, 0);
  const totalHours = swims.reduce((s, x) => s + (Number(x.duration_hours) || 0), 0);
  const recent10 = swims.slice(-10);
  const recent10WithPace = recent10.filter((s) => s._pace != null);
  const avgPace = recent10WithPace.length
    ? recent10WithPace.reduce((s, x) => s + x._pace, 0) / recent10WithPace.length
    : null;

  // ---------- KPI ----------
  const kpiGrid = el('div', { class: 'reports-grid four' });
  kpiGrid.appendChild(reportStatCard('游泳次数', String(swims.length), '次'));
  kpiGrid.appendChild(reportStatCard('总距离', (totalDistM / 1000).toFixed(2), 'km'));
  kpiGrid.appendChild(reportStatCard('近 30 天', (dist30M / 1000).toFixed(2), `km · ${swims30.length} 次`));
  kpiGrid.appendChild(reportStatCard('总时长', totalHours.toFixed(1), '小时'));
  view.appendChild(kpiGrid);

  // 额外一行：近 10 次平均配速 / 平均 SWOLF
  const extraGrid = el('div', { class: 'reports-grid three' });
  extraGrid.appendChild(reportStatCard(
    '近 10 次均配速',
    avgPace != null ? `${avgPace.toFixed(2)}` : '—',
    avgPace != null ? '分/100m' : ''
  ));
  const swolfValues = swims.filter((s) => s._swolf != null).map((s) => s._swolf);
  const avgSwolf = swolfValues.length ? swolfValues.reduce((s, v) => s + v, 0) / swolfValues.length : null;
  extraGrid.appendChild(reportStatCard(
    '平均 SWOLF',
    avgSwolf != null ? avgSwolf.toFixed(1) : '—',
    avgSwolf != null ? `${swolfValues.length} 次有数据` : '尚无 SWOLF 记录'
  ));
  const poolCount = swims.filter((s) => s._waterType === 'pool').length;
  extraGrid.appendChild(reportStatCard('泳池/开放水域', `${poolCount} / ${swims.length - poolCount}`, '次'));
  view.appendChild(extraGrid);

  // ---------- 泳姿距离分布 ----------
  const styleDist = {};
  for (const s of swims) {
    styleDist[s._swimStyle] = (styleDist[s._swimStyle] || 0) + s._distanceM;
  }
  const styleBars = Object.entries(styleDist)
    .map(([k, v]) => ({
      label: swimStyleDisplayName(k),
      value: Math.round((v / 1000) * 10) / 10,
      color: swimStyleColor(k),
    }))
    .sort((a, b) => b.value - a.value);
  if (styleBars.length) {
    view.appendChild(barChartCard('泳姿距离分布（km）', styleBars, { height: 180 }));
  }

  // ---------- 距离档 PB 卡片 ----------
  const pbItems = [];
  for (const dist of SWIM_PB_DISTANCES) {
    const candidates = swims.filter((s) => {
      const d = s._distanceM;
      return d >= dist * (1 - SWIM_PB_TOLERANCE) && d <= dist * (1 + SWIM_PB_TOLERANCE);
    });
    if (candidates.length) {
      const best = candidates.reduce((a, b) => (a._pace <= b._pace ? a : b));
      const paceStr = best._pace != null
        ? `${best._pace.toFixed(2)} 分/100m`
        : (best.duration_hours ? fmtDuration(best.duration_hours) : '—');
      pbItems.push({
        label: `${dist}m 最佳`,
        value: paceStr,
        sub: `${fmtDate(best.date)} · ${Math.round(best._distanceM)}m · ${swimStyleDisplayName(best._swimStyle)}`,
      });
    }
  }
  if (pbItems.length) {
    const pbGrid = el('div', { class: 'reports-grid three' });
    for (const p of pbItems.slice(0, 6)) {
      const card = reportStatCard(p.label, p.value, '');
      if (p.sub) card.appendChild(el('div', { class: 'change change-flat' }, p.sub));
      pbGrid.appendChild(card);
    }
    view.appendChild(pbGrid);
  }

  // ---------- 配速趋势 ----------
  if (swims.filter((s) => s._pace != null).length >= 2) {
    const card = el('div', { class: 'chart-card' });
    card.appendChild(el('h3', {}, '配速趋势（按泳姿着色）'));
    const canvas = el('canvas');
    card.appendChild(canvas);
    requestAnimationFrame(() => drawSwimPaceTrend(canvas, swims));
    view.appendChild(card);
  }

  // ---------- SWOLF 趋势 ----------
  if (swolfValues.length >= 2) {
    const card = el('div', { class: 'chart-card' });
    card.appendChild(el('h3', {}, `SWOLF 趋势（${swolfValues.length} 次有数据）`));
    const canvas = el('canvas');
    card.appendChild(canvas);
    requestAnimationFrame(() => drawSwolfTrend(canvas, swims));
    view.appendChild(card);
  }

  // ---------- 同泳姿对比 ----------
  const byStyle = new Map();
  for (const s of swims) {
    if (!byStyle.has(s._swimStyle)) byStyle.set(s._swimStyle, []);
    byStyle.get(s._swimStyle).push(s);
  }
  if (byStyle.size) {
    const card = el('div', { class: 'report-card' });
    card.appendChild(el('h3', {}, '同泳姿对比'));
    const table = el('table', { class: 'data-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, '泳姿'),
      el('th', { class: 'num' }, '次数'),
      el('th', { class: 'num' }, '总距离'),
      el('th', { class: 'num' }, '最佳配速'),
      el('th', { class: 'num' }, '最近配速'),
    )));
    const tbody = el('tbody');
    const rows = [...byStyle.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [style, list] of rows) {
      const withPace = list.filter((s) => s._pace != null);
      const best = withPace.length ? Math.min(...withPace.map((s) => s._pace)) : null;
      const latest = list[list.length - 1];
      const totalM = list.reduce((s, x) => s + x._distanceM, 0);
      const tr = el('tr', { style: `cursor:pointer; border-left: 4px solid ${swimStyleColor(style)};` },
        td(swimStyleDisplayName(style), 'col-location'),
        td(String(list.length), 'num'),
        td(`${(totalM / 1000).toFixed(1)} km`, 'num'),
        td(best != null ? `${best.toFixed(2)} /100m` : '—', 'num'),
        td(latest._pace != null ? `${latest._pace.toFixed(2)} · ${fmtDate(latest.date)}` : '—', 'num')
      );
      tr.title = '点击查看最近一次活动详情';
      tr.addEventListener('click', () => openActivityDetail(latest));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    card.appendChild(table);
    view.appendChild(card);
  }
}
