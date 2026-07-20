/* AI 助手工具函数：数据上下文摘要、历史记录、Markdown 渲染 */
'use strict';

const CHAT_HISTORY_KEY = 'outdoor_assistant_chat_history';
const CHAT_HISTORY_LIMIT = 50;
const CHAT_MAX_MESSAGE_LENGTH = 2000;

/** 将本地 Date 对象格式化为 YYYY-MM-DD，避免 toISOString() 转到 UTC 导致日期错位。 */
function formatLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const CHAT_QUICK_QUESTIONS = [
  { label: '本周报告', text: '生成本周训练报告。' },
  { label: '保存本周报告', text: '保存本周报告到历史周报中心。' },
  { label: '最近状态', text: '根据我最近的数据，分析我的训练状态和身体恢复情况。' },
  { label: '本周负荷', text: '我本周的训练负荷怎么样？ACWR 是多少？' },
  { label: '推荐路线', text: '根据我的体能和最近的恢复情况，推荐一条适合本周的路线。' },
  { label: '闲置装备', text: '我的装备里有哪些使用次数很少或长期闲置的？' },
  { label: '伤病关注', text: '我近期有哪些身体不适或伤病需要关注？' },
];

const WEEKLY_REPORT_KEY = 'outdoor_assistant_weekly_report';
const WEEKLY_REPORT_SEEN_KEY = 'outdoor_assistant_weekly_report_seen';

function getChatHistory() {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-CHAT_HISTORY_LIMIT);
  } catch (e) {
    return [];
  }
}

function saveChatHistory(messages) {
  if (!Array.isArray(messages)) return;
  const trimmed = messages.slice(-CHAT_HISTORY_LIMIT).map((m) => ({
    role: m.role,
    content: String(m.content || '').slice(0, CHAT_MAX_MESSAGE_LENGTH),
    type: m.type || null,
    action: m.action || null,
    time: m.time || new Date().toISOString(),
  }));
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(trimmed));
  } catch (e) {
    // ignore storage errors
  }
}

function clearChatHistory() {
  try {
    localStorage.removeItem(CHAT_HISTORY_KEY);
  } catch (e) {
    // ignore
  }
}

function getCurrentWeekKey() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  return formatLocalDate(monday);
}

