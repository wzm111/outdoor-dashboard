/* 路线库视图渲染 */
'use strict';

// ---------- 路线 ----------

function buildRouteMarkdown(data) {
  const lines = ['---'];
  lines.push(`name: "${data.name}"`);
  if (data.location) lines.push(`location: "${data.location}"`);
  if (data.weather_city) lines.push(`weather_city: "${data.weather_city}"`);
  if (data.distance_km != null) lines.push(`distance_km: ${data.distance_km}`);
  if (data.elevation_gain_m != null) lines.push(`elevation_gain_m: ${data.elevation_gain_m}`);
  if (data.elevation_loss_m != null) lines.push(`elevation_loss_m: ${data.elevation_loss_m}`);
  if (data.max_altitude_m != null) lines.push(`max_altitude_m: ${data.max_altitude_m}`);
  if (data.difficulty) lines.push(`difficulty: ${data.difficulty}`);
  if (data.estimated_hours != null) lines.push(`estimated_hours: ${data.estimated_hours}`);
  if (Array.isArray(data.terrain) && data.terrain.length) { lines.push('terrain:'); for (const s of data.terrain) lines.push(`  - ${s}`); }
  if (Array.isArray(data.best_seasons) && data.best_seasons.length) { lines.push('best_seasons:'); for (const s of data.best_seasons) lines.push(`  - ${s}`); }
  if (Array.isArray(data.water_sources) && data.water_sources.length) { lines.push('water_sources:'); for (const s of data.water_sources) lines.push(`  - ${s}`); }
  if (data.source_url) lines.push(`source_url: "${data.source_url}"`);
  if (data.notes) lines.push(`notes: "${data.notes}"`);
  lines.push('---');
  return lines.join('\n');
}

function parseCommaList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return String(v).split(/[,，/、]/).map((s) => s.trim()).filter(Boolean);
}

