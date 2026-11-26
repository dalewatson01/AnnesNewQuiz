// Generates one day of Anne's daily quiz and writes questions.json.
// Reads quiz-config.json and used-questions.json from the repo root.
// Provider: env LLM_PROVIDER ('gemini' default, or 'openai').
// Keys come from env GEMINI_API_KEY / OPENAI_API_KEY (GitHub secrets).
// Run: node scripts/generate-quiz.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const config = JSON.parse(readFileSync(`${ROOT}quiz-config.json`, 'utf8'));
const used = JSON.parse(readFileSync(`${ROOT}used-questions.json`, 'utf8'));
const PROVIDER = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
const MAX_ATTEMPTS = 3;

function sydneyDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}
const TODAY = sydneyDate();
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const usedQuestions = new Set(used.entries.map((e) => norm(e.question)));

async function fetchHeadlines() {
  try {
    const res = await fetch('https://www.abc.net.au/news/feed/45910/rss.xml', {
      headers: { 'User-Agent': 'AnnesDailyQuiz/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const titles = [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim())
      .filter((t) => t && !/^ABC News/i.test(t));
    return titles.slice(0, 12);
  } catch (e) {
    console.log('Headlines unavailable:', e.message);
    return [];
  }
}

function buildPrompt(headlines, retryNotes = '') {
  const usedList = used.entries.map((e) => `- ${e.question}`).join('\n');
  const weights = Object.entries(config.weights).map(([c, w]) => `${c}: ${w}`).join(', ');
  const groups = config.groups.map((g) => `${g.name} (${g.categories.join(', ')})`).join('; ');
  const headlineBlock = headlines.length
    ? `Recent headlines from ABC News (use at most one current-events question, and only if a headline supports an accurate one):\n${headlines.map((h) => `- ${h}`).join('\n')}`
    : 'No headlines could be fetched today: do not write a current-events question; use an extra question from a high-weight category instead.';
  return `You write a daily general knowledge quiz for Anne, a keen quizzer in her 60s in Melbourne, Australia. Today is ${TODAY}.

Difficulty: ${config.difficulty} out of 15. ${config.difficultyGuide}

Category emphasis (weights out of 10, higher means more questions): ${weights}.
Groups (five groups of three questions): ${groups}.

Rules:
${config.rules.map((r) => `- ${r}`).join('\n')}

${headlineBlock}

Questions already used - never repeat any of these, even reworded:
${usedList}

Return ONLY a JSON object with this exact shape, no other text:
{"questions": [{"group": "Screen & Stage", "category": "Film", "type": "multiple_choice", "question": "...", "options": ["...", "...", "...", "..."], "answer": "...", "fact": "..."}, {"group": "Screen & Stage", "category": "Television", "type": "typed", "question": "...", "answer": "...", "fact": "..."}]}
Multiple choice questions need "options" with exactly 4 entries including the answer. Typed questions have no "options" field.
${retryNotes}`;
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set (add it as a repository secret)');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
  if (!text) throw new Error('Gemini returned no text');
  return text;
}

async function callOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set (add it as a repository secret)');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned no text');
  return text;
}

function extractJson(raw) {
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

function validate(set) {
  const errors = [];
  if (!set || !Array.isArray(set.questions) || set.questions.length !== 15) {
    errors.push('must have exactly 15 questions');
    return errors;
  }
  const qs = set.questions;
  const mc = qs.filter((q) => q.type === 'multiple_choice');
  const typed = qs.filter((q) => q.type === 'typed');
  if (mc.length !== 8) errors.push(`expected 8 multiple choice, got ${mc.length}`);
  if (typed.length !== 7) errors.push(`expected 7 typed, got ${typed.length}`);
  const groupCounts = {};
  const monthRe = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
  const yearRe = /\b(1[0-9]{3}|20[0-9]{2})\b/;
  qs.forEach((q, i) => {
    const n = i + 1;
    if (!q.question || !q.answer || !q.fact) errors.push(`Q${n} missing question/answer/fact`);
    if (!config.groups.some((g) => g.name === q.group)) errors.push(`Q${n} has unknown group "${q.group}"`);
    else groupCounts[q.group] = (groupCounts[q.group] || 0) + 1;
    const knownCategory = Object.keys(config.weights).includes(q.category);
    if (!knownCategory) errors.push(`Q${n} has unknown category "${q.category}"`);
    if (q.type === 'multiple_choice') {
      if (!Array.isArray(q.options) || q.options.length !== 4) errors.push(`Q${n} needs exactly 4 options`);
      else if (!q.options.includes(q.answer)) errors.push(`Q${n} answer is not among its options`);
    } else if (q.type === 'typed') {
      const a = String(q.answer);
      if (/^\s*[\d][\d,.\s]*$/.test(a)) errors.push(`Q${n} typed answer is a number; numbers must be multiple choice`);
      else if (monthRe.test(a) || yearRe.test(a)) errors.push(`Q${n} typed answer looks like a date or year; dates and years must be multiple choice`);
    } else {
      errors.push(`Q${n} has unknown type "${q.type}"`);
    }
    if (usedQuestions.has(norm(q.question || ''))) errors.push(`Q${n} repeats a used question`);
  });
  config.groups.forEach((g) => {
    if (groupCounts[g.name] !== 3) errors.push(`group ${g.name} should have 3 questions, has ${groupCounts[g.name] || 0}`);
  });
  return errors;
}

async function callLLM(prompt) {
  if (PROVIDER === 'openai') return callOpenAI(prompt);
  if (PROVIDER === 'gemini') return callGemini(prompt);
  throw new Error(`Unknown LLM_PROVIDER "${PROVIDER}" (use gemini or openai)`);
}

const headlines = await fetchHeadlines();
console.log(`Headlines fetched: ${headlines.length}`);
let set = null;
let lastErrors = [];
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const retryNotes = attempt > 1
    ? `\nYour previous attempt had these problems - fix all of them:\n${lastErrors.map((e) => `- ${e}`).join('\n')}\n`
    : '';
  let raw;
  try {
    raw = await callLLM(buildPrompt(headlines, retryNotes));
  } catch (e) {
    lastErrors = [`LLM call failed: ${e.message}`];
    console.log(`Attempt ${attempt} failed: ${lastErrors[0]}`);
    continue;
  }
  try {
    set = extractJson(raw);
  } catch {
    lastErrors = ['LLM output was not valid JSON'];
    console.log(`Attempt ${attempt} failed: ${lastErrors[0]}`);
    continue;
  }
  set.questions.forEach((q) => { if (q.category === 'Science') q.category = 'Science & Nature'; });
  lastErrors = validate(set);
  if (!lastErrors.length) break;
  console.log(`Attempt ${attempt} failed validation: ${lastErrors.join('; ')}`);
  set = null;
}
if (!set) {
  console.error(`Failed after ${MAX_ATTEMPTS} attempts: ${lastErrors.join('; ')}`);
  process.exit(1);
}
set.questions.forEach((q, i) => { q.id = i + 1; });
const out = { date: TODAY, difficulty: config.difficulty, questions: set.questions };
writeFileSync(`${ROOT}questions.json`, `${JSON.stringify(out, null, 2)}\n`);
used.entries.push(...set.questions.map((q) => ({
  date: TODAY, category: q.category, type: q.type, question: q.question, answer: q.answer,
})));
writeFileSync(`${ROOT}used-questions.json`, `${JSON.stringify(used, null, 2)}\n`);
console.log(`Wrote ${out.questions.length} questions for ${TODAY} at difficulty ${config.difficulty}`);
