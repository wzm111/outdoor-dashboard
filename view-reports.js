/* 报告中心视图渲染 */
'use strict';

// ---------- 报告中心 ----------

function renderReports() {
  const view = viewEl('reports');
  clearViewKeepSkeleton(view);

  const header = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, '报告中心'),
    el('span', { class: 'text-dim' }, '基于全部数据客户端实时计算')
  );
  view.appendChild(header);

  const data = state.data;
  const activities = data.activities || [];
  const gear = data.gear || [];
  const segments = data.segments || [];
  const bodyLogs = data.body_logs || [];
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

  // 2. 周报/月报周期摘要
  const periodSection = el('div', { class: 'report-card' });
  periodSection.appendChild(el('h3', {}, '周期摘要'));
  const periodGrid = el('div', { class: 'reports-grid two' });

  const weekRange = getPeriodRange(today, 'week');
  const weekCurrent = computePeriodSummary(activities, weekRange.start, weekRange.end);
  const weekPrev = computePeriodSummary(activities, weekRange.prevStart, weekRange.prevEnd);
  periodGrid.appendChild(renderPeriodSummaryCard('本周', weekCurrent, weekPrev, weekRange.start, weekRange.end));

  const monthRange = getPeriodRange(today, 'month');
  const monthCurrent = computePeriodSummary(activities, monthRange.start, monthRange.end);
  const monthPrev = computePeriodSummary(activities, monthRange.prevStart, monthRange.prevEnd);
  periodGrid.appendChild(renderPeriodSummaryCard('本月', monthCurrent, monthPrev, monthRange.start, monthRange.end));

  periodSection.appendChild(periodGrid);
  view.appendChild(periodSection);

  // 3. 训练指标（TSS/CTL/ATL/TSB）
  const metrics = computeTrainingMetrics(activities, profile);
  if (metrics && metrics.series && metrics.series.length > 0) {
    const latest = metrics.latest || metrics.series[metrics.series.length - 1];
    const status = metrics.status || {};
    const trendText = metrics.ctlTrend || '数据不足';

    const trainingHeader = el('div', { class: 'section-title', style: 'margin-top:20px;' },
      el('span', {}, '训练状态'),
      el('span', { class: 'metric-badges' },
        el('span', { class: 'metric-badge badge-ctl' }, `CTL ${latest.ctl.toFixed(1)}`),
        el('span', { class: 'metric-badge badge-atl' }, `ATL ${latest.atl.toFixed(1)}`),
        el('span', { class: 'metric-badge badge-tsb' }, `TSB ${latest.tsb.toFixed(1)}`)
      )
    );
    view.appendChild(trainingHeader);

    // 状态评估卡
    const statusCard = el('div', { class: 'report-card training-status-card' });
    statusCard.appendChild(
      el('div', { class: 'training-status-row' },
        el('span', { class: 'training-status-emoji' }, status.emoji || ''),
        el('span', { class: 'training-status-text' }, status.text || ''),
        el('span', { class: 'training-trend-text' }, `CTL 趋势：${trendText}`)
      )
    );
    statusCard.appendChild(el('div', { class: 'report-hint' }, status.advice || ''));
    view.appendChild(statusCard);

    const chartGrid = el('div', { class: 'reports-grid' });
    chartGrid.appendChild(lineChartCard('慢性训练负荷 CTL', metrics.series, 'ctl', '#3b82f6'));
    chartGrid.appendChild(lineChartCard('急性训练负荷 ATL', metrics.series, 'atl', '#f59e0b'));
    chartGrid.appendChild(lineChartCard('训练状态平衡 TSB', metrics.series, 'tsb', latest.tsb >= 0 ? '#22c55e' : '#ef4444'));
    view.appendChild(chartGrid);

    // 周 TSS 汇总
    if (metrics.weeklySummary && Object.keys(metrics.weeklySummary).length) {
      const tssBars = Object.entries(metrics.weeklySummary)
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .slice(-8)
        .map(([week, d]) => ({ label: week.slice(5), value: d.tssTotal || 0 }));
      view.appendChild(barChartCard('近 8 周 TSS 总量', tssBars, { color: '#8b5cf6' }));
    }

    // 近期活动 TSS 明细
    if (metrics.activityDetails && metrics.activityDetails.length) {
      const tssSection = el('div', { class: 'report-card' });
      tssSection.appendChild(el('h3', {}, '近期活动 TSS 明细'));
      const table = el('table', { class: 'tss-table' });
      table.innerHTML = `<thead><tr><th>日期</th><th>路线</th><th>类型</th><th>距离</th><th>时长</th><th>心率</th><th>TSS</th><th>感受</th></tr></thead>`;
      const tbody = el('tbody');
      for (const a of metrics.activityDetails.slice(-10).reverse()) {
        const tr = el('tr');
        tr.appendChild(el('td', {}, fmtDate(a.date)));
        tr.appendChild(el('td', {}, a.route || '—'));
        tr.appendChild(el('td', {}, activityTypeLabel(a.type)));
        tr.appendChild(el('td', {}, a.distance_km != null ? num(a.distance_km, 1) + ' km' : '—'));
        tr.appendChild(el('td', {}, a.duration_hours != null ? num(a.duration_hours, 1) + ' h' : '—'));
        tr.appendChild(el('td', {}, a.avg_hr ? Math.round(a.avg_hr) + ' bpm' : '—'));
        tr.appendChild(el('td', {}, el('span', { class: 'tss-badge' }, Math.round(a.tss || 0))));
        tr.appendChild(el('td', {}, a.felt || '—'));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      tssSection.appendChild(table);
      view.appendChild(tssSection);
    }
  } else {
    view.appendChild(el('div', { class: 'empty' }, '训练指标需要至少一条带距离或心率的活动记录'));
  }

  // 4. 训练负荷（ACWR + 疲劳 + 周历史）
  const loadSection = renderTrainingLoad(activities, bodyLogs, today);
  view.appendChild(loadSection);

  // 5. 装备重量分类报告
  const gwReport = computeGearWeightReport(gear);
  const gwSection = el('div', { class: 'report-card' });
  gwSection.appendChild(el('h3', {}, '装备重量分类'));
  if (gwReport.total > 0) {
    const gwWrap = el('div', { class: 'gear-weight-report' });
    const slices = [
      { label: 'Base', value: gwReport.base, color: '#3b82f6' },
      { label: 'Worn', value: gwReport.worn, color: '#22c55e' },
      { label: 'Consumable', value: gwReport.consumable, color: '#f59e0b' },
    ].filter((s) => s.value > 0);
    const donut = donutChart(slices);
    if (donut) gwWrap.appendChild(donut);

    const summary = el('div', { class: 'gear-weight-summary' });
    summary.appendChild(renderGearWeightCategory('Base', gwReport.base, gwReport.total, gwReport.items.base));
    summary.appendChild(renderGearWeightCategory('Worn', gwReport.worn, gwReport.total, gwReport.items.worn));
    summary.appendChild(renderGearWeightCategory('Consumable', gwReport.consumable, gwReport.total, gwReport.items.consumable));
    gwWrap.appendChild(summary);

    if (gwReport.advice.length) {
      gwWrap.appendChild(
        el('div', { class: 'gear-weight-advice' },
          el('strong', {}, '💡 轻量化建议'),
          el('ul', {}, ...gwReport.advice.map((a) => el('li', {}, a)))
        )
      );
    }
    gwSection.appendChild(gwWrap);
  } else {
    gwSection.appendChild(el('div', { class: 'empty' }, '暂无装备数据'));
  }
  view.appendChild(gwSection);

  // 6. Gear Health 摘要
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
        const info = el('div', { class: 'rel-info' },
          el('div', { class: 'rel-name' }, g.name || g.slug),
          el('div', { class: 'rel-brief gear-advice-line' }, advice || st.reasons.join('；'))
        );

        if (lifecycle.max_ratio > 0) {
          const pct = Math.min(100, Math.round(lifecycle.max_ratio * 100));
          const fillClass = pct >= 90 ? 'critical' : pct >= 70 ? 'warn' : 'good';
          info.appendChild(
            el('div', { class: 'gear-wear-line' },
              el('div', { class: 'gear-wear-progress' },
                el('div', { class: `gear-wear-fill ${fillClass}`, style: `width:${pct}%` })
              ),
              el('div', { class: 'rel-brief' }, `经验寿命 ${pct}% · 里程 ${num(lifecycle.total_distance_km, 1)} km · 使用 ${lifecycle.usage_count} 次`)
            )
          );
        }

        const maintenance = Array.isArray(g.maintenance_log) ? g.maintenance_log : (g.maintenance_log ? [g.maintenance_log] : []);
        if (maintenance.length) {
          const logWrap = el('div', { class: 'maintenance-log' },
            el('div', { class: 'maintenance-log-title' }, '维护记录')
          );
          for (const entry of maintenance.slice(-3)) {
            logWrap.appendChild(el('div', { class: 'maintenance-log-item' }, String(entry)));
          }
          info.appendChild(logWrap);
        }

        const item = el('div', { class: 'rel-item' },
          info,
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

  // 7. 体能等级评估
  const fitness = computeFitnessAssessment(profile, activities, gear);
  const fitnessSection = el('div', { class: 'report-card' });
  fitnessSection.appendChild(el('h3', {}, '体能等级评估'));
  if (fitness && fitness.score != null) {
    const scoreColor = fitness.score >= 80 ? '#22c55e' : fitness.score >= 60 ? '#3b82f6' : fitness.score >= 40 ? '#f59e0b' : '#ef4444';
    const fitnessWrap = el('div', { class: 'fitness-score-card' });

    const ring = el('div', { class: 'fitness-score-ring' });
    const circumference = 2 * Math.PI * 60;
    const offset = circumference * (1 - fitness.score / 100);
    ring.innerHTML = `
      <svg viewBox="0 0 140 140">
        <circle class="fitness-score-track" cx="70" cy="70" r="60"></circle>
        <circle class="fitness-score-fill" cx="70" cy="70" r="60" stroke="${scoreColor}"
                stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle>
      </svg>
      <div class="fitness-score-number">
        <div class="fitness-score-value">${Math.round(fitness.score)}</div>
        <div class="fitness-score-level">${fitness.level}</div>
      </div>
    `;
    fitnessWrap.appendChild(ring);

    const dims = el('div', { class: 'fitness-dimensions' });
    const dimMeta = [
      { key: 'weight', label: '体重系数', color: '#3b82f6' },
      { key: 'pack', label: '负重系数', color: '#22c55e' },
      { key: 'distance', label: '距离系数', color: '#f59e0b' },
      { key: 'elevation', label: '爬升系数', color: '#ef4444' },
    ];
    for (const dm of dimMeta) {
      const score = Math.round(fitness.factors[dm.key]);
      dims.appendChild(
        el('div', { class: 'fitness-dimension-row' },
          el('span', { class: 'fitness-dimension-label' }, dm.label),
          el('div', { class: 'fitness-dimension-bar' },
            el('div', { class: 'fitness-dimension-fill', style: `width:${score}%;background:${dm.color}` })
          ),
          el('span', { class: 'fitness-dimension-score' }, `${score}`)
        )
      );
    }
    fitnessWrap.appendChild(dims);
    fitnessSection.appendChild(fitnessWrap);

    fitnessSection.appendChild(
      el('div', { class: 'report-hint' },
        `平均负重 ${fitness.avgPackWeight.toFixed(1)} kg · 平均距离 ${fitness.avgDistance.toFixed(1)} km · 平均爬升 ${fitness.avgElevation.toFixed(0)} m · ${fitness.levelDesc}`
      )
    );

    if (fitness.advice.length) {
      fitnessSection.appendChild(
        el('div', { class: 'fitness-advice' },
          el('strong', {}, '📈 训练建议'),
          el('ul', {}, ...fitness.advice.map((a) => el('li', {}, a)))
        )
      );
    }
  } else {
    fitnessSection.appendChild(el('div', { class: 'empty' }, '需要体能档案中的体重与至少一条活动记录'));
  }
  view.appendChild(fitnessSection);

  // 8. Segment PB 榜
  const pbs = computeSegmentPBs(segments, activities);
  const pbSection = el('div', { class: 'report-card' });
  pbSection.appendChild(el('h3', {}, 'Segment 个人最佳'));
  if (!pbs.length) {
    pbSection.appendChild(el('div', { class: 'empty' }, '暂无路段或匹配记录'));
  } else {
    for (const pb of pbs.slice(0, 10)) {
      const block = el('div', { class: 'segment-pb-block' });
      block.appendChild(
        el('div', { class: 'segment-pb-header' },
          el('span', { class: 'segment-pb-name' }, pb.segmentName),
          el('span', { class: `segment-trend segment-trend-${pb.trendKey}` }, pb.trend),
          el('span', { class: 'segment-pb-time' }, formatDuration(pb.best))
        )
      );
      block.appendChild(
        el('div', { class: 'segment-pb-meta' },
          `${fmtDate(pb.date)} · ${pb.route || '—'} · ${pb.distance_km != null ? num(pb.distance_km, 1) + ' km' : '—'}`
        )
      );
      if (pb.records && pb.records.length > 1) {
        const mini = el('div', { class: 'segment-mini-records' });
        for (const r of pb.records.slice(-3).reverse()) {
          mini.appendChild(
            el('div', { class: 'segment-mini-record' },
              el('span', {}, fmtDate(r.date)),
              el('span', {}, formatDuration(r.duration_hours)),
              r.is_pb ? el('span', { class: 'segment-mini-pb' }, '⭐ PB') : null
            )
          );
        }
        block.appendChild(mini);
      }
      pbSection.appendChild(block);
    }
  }
  view.appendChild(pbSection);

  // 9. 本周最常用装备
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

function reportStatCardWithChange(label, value, unit, changeText, changeClass) {
  const card = reportStatCard(label, value, unit);
  if (changeText) {
    card.appendChild(el('div', { class: 'change ' + changeClass }, changeText));
  }
  return card;
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

// ---------- 周期摘要 ----------

function getPeriodRange(refDate, mode) {
  const ref = new Date(refDate + 'T00:00:00');
  if (mode === 'week') {
    const day = ref.getDay();
    const start = new Date(ref);
    start.setDate(ref.getDate() - (day === 0 ? 6 : day - 1));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const prevStart = new Date(start);
    prevStart.setDate(start.getDate() - 7);
    const prevEnd = new Date(prevStart);
    prevEnd.setDate(prevStart.getDate() + 6);
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      prevStart: prevStart.toISOString().slice(0, 10),
      prevEnd: prevEnd.toISOString().slice(0, 10),
    };
  }
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  const prevStart = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
  const prevEnd = new Date(ref.getFullYear(), ref.getMonth(), 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    prevStart: prevStart.toISOString().slice(0, 10),
    prevEnd: prevEnd.toISOString().slice(0, 10),
  };
}

function computePeriodSummary(activities, start, end) {
  const list = activities.filter((a) => {
    const d = String(a.date);
    return d >= start && d <= end;
  });

  const typeCounts = {};
  const routeCounts = {};
  for (const a of list) {
    const t = a.type || 'other';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
    const r = a.route || '其他';
    routeCounts[r] = (routeCounts[r] || 0) + 1;
  }

  const typeBreakdown = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));
  const topRoutes = Object.entries(routeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([route, count]) => ({ route, count }));

  return {
    count: list.length,
    distance: sumDistance(list),
    elevation: sumElevation(list),
    duration: sumDuration(list),
    typeBreakdown,
    topRoutes,
  };
}

