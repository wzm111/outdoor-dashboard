/* 活动 gear_used 写回与保存核心 */
'use strict';

// ---------- 活动 gear_used 写回 ----------

/** 把编辑后的 slug 列表序列化成 frontmatter 里的 gear_used YAML 块。
 *  空列表 → `gear_used: []`；非空 → 多行 `  - slug`。不含末尾换行。 */
function serializeGearUsedBlock(slugs) {
  if (!slugs || !slugs.length) return 'gear_used: []';
  return 'gear_used:\n' + slugs.map((s) => `  - ${s}`).join('\n');
}

/** 只替换 raw_markdown 里 frontmatter（首个 ---...---）内的 gear_used 块，正文散文原样保留。
 *  - 兼容原块是多行列表（gear_used:\n  - x\n  - y）或空数组（gear_used: []）。
 *  - frontmatter 里没有 gear_used 键时，在 frontmatter 末尾追加。
 *  - 整段 raw 没有 frontmatter 围栏时，返回原文不动（无法安全定位，交由调用方决定）。
 *  返回 { text, changed }。 */
function replaceGearUsedInMarkdown(raw, slugs) {
  const src = String(raw == null ? '' : raw);
  const block = serializeGearUsedBlock(slugs);
  // 定位首个 frontmatter 围栏：^---\n ... \n---(\n|$)
  const fm = src.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/);
  if (!fm) return { text: src, changed: false };
  const head = fm[1];
  let body = fm[2];
  const tail = fm[3];
  // 在 frontmatter body 内匹配 gear_used 块：从行首 gear_used: 起，
  // 吃掉后续所有更深缩进的列表行（  - ...），到下一个顶层键或 body 结束前。
  const guRe = /^gear_used:[ \t]*(?:\r?\n(?:[ \t]+-.*(?:\r?\n|$))*|\[\s*\].*(?:\r?\n|$)?|.*(?:\r?\n|$))/m;
  let newBody;
  if (guRe.test(body)) {
    newBody = body.replace(guRe, (m) => {
      // 保留原块尾部的换行数：若原匹配以换行结尾则补一个换行
      const endsNl = /\r?\n$/.test(m);
      return block + (endsNl ? '\n' : '');
    });
  } else {
    // frontmatter 里没有 gear_used，追加到 body 末尾
    newBody = body.replace(/\s*$/, '') + '\n' + block;
  }
  const changed = newBody !== body;
  return { text: head + newBody + tail + src.slice(fm[0].length), changed };
}