function getWeekRange(weekKey) {
  const start = new Date(weekKey + 'T00:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: formatLocalDate(start), end: formatLocalDate(end) };
}

function computeWeeklySummary(data) {
  if (!data) return null;
  const activities = data.activities || [];
  const bodyLogs = data.body_logs || [];

  const weekKey = getCurrentWeekKey();
  const { start, end } = getWeekRange(weekKey);

  const weekActivities = activities.filter((a) => a.date >= start && a.date <= end);
  const weekBodyLogs = bodyLogs.filter((b) => b.date >= start && b.date <= end);

  const totalDistance = weekActivities.reduce((s, a) => s + (Number(a.distance_km) || 0), 0);
  const totalElevation = weekActivities.reduce((s, a) => s + (Number(a.elevation_gain_m) || 0), 0);
  const totalDuration = weekActivities.reduce((s, a) => s + (Number(a.duration_hours) || 0), 0);

  const weekly = computeWeeklyLoad(activities, 5);
  const acwr = computeACWR(weekly);
  const fatigue = computeFatigueScore(bodyLogs);

  const sleepValues = weekBodyLogs.map((b) => Number(b.sleep_hours)).filter((v) => !isNaN(v));
  const fatigueValues = weekBodyLogs.map((b) => Number(b.fatigue)).filter((v) => !isNaN(v));

  return {
    weekKey,
    range: { start, end },
    activityCount: weekActivities.length,
    totalDistance,
    totalElevation,
    totalDuration,
    avgSleep: sleepValues.length ? sleepValues.reduce((s, v) => s + v, 0) / sleepValues.length : null,
    avgFatigue: fatigueValues.length ? fatigueValues.reduce((s, v) => s + v, 0) / fatigueValues.length : null,
    acwr,
    fatigue,
  };
}

function getWeeklyReportCache() {
  try {
    const raw = localStorage.getItem(WEEKLY_REPORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.weekKey !== getCurrentWeekKey()) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function saveWeeklyReportCache(report) {
  try {
    localStorage.setItem(WEEKLY_REPORT_KEY, JSON.stringify(report));
  } catch (e) {
    // ignore
  }
}

function hasSeenWeeklyReport() {
  try {
    return localStorage.getItem(WEEKLY_REPORT_SEEN_KEY) === getCurrentWeekKey();
  } catch (e) {
    return false;
  }
}

function markWeeklyReportSeen() {
  try {
    localStorage.setItem(WEEKLY_REPORT_SEEN_KEY, getCurrentWeekKey());
  } catch (e) {
    // ignore
  }
}

function buildAssistantContext(data, intent = 'query') {
  if (!data) return {};

  const profile = data.profile || {};
  const activities = data.activities || [];
  const bodyLogs = data.body_logs || [];
  const gear = data.gear || [];
  const routes = data.routes || [];
  const plans = data.plans || [];
  const segments = data.segments || [];

  // 全局摘要（query / 兜底用）
  const now = new Date();
  const ms30 = 30 * 24 * 3600 * 1000;
  const dist30 = activities
    .filter((a) => a.date && (now - new Date(a.date)) <= ms30)
    .reduce((s, a) => s + (Number(a.distance_km) || 0), 0);

  const weekly = computeWeeklyLoad(activities, 5);
  const acwr = computeACWR(weekly);
  const fatigue = computeFatigueScore(bodyLogs);

  const profileSummary = {
    name: profile.name || '',
    fitness_level: profile.fitness_level || '',
    age: profile.age || null,
    weight_kg: profile.weight_kg != null ? Number(profile.weight_kg) : null,
    weekly_mileage_km: profile.weekly_mileage_km != null ? Number(profile.weekly_mileage_km) : null,
    typical_pace_flat: profile.typical_pace_flat || '',
    typical_pace_climb: profile.typical_pace_climb || '',
    cold_tolerance: profile.cold_tolerance || '',
    heat_tolerance: profile.heat_tolerance || '',
    common_issues: Array.isArray(profile.common_issues) ? profile.common_issues : [],
    recent_condition: profile.recent_condition || '',
    goals: Array.isArray(profile.goals) ? profile.goals : [],
  };

  const stats = {
    total_activities: activities.length,
    total_distance_km: activities.reduce((s, a) => s + (Number(a.distance_km) || 0), 0),
    total_elevation_gain_m: activities.reduce((s, a) => s + (Number(a.elevation_gain_m) || 0), 0),
    last_30d_distance_km: dist30,
    gear_count: gear.length,
    route_count: routes.length,
    acwr_ratio: acwr.ratio || 0,
    acwr_status: acwr.status || '',
    fatigue_score: fatigue.score || 0,
    fatigue_status: fatigue.status || '',
  };

  // 按意图裁剪上下文，只传该意图需要的数据，减少 token 和 JSON 体积
  if (intent === 'body') {
    return {
      profile: profileSummary,
      recentBodyLogs: [...bodyLogs]
        .filter((b) => b.date)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 10)
        .map((b) => ({
          date: b.date,
          sleep_hours: b.sleep_hours != null ? Number(b.sleep_hours) : null,
          fatigue: b.fatigue != null ? Number(b.fatigue) : null,
          muscle_soreness: b.muscle_soreness != null ? Number(b.muscle_soreness) : null,
          knee_status: b.knee_status || '',
          mood: b.mood != null ? Number(b.mood) : null,
          weight_kg: b.weight_kg != null ? Number(b.weight_kg) : null,
        })),
    };
  }

  if (intent === 'activity') {
    return {
      profile: profileSummary,
      recentActivities: [...activities]
        .filter((a) => a.date)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .slice(0, 7)
        .map((a) => ({
          date: a.date,
          route: a.route || '',
          type: a.type || '',
          distance_km: Number(a.distance_km) || 0,
          elevation_gain_m: Number(a.elevation_gain_m) || 0,
          duration_hours: Number(a.duration_hours) || 0,
          avg_hr: a.avg_hr != null ? Number(a.avg_hr) : null,
          felt: a.felt || '',
        })),
    };
  }

  if (intent === 'plan') {
    return {
      profile: profileSummary,
      routes: routes.map((r) => ({
        slug: r.slug || '',
        name: r.name || r.slug || '',
        location: r.location || '',
        distance_km: Number(r.distance_km) || 0,
        elevation_gain_m: Number(r.elevation_gain_m) || 0,
        difficulty: r.difficulty || '',
        estimated_hours: Number(r.estimated_hours) || 0,
        weather_city: r.weather_city || '',
      })),
    };
  }

  // query / 默认：全局摘要，但仍去掉 notes/segments data 等大字段
  return {
    profile: profileSummary,
    stats,
    recentActivities: [...activities]
      .filter((a) => a.date)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 10)
      .map((a) => ({
        date: a.date,
        route: a.route || '',
        type: a.type || '',
        distance_km: Number(a.distance_km) || 0,
        elevation_gain_m: Number(a.elevation_gain_m) || 0,
        duration_hours: Number(a.duration_hours) || 0,
        avg_hr: a.avg_hr != null ? Number(a.avg_hr) : null,
        felt: a.felt || '',
      })),
    recentBodyLogs: [...bodyLogs]
      .filter((b) => b.date)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 14)
      .map((b) => ({
        date: b.date,
        sleep_hours: b.sleep_hours != null ? Number(b.sleep_hours) : null,
        fatigue: b.fatigue != null ? Number(b.fatigue) : null,
        muscle_soreness: b.muscle_soreness != null ? Number(b.muscle_soreness) : null,
        knee_status: b.knee_status || '',
        mood: b.mood != null ? Number(b.mood) : null,
        weight_kg: b.weight_kg != null ? Number(b.weight_kg) : null,
      })),
    gear: gear.map((g) => ({
      name: g.name || g.slug || '',
      category: g.category || '',
      weight_g: g.weight_g != null ? Number(g.weight_g) : null,
      usage_count: g.usage_count != null ? Number(g.usage_count) : 0,
      condition: g.condition || '',
      status: g.status || 'active',
    })),
    routes: routes.map((r) => ({
      slug: r.slug || '',
      name: r.name || r.slug || '',
      location: r.location || '',
      distance_km: Number(r.distance_km) || 0,
      elevation_gain_m: Number(r.elevation_gain_m) || 0,
      difficulty: r.difficulty || '',
      estimated_hours: Number(r.estimated_hours) || 0,
    })),
    plans: plans
      .filter((p) => p.date && String(p.date) >= now.toISOString().slice(0, 10))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, 5)
      .map((p) => ({
        date: p.date,
        route: p.route || '',
        plan_type: p.plan_type || '',
        type: p.type || '',
        distance_km: Number(p.distance_km) || 0,
        elevation_gain_m: Number(p.elevation_gain_m) || 0,
      })),
    segments: segments.slice(0, 10).map((s) => ({
      slug: s.slug,
      name: s.name || s.slug,
      distance_km: s.data?.distance_km ?? null,
      elevation_gain_m: s.data?.elevation_gain_m ?? null,
    })),
  };
}

