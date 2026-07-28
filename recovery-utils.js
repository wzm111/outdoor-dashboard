/* 恢复视图工具函数 */
'use strict';

/** 计算活动强度评分（与 recovery-plan.py 对齐） */
function computeRecoveryIntensity(activity) {
  const distance = Number(activity.distance_km) || 0;
  const elevation = Number(activity.elevation_gain_m) || 0;
  const duration = Number(activity.duration_hours) || 0;
  const type = activity.type || 'hiking';
  const felt = activity.felt || 'moderate';
  const issues = activity.issues || [];

  let score = 0;
  if (type === 'running') {
    score += Math.min(distance * 3, 40);
    score += Math.min(duration * 5, 15);
  } else if (type === 'trail_running') {
    score += Math.min(distance * 3, 35);
    score += Math.min(elevation / 50, 20);
    score += Math.min(duration * 5, 15);
  } else {
    score += Math.min(distance * 1.5, 25);
    score += Math.min(elevation / 30, 35);
    score += Math.min(duration * 3, 20);
  }

  const feltBonus = { easy: 0, moderate: 5, hard: 15, extreme: 25 };
  score += feltBonus[felt] || 5;
  if (issues && issues.length) score += Math.min(issues.length * 10, 20);

  let level, recoveryDays;
  if (score >= 80) { level = '极高'; recoveryDays = 7; }
  else if (score >= 60) { level = '高'; recoveryDays = 5; }
  else if (score >= 40) { level = '中等'; recoveryDays = 4; }
  else if (score >= 20) { level = '中等偏低'; recoveryDays = 3; }
  else { level = '低'; recoveryDays = 2; }

  return { score: Math.round(score * 10) / 10, level, recoveryDays, distance, elevation, duration, type, felt, issues };
}

/** 根据最近身体日志调整恢复天数。返回值固定为 { days, avgFatigue, concerns }（无日志时也不退化为裸数字）。 */
function adjustRecoveryDays(intensity, bodyLogs) {
  let days = intensity.recoveryDays;
  if (!bodyLogs || !bodyLogs.length) return { days, avgFatigue: 0, concerns: [] };

  const recent = bodyLogs
    .filter((b) => b.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 7);

  const fatigues = recent.map((b) => Number(b.fatigue)).filter((v) => !isNaN(v));
  const avgFatigue = fatigues.length ? fatigues.reduce((s, v) => s + v, 0) / fatigues.length : 0;

  const concerns = [];
  if (avgFatigue >= 6) {
    days += 1;
    concerns.push('疲劳度较高');
  }
  const kneeIssues = recent.filter((b) => b.knee_status && b.knee_status !== 'good');
  if (kneeIssues.length) {
    days += 1;
    concerns.push('膝盖状态需关注');
  }
  if (intensity.issues && intensity.issues.length) {
    days += 1;
    concerns.push('活动中有伤病记录');
  }

  return { days: Math.min(days, 10), avgFatigue, concerns };
}

