/* 装备生命周期、磨损与闲置统计 */
'use strict';

// ---------- 装备使用统计 / 磨损·闲置提醒 / AI 生命周期洞察 ----------

// 按类别的经验寿命阈值：距离(km) + 年限。与 scripts/gear-lifecycle.py CATEGORY_THRESHOLDS 对齐。
const GEAR_LIFECYCLE_THRESHOLDS = {
  shoes:        { distance_km: 600,  years: 2, name: '鞋类' },
  backpack:     { distance_km: 5000, years: 8, name: '背包' },
  jacket:       { distance_km: 3000, years: 5, name: '外套/冲锋衣' },
  pants:        { distance_km: 2000, years: 4, name: '裤子' },
  poles:        { distance_km: 2000, years: 3, name: '登山杖' },
  light:        { distance_km: 1000, years: 5, name: '照明' },
  sleeping:     { distance_km: 5000, years: 8, name: '睡眠系统' },
  sleeping_bag: { distance_km: 5000, years: 8, name: '睡袋' },
  tent:         { distance_km: 3000, years: 10, name: '帐篷' },
  socks:        { distance_km: 400,  years: 1, name: '袜子' },
  gloves:       { distance_km: 1500, years: 3, name: '手套' },
  hat:          { distance_km: 2000, years: 4, name: '帽子' },
  buff:         { distance_km: 1000, years: 3, name: '头巾/面罩' },
  hydration:    { distance_km: 2000, years: 5, name: '水具' },
  water_bottle: { distance_km: 2000, years: 5, name: '水具' },
  electronics:  { distance_km: 3000, years: 5, name: '电子产品' },
  firstaid:     { distance_km: 5000, years: 3, name: '急救包' },
  first_aid:    { distance_km: 5000, years: 3, name: '急救包' },
  cooking:      { distance_km: 3000, years: 5, name: '炊具' },
  accessory:    { distance_km: 3000, years: 5, name: '配件/其他' },
  other:        { distance_km: 3000, years: 5, name: '其他' },
};
const IDLE_WARN_DAYS = 180; // 用过但超过半年没再用 → 闲置提醒
const IDLE_REPLACE_DAYS = 365; // 超过一年未使用 → 建议淘汰

/** 计算两个日期字符串之间的天数（a 到 b）。
 *  支持 'YYYY-MM-DD' 或 ISO 字符串；非法日期返回 null。 */
function daysBetween(a, b) {
  const x = Date.parse(String(a).slice(0, 10));
  const y = Date.parse(String(b).slice(0, 10));
  if (isNaN(x) || isNaN(y)) return null;
  return Math.round((y - x) / 86400000);
}

/** 从 activities 实时计算一件装备的完整生命周期数据。
 *  返回：
 *    usage_count, total_distance_km, total_duration_hours,
 *    first_used_date, last_used_date, idle_days,
 *    threshold { distance_km, years } | null,
 *    distance_ratio, years_ratio, max_ratio, condition
 */
function computeGearLifecycle(g, activities, today) {
  const empty = {
    usage_count: 0, total_distance_km: 0, total_duration_hours: 0,
    first_used_date: null, last_used_date: null, idle_days: null,
    threshold: null, distance_ratio: 0, years_ratio: 0, max_ratio: 0,
    condition: 'excellent',
  };
  if (!g) return empty;

  const slug = g.slug;
  let usage_count = 0, total_distance_km = 0, total_duration_hours = 0;
  let first_used_date = null, last_used_date = null;

  for (const a of (activities || [])) {
    const slugs = gearSlugsOf(a);
    if (!slugs.includes(slug)) continue;
    usage_count += 1;
    const d = Number(a.distance_km);
    if (!isNaN(d) && d > 0) total_distance_km += d;
    const h = Number(a.duration_hours);
    if (!isNaN(h) && h > 0) total_duration_hours += h;
    const date = a.date;
    if (date) {
      if (!last_used_date || String(date) > String(last_used_date)) last_used_date = date;
      if (!first_used_date || String(date) < String(first_used_date)) first_used_date = date;
    }
  }

  const threshold = GEAR_LIFECYCLE_THRESHOLDS[g.category] || GEAR_LIFECYCLE_THRESHOLDS.other;
  let idle_days = null;
  if (last_used_date && today) {
    const d = daysBetween(last_used_date, today);
    if (d != null) idle_days = d;
  }

  let distance_ratio = 0, years_ratio = 0, max_ratio = 0;
  if (threshold) {
    if (threshold.distance_km > 0 && total_distance_km > 0) {
      distance_ratio = total_distance_km / threshold.distance_km;
    }
    if (threshold.years > 0 && first_used_date) {
      const daysOwned = daysBetween(first_used_date, today);
      if (daysOwned != null) years_ratio = daysOwned / (threshold.years * 365);
    }
    max_ratio = Math.max(distance_ratio, years_ratio);
  }

  const condition = computeLifecycleCondition(max_ratio, idle_days);

  return {
    usage_count, total_distance_km, total_duration_hours,
    first_used_date, last_used_date, idle_days,
    threshold, distance_ratio, years_ratio, max_ratio, condition,
  };
}

