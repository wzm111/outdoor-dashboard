/* 身体日志自然语言快速解析（客户端，无需 AI） */
'use strict';

/** 解析中文/阿拉伯数字 */
function parseChineseNumber(str) {
  if (!str) return NaN;
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  str = str.trim();
  if (/^\d+(\.\d+)?$/.test(str)) return Number(str);
  let total = 0;
  for (const ch of str) {
    if (map[ch] != null) total += map[ch];
  }
  return total || NaN;
}

/** 从一句话解析身体日志字段。
 * 支持：睡眠 7h / 疲劳 3 / 肌肉酸痛 2 / 膝盖良好 / 心情 8 / 体重 70.2kg
 */
function parseBodyQuickText(text, defaultDate = null) {
  const data = { date: defaultDate || new Date().toISOString().slice(0, 10) };

  // 睡眠：睡了? X(小时/h) / 睡眠 X
  const sleepMatch = text.match(/睡了?\s*(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*(小时|h|hrs?)?/i) ||
                     text.match(/睡眠\s*(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)/i);
  if (sleepMatch) {
    const v = parseChineseNumber(sleepMatch[1]);
    if (!isNaN(v)) data.sleep_hours = v;
  }

  // 疲劳：疲劳(度)? X
  const fatigueMatch = text.match(/疲劳(?:度)?\s*(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)/i);
  if (fatigueMatch) {
    const v = parseChineseNumber(fatigueMatch[1]);
    if (!isNaN(v)) data.fatigue = v;
  }

  // 肌肉酸痛：酸痛 / 肌肉酸痛 X
  const soreMatch = text.match(/(?:肌肉)?酸痛(?:度)?\s*(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)/i);
  if (soreMatch) {
    const v = parseChineseNumber(soreMatch[1]);
    if (!isNaN(v)) data.muscle_soreness = v;
  }

  // 膝盖：膝盖(状态)? (良好|正常|一般|不佳|差)
  const kneeMatch = text.match(/膝盖(?:状态)?\s*(良好|正常|一般|不佳|差|good|fair|poor)/i);
  if (kneeMatch) {
    const mapping = { 良好: 'good', 正常: 'good', 一般: 'fair', 不佳: 'poor', 差: 'poor', good: 'good', fair: 'fair', poor: 'poor' };
    data.knee_status = mapping[kneeMatch[1].toLowerCase()];
  }

  // 心情：心情 X
  const moodMatch = text.match(/心情\s*(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)/i);
  if (moodMatch) {
    const v = parseChineseNumber(moodMatch[1]);
    if (!isNaN(v)) data.mood = v;
  }

  // 体重：体重 X(kg/公斤/千克)
  const weightMatch = text.match(/体重\s*(\d+(?:\.\d+)?)\s*(kg|公斤|千克)?/i);
  if (weightMatch) {
    const v = Number(weightMatch[1]);
    if (!isNaN(v)) data.weight_kg = v;
  }

  // 日期：前天/昨天/今天/明天/后天 或 7月15日 / 2026-07-15
  const dateMatch = text.match(/(前天|昨天|今天|明天|后天)|(\d{1,2})月(\d{1,2})日|(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    const today = new Date();
    if (dateMatch[1]) {
      const offsets = { 前天: -2, 昨天: -1, 今天: 0, 明天: 1, 后天: 2 };
      const d = new Date(today);
      d.setDate(today.getDate() + offsets[dateMatch[1]]);
      data.date = d.toISOString().slice(0, 10);
    } else if (dateMatch[4]) {
      data.date = dateMatch[4];
    } else if (dateMatch[2] && dateMatch[3]) {
      const year = today.getFullYear();
      data.date = `${year}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`;
    }
  }

  // 备注：把未匹配到的描述性文字作为备注
  const knownPatterns = [
    /睡了?\s*(?:\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*(?:小时|h|hrs?)?/gi,
    /睡眠\s*(?:\d+(?:\.\d+)?|[一二两三四五六七八九十]+)/gi,
    /疲劳(?:度)?\s*(?:\d+(?:\.\d+)?|[一二两三四五六七八九十]+)/gi,
    /(?:肌肉)?酸痛(?:度)?\s*(?:\d+(?:\.\d+)?|[一二两三四五六七八九十]+)/gi,
    /膝盖(?:状态)?\s*(?:良好|正常|一般|不佳|差|good|fair|poor)/gi,
    /心情\s*(?:\d+(?:\.\d+)?|[一二两三四五六七八九十]+)/gi,
    /体重\s*(?:\d+(?:\.\d+)?)\s*(?:kg|公斤|千克)?/gi,
    /(?:前天|昨天|今天|明天|后天)/g,
    /\d{1,2}月\d{1,2}日/g,
    /\d{4}-\d{2}-\d{2}/g,
  ];

  let cleaned = text;
  for (const re of knownPatterns) cleaned = cleaned.replace(re, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (cleaned) data.notes = cleaned;

  return data;
}
