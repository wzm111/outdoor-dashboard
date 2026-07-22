/* 装备库视图渲染 */
'use strict';

// ---------- 装备 ----------

/** 装备使用概览：统计卡片 + Gear Health + 使用排行（DOM 比例条）+ 磨损/闲置预警。
 *  基于 activities 实时计算生命周期，AI-first；人工仅作查看与确认。 */
function gearUsageOverview(gearList) {
  const box = el('div', { class: 'gear-usage-overview' });
  const active = (gearList || []).filter((g) => g.condition !== 'retired');
  if (!active.length) return box; // 无在用装备则不显示概览

  const today = fmtDate(new Date().toISOString());
  const activities = state.data.activities || [];

  // ---- 为每件装备实时计算生命周期 ----
  const lifecycles = new Map();
  for (const g of active) {
    lifecycles.set(g.slug, computeGearLifecycle(g, activities, today));
  }

  // ---- 汇总统计（基于实时计算，而非可能过时的 gear 字段）----
  let totalKm = 0, totalUse = 0, totalHours = 0, totalVolume = 0;
  let mostUsed = null;
  const wearMap = new Map(); // slug -> status
  let attentionCount = 0;
  let replaceCount = 0;
  let idleCount = 0;
  for (const g of active) {
    const lc = lifecycles.get(g.slug);
    totalKm += lc.total_distance_km;
    totalUse += lc.usage_count;
    totalHours += lc.total_duration_hours;
    if (lc.usage_count > (mostUsed ? lifecycles.get(mostUsed.slug).usage_count : -1)) mostUsed = g;

    const st = gearWearStatus(g, today, activities);
    wearMap.set(g.slug, st);
    if (st.level !== 'ok') attentionCount++;
    if (st.level === 'alert') replaceCount++;
    if (st.level === 'idle') idleCount++;
  }

  // ---- (a) 统计卡片行 ----
  const statGrid = el('div', { class: 'stat-grid' });
  const statCard = (label, value, unit) =>
    el('div', { class: 'stat-card' },
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, value, unit ? el('span', { class: 'unit' }, ' ' + unit) : '')
    );
  statGrid.appendChild(statCard('累计总里程', num(totalKm, 0), 'km'));
  statGrid.appendChild(statCard('累计出勤', String(totalUse), `次 · ${num(totalHours, 0)}h`));
  statGrid.appendChild(statCard('最常用装备',
    mostUsed && lifecycles.get(mostUsed.slug).usage_count > 0 ? (mostUsed.name || mostUsed.slug) : '—',
    mostUsed && lifecycles.get(mostUsed.slug).usage_count > 0 ? `${lifecycles.get(mostUsed.slug).usage_count} 次` : ''));
  // 待关注卡片：可点击滚动到预警区
  const attnCard = statCard('待关注', String(attentionCount), '件');
  if (attentionCount > 0) {
    attnCard.classList.add('stat-card-clickable');
    attnCard.addEventListener('click', () => {
      const w = $('.wear-warn-section', box);
      if (w) w.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  statGrid.appendChild(attnCard);
  box.appendChild(statGrid);

  // ---- (a.5) Gear Health 摘要：替换 / 闲置 / 整体状态 ----
  if (attentionCount > 0) {
    const healthCard = el('div', { class: 'chart-card gear-health-section' });
    healthCard.appendChild(el('h3', {}, 'Gear Health（AI 洞察）'));
    const healthGrid = el('div', { class: 'stat-grid' });
    const healthBadge = (label, count, cls) => {
      const card = el('div', { class: 'stat-card ' + cls },
        el('div', { class: 'label' }, label),
        el('div', { class: 'value' }, String(count), el('span', { class: 'unit' }, ' 件'))
      );
      return card;
    };
    healthGrid.appendChild(healthBadge('建议更换', replaceCount, replaceCount ? 'health-critical' : 'health-ok'));
    healthGrid.appendChild(healthBadge('久未使用', idleCount, idleCount ? 'health-warn' : 'health-ok'));
    healthGrid.appendChild(healthBadge('状态良好', active.length - attentionCount, 'health-ok'));
    healthCard.appendChild(healthGrid);

    // Top 5 警报
    const topAlerts = active
      .map((g) => ({ g, st: wearMap.get(g.slug), lc: lifecycles.get(g.slug) }))
      .filter((x) => x.st && x.st.level !== 'ok')
      .sort((a, b) => {
        const order = { alert: 0, warn: 1, idle: 2 };
        return (order[a.st.level] - order[b.st.level]) ||
          ((b.st.pctOfLife || 0) - (a.st.pctOfLife || 0));
      })
      .slice(0, 5);
    const alertList = el('div', { class: 'rel-list' });
    for (const { g, st } of topAlerts) {
      const advice = gearAiAdvice(g, lifecycles.get(g.slug));
      const item = el('div', { class: 'rel-item' },
        el('div', { class: 'rel-info' },
          el('div', { class: 'rel-name' }, g.name || g.slug),
          el('div', { class: 'rel-brief gear-advice-line' }, advice)
        ),
        (() => {
          const btn = el('button', { class: 'btn-sm' }, '详情');
          btn.addEventListener('click', () => openGearDetail(g));
          return btn;
        })()
      );
      alertList.appendChild(item);
    }
    healthCard.appendChild(alertList);
    box.appendChild(healthCard);
  }

  // ---- (b) 使用排行（比例条，Top 8）----
  const ranked = active
    .filter((g) => lifecycles.get(g.slug).usage_count > 0)
    .sort((a, b) => lifecycles.get(b.slug).usage_count - lifecycles.get(a.slug).usage_count)
    .slice(0, 8);
  const rankCard = el('div', { class: 'chart-card' });
  rankCard.appendChild(el('h3', {}, '使用排行（按次数）'));
  if (!ranked.length) {
    rankCard.appendChild(el('div', { class: 'empty' }, '暂无使用记录'));
  } else {
    const maxUse = lifecycles.get(ranked[0].slug).usage_count || 1;
    const rank = el('div', { class: 'usage-rank' });
    for (const g of ranked) {
      const lc = lifecycles.get(g.slug);
      const uc = lc.usage_count;
      const km = lc.total_distance_km;
      const pct = Math.max(4, Math.round((uc / maxUse) * 100)); // 至少 4% 可见
      const row = el('div', { class: 'usage-rank-row', title: '点击查看详情' },
        el('div', { class: 'usage-rank-label' }, g.name || g.slug),
        el('div', { class: 'usage-bar-track' }, el('div', { class: 'usage-bar-fill', style: `width:${pct}%;` })),
        el('div', { class: 'usage-rank-meta' }, `${uc} 次${km > 0 ? ' · ' + num(km, 0) + ' km' : ''}`)
      );
      row.addEventListener('click', () => openGearDetail(g));
      rank.appendChild(row);
    }
    rankCard.appendChild(rank);
  }
  box.appendChild(rankCard);

  // ---- (c) 磨损/闲置预警列表 ----
  const order = { alert: 0, warn: 1, idle: 2 };
  const warned = active
    .map((g) => ({ g, st: wearMap.get(g.slug) }))
    .filter((x) => x.st && x.st.level !== 'ok')
    .sort((a, b) => (order[a.st.level] - order[b.st.level]) ||
      ((b.st.pctOfLife || 0) - (a.st.pctOfLife || 0)));

  const warnCard = el('div', { class: 'chart-card wear-warn-section' });
  warnCard.appendChild(el('h3', {}, '磨损 / 闲置提醒（经验参考）'));
  if (!warned.length) {
    warnCard.appendChild(el('div', { class: 'empty' }, '所有在用装备状态良好'));
  } else {
    const list = el('div', { class: 'rel-list' });
    const badgeOf = (lvl) => lvl === 'alert' ? ['status-dot status-alert', 'wear-badge wear-alert', '已达经验寿命']
      : lvl === 'warn' ? ['status-dot status-warn', 'wear-badge wear-warn', '接近经验寿命']
      : ['status-dot status-idle', 'wear-badge wear-idle', '久未使用'];
    for (const { g, st } of warned) {
      const [dotCls, cls, label] = badgeOf(st.level);
      const lc = lifecycles.get(g.slug);
      const advice = gearAiAdvice(g, lc);
      const item = el('div', { class: 'rel-item' },
        el('div', { class: 'rel-info' },
          el('div', { class: 'rel-name' },
            el('span', { class: cls }, [el('span', { class: dotCls }), ' ' + label]),
            ' ' + (g.name || g.slug)),
          el('div', { class: 'rel-brief gear-advice-line' }, advice)
        ),
        (() => {
          const btn = el('button', { class: 'btn-sm' }, '详情');
          btn.addEventListener('click', () => openGearDetail(g));
          return btn;
        })()
      );
      list.appendChild(item);
    }
    warnCard.appendChild(list);
    warnCard.appendChild(el('div', { class: 'rel-summary rel-summary-total' },
      '阈值为按类别的经验参考值，非精确寿命；请结合实际磨损情况判断。'));
  }
  box.appendChild(warnCard);

  return box;
}

function buildGearMarkdown(data) {
  const lines = ['---'];
  lines.push(`name: "${data.name}"`);
  if (data.category) lines.push(`category: ${data.category}`);
  if (data.type) lines.push(`type: ${data.type}`);
  if (data.brand) lines.push(`brand: "${data.brand}"`);
  if (data.model) lines.push(`model: "${data.model}"`);
  if (data.weight_g != null) lines.push(`weight_g: ${data.weight_g}`);
  if (data.packed_volume_l != null) lines.push(`packed_volume_l: ${data.packed_volume_l}`);
  if (data.material) lines.push(`material: "${data.material}"`);
  if (data.waterproof != null) lines.push(`waterproof: ${data.waterproof}`);
  if (data.breathable != null) lines.push(`breathable: ${data.breathable}`);
  if (data.warmth) lines.push(`warmth: ${data.warmth}`);
  if (Array.isArray(data.seasons) && data.seasons.length) { lines.push('seasons:'); for (const s of data.seasons) lines.push(`  - ${s}`); }
  if (Array.isArray(data.terrain) && data.terrain.length) { lines.push('terrain:'); for (const s of data.terrain) lines.push(`  - ${s}`); }
  if (data.price != null) lines.push(`price: ${data.price}`);
  if (data.color) lines.push(`color: "${data.color}"`);
  if (data.size) lines.push(`size: "${data.size}"`);
  if (data.source_url) lines.push(`source_url: "${data.source_url}"`);
  if (data.notes) lines.push(`notes: "${data.notes}"`);
  if (data.condition) lines.push(`condition: ${data.condition}`);
  lines.push('---');
  return lines.join('\n');
}

/** 弹窗手动添加装备。 */
function openAddGear() {
  if (!state.token) { toast('请先连接后再添加装备', 'warn'); return; }

  const nameInput = el('input', { type: 'text', class: 'gear-select', placeholder: '装备名称', style: 'width:100%;' });
  const slugInput = el('input', { type: 'text', class: 'gear-select', placeholder: '装备 ID（slug）', style: 'width:100%;' });
  nameInput.addEventListener('input', () => { slugInput.value = slugifyGear(nameInput.value, brandInput.value, modelInput.value); });
  const brandInput = el('input', { type: 'text', class: 'gear-select', placeholder: '品牌', style: 'width:100%;' });
  brandInput.addEventListener('input', () => { slugInput.value = slugifyGear(nameInput.value, brandInput.value, modelInput.value); });
  const modelInput = el('input', { type: 'text', class: 'gear-select', placeholder: '型号', style: 'width:100%;' });
  modelInput.addEventListener('input', () => { slugInput.value = slugifyGear(nameInput.value, brandInput.value, modelInput.value); });
  const catSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（未选择）'),
    el('option', { value: 'shoes' }, '鞋类 shoes'),
    el('option', { value: 'backpack' }, '背包 backpack'),
    el('option', { value: 'jacket' }, '夹克/外套 jacket'),
    el('option', { value: 'pants' }, '裤子 pants'),
    el('option', { value: 'poles' }, '登山杖 poles'),
    el('option', { value: 'light' }, '照明 light'),
    el('option', { value: 'sleeping' }, '睡眠系统 sleeping'),
    el('option', { value: 'cooking' }, '炊具 cooking'),
    el('option', { value: 'electronics' }, '电子/导航 electronics'),
    el('option', { value: 'firstaid' }, '急救 firstaid'),
    el('option', { value: 'hydration' }, '水具 hydration'),
    el('option', { value: 'accessory' }, '配件 accessory')
  );
  const typeInput = el('input', { type: 'text', class: 'gear-select', placeholder: '子类型，如 hardshell / trail_running', style: 'width:100%;' });
  const weightInput = el('input', { type: 'number', class: 'gear-select', placeholder: '克', style: 'width:100%;' });
  const volumeInput = el('input', { type: 'number', class: 'gear-select', step: '0.1', placeholder: '打包体积（升）', style: 'width:100%;' });
  const materialInput = el('input', { type: 'text', class: 'gear-select', placeholder: '材质/面料', style: 'width:100%;' });
  const wpSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '未知'),
    el('option', { value: 'true' }, '是'),
    el('option', { value: 'false' }, '否')
  );
  const brSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '未知'),
    el('option', { value: 'true' }, '是'),
    el('option', { value: 'false' }, '否')
  );
  const warmthSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（未选择）'),
    el('option', { value: 'none' }, '无 none'),
    el('option', { value: 'light' }, '轻 light'),
    el('option', { value: 'medium' }, '中 medium'),
    el('option', { value: 'heavy' }, '厚 heavy')
  );
  const seasonsInput = el('input', { type: 'text', class: 'gear-select', placeholder: 'spring, summer, autumn, winter', style: 'width:100%;' });
  const terrainInput = el('input', { type: 'text', class: 'gear-select', placeholder: 'road, trail, rock, snow', style: 'width:100%;' });
  const priceInput = el('input', { type: 'number', class: 'gear-select', placeholder: '元', style: 'width:100%;' });
  const colorInput = el('input', { type: 'text', class: 'gear-select', placeholder: '颜色', style: 'width:100%;' });
  const sizeInput = el('input', { type: 'text', class: 'gear-select', placeholder: '尺码', style: 'width:100%;' });
  const sourceInput = el('input', { type: 'url', class: 'gear-select', placeholder: 'https://...', style: 'width:100%;' });
  const notesInput = el('textarea', { class: 'gear-select', rows: 3, placeholder: '备注', style: 'width:100%;' });

  const form = el('div', { class: 'recommend-form' },
    el('div', { class: 'form-row' }, el('label', {}, '名称 *'), nameInput),
    el('div', { class: 'form-row' }, el('label', {}, '装备 ID *'), slugInput),
    el('div', { class: 'form-row' }, el('label', {}, '品牌'), brandInput),
    el('div', { class: 'form-row' }, el('label', {}, '型号'), modelInput),
    el('div', { class: 'form-row' }, el('label', {}, '类别 *'), catSel),
    el('div', { class: 'form-row' }, el('label', {}, '子类型'), typeInput),
    el('div', { class: 'form-row' }, el('label', {}, '重量 (g)'), weightInput),
    el('div', { class: 'form-row' }, el('label', {}, '打包体积 (L)'), volumeInput),
    el('div', { class: 'form-row' }, el('label', {}, '材质'), materialInput),
    el('div', { class: 'form-row' }, el('label', {}, '防水'), wpSel),
    el('div', { class: 'form-row' }, el('label', {}, '透气'), brSel),
    el('div', { class: 'form-row' }, el('label', {}, '保暖'), warmthSel),
    el('div', { class: 'form-row' }, el('label', {}, '季节'), seasonsInput),
    el('div', { class: 'form-row' }, el('label', {}, '地形'), terrainInput),
    el('div', { class: 'form-row' }, el('label', {}, '价格 (元)'), priceInput),
    el('div', { class: 'form-row' }, el('label', {}, '颜色'), colorInput),
    el('div', { class: 'form-row' }, el('label', {}, '尺码'), sizeInput),
    el('div', { class: 'form-row' }, el('label', {}, '来源链接'), sourceInput),
    el('div', { class: 'form-row' }, el('label', {}, '备注'), notesInput)
  );

  const saveBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, '添加装备');
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const slug = slugInput.value.trim();
    const category = catSel.value;
    if (!name || !slug || !category) { toast('请填写名称、装备 ID 和类别', 'warn'); return; }
    const data = { name, category, condition: 'good' };
    const brand = brandInput.value.trim(); if (brand) data.brand = brand;
    const model = modelInput.value.trim(); if (model) data.model = model;
    const type = typeInput.value.trim(); if (type) data.type = type;
    const w = Number(weightInput.value); if (!isNaN(w) && w >= 0) data.weight_g = w;
    const v = Number(volumeInput.value); if (!isNaN(v) && v >= 0) data.packed_volume_l = v;
    const material = materialInput.value.trim(); if (material) data.material = material;
    if (wpSel.value) data.waterproof = wpSel.value === 'true';
    if (brSel.value) data.breathable = brSel.value === 'true';
    if (warmthSel.value) data.warmth = warmthSel.value;
    const seasons = parseCommaList(seasonsInput.value); if (seasons.length) data.seasons = seasons;
    const terrain = parseCommaList(terrainInput.value); if (terrain.length) data.terrain = terrain;
    const p = Number(priceInput.value); if (!isNaN(p) && p >= 0) data.price = p;
    const color = colorInput.value.trim(); if (color) data.color = color;
    const size = sizeInput.value.trim(); if (size) data.size = size;
    const source = sourceInput.value.trim(); if (source) data.source_url = source;
    const notes = notesInput.value.trim(); if (notes) data.notes = notes;

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      await fetchSaveGear(state.apiUrl, state.token, slug, packGearPayload(data));
      toast('装备已添加', 'success');
      close();
      await loadAndRender(true);
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '添加装备';
    }
  });

  const close = showModal('添加装备', form, [saveBtn, el('button', { class: 'btn' }, '关闭')]);
}

