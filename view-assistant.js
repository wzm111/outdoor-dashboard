/* AI 助手对话视图 */
'use strict';

function renderAssistant() {
  const view = viewEl('assistant');
  clearViewKeepSkeleton(view);

  const header = el('div', { class: 'section-title', style: 'justify-content:space-between;' },
    el('span', {}, 'AI 助手'),
    el('button', { class: 'btn-sm', 'data-action': 'clear-chat' }, '清空对话')
  );
  view.appendChild(header);

  const messagesWrap = el('div', { class: 'chat-messages' });
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

  function classifyUserIntent(text) {
    const t = String(text || '').trim();
    if (!t) return 'query';
    const planSignals = ['帮我计划', '帮我规划', '计划', '规划', '安排', '推荐装备', '生成计划'];
    if (planSignals.some((w) => t.includes(w))) return 'plan';
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
    if (!messages.length) {
      renderWelcome();
      return;
    }

    for (const m of messages) {
      const isUser = m.role === 'user';
      const bubble = el('div', { class: `chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-ai'}` });
      const meta = el('div', { class: 'chat-bubble-meta' },
        el('span', { class: 'chat-bubble-avatar' }, isUser ? '你' : '🏔️'),
        el('span', { class: 'chat-bubble-name' }, isUser ? '你' : '户外助手'),
        el('span', { class: 'chat-bubble-time' }, formatChatTime(m.time))
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
        content: `✅ ${result.message}\n\n${action.preview || ''}`,
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

    const context = buildAssistantContext(state.data, classifyUserIntent(text));
    const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetchAssistantChat(state.apiUrl, state.token, apiMessages, context);
      if (!res.ok) {
        throw new Error(res.error || 'AI 回复失败');
      }

      if (res.type === 'proposed_action') {
        const action = {
          intent: res.intent,
          action: res.action,
          data: res.data,
          existing: res.existing,
          message: res.message,
          preview: res.preview,
        };
        // 用完整 state.data 做最终冲突校验
        const localExisting = findLocalConflict(action.intent, action.data);
        if (localExisting) {
          action.existing = localExisting;
          action.action = 'update';
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

  renderMessages();
  adjustTextareaHeight();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
