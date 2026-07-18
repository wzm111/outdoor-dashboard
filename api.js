/* 网络请求封装 */
'use strict';

// ---------- 网络 ----------

function apiBase(url) {
  let b = (url || '').trim().replace(/\/+$/, '');
  if (!b.endsWith('/api')) b += '/api';
  return b;
}

/** 从当前 state.data 中读取某条记录的客户端 _updated_at，用于乐观锁冲突检测。 */
function getExpectedUpdatedAt(entity, keyValue) {
  if (!state.data || keyValue == null) return undefined;
  const key = entity === 'plans' || entity === 'activities' || entity === 'reports' ? 'id' : entity === 'body' ? 'date' : 'slug';
  const arrKey = entity === 'body' ? 'body_logs' : entity;
  const arr = state.data[arrKey];
  if (!Array.isArray(arr)) return undefined;
  const item = arr.find((x) => String(x[key]) === String(keyValue));
  return item && item._updated_at ? item._updated_at : undefined;
}

/** 带超时的 fetch：超时主动 abort，避免请求无限 pending 导致页面永久“加载中”。 */
async function fetchWithTimeout(url, options, timeoutMs, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`${label}超时（${Math.round(timeoutMs / 1000)}s）。请检查网络或 API 地址是否可达。`);
    }
    // 跨域/网络层失败时浏览器只给 "Failed to fetch"，补充可能原因
    throw new Error(`${label}失败：${err && err.message ? err.message : err}（可能是网络不通或 CORS）`);
  } finally {
    clearTimeout(timer);
  }
}

/** 通用删除请求。 */
async function fetchDelete(apiUrl, token, entity, id) {
  const url = `${apiBase(apiUrl)}/${entity}/${encodeURIComponent(id)}`;
  const expectedUpdatedAt = getExpectedUpdatedAt(entity, id);
  const options = {
    method: 'DELETE',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}),
  };
  return mutateRequest({
    url,
    options,
    label: '删除',
    expectedUpdatedAt,
    optimistic: () => {
      const key = entity === 'body' ? 'body_logs' : entity;
      const arr = state.data[key];
      if (!Array.isArray(arr)) return;
      const pk = entity === 'plans' || entity === 'reports' ? 'id' : entity === 'body' ? 'date' : 'slug';
      state.data[key] = arr.filter((item) => String(item[pk]) !== String(id));
      renderAll();
      saveSnapshot();
    },
  });
}

async function fetchToken(apiUrl, secret) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ secret }),
  }, 15000, '认证');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`认证失败 (${res.status})${text ? ': ' + text.slice(0, 120) : ''}`);
  }
  const json = await res.json();
  if (!json.token) throw new Error('认证响应缺少 token');
  return json.token;
}

async function fetchExport(apiUrl, token, since = null) {
  const payload = { action: 'export' };
  if (since) payload.since = since;
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  }, 30000, '拉取数据');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`拉取数据失败 (${res.status})${text ? ': ' + text.slice(0, 120) : ''}`);
  }
  return res.json();
}

async function fetchSaveGear(apiUrl, token, slug, data) {
  const url = `${apiBase(apiUrl)}/gear/${encodeURIComponent(slug)}`;
  const expectedUpdatedAt = getExpectedUpdatedAt('gear', slug);
  const options = {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ ...data, expected_updated_at: expectedUpdatedAt }),
  };
  return mutateRequest({
    url,
    options,
    label: '保存装备',
    expectedUpdatedAt,
    optimistic: () => {
      const merged = { slug, ...data.data };
      const idx = state.data.gear.findIndex((g) => g.slug === slug);
      if (idx >= 0) state.data.gear[idx] = { ...state.data.gear[idx], ...merged };
      else state.data.gear.push(merged);
      renderGear();
      saveSnapshot();
    },
  });
}

async function fetchGearPriceHistory(apiUrl, token, slug) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/gear/${encodeURIComponent(slug)}/price/history`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  }, 15000, '获取价格历史');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`获取价格历史失败 (${res.status})${text ? ': ' + text.slice(0, 120) : ''}`);
  }
  return res.json();
}

async function fetchGearPriceRecord(apiUrl, token, slug, payload) {
  const url = `${apiBase(apiUrl)}/gear/${encodeURIComponent(slug)}/price/record`;
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  };
  return mutateRequest({
    url,
    options,
    label: '记录价格',
    optimistic: () => {
      const g = state.data.gear.find((x) => x.slug === slug);
      if (!g) return;
      if (!g.price_history) g.price_history = [];
      g.price_history.push({ date: payload.date || new Date().toISOString().slice(0, 10), ...payload });
      if (payload.price != null) g.price = payload.price;
      renderGear();
      saveSnapshot();
    },
  });
}

async function fetchGearPriceFetch(apiUrl, token, slug, platform) {
  const url = `${apiBase(apiUrl)}/gear/${encodeURIComponent(slug)}/price/fetch`;
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(platform ? { platform } : {}),
  };
  return mutateRequest({ url, options, label: '自动抓取价格' });
}

async function fetchScrapeGear(apiUrl, token, url) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/scrape/gear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ url }),
  }, 30000, '抓取装备信息');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`抓取失败 (${res.status})${text ? ': ' + text.slice(0, 120) : ''}`);
  }
  return res.json();
}

async function fetchAiGear(apiUrl, token, text, sourceUrl) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/ai/gear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ text, source_url: sourceUrl }),
  }, 45000, 'AI 识别装备');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI 识别失败 (${res.status})${text ? ': ' + text.slice(0, 120) : ''}`);
  }
  return res.json();
}