function renderMarkdown(text) {
  if (!text) return '';
  let html = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 代码块
  html = html.replace(/```([\s\S]*?)```/g, '<pre class="chat-code-block"><code>$1</code></pre>');
  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 加粗
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // 斜体
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 列表
  const lines = html.split('\n');
  let inList = false;
  const out = [];
  for (const line of lines) {
    const listMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (listMatch) {
      if (!inList) {
        out.push('<ul class="chat-list">');
        inList = true;
      }
      out.push(`<li>${listMatch[2]}</li>`);
    } else {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      if (line.trim() === '') {
        out.push('');
      } else {
        out.push(`<p>${line}</p>`);
      }
    }
  }
  if (inList) out.push('</ul>');

  return out.join('\n');
}

function formatChatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------- AI 助手「确认后执行」卡片 ----------

function findLocalConflict(intent, data) {
  if (!state.data) return null;
  if (intent === 'body') {
    const date = String(data.date || '').slice(0, 10);
    if (!date) return null;
    return state.data.body_logs.find((b) => String(b.date) === date) || null;
  }
  if (intent === 'activity') {
    const date = String(data.date || '').slice(0, 10);
    const route = String(data.route || '');
    const sequence = Number(data.sequence || 0);
    if (!date) return null;
    return state.data.activities.find((a) =>
      String(a.date) === date &&
      String(a.route || '') === route &&
      Number(a.sequence || 0) === sequence
    ) || null;
  }
  if (intent === 'plan') {
    const date = String(data.date || '').slice(0, 10);
    const route = String(data.route || '');
    if (!date) return null;
    return state.data.plans.find((p) =>
      String(p.date) === date && String(p.route || '') === route
    ) || null;
  }
  return null;
}

