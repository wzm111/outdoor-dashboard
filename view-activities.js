/* 活动视图渲染 — 按运动类型展示专业字段 */
'use strict';

// ---------- 运动类型归类 ----------

function activitySport(type) {
  const t = String(type || '').toLowerCase();
  if (/run|跑步|配速/.test(t)) return 'running';
  if (/hike|hiking|徒步|爬山|登山|trail/.test(t)) return 'hiking';
  if (/climb|攀岩|抱石|boulder/.test(t)) return 'climbing';
  if (/cycl|骑行|骑车/.test(t)) return 'cycling';
  return 'other';
}

// 兼容旧名
function activityTypeGroup(type) { return activitySport(type); }

function sportLabel(sport) {
  return {
    running: '跑步',
    hiking: '徒步/登山',
    climbing: '攀岩/抱石',
    cycling: '骑行',
    other: '其他',
  }[sport] || '其他';
}

function disciplineLabel(d) {
  return {
    bouldering: '抱石',
    sport: '运动攀',
    trad: '传统攀',
    multipitch: '多段',
    ice: '攀冰',
  }[d] || d || '—';
}

function sendTypeLabel(s) {
  return {
    onsight: 'Onsight',
    flash: 'Flash',
    redpoint: 'Redpoint',
    toprope: '顶绳',
  }[s] || s || '—';
}

function cyclingTypeLabel(t) {
  return {
    road: '公路',
    mtb: '山地',
    gravel: 'Gravel',
    cyclocross: 'CX',
    track: '场地',
  }[t] || t || '—';
}

function loadTypeLabel(t) {
  return { heavy: '重装', light: '轻装', ultralight: '超轻' }[t] || t || '—';
}

/** 计算徒步活动天数：无 end_date 为 1 天；跨日期为包含首尾的天数。 */
function hikingDays(start, end) {
  if (!start) return 1;
  if (!end || end === start) return 1;
  const s = new Date(String(start).slice(0, 10));
  const e = new Date(String(end).slice(0, 10));
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return 1;
  const ms = e.getTime() - s.getTime();
  const days = Math.round(ms / 86400000) + 1;
  return days > 1 ? days : 1;
}

// ---------- 表格单元格辅助 ----------

function td(content, cls) {
  const node = el('td', cls ? { class: cls } : {});
  if (content == null || content === '') node.textContent = '—';
  else if (typeof content === 'string' || typeof content === 'number') node.textContent = String(content);
  else node.appendChild(content);
  return node;
}

function gearCell(a) {
  const count = gearSlugsOf(a).length;
  return count ? el('span', { class: 'gear-count-badge' }, `装备 ${count}`) : '—';
}

// ---------- 各运动专业列配置 ----------