function renderChange(current, previous, unit) {
  if (previous === 0) return current > 0 ? { text: `⬆️ 新增 ${current.toFixed(1)}${unit}`, cls: 'change-up' } : { text: '—', cls: 'change-same' };
  const diff = current - previous;
  const pct = Math.abs((diff / previous) * 100).toFixed(0);
  if (Math.abs(diff) < 0.01) return { text: '➡️ 持平', cls: 'change-same' };
  if (diff > 0) return { text: `⬆️ ${pct}%`, cls: 'change-up' };
  return { text: `⬇️ ${pct}%`, cls: 'change-down' };
}

function renderPeriodSummaryCard(title, current, previous, start, end) {
  const card = el('div', { class: 'stat-card' });
  card.appendChild(
    el('div', { class: 'period-header' },
      el('span', { class: 'period-label' }, title),
      el('span', { class: 'period-dates' }, `${start.slice(5)} ~ ${end.slice(5)}`)
    )
  );

  const distChange = renderChange(current.distance, previous.distance, 'km');
  const countChange = renderChange(current.count, previous.count, '次');

  const grid = el('div', { class: 'reports-grid two', style: 'margin-top:0;' });
  grid.appendChild(reportStatCardWithChange('距离', current.distance.toFixed(1), 'km', distChange.text, distChange.cls));
  grid.appendChild(reportStatCardWithChange('活动', String(current.count), '次', countChange.text, countChange.cls));
  grid.appendChild(reportStatCard('爬升', current.elevation.toFixed(0), 'm'));
  grid.appendChild(reportStatCard('时长', current.duration.toFixed(1), 'h'));
  card.appendChild(grid);

  if (current.typeBreakdown.length) {
    const tags = el('div', { class: 'type-tags' });
    for (const t of current.typeBreakdown) {
      tags.appendChild(
        el('span', { class: 'type-tag' },
          el('span', { class: 'type-tag-dot' }),
          `${activityTypeLabel(t.type)} ${t.count}`
        )
      );
    }
    card.appendChild(tags);
  }

  if (current.topRoutes.length) {
    card.appendChild(
      el('div', { class: 'top-routes' },
        el('strong', {}, '常用路线：'),
        current.topRoutes.map((r) => `${r.route}(${r.count})`).join('、')
      )
    );
  }

  return card;
}

