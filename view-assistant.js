/* AI 助手对话视图 */
'use strict';

function renderAssistant() {
  const view = viewEl('assistant');
  clearViewKeepSkeleton(view);

  // v1.21.0: 意图模式状态（localStorage 记忆）
  let chatMode = getChatMode();

  const header = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, 'AI 助手'),
    el('div', { style: 'display:flex;gap:8px;' },
      el('button', { class: 'btn-sm', 'data-action': 'scroll-bottom', title: '跳到最新消息' }, '⬇️ 底部'),
      el('button', { class: 'btn-sm', 'data-action': 'clear-chat' }, '清空对话')
    )
  );
  view.appendChild(header);

  // 意图模式切换器：💬 对话 / 📊 分析 / ➕ 创建
  const modeBar = el('div', { class: 'chat-mode-bar' });
  const modeBtns = {};
  function paintModeBar() {
    modeBar.innerHTML = '';
    for (const opt of CHAT_MODE_OPTIONS) {
      const btn = el('button', {
        type: 'button',
        class: 'chat-mode-btn' + (opt.key === chatMode ? ' chat-mode-btn-active' : ''),
        'data-mode': opt.key,
        title: opt.desc,
      }, opt.label);
      btn.addEventListener('click', () => {
        chatMode = opt.key;
        setChatMode(chatMode);
        paintModeBar();
        updatePlaceholder();
      });
      modeBtns[opt.key] = btn;
      modeBar.appendChild(btn);
    }
  }
  const modeDesc = el('div', { class: 'chat-mode-desc' });
  function updatePlaceholder() {
    const opt = CHAT_MODE_OPTIONS.find((o) => o.key === chatMode);
    if (opt) modeDesc.textContent = opt.desc;
  }
  paintModeBar();
  updatePlaceholder();
  view.appendChild(modeBar);
  view.appendChild(modeDesc);

  // 消息容器：限制最大高度为视口的 60%，超出可滚动，避免页面无限拉长
  const messagesWrap = el('div', { class: 'chat-messages', style: 'max-height: 60vh; overflow-y: auto;' });
  const quickWrap = el('div', { class: 'chat-quick-questions' });
  const inputArea = el('div', { class: 'chat-input-area' });
  const textarea = el('textarea', { class: 'chat-textarea', rows: 1, placeholder: '问我关于你的训练、恢复、装备或路线的问题…' });
  const sendBtn = el('button', { class: 'btn btn-primary chat-send-btn', disabled: true }, '发送');
  inputArea.appendChild(textarea);
  inputArea.appendChild(sendBtn);

  view.appendChild(messagesWrap);
  view.appendChild(quickWrap);
  view.appendChild(inputArea);

  let messages = getChatHistory();
  let isLoading = false;

  messagesWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.chat-bubble-delete');
    if (!btn) return;
    e.stopPropagation();
    const id = btn.dataset.id;
    if (id) handleDeleteMessage(id);
  });

  function classifyUserIntent(text) {
    const t = String(text || '').trim();
    if (!t) return 'query';
    const planSignals = ['帮我计划', '帮我规划', '计划', '规划', '安排', '推荐装备', '生成计划'];
    if (planSignals.some((w) => t.includes(w))) return 'plan';
    const reportSignals = ['保存报告', '保存本周', '保存上周', '保存本月', '保存上月', '生成并保存', '保存到历史', '周报', '月报'];
    if (reportSignals.some((w) => t.includes(w))) return 'report';
    const batchSignals = ['批量', '导入', '录入这些', '这些', '这几条', '多条', '历史记录'];
    if (batchSignals.some((w) => t.includes(w))) return 'batch';
    const bodySignals = ['睡眠', '疲劳', '酸痛', '膝盖', '心情', '体重', '身体', '记录身体', '身体日志', '休息', '恢复'];
    if (bodySignals.some((w) => t.includes(w))) return 'body';
    const activitySignals = ['跑步', '跑了', '徒步', '走了', '爬山', '骑行', '骑了', '攀岩', '爬了', '活动', '记录运动', '记录活动'];
    if (activitySignals.some((w) => t.includes(w))) return 'activity';
    if (/^(记录|添加|新增|记一下|保存|写入)/.test(t)) {
      if (/身体|睡眠|疲劳|体重|膝盖|心情|酸痛/.test(t)) return 'body';
      if (/跑|走|骑|爬|活动|运动/.test(t)) return 'activity';
      if (/路线|计划/.test(t)) return 'plan';
    }
    return 'query';
  }

  function makeMessageId() {
    return String(Date.now()) + '_' + String(Math.random()).slice(2, 8);
  }

  function renderMessages() {
    messagesWrap.innerHTML = '';
    renderWeeklyReport();
    if (!messages.length) {
      renderWelcome();
      return;
    }

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (!m.id) m.id = makeMessageId();
      const isUser = m.role === 'user';
      const bubble = el('div', { class: `chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-ai'}` });
      const meta = el('div', { class: 'chat-bubble-meta' },
        el('span', { class: 'chat-bubble-avatar' }, isUser ? '你' : '🏔️'),
        el('span', { class: 'chat-bubble-name' }, isUser ? '你' : '户外助手'),
        el('span', { class: 'chat-bubble-time' }, formatChatTime(m.time)),
        el('button', {
          type: 'button',
          class: 'chat-bubble-delete',
          title: '删除这条对话',
          'data-id': m.id || '',
        }, '×')
      );
      const content = el('div', { class: 'chat-bubble-content' });

      if (!isUser && m.type === 'proposed_action' && m.action) {
        content.appendChild(renderActionCard(m.action, () => handleConfirmAction(m.id), () => handleCancelAction(m.id)));
      } else if (isUser) {
        content.innerHTML = escapeHtml(m.content);
      } else {
        content.innerHTML = renderMarkdown(m.content);
      }

      bubble.appendChild(meta);
      bubble.appendChild(content);
      messagesWrap.appendChild(bubble);
    }

    // 加载中提示
    if (isLoading) {
      const loadingBubble = el('div', { class: 'chat-bubble chat-bubble-ai' },
        el('div', { class: 'chat-bubble-meta' },
          el('span', { class: 'chat-bubble-avatar' }, '🏔️'),
          el('span', { class: 'chat-bubble-name' }, '户外助手'),
          el('span', { class: 'chat-bubble-time' }, '')
        ),
        el('div', { class: 'chat-bubble-content' },
          el('span', { class: 'chat-typing' }, '思考中')
        )
      );
      messagesWrap.appendChild(loadingBubble);
    }

    scrollToBottom();
    renderQuickQuestions();
  }

  async function handleConfirmAction(messageId) {
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx < 0 || messages[idx].type !== 'proposed_action') return;
    const action = messages[idx].action;

    try {
      const result = await executeProposedAction(action);
      if (!result.ok) throw new Error(result.error || '执行失败');
      messages[idx] = {
        id: messageId,
        role: 'assistant',
        content: `${result.queued ? '📥' : '✅'} ${result.message}\n\n${action.preview || ''}`,
        time: new Date().toISOString(),
      };
      saveChatHistory(messages);
      renderMessages();
      await loadAndRender(true);
      toast(result.message, 'success');
    } catch (err) {
      messages[idx] = {
        id: messageId,
        role: 'assistant',
        type: 'proposed_action',
        action,
        content: action.message || '',
        time: new Date().toISOString(),
      };
      saveChatHistory(messages);
      renderMessages();
      toast(err.message || '执行失败', 'error');
    }
  }

  function handleCancelAction(messageId) {
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx < 0 || messages[idx].type !== 'proposed_action') return;
    messages[idx] = {
      id: messageId,
      role: 'assistant',
      content: '已取消操作。',
      time: new Date().toISOString(),
    };
    saveChatHistory(messages);
    renderMessages();
  }

  function handleDeleteMessage(messageId) {
    if (!messageId) return;
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    if (!confirm('删除这条对话？后续 AI 回复将不再参考这条消息。')) return;
    messages.splice(idx, 1);
    saveChatHistory(messages);
    renderMessages();
    toast('已删除', 'success');
  }

  function renderWelcome() {
    messagesWrap.innerHTML = '';
    const welcome = el('div', { class: 'chat-welcome' },
      el('div', { class: 'chat-welcome-icon' }, '🏔️'),
      el('h3', {}, '你好，我是你的户外助手'),
      el('p', {}, '我可以基于你的训练、身体日志、装备和路线数据回答问题。试试下方的快捷问题，或直接输入你想了解的。')
    );
    messagesWrap.appendChild(welcome);
    renderQuickQuestions();
  }

  function renderWeeklyReport() {
    if (!state.data) return;
    if (hasSeenWeeklyReport()) return;

    let report = getWeeklyReportCache();
    if (!report) {
      const summary = computeWeeklySummary(state.data);
      if (!summary) return;
      report = {
        weekKey: summary.weekKey,
        summary,
        generatedAt: new Date().toISOString(),
      };
      saveWeeklyReportCache(report);
    }

    const summary = report.summary;
    const card = el('div', { class: 'chat-weekly-report' });
    const header = el('div', { class: 'chat-weekly-header' },
      el('span', { class: 'chat-weekly-icon' }, '📊'),
      el('span', { class: 'chat-weekly-title' }, `本周训练报告（${summary.range.start} ~ ${summary.range.end}）`),
      el('button', { type: 'button', class: 'chat-weekly-close', title: '不再显示本周报告' }, '×')
    );
    card.appendChild(header);

    const metrics = el('div', { class: 'chat-weekly-metrics' });
    metrics.appendChild(el('div', { class: 'chat-weekly-metric' },
      el('span', { class: 'chat-weekly-value' }, String(summary.activityCount)),
      el('span', { class: 'chat-weekly-label' }, '活动')
    ));
    metrics.appendChild(el('div', { class: 'chat-weekly-metric' },
      el('span', { class: 'chat-weekly-value' }, summary.totalDistance.toFixed(1)),
      el('span', { class: 'chat-weekly-label' }, 'km')
    ));
    metrics.appendChild(el('div', { class: 'chat-weekly-metric' },
      el('span', { class: 'chat-weekly-value' }, String(Math.round(summary.totalElevation))),
      el('span', { class: 'chat-weekly-label' }, '爬升 m')
    ));
    metrics.appendChild(el('div', { class: 'chat-weekly-metric' },
      el('span', { class: 'chat-weekly-value' }, summary.totalDuration.toFixed(1)),
      el('span', { class: 'chat-weekly-label' }, '小时')
    ));
    card.appendChild(metrics);

    const statusLines = [];
    if (summary.acwr.ratio) {
      statusLines.push(`ACWR：${summary.acwr.ratio.toFixed(2)}（${summary.acwr.status}）`);
    }
    if (summary.fatigue.score) {
      statusLines.push(`疲劳：${summary.fatigue.score.toFixed(0)} 分（${summary.fatigue.status}）`);
    }
    if (summary.avgSleep != null) {
      statusLines.push(`平均睡眠：${summary.avgSleep.toFixed(1)} h`);
    }
    if (summary.avgFatigue != null) {
      statusLines.push(`平均疲劳：${summary.avgFatigue.toFixed(1)}`);
    }

    if (statusLines.length) {
      card.appendChild(el('div', { class: 'chat-weekly-status' }, statusLines.join(' · ')));
    }

    const actions = el('div', { class: 'chat-weekly-actions' });
    const detailBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm' }, '查看详细建议');
    const saveBtn = el('button', { type: 'button', class: 'btn btn-sm' }, '保存到历史周报');
    const dismissBtn = el('button', { type: 'button', class: 'btn btn-sm' }, '知道了');

    detailBtn.addEventListener('click', () => {
      textarea.value = '生成本周训练报告。';
      adjustTextareaHeight();
      sendMessage();
      markWeeklyReportSeen();
      card.remove();
    });
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中…';
      const result = await saveHistoricalReportAction(
        { report_type: 'week', period_key: summary.weekKey },
        null
      );
      if (result.ok) {
        toast(result.message, 'success');
        markWeeklyReportSeen();
        card.remove();
        if (!result.queued) renderReports();
      } else {
        toast(result.error || '保存失败', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = '保存到历史周报';
      }
    });
    dismissBtn.addEventListener('click', () => {
      markWeeklyReportSeen();
      card.remove();
    });
    header.querySelector('.chat-weekly-close').addEventListener('click', () => {
      markWeeklyReportSeen();
      card.remove();
    });

    actions.appendChild(detailBtn);
    actions.appendChild(saveBtn);
    actions.appendChild(dismissBtn);
    card.appendChild(actions);

    messagesWrap.appendChild(card);
  }

  function renderQuickQuestions() {
    quickWrap.innerHTML = '';
    if (isLoading) return;
    for (const q of CHAT_QUICK_QUESTIONS) {
      const chip = el('button', { type: 'button', class: 'chat-quick-chip' }, q.label);
      chip.addEventListener('click', () => {
        textarea.value = q.text;
        adjustTextareaHeight();
        sendMessage();
      });
      quickWrap.appendChild(chip);
    }
  }

  function scrollToBottom() {
    messagesWrap.scrollTop = messagesWrap.scrollHeight;
  }

  function adjustTextareaHeight() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    sendBtn.disabled = !textarea.value.trim() || isLoading;
  }

  async function sendMessage() {
    const text = textarea.value.trim();
    if (!text || isLoading) return;
    if (!state.token) {
      toast('请先连接后再使用 AI 助手', 'warn');
      return;
    }

    const userMessage = { id: makeMessageId(), role: 'user', content: text, time: new Date().toISOString() };
    messages.push(userMessage);
    saveChatHistory(messages);
    textarea.value = '';
    adjustTextareaHeight();
    isLoading = true;
    renderMessages();

    // v1.21.0: chat/analyze 模式强制走 query 上下文（不被「跑步/徒步」等关键词误判为创建）
    const intent = (chatMode === 'chat' || chatMode === 'analyze') ? 'query' : classifyUserIntent(text);
    const context = buildAssistantContext(state.data, intent);
    const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetchAssistantChat(state.apiUrl, state.token, apiMessages, context, chatMode);
      if (!res.ok) {
        throw new Error(res.error || 'AI 回复失败');
      }

      if (res.type === 'proposed_action') {
        const action = res.intent === 'batch' ? {
          intent: 'batch',
          action: 'create',
          items: res.items,
          message: res.message,
          preview: res.preview,
        } : {
          intent: res.intent,
          action: res.action,
          data: res.data,
          existing: res.existing,
          message: res.message,
          preview: res.preview,
        };
        if (action.intent !== 'batch') {
          // 用完整 state.data 做最终冲突校验，仅当后端认为是创建时才可能提升为更新
          const localExisting = findLocalConflict(action.intent, action.data);
          if (action.action === 'create' && localExisting) {
            action.existing = localExisting;
            action.action = 'update';
          }
        }
        messages.push({
          id: makeMessageId(),
          role: 'assistant',
          type: 'proposed_action',
          action,
          content: action.message,
          time: new Date().toISOString(),
        });
      } else {
        messages.push({ id: makeMessageId(), role: 'assistant', content: res.answer || '（AI 未返回内容）', time: new Date().toISOString() });
      }
      saveChatHistory(messages);
    } catch (err) {
      toast(err.message || 'AI 回复失败', 'error');
      // 把用户消息也保留，但标注错误
      messages.push({
        role: 'assistant',
        content: `⚠️ 回复失败：${err.message || '请检查网络或稍后重试'}`,
        time: new Date().toISOString(),
      });
      saveChatHistory(messages);
    } finally {
      isLoading = false;
      renderMessages();
    }
  }

  textarea.addEventListener('input', adjustTextareaHeight);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  sendBtn.addEventListener('click', sendMessage);

  $('.btn-sm[data-action="clear-chat"]', header).addEventListener('click', () => {
    if (!messages.length) return;
    if (!confirm('确定清空所有对话记录吗？')) return;
    clearChatHistory();
    messages = [];
    renderMessages();
  });

  $('.btn-sm[data-action="scroll-bottom"]', header).addEventListener('click', () => {
    scrollToBottom();
  });

  renderMessages();
  adjustTextareaHeight();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
