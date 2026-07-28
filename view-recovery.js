/* 恢复视图 */
'use strict';

function renderRecovery() {
  const view = viewEl('recovery');
  clearViewKeepSkeleton(view);

  const header = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, '恢复'),
    el('span', { class: 'text-dim' }, '基于最近一次高强度活动')
  );
  view.appendChild(header);

  const activities = state.data.activities || [];
  const bodyLogs = state.data.body_logs || [];

  // 就绪度评分卡（v1.23.0）：不依赖恢复计划，只要有活动或身体日志就展示
  const readiness = computeDailyReadiness(activities, bodyLogs, state.data.profile);
  if (readiness) view.appendChild(renderReadinessDetailCard(readiness));

  const plan = computeRecoveryPlan(activities, bodyLogs);

  if (!plan) {
    view.appendChild(el('div', { class: 'empty' }, '需要至少一条活动记录'));
    return;
  }

  // 顶部状态卡片
  const statusGrid = el('div', { class: 'reports-grid three' });

  const statusClass = plan.remaining === 0 ? 'stat-ok' : plan.remaining <= 2 ? 'stat-warn' : 'stat-info';
  const statusCard = reportStatCard('恢复状态', plan.remaining === 0 ? '已完成' : `剩余 ${plan.remaining} 天`, plan.remaining === 0 ? '可恢复正常训练' : `共 ${plan.totalDays} 天`, statusClass);
  statusGrid.appendChild(statusCard);

  statusGrid.appendChild(reportStatCard('活动强度', `${plan.intensity.score}`, plan.intensity.level, plan.intensity.score >= 80 ? 'stat-critical' : plan.intensity.score >= 60 ? 'stat-warn' : 'stat-ok'));
  statusGrid.appendChild(reportStatCard('活动日期', fmtDate(plan.activityDate), plan.activity.route || '', 'stat-flat'));

  view.appendChild(statusGrid);

  // 进度条
  const progressCard = el('div', { class: 'report-card' });
  progressCard.appendChild(el('h3', {}, '恢复进度'));
  const progressWrap = el('div', { class: 'progress-wrap' });
  const progressBar = el('div', { class: 'progress-bar' },
    el('div', { class: 'progress-fill', style: `width:${plan.progress}%` })
  );
  progressWrap.appendChild(progressBar);
  progressWrap.appendChild(
    el('div', { class: 'progress-labels' },
      el('span', {}, `${Math.round(plan.progress)}%`),
      el('span', {}, `预计 ${fmtDate(plan.endDate)} 恢复`)
    )
  );
  progressCard.appendChild(progressWrap);
  view.appendChild(progressCard);

  // 今日建议
  if (plan.todayPlan) {
    const todayCard = el('div', { class: 'report-card recovery-today-card' });
    todayCard.appendChild(el('h3', {}, `Day ${plan.todayPlan.day} · ${plan.todayPlan.phase}`));
    todayCard.appendChild(el('div', { class: 'phase-desc' }, plan.todayPlan.phaseDesc));

    const grid = el('div', { class: 'recovery-grid' });

    const actCard = el('div', { class: 'recovery-subcard' });
    actCard.appendChild(el('h4', {}, '今日活动'));
    actCard.appendChild(el('ul', {}, ...plan.todayPlan.activities.map((t) => el('li', {}, t))));
    grid.appendChild(actCard);

    const stretchCard = el('div', { class: 'recovery-subcard' });
    stretchCard.appendChild(el('h4', {}, '拉伸/放松'));
    stretchCard.appendChild(el('ul', {}, ...plan.todayPlan.stretches.map((t) => el('li', {}, t))));
    grid.appendChild(stretchCard);

    const noteCard = el('div', { class: 'recovery-subcard' });
    noteCard.appendChild(el('h4', {}, '注意事项'));
    noteCard.appendChild(el('ul', {}, ...plan.todayPlan.notes.map((t) => el('li', {}, t))));
    grid.appendChild(noteCard);

    todayCard.appendChild(grid);
    view.appendChild(todayCard);
  }

  // 恢复日历
  const calendarCard = el('div', { class: 'report-card' });
  calendarCard.appendChild(el('h3', {}, '恢复日历'));

  const daysWrap = el('div', { class: 'recovery-days' });
  for (const d of plan.daysPlan) {
    const baseDate = safeParseDate(plan.activityDate);
    if (!baseDate) continue;
    const dayDate = new Date(baseDate);
    dayDate.setDate(dayDate.getDate() + d.day);
    const dateStr = dayDate.toISOString().slice(0, 10);
    const isToday = dateStr === new Date().toISOString().slice(0, 10);
    const isPast = dateStr < new Date().toISOString().slice(0, 10);

    const dayEl = el('div', { class: 'recovery-day' + (isToday ? ' today' : '') + (isPast ? ' past' : '') });
    dayEl.appendChild(el('div', { class: 'recovery-day-header' },
      el('span', { class: 'recovery-day-num' }, `Day ${d.day}`),
      el('span', { class: 'recovery-day-date' }, fmtDate(dateStr))
    ));
    dayEl.appendChild(el('div', { class: 'recovery-day-phase' }, d.phase));
    dayEl.appendChild(el('div', { class: 'recovery-day-acts' }, d.activities.join('；')));
    daysWrap.appendChild(dayEl);
  }
  calendarCard.appendChild(daysWrap);
  view.appendChild(calendarCard);

  // 活动摘要
  const activityCard = el('div', { class: 'report-card' });
  activityCard.appendChild(el('h3', {}, '触发活动'));
  const activityGrid = el('div', { class: 'reports-grid four' });
  activityGrid.appendChild(reportStatCard('距离', plan.intensity.distance.toFixed(1), 'km'));
  activityGrid.appendChild(reportStatCard('爬升', plan.intensity.elevation.toFixed(0), 'm'));
  activityGrid.appendChild(reportStatCard('时长', plan.intensity.duration.toFixed(1), 'h'));
  activityGrid.appendChild(reportStatCard('感受', plan.intensity.felt || '—', ''));
  activityCard.appendChild(activityGrid);

  if (plan.intensity.issues && plan.intensity.issues.length) {
    activityCard.appendChild(
      el('div', { class: 'recovery-issues' },
        el('strong', {}, '活动伤病/问题：'),
        plan.intensity.issues.map((i) => translateIssue(i)).join('、')
      )
    );
  }
  view.appendChild(activityCard);
}