function activityTypeLabel(type) {
  return {
    running: '跑步', trail_running: '越野跑', hiking: '徒步',
    climbing: '攀岩', cycling: '骑行', walking: '步行',
  }[type] || type;
}

// ---------- 装备重量分类 ----------

const GEAR_WEIGHT_WORN = new Set(['shoes', 'jacket', 'pants', 'shirt', 'base_layer', 'mid_layer', 'hat', 'gloves', 'socks', 'watch', 'glasses', 'belt']);
const GEAR_WEIGHT_BASE = new Set(['backpack', 'tent', 'sleeping_bag', 'sleeping_pad', 'stove', 'cookware', 'water_filter', 'electronics', 'light', 'poles', 'first_aid', 'tools', 'protection']);
const GEAR_WEIGHT_CONSUMABLE = ['food', 'water', 'fuel', 'battery', 'snack', 'meal'];

function classifyGearWeight(g) {
  const category = String(g.category || '').toLowerCase();
  const itemType = String(g.type || '').toLowerCase();
  const name = String(g.name || '').toLowerCase();

  if (GEAR_WEIGHT_WORN.has(category) || GEAR_WEIGHT_WORN.has(itemType)) return 'worn';
  if (GEAR_WEIGHT_BASE.has(category) || GEAR_WEIGHT_BASE.has(itemType)) return 'base';
  if (GEAR_WEIGHT_CONSUMABLE.some((kw) => category.includes(kw) || itemType.includes(kw) || name.includes(kw))) return 'consumable';
  return 'base';
}