/** 根据最大磨损比 + 闲置天数评估 condition。
 *  注意：闲置不会把 condition 降到 replace 以下，仅作为 alerts 来源。 */
function computeLifecycleCondition(maxRatio, idleDays) {
  if (maxRatio >= 1.0) return 'replace';
  if (maxRatio >= 0.8) return 'poor';
  if (maxRatio >= 0.5) return 'fair';
  if (maxRatio >= 0.2) return 'good';
  return 'excellent';
}

/** 生成装备生命周期提醒列表（AI 洞察）。
 *  返回 [{ level: 'critical'|'warning'|'info', message: string }] */
function gearLifecycleAlerts(g, lifecycle) {
  const alerts = [];
  if (!g || g.condition === 'retired') return alerts;

  const t = lifecycle.threshold;

  // 磨损：里程 or 年限
  if (lifecycle.max_ratio >= 1.0) {
    const pct = Math.round(lifecycle.max_ratio * 100);
    alerts.push({ level: 'critical', message: `已达经验寿命 ${pct}%（${t ? t.name : '装备'}），建议更换` });
  } else if (lifecycle.max_ratio >= 0.8) {
    const pct = Math.round(lifecycle.max_ratio * 100);
    alerts.push({ level: 'warning', message: `接近经验寿命 ${pct}%（${t ? t.name : '装备'}），准备更换` });
  } else if (lifecycle.distance_ratio >= 0.5 || lifecycle.years_ratio >= 0.5) {
    const pct = Math.round(lifecycle.max_ratio * 100);
    alerts.push({ level: 'info', message: `已使用 ${pct}% 经验寿命，留意磨损` });
  }

  // 闲置
  if (lifecycle.idle_days != null) {
    if (lifecycle.idle_days > IDLE_REPLACE_DAYS) {
      alerts.push({ level: 'warning', message: `已闲置 ${lifecycle.idle_days} 天，建议淘汰或出二手` });
    } else if (lifecycle.idle_days > IDLE_WARN_DAYS) {
      alerts.push({ level: 'info', message: `已闲置 ${lifecycle.idle_days} 天` });
    }
  }

  // 从来没用过但有购买记录
  if (lifecycle.usage_count === 0 && (g.price || g.source_url)) {
    alerts.push({ level: 'info', message: '尚未记录使用，建议尽快实战测试' });
  }

  return alerts;
}

/** 一句 AI 风格建议。 */
function gearAiAdvice(g, lifecycle) {
  if (!g) return '';
  if (g.condition === 'retired') return '已淘汰，不再参与推荐。';

  const alerts = gearLifecycleAlerts(g, lifecycle);
  if (alerts.length) {
    const top = alerts[0];
    if (top.level === 'critical') return '⚠️ ' + top.message;
    if (top.level === 'warning') return '🔶 ' + top.message;
    return '💡 ' + top.message;
  }

  if (lifecycle.usage_count > 0 && lifecycle.last_used_date) {
    return `✅ 状态良好，最近 ${lifecycle.idle_days != null ? lifecycle.idle_days + ' 天前' : ''} 使用过`;
  }
  if (g.price) return '💡 已记录价格，点击卡片追踪历史价格';
  return '';
}

/** 计算一件装备的磨损/闲置状态（启发式，非精确）。
 *  优先基于 activities 实时计算；activities 未传入时回退到 gear 字段。
 *  返回 { level:'ok'|'warn'|'alert'|'idle', reasons:[中文], pctOfLife:0-1|null, idleDays:number|null } */
