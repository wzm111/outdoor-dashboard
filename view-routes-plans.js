/* 路线 + 计划合并视图渲染
 * 整合 renderRoutes 和 renderPlans 到同一个视图容器
 */
'use strict';

function renderRoutesPlans() {
  const view = viewEl('routes-plans');
  clearViewKeepSkeleton(view);

  // 渲染路线库 —— 复制 renderRoutes 逻辑但指定到合并视图容器
  const routes = [...state.data.routes].sort((a, b) =>
    (Number(b.distance_km) || 0) - (Number(a.distance_km) || 0));
  // 顶部标题 + AI 添加 + 推荐装备按钮
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
  } else {
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
        el('td', { class: 'actions' },
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
    labelTableCells(table, ['名称', '地点', '距离', '爬升', '难度', '预计时长', '操作']);
    wrap.appendChild(table);
    view.appendChild(wrap);
  }

  // 渲染计划（添加上边距分隔两个区块）
  const plans = [...state.data.plans].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const headerRow2 = el('div', { class: 'section-title', style: 'justify-content:space-between;margin-top:24px;' },
    el('span', {}, `计划（${plans.length}）`),
    el('button', { class: 'btn-sm btn-primary', 'data-action': 'add-plan' }, '添加计划')
  );
  view.appendChild(headerRow2);
  $('.btn-sm[data-action="add-plan"]', headerRow2).addEventListener('click', () => openAddPlan());

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
