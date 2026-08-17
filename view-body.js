/* 身体趋势视图渲染 */
'use strict';

const BODY_QUICK_HISTORY_KEY = 'outdoor_body_quick_history';
const BODY_QUICK_HISTORY_LIMIT = 5;
const BODY_QUICK_TEMPLATES = [
  { label: '状态正常', text: '今天状态正常，疲劳2，膝盖良好' },
  { label: '睡眠不足', text: '昨晚睡眠6小时，今天疲劳4' },
  { label: '膝盖不适', text: '今天膝盖一般，疲劳3' },
  { label: '酸痛明显', text: '今天肌肉酸痛4，疲劳3' },
  { label: '休息恢复', text: '今天完全休息，膝盖良好' },
];

function getBodyQuickHistory() {
  try {
    const raw = localStorage.getItem(BODY_QUICK_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, BODY_QUICK_HISTORY_LIMIT) : [];
  } catch (e) {
    return [];
  }
}

function saveBodyQuickHistory(phrase) {
  if (!phrase) return;
  const history = getBodyQuickHistory().filter((p) => p !== phrase);
  history.unshift(phrase);
  try {
    localStorage.setItem(BODY_QUICK_HISTORY_KEY, JSON.stringify(history.slice(0, BODY_QUICK_HISTORY_LIMIT)));
  } catch (e) {
    // ignore storage errors
  }
}

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
  if (data.resting_hr != null) lines.push(`resting_hr: ${data.resting_hr}`);
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
  const restingHrInput = el('input', { type: 'number', class: 'gear-select', value: log && log.resting_hr != null ? log.resting_hr : '', min: '30', max: '120', placeholder: '晨起静息心率 bpm', style: 'width:100%;' });
  const notesInput = el('textarea', { class: 'gear-select', rows: 3, placeholder: '其他身体感受、伤病等', style: 'width:100%;' }, log && log.notes ? log.notes : '');

  const form = el('div', { class: 'recommend-form' },
    el('div', { class: 'form-row' }, el('label', {}, '日期 *'), dateInput),
    el('div', { class: 'form-row' }, el('label', {}, '睡眠 (h)'), sleepInput),
    el('div', { class: 'form-row' }, el('label', {}, '疲劳度 1-10'), fatigueInput),
    el('div', { class: 'form-row' }, el('label', {}, '肌肉酸痛 1-10'), soreInput),
    el('div', { class: 'form-row' }, el('label', {}, '膝盖状态'), kneeSel),
    el('div', { class: 'form-row' }, el('label', {}, '心情 1-10'), moodInput),
    el('div', { class: 'form-row' }, el('label', {}, '体重 (kg)'), weightInput),
    el('div', { class: 'form-row' }, el('label', {}, '静息心率 (bpm)'), restingHrInput),
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
    const rhr = Number(restingHrInput.value); if (!isNaN(rhr) && rhr > 0) data.resting_hr = rhr;
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
    ['静息心率', parsed.resting_hr != null ? parsed.resting_hr + ' bpm' : null],
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

  // 快速录入栏
  const quickWrap = el('div', { class: 'report-card body-quick-card' });
  quickWrap.appendChild(el('h3', {}, '快速记录'));
  const quickInput = el('input', { type: 'text', class: 'gear-select body-quick-input', placeholder: '例如：昨晚睡了7小时，今天疲劳3，膝盖良好' });
  const quickHint = el('div', { class: 'body-quick-hint' }, '支持：睡眠/疲劳/酸痛/膝盖/心情/体重/静息心率/日期/备注');

  const templateChips = el('div', { class: 'body-quick-chips' });
  for (const t of BODY_QUICK_TEMPLATES) {
    const chip = el('button', { type: 'button', class: 'body-quick-chip' }, t.label);
    chip.addEventListener('click', () => {
      quickInput.value = t.text;
      updateQuickPreview();
      quickInput.focus();
    });
    templateChips.appendChild(chip);
  }

  const historyChips = el('div', { class: 'body-quick-chips body-quick-history' });
  function renderHistory() {
    historyChips.innerHTML = '';
    const history = getBodyQuickHistory();
    if (!history.length) return;
    historyChips.appendChild(el('span', { class: 'body-quick-history-label' }, '最近：'));
    for (const phrase of history) {
      const chip = el('button', { type: 'button', class: 'body-quick-chip body-quick-chip-history' }, phrase);
      chip.addEventListener('click', () => {
        quickInput.value = phrase;
        updateQuickPreview();
        quickInput.focus();
      });
      historyChips.appendChild(chip);
    }
  }
  renderHistory();

  const quickResult = el('div', { class: 'body-quick-result' });
  const quickBtn = el('button', { class: 'btn btn-primary' }, '识别并保存');

  function updateQuickPreview() {
    const text = quickInput.value.trim();
    quickResult.innerHTML = '';
    if (!text) return;
    const parsed = parseBodyQuickText(text);
    const facts = [
      ['日期', parsed.date],
      ['睡眠', parsed.sleep_hours != null ? parsed.sleep_hours + ' h' : null],
      ['疲劳度', parsed.fatigue],
      ['肌肉酸痛', parsed.muscle_soreness],
      ['膝盖状态', parsed.knee_status],
      ['心情', parsed.mood],
      ['体重', parsed.weight_kg != null ? parsed.weight_kg + ' kg' : null],
      ['静息心率', parsed.resting_hr != null ? parsed.resting_hr + ' bpm' : null],
      ['备注', parsed.notes],
    ].filter(([, v]) => v != null && v !== '');
    if (facts.length) {
      const list = el('ul', { class: 'detail-list' });
      for (const [k, v] of facts) list.appendChild(el('li', {}, el('strong', {}, k + '：'), document.createTextNode(String(v))));
      quickResult.appendChild(list);
    }
  }

  quickInput.addEventListener('input', updateQuickPreview);
  quickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') quickBtn.click();
  });

  quickBtn.addEventListener('click', async () => {
    const text = quickInput.value.trim();
    if (!text) { toast('请先输入身体状态', 'warn'); return; }
    const parsed = parseBodyQuickText(text);
    if (!parsed.date) { toast('未识别到有效日期', 'warn'); return; }
    quickBtn.disabled = true;
    quickBtn.textContent = '保存中…';
    try {
      await fetchSaveBody(state.apiUrl, state.token, parsed.date, parsed, buildBodyMarkdown(parsed));
      saveBodyQuickHistory(text);
      toast('身体记录已保存', 'success');
      quickInput.value = '';
      quickResult.innerHTML = '';
      renderHistory();
      await loadAndRender(true);
    } catch (err) {
      toast(err.message || '保存失败', 'error');
    } finally {
      quickBtn.disabled = false;
      quickBtn.textContent = '识别并保存';
    }
  });

  const quickActions = el('div', { class: 'body-quick-actions' }, quickBtn);
  quickWrap.appendChild(quickInput);
  quickWrap.appendChild(quickHint);
  quickWrap.appendChild(templateChips);
  quickWrap.appendChild(historyChips);
  quickWrap.appendChild(quickResult);
  quickWrap.appendChild(quickActions);
  view.appendChild(quickWrap);

  if (!logs.length) {
    view.appendChild(el('div', { class: 'empty' }, '暂无身体记录'));
    return;
  }

  // 身体趋势图已隐藏：用户主要基于活动数据进行分析，身体日志更新频率低，
  // 固定趋势图会造成“数据不更新”的误解。保留快速录入和表格供偶尔手动记录。

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
    el('th', {}, '静息心率'),
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
      el('td', {}, log.resting_hr != null ? num(log.resting_hr, 0) : '—'),
      el('td', {}, log.notes || '—'),
      el('td', { class: 'actions' },
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
  labelTableCells(table, ['日期', '睡眠', '疲劳', '酸痛', '膝盖', '心情', '体重', '静息心率', '备注', '操作']);
  tableWrap.appendChild(table);
  view.appendChild(tableWrap);
}
