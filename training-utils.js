/* 训练负荷计算工具函数（客户端） */
'use strict';

/** 计算周负荷桶。返回对象 { weekKey: { distance, elevation, duration, count } }。 */
function computeWeeklyLoad(activities, weeks = 8) {
  const weekly = {};
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - weeks * 7);

  for (const a of activities || []) {
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

/** 计算 ACWR：本周负荷 / 前 4 周平均负荷。 */
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

/** 计算疲劳评分。 */
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

/** 计算疲劳/酸痛逐日趋势（最近 days 天）。 */
function computeFatigueTrend(bodyLogs, days = 30) {
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(start.getDate() - days + 1);
  const startStr = start.toISOString().slice(0, 10);

  const logMap = new Map();
  for (const b of bodyLogs || []) {
    if (!b.date) continue;
    const d = String(b.date);
    // 同一天保留最新一条
    if (!logMap.has(d) || String(b._updated_at || '') > String(logMap.get(d)._updated_at || '')) {
      logMap.set(d, b);
    }
  }

  const points = [];
  for (let d = new Date(start); d <= new Date(today + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    const log = logMap.get(ds);
    points.push({
      date: ds,
      fatigue: log && !isNaN(Number(log.fatigue)) ? Number(log.fatigue) : null,
      soreness: log && !isNaN(Number(log.muscle_soreness)) ? Number(log.muscle_soreness) : null,
    });
  }
  return points;
}

/** 计算月统计。 */
function computeMonthSummary(activities, refDate = null) {
  const ref = refDate ? new Date(refDate + 'T00:00:00') : new Date();
  const year = ref.getFullYear();
  const month = ref.getMonth();
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDate = new Date(year, month + 1, 0);
  const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

  const list = (activities || []).filter((a) => a.date && String(a.date) >= start && String(a.date) <= end);
  return {
    distance: list.reduce((s, a) => s + (Number(a.distance_km) || 0), 0),
    elevation: list.reduce((s, a) => s + (Number(a.elevation_gain_m) || 0), 0),
    duration: list.reduce((s, a) => s + (Number(a.duration_hours) || 0), 0),
    count: list.length,
    start,
    end,
  };
}

/** 把 weekKey 格式化为 "MM/DD-MM/DD"。 */
function formatWeekLabel(weekKey) {
  const start = new Date(weekKey + 'T00:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.getMonth() + 1}/${start.getDate()}-${end.getMonth() + 1}/${end.getDate()}`;
}
