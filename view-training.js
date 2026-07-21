/* 训练负荷独立视图 */
'use strict';

function renderTraining() {
  const view = viewEl('training');
  clearViewKeepSkeleton(view);

  const header = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, '训练负荷'),
    el('span', { class: 'text-dim' }, '基于活动与身体记录客户端实时计算')
  );
  view.appendChild(header);

  const activities = state.data.activities || [];
  const bodyLogs = state.data.body_logs || [];
  const today = new Date().toISOString().slice(0, 10);

  if (!activities.length && !bodyLogs.length) {
    view.appendChild(el('div', { class: 'empty' }, '需要至少一条活动或身体记录'));
    return;
  }

  // 周负荷桶（默认 12 周，展示取最近 8 周）
  const weeklyLoad = computeWeeklyLoad(activities, 12);
  const weeklyKeys = Object.keys(weeklyLoad).sort();
  const displayKeys = weeklyKeys.slice(-8);

  // ACWR
  const acwr = computeACWR(weeklyLoad);

  // 疲劳评分
  const fatigue = computeFatigueScore(bodyLogs);

  // 本周 / 上周
  const currentWeekKey = displayKeys[displayKeys.length - 1] || today;
  const currentWeek = weeklyLoad[currentWeekKey] || { distance: 0, elevation: 0, duration: 0, count: 0 };
  const prevWeekKey = displayKeys[displayKeys.length - 2];
  const prevWeek = prevWeekKey ? weeklyLoad[prevWeekKey] : { distance: 0 };
  const weekChange = prevWeek.distance ? ((currentWeek.distance - prevWeek.distance) / prevWeek.distance) : 0;
  const weekChangeText = !prevWeekKey ? '无上周数据' : `${weekChange >= 0 ? '↑' : '↓'} ${Math.abs(weekChange * 100).toFixed(0)}%`;
  const weekChangeClass = weekChange > 0.3 ? 'change-up' : weekChange < -0.3 ? 'change-down' : 'change-flat';

  // 本月统计
  const month = computeMonthSummary(activities, today);

  // 本月目标完成率
  const todayDate = new Date();
  const monthlyDistanceGoal = (state.data.goals || []).find((g) =>
    g.goal_type === 'monthly_distance' &&
    String(g.period_key) === `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-01`
  );
  const goalTarget = monthlyDistanceGoal ? Number(monthlyDistanceGoal.target_value) : 0;
  const goalRate = goalTarget > 0 ? Math.min(1, month.distance / goalTarget) : null;

  // ---------- KPI 行 ----------
  const kpiGrid = el('div', { class: 'reports-grid three' });

  const acwrCard = reportStatCard('ACWR', acwr.ratio ? acwr.ratio.toFixed(2) : '—', acwr.status || '数据不足', `acwr-risk-${acwr.risk || 'unknown'}`);
  kpiGrid.appendChild(acwrCard);

  const fatigueCard = reportStatCard('疲劳评分', fatigue.score != null ? Math.round(fatigue.score).toString() : '—', fatigue.status || '无数据', `fatigue-score-${fatigue.levelKey || 'unknown'}`);
  kpiGrid.appendChild(fatigueCard);

  const weekCard = reportStatCard('本周距离', currentWeek.distance.toFixed(1), 'km');
  if (prevWeekKey) {
    weekCard.appendChild(el('div', { class: `change ${weekChangeClass}` }, weekChangeText));
  }
  kpiGrid.appendChild(weekCard);

  const monthCard = reportStatCard('本月距离', month.distance.toFixed(1), 'km', 'month-distance');
  monthCard.appendChild(el('div', { class: 'change change-flat' }, `爬升 ${month.elevation.toFixed(0)} m`));
  kpiGrid.appendChild(monthCard);

  if (goalRate != null) {
    const goalCard = reportStatCard('月目标完成率', `${(goalRate * 100).toFixed(0)}%`, `目标 ${goalTarget.toFixed(0)} km`);
    const goalBar = el('div', { class: 'goal-progress-bar', style: 'margin-top:8px;height:6px;' },
      el('div', { class: 'goal-progress-fill', style: `width:${Math.round(goalRate * 100)}%` })
    );
    goalCard.appendChild(goalBar);
    kpiGrid.appendChild(goalCard);
  }

  view.appendChild(kpiGrid);

  // ---------- 图表行 ----------
  const chartGrid = el('div', { class: 'reports-grid two' });

  const distanceBars = displayKeys.map((k) => ({ label: formatWeekLabel(k), value: weeklyLoad[k].distance }));
  chartGrid.appendChild(barChartCard('近 8 周距离', distanceBars, { color: '#22c55e' }));

  const elevationBars = displayKeys.map((k) => ({ label: formatWeekLabel(k), value: weeklyLoad[k].elevation }));
  chartGrid.appendChild(barChartCard('近 8 周爬升', elevationBars, { color: '#f59e0b' }));

  view.appendChild(chartGrid);

  // ---------- 趋势行 ----------
  const trendGrid = el('div', { class: 'reports-grid two' });
  const trend = computeFatigueTrend(bodyLogs, 30);

  trendGrid.appendChild(lineChartCard('疲劳度趋势（30 天）', trend, 'fatigue', '#3b82f6', 0, 10));
  trendGrid.appendChild(lineChartCard('肌肉酸痛趋势（30 天）', trend, 'soreness', '#ef4444', 0, 10));

  view.appendChild(trendGrid);

  // ---------- 周汇总表 ----------
  const tableSection = el('div', { class: 'report-card' });
  tableSection.appendChild(el('h3', {}, '周负荷汇总'));

  if (displayKeys.length) {
    const tableWrap = el('div', { class: 'table-wrap' });
    const table = el('table', {});
    table.innerHTML = '<thead><tr><th>周范围</th><th>距离</th><th>爬升</th><th>次数</th><th>时长</th></tr></thead>';
    const tbody = el('tbody');
    for (const k of displayKeys.slice().reverse()) {
      const w = weeklyLoad[k];
      const tr = el('tr');
      tr.appendChild(el('td', {}, formatWeekLabel(k)));
      tr.appendChild(el('td', {}, `${w.distance.toFixed(1)} km`));
      tr.appendChild(el('td', {}, `${w.elevation.toFixed(0)} m`));
      tr.appendChild(el('td', {}, String(w.count)));
      tr.appendChild(el('td', {}, `${w.duration.toFixed(1)} h`));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    labelTableCells(table, ['周范围', '距离', '爬升', '次数', '时长']);
    tableWrap.appendChild(table);
    tableSection.appendChild(tableWrap);
  } else {
    tableSection.appendChild(el('div', { class: 'empty' }, '需要至少 1 周活动记录'));
  }

  view.appendChild(tableSection);

  // 提示卡片
  const hint = acwr.risk === 'danger'
    ? '⚠️ 近期负荷突增，建议主动减量或安排恢复日。'
    : fatigue.levelKey === 'high' || fatigue.levelKey === 'moderate'
    ? '最近身体反馈偏疲劳，优先保证睡眠与低强度恢复。'
    : acwr.risk === 'optimal'
    ? '训练节奏良好，可维持当前负荷或渐进加量。'
    : null;

  if (hint) {
    const adviceCard = el('div', { class: 'report-card' }, el('div', { class: 'report-hint' }, hint));
    view.appendChild(adviceCard);
  }
}
