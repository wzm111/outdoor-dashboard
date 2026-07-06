/* 报告中心视图渲染 */
'use strict';

// ---------- 报告中心 ----------

function renderReports() {
  const view = viewEl('reports');
  view.innerHTML = '';

  const header = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, '报告中心'),
    el('span', { class: 'text-dim' }, '基于全部数据客户端实时计算')
  );
  view.appendChild(header);

  const data = state.data;
  const activities = data.activities || [];
  const gear = data.gear || [];
  const segments = data.segments || [];
  const profile = data.profile || {};
  const today = new Date().toISOString().slice(0, 10);

  // 1. 近 7/30 天活动摘要
  const recent7 = getRecentActivities(activities, 7);
  const recent30 = getRecentActivities(activities, 30);
  const summaryGrid = el('div', { class: 'reports-grid' });
  summaryGrid.appendChild(reportStatCard('近 7 天距离', `${sumDistance(recent7).toFixed(1)} km`, '爬升 ' + sumElevation(recent7).toFixed(0) + ' m'));
  summaryGrid.appendChild(reportStatCard('近 7 天活动', String(recent7.length) + ' 次', '时长 ' + sumDuration(recent7).toFixed(1) + ' h'));
  summaryGrid.appendChild(reportStatCard('近 30 天距离', `${sumDistance(recent30).toFixed(1)} km`, '爬升 ' + sumElevation(recent30).toFixed(0) + ' m'));
  summaryGrid.appendChild(reportStatCard('近 30 天活动', String(recent30.length) + ' 次', '时长 ' + sumDuration(recent30).toFixed(1) + ' h'));
  view.appendChild(summaryGrid);

  // 2. 训练指标（TSS/CTL/ATL/TSB）
  const metrics = computeTrainingMetrics(activities, profile);
  if (metrics && metrics.series && metrics.series.length > 0) {
    const latest = metrics.latest || metrics.series[metrics.series.length - 1];
    const trainingHeader = el('div', { class: 'section-title', style: 'margin-top:20px;' },
      el('span', {}, '训练状态'),
      el('span', { class: 'metric-badges' },
        el('span', { class: 'metric-badge badge-ctl' }, `CTL ${latest.ctl.toFixed(1)}`),
        el('span', { class: 'metric-badge badge-atl' }, `ATL ${latest.atl.toFixed(1)}`),
        el('span', { class: 'metric-badge badge-tsb' }, `TSB ${latest.tsb.toFixed(1)}`)
      )
    );
    view.appendChild(trainingHeader);

    const chartGrid = el('div', { class: 'reports-grid' });
    chartGrid.appendChild(lineChartCard('慢性训练负荷 CTL', metrics.series, 'ctl', '#3b82f6'));
    chartGrid.appendChild(lineChartCard('急性训练负荷 ATL', metrics.series, 'atl', '#f59e0b'));
    chartGrid.appendChild(lineChartCard('训练状态平衡 TSB', metrics.series, 'tsb', latest.tsb >= 0 ? '#22c55e' : '#ef4444'));
    view.appendChild(chartGrid);

    const tsbHint = el('div', { class: 'report-hint' },
      latest.tsb > 25 ? '状态良好，适合挑战或比赛。' :
      latest.tsb >= -10 ? '处于正常训练区间。' :
      latest.tsb >= -30 ? '疲劳积累，注意恢复。' : '过度训练风险，建议休息。'
    );
    view.appendChild(tsbHint);
  } else {
    view.appendChild(el('div', { class: 'empty' }, '训练指标需要至少一条带距离或心率的活动记录'));
  }

  // 3. Gear Health 摘要
  const activeGear = gear.filter((g) => g.condition !== 'retired');
  let alertCount = 0, warnCount = 0, idleCount = 0, okCount = 0;
  const gearAlerts = [];
  for (const g of activeGear) {
    const st = gearWearStatus(g, today, activities);
    if (st.level === 'alert') { alertCount++; gearAlerts.push({ g, st, level: 'critical' }); }
    else if (st.level === 'warn') { warnCount++; gearAlerts.push({ g, st, level: 'warning' }); }
    else if (st.level === 'idle') { idleCount++; }
    else { okCount++; }
  }

  const gearSection = el('div', { class: 'report-card' });
  gearSection.appendChild(el('h3', {}, 'Gear Health'));
  const gearGrid = el('div', { class: 'reports-grid four' });
  gearGrid.appendChild(reportStatCard('建议更换', String(alertCount), '件', alertCount ? 'stat-critical' : ''));
  gearGrid.appendChild(reportStatCard('留意磨损', String(warnCount), '件', warnCount ? 'stat-warn' : ''));
  gearGrid.appendChild(reportStatCard('久未使用', String(idleCount), '件', idleCount ? 'stat-idle' : ''));
  gearGrid.appendChild(reportStatCard('状态良好', String(okCount), '件', 'stat-ok'));
  gearSection.appendChild(gearGrid);

  if (gearAlerts.length > 0) {
    const list = el('div', { class: 'rel-list' });
    gearAlerts
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, idle: 2 };
        return order[a.level] - order[b.level];
      })
      .slice(0, 6)
      .forEach(({ g, st, level }) => {
        const lifecycle = computeGearLifecycle(g, activities, today);
        const advice = gearAiAdvice(g, lifecycle);
        const item = el('div', { class: 'rel-item' },
          el('div', { class: 'rel-info' },
            el('div', { class: 'rel-name' }, g.name || g.slug),
            el('div', { class: 'rel-brief gear-advice-line' }, advice || st.reasons.join('；'))
          ),
          (() => {
            const btn = el('button', { class: 'btn-sm' }, '详情');
            btn.addEventListener('click', () => openGearDetail(g));
            return btn;
          })()
        );
        list.appendChild(item);
      });
    gearSection.appendChild(list);
  }
  view.appendChild(gearSection);

  // 4. Segment PB 榜
  const pbs = computeSegmentPBs(segments, activities);
  const pbSection = el('div', { class: 'report-card' });
  pbSection.appendChild(el('h3', {}, 'Segment 个人最佳'));
  if (!pbs.length) {
    pbSection.appendChild(el('div', { class: 'empty' }, '暂无路段或匹配记录'));
  } else {
    const table = el('table', { class: 'segment-table' });
    table.innerHTML = `<thead><tr><th>路段</th><th>路线</th><th>PB 用时</th><th>日期</th><th>趋势</th></tr></thead>`;
    const tbody = el('tbody');
    for (const pb of pbs.slice(0, 10)) {
      const tr = el('tr');
      tr.appendChild(el('td', {}, pb.segmentName));
      tr.appendChild(el('td', {}, pb.route || '—'));
      tr.appendChild(el('td', {}, formatDuration(pb.best)));
      tr.appendChild(el('td', {}, fmtDate(pb.date)));
      tr.appendChild(el('td', {}, pb.trend));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    pbSection.appendChild(table);
  }
  view.appendChild(pbSection);

  // 5. 本周最常用装备
  const weekGear = getTopGearInRange(activities, gear, 7, 5);
  const gearRankSection = el('div', { class: 'report-card' });
  gearRankSection.appendChild(el('h3', {}, '本周最常用装备'));
  if (!weekGear.length) {
    gearRankSection.appendChild(el('div', { class: 'empty' }, '近 7 天没有记录装备使用'));
  } else {
    const list = el('div', { class: 'usage-rank' });
    const maxUse = weekGear[0].count || 1;
    for (const { g, count } of weekGear) {
      const row = el('div', { class: 'usage-row' },
        el('span', { class: 'usage-label' }, g.name || g.slug),
        el('div', { class: 'usage-bar' },
          el('div', { class: 'usage-bar-fill', style: `width:${(count / maxUse) * 100}%` })
        ),
        el('span', { class: 'usage-value' }, `${count} 次`)
      );
      list.appendChild(row);
    }
    gearRankSection.appendChild(list);
  }
  view.appendChild(gearRankSection);
}

