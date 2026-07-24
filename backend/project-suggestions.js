'use strict';
/**
 * MuseForge — /suggest-projects helpers.
 *
 * The "AI Suggestions" button POSTs to /suggest-projects, but that route was missing, so the button
 * 404'd. This module holds the pure, testable pieces of the fix; the route (in server.js) calls
 * generateAiText (LangChain -> watsonx Granite first) and falls back to fallbackProjectSuggestions.
 *
 * FactLock-aware: the prompt tells the model to ground ideas ONLY in the creator's stated medium and
 * description and to invent nothing.
 *
 * No server.js dependencies -> unit-testable on its own.
 */

// Build the chat messages for Granite. Returns [{role, content}, ...] for generateAiText.
function buildSuggestionMessages({ name = '', medium = '', description = '', projects = [], targetLanguage = 'English', aiTone = 'Professional' } = {}) {
  const existing = (Array.isArray(projects) ? projects : [])
    .map(p => String((p && p.title) || '').trim())
    .filter(Boolean);
  const avoid = existing.length ? `Do NOT repeat these existing projects: ${existing.join('; ')}.` : '';

  const system = [
    'You are a creative portfolio assistant for MuseForge.',
    'Suggest EXACTLY 3 portfolio PROJECT ideas for this creator.',
    `Write everything in ${targetLanguage}. Writing tone: ${aiTone}.`,
    'Ground every idea ONLY in the creator\'s stated medium and description. Do NOT invent facts, clients, awards, or specific works they did not mention. This is a no-fabrication guarantee.',
    'Each idea is a concrete, doable portfolio piece: a short title plus a 1-2 sentence description of what to include.',
    avoid,
    'Return ONLY a JSON array of exactly 3 objects, each with keys "title" and "desc". No markdown, no code fences, no text before or after the array.',
  ].filter(Boolean).join(' ');

  const user = [
    name ? `Creator name: ${name}` : '',
    `Creative medium / role: ${medium || 'creative professional'}`,
    description ? `About them: ${description}` : '',
  ].filter(Boolean).join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// Parse the model's reply into [{title, desc}]. Tolerant of code fences, preamble text, and common
// key variations. Returns [] on any failure so the caller can fall back.
function parseSuggestionsFromAiText(text) {
  const raw = String(text || '');
  const stripped = raw.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];

  let arr;
  try {
    arr = JSON.parse(stripped.slice(start, end + 1));
  } catch (_) {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  return arr
    .map(it => ({
      title: String((it && (it.title || it.name || it.project)) || '').trim(),
      desc: String((it && (it.desc || it.description || it.summary || it.details)) || '').trim(),
    }))
    .filter(it => it.title || it.desc);
}

// Turn [{title, desc}] (from AI or fallback) into the frontend's shape: [{id, title, desc}], max 3.
function normalizeSuggestions(items) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (let i = 0; i < list.length && out.length < 3; i += 1) {
    const title = String((list[i] && list[i].title) || '').trim();
    const desc = String((list[i] && list[i].desc) || '').trim();
    if (!title && !desc) continue;
    out.push({
      id: `sug_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
      title: title || 'Untitled project idea',
      desc,
    });
  }
  return out;
}

module.exports = { buildSuggestionMessages, parseSuggestionsFromAiText, normalizeSuggestions };
