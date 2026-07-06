/* 身体年龄 / 体能年龄估算
 * 注意：本指标为基于运动与恢复数据的参考估算，不是医学诊断。
 */
'use strict';

// ---------- 常量（与 scripts/body-age.py 保持一致） ----------

const BA_FITNESS_LEVEL_RHR = { beginner: 70, intermediate: 62, advanced: 52 };
const BA_ACTIVITY_TYPE_FACTORS = {
  running: 1.0,
  trail_running: 1.1,
  hiking: 0.8,
  climbing: 1.2,
  walking: 0.6,
};
const BA_FELT_MULTIPLIERS = { easy: 0.7, moderate: 1.0, hard: 1.3, extreme: 1.6 };

function baClamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function baParseDate(d) {
  if (!d) return null;
  const s = String(d).slice(0, 10);
  const dt = new Date(s + 'T00:00:00');
  if (isNaN(dt.getTime())) return null;
  return dt;
}

function baDateStr(dt) {
  return dt.toISOString().slice(0, 10);
}

function baAvg(values) {
  const numeric = values
    .map((v) => (v == null || v === '' ? NaN : Number(v)))
    .filter((n) => !isNaN(n));
  return numeric.length ? numeric.reduce((a, b) => a + b, 0) / numeric.length : 0;
}

function baDaysBetween(a, b) {
  const msPerDay = 24 * 3600 * 1000;
  return Math.round((b - a) / msPerDay);
}

// ---------- 训练指标 ----------

function baEstimateTssWithoutHr(activity) {
  const distance = Number(activity.distance_km) || 0;
  const elevation = Number(activity.elevation_gain_m) || 0;
  const duration = Number(activity.duration_hours) || 0;
  const type = activity.type || 'hiking';

  let base = 0;
  if (type === 'running' || type === 'trail_running') base = distance * 8;
  else if (type === 'hiking') base = distance * 5 + elevation * 0.1;
  else if (type === 'climbing') base = duration * 15;
  else base = distance * 5;

  const felt = activity.felt || 'moderate';
  const multiplier = BA_FELT_MULTIPLIERS[felt] || 1.0;
  return Math.round(base * multiplier * 10) / 10;
}

function baCalculateTss(activity, profile) {
  const avgHr = Number(activity.avg_hr);
  const durationHours = Number(activity.duration_hours);

  if (!avgHr || !durationHours) {
    return baEstimateTssWithoutHr(activity);
  }

  const maxHr = Number(profile.usual_heart_rate_max) || 185;
  const restingHr = Number(profile.resting_heart_rate) || 60;
  const hrReserve = Math.max(1, maxHr - restingHr);

  const type = activity.type || 'hiking';
  const intensity = BA_ACTIVITY_TYPE_FACTORS[type] || 0.8;

  let ratio = (avgHr - restingHr) / hrReserve;
  ratio = Math.max(0.1, Math.min(1.0, ratio));

  const durationMinutes = durationHours * 60;
  return Math.round(durationMinutes * ratio * intensity * 10) / 10;
}

function baCalculateCtlAtlTsb(dailyTss, endDate) {
  const dates = Object.keys(dailyTss).sort();
  if (!dates.length) return {};

  const start = baParseDate(dates[0]);
  const end = endDate || baParseDate(dates[dates.length - 1]);

  let ctl = 0;
  let atl = 0;
  const ctlDecay = 1 - 1 / 42;
  const atlDecay = 1 - 1 / 7;
  const ctlGain = 1 / 42;
  const atlGain = 1 / 7;

  const metrics = {};
  const current = new Date(start);
  while (current <= end) {
    const ds = baDateStr(current);
    const tss = dailyTss[ds] || 0;
    ctl = ctl * ctlDecay + tss * ctlGain;
    atl = atl * atlDecay + tss * atlGain;
    metrics[ds] = {
      tss: Math.round(tss * 10) / 10,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round((ctl - atl) * 10) / 10,
    };
    current.setDate(current.getDate() + 1);
  }

  return metrics;
}

function baLatestTrainingMetrics(activities, profile, today) {
  if (!activities || activities.length === 0) return null;

  const dailyTss = {};
  for (const a of activities) {
    const activityDate = baParseDate(a.date);
    if (!activityDate) continue;
    const ds = baDateStr(activityDate);
    dailyTss[ds] = (dailyTss[ds] || 0) + baCalculateTss(a, profile);
  }

  const metrics = baCalculateCtlAtlTsb(dailyTss, today);
  const dates = Object.keys(metrics);
  if (!dates.length) return null;

  const latestDate = dates[dates.length - 1];
  return metrics[latestDate];
}