/** 弹窗手动添加/编辑路线。 */
function openAddRoute(route = null) {
  if (!state.token) { toast('请先连接后再添加路线', 'warn'); return; }

  const nameInput = el('input', { type: 'text', class: 'gear-select', value: route ? route.name || '' : '', placeholder: '路线名称', style: 'width:100%;' });
  const slugInput = el('input', { type: 'text', class: 'gear-select', value: route ? route.slug : slugifyRoute(nameInput.value), placeholder: '路线 ID（slug）', style: 'width:100%;' });
  if (route) slugInput.disabled = true;
  const locationInput = el('input', { type: 'text', class: 'gear-select', value: route ? route.location || '' : '', placeholder: '省市 / 山区', style: 'width:100%;' });
  const weatherCityInput = el('input', { type: 'text', class: 'gear-select', value: route ? route.weather_city || '' : '', placeholder: '最近城市，用于查天气', style: 'width:100%;' });
  const distInput = el('input', { type: 'number', class: 'gear-select', value: route ? route.distance_km != null ? route.distance_km : '' : '', step: '0.1', placeholder: '公里', style: 'width:100%;' });
  const gainInput = el('input', { type: 'number', class: 'gear-select', value: route ? route.elevation_gain_m != null ? route.elevation_gain_m : '' : '', placeholder: '米', style: 'width:100%;' });
  const lossInput = el('input', { type: 'number', class: 'gear-select', value: route ? route.elevation_loss_m != null ? route.elevation_loss_m : '' : '', placeholder: '米', style: 'width:100%;' });
  const maxAltInput = el('input', { type: 'number', class: 'gear-select', value: route ? route.max_altitude_m != null ? route.max_altitude_m : '' : '', placeholder: '米', style: 'width:100%;' });
  const diffSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（未选择）'),
    el('option', { value: 'easy' }, '简单 easy'),
    el('option', { value: 'moderate' }, '适中 moderate'),
    el('option', { value: 'hard' }, '困难 hard'),
    el('option', { value: 'extreme' }, '极难 extreme')
  );
  if (route && route.difficulty) diffSel.value = route.difficulty;
  const hoursInput = el('input', { type: 'number', class: 'gear-select', value: route ? route.estimated_hours != null ? route.estimated_hours : '' : '', step: '0.1', placeholder: '小时', style: 'width:100%;' });
  const terrainInput = el('input', { type: 'text', class: 'gear-select', value: route ? Array.isArray(route.terrain) ? route.terrain.join('、') : route.terrain || '' : '', placeholder: 'rock, grass, ridge（用逗号分隔）', style: 'width:100%;' });
  const seasonsInput = el('input', { type: 'text', class: 'gear-select', value: route ? Array.isArray(route.best_seasons) ? route.best_seasons.join('、') : route.best_seasons || '' : '', placeholder: 'spring, autumn（用逗号分隔）', style: 'width:100%;' });
  const waterInput = el('input', { type: 'text', class: 'gear-select', value: route ? Array.isArray(route.water_sources) ? route.water_sources.join('、') : route.water_sources || '' : '', placeholder: '起点, 山顶补给站（用逗号分隔）', style: 'width:100%;' });
  const sourceInput = el('input', { type: 'url', class: 'gear-select', value: route ? route.source_url || '' : '', placeholder: 'https://...', style: 'width:100%;' });
  const notesInput = el('textarea', { class: 'gear-select', rows: 3, placeholder: '路线备注', style: 'width:100%;' }, route ? route.notes || '' : '');

  // 新增路线时自动根据名称生成 slug
  if (!route) {
    nameInput.addEventListener('input', () => { slugInput.value = slugifyRoute(nameInput.value); });
  }

  const form = el('div', { class: 'recommend-form' },
    el('div', { class: 'form-row' }, el('label', {}, '名称 *'), nameInput),
    route ? el('div', { class: 'form-row' }, el('label', {}, '路线 ID'), slugInput) : el('div', { class: 'form-row' }, el('label', {}, '路线 ID *'), slugInput),
    el('div', { class: 'form-row' }, el('label', {}, '地点'), locationInput),
    el('div', { class: 'form-row' }, el('label', {}, '天气城市'), weatherCityInput),
    el('div', { class: 'form-row' }, el('label', {}, '距离 (km)'), distInput),
    el('div', { class: 'form-row' }, el('label', {}, '爬升 (m)'), gainInput),
    el('div', { class: 'form-row' }, el('label', {}, '下降 (m)'), lossInput),
    el('div', { class: 'form-row' }, el('label', {}, '最高海拔 (m)'), maxAltInput),
    el('div', { class: 'form-row' }, el('label', {}, '难度'), diffSel),
    el('div', { class: 'form-row' }, el('label', {}, '预计时长 (h)'), hoursInput),
    el('div', { class: 'form-row' }, el('label', {}, '地形'), terrainInput),
    el('div', { class: 'form-row' }, el('label', {}, '最佳季节'), seasonsInput),
    el('div', { class: 'form-row' }, el('label', {}, '水源'), waterInput),
    el('div', { class: 'form-row' }, el('label', {}, '来源链接'), sourceInput),
    el('div', { class: 'form-row' }, el('label', {}, '备注'), notesInput)
  );

  const saveBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, route ? '保存修改' : '添加路线');
  const originalSlug = route ? route.slug : null;

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const slug = slugInput.value.trim();
    if (!name || !slug) { toast('请填写名称和路线 ID', 'warn'); return; }
    const data = { name };
    const loc = locationInput.value.trim(); if (loc) data.location = loc;
    const wc = weatherCityInput.value.trim(); if (wc) data.weather_city = wc;
    const d = Number(distInput.value); if (!isNaN(d) && d >= 0) data.distance_km = d;
    const g = Number(gainInput.value); if (!isNaN(g)) data.elevation_gain_m = g;
    const l = Number(lossInput.value); if (!isNaN(l)) data.elevation_loss_m = l;
    const m = Number(maxAltInput.value); if (!isNaN(m)) data.max_altitude_m = m;
    if (diffSel.value) data.difficulty = diffSel.value;
    const h = Number(hoursInput.value); if (!isNaN(h) && h >= 0) data.estimated_hours = h;
    const terrain = parseCommaList(terrainInput.value); if (terrain.length) data.terrain = terrain;
    const seasons = parseCommaList(seasonsInput.value); if (seasons.length) data.best_seasons = seasons;
    const water = parseCommaList(waterInput.value); if (water.length) data.water_sources = water;
    const src = sourceInput.value.trim(); if (src) data.source_url = src;
    const notes = notesInput.value.trim(); if (notes) data.notes = notes;

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      if (originalSlug && originalSlug !== slug) {
        await fetchDelete(state.apiUrl, state.token, 'routes', originalSlug);
      }
      await fetchSaveRoute(state.apiUrl, state.token, slug, { data, raw_markdown: buildRouteMarkdown(data) });
      toast('路线已保存', 'success');
      close();
      await loadAndRender(true);
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = route ? '保存修改' : '添加路线';
    }
  });

  const close = showModal(route ? '编辑路线' : '添加路线', form, [saveBtn, el('button', { class: 'btn' }, '关闭')]);
}