function computeGearWeightReport(gear) {
  const items = { base: [], worn: [], consumable: [] };
  let base = 0, worn = 0, consumable = 0;

  for (const g of gear) {
    const weight = Number(g.weight_g) || 0;
    const cls = classifyGearWeight(g);
    items[cls].push({ name: g.name || g.slug, weight_g: weight, category: g.category });
    if (cls === 'base') base += weight;
    else if (cls === 'worn') worn += weight;
    else consumable += weight;
  }

  for (const k of Object.keys(items)) {
    items[k].sort((a, b) => b.weight_g - a.weight_g);
  }

  const total = base + worn + consumable;
  const advice = [];
  if (base > 5000) advice.push('Base Weight 超过 5kg，建议审视是否有冗余装备');
  else if (base > 3000) advice.push('Base Weight 在 3-5kg 范围，属于轻量 backpacking 水平');
  else if (total > 0) advice.push('Base Weight 低于 3kg，属于 ultralight 水平 👍');

  if (total > 15000) advice.push('总重量超过 15kg，长距离徒步建议进一步减重');
  else if (total > 10000) advice.push('总重量在 10-15kg，属于中等负重水平');
  else if (total > 0) advice.push('总重量低于 10kg，负重控制良好 👍');

  return { base, worn, consumable, total, items, advice };
}

