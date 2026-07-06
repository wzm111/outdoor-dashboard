/* 装备推荐弹窗与计划保存 */
'use strict';

// ---------- 装备推荐 ----------

/** 打开"为路线推荐装备"弹窗。preselectedRoute 为可选的默认路线对象。 */
function openRecommendGear(preselectedRoute) {
  if (!state.token) { toast('请先连接后再使用推荐', 'warn'); return; }

  const routes = [...(state.data.routes || [])].sort((a, b) => String(a.name || a.slug).localeCompare(String(b.name || b.slug)));
  if (!routes.length) { toast('没有路线，请先添加路线', 'warn'); return; }

  const gearMap = new Map((state.data.gear || []).map((g) => [g.slug, g]));
  const today = new Date().toISOString().slice(0, 10);

  const content = el('div', {});

  // --- 表单 ---
  const routeSel = el('select', { class: 'gear-select', style: 'width:100%;' });
  for (const r of routes) {
    routeSel.appendChild(el('option', { value: r.slug }, r.name || r.slug));
  }
  if (preselectedRoute && preselectedRoute.slug) routeSel.value = preselectedRoute.slug;

  const dateInput = el('input', { type: 'date', class: 'gear-select', value: today, style: 'width:100%;' });

  const typeSel = el('select', { class: 'gear-select', style: 'width:100%;' },
    el('option', { value: 'hiking' }, '徒步 hiking'),
    el('option', { value: 'trail_running' }, '越野跑 trail_running'),
    el('option', { value: 'running' }, '路跑 running'),
    el('option', { value: 'camping' }, '露营 camping')
  );
  if (preselectedRoute && preselectedRoute.type) typeSel.value = preselectedRoute.type;

  const daysInput = el('input', { type: 'number', class: 'gear-select', value: '1', min: '1', max: '30', style: 'width:100%;' });

  const weatherAuto = el('input', { type: 'radio', name: 'weather-source', value: 'auto', checked: 'checked' });
  const weatherManual = el('input', { type: 'radio', name: 'weather-source', value: 'manual' });

  const manualWeatherBox = el('div', { class: 'form-row', style: 'display:none;flex-wrap:wrap;gap:10px;' });
  const tempLowInput = el('input', { type: 'number', class: 'gear-select', value: '15', placeholder: '最低温 °C', style: 'flex:1;min-width:80px;' });
  const tempHighInput = el('input', { type: 'number', class: 'gear-select', value: '25', placeholder: '最高温 °C', style: 'flex:1;min-width:80px;' });
  const rainInput = el('input', { type: 'number', class: 'gear-select', value: '0', min: '0', max: '100', placeholder: '降水概率 %', style: 'flex:1;min-width:80px;' });
  const windInput = el('input', { type: 'number', class: 'gear-select', value: '10', placeholder: '最大风速 km/h', style: 'flex:1;min-width:80px;' });
  const uvInput = el('input', { type: 'number', class: 'gear-select', value: '5', placeholder: 'UV', style: 'flex:1;min-width:80px;' });
  const summaryInput = el('input', { type: 'text', class: 'gear-select', value: '手动设置', placeholder: '天气简述', style: 'flex:1 1 100%;min-width:80px;' });
  manualWeatherBox.append(tempLowInput, tempHighInput, rainInput, windInput, uvInput, summaryInput);

  function updateWeatherSource() {
    manualWeatherBox.style.display = weatherManual.checked ? 'flex' : 'none';
  }
  weatherAuto.addEventListener('change', updateWeatherSource);
  weatherManual.addEventListener('change', updateWeatherSource);

  const form = el('div', { class: 'recommend-form' },
    el('div', { class: 'form-row' }, el('label', {}, '路线'), routeSel),
    el('div', { class: 'form-row' }, el('label', {}, '日期'), dateInput),
    el('div', { class: 'form-row' }, el('label', {}, '活动类型'), typeSel),
    el('div', { class: 'form-row' }, el('label', {}, '天数'), daysInput),
    el('div', { class: 'form-row', style: 'align-items:center;gap:14px;' },
      el('label', { style: 'display:flex;align-items:center;gap:6px;' }, weatherAuto, '自动天气'),
      el('label', { style: 'display:flex;align-items:center;gap:6px;' }, weatherManual, '手动天气')
    ),
    manualWeatherBox
  );

  // --- 结果区 ---
  const resultArea = el('div', { class: 'scrape-result', style: 'margin-top:14px;' });
  const genBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, '生成装备推荐');

  content.appendChild(form);
  content.appendChild(genBtn);
  content.appendChild(resultArea);

  let lastResult = null;
  let workingGear = []; // { originalSlug, currentSlug, checked }

  function renderResult() {
    resultArea.innerHTML = '';
    if (!lastResult) return;

    const { weather, backpack, total_weight_g, total_volume_l, risks, route, days, consumables, weather_source } = lastResult;

    // 摘要卡片
    const summary = el('div', { class: 'recommend-summary card', style: 'margin-bottom:12px;padding:12px;' });
    const weatherSourceLabel = weather_source === 'manual' ? '手动' : weather_source === 'fallback' ? '默认兜底' : '自动';
    summary.appendChild(el('div', { class: 'section-title' }, `${weather.summary} · ${weather.temp_low_c}°C ~ ${weather.temp_high_c}°C · ${weatherSourceLabel}`));
    summary.appendChild(el('div', { class: 'rel-brief' }, `降水 ${weather.precipitation_chance}% · 风速 ${weather.wind_speed_kmh}km/h · UV ${weather.uv_index}`));
    if (backpack) {
      summary.appendChild(el('div', { class: 'rel-brief' }, `${backpack.name}（${backpack.capacity_l} L）：${backpack.reason}`));
    }
    summary.appendChild(el('div', { class: 'rel-brief' }, `总重量 ${(total_weight_g / 1000).toFixed(2)} kg · 总体积 ${Number(total_volume_l).toFixed(1)} L`));
    resultArea.appendChild(summary);

    // 全选
    const listHeader = el('div', { class: 'gear-card-actions', style: 'margin-bottom:8px;' });
    const selectAllBtn = el('button', { class: 'btn-sm' }, '全选');
    const deselectAllBtn = el('button', { class: 'btn-sm' }, '取消全选');
    listHeader.appendChild(selectAllBtn);
    listHeader.appendChild(deselectAllBtn);
    resultArea.appendChild(listHeader);

    selectAllBtn.addEventListener('click', () => { workingGear.forEach((x) => x.checked = true); renderList(); updateTotals(); });
    deselectAllBtn.addEventListener('click', () => { workingGear.forEach((x) => x.checked = false); renderList(); updateTotals(); });

    const list = el('div', { class: 'rel-list' });
    resultArea.appendChild(list);

    const dayLabel = (itemDays, totalDays) => {
      if (!itemDays || itemDays.length === 0) return '每日';
      const min = Math.min(...itemDays);
      const max = Math.max(...itemDays);
      if (min === 1 && max === totalDays && itemDays.length === totalDays) return '每日';
      if (min >= 2) return `Day ${min}+`;
      return `Day ${itemDays.join(',')}`;
    };

    function updateTotals() {
      let w = 0, v = 0;
      for (const item of workingGear) {
        if (!item.checked) continue;
        const g = gearMap.get(item.currentSlug);
        if (g) {
          w += Number(g.weight_g) || 0;
          v += Number(g.packed_volume_l) || 0;
        }
      }
      for (const c of (consumables || [])) {
        w += Number(c.weight_g) || 0;
        v += Number(c.packed_volume_l) || 0;
      }
      summary.querySelector('.rel-brief:last-child').textContent = `总重量 ${(w / 1000).toFixed(2)} kg · 总体积 ${v.toFixed(1)} L`;
    }

    function renderList() {
      list.innerHTML = '';
      const groups = {};
      for (const item of workingGear) {
        const g = gearMap.get(item.currentSlug);
        if (!g) continue;
        const label = dayLabel(item.days, days || 1);
        groups[label] = groups[label] || [];
        groups[label].push({ item, g });
      }
      const orderedLabels = Object.keys(groups).sort((a, b) => {
        if (a === '每日') return -1;
        if (b === '每日') return 1;
        return a.localeCompare(b);
      });
      for (const label of orderedLabels) {
        if ((days || 1) > 1) {
          list.appendChild(el('div', { class: 'subsection-title', style: 'margin:8px 0 4px;' }, label));
        }
        for (const { item, g } of groups[label]) {
          const row = el('div', { class: 'rel-item gear-edit-row' });
          const cb = el('input', { type: 'checkbox' });
          cb.checked = item.checked;
          cb.addEventListener('change', () => { item.checked = cb.checked; updateTotals(); });

          const info = el('div', { class: 'rel-info', style: 'flex:1;' });
          info.appendChild(el('div', { class: 'rel-name' }, g.name || g.slug));
          info.appendChild(el('div', { class: 'rel-brief' },
            [g.weight_g ? num(g.weight_g, 0) + ' g' : null, categoryLabel(g.category), item.originalSlug !== item.currentSlug ? '已替换' : null]
              .filter(Boolean).join(' · ')));
          if (item.reasoning && item.reasoning.chips && item.reasoning.chips.length) {
            const chips = el('div', { class: 'reasoning-chips' });
            for (const chip of item.reasoning.chips.slice(0, 3)) {
              chips.appendChild(el('span', { class: 'reasoning-chip', title: item.reasoning.summary || '' }, chip));
            }
            info.appendChild(chips);
          }

          // 替换下拉：同类别、在用、不是当前项
          const subSel = el('select', { class: 'gear-select', style: 'min-width:120px;' },
            el('option', { value: '' }, '替换为…')
          );
          const alternatives = (state.data.gear || [])
            .filter((x) => x.category === g.category && x.condition !== 'retired' && x.slug !== item.currentSlug);
          for (const alt of alternatives) {
            subSel.appendChild(el('option', { value: alt.slug }, `${alt.name || alt.slug}${alt.weight_g ? ' (' + num(alt.weight_g, 0) + 'g)' : ''}`));
          }
          subSel.value = '';
          subSel.addEventListener('change', () => {
            if (!subSel.value) return;
            item.currentSlug = subSel.value;
            renderList();
            updateTotals();
          });

          row.appendChild(el('label', { style: 'display:flex;align-items:center;gap:10px;flex:1;' }, cb, info));
          row.appendChild(subSel);
          list.appendChild(row);
        }
      }
    }

    renderList();

    // 消耗品
    if (consumables && consumables.length) {
      const consBox = el('div', { class: 'recommend-summary card', style: 'margin-top:12px;padding:12px;' });
      consBox.appendChild(el('div', { class: 'subsection-title' }, '消耗品（按行程天数估算）'));
      for (const c of consumables) {
        consBox.appendChild(el('div', { class: 'rel-brief' },
          `${c.name} · ${c.quantity} ${c.unit} · ${c.weight_g} g · ${Number(c.packed_volume_l).toFixed(1)} L · ${c.reason}`));
      }
      resultArea.appendChild(consBox);
    }

    // 风险提醒
    if (risks && risks.length) {
      const riskBox = el('div', { class: 'wear-badge wear-alert', style: 'margin-top:12px;' });
      for (const r of risks) riskBox.appendChild(el('div', {}, r));
      resultArea.appendChild(riskBox);
    }
  }

  function showWeatherFallbackModal(weather) {
    return new Promise((resolve) => {
      const content = el('div', {},
        el('div', { class: 'error-text', style: 'margin-bottom:12px;' }, '自动天气获取失败，当前使用的是兜底天气。请手动输入或继续使用。'),
        el('div', { class: 'rel-brief' }, `${weather.summary} · ${weather.temp_low_c}°C ~ ${weather.temp_high_c}°C · 降水 ${weather.precipitation_chance}% · 风速 ${weather.wind_speed_kmh}km/h · UV ${weather.uv_index}`)
      );
      const manualBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, '手动输入并重新推荐');
      const useBtn = el('button', { class: 'btn', 'data-no-autoclose': '1' }, '使用默认兜底');
      manualBtn.addEventListener('click', () => { close(); resolve('manual'); });
      useBtn.addEventListener('click', () => { close(); resolve('use'); });
      const close = showModal('天气获取失败', content, [manualBtn, useBtn]);
    });
  }

  async function runRecommend() {
    const routeSlug = routeSel.value;
    if (!routeSlug) { toast('请选择路线', 'warn'); return; }

    const payload = {
      route_slug: routeSlug,
      date: dateInput.value,
      type: typeSel.value,
      days: Number(daysInput.value) || 1,
    };

    if (weatherManual.checked) {
      payload.weather_manual = {
        temp_low_c: Number(tempLowInput.value),
        temp_high_c: Number(tempHighInput.value),
        precipitation_chance: Number(rainInput.value),
        wind_speed_kmh: Number(windInput.value),
        uv_index: Number(uvInput.value),
        summary: summaryInput.value.trim() || '手动设置',
      };
    }

    genBtn.disabled = true;
    genBtn.textContent = '推荐中…';
    resultArea.innerHTML = '';
    try {
      const res = await fetchRecommend(state.apiUrl, state.token, payload);
      if (!res.ok) throw new Error(res.error || '推荐失败');

      if (res.weather_failed && weatherAuto.checked) {
        const choice = await showWeatherFallbackModal(res.weather);
        if (choice === 'manual') {
          tempLowInput.value = res.weather.temp_low_c;
          tempHighInput.value = res.weather.temp_high_c;
          rainInput.value = res.weather.precipitation_chance;
          windInput.value = res.weather.wind_speed_kmh;
          uvInput.value = res.weather.uv_index;
          summaryInput.value = '手动设置';
          weatherManual.checked = true;
          weatherAuto.checked = false;
          updateWeatherSource();
          await runRecommend();
          return;
        }
      }

      lastResult = res;
      workingGear = (res.gear || []).map((g) => ({ originalSlug: g.slug, currentSlug: g.slug, checked: true, days: g.days, reasoning: g.reasoning }));
      if (res.backpack) {
        workingGear.push({ originalSlug: res.backpack.slug, currentSlug: res.backpack.slug, checked: true, days: null, reasoning: null });
      }
      renderResult();
      saveBtn.disabled = false;
      saveBtn.textContent = '保存计划';
    } catch (err) {
      resultArea.appendChild(el('div', { class: 'error-text' }, err.message || '推荐失败'));
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = '生成装备推荐';
    }
  }

  genBtn.addEventListener('click', runRecommend);

  // --- 保存按钮 ---
  const saveBtn = el('button', { class: 'btn btn-primary', 'data-no-autoclose': '1' }, '保存计划');
  saveBtn.disabled = true;
  saveBtn.addEventListener('click', async () => {
    if (!lastResult) { toast('请先生成推荐', 'warn'); return; }
    const slugs = workingGear.filter((x) => x.checked).map((x) => x.currentSlug);
    if (!slugs.length) { toast('请至少选择一件装备', 'warn'); return; }

    const route = routes.find((r) => r.slug === routeSel.value);
    const planData = {
      plan_type: 'trip',
      date: dateInput.value,
      route: route ? route.name : routeSel.value,
      type: typeSel.value,
      distance_km: lastResult.route.distance_km,
      elevation_gain_m: lastResult.route.elevation_gain_m,
      elevation_loss_m: lastResult.route.elevation_loss_m,
      estimated_hours: lastResult.route.estimated_hours,
      days: Number(daysInput.value) || 1,
      weather: lastResult.weather,
      weather_source: lastResult.weather_source,
      gear_recommended: slugs,
      backpack_recommended: lastResult.backpack ? lastResult.backpack.slug : null,
      total_weight_g: lastResult.total_weight_g,
      total_volume_l: lastResult.total_volume_l,
      risks: lastResult.risks,
      generated_at: lastResult.generated_at,
    };

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    try {
      await fetchSavePlan(state.apiUrl, state.token, { data: planData, raw_markdown: lastResult.raw_markdown });
      toast('计划已保存', 'success');
      close();
      await loadAndRender(true);
      switchView('plans');
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = '保存计划';
    }
  });

  const closeBtn = el('button', { class: 'btn' }, '关闭');
  const close = showModal('推荐装备与计划', content, [saveBtn, closeBtn]);
}