function renderActionCard(action, onConfirm, onCancel) {
  const wrap = el('div', { class: 'chat-action-card' });

  const iconMap = {
    'create': '➕',
    'update': '🔄',
    'delete': '🗑️',
  };
  const badgeMap = {
    'create': '创建',
    'update': '更新',
    'delete': '删除',
  };
  const confirmTextMap = {
    'create': '确认创建',
    'update': '确认更新',
    'delete': '确认删除',
  };

  const titleMap = {
    'body': '身体日志',
    'activity': '活动记录',
    'plan': '行程计划',
    'batch': '批量导入',
    'report': '历史报告',
  };

  const header = el('div', { class: 'chat-action-header' });
  header.appendChild(el('span', { class: 'chat-action-icon' }, iconMap[action.action] || '➕'));
  header.appendChild(el('span', { class: 'chat-action-title' }, titleMap[action.intent] || '操作'));
  header.appendChild(el('span', { class: 'chat-action-badge' }, badgeMap[action.action] || '创建'));
  wrap.appendChild(header);

  if (action.message) {
    wrap.appendChild(el('div', { class: 'chat-action-message' }, action.message));
  }

  if (action.preview) {
    const pre = el('pre', { class: 'chat-action-preview' }, escapeHtml(action.preview));
    wrap.appendChild(pre);
  }

  if (action.existing) {
    const warningText = action.action === 'delete'
      ? '⚠️ 删除后不可恢复。'
      : '⚠️ 该日期已有记录，确认后将覆盖原有数据。';
    wrap.appendChild(el('div', { class: 'chat-action-warning' }, warningText));
  }

  const actions = el('div', { class: 'chat-action-actions' });
  const confirmBtn = el('button', { class: 'btn btn-primary btn-sm' }, confirmTextMap[action.action] || '确认');
  const cancelBtn = el('button', { class: 'btn btn-sm' }, '取消');

  confirmBtn.addEventListener('click', () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    onConfirm();
  });
  cancelBtn.addEventListener('click', () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    onCancel();
  });

  actions.appendChild(confirmBtn);
  actions.appendChild(cancelBtn);
  wrap.appendChild(actions);

  return wrap;
}

function nextActivitySequence(date, route) {
  const same = (state.data.activities || []).filter((a) =>
    String(a.date) === String(date) && String(a.route || '') === String(route || '')
  );
  return same.length ? Math.max(...same.map((a) => Number(a.sequence || 0))) + 1 : 0;
}

async function saveHistoricalReportAction(data, existingHint) {
  if (typeof computeReportSummary !== 'function' || typeof buildReportMarkdown !== 'function') {
    return { ok: false, error: '报告计算函数未加载，请切换到报告中心生成。' };
  }

  const reportType = data.report_type || 'week';
  const periodKey = data.period_key || data.ref_date;
  if (!periodKey) return { ok: false, error: '缺少报告周期信息' };

  const summaryObj = computeReportSummary(state.data, reportType, periodKey);
  const markdown = buildReportMarkdown(summaryObj, reportType, summaryObj.start, summaryObj.end);
  const payload = {
    data: {
      report_type: reportType,
      period_key: summaryObj.periodKey,
      start_date: summaryObj.start,
      end_date: summaryObj.end,
      summary: summaryObj.summary,
      acwr: summaryObj.acwr,
      fatigue: summaryObj.fatigue,
      avgSleep: summaryObj.avgSleep,
      avgFatigue: summaryObj.avgFatigue,
      generatedAt: summaryObj.generatedAt,
    },
    raw_markdown: markdown,
  };

  const reports = state.data.reports || [];
  const existing = reports.find((r) => r.report_type === reportType && r.period_key === summaryObj.periodKey)
    || (existingHint && existingHint.id ? existingHint : null);

  try {
    const res = existing && existing.id
      ? await fetchUpdateReport(state.apiUrl, state.token, existing.id, payload)
      : await fetchSaveReport(state.apiUrl, state.token, payload);
    if (res && res.error && !res.queued) throw new Error(res.error || '保存失败');

    if (!res.queued) {
      const merged = unwrap(res);
      const idx = reports.findIndex((r) => r.report_type === reportType && r.period_key === summaryObj.periodKey);
      if (idx >= 0) reports[idx] = merged;
      else reports.push(merged);
      state.data.reports = reports.sort((a, b) => String(b.period_key).localeCompare(String(a.period_key)));
      saveSnapshot();
    }

    const typeLabel = reportType === 'week' ? '周报' : '月报';
    return {
      ok: true,
      queued: res.queued,
      message: res.queued
        ? `${summaryObj.periodKey} ${typeLabel}已加入离线保存队列`
        : `${summaryObj.periodKey} ${typeLabel}已保存到历史报告中心`,
    };
  } catch (err) {
    return { ok: false, error: err.message || '保存失败' };
  }
}

