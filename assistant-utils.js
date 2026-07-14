/* AI 助手工具函数：数据上下文摘要、历史记录、Markdown 渲染 */
'use strict';

const CHAT_HISTORY_KEY = 'outdoor_assistant_chat_history';
const CHAT_HISTORY_LIMIT = 50;
const CHAT_MAX_MESSAGE_LENGTH = 2000;

const CHAT_QUICK_QUESTIONS = [
  { label: '最近状态', text: '根据我最近的数据，分析我的训练状态和身体恢复情况。' },
  { label: '本周负荷', text: '我本周的训练负荷怎么样？ACWR 是多少？' },
  { label: '推荐路线', text: '根据我的体能和最近的恢复情况，推荐一条适合本周的路线。' },
  { label: '闲置装备', text: '我的装备里有哪些使用次数很少或长期闲置的？' },
  { label: '伤病关注', text: '我近期有哪些身体不适或伤病需要关注？' },
];

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

function buildAssistantContext(data) {
  if (!data) return {};

  const profile = data.profile || {};
  const activities = data.activities || [];
  const bodyLogs = data.body_logs || [];
  const gear = data.gear || [];
  const routes = data.routes || [];
  const plans = data.plans || [];
  const segments = data.segments || [];

  const now = new Date();
  const ms30 = 30 * 24 * 3600 * 1000;
  const dist30 = activities
    .filter((a) => a.date && (now - new Date(a.date)) <= ms30)
    .reduce((s, a) => s + (Number(a.distance_km) || 0), 0);

  const recentActivities = [...activities]
    .filter((a) => a.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 20)
    .map((a) => ({
      date: a.date,
      route: a.route || '',
      type: a.type || '',
      distance_km: Number(a.distance_km) || 0,
      elevation_gain_m: Number(a.elevation_gain_m) || 0,
      duration_hours: Number(a.duration_hours) || 0,
      avg_hr: a.avg_hr != null ? Number(a.avg_hr) : null,
      felt: a.felt || '',
      issues: Array.isArray(a.issues) ? a.issues : [],
      notes: a.notes || '',
    }));

  const recentBodyLogs = [...bodyLogs]
    .filter((b) => b.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 30)
    .map((b) => ({
      date: b.date,
      sleep_hours: b.sleep_hours != null ? Number(b.sleep_hours) : null,
      fatigue: b.fatigue != null ? Number(b.fatigue) : null,
      muscle_soreness: b.muscle_soreness != null ? Number(b.muscle_soreness) : null,
      knee_status: b.knee_status || '',
      mood: b.mood != null ? Number(b.mood) : null,
      weight_kg: b.weight_kg != null ? Number(b.weight_kg) : null,
      notes: b.notes || '',
    }));

  const gearSummary = gear.map((g) => ({
    name: g.name || g.slug || '',
    category: g.category || '',
    weight_g: g.weight_g != null ? Number(g.weight_g) : null,
    usage_count: g.usage_count != null ? Number(g.usage_count) : 0,
    condition: g.condition || '',
    status: g.status || 'active',
  }));

  const routeSummary = routes.map((r) => ({
    name: r.name || r.slug || '',
    location: r.location || '',
    distance_km: Number(r.distance_km) || 0,
    elevation_gain_m: Number(r.elevation_gain_m) || 0,
    difficulty: r.difficulty || '',
    estimated_hours: Number(r.estimated_hours) || 0,
  }));

  const today = now.toISOString().slice(0, 10);
  const futurePlans = plans
    .filter((p) => p.date && String(p.date) >= today)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(0, 10)
    .map((p) => ({
      date: p.date,
      route: p.route || '',
      plan_type: p.plan_type || '',
      type: p.type || '',
      distance_km: Number(p.distance_km) || 0,
      elevation_gain_m: Number(p.elevation_gain_m) || 0,
    }));

  const weekly = computeWeeklyLoad(activities, 5);
  const acwr = computeACWR(weekly);
  const fatigue = computeFatigueScore(bodyLogs);

  return {
    profile: {
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
    },
    stats: {
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
    },
    recentActivities,
    recentBodyLogs,
    gear: gearSummary,
    routes: routeSummary,
    plans: futurePlans,
    segments: segments.slice(0, 20).map((s) => ({ slug: s.slug, name: s.name || s.slug, ...s.data })),
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
