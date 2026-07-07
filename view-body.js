/* 身体趋势视图渲染 */
'use strict';

// ---------- 身体趋势（canvas 折线） ----------

function buildBodyMarkdown(data) {
  const lines = ['---'];
  lines.push(`date: "${data.date}"`);
  if (data.sleep_hours != null) lines.push(`sleep_hours: ${data.sleep_hours}`);
  if (data.fatigue != null) lines.push(`fatigue: ${data.fatigue}`);
  if (data.muscle_soreness != null) lines.push(`muscle_soreness: ${data.muscle_soreness}`);
  if (data.knee_status) lines.push(`knee_status: ${data.knee_status}`);
  if (data.mood != null) lines.push(`mood: ${data.mood}`);
  if (data.weight_kg != null) lines.push(`weight_kg: ${data.weight_kg}`);
  if (data.notes) lines.push(`notes: "${data.notes}"`);
  lines.push('---');
  return lines.join('\n');
}

/** 弹窗手动添加/编辑身体记录。 */
function openAddBody(log = null) {
  if (!state.token) { toast('请先连接后再添加记录', 'warn'); return; }

  const today = new Date().toISOString().slice(0, 10);
  const dateInput = el('input', { type: 'date', class: 'gear-select', value: log ? fmtDate(log.date) : today, style: 'width:100%;' });
  const sleepInput = el('input', { type: 'number', class: 'gear-select', value: log && log.sleep_hours != null ? log.sleep_hours : '', step: '0.1', placeholder: '小时', style: 'width:100%;' });
  const fatigueInput = el('input', { type: 'number', class: 'gear-select', value: log && log.fatigue != null ? log.fatigue : '', min: '1', max: '10', placeholder: '1-10', style: 'width:100%;' });
  const soreInput = el('input', { type: 'number', class: 'gear-select', value: log && log.muscle_soreness != null ? log.muscle_soreness : '', min: '1', max: '10', placeholder: '1-10', style: 'width:100%;' });
  const kneeSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: '' }, '（未选择）'),
    el('option', { value: 'good' }, '良好 good'),
    el('option', { value: 'fair' }, '一般 fair'),
    el('option', { value: 'poor' }, '不佳 poor')
  );
  if (log && log.knee_status) kneeSel.value = log.knee_status;
  const moodInput = el('input', { type: 'number', class: 'gear-select', value: log && log.mood != null ? log.mood : '', min: '1', max: '10', placeholder: '1-10', style: 'width:100%;' });
  const weightInput = el('input', { type: 'number', class: 'gear-select', value: log && log.weight_kg != null ? log.weight_kg : '', step: '0.1', placeholder: 'kg', style: 'width:100%;' });
  const notesInput = el('textarea', { class: 'gear-select', rows: 3, placeholder: '其他身体感受、伤病等', style: 'width:100%;' }, log && log.notes ? log.notes : '');

  const form = el('div', { class: 'recommend-form' },
    el('div', { class: 'form-row' }, el('label', {}, '日期 *'), dateInput),
    el('div', { class: 'form-row' }, el('label', {}, '睡眠 (h)'), sleepInput),
    el('div', { class: 'form-row' }, el('label', {}, '疲劳度 1-10'), fatigueInput),
    el('div', { class: 'form-row' }, el('label', {}, '肌肉酸痛 1-10'), soreInput),
    el('div', { class: 'form-row' }, el('label', {}, '膝盖状态'), kneeSel),
    el('div', { class: 'form-row' }, el('label', {}, '心情 1-10'), moodInput),
    el('div', { class: 'form-row' }, el('label', {}, '体重 (kg)'), weightInput),
    el('div', { class: 'form-row' }, el('label', {}, '备注'), notesInput)
  );

  const saveBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, log ? '保存修改' : '保存记录');
  const originalDate = log ? fmtDate(log.date) : null;

  saveBtn.addEventListener('click', async () => {
    const date = dateInput.value;
    if (!date) { toast('请填写日期', 'warn'); return; }
    const data = { date };
    const s = Number(sleepInput.value); if (!isNaN(s) && s > 0) data.sleep_hours = s;
    const f = Number(fatigueInput.value); if (!isNaN(f)) data.fatigue = f;
    const ms = Number(soreInput.value); if (!isNaN(ms)) data.muscle_soreness = ms;
    if (kneeSel.value) data.knee_status = kneeSel.value;
    const m = Number(moodInput.value); if (!isNaN(m)) data.mood = m;
    const w = Number(weightInput.value); if (!isNaN(w) && w > 0) data.weight_kg = w;
    const notes = notesInput.value.trim(); if (notes) data.notes = notes;

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      if (originalDate && originalDate !== date) {
        await fetchDelete(state.apiUrl, state.token, 'body', originalDate);
      }
      await fetchSaveBody(state.apiUrl, state.token, date, data, buildBodyMarkdown(data));
      toast('身体记录已保存', 'success');
      close();
      await loadAndRender(true);
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = log ? '保存修改' : '保存记录';
    }
  });

  const close = showModal(log ? '编辑身体记录' : '添加身体记录', form, [saveBtn, el('button', { class: 'btn' }, '关闭')]);
}

