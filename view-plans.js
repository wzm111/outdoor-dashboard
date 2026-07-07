/* 计划视图渲染 */
'use strict';

// ---------- 计划 ----------

/** 更新计划：PUT /plans/:id。 */
async function fetchUpdatePlan(apiUrl, token, id, payload) {
  const url = `${apiBase(apiUrl)}/plans/${encodeURIComponent(id)}`;
  const expectedUpdatedAt = getExpectedUpdatedAt('plans', id);
  const options = {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ ...payload, expected_updated_at: expectedUpdatedAt }),
  };
  return mutateRequest({
    url,
    options,
    label: '更新计划',
    expectedUpdatedAt,
    optimistic: () => {
      const idx = state.data.plans.findIndex((p) => String(p.id) === String(id));
      if (idx >= 0) state.data.plans[idx] = { ...state.data.plans[idx], ...payload.data };
      renderPlans();
      saveSnapshot();
    },
  });
}

function buildPlanMarkdown(data) {
  const lines = ['---'];
  lines.push(`plan_type: ${data.plan_type || 'trip'}`);
  lines.push(`date: "${data.date}"`);
  if (data.route) lines.push(`route: "${data.route}"`);
  if (data.distance_km != null) lines.push(`distance_km: ${data.distance_km}`);
  if (data.elevation_gain_m != null) lines.push(`elevation_gain_m: ${data.elevation_gain_m}`);
  if (data.estimated_hours != null) lines.push(`estimated_hours: ${data.estimated_hours}`);
  if (data.recovery_days != null) lines.push(`recovery_days: ${data.recovery_days}`);
  if (data.intensity_level) lines.push(`intensity_level: ${data.intensity_level}`);
  if (data.notes) lines.push(`notes: "${data.notes}"`);
  lines.push('---');
  return lines.join('\n');
}

/** 弹窗手动添加/编辑计划。 */
function openAddPlan(plan = null) {
  if (!state.token) { toast('请先连接后再添加计划', 'warn'); return; }

  const today = new Date().toISOString().slice(0, 10);
  const typeSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: 'trip' }, '行程 trip'),
    el('option', { value: 'recovery' }, '恢复 recovery')
  );
  if (plan && plan.plan_type) typeSel.value = plan.plan_type;
  const dateInput = el('input', { type: 'date', class: 'gear-select', value: plan ? fmtDate(plan.date) : today, style: 'width:100%;' });
  const routeInput = el('input', { type: 'text', class: 'gear-select', value: plan ? plan.route || '' : '', placeholder: '路线名称（恢复计划可留空）', style: 'width:100%;' });
  const distInput = el('input', { type: 'number', class: 'gear-select', value: plan && plan.distance_km != null ? plan.distance_km : '', step: '0.1', placeholder: '公里', style: 'width:100%;' });
  const gainInput = el('input', { type: 'number', class: 'gear-select', value: plan && plan.elevation_gain_m != null ? plan.elevation_gain_m : '', placeholder: '米', style: 'width:100%;' });
  const hoursInput = el('input', { type: 'number', class: 'gear-select', value: plan && plan.estimated_hours != null ? plan.estimated_hours : '', step: '0.1', placeholder: '小时', style: 'width:100%;' });
  const recoveryInput = el('input', { type: 'number', class: 'gear-select', value: plan && plan.recovery_days != null ? plan.recovery_days : '', placeholder: '天', style: 'width:100%;' });
  const intensitySel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（未选择）'),
    el('option', { value: 'low' }, '低 low'),
    el('option', { value: 'moderate' }, '中 moderate'),
    el('option', { value: 'high' }, '高 high'),
    el('option', { value: 'extreme' }, '极高 extreme')
  );
  if (plan && plan.intensity_level) intensitySel.value = plan.intensity_level;
  const notesInput = el('textarea', { class: 'gear-select', rows: 3, placeholder: '备注', style: 'width:100%;' }, plan && plan.notes ? plan.notes : '');

  const form = el('div', { class: 'recommend-form' },
    el('div', { class: 'form-row' }, el('label', {}, '类型 *'), typeSel),
    el('div', { class: 'form-row' }, el('label', {}, '日期 *'), dateInput),
    el('div', { class: 'form-row' }, el('label', {}, '路线'), routeInput),
    el('div', { class: 'form-row' }, el('label', {}, '距离 (km)'), distInput),
    el('div', { class: 'form-row' }, el('label', {}, '爬升 (m)'), gainInput),
    el('div', { class: 'form-row' }, el('label', {}, '预计时长 (h)'), hoursInput),
    el('div', { class: 'form-row' }, el('label', {}, '恢复天数'), recoveryInput),
    el('div', { class: 'form-row' }, el('label', {}, '强度'), intensitySel),
    el('div', { class: 'form-row' }, el('label', {}, '备注'), notesInput)
  );

  const saveBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, plan ? '保存修改' : '添加计划');
  saveBtn.addEventListener('click', async () => {
    const plan_type = typeSel.value;
    const date = dateInput.value;
    if (!date) { toast('请填写日期', 'warn'); return; }
    const data = { plan_type, date };
    const route = routeInput.value.trim(); if (route) data.route = route;
    const d = Number(distInput.value); if (!isNaN(d) && d >= 0) data.distance_km = d;
    const g = Number(gainInput.value); if (!isNaN(g)) data.elevation_gain_m = g;
    const h = Number(hoursInput.value); if (!isNaN(h) && h >= 0) data.estimated_hours = h;
    const r = Number(recoveryInput.value); if (!isNaN(r) && r >= 0) data.recovery_days = r;
    if (intensitySel.value) data.intensity_level = intensitySel.value;
    const notes = notesInput.value.trim(); if (notes) data.notes = notes;

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      const payload = { data, raw_markdown: buildPlanMarkdown(data) };
      if (plan && plan.id) {
        await fetchUpdatePlan(state.apiUrl, state.token, plan.id, payload);
      } else {
        await fetchSavePlan(state.apiUrl, state.token, payload);
      }
      toast('计划已保存', 'success');
      close();
      await loadAndRender(true);
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = plan ? '保存修改' : '添加计划';
    }
  });

  const close = showModal(plan ? '编辑计划' : '添加计划', form, [saveBtn, el('button', { class: 'btn' }, '关闭')]);
}