function renderGearWeightCategory(name, weight, total, items) {
  const card = el('div', { class: 'gear-weight-category' });
  card.appendChild(
    el('div', { class: 'gear-weight-category-header' },
      el('span', { class: 'gear-weight-category-name' }, name),
      el('span', { class: 'gear-weight-category-pct' }, total ? Math.round((weight / total) * 100) + '%' : '—')
    )
  );
  card.appendChild(el('div', { class: 'gear-weight-category-kg' }, (weight / 1000).toFixed(2) + ' kg'));

  if (items.length) {
    const list = el('div', { class: 'gear-weight-top-list' });
    list.appendChild(el('h4', {}, 'Top 5'));
    for (const it of items.slice(0, 5)) {
      list.appendChild(
        el('div', { class: 'gear-weight-item' },
          el('span', {}, it.name),
          el('span', {}, `${it.weight_g} g`)
        )
      );
    }
    card.appendChild(list);
  }
  return card;
}

// ---------- 体能等级评估 ----------

function estimatePackWeight(activity, gearMap) {
  if (activity.pack_weight_kg) return Number(activity.pack_weight_kg);

  let knownWeight = 0;
  for (const slug of gearSlugsOf(activity)) {
    const g = gearMap[slug];
    if (g) knownWeight += Number(g.weight_g) || 0;
  }

  const distance = Number(activity.distance_km) || 0;
  const duration = Number(activity.duration_hours) || 0;
  const type = activity.type || 'hiking';
  let extra = 1000;
  if (type === 'running') extra = 500;
  else if (distance >= 30 || duration >= 8) extra = 5000 + (distance / 10) * 1000;
  else if (distance >= 15 || duration >= 5) extra = 2000;

  return (knownWeight + extra) / 1000;
}

function computeFitnessAssessment(profile, activities, gear) {
  const weightKg = Number(profile.weight_kg);
  if (!weightKg || !activities || activities.length === 0) return null;

  const gearMap = {};
  for (const g of gear) gearMap[g.slug] = g;

  const sorted = activities.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const recent = sorted.slice(-10);

  const packWeights = [];
  for (const a of recent) {
    const pw = estimatePackWeight(a, gearMap);
    if (pw > 0) packWeights.push(pw);
  }
  const avgPackWeight = packWeights.length ? packWeights.reduce((s, v) => s + v, 0) / packWeights.length : 0;

  const avgDistance = recent.reduce((s, a) => s + (Number(a.distance_km) || 0), 0) / recent.length;
  const avgElevation = recent.reduce((s, a) => s + (Number(a.elevation_gain_m) || 0), 0) / recent.length;

  const weightFactor = 70 / weightKg;
  const packRatio = avgPackWeight / weightKg;
  const packFactor = 1 - packRatio * 0.5;
  const distanceFactor = Math.min(avgDistance / 20, 1);
  const elevationFactor = Math.min(avgElevation / 1500, 1);

  const score = Math.min(100, Math.max(0,
    weightFactor * 20 + packFactor * 20 + distanceFactor * 30 + elevationFactor * 30
  ));

  let level, levelDesc;
  if (score >= 80) { level = '高级'; levelDesc = '可以应对高难度长距离路线，负重能力强'; }
  else if (score >= 60) { level = '中级'; levelDesc = '可以应对中等难度路线，建议控制负重和距离'; }
  else if (score >= 40) { level = '初级进阶'; levelDesc = '适合入门级路线，建议逐步增加距离和负重'; }
  else { level = '初级'; levelDesc = '建议从短距离、低负重路线开始'; }

  const advice = [];
  if (score < 60) {
    advice.push('建议增加有氧训练，提升基础体能');
    advice.push('逐步增加徒步距离，每次增加不超过 20%');
    advice.push('控制负重，建议不超过体重的 15%');
  } else if (score < 80) {
    advice.push('体能良好，可以尝试更具挑战性的路线');
    advice.push('注意力量训练，特别是下肢和核心');
    advice.push('可以尝试增加负重训练');
  } else {
    advice.push('体能优秀，可以应对大多数户外路线');
    advice.push('保持现有训练节奏，注意恢复和防伤');
    advice.push('可以尝试技术性路线和高海拔路线');
  }

  return {
    score,
    level,
    levelDesc,
    avgPackWeight,
    avgDistance,
    avgElevation,
    factors: {
      weight: Math.min(20, Math.max(0, weightFactor * 20)),
      pack: Math.min(20, Math.max(0, packFactor * 20)),
      distance: Math.min(30, Math.max(0, distanceFactor * 30)),
      elevation: Math.min(30, Math.max(0, elevationFactor * 30)),
    },
    advice,
  };
}

// ---------- 训练指标 ----------

function calculateTss(activity, profile) {
  const maxHr = Number(profile.usual_heart_rate_max) || 185;
  const restingHr = Number(profile.resting_heart_rate) || 60;
  const hrReserve = Math.max(1, maxHr - restingHr);

  const avgHr = Number(activity.avg_hr);
  const durationHours = Number(activity.duration_hours);
  if (avgHr && durationHours) {
    const typeFactor = { running: 1.0, trail_running: 1.1, hiking: 0.8, climbing: 1.2, walking: 0.6 }[activity.type] || 0.8;
    const ratio = Math.max(0.1, Math.min(1.0, (avgHr - restingHr) / hrReserve));
    return durationHours * 60 * ratio * typeFactor;
  }

  const distance = Number(activity.distance_km) || 0;
  const elevation = Number(activity.elevation_gain_m) || 0;
  const duration = Number(activity.duration_hours) || 0;
  const type = activity.type || 'hiking';
  let base = 0;
  if (type === 'running' || type === 'trail_running') base = distance * 8;
  else if (type === 'hiking') base = distance * 5 + elevation * 0.1;
  else if (type === 'climbing') base = duration * 15;
  else base = distance * 5;
  const feltMult = { easy: 0.7, moderate: 1.0, hard: 1.3, extreme: 1.6 }[activity.felt] || 1.0;
  return base * feltMult;
}

