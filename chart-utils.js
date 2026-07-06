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