const SPORT_TABLE_COLUMNS = {
  running: {
    headers: ['日期', '路线/备注', '距离', '时长', '配速', '平均心率', '步频', '感受', '装备'],
    cells: (a) => {
      const routeText = a.notes || a.route || '—';
      return [
        td(fmtDate(a.date)),
        td(routeText, 'col-location'),
        td(num(a.distance_km, 2) + ' km', 'num'),
        td(fmtDuration(a.duration_hours), 'num'),
        td(paceMinPerKm(a.distance_km, a.duration_hours) || '—', 'num'),
        td(a.avg_hr ? num(a.avg_hr, 0) : '—', 'num'),
        td(a.cadence ? num(a.cadence, 0) : '—', 'num'),
        td(feltStars(a.felt)),
        td(gearCell(a), 'num'),
      ];
    },
  },
  hiking: {
    headers: ['日期', '路线', '距离', '爬升', '下降', '最高海拔', '路况', '负重', '天数', '感受', '装备'],
    cells: (a) => {
      const routeText = (a.route || '—') + (a.sequence > 0 ? ` #${Number(a.sequence) + 1}` : '');
      const days = hikingDays(a.date, a.end_date);
      const daysText = days > 1 ? `${days} 天` : '1 天';
      const dateText = a.end_date ? `${fmtDate(a.date)} ~ ${fmtDate(a.end_date)}` : fmtDate(a.date);
      return [
        td(dateText),
        td(routeText, 'col-location'),
        td(num(a.distance_km, 1) + ' km', 'num'),
        td(num(a.elevation_gain_m, 0) + ' m', 'num'),
        td(num(a.elevation_loss_m, 0) + ' m', 'num'),
        td(a.max_altitude_m ? num(a.max_altitude_m, 0) + ' m' : '—', 'num'),
        td(a.trail_condition || '—'),
        td(loadTypeLabel(a.load_type)),
        td(daysText, 'num'),
        td(feltStars(a.felt)),
        td(gearCell(a), 'num'),
      ];
    },
  },
  climbing: {
    headers: ['日期', '岩场/路线', '类型', '难度', '线路数', '完攀方式', '时长', '感受', '装备'],
    cells: (a) => {
      const routeText = (a.route || '—') + (a.sequence > 0 ? ` #${Number(a.sequence) + 1}` : '');
      return [
        td(fmtDate(a.date)),
        td(routeText, 'col-location'),
        td(disciplineLabel(a.discipline)),
        td(a.grade || '—', 'num'),
        td(a.problems_count != null ? num(a.problems_count, 0) : '—', 'num'),
        td(sendTypeLabel(a.send_type)),
        td(num(a.duration_hours, 2) + ' h', 'num'),
        td(feltStars(a.felt)),
        td(gearCell(a), 'num'),
      ];
    },
  },
  cycling: {
    headers: ['日期', '路线', '类型', '距离', '爬升', '均速', '平均功率', '时长', '感受', '装备'],
    cells: (a) => {
      const routeText = (a.route || '—') + (a.sequence > 0 ? ` #${Number(a.sequence) + 1}` : '');
      const speed = a.avg_speed_kmh != null ? a.avg_speed_kmh : avgSpeedKmh(a.distance_km, a.duration_hours);
      return [
        td(fmtDate(a.date)),
        td(routeText, 'col-location'),
        td(cyclingTypeLabel(a.cycling_type)),
        td(num(a.distance_km, 1) + ' km', 'num'),
        td(num(a.elevation_gain_m, 0) + ' m', 'num'),
        td(speed != null ? num(speed, 1) + ' km/h' : '—', 'num'),
        td(a.power_avg_w ? num(a.power_avg_w, 0) + ' W' : '—', 'num'),
        td(num(a.duration_hours, 2) + ' h', 'num'),
        td(feltStars(a.felt)),
        td(gearCell(a), 'num'),
      ];
    },
  },
  other: {
    headers: ['日期', '路线', '类型', '距离', '时长', '平均心率', '感受', '装备'],
    cells: (a) => {
      const routeText = (a.route || '—') + (a.sequence > 0 ? ` #${Number(a.sequence) + 1}` : '');
      return [
        td(fmtDate(a.date)),
        td(routeText, 'col-location'),
        td(a.type || '—'),
        td(num(a.distance_km, 1) + ' km', 'num'),
        td(num(a.duration_hours, 2) + ' h', 'num'),
        td(a.avg_hr ? num(a.avg_hr, 0) : '—', 'num'),
        td(feltStars(a.felt)),
        td(gearCell(a), 'num'),
      ];
    },
  },
};

// ---------- 活动表格 ----------

function activityTable(acts, sport) {
  const cfg = SPORT_TABLE_COLUMNS[sport] || SPORT_TABLE_COLUMNS.other;
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  const headerCells = cfg.headers.map((h) => el('th', {}, h));
  headerCells.push(el('th', {}, '操作'));
  table.appendChild(el('thead', {}, el('tr', {}, ...headerCells)));

  const tbody = el('tbody');
  const gearMap = new Map((state.data.gear || []).map((g) => [g.slug, g]));
  for (const a of acts) {
    const cells = cfg.cells(a);

    const editBtn = el('button', { class: 'btn-sm' }, '编辑');
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openAddActivity(a); });
    const delBtn = el('button', { class: 'btn-sm btn-danger-outline' }, '删除');
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const routeLabel = (a.route || '活动') + (a.sequence > 0 ? ` #${Number(a.sequence) + 1}` : '');
      if (!confirm(`确定删除 ${fmtDate(a.date)} · ${routeLabel} 吗？此操作不可恢复。`)) return;
      try {
        await fetchDelete(state.apiUrl, state.token, 'activities', a.id);
        toast('已删除', 'success');
        await loadAndRender(true);
      } catch (err) {
        toast(err.message || '删除失败', 'error');
      }
    });
    cells.push(el('td', { class: 'actions' }, editBtn, delBtn));

    const tr = el('tr', { class: 'activity-row', title: '点击查看本次装备' }, ...cells);
    tr.addEventListener('click', () => openActivityGear(a, gearMap));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function feltStars(felt) {
  const map = { easy: 1, moderate: 2, hard: 3, 'very hard': 4, extreme: 5 };
  const n = map[String(felt || '').toLowerCase().trim()] || 0;
  if (!n) return '—';
  const filled = '★'.repeat(n);
  const empty = '☆'.repeat(5 - n);
  return el('span', { class: 'stars', title: felt }, filled + empty);
}