/** 通过 AI 一句话添加身体记录。 */
function openAddBodyByAi() {
  if (!state.token) { toast('请先连接后再添加记录', 'warn'); return; }
  const content = el('div', {});
  const resultArea = el('div', { class: 'scrape-result' });
  const label = el('label', {}, '用一句话描述今天身体状态，AI 会识别睡眠、疲劳、体重等字段');
  const textarea = el('textarea', { id: 'add-body-ai', rows: 5, placeholder: '例如：昨晚睡了7小时，今天疲劳度3，体重70.2kg，膝盖感觉良好' });
  const actions = el('div', { class: 'gear-card-actions' });
  const aiBtn = el('button', { class: 'btn btn-primary' }, 'AI 识别并生成');
  actions.appendChild(aiBtn);

  async function run() {
    const text = textarea.value.trim();
    if (!text) { toast('请先输入身体状态描述', 'warn'); return; }
    aiBtn.disabled = true;
    aiBtn.textContent = '识别中…';
    resultArea.innerHTML = '';
    try {
      const res = await fetchAiBody(state.apiUrl, state.token, text);
      if (!res.ok || !res.data) {
        throw new Error(res.error || 'AI 未返回有效字段');
      }
      const parsed = res.data;
      if (!parsed.date) parsed.date = new Date().toISOString().slice(0, 10);
      renderBodyAiResult(resultArea, parsed, res.provider);
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
  showModal('AI 添加身体记录', content, []);
}

/** 渲染 AI 身体记录解析结果 + 保存按钮。 */
function renderBodyAiResult(container, parsed, provider) {
  container.innerHTML = '';
  if (!parsed || !parsed.date) {
    container.appendChild(el('div', { class: 'empty' }, '没有识别到日期，请补充更完整的描述。'));
    return;
  }
  const titleText = provider ? `AI 识别结果（${provider === 'moonshot' ? 'Kimi' : 'DeepSeek'}）` : '识别结果';
  container.appendChild(el('div', { class: 'section-title' }, `${titleText}（确认后保存）`));
  const facts = [
    ['日期', parsed.date],
    ['睡眠', parsed.sleep_hours != null ? parsed.sleep_hours + ' h' : null],
    ['疲劳度', parsed.fatigue],
    ['肌肉酸痛', parsed.muscle_soreness],
    ['膝盖状态', parsed.knee_status],
    ['心情', parsed.mood],
    ['体重', parsed.weight_kg != null ? parsed.weight_kg + ' kg' : null],
    ['备注', parsed.notes],
  ].filter(([, v]) => v != null && v !== '');
  const list = el('ul', { class: 'detail-list' });
  for (const [k, v] of facts) list.appendChild(el('li', {}, el('strong', {}, k + '：'), document.createTextNode(String(v))));
  container.appendChild(list);

  const saveBtn = el('button', { class: 'btn btn-primary' }, '保存记录');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      await fetchSaveBody(state.apiUrl, state.token, parsed.date, parsed, buildBodyMarkdown(parsed));
      toast('保存成功，正在刷新…', 'success');
      await loadAndRender(true);
      $$('.modal-overlay').forEach((m) => m.remove());
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '保存记录';
    }
  });
  container.appendChild(saveBtn);
}