/** 生成单日恢复计划 */
function generateRecoveryDay(day, totalDays, intensity, avgFatigue, issues, type) {
  let phase, phaseDesc;
  if (day <= totalDays / 3) { phase = '急性恢复'; phaseDesc = '以休息和轻度活动为主'; }
  else if (day <= (totalDays * 2) / 3) { phase = '主动恢复'; phaseDesc = '开始轻度活动，促进血液循环'; }
  else { phase = '功能恢复'; phaseDesc = '逐步恢复正常训练'; }

  const activities = [];
  const stretches = [];
  const notes = [];

  if (day === 1) {
    activities.push('完全休息或极轻度散步 15-20 分钟');
    stretches.push('全身静态拉伸 15-20 分钟');
    stretches.push('泡沫轴放松大腿、小腿、臀部');
    notes.push('多喝水，补充电解质');
    notes.push('保证 8 小时以上睡眠');
  } else if (day === 2) {
    if (intensity.level === '极高' || intensity.level === '高') {
      activities.push('轻度散步 20-30 分钟');
      stretches.push('髂胫束拉伸');
      stretches.push('臀中肌激活');
    } else {
      activities.push('轻松步行 30 分钟');
      stretches.push('全身动态拉伸');
    }
  } else if (day < totalDays) {
    if (type === 'running') {
      activities.push(`轻松跑 ${day * 2}km（配速比日常慢 30-45 秒）`);
    } else if (type === 'hiking' || type === 'trail_running') {
      if (intensity.elevation > 1000) {
        activities.push('平地步行 40-60 分钟');
        activities.push('避免爬升和下坡');
      } else {
        activities.push('轻松步行 45-60 分钟');
      }
    } else {
      activities.push('轻度有氧运动 30-45 分钟');
    }
    stretches.push('动态拉伸 10 分钟');
    stretches.push('核心稳定性训练 15 分钟');
  } else {
    if (type === 'running') activities.push('恢复跑 5-8km');
    else if (type === 'hiking' || type === 'trail_running') activities.push('轻度徒步 60-90 分钟（低爬升）');
    else activities.push('轻度有氧运动 30-45 分钟');
    stretches.push('完整拉伸序列 15 分钟');
    notes.push('评估身体状态，如无不适可恢复正常训练');
  }

  if (issues && issues.length) {
    const issueStr = issues.join(' ').toLowerCase();
    if (issueStr.includes('knee') || issueStr.includes('膝盖')) {
      stretches.push('股四头肌拉伸');
      notes.push('避免深屈膝动作');
    }
    if (issueStr.includes('it_band') || issueStr.includes('髂胫束')) {
      stretches.push('IT band 拉伸');
      notes.push('避免下坡和侧向移动');
    }
    if (issueStr.includes('blister') || issueStr.includes('水泡')) {
      notes.push('保持脚部干燥，避免摩擦');
    }
    if (issueStr.includes('cramp') || issueStr.includes('抽筋')) {
      notes.push('继续补充电解质和镁');
    }
    if (issueStr.includes('hypoglycemia') || issueStr.includes('低血糖')) {
      notes.push('规律补充碳水，避免空腹活动');
    }
  }

  if (avgFatigue >= 6) notes.push('疲劳度较高，建议延长休息');

  return { day, phase, phaseDesc, activities, stretches, notes };
}

function safeParseDate(d) {
  if (!d) return null;
  const s = String(d).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const dt = new Date(s + 'T00:00:00');
  return isNaN(dt.getTime()) ? null : dt;
}

