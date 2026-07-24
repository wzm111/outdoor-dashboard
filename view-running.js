/* 跑步进阶分析视图：心率分区 / 配速趋势 / PB / 同路线对比 */
'use strict';

// ---------- 数据加工 ----------

/** 取单次跑步的配速（分钟/公里）：优先 avg_pace 字段，否则由距离/时长反算。 */
function runPaceMinPerKm(a) {
  if (a.avg_pace) {
    const p = parsePaceToMinPerKm(a.avg_pace);
    if (p && p > 0) return p;
  }
  const d = Number(a.distance_km);
  const t = Number(a.duration_hours);
  if (d > 0 && t > 0) return (t * 60) / d;
  return null;
}

/** 把分钟/公里格式化为 M:SS/km。 */
function fmtPaceMin(minPerKm) {
  if (minPerKm == null || isNaN(minPerKm)) return '—';
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 心率分区模型（基于最大心率百分比）。 */
const HR_ZONES = [
  { key: 'Z1', name: '恢复', lo: 0.0, hi: 0.60, color: '#94a3b8' },
  { key: 'Z2', name: '有氧', lo: 0.60, hi: 0.70, color: '#4ade80' },
  { key: 'Z3', name: '节奏', lo: 0.70, hi: 0.80, color: '#facc15' },
  { key: 'Z4', name: '阈值', lo: 0.80, hi: 0.90, color: '#fb923c' },
  { key: 'Z5', name: '无氧', lo: 0.90, hi: 2.0, color: '#f87171' },
];

/** 根据 profile 和身体日志构建当前的心率分区模型。
 *  优先 Karvonen（心率储备）模型；缺失静息心率时回退 %HRmax。 */
function hrZonesForProfile(profile, bodyLogs) {
  profile = profile || {};
  const maxHr = Number(profile.usual_heart_rate_max) || (profile.age ? 220 - Number(profile.age) : 185);

  // 取最近一条有 resting_hr 的身体日志；回退 profile.resting_heart_rate；默认 60
  let restingHr = Number(profile.resting_heart_rate) || 60;
  let rhrSource = '默认 60';
  const sortedLogs = (bodyLogs || [])
    .filter((b) => Number(b.resting_hr) > 0)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (sortedLogs.length) {
    restingHr = Number(sortedLogs[0].resting_hr);
    rhrSource = `身体日志 ${fmtDate(sortedLogs[0].date)}`;
  } else if (profile.resting_heart_rate) {
    rhrSource = '体能档案';
  }

  const reserve = Math.max(1, maxHr - restingHr);
  // 只有当静息心率来自真实数据（身体日志或 profile）时才用 Karvonen
  // 默认 60 是猜测，不应触发 Karvonen —— 否则会高估 Z2/Z3 区间
  const useKarvonen = rhrSource !== '默认 60';
  const toBpm = (ratio) => {
    if (ratio >= 2) return maxHr;
    return useKarvonen
      ? Math.round(restingHr + ratio * reserve)
      : Math.round(ratio * maxHr);
  };

  return {
    maxHr,
    restingHr,
    rhrSource,
    reserve,
    useKarvonen,
    zones: HR_ZONES.map((z) => ({
      ...z,
      loBpm: toBpm(z.lo),
      hiBpm: toBpm(z.hi),
    })),
  };
}

function hrZoneOf(avgHr, model) {
  if (!avgHr || !model) return null;
  return model.zones.find((z) => avgHr >= z.loBpm && avgHr < z.hiBpm) || null;
}

/** 汇总跑步活动：按日期升序，附配速/心率分区。 */
function collectRuns(activities, model) {
  return (activities || [])
    .filter((a) => isRunning(a) && Number(a.distance_km) > 0)
    .map((a) => {
      const pace = runPaceMinPerKm(a);
      const zone = hrZoneOf(Number(a.avg_hr), model);
      return { ...a, _pace: pace, _zone: zone };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.sequence || 0) - (b.sequence || 0));
}

// ---------- 配速趋势图（Y 轴反向：快在上） ----------

function drawPaceTrend(canvas, runs) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = 200;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const padL = 48, padR = 14, padT = 14, padB = 28;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  const points = runs.filter((r) => r._pace != null);
  if (!points.length) return;

  const vals = points.map((p) => p._pace);
  let lo = Math.min(...vals); // 最快
  let hi = Math.max(...vals); // 最慢
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
  const accent = css.getPropertyValue('--accent').trim() || '#4ade80';

  // 网格 + Y 轴（M:SS 标签，顶部标注「快」）
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
    ctx.fillText(fmtPaceMin(gv), 6, gy + 4);
  }
  ctx.fillText('快 ↑', cssW - padR - 30, padT + 4);

  // 平均配速虚线
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
  ctx.fillText(`均值 ${fmtPaceMin(avg)}`, padL + 4, y(avg) - 5);

  // 折线
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = x(i), py = y(p._pace);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // 数据点（按心率分区着色，无分区用主色）
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.fillStyle = p._zone ? p._zone.color : accent;
    ctx.arc(x(i), y(p._pace), 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f141a';
    ctx.lineWidth = 1;
    ctx.stroke();
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

// ---------- 视图渲染 ----------

function renderRunning() {
  const view = viewEl('running');
  clearViewKeepSkeleton(view);

  const profile = state.data.profile || {};
  const bodyLogs = state.data.body_logs || [];
  const model = hrZonesForProfile(profile, bodyLogs);
  const maxHr = model.maxHr;
  const runs = collectRuns(state.data.activities, model);

  view.appendChild(el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, '跑步分析'),
    el('span', { class: 'text-dim' }, `${model.useKarvonen ? 'Karvonen' : '%HRmax'} 分区 · 最大心率 ${maxHr} · 静息心率 ${model.restingHr}（${model.rhrSource}）`)
  ));

  if (!runs.length) {
    view.appendChild(el('div', { class: 'empty' }, '还没有跑步记录，记录几次路跑后再来看分析'));
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const d30 = new Date(); d30.setDate(d30.getDate() - 30);
  const d30Str = d30.toISOString().slice(0, 10);
  const runs30 = runs.filter((r) => String(r.date) >= d30Str && String(r.date) <= today);
  const totalDist = runs.reduce((s, r) => s + (Number(r.distance_km) || 0), 0);
  const dist30 = runs30.reduce((s, r) => s + (Number(r.distance_km) || 0), 0);
  const paced = runs.filter((r) => r._pace != null && Number(r.distance_km) >= 3); // 配速类统计排除 <3km 短冲刺
  const recent10 = paced.slice(-10);
  const avgPace10 = recent10.length ? recent10.reduce((s, r) => s + r._pace, 0) / recent10.length : null;

  // ---------- KPI ----------
  const kpiGrid = el('div', { class: 'reports-grid four' });
  kpiGrid.appendChild(reportStatCard('跑步次数', String(runs.length), '次'));
  kpiGrid.appendChild(reportStatCard('总距离', totalDist.toFixed(1), 'km'));
  kpiGrid.appendChild(reportStatCard('近 30 天', dist30.toFixed(1), `km · ${runs30.length} 次`));
  kpiGrid.appendChild(reportStatCard('近 10 次均速', avgPace10 ? fmtPaceMin(avgPace10) : '—', '/km'));
  view.appendChild(kpiGrid);

  // ---------- PB 卡片 ----------
  const pbItems = [];
  const bestPace = paced.length ? Math.min(...paced.map((r) => r._pace)) : null;
  if (bestPace != null) {
    const r = paced.find((x) => x._pace === bestPace);
    pbItems.push({ label: '最快配速', value: fmtPaceMin(bestPace) + '/km', sub: `${fmtDate(r.date)} · ${num(r.distance_km, 2)}km` });
  }
  for (const [name, loD, hiD] of [['5km 最佳', 4.8, 5.3], ['10km 最佳', 9.5, 10.5]]) {
    const group = paced.filter((r) => Number(r.distance_km) >= loD && Number(r.distance_km) <= hiD);
    if (group.length) {
      const best = group.reduce((a, b) => (a._pace <= b._pace ? a : b));
      pbItems.push({ label: name, value: fmtPaceMin(best._pace) + '/km', sub: `${fmtDate(best.date)} · ${best.duration_hours ? fmtDuration(best.duration_hours) : ''}` });
    }
  }
  const longest = runs.reduce((a, b) => (Number(a.distance_km) >= Number(b.distance_km) ? a : b));
  pbItems.push({ label: '最长距离', value: num(longest.distance_km, 2) + ' km', sub: fmtDate(longest.date) });
  const durations = runs.filter((r) => Number(r.duration_hours) > 0);
  if (durations.length) {
    const longestT = durations.reduce((a, b) => (Number(a.duration_hours) >= Number(b.duration_hours) ? a : b));
    pbItems.push({ label: '最长时长', value: fmtDuration(longestT.duration_hours), sub: `${fmtDate(longestT.date)} · ${num(longestT.distance_km, 1)}km` });
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

  // ---------- 心率分区 ----------
  const zonedRuns = runs.filter((r) => r._zone);
  if (zonedRuns.length) {
    const zoneDist = HR_ZONES.map((z) => ({ zone: z, dist: 0, count: 0 }));
    for (const r of zonedRuns) {
      const zb = zoneDist.find((x) => x.zone.key === r._zone.key);
      if (zb) {
        zb.dist += Number(r.distance_km) || 0;
        zb.count += 1;
      }
    }
    const bars = zoneDist.map((zb) => ({
      label: `${zb.zone.key} ${zb.zone.name}`,
      value: Math.round(zb.dist * 10) / 10,
      color: zb.zone.color,
    }));
    const card = barChartCard(`心率分区分布（按距离 km，共 ${zonedRuns.length} 次带心率记录）`, bars, { height: 190 });
    // 分区说明行
    const legend = el('div', { class: 'hr-zone-legend' });
    for (const zb of zoneDist) {
      const mz = model.zones.find((z) => z.key === zb.zone.key);
      const lo = mz ? mz.loBpm : Math.round(zb.zone.lo * maxHr);
      const hi = mz ? mz.hiBpm : (zb.zone.hi >= 2 ? '∞' : Math.round(zb.zone.hi * maxHr));
      legend.appendChild(el('span', { class: 'hr-zone-chip', style: `--zone-color:${zb.zone.color}` },
        `${zb.zone.key} ${zb.zone.name} ${lo}–${hi} · ${zb.count} 次`));
    }
    card.appendChild(legend);
    view.appendChild(card);

    // ---------- 训练强度分布建议 ----------
    const totalZoned = zoneDist.reduce((s, x) => s + x.dist, 0);
    if (totalZoned > 0) {
      const pct = (k) => {
        const zb = zoneDist.find((x) => x.zone.key === k);
        return zb ? zb.dist / totalZoned : 0;
      };
      const p1 = pct('Z1'), p2 = pct('Z2'), p3 = pct('Z3'),
            p4 = pct('Z4'), p5 = pct('Z5');
      const easy = p1 + p2;
      const hard = p4 + p5;
      let level = 'balanced';
      let advice = '强度分布比较均衡，继续保持当前训练结构。';
      let style = 'tip-info';
      if (p3 >= 0.6 && easy < 0.2) {
        level = 'trap';
        advice = '你的跑步强度集中在 Z3（节奏区），低强度有氧跑偏少。长期如此可能抑制有氧基础提升。建议每周安排 1–2 次真正的 Z2 轻松跑，心率控制在 Z2 区间，用「能边跑边聊天」的强度完成。';
        style = 'tip-warn';
      } else if (easy >= 0.4 && hard <= 0.2) {
        level = 'aerobic-good';
        advice = '有氧基础结构良好，Z1+Z2 占比充足。可以适度增加 1 次 Z4 阈值跑或 Z5 间歇来提升上限。';
        style = 'tip-good';
      } else if (hard >= 0.4) {
        level = 'hard';
        advice = '高强度训练占比较高，记得穿插足够的 Z1/Z2 主动恢复跑，避免过度训练。';
        style = 'tip-warn';
      }
      const tipCard = el('div', { class: `report-card hr-intensity-tip ${style}` });
      tipCard.appendChild(el('h3', {}, '训练强度分布解读'));
      const pctLine = el('div', { class: 'hr-intensity-pcts' });
      for (const zb of zoneDist) {
        const p = (zb.dist / totalZoned) * 100;
        pctLine.appendChild(el('span', { class: 'hr-intensity-pct', style: `--zone-color:${zb.zone.color}` },
          `${zb.zone.key} ${p.toFixed(0)}%`));
      }
      tipCard.appendChild(pctLine);
      tipCard.appendChild(el('p', { class: 'hr-intensity-advice' }, advice));
      if (level === 'trap' && !profile.resting_heart_rate) {
        tipCard.appendChild(el('p', { class: 'text-dim', style: 'font-size:12px;margin-top:6px;' },
          '💡 提示：填入晨起静息心率（身体 → 添加记录）可获得更准确的 Karvonen 分区。'));
      }
      view.appendChild(tipCard);
    }
  }

  // ---------- 配速趋势 ----------
  if (paced.length >= 2) {
    const card = el('div', { class: 'chart-card' });
    card.appendChild(el('h3', {}, `配速趋势（${paced.length} 次 ≥3km，点为心率分区色）`));
    const canvas = el('canvas');
    card.appendChild(canvas);
    requestAnimationFrame(() => drawPaceTrend(canvas, paced));
    view.appendChild(card);
  }

  // ---------- 同路线对比 ----------
  const byRoute = new Map();
  for (const r of paced) {
    const key = String(r.route || '').trim() || '路跑（无路线）';
    if (!byRoute.has(key)) byRoute.set(key, []);
    byRoute.get(key).push(r);
  }
  if (byRoute.size) {
    const card = el('div', { class: 'report-card' });
    card.appendChild(el('h3', {}, '同路线对比'));
    const table = el('table', { class: 'data-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, '路线'), el('th', { class: 'num' }, '次数'),
      el('th', { class: 'num' }, '最佳配速'), el('th', { class: 'num' }, '最近配速'),
      el('th', { class: 'num' }, '趋势')
    )));
    const tbody = el('tbody');
    const rows = [...byRoute.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [route, list] of rows) {
      const best = Math.min(...list.map((r) => r._pace));
      const latest = list[list.length - 1];
      let trend = el('span', { class: 'text-dim' }, '—');
      if (list.length >= 2) {
        const prev = list[list.length - 2];
        const diff = latest._pace - prev._pace; // 负 = 变快
        if (Math.abs(diff) < 0.05) trend = el('span', { class: 'change change-flat' }, '→ 持平');
        else if (diff < 0) trend = el('span', { class: 'change change-up' }, `↑ 快 ${fmtPaceMin(Math.abs(diff))}`);
        else trend = el('span', { class: 'change change-down' }, `↓ 慢 ${fmtPaceMin(Math.abs(diff))}`);
      }
      const tr = el('tr', { style: 'cursor:pointer;' },
        td(route, 'col-location'),
        td(String(list.length), 'num'),
        td(fmtPaceMin(best), 'num'),
        td(`${fmtPaceMin(latest._pace)} · ${fmtDate(latest.date)}`, 'num'),
        td(trend, 'num')
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