function computeTrainingMetrics(activities, profile) {
  if (!activities || activities.length === 0) return null;

  const dailyTss = {};
  const activityDetails = [];
  for (const a of activities) {
    const date = String(a.date);
    if (!date) continue;
    const tss = Math.round(calculateTss(a, profile));
    dailyTss[date] = (dailyTss[date] || 0) + tss;
    activityDetails.push({
      date,
      route: a.route || '',
      type: a.type || 'hiking',
      distance_km: a.distance_km,
      duration_hours: a.duration_hours,
      avg_hr: a.avg_hr,
      tss,
      felt: a.felt || 'moderate',
    });
  }

  const dates = Object.keys(dailyTss).sort();
  if (dates.length === 0) return null;

  const start = new Date(dates[0]);
  const end = new Date(dates[dates.length - 1]);
  const series = [];
  let ctl = 0, atl = 0;
  const ctlDecay = 1 - 1 / 42;
  const atlDecay = 1 - 1 / 7;
  const ctlGain = 1 / 42;
  const atlGain = 1 / 7;

  const weeklySummary = {};
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    const tss = dailyTss[ds] || 0;
    ctl = ctl * ctlDecay + tss * ctlGain;
    atl = atl * atlDecay + tss * atlGain;
    const tsb = ctl - atl;
    series.push({ date: ds, ctl, atl, tsb });

    const monday = new Date(d);
    monday.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1));
    const weekKey = monday.toISOString().slice(0, 10);
    if (!weeklySummary[weekKey]) {
      weeklySummary[weekKey] = { tssTotal: 0, activityCount: 0, ctlSum: 0, atlSum: 0, tsbSum: 0, dayCount: 0 };
    }
    weeklySummary[weekKey].tssTotal += tss;
    weeklySummary[weekKey].activityCount += tss > 0 ? 1 : 0;
    weeklySummary[weekKey].ctlSum += ctl;
    weeklySummary[weekKey].atlSum += atl;
    weeklySummary[weekKey].tsbSum += tsb;
    weeklySummary[weekKey].dayCount += 1;
  }

  for (const key of Object.keys(weeklySummary)) {
    const w = weeklySummary[key];
    w.ctlAvg = w.dayCount ? w.ctlSum / w.dayCount : 0;
    w.atlAvg = w.dayCount ? w.atlSum / w.dayCount : 0;
    w.tsbAvg = w.dayCount ? w.tsbSum / w.dayCount : 0;
  }

  const latest = series[series.length - 1];
  const tsb = latest.tsb;
  let status = {};
  if (tsb > 25) {
    status = { emoji: '🟢', text: '状态极佳', advice: '体能储备充足，适合挑战高强度路线或测试个人最佳。' };
  } else if (tsb >= -10) {
    status = { emoji: '🟡', text: '正常训练', advice: '处于正常训练区间，可按计划推进。' };
  } else if (tsb >= -30) {
    status = { emoji: '🟠', text: '疲劳积累', advice: '疲劳积累明显，建议降低强度并增加恢复时间。' };
  } else {
    status = { emoji: '🔴', text: '过度训练风险', advice: 'ATL 远高于 CTL，必须安排恢复周，避免伤病。' };
  }

  const weekKeys = Object.keys(weeklySummary).sort();
  let ctlTrend = '数据不足';
  if (weekKeys.length >= 4) {
    const recent = weekKeys.slice(-2).map((k) => weeklySummary[k].ctlAvg);
    const previous = weekKeys.slice(-4, -2).map((k) => weeklySummary[k].ctlAvg);
    const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
    const previousAvg = previous.reduce((s, v) => s + v, 0) / previous.length;
    if (previousAvg > 0) {
      if (recentAvg > previousAvg * 1.05) ctlTrend = '上升';
      else if (recentAvg < previousAvg * 0.95) ctlTrend = '下降';
      else ctlTrend = '平稳';
    }
  }

  return { series, latest, status, ctlTrend, weeklySummary, activityDetails };
}

// ---------- 训练负荷（ACWR + 疲劳 + 周历史） ----------