function reportStatCard(label, value, unit, extraClass = '') {
  return el('div', { class: 'stat-card ' + extraClass },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, value, el('span', { class: 'unit' }, ' ' + unit))
  );
}

function getRecentActivities(activities, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return activities.filter((a) => String(a.date) >= cutoffStr);
}

function sumDistance(list) {
  return list.reduce((s, a) => s + (Number(a.distance_km) || 0), 0);
}
function sumElevation(list) {
  return list.reduce((s, a) => s + (Number(a.elevation_gain_m) || 0), 0);
}
function sumDuration(list) {
  return list.reduce((s, a) => s + (Number(a.duration_hours) || 0), 0);
}

function computeTrainingMetrics(activities, profile) {
  if (!activities || activities.length === 0) return null;
  const maxHr = Number(profile.usual_heart_rate_max) || 185;
  const restingHr = Number(profile.resting_heart_rate) || 60;
  const hrReserve = Math.max(1, maxHr - restingHr);

  const dailyTss = {};
  for (const a of activities) {
    const date = String(a.date);
    if (!date) continue;
    let tss = 0;
    const avgHr = Number(a.avg_hr);
    const durationHours = Number(a.duration_hours);
    if (avgHr && durationHours) {
      const typeFactor = { running: 1.0, trail_running: 1.1, hiking: 0.8, climbing: 1.2, walking: 0.6 }[a.type] || 0.8;
      const ratio = Math.max(0.1, Math.min(1.0, (avgHr - restingHr) / hrReserve));
      tss = durationHours * 60 * ratio * typeFactor;
    } else {
      const distance = Number(a.distance_km) || 0;
      const elevation = Number(a.elevation_gain_m) || 0;
      const duration = Number(a.duration_hours) || 0;
      const type = a.type || 'hiking';
      let base = 0;
      if (type === 'running' || type === 'trail_running') base = distance * 8;
      else if (type === 'hiking') base = distance * 5 + elevation * 0.1;
      else if (type === 'climbing') base = duration * 15;
      else base = distance * 5;
      const feltMult = { easy: 0.7, moderate: 1.0, hard: 1.3, extreme: 1.6 }[a.felt] || 1.0;
      tss = base * feltMult;
    }
    dailyTss[date] = (dailyTss[date] || 0) + tss;
  }

  const dates = Object.keys(dailyTss).sort();
  if (dates.length === 0) return null;

  // 计算 EMA：需要补齐中间缺失日期，让 EMA 连续衰减
  const start = new Date(dates[0]);
  const end = new Date(dates[dates.length - 1]);
  const series = [];
  let ctl = 0, atl = 0;
  const ctlDecay = 1 - 1 / 42;
  const atlDecay = 1 - 1 / 7;
  const ctlGain = 1 / 42;
  const atlGain = 1 / 7;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    const tss = dailyTss[ds] || 0;
    ctl = ctl * ctlDecay + tss * ctlGain;
    atl = atl * atlDecay + tss * atlGain;
    series.push({ date: ds, ctl, atl, tsb: ctl - atl });
  }

  return { series, latest: series[series.length - 1] };
}