function renderBody() {
  const logs = [...state.data.body_logs]
    .filter((b) => b.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const view = viewEl('body');
  clearViewKeepSkeleton(view);
  const headerRow = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, `身体趋势（${logs.length} 条记录）`),
    el('div', { style: 'display:flex;gap:8px;' },
      el('button', { class: 'btn-sm btn-primary', 'data-action': 'add-body' }, '添加记录'),
      el('button', { class: 'btn-sm btn-primary', 'data-action': 'add-body-ai' }, 'AI 添加')
    )
  );
  view.appendChild(headerRow);
  $('.btn-sm[data-action="add-body"]', headerRow).addEventListener('click', () => openAddBody());
  $('.btn-sm[data-action="add-body-ai"]', headerRow).addEventListener('click', () => openAddBodyByAi());

  if (!logs.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无身体记录'));
    return;
  }

  view.appendChild(lineChartCard('体重 (kg)', logs, 'weight_kg', '#5aa9e6'));
  view.appendChild(lineChartCard('疲劳度 (1-10)', logs, 'fatigue', '#e0a458', 0, 10));
  view.appendChild(lineChartCard('睡眠 (小时)', logs, 'sleep_hours', '#4fb477', 0, 12));
  view.appendChild(lineChartCard('肌肉酸痛 (1-10)', logs, 'muscle_soreness', '#e06c75', 0, 10));

  // 最近记录表格：支持编辑/删除
  const recent = logs.slice().reverse();
  const tableWrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {},
    el('th', {}, '日期'),
    el('th', {}, '睡眠'),
    el('th', {}, '疲劳'),
    el('th', {}, '酸痛'),
    el('th', {}, '膝盖'),
    el('th', {}, '心情'),
    el('th', {}, '体重'),
    el('th', {}, '备注'),
    el('th', {}, '操作')
  )));
  const tbody = el('tbody');
  for (const log of recent) {
    const tr = el('tr', {},
      el('td', {}, fmtDate(log.date)),
      el('td', {}, log.sleep_hours != null ? num(log.sleep_hours, 1) : '—'),
      el('td', {}, log.fatigue != null ? num(log.fatigue, 0) : '—'),
      el('td', {}, log.muscle_soreness != null ? num(log.muscle_soreness, 0) : '—'),
      el('td', {}, log.knee_status || '—'),
      el('td', {}, log.mood != null ? num(log.mood, 0) : '—'),
      el('td', {}, log.weight_kg != null ? num(log.weight_kg, 1) : '—'),
      el('td', {}, log.notes || '—'),
      el('td', {},
        el('button', { class: 'btn-sm', 'data-action': 'edit', style: 'margin-right:6px;' }, '编辑'),
        el('button', { class: 'btn-sm btn-danger', 'data-action': 'delete' }, '删除')
      )
    );
    $('.btn-sm[data-action="edit"]', tr).addEventListener('click', () => openAddBody(log));
    $('.btn-sm[data-action="delete"]', tr).addEventListener('click', async () => {
      if (!confirm(`确认删除 ${fmtDate(log.date)} 的身体记录？`)) return;
      try {
        await fetchDelete(state.apiUrl, state.token, 'body', fmtDate(log.date));
        toast('身体记录已删除', 'success');
        await loadAndRender(true);
      } catch (err) {
        toast(err.message || '删除失败', 'error');
      }
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  view.appendChild(tableWrap);
}
