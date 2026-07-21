/* 训练目标与周期化规划视图 */
'use strict';

const GOAL_TYPES = [
  { key: 'weekly_distance', label: '周跑量', unit: 'km' },
  { key: 'weekly_elevation', label: '周爬升', unit: 'm' },
  { key: 'weekly_count', label: '周次数', unit: '次' },
  { key: 'monthly_distance', label: '月跑量', unit: 'km' },
  { key: 'monthly_elevation', label: '月爬升', unit: 'm' },
  { key: 'monthly_count', label: '月次数', unit: '次' },
];

function goalTypeLabel(key) {
  return GOAL_TYPES.find((g) => g.key === key)?.label || key;
}

function goalUnit(key) {
  return GOAL_TYPES.find((g) => g.key === key)?.unit || '';
}

function isWeeklyGoal(key) {
  return key.startsWith('weekly_');
}

function getCurrentPeriodKey(goalType) {
  const today = new Date();
  if (isWeeklyGoal(goalType)) {
    const day = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
    return formatLocalDate(monday);
  }
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
}

function getPeriodRangeForGoal(periodKey, goalType) {
  const start = periodKey;
  let end;
  if (isWeeklyGoal(goalType)) {
    const d = new Date(periodKey + 'T00:00:00');
    d.setDate(d.getDate() + 6);
    end = formatLocalDate(d);
  } else {
    const d = new Date(periodKey + 'T00:00:00');
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    end = formatLocalDate(d);
  }
  return { start, end };
}

function computeGoalProgress(goal, activities) {
  const range = getPeriodRangeForGoal(goal.period_key, goal.goal_type);
  const list = (activities || []).filter((a) => a.date && String(a.date) >= range.start && String(a.date) <= range.end);
  const key = goal.goal_type;
  let current = 0;
  if (key.includes('distance')) {
    current = list.reduce((s, a) => s + (Number(a.distance_km) || 0), 0);
  } else if (key.includes('elevation')) {
    current = list.reduce((s, a) => s + (Number(a.elevation_gain_m) || 0), 0);
  } else if (key.includes('count')) {
    current = list.length;
  }
  const target = Number(goal.target_value) || 0;
  const rate = target > 0 ? Math.min(1, current / target) : 0;
  return { current, target, rate, remaining: Math.max(0, target - current), range };
}

function getCurrentPhase(periodKey, goalType) {
  // 简化周期模型：以 4 周为一个微周期，按当前日期相对周期起点分阶段
  const start = new Date(periodKey + 'T00:00:00');
  const now = new Date();
  const days = Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24)));
  const cycleDays = isWeeklyGoal(goalType) ? 7 : 28;
  const dayInCycle = days % cycleDays;
  if (isWeeklyGoal(goalType)) {
    if (dayInCycle < 2) return { key: 'base', label: '基础/恢复', desc: '周初以低强度有氧或恢复为主' };
    if (dayInCycle < 5) return { key: 'build', label: '强化积累', desc: '周中逐步增加负荷' };
    return { key: 'peak', label: '峰值/巩固', desc: '周末可安排一次长距离或强度课' };
  }
  if (dayInCycle < 7) return { key: 'base', label: '基础期', desc: '建立有氧基础，控制强度' };
  if (dayInCycle < 14) return { key: 'build', label: '强化期', desc: '逐步增加距离/爬升' };
  if (dayInCycle < 21) return { key: 'peak', label: '巅峰期', desc: '达到周期内最大负荷' };
  return { key: 'recovery', label: '恢复期', desc: '主动减量，让身体吸收训练' };
}

function formatGoalAdvice(goals, activities, bodyLogs) {
  const weekly = computeWeeklyLoad(activities, 5);
  const acwr = computeACWR(weekly);
  const fatigue = computeFatigueScore(bodyLogs);
  const lines = [];

  for (const g of goals) {
    const p = computeGoalProgress(g, activities);
    if (p.target <= 0) continue;
    const label = goalTypeLabel(g.goal_type);
    const phase = getCurrentPhase(g.period_key, g.goal_type);
    const remaining = p.remaining;
    const daysLeft = Math.max(1, Math.ceil((new Date(p.range.end + 'T00:00:00') - new Date()) / (1000 * 60 * 60 * 24)));

    if (remaining <= 0) {
      lines.push(`✅ ${label}目标已达成（${p.current.toFixed(1)}${g.unit}）。`);
      continue;
    }

    const perDay = remaining / daysLeft;
    let tip = `${label}还差 ${remaining.toFixed(1)}${g.unit}，剩余 ${daysLeft} 天，平均每天需完成 ${perDay.toFixed(1)}${g.unit}。当前处于${phase.label}。`;

    if (acwr.risk === 'danger') {
      tip += ' 但近期 ACWR 进入危险区，建议优先恢复，目标可顺延。';
    } else if (fatigue.levelKey === 'high' || fatigue.levelKey === 'moderate') {
      tip += ' 身体反馈偏疲劳，可把剩余量拆成多次低强度完成。';
    } else if (acwr.risk === 'warning') {
      tip += ' 负荷进入警告区，注意控制单次增量。';
    } else {
      tip += ' 状态良好，可按计划推进。';
    }
    lines.push(tip);
  }

  return lines;
}