async function executeProposedAction(action) {
  const { intent, action: mode, data, existing } = action;

  if (intent === 'batch') {
    return executeBatchAction(action);
  }

  if (intent === 'report') {
    return saveHistoricalReportAction(data, existing);
  }

  if (intent === 'body') {
    if (mode === 'delete') {
      await fetchDelete(state.apiUrl, state.token, 'body', data.date);
      return { ok: true, message: '身体日志已删除' };
    }
    const payload = { ...data };
    delete payload.date;
    const res = await fetchSaveBody(state.apiUrl, state.token, data.date, payload, buildBodyMarkdown(data));
    if (res && res.queued) return { ok: true, queued: true, message: '身体日志已加入离线队列，联网后自动同步' };
    return { ok: true, message: '身体日志已保存' };
  }

  if (intent === 'activity') {
    if (mode === 'delete') {
      const id = existing && existing.id;
      if (!id) return { ok: false, error: '未找到活动 ID，无法删除' };
      await fetchDelete(state.apiUrl, state.token, 'activities', id);
      return { ok: true, message: '活动记录已删除' };
    }
    const activityData = {
      ...data,
      gear_used: Array.isArray(data.gear_used) ? data.gear_used : [],
    };
    const route = activityData.route || '活动';
    const sequence = existing ? (existing.sequence ?? 0) : nextActivitySequence(activityData.date, route);
    const payload = {
      date: activityData.date,
      route,
      sequence,
      data: activityData,
      raw_markdown: buildActivityMarkdown(activityData),
    };
    const res = await fetchSaveActivity(state.apiUrl, state.token, payload);
    if (res && res.queued) return { ok: true, queued: true, message: '活动记录已加入离线队列，联网后自动同步' };
    return { ok: true, message: '活动记录已保存' };
  }

  if (intent === 'plan') {
    if (mode === 'delete') {
      const id = existing && existing.id;
      if (!id) return { ok: false, error: '未找到计划 ID，无法删除' };
      await fetchDelete(state.apiUrl, state.token, 'plans', id);
      return { ok: true, message: '行程计划已删除' };
    }
    const planData = { ...data };
    delete planData._recommend;
    const localExisting = findLocalConflict('plan', planData);
    const payload = { data: planData, raw_markdown: buildPlanMarkdown(planData) };
    let res;
    if (localExisting && localExisting.id) {
      res = await fetchUpdatePlan(state.apiUrl, state.token, localExisting.id, payload);
    } else {
      res = await fetchSavePlan(state.apiUrl, state.token, payload);
    }
    if (res && res.queued) return { ok: true, queued: true, message: '行程计划已加入离线队列，联网后自动同步' };
    return { ok: true, message: '行程计划已保存' };
  }

  return { ok: false, error: '未知意图' };
}

async function executeBatchAction(action) {
  const items = Array.isArray(action.items) ? action.items : [];
  if (!items.length) return { ok: false, error: '没有可导入的记录' };

  let success = 0;
  const errors = [];

  for (const item of items) {
    try {
      if (item.entity === 'body') {
        const payload = { ...item };
        delete payload.entity;
        delete payload.date;
        await fetchSaveBody(state.apiUrl, state.token, item.date, payload, buildBodyMarkdown(item));
        success++;
      } else if (item.entity === 'activity') {
        const activityData = { ...item, gear_used: Array.isArray(item.gear_used) ? item.gear_used : [] };
        delete activityData.entity;
        const route = activityData.route || '活动';
        const sequence = nextActivitySequence(activityData.date, route);
        const payload = {
          date: activityData.date,
          route,
          sequence,
          data: activityData,
          raw_markdown: buildActivityMarkdown(activityData),
        };
        await fetchSaveActivity(state.apiUrl, state.token, payload);
        success++;
      }
    } catch (err) {
      errors.push(`${item.date} ${item.entity}: ${err.message || '失败'}`);
    }
  }

  if (success === 0) {
    return { ok: false, error: `批量导入全部失败：${errors.slice(0, 3).join('；')}` };
  }

  const message = errors.length
    ? `已导入 ${success}/${items.length} 条，${errors.length} 条失败`
    : `已导入 ${success} 条记录`;
  return { ok: true, message };
}