function renderGear() {
  const allGear = state.data.gear;
  const view = viewEl('gear');
  view.innerHTML = '';

  // 顶部标题 + 添加按钮
  const headerRow = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, `装备库（${allGear.length}）`),
    el('div', { style: 'display:flex;gap:8px;' },
      el('button', { class: 'btn-sm', 'data-action': 'add-gear' }, '添加装备'),
      el('button', { class: 'btn-sm', 'data-action': 'add-ai' }, 'AI 添加'),
      el('button', { class: 'btn-sm btn-primary', 'data-action': 'add-photo' }, '📷 拍照添加')
    )
  );
  view.appendChild(headerRow);
  $('.btn-sm[data-action="add-gear"]', headerRow).addEventListener('click', () => openAddGear());
  $('.btn-sm[data-action="add-ai"]', headerRow).addEventListener('click', () => openAddGearByAi());
  $('.btn-sm[data-action="add-photo"]', headerRow).addEventListener('click', () => openAddGearByPhoto());

  if (!allGear.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无装备'));
    return;
  }

  // 使用统计概览：统计卡片 + 使用排行 + 磨损/闲置预警（放在筛选工具条之上）
  view.appendChild(gearUsageOverview(allGear));

  // 搜索/筛选/排序工具条 + 结果计数容器（计数在 applyGearFilter 内更新）
  const countLabel = el('span', { class: 'gear-filter-count' }, '');
  view.appendChild(buildGearToolbar(allGear, view, countLabel));

  // 结果渲染区：独立容器，改动筛选条件时只重渲染这里，不动工具条（否则输入框会失焦）
  const resultsBox = el('div', { class: 'gear-results' });
  view.appendChild(resultsBox);

  applyGearFilter(allGear, resultsBox, countLabel);
}

