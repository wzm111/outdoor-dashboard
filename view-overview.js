/* 总览视图渲染 */
'use strict';

// ---------- 总览 ----------

function fitnessLevelText(level) {
  const map = { beginner: '入门', intermediate: '进阶', advanced: '精英' };
  return map[level] || level;
}

function toleranceText(tol, type) {
  const map = { low: type === 'cold' ? '怕冷' : '怕热', medium: '一般', high: type === 'cold' ? '耐寒' : '耐热' };
  return map[tol] || tol;
}

function issueText(issue) {
  return issueLabel(issue);
}

function recentConditionText(cond) {
  const map = { good: '状态良好', fair: '状态一般', poor: '状态欠佳', tired: '偏疲劳', injured: '有伤病' };
  return map[cond] || cond;
}

function renderProfileCard(profile) {
  if (!profile || !Object.keys(profile).length) return null;

  const level = String(profile.fitness_level || '');
  const levelClass = level === 'beginner' ? 'beginner' : level === 'advanced' ? 'advanced' : '';
  const levelText = fitnessLevelText(level) || '未设置';

  const metrics = [
    { label: '周目标', value: profile.weekly_mileage_km != null ? num(profile.weekly_mileage_km, 0) : null, unit: 'km', icon: '🎯' },
    { label: '平路配速', value: profile.typical_pace_flat, unit: '', icon: '🏃' },
    { label: '爬坡配速', value: profile.typical_pace_climb, unit: '', icon: '⛰️' },
    { label: '体重', value: profile.weight_kg != null ? num(profile.weight_kg, 1) : null, unit: 'kg', icon: '⚖️' },
    { label: '年龄', value: profile.age, unit: '岁', icon: '🎂' },
    { label: '最大心率', value: profile.usual_heart_rate_max, unit: 'bpm', icon: '❤️' },
    { label: '耐寒', value: profile.cold_tolerance ? toleranceText(profile.cold_tolerance, 'cold') : null, unit: '', icon: '🥶' },
    { label: '耐热', value: profile.heat_tolerance ? toleranceText(profile.heat_tolerance, 'heat') : null, unit: '', icon: '🥵' },
    { label: '近期状态', value: profile.recent_condition ? recentConditionText(profile.recent_condition) : null, unit: '', icon: '✨' },
  ].filter((m) => m.value != null && m.value !== '');

  const issues = Array.isArray(profile.common_issues)
    ? profile.common_issues.filter((i) => i && String(i).trim() !== '')
    : (profile.common_issues ? [profile.common_issues] : []);

  const goals = Array.isArray(profile.goals)
    ? profile.goals.filter((g) => g && String(g).trim() !== '')
    : [];

  const card = el('div', { class: 'profile-card' });

  const header = el('div', { class: 'profile-header' },
    el('div', { class: 'profile-header-main' },
      el('div', { class: 'profile-avatar' }, '⛰️'),
      el('div', { class: 'profile-title' },
        el('h3', {}, '体能档案'),
        el('div', { class: 'profile-meta-row' },
          profile.name ? el('span', { class: 'profile-name' }, profile.name) : null,
          el('span', { class: `profile-level-badge ${levelClass}` }, levelText)
        )
      )
    )
  );
  card.appendChild(header);

  if (metrics.length) {
    const grid = el('div', { class: 'profile-grid' });
    for (const m of metrics) {
      grid.appendChild(
        el('div', { class: 'profile-metric' },
          el('div', { class: 'profile-metric-label' }, m.icon, m.label),
          el('div', { class: 'profile-metric-value' }, String(m.value), m.unit ? el('span', { class: 'profile-metric-unit' }, m.unit) : null)
        )
      );
    }
    card.appendChild(grid);
  }

  if (issues.length) {
    const section = el('div', { class: 'profile-section' },
      el('div', { class: 'profile-section-title' }, '需关注'),
      el('div', { class: 'profile-issues' },
        ...issues.map((i) => el('span', { class: 'profile-issue' }, '🔔 ', issueText(i)))
      )
    );
    card.appendChild(section);
  } else if (metrics.length) {
    const section = el('div', { class: 'profile-section' },
      el('div', { class: 'profile-section-title' }, '常见不适'),
      el('div', { class: 'profile-issues' }, el('span', { class: 'profile-issue positive' }, '✅ 暂无记录'))
    );
    card.appendChild(section);
  }

  if (goals.length) {
    const section = el('div', { class: 'profile-section' },
      el('div', { class: 'profile-section-title' }, '当前目标'),
      el('div', { class: 'profile-goals' }, ...goals.map((g) => el('div', { class: 'profile-goal' }, String(g))))
    );
    card.appendChild(section);
  }

  return card;
}

function renderOverview() {
  const d = state.data;
  const acts = d.activities;
  const totalDist = acts.reduce((s, a) => s + (Number(a.distance_km) || 0), 0);
  const totalGain = acts.reduce((s, a) => s + (Number(a.elevation_gain_m) || 0), 0);
  const totalHours = acts.reduce((s, a) => s + (Number(a.duration_hours) || 0), 0);

  // 最近 30 天里程
  const now = new Date();
  const ms30 = 30 * 24 * 3600 * 1000;
  const dist30 = acts
    .filter((a) => a.date && (now - new Date(a.date)) <= ms30)
    .reduce((s, a) => s + (Number(a.distance_km) || 0), 0);

  const profile = d.profile || {};

  const view = viewEl('overview');
  clearViewKeepSkeleton(view);

  const statGrid = el('div', { class: 'stat-grid' });
  statGrid.appendChild(statCard('总活动', acts.length, '次'));
  statGrid.appendChild(statCard('累计里程', num(totalDist, 1), 'km'));
  statGrid.appendChild(statCard('近 30 天里程', num(dist30, 1), 'km'));
  statGrid.appendChild(statCard('累计爬升', num(totalGain, 0), 'm'));
  statGrid.appendChild(statCard('累计时长', num(totalHours, 1), 'h'));
  statGrid.appendChild(statCard('装备数', d.gear.length, '件'));
  view.appendChild(statGrid);

  // 档案卡片
  const profileCard = renderProfileCard(profile);
  if (profileCard) {
    view.appendChild(el('div', { class: 'section-title' }, '体能档案'));
    view.appendChild(profileCard);
  }

  // 最近活动
  view.appendChild(el('div', { class: 'section-title' }, '最近活动'));
  const recent = [...acts].sort((a, b) => {
    const dateCmp = String(b.date).localeCompare(String(a.date));
    if (dateCmp !== 0) return dateCmp;
    return (a.sequence || 0) - (b.sequence || 0);
  }).slice(0, 5);
  if (recent.length) {
    view.appendChild(activityTable(recent));
  } else {
    view.appendChild(el('div', { class: 'empty' }, '暂无活动记录'));
  }
}

function statCard(label, value, unit) {
  return el('div', { class: 'stat-card' },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, String(value), unit ? el('span', { class: 'unit' }, ' ' + unit) : null),
  );
}
