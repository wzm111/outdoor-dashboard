/* 活动视图渲染 */
'use strict';

// ---------- 活动 ----------

function activityTable(acts) {
  // slug → 装备对象，供行点击时快速取装备（避免每行 O(n) 查找）
  const gearMap = new Map((state.data.gear || []).map((g) => [g.slug, g]));
  // 跑步显示精确时长 + 配速；徒步/爬山显示普通时长
  const hasRun = acts.some(isRunning);

  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  const headerCells = [
    el('th', {}, '日期'),
    // 跑步活动地点/备注比路线名更实用；徒步/爬山仍显示路线
    el('th', { class: 'col-location' }, hasRun ? '地点/备注' : '路线'),
    el('th', {}, '类型'),
    el('th', {}, '距离'),
    el('th', {}, '爬升'),
  ];
  headerCells.push(el('th', {}, '时长'));
  if (hasRun) headerCells.push(el('th', {}, '配速'));
  headerCells.push(el('th', {}, '平均心率'), el('th', {}, '感受'), el('th', {}, '装备'), el('th', {}, '操作'));
  table.appendChild(el('thead', {}, el('tr', {}, ...headerCells)));

  const tbody = el('tbody');
  for (const a of acts) {
    const running = isRunning(a);
    const pace = running ? paceMinPerKm(a.distance_km, a.duration_hours) : null;
    const duration = running ? fmtDuration(a.duration_hours) : num(a.duration_hours) + ' h';
    const gearCount = gearSlugsOf(a).length;
    const routeText = (a.route || '—') + (a.sequence > 0 ? ` #${Number(a.sequence) + 1}` : '');
    const cells = [
      el('td', {}, fmtDate(a.date)),
      el('td', { class: 'col-location' }, hasRun ? (a.notes || routeText) : routeText),
      el('td', {}, a.type || '—'),
      el('td', { class: 'num' }, running ? num(a.distance_km, 2) + ' km' : num(a.distance_km) + ' km'),
      el('td', { class: 'num' }, num(a.elevation_gain_m, 0) + ' m'),
      el('td', { class: 'num' }, duration),
    ];
    if (hasRun) cells.push(el('td', { class: 'num' }, pace || '—'));
    cells.push(
      el('td', { class: 'num' }, a.avg_hr ? num(a.avg_hr, 0) : '—'),
      el('td', {}, feltStars(a.felt)),
      // 装备列：显示件数，可点整行查看
      el('td', { class: 'num' }, gearCount ? el('span', { class: 'gear-count-badge' }, `装备 ${gearCount}`) : '—')
    );

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

/** 活动 → 装备：弹窗列出本次活动用过的装备，可点进装备详情。
 *  gearMap 可选（slug→装备）；不传时现场构建，保证从装备详情反向进来也能用。 */
function openActivityGear(activity, gearMap) {
  const map = gearMap || new Map((state.data.gear || []).map((g) => [g.slug, g]));
  // 工作副本：编辑不直接改 activity，保存成功后才写回内存
  let working = gearSlugsOf(activity);
  const wrap = el('div', {});

  // 活动概要（距离/爬升/时长/感受）
  const meta = [
    activity.type,
    activity.distance_km != null ? num(activity.distance_km) + ' km' : null,
    activity.elevation_gain_m != null ? num(activity.elevation_gain_m, 0) + ' m 爬升' : null,
  ].filter(Boolean).join(' · ');
  if (meta) wrap.appendChild(el('div', { class: 'rel-summary' }, meta));

  // 可重绘区：装备列表 + 添加下拉 + 合计
  const editArea = el('div', {});
  wrap.appendChild(editArea);

  // 保存按钮引用（rebuild 时据是否有改动启用/禁用）
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

    // 添加下拉：装备库在用装备（排除已选、排除已淘汰），按类别分组
    const addable = (state.data.gear || [])
      .filter((g) => g.condition !== 'retired' && !working.includes(g.slug));
    const addRow = el('div', { class: 'gear-add-row' });
    if (addable.length) {
      const sel = el('select', { class: 'gear-select' });
      sel.appendChild(el('option', { value: '' }, '+ 添加装备…'));
      // 按类别分组
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
    if (!dirty()) { close(); return; } // 没改动直接关
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
      // 就地更新内存，避免整表重拉
      activity.gear_used = cleanSlugs.slice();
      activity._raw_markdown = rawRes.text;
      toast('已更新本次活动的装备', 'info');
      close();
      // 重渲染活动视图（件数徽标随之更新）
      if (typeof renderActivities === 'function') renderActivities();
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '保存';
    }
  }

  rebuild();
}


function activityTypeGroup(type) {
  const t = String(type || '').toLowerCase();
  if (/run|跑步|配速/.test(t)) return 'running';
  if (/hike|hiking|徒步|爬山|登山|trail/.test(t)) return 'hiking';
  return 'other';
}

function activityGroupLabel(group) {
  return { running: '跑步', hiking: '徒步/爬山', other: '其他' }[group] || '其他';
}

function buildActivityMarkdown(data) {
  const lines = ['---'];
  lines.push(`date: "${data.date}"`);
  lines.push(`route: "${data.route}"`);
  lines.push(`type: ${data.type}`);
  lines.push(`distance_km: ${data.distance_km}`);
  if (data.elevation_gain_m) lines.push(`elevation_gain_m: ${data.elevation_gain_m}`);
  if (data.elevation_loss_m) lines.push(`elevation_loss_m: ${data.elevation_loss_m}`);
  if (data.duration_hours != null) lines.push(`duration_hours: ${data.duration_hours}`);
  if (data.avg_hr) lines.push(`avg_hr: ${data.avg_hr}`);
  if (data.felt) lines.push(`felt: ${data.felt}`);
  if (data.gear_used && data.gear_used.length) {
    lines.push('gear_used:');
    for (const s of data.gear_used) lines.push(`  - ${s}`);
  }
  if (data.notes) lines.push(`notes: "${data.notes}"`);
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
  view.innerHTML = '';
  const headerRow = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, `全部活动（${acts.length}）`),
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

  const groups = { running: [], hiking: [], other: [] };
  for (const a of acts) {
    const g = activityTypeGroup(a.type);
    groups[g].push(a);
  }

  for (const key of ['running', 'hiking', 'other']) {
    const list = groups[key];
    if (!list.length) continue;
    view.appendChild(el('div', { class: 'subsection-title' }, `${activityGroupLabel(key)}（${list.length}）`));
    view.appendChild(activityTable(list));
  }
}