/** 构建装备工具条：搜索框 + 类别 + 状态 + 排序。改动即重算结果。 */
function buildGearToolbar(allGear, view, countLabel) {
  const bar = el('div', { class: 'gear-toolbar' });

  // 关键：重算时只重渲染结果区，不重建工具条，避免搜索框失焦
  const rerun = () => {
    const resultsBox = $('.gear-results', view);
    if (resultsBox) applyGearFilter(allGear, resultsBox, countLabel);
  };

  // 搜索框
  const search = el('input', {
    class: 'gear-search', type: 'search', value: gearFilter.q,
    placeholder: '搜索名称 / 品牌 / 型号 / 备注',
  });
  search.addEventListener('input', () => { gearFilter.q = search.value; rerun(); });
  bar.appendChild(search);

  // 类别下拉：从现有装备动态收集
  const cats = Array.from(new Set(allGear.map((g) => g.category || '未分类'))).sort();
  const catSel = el('select', { class: 'gear-select' },
    el('option', { value: 'all' }, '全部类别'),
    ...cats.map((c) => el('option', gearFilter.category === c ? { value: c, selected: 'selected' } : { value: c }, categoryLabel(c)))
  );
  catSel.value = gearFilter.category;
  catSel.addEventListener('change', () => { gearFilter.category = catSel.value; rerun(); });
  bar.appendChild(catSel);

  // 状态下拉：在用 / 淘汰 / 全部
  const statusSel = el('select', { class: 'gear-select', 'data-role': 'status' },
    el('option', { value: 'active' }, '仅在用'),
    el('option', { value: 'retired' }, '仅淘汰'),
    el('option', { value: 'all' }, '全部状态')
  );
  statusSel.value = gearFilter.status;
  statusSel.addEventListener('change', () => { gearFilter.status = statusSel.value; rerun(); });
  bar.appendChild(statusSel);

  // 排序下拉
  const sortSel = el('select', { class: 'gear-select' },
    el('option', { value: 'category' }, '按类别'),
    el('option', { value: 'name' }, '按名称'),
    el('option', { value: 'weight' }, '按重量（重→轻）'),
    el('option', { value: 'usage' }, '按使用次数（多→少）'),
    el('option', { value: 'distance' }, '按里程（多→少）'),
    el('option', { value: 'recent' }, '按最近使用')
  );
  sortSel.value = gearFilter.sort;
  sortSel.addEventListener('change', () => { gearFilter.sort = sortSel.value; rerun(); });
  bar.appendChild(sortSel);

  // 计数标签放到工具条末尾
  bar.appendChild(countLabel);

  return bar;
}