// ---------- ACWR ----------

function baCalculateWeeklyLoad(activities, endDate) {
  const weekly = {};
  for (const a of activities) {
    const activityDate = baParseDate(a.date);
    if (!activityDate) continue;
    const monday = new Date(activityDate);
    monday.setDate(monday.getDate() - monday.getDay());
    const weekKey = baDateStr(monday);
    weekly[weekKey] = (weekly[weekKey] || 0) + (Number(a.distance_km) || 0);
  }
  return weekly;
}

function baCalculateAcwr(activities, today) {
  if (!activities || activities.length === 0) return { ratio: 0, risk: 'unknown' };

  const weekly = baCalculateWeeklyLoad(activities, today);
  const weeks = Object.keys(weekly).sort().reverse();
  if (weeks.length < 2) return { ratio: 0, risk: 'unknown' };

  const acuteLoad = weekly[weeks[0]];
  const chronicWeeks = weeks.slice(1, 5);
  const chronicLoad = chronicWeeks.reduce((s, w) => s + weekly[w], 0) / chronicWeeks.length;

  if (chronicLoad === 0) return { ratio: 0, risk: 'unknown' };

  const ratio = acuteLoad / chronicLoad;
  let risk = 'low';
  if (ratio > 1.5) risk = 'danger';
  else if (ratio > 1.3) risk = 'warning';
  else if (ratio >= 0.8) risk = 'optimal';

  return { ratio: Math.round(ratio * 100) / 100, risk };
}

// ---------- 身体年龄核心算法 ----------

