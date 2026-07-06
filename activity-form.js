/* 活动添加/编辑弹窗表单 — 按运动类型显示专项字段 */
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

  // ---------- 公共字段 ----------
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
  const maxHrInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.max_hr != null ? activity.max_hr : '', placeholder: '次/分', style: 'width:100%;' });
  const feltSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（未选择）'),
    el('option', { value: 'easy' }, '轻松 easy'),
    el('option', { value: 'moderate' }, '适中 moderate'),
    el('option', { value: 'hard' }, '辛苦 hard'),
    el('option', { value: 'extreme' }, '极限 extreme')
  );
  if (activity && activity.felt) feltSel.value = activity.felt;
  const weatherInput = el('input', { type: 'text', class: 'gear-select', value: activity && activity.weather ? activity.weather : '', placeholder: '天气简述', style: 'width:100%;' });
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

  // ---------- 跑步专项 ----------
  const cadenceInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.cadence != null ? activity.cadence : '', placeholder: '步频 spm', style: 'width:100%;' });
  const strideInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.stride_length_m != null ? activity.stride_length_m : '', step: '0.01', placeholder: '步幅 m', style: 'width:100%;' });
  const runningSection = el('div', { class: 'sport-fields', 'data-sport': 'running' },
    el('div', { class: 'form-row' }, el('label', {}, '步频'), cadenceInput),
    el('div', { class: 'form-row' }, el('label', {}, '步幅 (m)'), strideInput)
  );

  // ---------- 徒步专项 ----------
  const endDateInput = el('input', { type: 'date', class: 'gear-select', value: activity && activity.end_date ? fmtDate(activity.end_date) : '', style: 'width:100%;' });
  const maxAltInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.max_altitude_m != null ? activity.max_altitude_m : '', placeholder: '米', style: 'width:100%;' });
  const terrainInput = el('input', { type: 'text', class: 'gear-select', value: activity && Array.isArray(activity.terrain) ? activity.terrain.join('、') : (activity ? activity.terrain || '' : ''), placeholder: '如 rock, grass, ridge', style: 'width:100%;' });
  const trailConditionSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（未选择）'),
    el('option', { value: 'dry' }, '干燥 dry'),
    el('option', { value: 'muddy' }, '泥泞 muddy'),
    el('option', { value: 'snow' }, '积雪 snow'),
    el('option', { value: 'icy' }, '结冰 icy'),
    el('option', { value: 'wet' }, '潮湿 wet')
  );
  if (activity && activity.trail_condition) trailConditionSel.value = activity.trail_condition;
  const loadTypeSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（未选择）'),
    el('option', { value: 'heavy' }, '重装 heavy'),
    el('option', { value: 'light' }, '轻装 light'),
    el('option', { value: 'ultralight' }, '超轻 ultralight')
  );
  if (activity && activity.load_type) loadTypeSel.value = activity.load_type;
  const hikingSection = el('div', { class: 'sport-fields', 'data-sport': 'hiking' },
    el('div', { class: 'form-row' }, el('label', {}, '结束日期'), endDateInput),
    el('div', { class: 'form-row' }, el('label', {}, '最高海拔 (m)'), maxAltInput),
    el('div', { class: 'form-row' }, el('label', {}, '地形'), terrainInput),
    el('div', { class: 'form-row' }, el('label', {}, '路况'), trailConditionSel),
    el('div', { class: 'form-row' }, el('label', {}, '负重'), loadTypeSel)
  );

  // ---------- 攀岩专项 ----------
  const disciplineSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（未选择）'),
    el('option', { value: 'bouldering' }, '抱石 bouldering'),
    el('option', { value: 'sport' }, '运动攀 sport'),
    el('option', { value: 'trad' }, '传统攀 trad'),
    el('option', { value: 'multipitch' }, '多段 multipitch')
  );
  if (activity && activity.discipline) disciplineSel.value = activity.discipline;
  const gradeInput = el('input', { type: 'text', class: 'gear-select', value: activity && activity.grade ? activity.grade : '', placeholder: '如 V3 / 5.11a / 7A+', style: 'width:100%;' });
  const sendTypeSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（未选择）'),
    el('option', { value: 'onsight' }, 'Onsight'),
    el('option', { value: 'flash' }, 'Flash'),
    el('option', { value: 'redpoint' }, 'Redpoint'),
    el('option', { value: 'toprope' }, '顶绳')
  );
  if (activity && activity.send_type) sendTypeSel.value = activity.send_type;
  const problemsInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.problems_count != null ? activity.problems_count : '', placeholder: '完成线路数', style: 'width:100%;' });
  const attemptsInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.attempts != null ? activity.attempts : '', placeholder: '尝试次数', style: 'width:100%;' });
  const climbingSection = el('div', { class: 'sport-fields', 'data-sport': 'climbing' },
    el('div', { class: 'form-row' }, el('label', {}, '细分类型'), disciplineSel),
    el('div', { class: 'form-row' }, el('label', {}, '难度'), gradeInput),
    el('div', { class: 'form-row' }, el('label', {}, '完攀方式'), sendTypeSel),
    el('div', { class: 'form-row' }, el('label', {}, '完成线路数'), problemsInput),
    el('div', { class: 'form-row' }, el('label', {}, '尝试次数'), attemptsInput)
  );

  // ---------- 骑行专项 ----------
  const cyclingTypeSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（未选择）'),
    el('option', { value: 'road' }, '公路 road'),
    el('option', { value: 'mtb' }, '山地 mtb'),
    el('option', { value: 'gravel' }, 'Gravel'),
    el('option', { value: 'cyclocross' }, 'CX'),
    el('option', { value: 'track' }, '场地 track')
  );
  if (activity && activity.cycling_type) cyclingTypeSel.value = activity.cycling_type;
  const avgSpeedInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.avg_speed_kmh != null ? activity.avg_speed_kmh : '', step: '0.1', placeholder: 'km/h', style: 'width:100%;' });
  const maxSpeedInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.max_speed_kmh != null ? activity.max_speed_kmh : '', step: '0.1', placeholder: 'km/h', style: 'width:100%;' });
  const powerInput = el('input', { type: 'number', class: 'gear-select', value: activity && activity.power_avg_w != null ? activity.power_avg_w : '', placeholder: 'W', style: 'width:100%;' });
  const cyclingSection = el('div', { class: 'sport-fields', 'data-sport': 'cycling' },
    el('div', { class: 'form-row' }, el('label', {}, '骑行类型'), cyclingTypeSel),
    el('div', { class: 'form-row' }, el('label', {}, '均速 (km/h)'), avgSpeedInput),
    el('div', { class: 'form-row' }, el('label', {}, '最高速 (km/h)'), maxSpeedInput),
    el('div', { class: 'form-row' }, el('label', {}, '平均功率 (W)'), powerInput)
  );

  const sportSections = {
    running: runningSection,
    trail_running: runningSection,
    hiking: hikingSection,
    climbing: climbingSection,
    cycling: cyclingSection,
  };

  function updateSportSections() {
    const sport = activitySport(typeSel.value);
    for (const [key, sec] of Object.entries(sportSections)) {
      sec.hidden = key !== sport;
    }
  }
  typeSel.addEventListener('change', updateSportSections);

  const form = el('div', { class: 'recommend-form' },
    el('div', { class: 'form-row' }, el('label', {}, '日期 *'), dateInput),
    el('div', { class: 'form-row' }, el('label', {}, '路线'), el('div', {}, routeSel, routeInput)),
    el('div', { class: 'form-row' }, el('label', {}, '类型 *'), typeSel),
    el('div', { class: 'form-row' }, el('label', {}, '距离 (km) *'), distInput),
    el('div', { class: 'form-row' }, el('label', {}, '爬升 (m)'), gainInput),
    el('div', { class: 'form-row' }, el('label', {}, '下降 (m)'), lossInput),
    el('div', { class: 'form-row' }, el('label', {}, '时长 (h)'), durationInput),
    el('div', { class: 'form-row' }, el('label', {}, '平均心率'), hrInput),
    el('div', { class: 'form-row' }, el('label', {}, '最大心率'), maxHrInput),
    el('div', { class: 'form-row' }, el('label', {}, '感受'), feltSel),
    el('div', { class: 'form-row' }, el('label', {}, '天气'), weatherInput),
    el('div', { class: 'form-row' }, el('label', {}, '备注'), notesInput),
    runningSection,
    hikingSection,
    climbingSection,
    cyclingSection
  );
  updateSportSections();

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

    // 以旧记录为基础合并，避免丢失其他运动的旧字段
    const base = activity ? { ...activity } : {};
    delete base._raw_markdown;
    delete base._updated_at;
    delete base._path;
    delete base.slug;

    const data = {
      ...base,
      date,
      route,
      type,
      distance_km: distance,
      elevation_gain_m: gainInput.value ? Number(gainInput.value) : undefined,
      elevation_loss_m: lossInput.value ? Number(lossInput.value) : undefined,
      duration_hours: durationInput.value ? Number(durationInput.value) : undefined,
      avg_hr: hrInput.value ? Number(hrInput.value) : undefined,
      max_hr: maxHrInput.value ? Number(maxHrInput.value) : undefined,
      felt: feltSel.value || undefined,
      weather: weatherInput.value.trim() || undefined,
      notes: notesInput.value.trim() || undefined,
      gear_used: activity ? gearSlugsOf(activity) : [],
    };

    const sport = activitySport(type);
    const sportData = {};
    if (sport === 'running') {
      if (cadenceInput.value) sportData.cadence = Number(cadenceInput.value);
      if (strideInput.value) sportData.stride_length_m = Number(strideInput.value);
    } else if (sport === 'hiking') {
      if (endDateInput.value) sportData.end_date = endDateInput.value;
      if (maxAltInput.value) sportData.max_altitude_m = Number(maxAltInput.value);
      const terrain = terrainInput.value.trim();
      if (terrain) sportData.terrain = terrain.split(/[,，/、]/).map((s) => s.trim()).filter(Boolean);
      if (trailConditionSel.value) sportData.trail_condition = trailConditionSel.value;
      if (loadTypeSel.value) sportData.load_type = loadTypeSel.value;
    } else if (sport === 'climbing') {
      if (disciplineSel.value) sportData.discipline = disciplineSel.value;
      if (gradeInput.value.trim()) sportData.grade = gradeInput.value.trim();
      if (sendTypeSel.value) sportData.send_type = sendTypeSel.value;
      if (problemsInput.value) sportData.problems_count = Number(problemsInput.value);
      if (attemptsInput.value) sportData.attempts = Number(attemptsInput.value);
    } else if (sport === 'cycling') {
      if (cyclingTypeSel.value) sportData.cycling_type = cyclingTypeSel.value;
      if (avgSpeedInput.value) sportData.avg_speed_kmh = Number(avgSpeedInput.value);
      if (maxSpeedInput.value) sportData.max_speed_kmh = Number(maxSpeedInput.value);
      if (powerInput.value) sportData.power_avg_w = Number(powerInput.value);
    }

    // 当前运动的旧字段：如果输入清空则删除；有值则覆盖
    for (const [k, v] of Object.entries(sportData)) {
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) delete data[k];
      else data[k] = v;
    }

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
        const dateChanged = String(data.date) !== String(activity.date);
        const routeChanged = String(data.route) !== String(activity.route);
        const sequence = (dateChanged || routeChanged)
          ? nextActivitySequence(data.date, data.route)
          : (activity.sequence ?? 0);
        await fetchUpdateActivity(state.apiUrl, state.token, activity.id, { ...payloadBase, sequence });
      } else {
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