function renderRoutes() {
  const routes = [...state.data.routes].sort((a, b) =>
    (Number(b.distance_km) || 0) - (Number(a.distance_km) || 0));
  const view = viewEl('routes');
  clearViewKeepSkeleton(view);
  // 顶部标题 + AI 添加 + 推荐装备按钮（空列表时按钮也保留）
  const headerRow = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, `路线库（${routes.length}）`),
    el('div', { style: 'display:flex;gap:8px;' },
      el('button', { class: 'btn-sm btn-primary', 'data-action': 'recommend-gear' }, '推荐装备'),
      el('button', { class: 'btn-sm', 'data-action': 'add-route' }, '添加路线'),
      el('button', { class: 'btn-sm btn-primary', 'data-action': 'add-route-ai' }, 'AI 添加')
    )
  );
  view.appendChild(headerRow);
  $('.btn-sm[data-action="add-route"]', headerRow).addEventListener('click', () => openAddRoute());
  $('.btn-sm[data-action="add-route-ai"]', headerRow).addEventListener('click', () => openAddRouteByAi());
  $('.btn-sm[data-action="recommend-gear"]', headerRow).addEventListener('click', () => openRecommendGear());

  if (!routes.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无路线'));
    return;
  }

  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {},
    el('th', {}, '名称'), el('th', {}, '地点'), el('th', {}, '距离'),
    el('th', {}, '爬升'), el('th', {}, '难度'), el('th', {}, '预计时长'),
    el('th', {}, '操作'),
  )));
  const tbody = el('tbody');
  for (const r of routes) {
    const diff = r.difficulty;
    const cls = diff === 'hard' || diff === 'extreme' ? 'hard'
      : diff === 'moderate' ? 'moderate' : 'easy';
    const tr = el('tr', { class: 'route-row' },
      el('td', {}, r.name || r.slug || '—'),
      el('td', {}, r.location || '—'),
      el('td', { class: 'num' }, num(r.distance_km) + ' km'),
      el('td', { class: 'num' }, num(r.elevation_gain_m, 0) + ' m'),
      el('td', {}, diff ? el('span', { class: 'badge ' + cls }, diff) : '—'),
      el('td', { class: 'num' }, r.estimated_hours != null ? num(r.estimated_hours) + ' h' : '—'),
      el('td', {},
        el('button', { class: 'btn-sm', 'data-action': 'detail', style: 'margin-right:6px;' }, '详情'),
        el('button', { class: 'btn-sm', 'data-action': 'edit', style: 'margin-right:6px;' }, '编辑'),
        el('button', { class: 'btn-sm btn-primary', 'data-action': 'recommend', style: 'margin-right:6px;' }, '推荐'),
        el('button', { class: 'btn-sm btn-danger', 'data-action': 'delete' }, '删除')
      )
    );
    $('.btn-sm[data-action="detail"]', tr).addEventListener('click', () => openRouteDetail(r));
    $('.btn-sm[data-action="edit"]', tr).addEventListener('click', () => openAddRoute(r));
    $('.btn-sm[data-action="recommend"]', tr).addEventListener('click', () => openRecommendGear(r));
    $('.btn-sm[data-action="delete"]', tr).addEventListener('click', async () => {
      const used = state.data.activities.filter((a) => a.route === r.name || a.route === r.slug).length;
      const msg = used
        ? `路线「${r.name || r.slug}」已被 ${used} 条活动记录引用。删除路线不会影响已有活动，但活动详情中的路线名会保留。确认删除？`
        : `确认删除路线「${r.name || r.slug}」？`;
      if (!confirm(msg)) return;
      try {
        await fetchDelete(state.apiUrl, state.token, 'routes', r.slug);
        toast('路线已删除', 'success');
        await loadAndRender(true);
      } catch (err) {
        toast(err.message || '删除失败', 'error');
      }
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  view.appendChild(wrap);
}

function openRouteDetail(r) {
  const wrap = el('div', { class: 'route-detail-modal-body' });

  // 顶部统计卡片
  wrap.appendChild(routeDetailStats(r));

  // 基本信息
  const meta = routeDetailMetadata(r);
  if (meta) wrap.appendChild(meta);

  // 扩展详情
  const extended = routeDetailExtended(r);
  if (extended) wrap.appendChild(extended);

  // GPX 海拔剖面
  const gpxSection = el('div', { class: 'route-detail-section' });
  gpxSection.appendChild(el('div', { class: 'section-title' }, 'GPX 海拔剖面'));
  const gpxPanel = el('div', { class: 'route-detail-gpx-panel' },
    el('div', { class: 'skeleton skeleton-route-chart' }));
  gpxSection.appendChild(gpxPanel);
  wrap.appendChild(gpxSection);
  routeDetailGpxPanel(r, gpxPanel);

  // 历史活动
  const acts = routeRelatedActivities(r);
  wrap.appendChild(routeDetailActivities(r, acts));

  showModal(r.name || r.slug || '路线详情', wrap,
    [el('button', { class: 'btn' }, '关闭')], null, 'modal-wide');
}

function routeDetailStats(r) {
  const grid = el('div', { class: 'stat-grid route-detail-stats' });
  const st = (label, value, unit) =>
    el('div', { class: 'stat-card' },
      el('div', { class: 'label' }, label),
      el('div', { class: 'value' }, value,
        unit ? el('span', { class: 'unit' }, unit) : ''));
  grid.appendChild(st('距离', num(r.distance_km), 'km'));
  grid.appendChild(st('爬升', num(r.elevation_gain_m, 0), 'm'));
  grid.appendChild(st('下降', num(r.elevation_loss_m, 0), 'm'));
  grid.appendChild(st('最高海拔', num(r.max_altitude_m, 0), 'm'));
  grid.appendChild(st('预计时长', num(r.estimated_hours), 'h'));
  const diffMap = { easy: '简单', moderate: '适中', hard: '困难', extreme: '极难' };
  const diffText = diffMap[r.difficulty] || r.difficulty;
  grid.appendChild(st('难度', diffText || '—'));
  return grid;
}

function routeDetailMetadata(r) {
  const items = [];
  if (r.location) items.push(['地点', r.location]);
  if (r.weather_city) items.push(['天气城市', r.weather_city]);
  const terrain = fmtStringList(r.terrain);
  if (terrain) items.push(['地形', terrain]);
  const seasons = fmtStringList(r.best_seasons);
  if (seasons) items.push(['最佳季节', seasons]);
  const water = fmtStringList(r.water_sources);
  if (water) items.push(['水源', water]);
  if (r.source_url) {
    items.push(['来源', el('a', { href: r.source_url, target: '_blank', rel: 'noopener' }, r.source_url)]);
  }
  if (r.notes) items.push(['备注', r.notes]);
  if (!items.length) return null;

  const section = el('div', { class: 'route-detail-section' });
  section.appendChild(el('div', { class: 'section-title' }, '基本信息'));
  const grid = el('div', { class: 'route-meta-grid' });
  for (const [k, v] of items) {
    grid.appendChild(el('div', { class: 'route-meta-label' }, k));
    grid.appendChild(el('div', { class: 'route-meta-value' }, v));
  }
  section.appendChild(grid);
  return section;
}

function routeDetailExtended(r) {
  const blocks = [];
  if (r.suggested_days) {
    blocks.push(el('div', { class: 'route-extended-block' },
      el('div', { class: 'route-extended-title' }, '建议天数'),
      el('div', {}, String(r.suggested_days) + ' 天')));
  }
  if (Array.isArray(r.suitable_for) && r.suitable_for.length) {
    blocks.push(el('div', { class: 'route-extended-block' },
      el('div', { class: 'route-extended-title' }, '适合人群'),
      el('div', {}, r.suitable_for.join('、'))));
  }
  if (Array.isArray(r.not_suitable_for) && r.not_suitable_for.length) {
    blocks.push(el('div', { class: 'route-extended-block' },
      el('div', { class: 'route-extended-title' }, '不适合人群'),
      el('div', {}, r.not_suitable_for.join('、'))));
  }
  if (r.trail_condition) {
    blocks.push(el('div', { class: 'route-extended-block' },
      el('div', { class: 'route-extended-title' }, '路况'),
      el('div', {}, r.trail_condition)));
  }
  if (r.season_notes) {
    blocks.push(el('div', { class: 'route-extended-block' },
      el('div', { class: 'route-extended-title' }, '季节说明'),
      el('div', {}, r.season_notes)));
  }
  if (Array.isArray(r.day_by_day) && r.day_by_day.length) {
    const list = el('div', { class: 'route-day-list' });
    for (const day of r.day_by_day) {
      const title = day.title || (day.day ? `第 ${day.day} 天` : null) || `第 ${day.day_index || '?'} 天`;
      const desc = [
        day.distance_km != null ? num(day.distance_km) + ' km' : null,
        day.elevation_gain_m != null ? num(day.elevation_gain_m, 0) + ' m' : null,
        day.description,
      ].filter(Boolean).join(' · ');
      list.appendChild(el('div', { class: 'route-day-card' },
        el('div', { class: 'route-day-title' }, title),
        desc ? el('div', { class: 'route-day-desc' }, desc) : ''));
    }
    blocks.push(el('div', { class: 'route-extended-block' },
      el('div', { class: 'route-extended-title' }, '分段行程'),
      list));
  }
  if (Array.isArray(r.bailout_points) && r.bailout_points.length) {
    const list = el('div', { class: 'route-bailout-list' });
    for (const bp of r.bailout_points) {
      const loc = typeof bp === 'string' ? bp : (bp.location || bp.name || '');
      const desc = typeof bp === 'string' ? '' : (bp.description || '');
      list.appendChild(el('div', { class: 'route-bailout-item' },
        el('div', { class: 'route-bailout-loc' }, '🚨 ' + loc),
        desc ? el('div', { class: 'route-bailout-desc' }, desc) : ''));
    }
    blocks.push(el('div', { class: 'route-extended-block' },
      el('div', { class: 'route-extended-title' }, '下撤点'),
      list));
  }
  if (Array.isArray(r.accommodation) && r.accommodation.length) {
    const list = el('div', { class: 'route-accom-list' });
    for (const acc of r.accommodation) {
      const loc = typeof acc === 'string' ? acc : (acc.location || acc.name || '');
      const type = typeof acc === 'string' ? '' : (acc.type || '');
      const note = typeof acc === 'string' ? '' : (acc.note || '');
      list.appendChild(el('div', { class: 'route-accom-item' },
        el('div', {}, (type ? type + ' · ' : '') + loc),
        note ? el('div', { class: 'route-accom-note' }, note) : ''));
    }
    blocks.push(el('div', { class: 'route-extended-block' },
      el('div', { class: 'route-extended-title' }, '住宿/营地'),
      list));
  }
  if (!blocks.length) return null;

  const section = el('div', { class: 'route-detail-section' });
  section.appendChild(el('div', { class: 'section-title' }, '路线详情'));
  for (const b of blocks) section.appendChild(b);
  return section;
}

function routeRelatedActivities(r) {
  const name = String(r.name || '').trim();
  const slug = String(r.slug || '').trim();
  return (state.data.activities || [])
    .filter((a) => {
      const ar = String(a.route || '').trim();
      return ar && (ar === name || ar === slug);
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function routeActivityStats(acts) {
  if (!acts.length) return null;
  const times = acts.map((a) => Number(a.duration_hours)).filter((v) => !isNaN(v) && v > 0);
  const dists = acts.map((a) => Number(a.distance_km)).filter((v) => !isNaN(v) && v > 0);
  return {
    count: acts.length,
    bestTime: times.length ? Math.min(...times) : null,
    avgTime: times.length ? times.reduce((s, v) => s + v, 0) / times.length : null,
    avgDistance: dists.length ? dists.reduce((s, v) => s + v, 0) / dists.length : null,
  };
}

function routeDetailActivities(r, acts) {
  const section = el('div', { class: 'route-detail-section' });
  const stats = routeActivityStats(acts);
  section.appendChild(el('div', { class: 'section-title' }, `历史活动（${acts.length}）`));
  if (!acts.length) {
    section.appendChild(el('div', { class: 'empty' }, '暂无关联活动记录'));
    return section;
  }

  if (stats) {
    const statRow = el('div', { class: 'elevation-stat-row' });
    const stat = (label, value, unit) =>
      el('div', { class: 'elevation-stat' },
        el('div', { class: 'elevation-stat-value' }, value,
          unit ? el('span', { class: 'elevation-stat-unit' }, unit) : ''),
        el('div', { class: 'elevation-stat-label' }, label));
    statRow.appendChild(stat('次数', stats.count));
    statRow.appendChild(stat('平均距离', stats.avgDistance != null ? num(stats.avgDistance, 1) : '—', 'km'));
    statRow.appendChild(stat('平均时长', stats.avgTime != null ? num(stats.avgTime, 1) : '—', 'h'));
    statRow.appendChild(stat('最快用时', stats.bestTime != null ? fmtDuration(stats.bestTime) : '—'));
    section.appendChild(statRow);
  }

  const list = el('div', { class: 'rel-list route-detail-activity-list' });
  for (const a of acts) {
    list.appendChild(routeActivityRow(a, stats && stats.bestTime));
  }
  section.appendChild(list);
  return section;
}

function routeActivityRow(a, bestDuration) {
  const isBest = bestDuration != null && Number(a.duration_hours) === bestDuration;
  const item = el('div', { class: 'rel-item' + (isBest ? ' route-activity-best' : '') });
  const info = el('div', { class: 'rel-info' });
  info.appendChild(el('div', { class: 'rel-name' }, `${fmtDate(a.date)} · ${a.route || '活动'}`));
  const parts = [
    a.type,
    a.distance_km != null ? num(a.distance_km) + ' km' : null,
    a.elevation_gain_m != null ? num(a.elevation_gain_m, 0) + ' m' : null,
    a.duration_hours != null ? fmtDuration(a.duration_hours) : null,
    paceMinPerKm(a.distance_km, a.duration_hours),
    a.felt ? `感受:${a.felt}` : null,
  ].filter(Boolean);
  info.appendChild(el('div', { class: 'rel-brief' }, parts.join(' · ') || '—'));
  item.appendChild(info);
  if (isBest) {
    item.appendChild(el('span', { class: 'badge easy' }, '最快'));
  }
  return item;
}

async function routeDetailGpxPanel(r, container) {
  container.innerHTML = '';
  const url = r.gpx_file ? String(r.gpx_file).trim() : '';
  if (!url || !url.startsWith('http')) {
    container.appendChild(el('div', { class: 'empty' }, '未配置可在线访问的 GPX 轨迹'));
    return;
  }

  container.appendChild(el('div', { class: 'skeleton skeleton-route-chart' }));
  try {
    const res = await fetchGpxWithCache(url);
    if (!res.ok) {
      container.innerHTML = '';
      container.appendChild(el('div', { class: 'empty' }, `无法加载 GPX：${res.error || '未知错误'}`));
      return;
    }
    const points = parseGpxXml(res.text);
    if (!points.length) {
      container.innerHTML = '';
      container.appendChild(el('div', { class: 'empty' }, 'GPX 中未找到轨迹点'));
      return;
    }
    const simple = simplifyGpxPoints(points, 800);
    const stats = computeGpxStats(points);
    container.innerHTML = '';
    container.appendChild(elevationProfileCard('海拔剖面', simple, { stats, height: 220 }));
  } catch (err) {
    container.innerHTML = '';
    container.appendChild(el('div', { class: 'empty' }, `GPX 解析失败：${err.message || '未知错误'}`));
  }
}

/** 生成 URL 安全的路线 slug，支持中英文混排（参照 slugifyGear）。 */
function slugifyRoute(name) {
  const raw = String(name || '').trim().toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return slug || 'route-' + Date.now();
}

/** 把扁平路线对象包成 PUT /routes/:slug 需要的 { data } 结构（剔除注入字段）。 */
function packRoutePayload(data) {
  const copy = { ...data };
  delete copy.slug;
  delete copy._raw_markdown;
  delete copy._updated_at;
  delete copy._path;
  return { data: copy };
}

/** 路线字段预览表（保存前确认用）。 */
function routeFactList(r) {
  const facts = [
    ['名称', r.name],
    ['地点', r.location],
    ['天气城市', r.weather_city],
    ['距离', r.distance_km != null ? num(r.distance_km) + ' km' : null],
    ['爬升', r.elevation_gain_m != null ? num(r.elevation_gain_m, 0) + ' m' : null],
    ['下降', r.elevation_loss_m != null ? num(r.elevation_loss_m, 0) + ' m' : null],
    ['最高海拔', r.max_altitude_m != null ? num(r.max_altitude_m, 0) + ' m' : null],
    ['难度', r.difficulty],
    ['预计时长', r.estimated_hours != null ? num(r.estimated_hours) + ' h' : null],
    ['地形', Array.isArray(r.terrain) ? r.terrain.join('、') : r.terrain],
    ['最佳季节', fmtStringList(r.best_seasons)],
    ['水源', fmtStringList(r.water_sources)],
    ['备注', r.notes],
  ].filter(([, v]) => v != null && v !== '');
  const list = el('ul', { class: 'detail-list' });
  for (const [k, v] of facts) {
    list.appendChild(el('li', {}, el('strong', {}, k + '：'), document.createTextNode(String(v))));
  }
  return list;
}

/** 渲染 AI 路线解析结果 + slug 输入 + 保存按钮。 */
function renderRouteAiResult(container, parsed, provider) {
  container.innerHTML = '';
  if (!parsed || !parsed.name) {
    container.appendChild(el('div', { class: 'empty' }, '没有识别到路线名称，请补充更完整的描述（至少给出路线名）。'));
    return;
  }
  const titleText = provider ? `AI 识别结果（${provider === 'moonshot' ? 'Kimi' : 'DeepSeek'}）` : '识别结果';
  container.appendChild(el('div', { class: 'section-title' }, `${titleText}（确认后保存）`));
  container.appendChild(routeFactList(parsed));

  // slug 可编辑（默认按名称生成）；若与已有路线重名，保存即为覆盖更新，给出提示。
  const existing = new Set((state.data.routes || []).map((r) => r.slug));
  const defSlug = slugifyRoute(parsed.name);
  const slugInput = el('input', { type: 'text', class: 'gear-select', value: defSlug, style: 'width:100%;' });
  const slugRow = el('div', { class: 'form-row' },
    el('label', {}, '路线 ID（slug，可修改；与已有路线相同则覆盖更新）'), slugInput);
  container.appendChild(slugRow);

  const dupHint = el('div', { class: 'wear-badge warn', style: 'display:none;margin:6px 0;' }, '');
  container.appendChild(dupHint);
  const refreshDup = () => {
    if (existing.has(slugInput.value.trim())) {
      dupHint.style.display = ''; dupHint.textContent = '已存在同 ID 路线，保存将覆盖它';
    } else { dupHint.style.display = 'none'; }
  };
  slugInput.addEventListener('input', refreshDup);
  refreshDup();

  const saveBtn = el('button', { class: 'btn btn-primary' }, '保存路线');
  saveBtn.addEventListener('click', async () => {
    const slug = slugInput.value.trim();
    if (!slug) { toast('请填写路线 ID', 'warn'); return; }
    if (!state.token) { toast('未连接，无法保存', 'error'); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      await fetchSaveRoute(state.apiUrl, state.token, slug, packRoutePayload(parsed));
      toast('保存成功，正在刷新…', 'success');
      await loadAndRender(true);
      $$('.modal-overlay').forEach((m) => m.remove());
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '保存路线';
    }
  });
  container.appendChild(saveBtn);
}

/** 通过 AI 一句话添加新路线。 */
function openAddRouteByAi() {
  if (!state.token) { toast('请先连接后再添加路线', 'warn'); return; }
  const content = el('div', {});
  const resultArea = el('div', { class: 'scrape-result' });
  const label = el('label', {}, '用一句话描述路线，AI 会识别名称、距离、爬升、难度等字段');
  const textarea = el('textarea', { id: 'add-route-ai', rows: 5, placeholder: '例如：武功山反穿，江西萍乡，24km 爬升1800m，山脊草甸地形，预计10小时' });
  const actions = el('div', { class: 'gear-card-actions' });
  const aiBtn = el('button', { class: 'btn btn-primary' }, 'AI 识别并生成');
  actions.appendChild(aiBtn);

  async function run() {
    const text = textarea.value.trim();
    if (!text) { toast('请先输入路线描述', 'warn'); return; }
    aiBtn.disabled = true;
    aiBtn.textContent = '识别中…';
    resultArea.innerHTML = '';
    try {
      const res = await fetchAiRoute(state.apiUrl, state.token, text);
      if (!res.ok || !res.data) {
        throw new Error(res.error || 'AI 未返回有效字段');
      }
      renderRouteAiResult(resultArea, res.data, res.provider);
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
  showModal('AI 添加路线', content, []);
}
