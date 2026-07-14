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
      content.innerHTML = isUser ? escapeHtml(m.content) : renderMarkdown(m.content);
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

    const userMessage = { role: 'user', content: text, time: new Date().toISOString() };
    messages.push(userMessage);
    saveChatHistory(messages);
    textarea.value = '';
    adjustTextareaHeight();
    isLoading = true;
    renderMessages();

    const context = buildAssistantContext(state.data);
    const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetchAssistantChat(state.apiUrl, state.token, apiMessages, context);
      if (!res.ok) {
        throw new Error(res.error || 'AI 回复失败');
      }
      messages.push({ role: 'assistant', content: res.answer || '（AI 未返回内容）', time: new Date().toISOString() });
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
