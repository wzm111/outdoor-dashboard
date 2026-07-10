/* Canvas 折线图表工具 */
'use strict';

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

// ---------- 环形图 ----------

function donutChartCard(title, slices) {
  const card = el('div', { class: 'report-card' });
  card.appendChild(el('h3', {}, title));
  const chart = donutChart(slices);
  if (!chart) {
    card.appendChild(el('div', { class: 'empty' }, '无数据'));
    return card;
  }
  card.appendChild(chart);
  return card;
}

function donutChart(slices) {
  const total = slices.reduce((s, x) => s + (Number(x.value) || 0), 0);
  if (!total) return null;

  const wrapper = el('div', { class: 'donut-chart-wrapper' });

  const chartWrap = el('div', { class: 'donut-chart' });
  const canvas = el('canvas');
  chartWrap.appendChild(canvas);
  chartWrap.appendChild(
    el('div', { class: 'donut-center' },
      el('div', { class: 'donut-center-value' }, (total / 1000).toFixed(2) + ' kg'),
      el('div', { class: 'donut-center-label' }, '总重量')
    )
  );
  wrapper.appendChild(chartWrap);

  const legend = el('div', { class: 'donut-legend' });
  for (const s of slices) {
    legend.appendChild(
      el('div', { class: 'donut-legend-item' },
        el('span', { class: 'donut-legend-label' },
          el('span', { class: 'donut-legend-swatch', style: `background:${s.color}` }),
          s.label
        ),
        el('span', { class: 'donut-legend-value' }, `${(s.value / 1000).toFixed(2)} kg (${total ? Math.round((s.value / total) * 100) : 0}%)`)
      )
    );
  }
  wrapper.appendChild(legend);

  requestAnimationFrame(() => drawDonut(canvas, slices));
  return wrapper;
}

function drawDonut(canvas, slices) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 160;
  const cssH = canvas.clientHeight || 160;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const total = slices.reduce((s, x) => s + (Number(x.value) || 0), 0);
  if (!total) return;

  const cx = cssW / 2;
  const cy = cssH / 2;
  const radius = Math.min(cx, cy) - 8;
  const thickness = 22;

  let start = -Math.PI / 2;
  for (const s of slices) {
    const frac = s.value / total;
    const end = start + frac * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = thickness;
    ctx.stroke();
    start = end;
  }
}

// ---------- 柱状图 ----------

function barChartCard(title, bars, opts = {}) {
  const card = el('div', { class: 'chart-card' });
  card.appendChild(el('h3', {}, title));
  if (!bars || !bars.length) {
    card.appendChild(el('div', { class: 'empty' }, '无数据'));
    return card;
  }
  const canvas = el('canvas');
  card.appendChild(canvas);
  requestAnimationFrame(() => drawBars(canvas, bars, opts));
  return card;
}

function drawBars(canvas, bars, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = opts.height || 180;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const padL = opts.padL || 44;
  const padR = opts.padR || 12;
  const padT = opts.padT || 16;
  const padB = opts.padB || 34;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  const vals = bars.map((b) => Number(b.value) || 0);
  let max = Math.max(...vals);
  if (max === 0) max = 1;
  max *= 1.1;

  const css = getComputedStyle(document.body);
  const gridColor = css.getPropertyValue('--border').trim() || '#2a3340';
  const dimColor = css.getPropertyValue('--text-dim').trim() || '#9aa7b4';
  const accentColor = opts.color || css.getPropertyValue('--accent').trim() || '#4ade80';

  // 网格 + Y 轴
  ctx.strokeStyle = gridColor;
  ctx.fillStyle = dimColor;
  ctx.font = '11px sans-serif';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gv = (max * i) / 4;
    const gy = padT + h - (gv / max) * h;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(cssW - padR, gy);
    ctx.stroke();
    ctx.fillText(gv.toFixed(gv >= 100 ? 0 : 1), 4, gy + 4);
  }

  const gapRatio = opts.gapRatio || 0.35;
  const barW = w / (bars.length * (1 + gapRatio) - gapRatio);
  const gap = barW * gapRatio;

  for (let i = 0; i < bars.length; i++) {
    const v = vals[i];
    const bh = (v / max) * h;
    const bx = padL + i * (barW + gap);
    const by = padT + h - bh;

    ctx.fillStyle = bars[i].color || accentColor;
    ctx.beginPath();
    ctx.roundRect(bx, by, barW, bh, Math.min(4, barW / 3));
    ctx.fill();

    // X 轴标签（隔一个显示，避免拥挤）
    if (bars.length <= 8 || i % 2 === 0) {
      ctx.fillStyle = dimColor;
      ctx.textAlign = 'center';
      ctx.fillText(String(bars[i].label || ''), bx + barW / 2, cssH - 10);
    }
  }
  ctx.textAlign = 'start';
}