function computeBodyAge(profile, activities, bodyLogs, today) {
  today = today ? baParseDate(today) : new Date();
  profile = profile || {};
  activities = activities || [];
  bodyLogs = bodyLogs || [];

  const age = Number(profile.age);
  if (!age) {
    return {
      body_age: null,
      delta: null,
      confidence: 'low',
      missing_fields: ['age'],
      breakdown: null,
      explanation: '缺少实际年龄，无法估算身体年龄。',
      chronological_age: null,
    };
  }

  const missingFields = [];

  // 静息心率
  let restingHr = Number(profile.resting_heart_rate);
  if (!restingHr) {
    const level = profile.fitness_level || 'intermediate';
    restingHr = BA_FITNESS_LEVEL_RHR[level] || 62;
    missingFields.push('resting_heart_rate');
  }

  // 最大心率
  let maxHr = Number(profile.usual_heart_rate_max);
  const hasMeasuredMaxHr = Boolean(maxHr);
  if (!hasMeasuredMaxHr) {
    maxHr = 220 - age;
  }

  // 体重：优先最近 30 天身体日志
  let recentWeight = null;
  if (bodyLogs.length) {
    const weights = bodyLogs.map((log) => log.weight_kg).filter((v) => v != null && v !== '');
    if (weights.length) recentWeight = baAvg(weights);
  }
  const weightKg = recentWeight || Number(profile.weight_kg) || 0;

  const heightCm = Number(profile.height_cm) || 0;
  if (!heightCm) missingFields.push('height_cm');

  const fitnessLevel = profile.fitness_level || 'intermediate';
  const recentCondition = profile.recent_condition || 'good';
  let commonIssues = Array.isArray(profile.common_issues)
    ? profile.common_issues
    : (profile.common_issues ? [profile.common_issues] : []);
  commonIssues = commonIssues.filter(Boolean);

  // 心肺偏移
  const baselineRhr = 62 + Math.max(0, age - 30) * 0.25;
  const rhrOffset = baClamp((restingHr - baselineRhr) * 0.4, -8, 8);

  let cardioOffset = rhrOffset;
  if (hasMeasuredMaxHr && maxHr > restingHr) {
    const vo2Proxy = 15 * (maxHr / restingHr);
    const expectedVo2 = baClamp(48 - 0.4 * (age - 30), 25, 55);
    const vo2Offset = baClamp((expectedVo2 - vo2Proxy) * 0.5, -8, 8);
    cardioOffset = (rhrOffset + vo2Offset) / 2;
  } else if (!hasMeasuredMaxHr) {
    missingFields.push('usual_heart_rate_max');
  }

  // 训练偏移
  const metrics = baLatestTrainingMetrics(activities, profile, today);
  let trainingOffset;
  if (metrics) {
    const ctl = metrics.ctl;
    const tsb = metrics.tsb;
    const ctlRef = Math.max(10, 25 - Math.max(0, age - 40) * 0.2);
    trainingOffset = -(ctl - ctlRef) / 5;

    if (tsb < -30) trainingOffset += 4;
    else if (tsb > 25) trainingOffset -= 1;

    const acwr = baCalculateAcwr(activities, today);
    if (acwr.risk === 'danger') trainingOffset += 2;

    trainingOffset = baClamp(trainingOffset, -8, 6);
  } else {
    const levelOffset = { advanced: -2, intermediate: -1, beginner: 0 }[fitnessLevel] || -1;
    trainingOffset = levelOffset;
    missingFields.push('activities');
  }

  // 恢复偏移
  const recentLogs = bodyLogs.filter((log) => {
    const logDate = baParseDate(log.date);
    return logDate && baDaysBetween(logDate, today) <= 7;
  });

  let recoveryOffset;
  if (recentLogs.length) {
    const avgFatigue = baAvg(recentLogs.map((log) => log.fatigue));
    const avgSoreness = baAvg(recentLogs.map((log) => log.muscle_soreness));
    const avgSleep = baAvg(recentLogs.map((log) => log.sleep_hours));

    let fatigueScore = Math.min(avgFatigue * 8, 60) + Math.min(avgSoreness * 4, 30);
    if (avgSleep < 6) fatigueScore += Math.min((6 - avgSleep) * 5, 10);

    recoveryOffset = baClamp(fatigueScore / 12, 0, 8);

    if (avgSleep < 5.5) recoveryOffset += 1.5;
    if (avgSleep >= 7.5 && fatigueScore < 30) recoveryOffset -= 1;
    if (recentCondition === 'injured') recoveryOffset += 2;
    else if (recentCondition === 'tired') recoveryOffset += 1;
    else if (recentCondition === 'good') recoveryOffset -= 0.5;

    recoveryOffset += Math.min(commonIssues.length * 0.5, 3);
    recoveryOffset = baClamp(recoveryOffset, -2, 10);
  } else {
    recoveryOffset = 0.5;
    missingFields.push('body_logs');
  }

  // 身体成分偏移
  let bodycompOffset = 0;
  if (weightKg && heightCm) {
    const heightM = heightCm / 100;
    const bmi = weightKg / (heightM * heightM);
    if (bmi > 25) bodycompOffset = (bmi - 25) * 0.5;
    else if (bmi < 18.5) bodycompOffset = (18.5 - bmi) * 0.5;
    bodycompOffset = baClamp(bodycompOffset, 0, 5);
  } else if (!weightKg) {
    missingFields.push('weight_kg');
  }

  // 汇总
  const bodyAgeRaw = age + cardioOffset + trainingOffset + recoveryOffset + bodycompOffset;
  const minAge = Math.max(12, age - 15);
  const maxAge = age + 15;
  const bodyAge = Math.round(baClamp(bodyAgeRaw, minAge, maxAge));
  const delta = bodyAge - age;

  const breakdown = {
    cardio: Math.round(cardioOffset * 10) / 10,
    training: Math.round(trainingOffset * 10) / 10,
    recovery: Math.round(recoveryOffset * 10) / 10,
    bodycomp: Math.round(bodycompOffset * 10) / 10,
  };

  // 置信度
  const uniqueMissing = Array.from(new Set(missingFields)).sort();
  const hasRhr = !uniqueMissing.includes('resting_heart_rate');
  const hasActs = !uniqueMissing.includes('activities');
  const hasLogs = !uniqueMissing.includes('body_logs');

  let confidence;
  if (hasRhr && hasActs && hasLogs && activities.length >= 5 && recentLogs.length >= 3) {
    confidence = 'high';
  } else if ((hasRhr || hasActs || hasLogs) && age) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // 解释文案
  const parts = [];
  if (cardioOffset < -1) parts.push(`心肺功能让身体年龄年轻约 ${Math.abs(Math.round(cardioOffset * 10) / 10)} 岁`);
  else if (cardioOffset > 1) parts.push(`心肺指标让身体年龄增加约 ${Math.round(cardioOffset * 10) / 10} 岁`);

  if (trainingOffset < -1) parts.push(`训练负荷让身体年龄年轻约 ${Math.abs(Math.round(trainingOffset * 10) / 10)} 岁`);
  else if (trainingOffset > 1) parts.push(`训练负荷让身体年龄增加约 ${Math.round(trainingOffset * 10) / 10} 岁`);

  if (recoveryOffset > 1) parts.push(`近期疲劳/恢复让身体年龄增加约 ${Math.round(recoveryOffset * 10) / 10} 岁`);
  else if (recoveryOffset < -1) parts.push(`恢复状态良好让身体年龄年轻约 ${Math.abs(Math.round(recoveryOffset * 10) / 10)} 岁`);

  if (bodycompOffset > 0.5) parts.push(`BMI 偏离理想区间让身体年龄增加约 ${Math.round(bodycompOffset * 10) / 10} 岁`);

  const explanation = parts.length ? parts.join('；') + '。' : '各项指标接近同龄人平均水平。';

  return {
    body_age: bodyAge,
    delta: delta,
    confidence: confidence,
    missing_fields: uniqueMissing,
    breakdown: breakdown,
    explanation: explanation,
    chronological_age: age,
  };
}