function computeSegmentPBs(segments, activities) {
  if (!segments || !segments.length || !activities || !activities.length) return [];
  const results = [];
  for (const seg of segments) {
    const segName = seg.name || seg.slug;
    const routeName = seg.route || seg.route_name;
    const records = [];
    for (const a of activities) {
      if (!a.duration_hours) continue;
      const matchByName = segName && a.route && a.route.includes(segName);
      const matchByRoute = routeName && a.route && a.route.includes(routeName);
      if (!matchByName && !matchByRoute) continue;
      records.push({ date: a.date, route: a.route, duration: Number(a.duration_hours) });
    }
    if (!records.length) continue;
    records.sort((a, b) => a.duration - b.duration);
    const best = records[0];
    const prev = records.length > 1 ? records[1] : null;
    let trend = '—';
    if (prev) {
      const diff = prev.duration - best.duration;
      const pct = prev.duration ? (diff / prev.duration) * 100 : 0;
      trend = diff > 0 ? `⬇️ ${pct.toFixed(1)}%` : `⬆️ ${Math.abs(pct).toFixed(1)}%`;
    }
    results.push({
      segmentName: segName || routeName || '未命名',
      route: best.route,
      best: best.duration,
      date: best.date,
      trend,
    });
  }
  return results.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function getTopGearInRange(activities, gear, days, limit) {
  const recent = getRecentActivities(activities, days);
  const counts = new Map();
  for (const a of recent) {
    for (const slug of gearSlugsOf(a)) {
      counts.set(slug, (counts.get(slug) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([slug, count]) => ({ g: gear.find((x) => x.slug === slug) || { slug }, count }))
    .filter((x) => x.g)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function formatDuration(hours) {
  if (hours == null || isNaN(hours)) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}