// ---------- 海拔剖面图 ----------

function elevationProfileCard(title, points, opts = {}) {
  const card = el('div', { class: 'report-card elevation-profile-card' });
  card.appendChild(el('h3', {}, title));
  if (!points || !points.length) {
    card.appendChild(el('div', { class: 'empty' }, '无轨迹数据'));
    return card;
  }

  const canvasWrap = el('div', { class: 'elevation-profile-wrap' });
  const canvas = el('canvas', { class: 'elevation-profile-canvas' });
  canvasWrap.appendChild(canvas);
  const tooltip = el('div', { class: 'elevation-profile-tooltip' });
  canvasWrap.appendChild(tooltip);
  card.appendChild(canvasWrap);

  const stats = opts.stats || (() => {
    // chart-utils 不依赖 gpx-utils，兜底内联计算
    let gainM = 0, lossM = 0;
    let minEleM = points[0].ele, maxEleM = points[0].ele;
    for (let i = 1; i < points.length; i++) {
      const diff = points[i].ele - points[i - 1].ele;
      if (diff > 0) gainM += diff;
      else lossM += Math.abs(diff);
      minEleM = Math.min(minEleM, points[i].ele);
      maxEleM = Math.max(maxEleM, points[i].ele);
    }
    return {
      distanceKm: points[points.length - 1].distanceKm || 0,
      gainM: Math.round(gainM),
      lossM: Math.round(lossM),
      minEleM: Math.round(minEleM),
      maxEleM: Math.round(maxEleM),
    };
  })();
  const statRow = el('div', { class: 'elevation-stat-row' });
  const stat = (label, value, unit) =>
    el('div', { class: 'elevation-stat' },
      el('div', { class: 'elevation-stat-value' }, value, unit ? el('span', { class: 'elevation-stat-unit' }, unit) : ''),
      el('div', { class: 'elevation-stat-label' }, label));
  statRow.appendChild(stat('距离', num(stats.distanceKm, 1), 'km'));
  statRow.appendChild(stat('爬升', num(stats.gainM, 0), 'm'));
  statRow.appendChild(stat('下降', num(stats.lossM, 0), 'm'));
  statRow.appendChild(stat('最高', num(stats.maxEleM, 0), 'm'));
  statRow.appendChild(stat('最低', num(stats.minEleM, 0), 'm'));
  card.appendChild(statRow);

  requestAnimationFrame(() => {
    drawElevationProfile(canvas, points, opts);
    attachElevationHover(canvas, points, tooltip, opts);
  });
  return card;
}