/** AI 解析路线自然语言描述 → 结构化字段（后端 /ai/route，双 AI 取优）。 */
async function fetchAiRoute(apiUrl, token, text, sourceUrl) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/ai/route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ text, source_url: sourceUrl }),
  }, 45000, 'AI 识别路线');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI 识别失败 (${res.status})${t ? ': ' + t.slice(0, 120) : ''}`);
  }
  return res.json();
}

/** AI 解析身体状态自然语言描述 → 结构化字段。 */
async function fetchAiBody(apiUrl, token, text) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/ai/body`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ text }),
  }, 45000, 'AI 识别身体记录');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI 识别失败 (${res.status})${t ? ': ' + t.slice(0, 120) : ''}`);
  }
  return res.json();
}

/** AI 解析活动自然语言描述 → 结构化字段。 */
async function fetchAiActivity(apiUrl, token, text) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/ai/activity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ text }),
  }, 45000, 'AI 识别活动');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI 识别失败 (${res.status})${t ? ': ' + t.slice(0, 120) : ''}`);
  }
  return res.json();
}

/** AI 助手聊天：发送对话历史与数据上下文，返回 Markdown 答案。 */
async function fetchAssistantChat(apiUrl, token, messages, context) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/assistant/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ messages, context }),
  }, 60000, 'AI 助手');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI 助手失败 (${res.status})${t ? ': ' + t.slice(0, 120) : ''}`);
  }
  return res.json();
}

/** 保存单条身体记录：PUT /body/:date（存在则更新、不存在则插入）。 */
async function fetchSaveBody(apiUrl, token, date, data, rawMarkdown) {
  const url = `${apiBase(apiUrl)}/body/${encodeURIComponent(date)}`;
  const expectedUpdatedAt = getExpectedUpdatedAt('body', date);
  const options = {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ data, raw_markdown: rawMarkdown, expected_updated_at: expectedUpdatedAt }),
  };
  return mutateRequest({
    url,
    options,
    label: '保存身体记录',
    expectedUpdatedAt,
    optimistic: () => {
      const merged = { date, ...data };
      const idx = state.data.body_logs.findIndex((b) => String(b.date) === String(date));
      if (idx >= 0) state.data.body_logs[idx] = { ...state.data.body_logs[idx], ...merged };
      else state.data.body_logs.push(merged);
      state.data.body_logs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      renderBody();
      saveSnapshot();
    },
  });
}

/** 保存单条路线：PUT /routes/:slug（存在则更新、不存在则插入）。body = { data, raw_markdown? }。 */
async function fetchSaveRoute(apiUrl, token, slug, payload) {
  const url = `${apiBase(apiUrl)}/routes/${encodeURIComponent(slug)}`;
  const expectedUpdatedAt = getExpectedUpdatedAt('routes', slug);
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
    label: '保存路线',
    expectedUpdatedAt,
    optimistic: () => {
      const merged = { slug, ...payload.data };
      const idx = state.data.routes.findIndex((r) => r.slug === slug);
      if (idx >= 0) state.data.routes[idx] = { ...state.data.routes[idx], ...merged };
      else state.data.routes.push(merged);
      renderRoutes();
      saveSnapshot();
    },
  });
}

/** 请求装备推荐：POST /recommend。 */
async function fetchRecommend(apiUrl, token, payload) {
  const res = await fetchWithTimeout(`${apiBase(apiUrl)}/recommend`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  }, 45000, '生成装备推荐');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`推荐失败 (${res.status})${t ? ': ' + t.slice(0, 120) : ''}`);
  }
  return res.json();
}

/** 保存计划：POST /plans。 */
async function fetchSavePlan(apiUrl, token, payload) {
  const url = `${apiBase(apiUrl)}/plans`;
  const expectedUpdatedAt = payload.id ? getExpectedUpdatedAt('plans', payload.id) : undefined;
  const options = {
    method: 'POST',
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
    label: '保存计划',
    expectedUpdatedAt,
    optimistic: () => {
      const merged = { id: payload.id || ('offline-' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))), ...payload };
      const idx = state.data.plans.findIndex((p) => p.id != null && String(p.id) === String(merged.id));
      if (idx >= 0) state.data.plans[idx] = { ...state.data.plans[idx], ...merged };
      else state.data.plans.push(merged);
      state.data.plans.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      renderPlans();
      saveSnapshot();
    },
  });
}

/** 保存报告：POST /reports */
async function fetchSaveReport(apiUrl, token, payload) {
  const url = `${apiBase(apiUrl)}/reports`;
  const tempId = 'offline-report-' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  };
  return mutateRequest({
    url,
    options,
    label: '保存报告',
    optimistic: () => {
      const merged = { id: tempId, ...payload.data, _raw_markdown: payload.raw_markdown };
      const reports = state.data.reports || [];
      reports.push(merged);
      state.data.reports = reports.sort((a, b) => String(b.period_key).localeCompare(String(a.period_key)));
      renderReports();
      saveSnapshot();
    },
  });
}

/** 更新报告：PUT /reports/:id */
async function fetchUpdateReport(apiUrl, token, id, payload) {
  const url = `${apiBase(apiUrl)}/reports/${encodeURIComponent(id)}`;
  const expectedUpdatedAt = getExpectedUpdatedAt('reports', id);
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
    label: '更新报告',
    expectedUpdatedAt,
    optimistic: () => {
      const reports = state.data.reports || [];
      const idx = reports.findIndex((r) => String(r.id) === String(id));
      if (idx >= 0) {
        reports[idx] = { ...reports[idx], ...payload.data, _raw_markdown: payload.raw_markdown };
        state.data.reports = reports;
      }
      renderReports();
      saveSnapshot();
    },
  });
}