/** 活动 → 装备：弹窗列出本次活动用过的装备，可点进装备详情。 */
function openActivityGear(activity, gearMap) {
  const map = gearMap || new Map((state.data.gear || []).map((g) => [g.slug, g]));
  let working = gearSlugsOf(activity);
  const wrap = el('div', {});

  const meta = [
    activity.type,
    activity.distance_km != null ? num(activity.distance_km) + ' km' : null,
    activity.elevation_gain_m != null ? num(activity.elevation_gain_m, 0) + ' m 爬升' : null,
  ].filter(Boolean).join(' · ');
  if (meta) wrap.appendChild(el('div', { class: 'rel-summary' }, meta));

  const editArea = el('div', {});
  wrap.appendChild(editArea);

  let saveBtn = null;
  const origSlugs = gearSlugsOf(activity);
  const dirty = () => working.length !== origSlugs.length || working.some((s, i) => s !== origSlugs[i]);

  function rebuild() {
    editArea.innerHTML = '';

    if (!working.length) {
      editArea.appendChild(el('div', { class: 'empty' }, '本次活动未记录装备，可在下方添加'));
    } else {
      const list = el('div', { class: 'rel-list' });
      let totalWeight = 0, weighed = 0;
      working.forEach((slug) => {
        const g = map.get(slug);
        if (g && g.weight_g != null && !isNaN(Number(g.weight_g))) { totalWeight += Number(g.weight_g); weighed += 1; }
        const item = el('div', { class: 'rel-item gear-edit-row' + (g ? '' : ' rel-item-missing') });
        const info = el('div', { class: 'rel-info' });
        if (g) {
          info.appendChild(el('div', { class: 'rel-name' }, g.name || g.slug));
          info.appendChild(el('div', { class: 'rel-brief' },
            [g.brand, g.weight_g != null ? num(g.weight_g, 0) + ' g' : null, categoryLabel(g.category || '未分类')]
              .filter(Boolean).join(' · ') || '—'));
        } else {
          info.appendChild(el('div', { class: 'rel-name' }, '未知装备'));
          info.appendChild(el('div', { class: 'rel-brief' }, slug + '（装备库中未找到）'));
        }
        item.appendChild(info);
        const actions = el('div', { class: 'gear-edit-actions' });
        if (g) {
          const detailBtn = el('button', { class: 'btn-sm' }, '详情');
          detailBtn.addEventListener('click', () => openGearDetail(g));
          actions.appendChild(detailBtn);
        }
        const rmBtn = el('button', { class: 'btn-sm btn-danger-outline' }, '✕ 移除');
        rmBtn.addEventListener('click', () => { working = working.filter((s) => s !== slug); rebuild(); });
        actions.appendChild(rmBtn);
        item.appendChild(actions);
        list.appendChild(item);
      });
      editArea.appendChild(list);

      const summaryText = weighed
        ? `本次共 ${working.length} 件，其中 ${weighed} 件有重量，合计约 ${num(totalWeight, 0)} g`
        : `本次共 ${working.length} 件`;
      editArea.appendChild(el('div', { class: 'rel-summary rel-summary-total' }, summaryText));
    }

    const addable = (state.data.gear || [])
      .filter((g) => g.condition !== 'retired' && !working.includes(g.slug));
    const addRow = el('div', { class: 'gear-add-row' });
    if (addable.length) {
      const sel = el('select', { class: 'gear-select' });
      sel.appendChild(el('option', { value: '' }, '+ 添加装备…'));
      const byCat = new Map();
      addable.forEach((g) => {
        const c = g.category || '未分类';
        if (!byCat.has(c)) byCat.set(c, []);
        byCat.get(c).push(g);
      });
      Array.from(byCat.keys()).sort().forEach((cat) => {
        const og = el('optgroup', { label: categoryLabel(cat) });
        byCat.get(cat)
          .sort((a, b) => String(a.name || a.slug).localeCompare(String(b.name || b.slug)))
          .forEach((g) => og.appendChild(el('option', { value: g.slug },
            (g.name || g.slug) + (g.weight_g != null ? ` · ${num(g.weight_g, 0)}g` : ''))));
        sel.appendChild(og);
      });
      sel.addEventListener('change', () => {
        const v = sel.value;
        if (v && !working.includes(v)) { working = working.concat([v]); rebuild(); }
      });
      addRow.appendChild(sel);
    } else {
      addRow.appendChild(el('div', { class: 'rel-brief' }, '装备库中已无更多可添加的在用装备'));
    }
    editArea.appendChild(addRow);

    if (saveBtn) {
      saveBtn.disabled = !dirty();
      saveBtn.textContent = dirty() ? '保存' : '未修改';
    }
  }

  saveBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, '保存');
  const closeBtn = el('button', { class: 'btn' }, '关闭');
  const close = showModal(`${fmtDate(activity.date)} · ${activity.route || '活动'} 的装备`, wrap, [saveBtn, closeBtn]);
  saveBtn.addEventListener('click', async () => {
    if (!dirty()) { close(); return; }
    await saveActivityGear();
  });

  async function saveActivityGear() {
    if (!state.token) { toast('未连接，无法保存', 'error'); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      const cleanSlugs = working.slice();
      const data = packActivityData(activity, cleanSlugs);
      const rawRes = replaceGearUsedInMarkdown(activity._raw_markdown || '', cleanSlugs);
      const payload = {
        date: activity.date,
        route: activity.route,
        sequence: activity.sequence ?? 0,
        data,
        raw_markdown: rawRes.text,
      };
      await fetchSaveActivity(state.apiUrl, state.token, payload);
      activity.gear_used = cleanSlugs.slice();
      activity._raw_markdown = rawRes.text;
      toast('已更新本次活动的装备', 'info');
      close();
      if (typeof renderActivities === 'function') renderActivities();
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
    }
  }

  rebuild();
}