function drawElevationProfile(canvas, points, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = opts.height || 220;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  if (!points || points.length < 2) return;

  const padL = 46, padR = 16, padT = 24, padB = 28;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  const distances = points.map((p) => p.distanceKm || 0);
  const elevations = points.map((p) => p.ele || 0);
  const maxD = Math.max(...distances);
  let minE = Math.min(...elevations);
  let maxE = Math.max(...elevations);
  if (minE === maxE) { minE -= 10; maxE += 10; }
  const pad = (maxE - minE) * 0.05;
  minE -= pad;
  maxE += pad;

  const x = (d) => padL + (maxD ? (d / maxD) * w : 0);
  const y = (e) => padT + h - ((e - minE) / (maxE - minE)) * h;

  const css = getComputedStyle(document.body);
  const gridColor = css.getPropertyValue('--border').trim() || '#2a3340';
  const dimColor = css.getPropertyValue('--text-dim').trim() || '#9aa7b4';
  const lineColor = css.getPropertyValue('--accent').trim() || '#4ade80';

  // 网格 + 刻度
  ctx.strokeStyle = gridColor;
  ctx.fillStyle = dimColor;
  ctx.font = '11px sans-serif';
  ctx.lineWidth = 1;
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const ev = minE + ((maxE - minE) * i) / yTicks;
    const py = y(ev);
    ctx.beginPath();
    ctx.moveTo(padL, py);
    ctx.lineTo(cssW - padR, py);
    ctx.stroke();
    ctx.fillText(Math.round(ev) + 'm', 4, py + 4);
  }
  const xTicks = Math.min(6, Math.max(2, Math.floor(maxD)));
  for (let i = 0; i <= xTicks; i++) {
    const dv = (maxD / xTicks) * i;
    const px = x(dv);
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, padT + h);
    ctx.stroke();
    ctx.fillText(dv.toFixed(1) + 'km', px, padT + h + 16);
  }

  // 填充区域
  const gradient = ctx.createLinearGradient(0, padT, 0, padT + h);
  gradient.addColorStop(0, 'rgba(74, 222, 128, 0.35)');
  gradient.addColorStop(1, 'rgba(74, 222, 128, 0.03)');
  ctx.beginPath();
  ctx.moveTo(x(distances[0]), y(elevations[0]));
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(x(distances[i]), y(elevations[i]));
  }
  ctx.lineTo(x(distances[distances.length - 1]), padT + h);
  ctx.lineTo(x(distances[0]), padT + h);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // 海拔线
  ctx.beginPath();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.moveTo(x(distances[0]), y(elevations[0]));
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(x(distances[i]), y(elevations[i]));
  }
  ctx.stroke();

  // 关键点位标注
  const annotations = [];
  const startIdx = 0;
  const endIdx = points.length - 1;
  let maxIdx = 0, minIdx = 0;
  for (let i = 1; i < elevations.length; i++) {
    if (elevations[i] > elevations[maxIdx]) maxIdx = i;
    if (elevations[i] < elevations[minIdx]) minIdx = i;
  }

  annotations.push({ idx: startIdx, text: `起点 ${Math.round(elevations[startIdx])}m`, color: '#4ade80', anchor: 'start' });
  annotations.push({ idx: endIdx, text: `终点 ${Math.round(elevations[endIdx])}m`, color: '#f87171', anchor: 'end' });
  annotations.push({ idx: maxIdx, text: `▲ 最高 ${Math.round(elevations[maxIdx])}m`, color: '#fbbf24', anchor: 'middle' });
  if (minIdx !== startIdx && minIdx !== endIdx) {
    annotations.push({ idx: minIdx, text: `▼ 最低 ${Math.round(elevations[minIdx])}m`, color: '#60a5fa', anchor: 'middle' });
  }

  ctx.font = 'bold 11px sans-serif';
  for (const ann of annotations) {
    const px = x(distances[ann.idx]);
    const py = y(elevations[ann.idx]) - 10;
    ctx.fillStyle = ann.color;
    ctx.textAlign = ann.anchor;
    ctx.fillText(ann.text, px, py);
    // 点
    ctx.beginPath();
    ctx.arc(px, y(elevations[ann.idx]), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = 'start';

  // 交互高亮：垂直参考线与当前点
  const hi = opts.highlightIndex;
  if (hi != null && hi >= 0 && hi < points.length) {
    const px = x(distances[hi]);
    const py = y(elevations[hi]);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, padT + h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

// ---------- 海拔剖面交互提示 ----------

function attachElevationHover(canvas, points, tooltip, opts) {
  const wrap = canvas.parentElement;
  if (!wrap) return;

  const padL = 46, padR = 16;
  const distances = points.map((p) => p.distanceKm || 0);
  const maxD = Math.max(...distances);

  function findIndex(clientX) {
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width;
    const w = cssW - padL - padR;
    const xRel = clientX - rect.left - padL;
    const ratio = maxD && w > 0 ? Math.max(0, Math.min(1, xRel / w)) : 0;
    const targetD = ratio * maxD;
    let idx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < points.length; i++) {
      const diff = Math.abs((points[i].distanceKm || 0) - targetD);
      if (diff < minDiff) { minDiff = diff; idx = i; }
    }
    return idx;
  }

  function cumulativeGainTo(idx) {
    let gain = 0;
    for (let i = 1; i <= idx; i++) {
      const diff = points[i].ele - points[i - 1].ele;
      if (diff > 0) gain += diff;
    }
    return gain;
  }

  function showAt(clientX, clientY) {
    const idx = findIndex(clientX);
    const p = points[idx];
    if (!p) return;
    const gain = cumulativeGainTo(idx);
    tooltip.innerHTML = [
      '<div>距离 ' + num(p.distanceKm, 1) + ' km</div>',
      '<div>海拔 ' + Math.round(p.ele) + ' m</div>',
      '<div>累计爬升 ' + Math.round(gain) + ' m</div>',
    ].join('');
    tooltip.style.display = 'block';

    const wrapRect = wrap.getBoundingClientRect();
    let left = clientX - wrapRect.left;
    let top = clientY - wrapRect.top - tooltip.offsetHeight - 8;
    if (left < tooltip.offsetWidth / 2) left = tooltip.offsetWidth / 2;
    if (left > wrapRect.width - tooltip.offsetWidth / 2) left = wrapRect.width - tooltip.offsetWidth / 2;
    if (top < 0) top = clientY - wrapRect.top + 12;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    drawElevationProfile(canvas, points, { ...opts, highlightIndex: idx });
  }

  function hide() {
    tooltip.style.display = 'none';
    drawElevationProfile(canvas, points, opts);
  }

  wrap.addEventListener('mousemove', (e) => showAt(e.clientX, e.clientY));
  wrap.addEventListener('mouseleave', hide);
  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length) showAt(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  wrap.addEventListener('touchmove', (e) => {
    if (e.touches.length) {
      e.preventDefault();
      showAt(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });
  wrap.addEventListener('touchend', hide);
}