function renderPlans() {
  const plans = [...state.data.plans].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const view = viewEl('plans');
  clearViewKeepSkeleton(view);
  const headerRow = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, `计划（${plans.length}）`),
    el('button', { class: 'btn-sm btn-primary', 'data-action': 'add-plan' }, '添加计划')
  );
  view.appendChild(headerRow);
  $('.btn-sm[data-action="add-plan"]', headerRow).addEventListener('click', () => openAddPlan());

  if (!plans.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无计划'));
    return;
  }

  for (const p of plans) {
    const card = el('div', { class: 'card' });
    const typeLabel = p.plan_type === 'recovery' ? '恢复' : '行程';
    const titleRow = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
      el('span', {}, `[${typeLabel}] · ${p.route || p.issue || '计划'} · ${fmtDate(p.date)}`),
      el('div', {},
        el('button', { class: 'btn-sm', 'data-action': 'edit-plan', 'data-id': String(p.id) }, '编辑'),
        ' ',
        el('button', { class: 'btn-sm btn-danger', 'data-action': 'delete-plan', 'data-id': String(p.id) }, '删除')
      )
    );
    card.appendChild(titleRow);
    const facts = [
      ['距离', p.distance_km != null ? p.distance_km + ' km' : null],
      ['爬升', p.elevation_gain_m != null ? p.elevation_gain_m + ' m' : null],
      ['预计时长', p.estimated_hours != null ? p.estimated_hours + ' h' : null],
      ['天数', p.days != null ? p.days + ' 天' : null],
      ['恢复天数', p.recovery_days != null ? p.recovery_days + ' 天' : null],
      ['强度', p.intensity_level],
      ['总重量', p.total_weight_g != null ? (p.total_weight_g / 1000).toFixed(2) + ' kg' : null],
      ['总体积', p.total_volume_l != null ? Number(p.total_volume_l).toFixed(1) + ' L' : null],
      ['装备数', Array.isArray(p.gear_recommended) ? p.gear_recommended.length + ' 件' : null],
      ['天气来源', p.plan_type !== 'recovery' && p.weather_source ? { auto: '自动', manual: '手动', fallback: '默认兜底' }[p.weather_source] : null],
    ].filter(([, v]) => v != null && v !== '');
    for (const [k, v] of facts) {
      card.appendChild(el('div', {}, el('span', { class: 'badge' }, k), ' ', String(v)));
    }
    if (p.backpack_recommended) {
      const bp = state.data.gear.find((g) => g.slug === p.backpack_recommended);
      card.appendChild(el('div', {}, el('span', { class: 'badge' }, '推荐背包'), ' ', bp ? bp.name : p.backpack_recommended));
    }
    view.appendChild(card);
  }

  // 计划卡片操作按钮事件委托
  view.querySelectorAll('.btn-sm[data-action="edit-plan"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const p = plans.find((x) => String(x.id) === id);
      if (p) openAddPlan(p);
    });
  });
  view.querySelectorAll('.btn-sm[data-action="delete-plan"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const p = plans.find((x) => String(x.id) === id);
      if (!p) return;
      if (!confirm(`确认删除计划「${p.route || '未命名'} · ${fmtDate(p.date)}」？`)) return;
      try {
        await fetchDelete(state.apiUrl, state.token, 'plans', id);
        toast('计划已删除', 'success');
        await loadAndRender(true);
      } catch (err) {
        toast(err.message || '删除失败', 'error');
      }
    });
  });
}