/** 就绪度详情卡：分数 + 档位 + ACWR + 建议 + 扣分因素明细（v1.23.0） */
function renderReadinessDetailCard(r) {
  const cls = readinessLevelClass(r.levelKey);
  const card = el('div', { class: 'report-card' });
  card.appendChild(el('h3', {}, '今日就绪度'));

  const grid = el('div', { class: 'reports-grid three' });
  grid.appendChild(reportStatCard('就绪度', r.score, '/ 100', cls));
  grid.appendChild(reportStatCard('今日建议', r.label,
    r.levelKey === 'rest' ? '以恢复为主' : r.levelKey === 'easy' ? '只做低强度' : r.levelKey === 'push' ? '窗口期' : '按计划', cls));
  grid.appendChild(reportStatCard('ACWR', r.acwr.ratio ? r.acwr.ratio.toFixed(2) : '—', r.acwr.status,
    r.acwr.risk === 'danger' ? 'stat-critical' : r.acwr.risk === 'warning' ? 'stat-warn' : 'stat-ok'));
  card.appendChild(grid);

  card.appendChild(el('div', { class: 'phase-desc' }, r.advice));

  if (r.factorDetails.length) {
    card.appendChild(el('div', { class: 'readiness-factors-title' }, '评分依据'));
    card.appendChild(el('ul', { class: 'readiness-factors' },
      ...r.factorDetails.map((f) => el('li', {},
        el('span', { class: 'readiness-factor-name' }, `${f.factor} `),
        el('span', { class: 'readiness-factor-penalty' }, `−${f.penalty}`),
        ` ${f.detail}`))));
  } else {
    card.appendChild(el('div', { class: 'text-dim' }, '无扣分因素，各项状态良好'));
  }

  if (r.rhr && !r.rhr.sufficient) {
    card.appendChild(el('div', { class: 'text-dim', style: 'margin-top:6px;' },
      `💡 静息心率数据 ${r.rhr ? r.rhr.count : 0}/5 天——在身体日志记录 5 天以上晨起静息心率后，自动加入评估`));
  }
  return card;
}

/** 把 issue key 翻译成中文（与 view-activities.js 对齐） */
function translateIssue(key) {
  const map = {
    it_band_left: '左髂胫束',
    it_band_right: '右髂胫束',
    knee_left: '左膝',
    knee_right: '右膝',
    blisters_left_foot: '左脚水泡',
    blisters_right_foot: '右脚水泡',
    ankle_left: '左脚踝',
    ankle_right: '右脚踝',
    mild_hypoglycemia_west_end: '西线末端轻度低血糖',
    left_foot_cramp: '左脚抽筋',
    insufficient_salt_carbs: '盐/碳水不足',
  };
  return map[key] || key;
}