/** 基于最近一次高强度活动生成完整恢复计划 */
function computeRecoveryPlan(activities, bodyLogs, refDate = null) {
  const today = safeParseDate(refDate) || new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const recentActivity = (activities || [])
    .filter((a) => {
      const d = safeParseDate(a.date);
      return d && d.toISOString().slice(0, 10) <= todayStr;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];

  if (!recentActivity) return null;

  const intensity = computeRecoveryIntensity(recentActivity);
  const adjustment = adjustRecoveryDays(intensity, bodyLogs);
  const totalDays = adjustment.days;

  const activityDate = safeParseDate(recentActivity.date);
  if (!activityDate) return null;
  const endDate = new Date(activityDate);
  endDate.setDate(activityDate.getDate() + totalDays);

  const diffDays = Math.floor((today - activityDate) / (1000 * 60 * 60 * 24));
  const remaining = Math.max(0, totalDays - diffDays);
  const progress = Math.min(100, Math.max(0, (diffDays / totalDays) * 100));

  const daysPlan = [];
  for (let d = 1; d <= totalDays; d++) {
    daysPlan.push(generateRecoveryDay(d, totalDays, intensity, adjustment.avgFatigue, intensity.issues, intensity.type));
  }

  const todayPlan = daysPlan[Math.max(0, Math.min(diffDays, totalDays - 1))] || null;

  return {
    activity: recentActivity,
    intensity,
    totalDays,
    avgFatigue: adjustment.avgFatigue,
    concerns: adjustment.concerns,
    activityDate: String(recentActivity.date),
    endDate: endDate.toISOString().slice(0, 10),
    diffDays,
    remaining,
    progress,
    todayPlan,
    daysPlan,
  };
}

/* ---------- 每日训练就绪度（v1.23.0） ---------- */

/** 静息心率基线：最近 30 天数据，基线 = 除最新一条外的中位数。
 *  count < 5 视为数据不足（sufficient=false），评分时跳过该因素。 */
function computeRestingHrBaseline(bodyLogs, refDate = null) {
  const today = safeParseDate(refDate) || new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 30);
  const startStr = start.toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  const entries = (bodyLogs || [])
    .filter((b) => b.date && Number(b.resting_hr) > 0)
    .map((b) => ({ date: String(b.date).slice(0, 10), rhr: Number(b.resting_hr) }))
    .filter((e) => e.date >= startStr && e.date <= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  const count = entries.length;
  if (!count) return { baseline: null, latest: null, delta: null, count: 0, sufficient: false };

  const latest = entries[count - 1].rhr;
  const prior = entries.slice(0, -1).map((e) => e.rhr).sort((a, b) => a - b);
  let baseline = null;
  if (prior.length) {
    const mid = Math.floor(prior.length / 2);
    baseline = prior.length % 2 ? prior[mid] : (prior[mid - 1] + prior[mid]) / 2;
  }
  const delta = baseline != null ? Math.round((latest - baseline) * 10) / 10 : null;
  return { baseline, latest, delta, count, sufficient: count >= 5 && baseline != null };
}

/** 连续训练天数：截至 refDate，往前数没有休息日的天数。今天还没训练则从前一天开始数。 */
function computeConsecutiveTrainingDays(activities, refDate = null) {
  const today = safeParseDate(refDate) || new Date();
  const daySet = new Set();
  for (const a of activities || []) {
    const d = safeParseDate(a.date);
    if (d) daySet.add(d.toISOString().slice(0, 10));
  }
  const fmt = (dt) => dt.toISOString().slice(0, 10);
  const cursor = new Date(today);
  if (!daySet.has(fmt(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (daySet.has(fmt(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

/** 就绪度档位 → 状态色 class（stat-ok / stat-warn / stat-critical） */
function readinessLevelClass(levelKey) {
  if (levelKey === 'rest') return 'stat-critical';
  if (levelKey === 'easy') return 'stat-warn';
  return 'stat-ok';
}

/** 每日训练就绪度：综合 ACWR / 疲劳评分 / 静息心率趋势 / 睡眠 / 膝盖 / 连续训练 / 恢复阶段，
 *  输出 0-100 分与 休息/轻松/正常/可加量 四档建议。数据完全为空时返回 null。 */
function computeDailyReadiness(activities, bodyLogs, profile, refDate = null) {
  if (!((activities || []).length || (bodyLogs || []).length)) return null;

  const weekly = computeWeeklyLoad(activities, 5);
  const acwr = computeACWR(weekly);
  const fatigue = computeFatigueScore(bodyLogs);
  const rhr = computeRestingHrBaseline(bodyLogs, refDate);
  const recoveryPlan = computeRecoveryPlan(activities, bodyLogs, refDate);

  const today = (safeParseDate(refDate) || new Date()).toISOString().slice(0, 10);
  const todayLog = (bodyLogs || []).find((b) => String(b.date) === today);

  let score = 100;
  const factorDetails = [];
  const reasons = [];
  const deduct = (factor, penalty, detail) => {
    if (penalty <= 0) return;
    score -= penalty;
    factorDetails.push({ factor, penalty, detail });
    reasons.push(detail);
  };

  // ACWR（周负荷突增）
  if (acwr.risk === 'danger') {
    deduct('ACWR', 40, `ACWR ${acwr.ratio.toFixed(2)} 危险区（高伤病风险）`);
  } else if (acwr.risk === 'warning') {
    deduct('ACWR', 20, `ACWR ${acwr.ratio.toFixed(2)} 警告区（负荷增长偏快）`);
  }

  // 疲劳评分（近 7 天疲劳/酸痛/睡眠均值）
  if (fatigue.levelKey !== 'unknown') {
    const p = Math.round(fatigue.score * 0.35);
    if (p > 0) {
      factorDetails.push({ factor: '疲劳评分', penalty: p, detail: `疲劳评分 ${Math.round(fatigue.score)}/100（${fatigue.status}）` });
      if (fatigue.levelKey === 'moderate' || fatigue.levelKey === 'high') {
        reasons.push(`近 7 天${fatigue.status}`);
      }
    }
  }

  // 静息心率较基线升高（恢复不足的经典信号）
  if (rhr.sufficient && rhr.delta != null) {
    if (rhr.delta >= 8) {
      deduct('静息心率', 25, `静息心率 ${rhr.latest} 较基线 ${Math.round(rhr.baseline)} 高 ${Math.round(rhr.delta)} bpm`);
    } else if (rhr.delta >= 5) {
      deduct('静息心率', 15, `静息心率 ${rhr.latest} 较基线 ${Math.round(rhr.baseline)} 高 ${Math.round(rhr.delta)} bpm`);
    }
  }

  // 昨晚睡眠（取自今天的身体日志）
  if (todayLog && !isNaN(Number(todayLog.sleep_hours))) {
    const s = Number(todayLog.sleep_hours);
    if (s < 5) deduct('睡眠', 18, `昨晚睡眠 ${s}h，严重不足`);
    else if (s < 6) deduct('睡眠', 10, `昨晚睡眠 ${s}h 偏少`);
  }

  // 膝盖状态
  if (todayLog && todayLog.knee_status === 'poor') deduct('膝盖', 18, '膝盖状态差');
  else if (todayLog && todayLog.knee_status === 'fair') deduct('膝盖', 8, '膝盖状态一般');

  // 连续训练未安排休息日
  const streak = computeConsecutiveTrainingDays(activities, refDate);
  if (streak >= 4) deduct('连续训练', 12, `已连续训练 ${streak} 天，未安排休息日`);

  score = Math.max(0, Math.round(score));

  // 档位判定
  let levelKey, label, advice;
  if (score >= 80 && acwr.risk === 'low') {
    levelKey = 'push'; label = '可加量';
    advice = '状态良好且近期负荷偏低，可以安排一次高质量训练或适度加量';
  } else if (score >= 65) {
    levelKey = 'normal'; label = '正常训练';
    advice = '身体状态支持正常训练，按计划进行即可';
  } else if (score >= 40) {
    levelKey = 'easy'; label = '轻松为主';
    advice = '建议只做低强度有氧（Z1-Z2）或技术练习，避免高强度';
  } else {
    levelKey = 'rest'; label = '建议休息';
    advice = '恢复不足，今天以休息、拉伸和充足睡眠为主';
  }

  // 急性恢复期封顶：高/极高强度活动后第 1-2 天，最高只能"轻松"
  if (recoveryPlan && (recoveryPlan.intensity.level === '极高' || recoveryPlan.intensity.level === '高') &&
      recoveryPlan.diffDays >= 1 && recoveryPlan.diffDays <= 2 &&
      (levelKey === 'normal' || levelKey === 'push')) {
    levelKey = 'easy'; label = '轻松为主';
    advice = `${recoveryPlan.intensity.level}强度活动后第 ${recoveryPlan.diffDays} 天，仍在急性恢复期，只做低强度活动`;
    reasons.unshift(advice);
  }

  if (!reasons.length) reasons.push('各项指标正常');

  return {
    score, levelKey, label, advice,
    reasons: reasons.slice(0, 3),
    factorDetails, acwr, fatigue, rhr, streak,
  };
}
