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
  const facts = [
    ['slug', r.slug],
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
    ['GPX', r.gpx_file],
    ['来源', r.source_url],
    ['备注', r.notes],
  ].filter(([, v]) => v != null && v !== '');

  const list = el('ul', { class: 'detail-list' });
  for (const [k, v] of facts) {
    const li = el('li', {}, el('strong', {}, k + '：'));
    if ((k === '来源' || k === 'GPX') && String(v).startsWith('http')) {
      li.appendChild(el('a', { href: v, target: '_blank', rel: 'noopener' }, v));
    } else {
      li.appendChild(document.createTextNode(v));
    }
    list.appendChild(li);
  }
  showModal(r.name || r.slug || '路线详情', list, [el('button', { class: 'btn' }, '关闭')]);
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