function buildActivityMarkdown(data) {
  const lines = ['---'];
  lines.push(`date: "${data.date}"`);
  lines.push(`route: "${data.route}"`);
  lines.push(`type: ${data.type}`);
  lines.push(`distance_km: ${data.distance_km}`);
  if (data.elevation_gain_m != null && data.elevation_gain_m !== '') lines.push(`elevation_gain_m: ${data.elevation_gain_m}`);
  if (data.elevation_loss_m != null && data.elevation_loss_m !== '') lines.push(`elevation_loss_m: ${data.elevation_loss_m}`);
  if (data.duration_hours != null && data.duration_hours !== '') lines.push(`duration_hours: ${data.duration_hours}`);
  if (data.avg_hr) lines.push(`avg_hr: ${data.avg_hr}`);
  if (data.max_hr) lines.push(`max_hr: ${data.max_hr}`);
  if (data.weather) lines.push(`weather: "${data.weather}"`);
  const gearUsed = Array.isArray(data.gear_used) && data.gear_used.length ? data.gear_used : [];
  lines.push(serializeGearUsedBlock(gearUsed));

  // 跑步专项
  if (data.avg_pace) lines.push(`avg_pace: "${data.avg_pace}"`);
  if (data.cadence != null && data.cadence !== '') lines.push(`cadence: ${data.cadence}`);
  if (data.stride_length_m != null && data.stride_length_m !== '') lines.push(`stride_length_m: ${data.stride_length_m}`);

  // 徒步专项
  if (data.end_date) lines.push(`end_date: "${data.end_date}"`);
  if (data.max_altitude_m != null && data.max_altitude_m !== '') lines.push(`max_altitude_m: ${data.max_altitude_m}`);
  if (Array.isArray(data.terrain) && data.terrain.length) lines.push(`terrain: [${data.terrain.map((x) => `"${x}"`).join(', ')}]`);
  if (data.trail_condition) lines.push(`trail_condition: "${data.trail_condition}"`);
  if (data.load_type) lines.push(`load_type: "${data.load_type}"`);

  // 攀岩专项
  if (data.discipline) lines.push(`discipline: "${data.discipline}"`);
  if (data.grade) lines.push(`grade: "${data.grade}"`);
  if (data.send_type) lines.push(`send_type: "${data.send_type}"`);
  if (data.problems_count != null && data.problems_count !== '') lines.push(`problems_count: ${data.problems_count}`);
  if (data.attempts != null && data.attempts !== '') lines.push(`attempts: ${data.attempts}`);

  // 骑行专项
  if (data.cycling_type) lines.push(`cycling_type: "${data.cycling_type}"`);
  if (data.avg_speed_kmh != null && data.avg_speed_kmh !== '') lines.push(`avg_speed_kmh: ${data.avg_speed_kmh}`);
  if (data.max_speed_kmh != null && data.max_speed_kmh !== '') lines.push(`max_speed_kmh: ${data.max_speed_kmh}`);
  if (data.power_avg_w != null && data.power_avg_w !== '') lines.push(`power_avg_w: ${data.power_avg_w}`);

  const felt = data.felt;
  if (felt) lines.push(`felt: ${felt}`);
  const issues = Array.isArray(data.issues) ? data.issues.filter(Boolean) : [];
  if (issues.length) lines.push(`issues: [${issues.map((i) => `"${i}"`).join(', ')}]`);
  const notes = data.notes ? String(data.notes).replace(/"/g, '\\"') : '';
  lines.push(`notes: "${notes}"`);
  lines.push('---');
  return lines.join('\n');
}

function renderActivities() {
  const acts = [...state.data.activities].sort((a, b) => {
    const dateCmp = String(b.date).localeCompare(String(a.date));
    if (dateCmp !== 0) return dateCmp;
    return (a.sequence || 0) - (b.sequence || 0);
  });
  const view = viewEl('activities');
  clearViewKeepSkeleton(view);
  const headerRow = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, `活动（${acts.length}）`),
    el('div', {},
      el('button', { class: 'btn-sm btn-primary', 'data-action': 'add-activity' }, '记录活动'),
      el('button', { class: 'btn-sm', 'data-action': 'add-activity-ai' }, '✨ AI 添加')
    )
  );
  view.appendChild(headerRow);
  $('.btn-sm[data-action="add-activity"]', headerRow).addEventListener('click', () => openAddActivity());
  $('.btn-sm[data-action="add-activity-ai"]', headerRow).addEventListener('click', () => openAddActivityByAi());

  if (!acts.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无活动记录'));
    return;
  }

  const tabs = [
    { key: 'all', label: '全部' },
    { key: 'running', label: '跑步' },
    { key: 'hiking', label: '徒步' },
    { key: 'climbing', label: '攀岩' },
    { key: 'cycling', label: '骑行' },
  ];
  const activeTab = state.activitiesTab || 'all';
  const tabBar = el('div', { class: 'activity-tabs' });
  for (const t of tabs) {
    const btn = el('button', {
      class: 'activity-tab' + (t.key === activeTab ? ' active' : ''),
      'data-tab': t.key,
    }, t.label);
    btn.addEventListener('click', () => { state.activitiesTab = t.key; renderActivities(); });
    tabBar.appendChild(btn);
  }
  view.appendChild(tabBar);

  if (activeTab === 'all') {
    const groups = { running: [], hiking: [], climbing: [], cycling: [], other: [] };
    for (const a of acts) groups[activitySport(a.type)].push(a);
    for (const key of ['running', 'hiking', 'climbing', 'cycling', 'other']) {
      const list = groups[key];
      if (!list.length) continue;
      view.appendChild(el('div', { class: 'subsection-title' }, `${sportLabel(key)}（${list.length}）`));
      view.appendChild(activityTable(list, key));
    }
  } else {
    const filtered = acts.filter((a) => activitySport(a.type) === activeTab);
    if (!filtered.length) {
      view.appendChild(el('div', { class: 'empty' }, `暂无${sportLabel(activeTab)}记录`));
    } else {
      view.appendChild(activityTable(filtered, activeTab));
    }
  }
}