/** 构建写回用的完整活动 data：剔除看板注入的非持久字段，并用编辑后的干净 slug 数组替换 gear_used。 */
function packActivityData(activity, slugs) {
  const copy = { ...activity };
  delete copy._raw_markdown;
  delete copy._updated_at;
  delete copy._path;
  delete copy.slug;
  copy.gear_used = slugs.slice();
  return copy;
}
function openAddActivityByAi() {
  if (!state.token) { toast('请先连接后再添加活动', 'warn'); return; }
  const content = el('div', {});
  const resultArea = el('div', { class: 'scrape-result' });
  const label = el('label', {}, '用一句话描述活动，AI 会识别距离、爬升、心率、配速等字段');
  const textarea = el('textarea', { id: 'add-activity-ai', rows: 5, placeholder: '例如：今天跑了10公里，配速5分30，平均心率150，膝盖有点酸' });
  const actions = el('div', { class: 'gear-card-actions' });
  const aiBtn = el('button', { class: 'btn btn-primary' }, 'AI 识别并生成');
  actions.appendChild(aiBtn);

  async function run() {
    const text = textarea.value.trim();
    if (!text) { toast('请先输入活动描述', 'warn'); return; }
    aiBtn.disabled = true;
    aiBtn.textContent = '识别中…';
    resultArea.innerHTML = '';
    try {
      const res = await fetchAiActivity(state.apiUrl, state.token, text);
      if (!res.ok || !res.data) {
        throw new Error(res.error || 'AI 未返回有效字段');
      }
      const parsed = res.data;
      if (!parsed.date) parsed.date = new Date().toISOString().slice(0, 10);
      renderActivityAiResult(resultArea, parsed, res.provider);
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
  showModal('AI 添加活动', content, []);
}

/** 渲染 AI 活动解析结果 + 保存按钮。 */
function renderActivityAiResult(container, parsed, provider) {
  container.innerHTML = '';
  if (!parsed || !parsed.date || !parsed.distance_km) {
    container.appendChild(el('div', { class: 'empty' }, '没有识别到日期或距离，请补充更完整的描述。'));
    return;
  }
  const titleText = provider ? `AI 识别结果（${provider === 'moonshot' ? 'Kimi' : 'DeepSeek'}）` : '识别结果';
  container.appendChild(el('div', { class: 'section-title' }, `${titleText}（确认后保存）`));
  const facts = [
    ['日期', parsed.date],
    ['路线', parsed.route],
    ['类型', parsed.type],
    ['距离', parsed.distance_km != null ? parsed.distance_km + ' km' : null],
    ['爬升', parsed.elevation_gain_m != null ? parsed.elevation_gain_m + ' m' : null],
    ['下降', parsed.elevation_loss_m != null ? parsed.elevation_loss_m + ' m' : null],
    ['时长', parsed.duration_hours != null ? parsed.duration_hours + ' h' : null],
    ['平均心率', parsed.avg_hr],
    ['最大心率', parsed.max_hr],
    ['配速', parsed.avg_pace],
    ['步频', parsed.cadence],
    ['结束日期', parsed.end_date],
    ['最高海拔', parsed.max_altitude_m != null ? parsed.max_altitude_m + ' m' : null],
    ['路况', parsed.trail_condition],
    ['负重', typeof loadTypeLabel === 'function' ? loadTypeLabel(parsed.load_type) : parsed.load_type],
    ['细分类型', typeof disciplineLabel === 'function' ? disciplineLabel(parsed.discipline) : parsed.discipline],
    ['难度', parsed.grade],
    ['线路数', parsed.problems_count],
    ['完攀方式', typeof sendTypeLabel === 'function' ? sendTypeLabel(parsed.send_type) : parsed.send_type],
    ['骑行类型', typeof cyclingTypeLabel === 'function' ? cyclingTypeLabel(parsed.cycling_type) : parsed.cycling_type],
    ['均速', parsed.avg_speed_kmh != null ? parsed.avg_speed_kmh + ' km/h' : null],
    ['平均功率', parsed.power_avg_w != null ? parsed.power_avg_w + ' W' : null],
    ['感受', parsed.felt],
    ['装备', Array.isArray(parsed.gear_used) ? parsed.gear_used.join('、') : parsed.gear_used],
    ['问题', Array.isArray(parsed.issues) ? parsed.issues.map(issueLabel).join('、') : parsed.issues],
    ['备注', parsed.notes],
  ].filter(([, v]) => v != null && v !== '' && v !== '—');
  const list = el('ul', { class: 'detail-list' });
  for (const [k, v] of facts) list.appendChild(el('li', {}, el('strong', {}, k + '：'), document.createTextNode(String(v))));
  container.appendChild(list);

  const saveBtn = el('button', { class: 'btn btn-primary' }, '保存活动');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      const data = { ...parsed, gear_used: Array.isArray(parsed.gear_used) ? parsed.gear_used : [] };
      const payload = {
        date: data.date,
        route: data.route || '活动',
        sequence: nextActivitySequence(data.date, data.route || '活动'),
        data,
        raw_markdown: buildActivityMarkdown(data),
      };
      await fetchSaveActivity(state.apiUrl, state.token, payload);
      toast('保存成功，正在刷新…', 'success');
      await loadAndRender(true);
      $$('.modal-overlay').forEach((m) => m.remove());
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '保存活动';
    }
  });
  container.appendChild(saveBtn);
}

/** 更新单条活动：PUT /activities/:id。 */
async function fetchUpdateActivity(apiUrl, token, id, payload) {
  const url = `${apiBase(apiUrl)}/activities/${encodeURIComponent(id)}`;
  const expectedUpdatedAt = getExpectedUpdatedAt('activities', id);
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
    label: '更新活动',
    expectedUpdatedAt,
    optimistic: () => {
      const idx = state.data.activities.findIndex((a) => String(a.id) === String(id));
      if (idx >= 0) {
        state.data.activities[idx] = {
          ...state.data.activities[idx],
          ...payload.data,
          sequence: payload.sequence,
        };
      }
      renderActivities();
      saveSnapshot();
    },
  });
}

/** 保存活动：走 /sync import 的 activities upsert（onConflict date+route+sequence）。
 *  整行覆盖，故必须回传完整 data 和 raw_markdown。 */
async function fetchSaveActivity(apiUrl, token, payload) {
  const url = `${apiBase(apiUrl)}/sync`;
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ action: 'import', data: { activities: [payload] } }),
  };
  return mutateRequest({
    url,
    options,
    label: '保存活动装备',
    optimistic: () => {
      const merged = { ...payload.data, sequence: payload.sequence ?? 0 };
      const idx = state.data.activities.findIndex((a) =>
        String(a.date) === String(merged.date) &&
        String(a.route) === String(merged.route) &&
        Number(a.sequence || 0) === Number(merged.sequence || 0));
      if (idx >= 0) state.data.activities[idx] = { ...state.data.activities[idx], ...merged };
      else state.data.activities.push(merged);
      state.data.activities.sort((a, b) => {
        const dateCmp = String(b.date).localeCompare(String(a.date));
        if (dateCmp !== 0) return dateCmp;
        return (a.sequence || 0) - (b.sequence || 0);
      });
      renderActivities();
      saveSnapshot();
    },
  });
}
