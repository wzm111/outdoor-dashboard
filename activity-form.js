/* 活动添加/编辑弹窗表单 */
'use strict';

function openAddActivity(activity = null) {
  if (!state.token) { toast('请先连接后再添加活动', 'warn'); return; }

  const today = new Date().toISOString().slice(0, 10);
  const routeSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（无路线 / 手动输入）')
  );
  const routes = [...(state.data.routes || [])].sort((a, b) => String(a.name || a.slug).localeCompare(String(b.name || b.slug)));
  for (const r of routes) {
    routeSel.appendChild(el('option', { value: r.name }, r.name || r.slug));
  }

  const dateInput = el('input', { type: 'date', class: 'gear-select', value: activity ? fmtDate(activity.date) : today, style: 'width:100%;' });
  const routeInput = el('input', { type: 'text', class: 'gear-select', value: activity ? activity.route || '' : '', placeholder: '路线名称', style: 'width:100%;' });
  const typeSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: 'running' }, '路跑 running'),
    el('option', { value: 'trail_running' }, '越野跑 trail_running'),
    el('option', { value: 'hiking' }, '徒步 hiking'),
    el('option', { value: 'climbing' }, '攀岩 climbing'),
    el('option', { value: 'cycling' }, '骑行 cycling'),
    el('option', { value: 'other' }, '其他 other')
  );
  if (activity && activity.type) typeSel.value = activity.type;
  const distInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.distance_km != null ? activity.distance_km : '', step: '0.01', placeholder: '公里', style: 'width:100%;' });
  const gainInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.elevation_gain_m != null ? activity.elevation_gain_m : '', placeholder: '米', style: 'width:100%;' });
  const lossInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.elevation_loss_m != null ? activity.elevation_loss_m : '', placeholder: '米（可选）', style: 'width:100%;' });
  const durationInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.duration_hours != null ? activity.duration_hours : '', step: '0.01', placeholder: '小时', style: 'width:100%;' });
  const hrInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.avg_hr != null ? activity.avg_hr : '', placeholder: '次/分', style: 'width:100%;' });
  const feltSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（未选择）'),
    el('option', { value: 'easy' }, '轻松 easy'),
    el('option', { value: 'moderate' }, '适中 moderate'),
    el('option', { value: 'hard' }, '辛苦 hard'),
    el('option', { value: 'extreme' }, '极限 extreme')
  );
  if (activity && activity.felt) feltSel.value = activity.felt;
  const notesInput = el('textarea', { class: 'gear-select', rows: 3, placeholder: '备注、膝盖状态、装备反馈等', style: 'width:100%;' }, activity && activity.notes ? activity.notes : '');

  function updateRouteInput() {
    if (routeSel.value) {
      routeInput.value = routeSel.value;
      routeInput.disabled = true;
    } else {
      routeInput.disabled = false;
    }
  }
  routeSel.addEventListener('change', updateRouteInput);
  if (activity && activity.route) {
    const matched = [...routeSel.options].some((o) => o.value === activity.route);
    if (matched) routeSel.value = activity.route;
    updateRouteInput();
  }

  const form = el('div', { class: 'recommend-form' },
    el('div', { class: 'form-row' }, el('label', {}, '日期 *'), dateInput),
    el('div', { class: 'form-row' }, el('label', {}, '路线'), el('div', {}, routeSel, routeInput)),
    el('div', { class: 'form-row' }, el('label', {}, '类型 *'), typeSel),
    el('div', { class: 'form-row' }, el('label', {}, '距离 (km) *'), distInput),
    el('div', { class: 'form-row' }, el('label', {}, '爬升 (m)'), gainInput),
    el('div', { class: 'form-row' }, el('label', {}, '下降 (m)'), lossInput),
    el('div', { class: 'form-row' }, el('label', {}, '时长 (h)'), durationInput),
    el('div', { class: 'form-row' }, el('label', {}, '平均心率'), hrInput),
    el('div', { class: 'form-row' }, el('label', {}, '感受'), feltSel),
    el('div', { class: 'form-row' }, el('label', {}, '备注'), notesInput)
  );

  const saveBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, activity ? '保存修改' : '保存活动');
  saveBtn.addEventListener('click', async () => {
    const date = dateInput.value;
    const route = routeInput.value.trim();
    const type = typeSel.value;
    const distance = Number(distInput.value);
    if (!date || !route || isNaN(distance) || distance <= 0) {
      toast('请填写日期、路线和有效距离', 'warn');
      return;
    }
    const data = {
      date,
      route,
      type,
      distance_km: distance,
      elevation_gain_m: Number(gainInput.value) || 0,
      elevation_loss_m: Number(lossInput.value) || 0,
      duration_hours: Number(durationInput.value) || undefined,
      avg_hr: hrInput.value ? Number(hrInput.value) : undefined,
      felt: feltSel.value || undefined,
      notes: notesInput.value.trim() || undefined,
      gear_used: activity ? gearSlugsOf(activity) : [],
    };
    const rawMarkdown = buildActivityMarkdown(data);
    const payloadBase = {
      date: data.date,
      route: data.route,
      data,
      raw_markdown: rawMarkdown,
    };
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      if (activity && activity.id) {
        // 编辑：如果 date/route 变了，按新组合重新分配 sequence；否则保留原 sequence
        const dateChanged = String(data.date) !== String(activity.date);
        const routeChanged = String(data.route) !== String(activity.route);
        const sequence = (dateChanged || routeChanged)
          ? nextActivitySequence(data.date, data.route)
          : (activity.sequence ?? 0);
        await fetchUpdateActivity(state.apiUrl, state.token, activity.id, { ...payloadBase, sequence });
      } else {
        // 新增：自动分配下一个 sequence，避免覆盖同一天同路线已有记录
        const sequence = nextActivitySequence(data.date, data.route);
        await fetchSaveActivity(state.apiUrl, state.token, { ...payloadBase, sequence });
      }
      toast('活动已保存', 'success');
      close();
      await loadAndRender(true);
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = activity ? '保存修改' : '保存活动';
    }
  });

  const close = showModal(activity ? '编辑活动' : '记录活动', form, [saveBtn, el('button', { class: 'btn' }, '关闭')]);
}