/** 按 gearFilter 过滤 + 排序，把结果渲染进 resultsBox，并更新计数标签。 */
function applyGearFilter(allGear, resultsBox, countLabel) {
  const q = gearFilter.q.trim().toLowerCase();

  let list = allGear.filter((g) => {
    // 状态
    const retired = g.condition === 'retired';
    if (gearFilter.status === 'active' && retired) return false;
    if (gearFilter.status === 'retired' && !retired) return false;
    // 类别
    if (gearFilter.category !== 'all' && (g.category || '未分类') !== gearFilter.category) return false;
    // 关键词：名称/品牌/型号/slug/备注
    if (q) {
      const hay = [g.name, g.brand, g.model, g.slug, g.notes].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // 排序
  const byStr = (a, b) => String(a || '').localeCompare(String(b || ''));
  if (gearFilter.sort === 'name') {
    list.sort((a, b) => byStr(a.name || a.slug, b.name || b.slug));
  } else if (gearFilter.sort === 'weight') {
    list.sort((a, b) => (Number(b.weight_g) || 0) - (Number(a.weight_g) || 0));
  } else if (gearFilter.sort === 'usage') {
    list.sort((a, b) => (Number(b.usage_count) || 0) - (Number(a.usage_count) || 0));
  } else if (gearFilter.sort === 'distance') {
    list.sort((a, b) => (Number(b.total_distance_km) || 0) - (Number(a.total_distance_km) || 0));
  } else if (gearFilter.sort === 'recent') {
    // 最近使用在前；从没用过的（无 last_used_date）排最后，平局用 slug 稳定
    list.sort((a, b) => byStr(b.last_used_date, a.last_used_date) || byStr(a.slug, b.slug));
  } else {
    // category：先类别再 slug
    list.sort((a, b) => byStr(a.category, b.category) || byStr(a.slug, b.slug));
  }

  countLabel.textContent = `匹配 ${list.length} / ${allGear.length} 件`;

  resultsBox.innerHTML = '';
  if (!list.length) {
    resultsBox.appendChild(el('div', { class: 'empty' }, '没有符合条件的装备，试试放宽筛选或清空搜索。'));
    return;
  }

  // 排序为 name/weight/usage/distance/recent 时用平铺列表（不分组），category 时按类别分组
  if (gearFilter.sort === 'category') {
    renderGearGroups(resultsBox, list);
  } else {
    const flat = el('div', { class: 'gear-group-body gear-flat' });
    for (const g of list) flat.appendChild(buildGearCard(g));
    resultsBox.appendChild(flat);
  }

  // 可发现性：默认只看在用装备时，若另有淘汰装备，底部给一个切换入口
  if (gearFilter.status === 'active') {
    const retiredCount = allGear.filter((g) => g.condition === 'retired').length;
    if (retiredCount) {
      const link = el('button', { class: 'gear-retired-link' }, `另有 ${retiredCount} 件已淘汰装备，点击查看`);
      link.addEventListener('click', () => {
        gearFilter.status = 'retired';
        // 同步更新工具条上的状态下拉，再重算
        const statusSel = $('.gear-toolbar .gear-select[data-role="status"]');
        if (statusSel) statusSel.value = 'retired';
        applyGearFilter(allGear, resultsBox, countLabel);
      });
      resultsBox.appendChild(link);
    }
  }
}

/** 渲染装备分类分组 */
function renderGearGroups(container, gearList) {
  const groups = new Map();
  for (const g of gearList) {
    const cat = g.category || '未分类';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(g);
  }
  for (const [cat, items] of groups) {
    const group = el('div', { class: 'gear-group' });
    const header = el('div', { class: 'gear-group-header' },
      el('span', {}, categoryLabel(cat)),
      el('span', { class: 'gear-count' }, `${items.length} 件`)
    );
    const body = el('div', { class: 'gear-group-body' });
    for (const g of items) body.appendChild(buildGearCard(g));
    header.addEventListener('click', () => {
      const hidden = body.classList.toggle('collapsed');
      header.classList.toggle('collapsed', hidden);
    });
    group.appendChild(header);
    group.appendChild(body);
    container.appendChild(group);
  }
}

/** 从装备的 price_history 或 price 字段获取当前价与趋势。 */
function getGearPriceInfo(g) {
  const history = Array.isArray(g.price_history) ? g.price_history : [];
  if (!history.length && g.price == null) return null;
  const current = history.length ? history[history.length - 1].price : Number(g.price);
  if (!current || isNaN(current)) return null;
  let trend = 'flat';
  if (history.length >= 2) {
    const prev = history[history.length - 2].price;
    if (current > prev) trend = 'up';
    else if (current < prev) trend = 'down';
  }
  const lowest = history.length ? Math.min(...history.map((h) => h.price)) : current;
  return { current, trend, lowest, history };
}

/** 构建单个装备卡片 */
function buildGearCard(g) {
  const card = el('div', { class: 'gear-card' + (g.condition === 'retired' ? ' gear-retired' : '') });
  const main = el('div', { class: 'gear-card-main' });
  const priceInfo = getGearPriceInfo(g);
  const nameRow = el('div', { class: 'gear-name-row' });
  nameRow.appendChild(el('span', { class: 'gear-name-text' }, g.name || g.slug || '—'));
  if (priceInfo) {
    const trendIcon = priceInfo.trend === 'up' ? '↗' : priceInfo.trend === 'down' ? '↘' : '→';
    const trendCls = priceInfo.trend === 'up' ? 'price-trend-up' : priceInfo.trend === 'down' ? 'price-trend-down' : '';
    nameRow.appendChild(el('span', { class: 'price-badge ' + trendCls, title: `历史最低 ¥${num(priceInfo.lowest, 0)}` }, `¥${num(priceInfo.current, 0)} ${trendIcon}`));
  }
  main.appendChild(nameRow);

  // AI 生命周期洞察：基于 activities 实时计算
  const today = fmtDate(new Date().toISOString());
  const lc = computeGearLifecycle(g, state.data.activities || [], today);
  const advice = gearAiAdvice(g, lc);
  main.appendChild(el('div', { class: 'gear-brief' },
    [g.brand, g.weight_g != null ? num(g.weight_g, 0) + ' g' : null, categoryLabel(g.category)]
      .filter(Boolean).join(' · ') || '—'
  ));
  if (advice) {
    main.appendChild(el('div', { class: 'gear-advice' }, advice));
  }

  const actions = el('div', { class: 'gear-card-actions' });
  actions.appendChild(el('button', { class: 'btn-sm', 'data-action': 'detail' }, '详情'));
  actions.appendChild(el('button', { class: 'btn-sm btn-primary', 'data-action': 'update' }, '更新'));
  if (priceInfo || g.price != null) {
    actions.appendChild(el('button', { class: 'btn-sm', 'data-action': 'price' }, '价格'));
  }
  const isRetired = g.condition === 'retired';
  const retireBtn = el('button', { class: 'btn-sm' + (isRetired ? ' btn-primary' : ''), 'data-action': isRetired ? 'restore' : 'retire' }, isRetired ? '恢复' : '淘汰');
  actions.appendChild(retireBtn);
  const deleteBtn = el('button', { class: 'btn-sm btn-danger', 'data-action': 'delete' }, '删除');
  actions.appendChild(deleteBtn);

  card.appendChild(main);
  card.appendChild(actions);

  // 事件绑定
  $('.btn-sm[data-action="detail"]', card).addEventListener('click', () => openGearDetail(g));
  $('.btn-sm[data-action="update"]', card).addEventListener('click', () => openGearUpdate(g));
  const priceBtn = $('.btn-sm[data-action="price"]', card);
  if (priceBtn) priceBtn.addEventListener('click', () => openGearPriceHistory(g));
  retireBtn.addEventListener('click', async () => {
    const nextCondition = isRetired ? 'good' : 'retired';
    retireBtn.disabled = true;
    retireBtn.textContent = isRetired ? '恢复中…' : '淘汰中…';
    try {
      await fetchSaveGear(state.apiUrl, state.token, g.slug, packGearPayload({ ...g, condition: nextCondition }));
      toast(isRetired ? '已恢复装备' : '已淘汰装备', 'success');
      await loadAndRender(true);
    } catch (err) {
      toast(err.message || '操作失败', 'error');
      retireBtn.disabled = false;
      retireBtn.textContent = isRetired ? '恢复' : '淘汰';
    }
  });
  deleteBtn.addEventListener('click', async () => {
    const used = Number(g.usage_count) || 0;
    const msg = used
      ? `装备「${g.name || g.slug}」已有 ${used} 次使用记录。删除装备不会删除关联活动，确认删除？`
      : `确认删除装备「${g.name || g.slug}」？`;
    if (!confirm(msg)) return;
    deleteBtn.disabled = true;
    deleteBtn.textContent = '删除中…';
    try {
      await fetchDelete(state.apiUrl, state.token, 'gear', g.slug);
      toast('装备已删除', 'success');
      await loadAndRender(true);
    } catch (err) {
      toast(err.message || '删除失败', 'error');
      deleteBtn.disabled = false;
      deleteBtn.textContent = '删除';
    }
  });
  return card;
}

function categoryLabel(cat) {
  const map = {
    shoes: '鞋类', backpack: '背包', jacket: '夹克/外套',
    pants: '裤子', poles: '登山杖', light: '照明',
    sleeping: '睡眠系统', cooking: '炊具', electronics: '电子/导航',
    firstaid: '急救/安全', hydration: '水具', accessory: '配件/其他',
  };
  return map[String(cat).toLowerCase()] || cat;
}

function openGearDetail(g) {
  const wrap = el('div', {});
  wrap.appendChild(gearFactList(g));

  // 装备 → 活动：反查这件装备上过哪些活动，形成双向导航闭环
  const used = activitiesUsingGear(g.slug);
  wrap.appendChild(el('div', { class: 'section-title rel-heading' }, `用过的活动（${used.length}）`));
  if (!used.length) {
    wrap.appendChild(el('div', { class: 'empty' }, '暂无关联活动记录'));
  } else {
    const list = el('div', { class: 'rel-list' });
    for (const a of used) {
      const item = el('div', { class: 'rel-item' });
      const info = el('div', { class: 'rel-info' });
      info.appendChild(el('div', { class: 'rel-name' }, `${fmtDate(a.date)} · ${a.route || '活动'}`));
      info.appendChild(el('div', { class: 'rel-brief' },
        [a.type, a.distance_km != null ? num(a.distance_km) + ' km' : null,
         a.elevation_gain_m != null ? num(a.elevation_gain_m, 0) + ' m' : null]
          .filter(Boolean).join(' · ') || '—'));
      item.appendChild(info);
      const btn = el('button', { class: 'btn-sm' }, '查看');
      btn.addEventListener('click', () => openActivityGear(a));
      item.appendChild(btn);
      list.appendChild(item);
    }
    wrap.appendChild(list);
  }

  showModal(g.name || g.slug || '装备详情', wrap, [el('button', { class: 'btn', 'data-action': 'close' }, '关闭')]);
}

/** 打开装备价格追踪弹窗：历史记录 + 统计/AI 建议 + 手动录入/自动抓取。 */
async function openGearPriceHistory(g) {
  if (!state.token) { toast('请先连接', 'warn'); return; }

  const wrap = el('div', {});
  const historyList = el('div', { class: 'price-history-list' });
  const statsArea = el('div', { class: 'price-stats-area' });
  const actionArea = el('div', { class: 'price-action-area' });
  const statusArea = el('div', { class: 'price-status-area' });

  wrap.appendChild(statsArea);
  wrap.appendChild(statusArea);
  wrap.appendChild(el('div', { class: 'subsection-title' }, '价格记录'));
  wrap.appendChild(historyList);
  wrap.appendChild(el('div', { class: 'subsection-title' }, '添加/更新价格'));
  wrap.appendChild(actionArea);

  const platformMap = { jd: '京东', tmall: '天猫', amazon: '亚马逊', manual: '手动' };

  async function refresh() {
    try {
      const data = await fetchGearPriceHistory(state.apiUrl, state.token, g.slug);
      render(data);
    } catch (err) {
      statusArea.textContent = '';
      statusArea.appendChild(el('div', { class: 'error-text' }, err.message || '加载失败'));
    }
  }

  function render(data) {
    const { history = [], stats = {}, suggestion = {} } = data;

    // 统计区
    statsArea.innerHTML = '';
    const statGrid = el('div', { class: 'stat-grid' });
    const st = (label, value, unit) => el('div', { class: 'stat-card' },
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, value, unit ? el('span', { class: 'unit' }, ' ' + unit) : ''));
    statGrid.appendChild(st('当前价', stats.current != null ? '¥' + num(stats.current, 0) : '—'));
    statGrid.appendChild(st('最低价', stats.lowest != null ? '¥' + num(stats.lowest, 0) : '—'));
    statGrid.appendChild(st('平均价', stats.average != null ? '¥' + num(stats.average, 0) : '—'));
    statGrid.appendChild(st('记录数', String(stats.count || 0), '条'));
    statsArea.appendChild(statGrid);

    // AI 建议
    statusArea.innerHTML = '';
    if (suggestion.label) {
      const badgeCls = suggestion.suggestion === 'buy_now' ? 'price-suggestion-buy' :
        suggestion.suggestion === 'price_raised' ? 'price-suggestion-high' : 'price-suggestion-watch';
      statusArea.appendChild(el('div', { class: 'price-suggestion ' + badgeCls },
        el('strong', {}, suggestion.label),
        el('span', {}, ' · ' + (suggestion.reasoning || ''))
      ));
    }

    // 历史列表
    historyList.innerHTML = '';
    if (!history.length) {
      historyList.appendChild(el('div', { class: 'empty' }, '暂无价格记录'));
    } else {
      const sorted = [...history].sort((a, b) => String(b.date).localeCompare(String(a.date)));
      for (const h of sorted) {
        historyList.appendChild(el('div', { class: 'price-history-row' },
          el('span', { class: 'price-history-date' }, h.date),
          el('span', { class: 'price-history-platform' }, platformMap[h.platform] || h.platform),
          el('span', { class: 'price-history-price' }, '¥' + num(h.price, 0)),
          h.note ? el('span', { class: 'price-history-note' }, h.note) : ''
        ));
      }
    }
  }

  // 操作区：手动录入 + 自动抓取
  const priceInput = el('input', { type: 'number', class: 'gear-select', placeholder: '价格（元）', style: 'flex:1;min-width:80px;' });
  const platformSel = el('select', { class: 'gear-select', style: 'flex:1;min-width:100px;' },
    el('option', { value: 'manual' }, '手动'),
    el('option', { value: 'jd' }, '京东'),
    el('option', { value: 'tmall' }, '天猫'),
    el('option', { value: 'amazon' }, '亚马逊')
  );
  const noteInput = el('input', { type: 'text', class: 'gear-select', placeholder: '备注（可选）', style: 'flex:1 1 100%;min-width:80px;' });
  const recordBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, '记录价格');
  recordBtn.addEventListener('click', async () => {
    const price = Number(priceInput.value);
    if (!price || price <= 0) { toast('请输入有效价格', 'warn'); return; }
    recordBtn.disabled = true;
    recordBtn.textContent = '保存中…';
    try {
      await fetchGearPriceRecord(state.apiUrl, state.token, g.slug, {
        price,
        platform: platformSel.value,
        note: noteInput.value,
      });
      toast('价格已记录', 'success');
      priceInput.value = '';
      noteInput.value = '';
      await refresh();
      await loadAndRender(true);
    } catch (err) {
      toast(err.message || '记录失败', 'error');
    } finally {
      recordBtn.disabled = false;
      recordBtn.textContent = '记录价格';
    }
  });

  const fetchSel = el('select', { class: 'gear-select', style: 'flex:1;min-width:100px;' },
    el('option', { value: '' }, '自动选择平台'),
    el('option', { value: 'jd' }, '京东'),
    el('option', { value: 'tmall' }, '天猫'),
    el('option', { value: 'amazon' }, '亚马逊')
  );
  const fetchBtn = el('button', { class: 'btn', 'data-no-autoclose': '1' }, 'AI 自动抓取');
  fetchBtn.addEventListener('click', async () => {
    fetchBtn.disabled = true;
    fetchBtn.textContent = '抓取中…';
    try {
      const data = await fetchGearPriceFetch(state.apiUrl, state.token, g.slug, fetchSel.value || undefined);
      if (data.needs_manual) {
        toast('自动抓取被拦截，请手动录入', 'warn');
        statusArea.innerHTML = '';
        statusArea.appendChild(el('div', { class: 'error-text' },
          '电商页面已拦截自动抓取，请粘贴价格或截图后手动记录。'));
      } else {
        toast('已抓取并记录最新价格', 'success');
        await refresh();
        await loadAndRender(true);
      }
    } catch (err) {
      toast(err.message || '抓取失败', 'error');
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'AI 自动抓取';
    }
  });

  actionArea.appendChild(el('div', { class: 'form-row', style: 'flex-wrap:wrap;gap:10px;' }, priceInput, platformSel));
  actionArea.appendChild(el('div', { class: 'form-row', style: 'flex-wrap:wrap;gap:10px;' }, noteInput));
  actionArea.appendChild(el('div', { class: 'form-row', style: 'flex-wrap:wrap;gap:10px;' }, recordBtn));
  actionArea.appendChild(el('div', { class: 'form-row', style: 'flex-wrap:wrap;gap:10px;align-items:center;' },
    el('span', { style: 'color:var(--text-dim);font-size:13px;' }, '或'), fetchSel, fetchBtn));

  showModal(g.name || g.slug || '价格追踪', wrap, [el('button', { class: 'btn' }, '关闭')]);
  await refresh();
}

async function openGearUpdate(g) {
  const sourceUrl = getGearSourceUrl(g);
  const content = el('div', {});

  // 结果展示区（三个选项卡共用）
  const resultArea = el('div', { class: 'scrape-result' });

  // 选项卡按钮
  const tabs = el('div', { class: 'modal-tabs' });
  const panels = {};

  function switchTab(name) {
    for (const [n, btn] of Object.entries(buttons)) {
      btn.classList.toggle('active', n === name);
    }
    for (const [n, panel] of Object.entries(panels)) {
      panel.hidden = n !== name;
    }
  }

  const buttons = {};

  // ---------- 面板 1：网页抓取 ----------
  panels.scrape = el('div', {});
  const urlRow = el('div', { class: 'form-row' },
    el('label', {}, '商品 URL（REI / 品牌官网等）'),
    el('input', { id: 'update-url', type: 'url', value: sourceUrl, placeholder: 'https://www.rei.com/product/...' })
  );
  const scrapeBtn = el('button', { class: 'btn btn-primary' }, '从网页抓取');

  scrapeBtn.addEventListener('click', async () => {
    const url = $('#update-url').value.trim();
    if (!url) { toast('请先填写商品 URL', 'warn'); return; }
    scrapeBtn.disabled = true;
    scrapeBtn.textContent = '抓取中…';
    resultArea.innerHTML = '';
    try {
      const data = await fetchScrapeGear(state.apiUrl, state.token, url);
      const merged = mergeGearData(g, { ...data, source_url: url });
      renderScrapeResult(resultArea, merged, g);
    } catch (err) {
      resultArea.appendChild(el('div', { class: 'error-text' }, err.message || '抓取失败'));
    } finally {
      scrapeBtn.disabled = false;
      scrapeBtn.textContent = '从网页抓取';
    }
  });

  panels.scrape.appendChild(urlRow);
  panels.scrape.appendChild(scrapeBtn);

  // ---------- 面板 2：AI 识别 ----------
  panels.ai = el('div', {});
  const aiDefault = buildAiPrompt(g);
  const aiLabel = el('label', {}, '已根据当前装备生成描述，可直接识别，也可补充/修改后识别');
  const aiArea = el('textarea', { id: 'update-ai', rows: 6, placeholder: '例如：始祖鸟 Beta LT 硬壳冲锋衣，黑色 M 码，GORE-TEX 面料，重约 350g，价格 4500 元' }, aiDefault);
  const aiActions = el('div', { class: 'gear-card-actions' });
  const aiBtn = el('button', { class: 'btn btn-primary' }, 'AI 识别');
  const aiAutoBtn = el('button', { class: 'btn' }, '重新生成描述');
  aiActions.appendChild(aiBtn);
  aiActions.appendChild(aiAutoBtn);

  async function runAiRecognition() {
    const text = $('#update-ai').value.trim();
    if (!text) { toast('请先输入装备描述', 'warn'); return; }
    aiBtn.disabled = true;
    aiBtn.textContent = '识别中…';
    resultArea.innerHTML = '';
    try {
      const url = $('#update-url').value.trim();
      const res = await fetchAiGear(state.apiUrl, state.token, text, url);
      if (!res.ok || !res.data) {
        throw new Error(res.error || 'AI 未返回有效字段');
      }
      const merged = mergeGearData(g, { ...res.data, source_url: url || undefined });
      renderScrapeResult(resultArea, merged, g, res.provider);
    } catch (err) {
      resultArea.appendChild(el('div', { class: 'error-text' }, err.message || 'AI 识别失败'));
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = 'AI 识别';
    }
  }

  aiBtn.addEventListener('click', runAiRecognition);
  aiAutoBtn.addEventListener('click', () => {
    $('#update-ai').value = buildAiPrompt(g);
    toast('已重新生成描述', 'info');
  });

  panels.ai.appendChild(el('div', { class: 'form-row' }, aiLabel, aiArea));
  panels.ai.appendChild(aiActions);

  // ---------- 面板 3：粘贴规格 ----------
  panels.paste = el('div', {});
  const pasteLabel = el('label', {}, '粘贴商品规格文本（京东/天猫详情页复制即可）');
  const pasteArea = el('textarea', { id: 'update-spec', rows: 6, placeholder: '重量：380g\n面料：GORE-TEX 3L\n…' });
  const parseBtn = el('button', { class: 'btn' }, '解析粘贴文本');

  parseBtn.addEventListener('click', () => {
    const text = $('#update-spec').value.trim();
    if (!text) { toast('请先粘贴规格文本', 'warn'); return; }
    const parsed = parseSpecText(text);
    const merged = mergeGearData(g, parsed);
    renderScrapeResult(resultArea, merged, g);
  });

  panels.paste.appendChild(el('div', { class: 'form-row' }, pasteLabel, pasteArea));
  panels.paste.appendChild(parseBtn);

  // 组装选项卡：AI 识别放第一位
  for (const [name, label] of [['ai', 'AI 识别'], ['scrape', '网页抓取'], ['paste', '粘贴规格']]) {
    const btn = el('button', { class: 'modal-tab' + (name === 'ai' ? ' active' : ''), type: 'button' }, label);
    btn.addEventListener('click', () => switchTab(name));
    buttons[name] = btn;
    tabs.appendChild(btn);
  }

  content.appendChild(tabs);
  for (const panel of Object.values(panels)) {
    panel.className = 'modal-tab-panel';
    content.appendChild(panel);
  }
  // 默认显示 AI 识别选项卡
  switchTab('ai');
  content.appendChild(resultArea);

  showModal(g.name || g.slug || '更新装备', content, []);
}

/** 根据装备对象生成 AI 识别提示：只保留名称/品牌/型号，让 AI 自己检索参数。
 *  不把已知参数（重量、材质等）写进去，避免干扰 AI 反填更完整/准确的数据。
 */
function buildAiPrompt(g) {
  const parts = [];
  // 名称里通常已包含品牌/型号，避免重复；若名称缺失再用 brand/model 兜底
  if (g && g.name) {
    parts.push(g.name);
  } else if (g) {
    if (g.brand && g.model) parts.push(`${g.brand} ${g.model}`);
    else if (g.brand) parts.push(g.brand);
    else if (g.model) parts.push(g.model);
  }
  return parts.join(' ');
}

/** 生成 URL 安全的装备 slug，支持中英文混排 */
function slugifyGear(name, brand, model) {
  const raw = [brand, model, name].filter(Boolean).join(' ').trim().toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return slug || 'gear-' + Date.now();
}

/** 通过 AI 添加新装备 */
function openAddGearByAi() {
  const content = el('div', {});
  const resultArea = el('div', { class: 'scrape-result' });
  const label = el('label', {}, '输入装备描述，AI 会自动识别名称、品牌、重量、材质等字段');
  const textarea = el('textarea', { id: 'add-gear-ai', rows: 6, placeholder: '例如：始祖鸟 Beta LT 硬壳冲锋衣，黑色 M 码，GORE-TEX 面料，重约 350g，价格 4500 元' });
  const actions = el('div', { class: 'gear-card-actions' });
  const aiBtn = el('button', { class: 'btn btn-primary' }, 'AI 识别并生成');
  actions.appendChild(aiBtn);

  async function run() {
    const text = textarea.value.trim();
    if (!text) { toast('请先输入装备描述', 'warn'); return; }
    aiBtn.disabled = true;
    aiBtn.textContent = '识别中…';
    resultArea.innerHTML = '';
    try {
      const res = await fetchAiGear(state.apiUrl, state.token, text);
      if (!res.ok || !res.data) {
        throw new Error(res.error || 'AI 未返回有效字段');
      }
      const merged = { ...res.data, condition: 'good' };
      const slug = slugifyGear(merged.name, merged.brand, merged.model);
      const original = { slug };
      renderScrapeResult(resultArea, merged, original, res.provider);
    } catch (err) {
      resultArea.appendChild(el('div', { class: 'error-text' }, err.message || 'AI 识别失败'));
    } finally {
      aiBtn.disabled = false;
      aiBtn.textContent = 'AI 识别并生成';
    }
  }

  aiBtn.addEventListener('click', run);
  content.appendChild(el('div', { class: 'form-row' }, label, textarea));
  content.appendChild(actions);
  content.appendChild(resultArea);
  showModal('AI 添加装备', content, []);
}

/** 把用户选择的图片压缩成 base64 JPEG，减少上传体积。 */
function resizeImageFile(file, maxWidth = 1024, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round(height * maxWidth / width);
        width = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };
    img.src = url;
  });
}