function buildGoalMarkdown(data) {
  const lines = ['---'];
  lines.push(`goal_type: ${data.goal_type || 'monthly_distance'}`);
  lines.push(`period_key: "${data.period_key || ''}"`);
  lines.push(`start_date: "${data.start_date || ''}"`);
  lines.push(`end_date: "${data.end_date || ''}"`);
  lines.push(`target_value: ${data.target_value ?? 0}`);
  lines.push(`current_value: ${data.current_value ?? 0}`);
  lines.push(`unit: "${data.unit || ''}"`);
  if (data.notes) lines.push(`notes: "${data.notes}"`);
  lines.push('---');
  return lines.join('\n');
}

function openAddGoal(goal = null) {
  if (!state.token) { toast('请先连接后再添加目标', 'warn'); return; }

  const typeSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    ...GOAL_TYPES.map((t) => el('option', { value: t.key }, `${t.label} (${t.unit})`))
  );
  if (goal && goal.goal_type) typeSel.value = goal.goal_type;

  const today = new Date();
  const defaultType = goal ? goal.goal_type : 'monthly_distance';
  const defaultPeriod = goal ? goal.period_key : getCurrentPeriodKey(defaultType);
  const periodInput = el('input', { type: 'date', class: 'gear-select', value: defaultPeriod, style: 'width:100%;' });

  const targetInput = el('input', { type: 'number', class: 'gear-select', value: goal ? goal.target_value : '', step: '0.1', placeholder: '目标值', style: 'width:100%;' });
  const notesInput = el('textarea', { class: 'gear-select', rows: 2, placeholder: '备注（可选）', style: 'width:100%;' }, goal && goal.notes ? goal.notes : '');

  typeSel.addEventListener('change', () => {
    periodInput.value = getCurrentPeriodKey(typeSel.value);
  });

  const form = el('div', { class: 'recommend-form' },
    el('div', { class: 'form-row' }, el('label', {}, '目标类型 *'), typeSel),
    el('div', { class: 'form-row' }, el('label', {}, '周期起点 *（周报选周一，月报选每月1日）'), periodInput),
    el('div', { class: 'form-row' }, el('label', {}, `目标值 (${goalUnit(typeSel.value)})`), targetInput),
    el('div', { class: 'form-row' }, el('label', {}, '备注'), notesInput)
  );

  const saveBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, goal ? '保存修改' : '添加目标');
  saveBtn.addEventListener('click', async () => {
    const goal_type = typeSel.value;
    const period_key = periodInput.value;
    if (!period_key) { toast('请填写周期起点', 'warn'); return; }
    const target_value = Number(targetInput.value);
    if (isNaN(target_value) || target_value <= 0) { toast('目标值需大于 0', 'warn'); return; }

    const range = getPeriodRangeForGoal(period_key, goal_type);
    const data = {
      goal_type,
      period_key,
      start_date: range.start,
      end_date: range.end,
      target_value,
      current_value: 0,
      unit: goalUnit(goal_type),
      notes: notesInput.value.trim(),
    };

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      const payload = { data, raw_markdown: buildGoalMarkdown(data) };
      if (goal && goal.id) {
        await fetchUpdateGoal(state.apiUrl, state.token, goal.id, payload);
      } else {
        await fetchSaveGoal(state.apiUrl, state.token, payload);
      }
      toast('目标已保存', 'success');
      close();
      await loadAndRender(true);
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = goal ? '保存修改' : '添加目标';
    }
  });

  const close = showModal(goal ? '编辑目标' : '添加目标', form, [saveBtn, el('button', { class: 'btn' }, '关闭')]);
}

