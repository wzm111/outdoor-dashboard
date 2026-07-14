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

/** 根据最近身体日志调整恢复天数 */
function adjustRecoveryDays(intensity, bodyLogs) {
  let days = intensity.recoveryDays;
  if (!bodyLogs || !bodyLogs.length) return days;

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

/** 基于最近一次高强度活动生成完整恢复计划 */
function computeRecoveryPlan(activities, bodyLogs, refDate = null) {
  const today = refDate ? new Date(refDate + 'T00:00:00') : new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const recentActivity = (activities || [])
    .filter((a) => a.date && String(a.date) <= todayStr)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];

  if (!recentActivity) return null;

  const intensity = computeRecoveryIntensity(recentActivity);
  const adjustment = adjustRecoveryDays(intensity, bodyLogs);
  const totalDays = adjustment.days;

  const activityDate = new Date(String(recentActivity.date) + 'T00:00:00');
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