function gearWearStatus(g, today, activities) {
  const reasons = [];
  if (!g || g.condition === 'retired') return { level: 'ok', reasons, pctOfLife: null, idleDays: null };

  const lifecycle = activities ? computeGearLifecycle(g, activities, today) : null;
  const threshold = (lifecycle && lifecycle.threshold) || GEAR_LIFECYCLE_THRESHOLDS[g.category] || null;

  // 磨损
  let level = 'ok';
  let pctOfLife = null;
  const km = lifecycle ? lifecycle.total_distance_km : Number(g.total_distance_km);
  const distLimit = threshold ? threshold.distance_km : null;
  if (distLimit && !isNaN(km) && km > 0) {
    pctOfLife = km / distLimit;
    const pctTxt = Math.round(pctOfLife * 100);
    if (pctOfLife >= 1.0) {
      level = 'alert';
      reasons.push(`里程 ${num(km, 1)} / ${distLimit} km（${pctTxt}%，已达经验寿命）`);
    } else if (pctOfLife >= 0.8) {
      level = 'warn';
      reasons.push(`里程 ${num(km, 1)} / ${distLimit} km（${pctTxt}%，接近经验寿命）`);
    }
  }

  // 年限磨损（无里程或年限比更高时）
  if (lifecycle && lifecycle.years_ratio > (pctOfLife || 0)) {
    const yrPct = Math.round(lifecycle.years_ratio * 100);
    if (lifecycle.years_ratio >= 1.0) {
      level = 'alert';
      reasons.push(`已使用 ${yrPct}% 经验年限，建议更换`);
      pctOfLife = lifecycle.years_ratio;
    } else if (lifecycle.years_ratio >= 0.8) {
      level = 'warn';
      reasons.push(`已使用 ${yrPct}% 经验年限，接近更换期`);
      if (pctOfLife == null) pctOfLife = lifecycle.years_ratio;
    }
  }

  // 闲置
  let idleDays = null;
  const usage = lifecycle ? lifecycle.usage_count : (Number(g.usage_count) || 0);
  const lastUsed = lifecycle ? lifecycle.last_used_date : g.last_used_date;
  if (usage > 0 && lastUsed && today) {
    const d = daysBetween(lastUsed, today);
    if (d != null && d > IDLE_WARN_DAYS) {
      idleDays = d;
      reasons.push(`已 ${d} 天未使用`);
      if (level === 'ok') level = 'idle';
    }
  }

  return { level, reasons, pctOfLife, idleDays };
}

/** 旧的 GEAR_KM_LIFESPAN 兼容别名，避免其他代码引用报错（已合并到 GEAR_LIFECYCLE_THRESHOLDS）。 */
const GEAR_KM_LIFESPAN = {};
for (const [k, v] of Object.entries(GEAR_LIFECYCLE_THRESHOLDS)) {
  if (v.distance_km) GEAR_KM_LIFESPAN[k] = v.distance_km;
}

/** 把装备数据渲染成只读键值列表。 */
function gearFactList(g) {
  const facts = [
    ['slug', g.slug],
    ['名称', g.name],
    ['类别', g.category],
    ['类型', g.type],
    ['品牌', g.brand],
    ['型号', g.model],
    ['重量', g.weight_g != null ? num(g.weight_g, 0) + ' g' : null],
    ['防水', g.waterproof === true ? '是' : g.waterproof === false ? '否' : null],
    ['透气', g.breathable === true ? '是' : g.breathable === false ? '否' : null],
    ['材质', g.material],
    ['保暖', g.warmth],
    ['季节', Array.isArray(g.seasons) ? g.seasons.join('、') : g.seasons],
    ['地形', Array.isArray(g.terrain) ? g.terrain.join('、') : g.terrain],
    ['使用次数', g.usage_count],
    ['状态', g.condition],
    ['价格', g.price != null ? '¥' + num(g.price, 0) : null],
    ['颜色', g.color],
    ['尺码', g.size],
    ['备注', g.notes],
    ['商品链接', g.source_url],
  ].filter(([, v]) => v != null && v !== '');

  const list = el('ul', { class: 'detail-list' });
  for (const [k, v] of facts) {
    const li = el('li', {}, el('strong', {}, k + '：'));
    if (k === '商品链接' && String(v).startsWith('http')) {
      li.appendChild(el('a', { href: v, target: '_blank', rel: 'noopener' }, v));
    } else {
      li.appendChild(document.createTextNode(v));
    }
    list.appendChild(li);
  }
  return list;
}