/** 尝试从图片中解码条码/二维码。优先用原生 BarcodeDetector，否则返回 null 让后端识别。 */
async function decodeBarcodeFromFile(file) {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
    const barcodes = await detector.detect(file);
    if (barcodes && barcodes.length) return barcodes[0].rawValue || null;
  } catch {}
  return null;
}

async function fetchAiGearImage(apiUrl, token, imageDataUrl, barcodeHint) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/ai/gear-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ image_base64: imageDataUrl, barcode: barcodeHint || undefined }),
  }, 60000, 'AI 拍照识别装备');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`拍照识别失败 (${res.status})${t ? ': ' + t.slice(0, 120) : ''}`);
  }
  return res.json();
}

/** 通过拍照/条码识别添加新装备（B1）。 */
function openAddGearByPhoto() {
  if (!navigator.onLine) {
    toast('拍照识别需要联网，已切换到文字 AI 识别', 'info');
    openAddGearByAi();
    return;
  }

  const content = el('div', { class: 'photo-modal' });
  const resultArea = el('div', { class: 'scrape-result' });

  // 拍照识别面板
  const photoPanel = el('div', { class: 'photo-panel' },
    el('p', {}, '拍摄或选择装备照片，AI 会自动识别名称、品牌、类别、重量等字段。'),
    el('input', {
      type: 'file',
      accept: 'image/*',
      capture: 'environment',
      class: 'photo-file-input',
    })
  );

  // 条码识别面板
  const barcodePanel = el('div', { class: 'photo-panel', hidden: true },
    el('p', {}, '对准装备条码/二维码拍照，系统会自动解码并识别商品。'),
    el('input', {
      type: 'file',
      accept: 'image/*',
      capture: 'environment',
      class: 'photo-file-input',
    }),
    el('div', { class: 'barcode-hint' })
  );

  let currentMode = 'photo';
  function switchPhotoMode(mode) {
    currentMode = mode;
    photoTab.classList.toggle('active', mode === 'photo');
    barcodeTab.classList.toggle('active', mode === 'barcode');
    photoPanel.hidden = mode !== 'photo';
    barcodePanel.hidden = mode !== 'barcode';
    resultArea.innerHTML = '';
  }

  const tabs = el('div', { class: 'modal-tabs' });
  const photoTab = el('button', { class: 'modal-tab-btn active' }, '📷 拍装备');
  const barcodeTab = el('button', { class: 'modal-tab-btn' }, '🔍 扫条码');
  photoTab.addEventListener('click', () => switchPhotoMode('photo'));
  barcodeTab.addEventListener('click', () => switchPhotoMode('barcode'));
  tabs.appendChild(photoTab);
  tabs.appendChild(barcodeTab);

  async function handleFile(file, mode) {
    if (!file) return;
    resultArea.innerHTML = el('div', { class: 'empty' }, '正在压缩并识别…').outerHTML;

    let barcodeHint = null;
    if (mode === 'barcode') {
      barcodeHint = await decodeBarcodeFromFile(file);
      const hintEl = $('.barcode-hint', barcodePanel);
      if (hintEl) {
        hintEl.textContent = barcodeHint
          ? `已识别条码：${barcodeHint}，将用于辅助识别`
          : '未识别到条码，将把照片交给 AI 识别';
      }
    }

    try {
      const dataUrl = await resizeImageFile(file);
      const res = await fetchAiGearImage(state.apiUrl, state.token, dataUrl, barcodeHint);
      if (!res.ok || !res.data) {
        throw new Error(res.error || 'AI 未返回有效字段');
      }
      const merged = { ...res.data, condition: 'good' };
      const slug = slugifyGear(merged.name, merged.brand, merged.model);
      const original = { slug };
      renderScrapeResult(resultArea, merged, original, res.provider);
    } catch (err) {
      resultArea.innerHTML = '';
      resultArea.appendChild(el('div', { class: 'error-text' }, err.message || '拍照识别失败'));
    }
  }

  $('.photo-file-input', photoPanel).addEventListener('change', (e) => handleFile(e.target.files[0], 'photo'));
  $('.photo-file-input', barcodePanel).addEventListener('change', (e) => handleFile(e.target.files[0], 'barcode'));

  content.appendChild(tabs);
  content.appendChild(photoPanel);
  content.appendChild(barcodePanel);
  content.appendChild(resultArea);
  showModal('拍照/扫码添加装备', content, []);
}

function renderScrapeResult(container, merged, original, provider) {
  container.innerHTML = '';
  const titleText = provider ? `AI 识别结果（${provider === 'moonshot' ? 'Kimi' : 'DeepSeek'}）` : '抓取结果';
  const title = el('div', { class: 'section-title' }, `${titleText}（确认后保存）`);
  container.appendChild(title);
  container.appendChild(gearFactList(merged));

  const changed = [];
  for (const k of Object.keys(merged)) {
    if (JSON.stringify(merged[k]) !== JSON.stringify(original[k])) changed.push(k);
  }
  if (!changed.length) {
    container.appendChild(el('div', { class: 'empty' }, '没有识别到新字段，请尝试输入更完整的描述或规格文本。'));
    return;
  }

  const saveBtn = el('button', { class: 'btn btn-primary' }, `保存（更新 ${changed.length} 个字段）`);
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      await fetchSaveGear(state.apiUrl, state.token, original.slug, packGearPayload(merged));
      toast('保存成功，正在刷新…', 'success');
      await loadAndRender(true);
      // 关闭所有 modal（简单做法）
      $$('.modal-overlay').forEach((m) => m.remove());
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = `保存（更新 ${changed.length} 个字段）`;
    }
  });
  container.appendChild(saveBtn);
}