function renderTrainingLoad(activities, bodyLogs, today) {
  const section = el('div', { class: 'report-card' });
  section.appendChild(el('h3', {}, '训练负荷'));

  const weeklyLoad = computeWeeklyLoad(activities, 8);
  const acwr = computeACWR(weeklyLoad);
  const fatigue = computeFatigueScore(bodyLogs);

  const grid = el('div', { class: 'reports-grid three' });

  // ACWR 卡片
  const acwrCard = el('div', { class: `stat-card acwr-card acwr-risk-${acwr.risk}` });
  acwrCard.appendChild(el('div', { class: 'label' }, 'ACWR 负荷比'));
  acwrCard.appendChild(el('div', { class: 'value' }, acwr.ratio > 0 ? acwr.ratio.toFixed(2) : '—'));
  acwrCard.appendChild(el('div', { class: 'unit' }, acwr.status));
  if (acwr.ratio > 0) {
    acwrCard.appendChild(el('div', { class: 'report-hint' }, `本周 ${num(acwr.acute, 1)} km / 前 4 周平均 ${num(acwr.chronic, 1)} km`));
  }
  grid.appendChild(acwrCard);

  // 疲劳卡片
  const fatigueCard = el('div', { class: `stat-card fatigue-card fatigue-score-${fatigue.levelKey || 'unknown'}` });
  fatigueCard.appendChild(el('div', { class: 'label' }, '疲劳评分'));
  fatigueCard.appendChild(el('div', { class: 'value' }, fatigue.score > 0 ? Math.round(fatigue.score) : '—'));
  fatigueCard.appendChild(el('div', { class: 'unit' }, fatigue.status || '无数据'));
  if (fatigue.score > 0) {
    fatigueCard.appendChild(
      el('div', { class: 'report-hint' },
        `疲劳 ${fatigue.avgFatigue != null ? fatigue.avgFatigue.toFixed(1) : '—'} / 酸痛 ${fatigue.avgSoreness != null ? fatigue.avgSoreness.toFixed(1) : '—'} / 睡眠 ${fatigue.avgSleep != null ? fatigue.avgSleep.toFixed(1) : '—'}h`
      )
    );
  }
  grid.appendChild(fatigueCard);

  // 本周对比上周
  const weekKeys = Object.keys(weeklyLoad).sort();
  const thisWeek = weeklyLoad[weekKeys[weekKeys.length - 1]] || { distance: 0, elevation: 0, count: 0 };
  const lastWeek = weeklyLoad[weekKeys[weekKeys.length - 2]] || { distance: 0, elevation: 0, count: 0 };
  const weekCard = el('div', { class: 'stat-card' });
  weekCard.appendChild(el('div', { class: 'label' }, '本周跑量'));
  weekCard.appendChild(el('div', { class: 'value' }, num(thisWeek.distance, 1)));
  weekCard.appendChild(el('div', { class: 'unit' }, 'km'));
  if (lastWeek.distance > 0) {
    const diff = thisWeek.distance - lastWeek.distance;
    const pct = Math.abs((diff / lastWeek.distance) * 100).toFixed(0);
    const cls = diff > 0 ? 'change-up' : diff < 0 ? 'change-down' : 'change-same';
    const txt = diff > 0 ? `⬆️ ${pct}%` : diff < 0 ? `⬇️ ${pct}%` : '➡️ 持平';
    weekCard.appendChild(el('div', { class: 'change ' + cls }, txt));
  }
  grid.appendChild(weekCard);

  section.appendChild(grid);

  // 8 周距离历史柱状图
  if (weekKeys.length >= 2) {
    const bars = weekKeys.map((k) => ({
      label: k.slice(5),
      value: weeklyLoad[k].distance || 0,
    }));
    section.appendChild(barChartCard('近 8 周距离', bars, { color: '#22c55e' }));
  } else {
    section.appendChild(el('div', { class: 'empty' }, '需要至少 2 周活动记录以展示周历史'));
  }

  return section;
}

function computeWeeklyLoad(activities, weeks = 8) {
  const weekly = {};
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - weeks * 7);

  for (const a of activities) {
    const date = String(a.date);
    if (!date || date < start.toISOString().slice(0, 10)) continue;
    const d = new Date(date + 'T00:00:00');
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const key = monday.toISOString().slice(0, 10);
    if (!weekly[key]) weekly[key] = { distance: 0, elevation: 0, duration: 0, count: 0 };
    weekly[key].distance += Number(a.distance_km) || 0;
    weekly[key].elevation += Number(a.elevation_gain_m) || 0;
    weekly[key].duration += Number(a.duration_hours) || 0;
    weekly[key].count += 1;
  }
  return weekly;
}

function computeACWR(weeklyLoad) {
  const keys = Object.keys(weeklyLoad).sort();
  if (keys.length < 2) return { ratio: 0, status: '数据不足', risk: 'unknown', acute: 0, chronic: 0 };

  const acute = weeklyLoad[keys[keys.length - 1]].distance;
  const chronicKeys = keys.slice(-5, -1);
  const chronic = chronicKeys.length
    ? chronicKeys.reduce((s, k) => s + weeklyLoad[k].distance, 0) / chronicKeys.length
    : 0;

  if (!chronic) return { ratio: 0, status: '数据不足', risk: 'unknown', acute, chronic: 0 };

  const ratio = acute / chronic;
  let status, risk;
  if (ratio < 0.8) { status = '训练不足'; risk = 'low'; }
  else if (ratio <= 1.3) { status = '最佳训练区'; risk = 'optimal'; }
  else if (ratio <= 1.5) { status = '警告区（伤病风险增加）'; risk = 'warning'; }
  else { status = '危险区（高伤病风险）'; risk = 'danger'; }

  return { ratio, status, risk, acute, chronic };
}