// ---------- 详情弹窗 ----------

function openBodyAgeDetail(result) {
  if (!result || result.body_age == null) return;

  const age = result.chronological_age;
  const bodyAge = result.body_age;
  const delta = result.delta;
  const bd = result.breakdown || {};

  const confidenceText = { high: '高', medium: '中', low: '估算中' }[result.confidence] || result.confidence;
  const deltaClass = delta < 0 ? 'positive' : delta > 0 ? 'negative' : '';
  const deltaText = delta === 0 ? '与实际年龄一致' : delta < 0 ? `比实际年龄年轻 ${Math.abs(delta)} 岁` : `比实际年龄增加 ${delta} 岁`;

  const content = el('div', { class: 'body-age-detail' },
    el('div', { class: 'body-age-detail-header' },
      el('div', { class: 'body-age-detail-main' },
        el('div', { class: 'body-age-detail-number' }, `${bodyAge} 岁`),
        el('div', { class: `body-age-detail-delta ${deltaClass}` }, deltaText)
      ),
      el('div', { class: 'body-age-detail-meta' },
        el('div', {}, `实际年龄：${age} 岁`),
        el('div', {}, `置信度：${confidenceText}`)
      )
    ),
    el('div', { class: 'body-age-detail-section' },
      el('h4', {}, '分项影响'),
      el('table', { class: 'body-age-detail-table' },
        el('thead', {}, el('tr', {}, el('th', {}, '维度'), el('th', {}, '偏移'), el('th', {}, '说明'))),
        el('tbody', {},
          el('tr', {}, el('td', {}, '心肺功能'), el('td', {}, `${bd.cardio > 0 ? '+' : ''}${bd.cardio} 岁`), el('td', {}, '基于静息心率与心率储备')),
          el('tr', {}, el('td', {}, '训练负荷'), el('td', {}, `${bd.training > 0 ? '+' : ''}${bd.training} 岁`), el('td', {}, '基于 CTL / TSB / ACWR')),
          el('tr', {}, el('td', {}, '恢复状态'), el('td', {}, `${bd.recovery > 0 ? '+' : ''}${bd.recovery} 岁`), el('td', {}, '基于睡眠、疲劳、酸痛、伤病')),
          el('tr', {}, el('td', {}, '身体成分'), el('td', {}, `${bd.bodycomp > 0 ? '+' : ''}${bd.bodycomp} 岁`), el('td', {}, '基于 BMI（如提供身高）'))
        )
      )
    ),
    el('div', { class: 'body-age-detail-section' },
      el('h4', {}, '综合解读'),
      el('p', {}, result.explanation)
    ),
    result.missing_fields && result.missing_fields.length ?
      el('div', { class: 'body-age-detail-section body-age-detail-missing' },
        el('h4', {}, '可提高准确度的数据'),
        el('ul', {}, ...result.missing_fields.map((field) => {
          const desc = {
            resting_heart_rate: '晨起静息心率（体能档案）',
            usual_heart_rate_max: '实测最大心率（体能档案）',
            height_cm: '身高（体能档案）',
            weight_kg: '体重（身体日志或体能档案）',
            activities: '更多活动记录',
            body_logs: '更多身体状态记录',
          }[field] || field;
          return el('li', {}, desc);
        }))
      ) : null,
    el('div', { class: 'body-age-detail-note' }, '⚠️ 本指标为参考估算，不是医学诊断。')
  );

  showModal('身体年龄是怎么算出来的？', content);
}