function renderGoalCard(goal, progress, phase) {
  const card = el('div', { class: 'goal-card' });
  const header = el('div', { class: 'goal-card-header' },
    el('span', { class: 'goal-card-title' }, `${goalTypeLabel(goal.goal_type)} · ${progress.range.start} ~ ${progress.range.end}`),
    el('span', { class: `phase-badge phase-${phase.key}` }, phase.label)
  );
  card.appendChild(header);

  const progressWrap = el('div', { class: 'goal-progress-wrap' });
  const bar = el('div', { class: 'goal-progress-bar' },
    el('div', { class: 'goal-progress-fill', style: `width:${Math.round(progress.rate * 100)}%` })
  );
  progressWrap.appendChild(bar);
  progressWrap.appendChild(el('div', { class: 'goal-progress-text' },
    `${progress.current.toFixed(progress.current % 1 === 0 ? 0 : 1)} / ${progress.target.toFixed(progress.target % 1 === 0 ? 0 : 1)} ${goal.unit} · ${(progress.rate * 100).toFixed(0)}%`
  ));
  card.appendChild(progressWrap);

  if (progress.remaining > 0) {
    card.appendChild(el('div', { class: 'goal-remaining' }, `还差 ${progress.remaining.toFixed(1)} ${goal.unit}`));
  } else {
    card.appendChild(el('div', { class: 'goal-remaining goal-achieved' }, '已达成 🎉'));
  }

  const actions = el('div', { class: 'goal-card-actions' },
    el('button', { class: 'btn btn-sm', 'data-action': 'edit' }, '编辑'),
    el('button', { class: 'btn btn-sm btn-danger', 'data-action': 'delete' }, '删除')
  );
  actions.querySelector('[data-action="edit"]').addEventListener('click', () => openAddGoal(goal));
  actions.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm('确定删除这个目标？')) return;
    try {
      const res = await fetchDelete(state.apiUrl, state.token, 'goals', goal.id);
      if (res && res.error && !res.queued) throw new Error(res.error);
      state.data.goals = (state.data.goals || []).filter((g) => String(g.id) !== String(goal.id));
      saveSnapshot();
      renderGoals();
      toast(res.queued ? '已加入离线删除队列' : '目标已删除', 'success');
    } catch (err) {
      toast(err.message || '删除失败', 'error');
    }
  });
  card.appendChild(actions);

  return card;
}

function renderGoals() {
  const view = viewEl('goals');
  clearViewKeepSkeleton(view);

  const header = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, '训练目标'),
    el('button', { class: 'btn-sm btn-primary', 'data-action': 'add-goal' }, '添加目标')
  );
  view.appendChild(header);
  $('.btn-sm[data-action="add-goal"]', header).addEventListener('click', () => openAddGoal());

  const goals = state.data.goals || [];
  const activities = state.data.activities || [];
  const bodyLogs = state.data.body_logs || [];

  if (!goals.length) {
    view.appendChild(el('div', { class: 'empty' }, '还没有训练目标，点击右上角添加'));
    return;
  }

  // 当前周期目标优先
  const now = new Date();
  const sorted = [...goals].sort((a, b) => String(b.period_key).localeCompare(String(a.period_key)));

  const activeSection = el('div', { class: 'report-card' });
  activeSection.appendChild(el('h3', {}, '当前周期目标'));
  const activeGrid = el('div', { class: 'goals-grid' });
  let activeCount = 0;
  for (const g of sorted) {
    const progress = computeGoalProgress(g, activities);
    const isCurrent = now >= new Date(progress.range.start + 'T00:00:00') && now <= new Date(progress.range.end + 'T23:59:59');
    if (!isCurrent) continue;
    const phase = getCurrentPhase(g.period_key, g.goal_type);
    activeGrid.appendChild(renderGoalCard(g, progress, phase));
    activeCount++;
  }
  if (activeCount) {
    activeSection.appendChild(activeGrid);
    view.appendChild(activeSection);
  }

  // 训练建议
  const adviceLines = formatGoalAdvice(sorted, activities, bodyLogs);
  if (adviceLines.length) {
    const adviceCard = el('div', { class: 'report-card' });
    adviceCard.appendChild(el('h3', {}, '周期化建议'));
    for (const line of adviceLines) {
      adviceCard.appendChild(el('div', { class: 'goal-advice-item' }, line));
    }
    view.appendChild(adviceCard);
  }

  // 历史目标
  const historySection = el('div', { class: 'report-card' });
  historySection.appendChild(el('h3', {}, '历史/未来目标'));
  const historyGrid = el('div', { class: 'goals-grid' });
  let historyCount = 0;
  for (const g of sorted) {
    const progress = computeGoalProgress(g, activities);
    const isCurrent = now >= new Date(progress.range.start + 'T00:00:00') && now <= new Date(progress.range.end + 'T23:59:59');
    if (isCurrent) continue;
    const phase = getCurrentPhase(g.period_key, g.goal_type);
    historyGrid.appendChild(renderGoalCard(g, progress, phase));
    historyCount++;
  }
  if (historyCount) {
    historySection.appendChild(historyGrid);
    view.appendChild(historySection);
  } else {
    historySection.appendChild(el('div', { class: 'empty' }, '没有历史或未来目标'));
    view.appendChild(historySection);
  }
}