function computeFatigueScore(bodyLogs) {
  if (!bodyLogs || bodyLogs.length === 0) {
    return { score: 0, status: '无数据', levelKey: 'unknown', avgFatigue: null, avgSoreness: null, avgSleep: null };
  }

  const sorted = bodyLogs
    .filter((b) => b.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 7);

  if (!sorted.length) {
    return { score: 0, status: '无数据', levelKey: 'unknown', avgFatigue: null, avgSoreness: null, avgSleep: null };
  }

  const fatigues = sorted.map((b) => Number(b.fatigue)).filter((v) => !isNaN(v));
  const soreness = sorted.map((b) => Number(b.muscle_soreness)).filter((v) => !isNaN(v));
  const sleeps = sorted.map((b) => Number(b.sleep_hours)).filter((v) => !isNaN(v));

  const avgFatigue = fatigues.length ? fatigues.reduce((s, v) => s + v, 0) / fatigues.length : 0;
  const avgSoreness = soreness.length ? soreness.reduce((s, v) => s + v, 0) / soreness.length : 0;
  const avgSleep = sleeps.length ? sleeps.reduce((s, v) => s + v, 0) / sleeps.length : 7;

  let score = 0;
  if (avgFatigue) score += Math.min(avgFatigue * 8, 60);
  if (avgSoreness) score += Math.min(avgSoreness * 4, 30);
  if (avgSleep < 6) score += Math.min((6 - avgSleep) * 5, 10);
  score = Math.min(100, score);

  let status, levelKey;
  if (score < 30) { status = '状态良好'; levelKey = 'good'; }
  else if (score < 50) { status = '轻度疲劳'; levelKey = 'mild'; }
  else if (score < 70) { status = '中度疲劳'; levelKey = 'moderate'; }
  else { status = '高度疲劳'; levelKey = 'high'; }

  return { score, status, levelKey, avgFatigue, avgSoreness, avgSleep };
}

// ---------- Segment PB ----------

function matchSegmentActivity(segment, activity) {
  if (!activity || !activity.duration_hours) return false;

  const route = String(activity.route || '').toLowerCase();
  const segName = String(segment.name || segment.slug || '').toLowerCase();
  const routePattern = String(segment.route_pattern || segment.route || segment.route_name || '').toLowerCase();

  const matchName = segName && route.includes(segName);
  const matchPattern = routePattern && route.includes(routePattern);
  if (!matchName && !matchPattern) return false;

  const typeFilter = segment.type_filter;
  if (typeFilter && activity.type !== typeFilter) return false;

  const distance = Number(activity.distance_km) || 0;
  const minDistance = Number(segment.min_distance_km);
  const maxDistance = Number(segment.max_distance_km);
  if (!isNaN(minDistance) && distance < minDistance) return false;
  if (!isNaN(maxDistance) && distance > maxDistance) return false;

  const elevation = Number(activity.elevation_gain_m) || 0;
  const minElevation = Number(segment.min_elevation_m);
  if (!isNaN(minElevation) && elevation < minElevation) return false;

  return true;
}

function computeSegmentPBs(segments, activities) {
  if (!segments || !segments.length || !activities || !activities.length) return [];
  const results = [];
  for (const seg of segments) {
    const segName = seg.name || seg.slug;
    const records = [];
    for (const a of activities) {
      if (!matchSegmentActivity(seg, a)) continue;
      const distance = Number(a.distance_km) || 0;
      const duration = Number(a.duration_hours) || 0;
      records.push({
        date: a.date,
        route: a.route,
        distance_km: distance,
        duration_hours: duration,
        pace_min_per_km: distance && duration ? (duration * 60) / distance : 0,
        avg_hr: a.avg_hr,
        felt: a.felt,
        is_pb: false,
      });
    }
    if (!records.length) continue;

    records.sort((a, b) => a.duration_hours - b.duration_hours);
    const bestDuration = records[0].duration_hours;
    for (const r of records) {
      r.is_pb = r.duration_hours === bestDuration && r.duration_hours > 0;
    }
    records.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const best = records.find((r) => r.is_pb) || records[0];

    let trend = '—';
    let trendKey = 'same';
    if (records.length >= 2) {
      const recent = records.slice(-3);
      const older = records.slice(-6, -3);
      if (older.length) {
        const recentAvg = recent.reduce((s, r) => s + r.duration_hours, 0) / recent.length;
        const olderAvg = older.reduce((s, r) => s + r.duration_hours, 0) / older.length;
        const diff = olderAvg - recentAvg;
        const pct = olderAvg ? (Math.abs(diff) / olderAvg) * 100 : 0;
        if (diff > 0) { trend = `📈 进步中 ${pct.toFixed(0)}%`; trendKey = 'up'; }
        else if (diff < 0) { trend = `📉 有所退步 ${pct.toFixed(0)}%`; trendKey = 'down'; }
      } else {
        const prev = records[records.length - 2];
        const last = records[records.length - 1];
        const diff = prev.duration_hours - last.duration_hours;
        const pct = prev.duration_hours ? (Math.abs(diff) / prev.duration_hours) * 100 : 0;
        if (diff > 0) { trend = `📈 进步 ${pct.toFixed(0)}%`; trendKey = 'up'; }
        else if (diff < 0) { trend = `📉 退步 ${pct.toFixed(0)}%`; trendKey = 'down'; }
      }
    }

    results.push({
      segmentName: segName || '未命名',
      route: best.route,
      best: best.duration_hours,
      distance_km: best.distance_km,
      date: best.date,
      trend,
      trendKey,
      records,
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
