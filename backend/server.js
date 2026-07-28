const express = require('express');
const { assessCvReadability, UNREADABLE_CV_MESSAGE } = require('./cv-readability');
const cors = require('cors');
const multer = require('multer');
const { PdfReader } = require('pdfreader');
require('@napi-rs/canvas');
const { PDFParse } = require('pdf-parse');
const Groq = require('groq-sdk');
const OpenAI = require('openai');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

// Railway / Vercel proxy fix for express-rate-limit
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration for production
const allowedOrigins = [
  'http://localhost:3000',
  'https://muse-forge.vercel.app',
  'https://museforge.vercel.app',
  process.env.FRONTEND_URL
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.).
    if (!origin) return callback(null, true);

    // During local development React may use 3000, 3001, or another free port.
    const isLocalDev = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
    const isAllowedProductionOrigin = allowedOrigins.some(allowed => origin === allowed || origin.startsWith(`${allowed}/`));

    if (isLocalDev || isAllowedProductionOrigin) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 300 : 1500, // generous during local testing so the demo does not lock itself
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Stricter rate limit for AI endpoints
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 40 : 250, // higher during local testing for repeated CV/FactLock checks
  message: 'Too many AI requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.json({ limit: '120mb' }));
app.use(express.urlencoded({ extended: true, limit: '120mb' }));

// File upload validation
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/pdf', 'application/x-pdf', 'application/octet-stream'];
  const fileName = String(file.originalname || '').toLowerCase();
  const looksLikePdf = fileName.endsWith('.pdf');

  if (!allowedTypes.includes(file.mimetype) && !looksLikePdf) {
    return cb(new Error('Invalid file type. Only PDF files are allowed.'), false);
  }

  cb(null, true);
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 1 // Only 1 file per request
  }
});

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const AI_PROVIDER = String(process.env.AI_PROVIDER || 'auto').toLowerCase().trim();

// IBM watsonx.ai / Granite configuration.
const WATSONX_API_KEY = String(process.env.WATSONX_API_KEY || process.env.IBM_CLOUD_API_KEY || '').trim();
const WATSONX_PROJECT_ID = String(process.env.WATSONX_PROJECT_ID || '').trim();
const WATSONX_SPACE_ID = String(process.env.WATSONX_SPACE_ID || '').trim();
const WATSONX_URL = String(process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com').trim();
const WATSONX_MODEL = String(process.env.WATSONX_MODEL || 'ibm/granite-3-3-8b-instruct').trim();
const WATSONX_API_VERSION = String(process.env.WATSONX_API_VERSION || '2024-05-31').trim();
const WATSONX_STRICT = String(process.env.WATSONX_STRICT || 'false').toLowerCase().trim();

// IBM Docling (document processing). Optional: unset means the local PDF parsers are used.
const DOCLING_URL = String(process.env.DOCLING_URL || '').trim();
const DOCLING_API_KEY = String(process.env.DOCLING_API_KEY || '').trim();
const DOCLING_OCR = String(process.env.DOCLING_OCR || 'false').toLowerCase().trim();
const DOCLING_TIMEOUT_MS = Number(process.env.DOCLING_TIMEOUT_MS || 180000);
const watsonxConfigured = Boolean(WATSONX_API_KEY && (WATSONX_PROJECT_ID || WATSONX_SPACE_ID));
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim();
const GROQ_MODEL = String(process.env.GROQ_MODEL || 'llama-3.3-70b-versatile').trim();
const AI_PROVIDER_COOLDOWN_MS = Number(process.env.AI_PROVIDER_COOLDOWN_MS || 120000);
const disabledAiProviders = new Map();

function quotaLikeError(error) {
  return /quota|rate.?limit|too many requests|429|exceeded|billing/i.test(String(error?.message || error || ''));
}

function providerDisabled(provider) {
  const until = Number(disabledAiProviders.get(provider) || 0);
  if (!until) return false;
  if (Date.now() > until) {
    disabledAiProviders.delete(provider);
    return false;
  }
  return true;
}

function markProviderDisabled(provider, error) {
  if (quotaLikeError(error)) disabledAiProviders.set(provider, Date.now() + AI_PROVIDER_COOLDOWN_MS);
}

function aiAvailable() {
  return Boolean(watsonxConfigured || GEMINI_API_KEY || openai || groq);
}

function selectAiProvider() {
  // IBM watsonx (Granite) is the primary model for this project; the others remain as fallbacks.
  if (AI_PROVIDER === 'langchain' && watsonxConfigured && !providerDisabled('langchain')) return 'langchain';
  if (AI_PROVIDER === 'watsonx' && watsonxConfigured && !providerDisabled('watsonx')) return 'watsonx';
  if (AI_PROVIDER === 'granite' && watsonxConfigured && !providerDisabled('watsonx')) return 'watsonx';
  if (AI_PROVIDER === 'groq' && groq && !providerDisabled('groq')) return 'groq';
  if (AI_PROVIDER === 'openai' && openai && !providerDisabled('openai')) return 'openai';
  if (AI_PROVIDER === 'gemini' && GEMINI_API_KEY && !providerDisabled('gemini')) return 'gemini';
  if (watsonxConfigured && !providerDisabled('watsonx')) return 'watsonx';
  if (groq && !providerDisabled('groq')) return 'groq';
  if (openai && !providerDisabled('openai')) return 'openai';
  if (GEMINI_API_KEY && !providerDisabled('gemini')) return 'gemini';
  return 'none';
}

// ---------------------------------------------------------------------------
// IBM watsonx.ai (Granite) provider.
// Granite runs on watsonx.ai, which authenticates with an IBM Cloud IAM bearer token minted from
// an IBM Cloud API key. The token is cached until shortly before it expires so a portfolio
// generation does not mint a new one for every call.
// ---------------------------------------------------------------------------
let watsonxTokenCache = { token: '', expiresAt: 0 };

async function watsonxAccessToken() {
  const now = Date.now();
  if (watsonxTokenCache.token && now < watsonxTokenCache.expiresAt) return watsonxTokenCache.token;

  const response = await fetch('https://iam.cloud.ibm.com/identity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
      apikey: WATSONX_API_KEY,
    }).toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.errorMessage || `IBM Cloud IAM token request failed with ${response.status}`);
  }
  const ttlMs = (Number(data.expires_in) || 3600) * 1000;
  watsonxTokenCache = { token: data.access_token, expiresAt: now + ttlMs - 60000 };
  return watsonxTokenCache.token;
}

async function callWatsonxText({ messages = [], temperature = 0.15, maxTokens = 1000 } = {}) {
  const token = await watsonxAccessToken();
  const url = `${WATSONX_URL.replace(/\/+$/, '')}/ml/v1/text/chat?version=${WATSONX_API_VERSION}`;

  const body = {
    model_id: WATSONX_MODEL,
    // Pass 'assistant' through instead of collapsing it into 'user'. Nothing sends assistant turns
    // today, but silently rewriting them would corrupt any multi-turn conversation added later.
    messages: messages.map(message => ({
      role: ['system', 'assistant', 'user'].includes(message.role) ? message.role : 'user',
      content: String(message.content || ''),
    })),
    max_tokens: maxTokens,
    // watsonx rejects temperature 0, and greedy decoding is what we want for the strict
    // translation / FactLock calls anyway.
    temperature: Math.max(0.05, Number(temperature) || 0.05),
  };
  if (WATSONX_PROJECT_ID) body.project_id = WATSONX_PROJECT_ID;
  if (WATSONX_SPACE_ID) body.space_id = WATSONX_SPACE_ID;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.errors?.[0]?.message || data?.message || `watsonx request failed with ${response.status}`;
    throw new Error(detail);
  }
  const text = String(
    data?.choices?.[0]?.message?.content
    || data?.results?.[0]?.generated_text
    || ''
  ).trim();
  if (!text) throw new Error('watsonx returned an empty response');
  return text;
}

// ---------------------------------------------------------------------------
// LangChain -> ChatWatsonx -> IBM Granite.
// This is the same path verify-langchain.js proves, but wired into the real pipeline, so the
// claim "LangChain orchestrates IBM Granite" is true of the running product and not just a demo
// script. @langchain/ibm ships as ESM, so it is loaded with a dynamic import() and cached.
// If LangChain is missing or errors, the provider chain falls through to the direct watsonx call —
// which still reaches Granite, so the app never degrades below IBM.
// ---------------------------------------------------------------------------
let _chatWatsonxCache;
async function loadChatWatsonx() {
  if (_chatWatsonxCache !== undefined) return _chatWatsonxCache;
  try {
    const mod = await import('@langchain/ibm');
    _chatWatsonxCache = mod.ChatWatsonx || (mod.default && mod.default.ChatWatsonx) || null;
    if (_chatWatsonxCache) console.log('LangChain: @langchain/ibm loaded (ChatWatsonx).');
  } catch (error) {
    console.warn('LangChain (@langchain/ibm) unavailable; using the direct watsonx call:', error.message);
    _chatWatsonxCache = null;
  }
  return _chatWatsonxCache;
}

let _langchainModelCache = null;
async function callLangchainWatsonxText({ messages = [], temperature = 0.15, maxTokens = 1000 } = {}) {
  const ChatWatsonx = await loadChatWatsonx();
  if (!ChatWatsonx) throw new Error('@langchain/ibm is not installed');
  if (!watsonxConfigured) throw new Error('watsonx is not configured');

  // maxTokens/temperature change per call, so build per call but reuse the class.
  const model = new ChatWatsonx({
    model: WATSONX_MODEL,
    version: WATSONX_API_VERSION,
    serviceUrl: WATSONX_URL,
    projectId: WATSONX_PROJECT_ID || undefined,
    spaceId: WATSONX_SPACE_ID || undefined,
    watsonxAIApikey: WATSONX_API_KEY,
    watsonxAIAuthType: 'iam',
    maxTokens,
    temperature: Math.max(0.05, Number(temperature) || 0.05),
  });
  _langchainModelCache = model;

  // LangChain's message tuple format: ['system' | 'human' | 'ai', content]
  const lcMessages = messages.map(message => [
    message.role === 'system' ? 'system' : (message.role === 'assistant' ? 'ai' : 'human'),
    String(message.content || ''),
  ]);

  const response = await model.invoke(lcMessages);
  const raw = response && response.content;
  const text = Array.isArray(raw)
    ? raw.map(part => (typeof part === 'string' ? part : (part && part.text) || '')).join('').trim()
    : String(raw || '').trim();

  if (!text) throw new Error('LangChain/watsonx returned an empty response');
  return text;
}

function orderedAiProviders() {
  const providers = [];
  const add = (name) => {
    if (!name || providers.includes(name) || providerDisabled(name)) return;
    if (name === 'langchain' && !watsonxConfigured) return;
    if (name === 'watsonx' && !watsonxConfigured) return;
    if (name === 'groq' && !groq) return;
    if (name === 'openai' && !openai) return;
    if (name === 'gemini' && !GEMINI_API_KEY) return;
    providers.push(name);
  };

  // If a provider is explicitly selected, do NOT spam quota-exhausted fallback providers.
  if (AI_PROVIDER === 'langchain') {
    // LangChain -> Granite first; if LangChain itself breaks, the direct Granite call still runs,
    // so the model stays IBM either way.
    add('langchain');
    add('watsonx');
    if (WATSONX_STRICT !== 'true') { add('groq'); add('openai'); add('gemini'); }
    return providers;
  }
  if (AI_PROVIDER === 'watsonx' || AI_PROVIDER === 'granite') {
    add('watsonx');
    // Keep the demo alive if watsonx is briefly unavailable, but only as a backup.
    if (WATSONX_STRICT !== 'true') { add('groq'); add('openai'); add('gemini'); }
    return providers;
  }
  if (AI_PROVIDER === 'groq') { add('groq'); return providers; }
  if (AI_PROVIDER === 'openai') { add('openai'); return providers; }
  if (AI_PROVIDER === 'gemini') { add('gemini'); return providers; }

  // Auto mode: IBM Granite on watsonx.ai is the primary model for this project.
  add('langchain');
  add('watsonx');
  add('groq');
  add('openai');
  add('gemini');
  return providers;
}

async function callOpenAIText({ messages = [], temperature = 0.15, maxTokens = 1000 } = {}) {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature,
    messages,
    max_tokens: maxTokens,
  });
  return String(response.choices?.[0]?.message?.content || '').trim();
}

async function callGeminiText({ messages = [], temperature = 0.15, maxTokens = 1000 } = {}) {
  const systemText = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const userText = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n\n');
  const prompt = `${systemText}\n\n${userText}`.trim();
  const modelCandidates = [...new Set([
    GEMINI_MODEL,
    'gemini-1.5-flash',
  ].filter(Boolean))];
  let lastError = null;
  for (const model of modelCandidates) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || `Gemini ${model} failed with ${response.status}`);
      const text = String(data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '').trim();
      if (text) return text;
      throw new Error(`Gemini ${model} returned empty text`);
    } catch (error) {
      lastError = error;
      if (quotaLikeError(error)) break;
    }
  }
  throw lastError || new Error('Gemini request failed');
}

async function callGroqText({ messages = [], temperature = 0.15, maxTokens = 1000 } = {}) {
  const noThinkSystem = {
    role: 'system',
    content: 'Do not reveal reasoning. Do not output <think> tags. Do not explain. Do not write analysis. Return only the final requested portfolio text or valid JSON. /no_think'
  };
  const safeMessages = [noThinkSystem, ...messages];
  const request = {
    model: GROQ_MODEL,
    temperature,
    messages: safeMessages,
    max_tokens: maxTokens,
  };
  if (/qwen/i.test(GROQ_MODEL)) request.reasoning_format = 'hidden';
  const response = await groq.chat.completions.create(request);
  return String(response.choices?.[0]?.message?.content || '').trim();
}

async function generateAiText({ messages = [], temperature = 0.15, maxTokens = 1000 } = {}) {
  const providers = orderedAiProviders();
  let lastError = null;
  const isTransient = (err) =>
    /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network|fetch failed|timeout/i
      .test(String((err && err.message) || err || ''));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const callProvider = (provider) => {
    if (provider === 'langchain') return callLangchainWatsonxText({ messages, temperature, maxTokens });
    if (provider === 'watsonx') return callWatsonxText({ messages, temperature, maxTokens });
    if (provider === 'gemini') return callGeminiText({ messages, temperature, maxTokens });
    if (provider === 'openai') return callOpenAIText({ messages, temperature, maxTokens });
    if (provider === 'groq') return callGroqText({ messages, temperature, maxTokens });
    return Promise.reject(new Error('unknown provider ' + provider));
  };

  for (const provider of providers) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await callProvider(provider);
      } catch (error) {
        lastError = error;
        if (isTransient(error) && attempt < 3) {
          console.warn(`${provider} transient error (attempt ${attempt}/3): ${error.message} — retrying`);
          await sleep(400 * attempt);
          continue;
        }
        if (!isTransient(error)) markProviderDisabled(provider, error);
        console.warn(`${provider} AI request failed; trying fallback provider if available:`, error.message);
        break;
      }
    }
  }
  throw lastError || new Error('No AI provider configured');
}

function translationLooksFabricated(source = '', candidate = '') {
  const src = cleanText(source);
  const out = cleanText(candidate);
  if (!src || !out) return false;
  if (/\{\s*"|"\s*:\s*"|\[JSON\]|\[Instructor|\[Your |\]\s*\[/i.test(out)) return true;
  if (out.length > src.length * 2.5 + 80) return true;
  return false;
}

// Skills were never translated at all — there was no pass for them. One AI call per skill would
// mean 40+ calls on a real CV, so the whole list goes in a single JSON round-trip. Technology
// names (Java, Docker, MERN Stack, AWS) must survive untouched; only generic phrases like
// "Database Systems" or "Team Collaboration" are translated. Any parse failure, length mismatch,
// wrong script or suspected fabrication falls back to the original skill, per item.
async function translateSkillListStrict(skills = [], targetLanguage = 'English') {
  const list = (Array.isArray(skills) ? skills : []).map(cleanText).filter(Boolean);
  if (!list.length || languageFamily(targetLanguage) === 'english') return list;
  try {
    const raw = await generateAiText({
      temperature: 0.0,
      maxTokens: 1200,
      messages: [
        { role: 'system', content: `You translate skill labels into ${targetLanguage}. ${languageStrictInstruction(targetLanguage)} RULES: (1) Translate generic skill phrases, for example "Database Systems", "Team Collaboration", "Version Control", "Frontend Development". (2) NEVER translate the name of a programming language, library, framework, product or company — for example Java, Python, C++, React, Node.js, Docker, Kubernetes, AWS, Git, GitHub, MongoDB, Grafana, MERN Stack. Return those exactly as given. (3) Return ONLY a JSON array of strings with the SAME length and SAME order as the input. No prose, no markdown, no code fences.` },
        { role: 'user', content: JSON.stringify(list) },
      ],
    });
    const text = cleanText(raw).replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length === list.length) {
      return list.map((original, index) => {
        const candidate = cleanText(parsed[index]);
        if (!candidate) return original;
        if (hasUnexpectedScriptForLanguage(candidate, targetLanguage)) return original;
        if (translationLooksFabricated(original, candidate)) return original;
        return candidate;
      });
    }
  } catch (error) {
    console.warn('Skill translation failed; original skills kept:', error.message);
  }
  return list;
}

// Weaker models append their own JSON scaffolding after the prose ({"statement":"..."}) and
// repeat the whole answer verbatim a second time. Both are visible in the finished portfolio and
// neither is caught by the script or language checks, because the leaked text is perfectly good
// Spanish. Cut at the JSON, and cut at the point where the opening sentence starts over.
function stripLeakedJsonAndEcho(value = '') {
  let text = cleanText(value);
  if (!text) return text;
  const jsonAt = text.search(/\{\s*"[a-z_]+"\s*:/i);
  if (jsonAt > 40) text = cleanText(text.slice(0, jsonAt));
  text = text.replace(/^\{\s*"[a-z_]+"\s*:\s*"/i, '').replace(/"\s*\}\s*$/, '');
  const half = Math.floor(text.length / 2);
  const firstChunk = text.slice(0, Math.min(120, half));
  if (firstChunk.length > 60) {
    const repeatAt = text.indexOf(firstChunk, Math.max(60, half - 40));
    if (repeatAt > 60) text = cleanText(text.slice(0, repeatAt));
  }
  return text;
}

async function translateTextStrict(text = '', targetLanguage = 'English') {
  const clean = cleanText(text);
  const lang = cleanText(targetLanguage) || 'English';
  const family = languageFamily(lang);
  const sourceLooksNonEnglish = containsArabicScript(clean) || containsDevanagari(clean) || containsCJK(clean) || containsBengali(clean) || containsTamil(clean) || containsTelugu(clean) || containsThai(clean) || hasCyrillic(clean) || looksRomanUrdu(clean);
  if (!clean) return clean;
  if (family === 'english' && !sourceLooksNonEnglish) return clean;
  // Already written natively in the target language (verifiable for non-Latin scripts) — sending it
  // back to the model to be "translated" would only give it a chance to corrupt it.
  if (requiresNonLatinScript(lang) && hasRequiredScript(clean, lang) && !hasUnexpectedScriptForLanguage(clean, lang)) return clean;
  if (!aiAvailable()) return strictLocalizeFallback(clean, lang, 'description');
  try {
    const aiText = await generateAiText({
      temperature: 0.02,
      maxTokens: 650,
      messages: [
        { role: 'system', content: `You are a strict translator. ${languageStrictInstruction(lang)} Translate the user text into ${lang}. Preserve meaning exactly. Return only the translated text with no explanations, quotes, markdown, or labels.` },
        { role: 'user', content: clean },
      ],
    });
    const translated = cleanText(aiText).replace(/^\"|\"$/g, '');
    if (translated && !hasUnexpectedScriptForLanguage(translated, lang) && !looksLikeWrongEnglishForTarget(translated, lang) && !translationLooksFabricated(clean, translated)) return translated;
    const retryText = await generateAiText({
      temperature: 0.0,
      maxTokens: 650,
      messages: [
        { role: 'system', content: `You are a strict translator. ${languageStrictInstruction(lang)} Your previous answer was NOT written in ${lang}. Translate the user text into ${lang} ONLY — every word of prose. Return only the translated text with no explanations, quotes, markdown, or labels.` },
        { role: 'user', content: clean },
      ],
    });
    const retried = cleanText(retryText).replace(/^\"|\"$/g, '');
    if (retried && !hasUnexpectedScriptForLanguage(retried, lang) && !looksLikeWrongEnglishForTarget(retried, lang) && !translationLooksFabricated(clean, retried)) return retried;
  } catch (error) {
    console.warn('Strict translation failed; local fallback used:', error.message);
  }
  return strictLocalizeFallback(clean, lang, 'description') || clean;
}

function toneInstruction(tone = 'Professional') {
  const key = cleanText(tone).toLowerCase();
  if (key === 'creative') return 'Tone: Creative, warm, expressive, portfolio-ready, but still factual.';
  if (key === 'minimal') return 'Tone: Minimal, concise, clean, simple, and direct.';
  if (key === 'bold') return 'Tone: Bold, confident, energetic, and memorable without exaggerating facts.';
  return 'Tone: Professional, polished, clear, credible, and recruiter/judge friendly.';
}

function languageStrictInstruction(targetLanguage = 'English') {
  const lang = cleanText(targetLanguage) || 'English';
  const family = languageFamily(lang);

  // Per-language script + grammar rules
  const scriptRules = {
    arabic:    'Write ONLY in ARABIC, never Urdu or Persian. Use the Arabic letters ي ك ة and never the Urdu-only letters ٹ ڈ ڑ ے ں ھ. Write in Arabic script (right-to-left). Use Modern Standard Arabic (فصحى). Every word of prose, every heading, every label must be in Arabic script. Never mix in English words except proper names, brand names, emails, URLs, and technology tool names (React, Python, etc.).',
    urdu:      'Write ONLY in URDU, never Arabic. Urdu and Arabic share a script but are different languages: use the Urdu letters ی ک ہ ے ں ھ ٹ ڈ ڑ گ پ چ, not the Arabic forms ي ك ة. Write in Urdu Nastaliq script (right-to-left). Use clear, modern Pakistani Urdu. Every word of prose must be in Urdu script. Never mix in English words except proper names, brand names, emails, URLs, and technology tool names.',
    persian:   'Write ONLY in Farsi/Persian script (right-to-left, Nastaliq style). Use standard Iranian Persian. Every word of prose must be in Persian script. Never mix in English except proper names, brands, emails, URLs, tool names.',
    pashto:    'Write ONLY in Pashto script (right-to-left, Nastaliq style). Use standard Pashto. Every word of prose must be in Pashto script. Never mix in English except proper names, brands, emails, URLs, tool names.',
    sindhi:    'Write ONLY in Sindhi script (right-to-left, Nastaliq style). Every word of prose must be in Sindhi script. Never mix in English except proper names, brands, emails, URLs, tool names.',
    hindi:     'Write ONLY in Hindi Devanagari script. Use standard Hindi vocabulary. Every word of prose must be in Devanagari. Never mix in English words except proper names, brand names, emails, URLs, and technology tool names.',
    bengali:   'Write ONLY in Bengali script (বাংলা). Use standard Bengali. Every word of prose must be in Bengali script. Never mix in English except proper names, brands, emails, URLs, tool names.',
    punjabi:   'Write ONLY in Punjabi Gurmukhi script (ਪੰਜਾਬੀ). Use standard Punjabi. Every word must be in Gurmukhi script. Never mix in English except proper names, brands, emails, URLs, tool names.',
    tamil:     'Write ONLY in Tamil script (தமிழ்). Use standard Tamil. Every word of prose must be in Tamil script. Never mix in English except proper names, brands, emails, URLs, tool names.',
    telugu:    'Write ONLY in Telugu script (తెలుగు). Use standard Telugu. Every word of prose must be in Telugu script. Never mix in English except proper names, brands, emails, URLs, tool names.',
    chinese:   'Write ONLY in Simplified Chinese (简体中文). Use natural, modern Mandarin. Every word of prose must be in Chinese characters. Never mix in English except proper names, brands, emails, URLs, and technology tool names.',
    japanese:  'Write ONLY in Japanese (日本語). Use a natural mix of Kanji, Hiragana, and Katakana appropriate to the context. Every word of prose must be in Japanese. Never mix in English except proper names, brands, emails, URLs, and technology tool names (which may be written in Katakana).',
    korean:    'Write ONLY in Korean Hangul (한국어). Use standard modern Korean. Every word of prose must be in Hangul. Never mix in English except proper names, brands, emails, URLs, and technology tool names.',
    russian:   'Write ONLY in Russian Cyrillic script. Use standard modern Russian. Every word of prose must be in Cyrillic. Never use Latin letters except for proper names, brands, emails, URLs, and technology tool names.',
    thai:      'Write ONLY in Thai script (ภาษาไทย). Use standard Thai. Every word of prose must be in Thai script. Never mix in English except proper names, brands, emails, URLs, tool names.',
    'roman urdu': 'Write ONLY in Roman Urdu — that means Urdu words written with English/Latin letters (e.g. "Mera naam Ahsan hai"). Do NOT use Urdu script (نستعلیق). Do NOT write in English. Write Urdu words phonetically in Latin characters. Example correct output: "Main ek software developer hoon jo web apps banata hai." Never mix Urdu script characters with Roman letters.',
    greek:     'Write ONLY in Greek script (Ελληνικά). Use standard modern Greek. Every word of prose must be in Greek. Never mix in English except proper names, brands, emails, URLs, tool names.',
    polish:    'Write ONLY in Polish using the Latin alphabet with proper Polish diacritics (ą ć ę ł ń ó ś ź ż). Use correct Polish grammar and natural phrasing. Never mix in other languages except proper names, brands, emails, URLs, tool names.',
    french:    'Write ONLY in French. Use proper French grammar, accents (é è ê ë à â ù û ô î ï œ ç), and natural French phrasing. Never mix in English except proper names, brands, emails, URLs, tool names.',
    spanish:   'Write ONLY in Spanish. Use proper Spanish grammar with correct accents (á é í ó ú ñ ¿ ¡) and natural phrasing. Never mix in English except proper names, brands, emails, URLs, tool names.',
    german:    'Write ONLY in German. Use correct German grammar, capitalise all nouns, use proper German characters (ä ö ü ß). Natural German phrasing. Never mix in English except proper names, brands, emails, URLs, tool names.',
    italian:   'Write ONLY in Italian. Use correct Italian grammar, proper accents, and natural Italian phrasing. Never mix in English except proper names, brands, emails, URLs, tool names.',
    portuguese:'Write ONLY in Portuguese (use European Portuguese unless context suggests Brazilian). Use proper accents (ã ê ç á é í ó ú â ô). Never mix in English except proper names, brands, emails, URLs, tool names.',
    dutch:     'Write ONLY in Dutch. Use correct Dutch grammar and natural phrasing. Never mix in English except proper names, brands, emails, URLs, tool names.',
    turkish:   'Write ONLY in Turkish. Use correct Turkish grammar with proper characters (ı İ ğ ş ç ö ü). Natural Turkish phrasing. Never mix in English except proper names, brands, emails, URLs, tool names.',
    malay:     'Write ONLY in Malay (Bahasa Malaysia). Use correct Malay grammar and natural phrasing. Never mix in English except proper names, brands, emails, URLs, tool names.',
    indonesian:'Write ONLY in Indonesian (Bahasa Indonesia). Use correct Indonesian grammar and natural phrasing. Never mix in English except proper names, brands, emails, URLs, tool names.',
    vietnamese:'Write ONLY in Vietnamese. Use correct Vietnamese with all diacritics and tone marks (à á ả ã ạ ă ắ ặ â ấ ầ đ ê ế ề ơ ớ ờ ư ứ ừ). Natural Vietnamese phrasing. Never mix in English except proper names, brands, emails, URLs, tool names.',
    filipino:  'Write ONLY in Filipino (Tagalog-based). Use correct Filipino grammar and natural phrasing. Never mix in English except proper names, brands, emails, URLs, tool names.',
    swahili:   'Write ONLY in Swahili (Kiswahili). Use correct Swahili grammar and natural phrasing. Never mix in English except proper names, brands, emails, URLs, tool names.',
  };

  const rule = scriptRules[family] || `Write ONLY in ${lang}. Translate every visible word. Do not mix in English except proper names, brands, emails, URLs, and technology tool names.`;

  return `TASK: Generate all portfolio content in ${lang} ONLY.

SCRIPT & GRAMMAR RULE: ${rule}

UNIVERSAL RULES (apply to every language):
- Translate EVERY visible label, heading, section name, bio, statement, project title, and project description into ${lang}.
- NEVER leave user-visible text in the source language (usually English) unless it falls under the exceptions below.
- PRESERVE UNCHANGED (do not translate): person names, company/brand names, email addresses, phone numbers, URLs, GitHub/LinkedIn usernames, technology/tool names (React, Node.js, Python, GitHub, Vercel, MongoDB, etc.), programming language names.
- NEVER invent new facts, achievements, metrics, dates, awards, or details not supplied by the user.
- Return valid JSON when JSON output is requested.`;
}

function fallbackProjectSuggestions({ medium = '', description = '', targetLanguage = 'English' } = {}) {
  const mediumKey = cleanText(medium).toLowerCase();
  let base;
  if (/(music|musician|singer|song|audio|performance)/.test(mediumKey)) {
    base = [
      { title: 'Signature Performance Piece', desc: 'Show one strong music or performance piece, explain its style, and describe what made it meaningful to you.' },
      { title: 'Behind-the-Song Process', desc: 'Document how you developed one song or performance from idea to final rehearsal or recording.' },
      { title: 'Live Collaboration Highlight', desc: 'Present a project where you worked with other performers, producers, or audiences and explain your contribution.' },
    ];
  } else if (/(artist|painting|illustration|design|visual)/.test(mediumKey)) {
    base = [
      { title: 'Artwork Showcase Piece', desc: 'Present one finished artwork with its concept, style, medium, and final result.' },
      { title: 'Process Case Study', desc: 'Show the journey of one visual project from inspiration and sketches to the completed piece.' },
      { title: 'Series or Collection Highlight', desc: 'Build an entry around a small series of related works and explain the theme connecting them.' },
    ];
  } else if (/(developer|software|web|full stack|programming|coding)/.test(mediumKey)) {
    base = [
      { title: 'Flagship Build', desc: 'Show one strong project, what problem it solved, your role, and the final outcome.' },
      { title: 'Build Journey Case Study', desc: 'Explain how one project moved from idea to implementation, including your decisions and lessons learned.' },
      { title: 'Collaboration or Client Project', desc: 'Describe a project where you worked with others, handled feedback, or improved a real user experience.' },
    ];
  } else {
    base = [
      { title: 'Personal Showcase Project', desc: `Create a focused portfolio piece that presents your ${cleanText(medium) || 'creative'} style, process, and final outcome.` },
      { title: 'Behind-the-Scenes Case Study', desc: 'Document one project from idea to final result, including your role, choices, and what you learned.' },
      { title: 'Collaboration Highlight', desc: 'Build a project entry that shows how you worked with others or responded to audience or client feedback.' },
    ];
  }
  return base.map(item => ({
    title: localizeBasicTextFallback(item.title, targetLanguage),
    desc: localizeBasicTextFallback(item.desc, targetLanguage),
  }));
}

const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const googleAuthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function createMailTransporter() {
  if (String(process.env.MAIL_TRANSPORT || '').toLowerCase() === 'json') {
    return nodemailer.createTransport({ jsonTransport: true });
  }

  const service = String(process.env.SMTP_SERVICE || '').trim();
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();

  if (!user || !pass || (!service && !host)) return null;

  if (service) {
    const normalizedService = service.toLowerCase();
    const gmailLike = normalizedService === 'gmail' || user.toLowerCase().includes('@gmail.com');

    if (gmailLike) {
      return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        family: 4,
        auth: { user, pass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });
    }

    return nodemailer.createTransport({
      service,
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    family: 4,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    tls: {
      servername: host,
    },
  });
}

function parseEmailAddress(value = '') {
  const text = String(value || '').trim();
  const match = text.match(/^(.*?)<([^>]+)>$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^["']|["']$/g, '') || 'MuseForge',
      email: match[2].trim(),
    };
  }
  return {
    name: 'MuseForge',
    email: text || 'museforgeteam@gmail.com',
  };
}

async function sendWithBrevoApi({ from, to, subject, text, html }) {
  const apiKey = String(process.env.BREVO_API_KEY || '').trim();
  if (!apiKey) throw new Error('BREVO_API_KEY is not configured.');

  const sender = parseEmailAddress(from || process.env.MAIL_FROM || 'MuseForge <museforgeteam@gmail.com>');
  const recipients = Array.isArray(to)
    ? to
    : String(to || '').split(',').map(email => email.trim()).filter(Boolean);

  if (!recipients.length) throw new Error('Email recipient is missing.');

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender,
      to: recipients.map(email => ({ email })),
      subject: subject || 'MuseForge',
      htmlContent: html || `<pre>${escapeHtml(text || '')}</pre>`,
      textContent: text || '',
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Brevo API failed with status ${response.status}`);
  }

  return { messageId: data.messageId || null };
}

const mailTransporter = String(process.env.BREVO_API_KEY || '').trim()
  ? { sendMail: sendWithBrevoApi }
  : createMailTransporter();

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function sendWelcomeEmail(user) {
  if (!mailTransporter) {
    return { sent: false, reason: 'Email service is not configured.' };
  }

  const from = String(process.env.MAIL_FROM || process.env.SMTP_USER || 'MuseForge <no-reply@museforge.local>').trim();
  const safeName = escapeHtml(user.name || 'Creator');
  const subject = 'Your MuseForge account is ready';
  const text = `Hi ${user.name || 'Creator'},\n\nYour MuseForge account has been created successfully. You can now log in and start building your portfolio.\n\nWelcome to MuseForge — where creators meet AI.`;
  const html = `<!doctype html>
  <html lang="en">
    <body style="margin:0;background:#f7f1ff;font-family:Arial,sans-serif;color:#2d2340">
      <div style="max-width:620px;margin:0 auto;padding:36px 18px">
        <div style="background:#ffffff;border:1px solid #eadfff;border-radius:22px;padding:34px;box-shadow:0 18px 45px rgba(90,55,145,.12)">
          <div style="display:inline-block;background:linear-gradient(135deg,#8b5cf6,#6d36dc);color:#fff;border-radius:12px;padding:10px 14px;font:700 20px Georgia,serif">M</div>
          <h1 style="margin:22px 0 12px;font:700 30px Georgia,serif;color:#2d2145">Welcome to MuseForge</h1>
          <p style="font-size:16px;line-height:1.7;margin:0 0 14px">Hi ${safeName},</p>
          <p style="font-size:16px;line-height:1.7;margin:0 0 14px">Your account has been created successfully. You can now log in and start building a polished portfolio from your real work and ideas.</p>
          <p style="font-size:15px;line-height:1.7;margin:24px 0 0;color:#6e627d">MuseForge — where creators meet AI.</p>
        </div>
      </div>
    </body>
  </html>`;

  try {
    const info = await mailTransporter.sendMail({ from, to: user.email, subject, text, html });
    return { sent: true, messageId: info.messageId || null };
  } catch (error) {
    console.error('Welcome email failed:', error.message);
    return { sent: false, reason: error.message };
  }
}


function createActionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashActionToken(token = '') {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function buildFrontendLink(params = {}) {
  const base = String(process.env.FRONTEND_URL || 'http://localhost:3000').trim().replace(/\/$/, '');
  const url = new URL(base || 'http://localhost:3000');
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url.toString();
}

function createVerificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

async function sendVerificationCodeEmail(user, rawCode) {
  if (!mailTransporter) {
    return { sent: false, reason: 'Email service is not configured.' };
  }

  const from = String(process.env.MAIL_FROM || process.env.SMTP_USER || 'MuseForge <no-reply@museforge.local>').trim();
  const safeName = escapeHtml(user.name || 'Creator');
  const safeCode = escapeHtml(rawCode);
  const subject = 'Your MuseForge verification code';
  const text = `Hi ${user.name || 'Creator'},\n\nYour MuseForge verification code is: ${rawCode}\n\nEnter this code in the MuseForge app to activate your account. This code expires in 10 minutes.\n\nIf you did not create this account, you can ignore this email.`;
  const html = `<!doctype html>
  <html lang="en">
    <body style="margin:0;background:#f7f1ff;font-family:Arial,sans-serif;color:#2d2340">
      <div style="max-width:620px;margin:0 auto;padding:36px 18px">
        <div style="background:#ffffff;border:1px solid #eadcff;border-radius:24px;padding:32px;box-shadow:0 18px 45px rgba(124,58,237,0.12)">
          <div style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#7c3aed;font-weight:800;margin-bottom:12px">MuseForge verification</div>
          <h1 style="margin:0 0 14px;font-family:Georgia,serif;font-size:30px;color:#20143d">Verify your email</h1>
          <p style="font-size:16px;line-height:1.6;margin:0 0 18px">Hi ${safeName}, enter this code in MuseForge to activate your account.</p>
          <div style="margin:24px 0;padding:20px;border-radius:18px;background:#f3e8ff;text-align:center;border:1px solid #ddd0ff">
            <div style="font-size:34px;letter-spacing:0.22em;font-weight:900;color:#6d28d9">${safeCode}</div>
          </div>
          <p style="font-size:14px;line-height:1.6;color:#6b627a;margin:0">This code expires in 10 minutes. If you did not create this account, you can ignore this email.</p>
        </div>
      </div>
    </body>
  </html>`;

  try {
    const info = await mailTransporter.sendMail({ from, to: user.email, subject, text, html });
    return { sent: true, messageId: info?.messageId || null };
  } catch (error) {
    return { sent: false, reason: error.message };
  }
}
async function sendVerificationEmail(user, rawToken) {
  if (!mailTransporter) return { sent: false, reason: 'Email service is not configured.' };

  const from = String(process.env.MAIL_FROM || process.env.SMTP_USER || 'MuseForge <no-reply@museforge.local>').trim();
  const safeName = escapeHtml(user.name || 'Creator');
  const verificationUrl = buildFrontendLink({ verifyToken: rawToken });
  const subject = 'Verify your MuseForge email';
  const text = `Hi ${user.name || 'Creator'},\n\nYour MuseForge account was created. Verify your email by opening this link:\n${verificationUrl}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.`;
  const html = `<!doctype html>
  <html lang="en">
    <body style="margin:0;background:#f7f1ff;font-family:Arial,sans-serif;color:#2d2340">
      <div style="max-width:620px;margin:0 auto;padding:36px 18px">
        <div style="background:#ffffff;border:1px solid #eadfff;border-radius:22px;padding:34px;box-shadow:0 18px 45px rgba(90,55,145,.12)">
          <div style="display:inline-block;background:linear-gradient(135deg,#8b5cf6,#6d36dc);color:#fff;border-radius:12px;padding:10px 14px;font:700 20px Georgia,serif">M</div>
          <h1 style="margin:22px 0 12px;font:700 30px Georgia,serif;color:#2d2145">Verify your email</h1>
          <p style="font-size:16px;line-height:1.7;margin:0 0 14px">Hi ${safeName},</p>
          <p style="font-size:16px;line-height:1.7;margin:0 0 22px">Your MuseForge account has been created. Confirm that this email belongs to you before signing in.</p>
          <a href="${escapeHtml(verificationUrl)}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:linear-gradient(135deg,#8b5cf6,#6d36dc);color:#fff;text-decoration:none;font-weight:700">Verify my email</a>
          <p style="font-size:13px;line-height:1.7;margin:22px 0 0;color:#746a80">This link expires in 24 hours. If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(verificationUrl)}</span></p>
        </div>
      </div>
    </body>
  </html>`;

  try {
    const info = await mailTransporter.sendMail({ from, to: user.email, subject, text, html });
    return { sent: true, messageId: info.messageId || null };
  } catch (error) {
    console.error('Verification email failed:', error.message);
    return { sent: false, reason: error.message };
  }
}

async function sendPasswordResetEmail(user, rawToken) {
  if (!mailTransporter) return { sent: false, reason: 'Email service is not configured.' };

  const from = String(process.env.MAIL_FROM || process.env.SMTP_USER || 'MuseForge <no-reply@museforge.local>').trim();
  const safeName = escapeHtml(user.name || 'Creator');
  const resetUrl = buildFrontendLink({ resetToken: rawToken });
  const subject = 'Reset your MuseForge password';
  const text = `Hi ${user.name || 'Creator'},\n\nUse this link to choose a new MuseForge password:\n${resetUrl}\n\nThis link expires in 60 minutes. If you did not request a password reset, ignore this email.`;
  const html = `<!doctype html>
  <html lang="en">
    <body style="margin:0;background:#f7f1ff;font-family:Arial,sans-serif;color:#2d2340">
      <div style="max-width:620px;margin:0 auto;padding:36px 18px">
        <div style="background:#ffffff;border:1px solid #eadfff;border-radius:22px;padding:34px;box-shadow:0 18px 45px rgba(90,55,145,.12)">
          <div style="display:inline-block;background:linear-gradient(135deg,#8b5cf6,#6d36dc);color:#fff;border-radius:12px;padding:10px 14px;font:700 20px Georgia,serif">M</div>
          <h1 style="margin:22px 0 12px;font:700 30px Georgia,serif;color:#2d2145">Reset your password</h1>
          <p style="font-size:16px;line-height:1.7;margin:0 0 14px">Hi ${safeName},</p>
          <p style="font-size:16px;line-height:1.7;margin:0 0 22px">Someone requested a new password for your MuseForge account. Use the button below to continue.</p>
          <a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:linear-gradient(135deg,#8b5cf6,#6d36dc);color:#fff;text-decoration:none;font-weight:700">Choose a new password</a>
          <p style="font-size:13px;line-height:1.7;margin:22px 0 0;color:#746a80">This link expires in 60 minutes. If you did not request this change, ignore this email.<br><span style="word-break:break-all">${escapeHtml(resetUrl)}</span></p>
        </div>
      </div>
    </body>
  </html>`;

  try {
    const info = await mailTransporter.sendMail({ from, to: user.email, subject, text, html });
    return { sent: true, messageId: info.messageId || null };
  } catch (error) {
    console.error('Password reset email failed:', error.message);
    return { sent: false, reason: error.message };
  }
}

async function sendPasswordChangedEmail(user) {
  if (!mailTransporter) return { sent: false, reason: 'Email service is not configured.' };
  const from = String(process.env.MAIL_FROM || process.env.SMTP_USER || 'MuseForge <no-reply@museforge.local>').trim();
  try {
    const info = await mailTransporter.sendMail({
      from,
      to: user.email,
      subject: 'Your MuseForge password was changed',
      text: `Hi ${user.name || 'Creator'},\n\nYour MuseForge password was changed successfully. If you did not make this change, reset your password immediately.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px;color:#2d2340"><h1 style="font-family:Georgia,serif">Password changed</h1><p>Hi ${escapeHtml(user.name || 'Creator')},</p><p>Your MuseForge password was changed successfully.</p><p style="color:#746a80">If you did not make this change, use Forgot password on the login page immediately.</p></div>`,
    });
    return { sent: true, messageId: info.messageId || null };
  } catch (error) {
    console.error('Password changed email failed:', error.message);
    return { sent: false, reason: error.message };
  }
}


const LEGACY_USERS_FILE = path.join(__dirname, 'data', 'users.json');
const USER_DATA_DIR = process.env.MUSEFORGE_DATA_DIR
  ? path.resolve(process.env.MUSEFORGE_DATA_DIR)
  : path.join(os.homedir(), '.museforge');
const USERS_FILE = path.join(USER_DATA_DIR, 'users.json');
const PUBLIC_PORTFOLIOS_FILE = path.join(USER_DATA_DIR, 'public-portfolios.json');
const REVIEWS_FILE = path.join(USER_DATA_DIR, 'reviews.json');
const USER_HISTORY_FILE = path.join(USER_DATA_DIR, 'user-history.json');
const AUTH_SECRET = process.env.AUTH_SECRET || 'museforge-local-development-secret-change-me';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_PORTFOLIOS_TABLE = String(process.env.SUPABASE_PORTFOLIOS_TABLE || 'public_portfolios').trim();
const SUPABASE_REVIEWS_TABLE = String(process.env.SUPABASE_REVIEWS_TABLE || 'public_reviews').trim();
const isPlaceholderSupabaseValue = (value = '') => /your-project-ref|your_supabase|keep_private|example|placeholder/i.test(String(value));
const publicPortfolioDatabaseEnabled = Boolean(
  SUPABASE_URL &&
  SUPABASE_SERVICE_ROLE_KEY &&
  !isPlaceholderSupabaseValue(SUPABASE_URL) &&
  !isPlaceholderSupabaseValue(SUPABASE_SERVICE_ROLE_KEY)
);

function ensureUserStore() {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    let initialUsers = [];
    try {
      if (fs.existsSync(LEGACY_USERS_FILE)) {
        const legacy = JSON.parse(fs.readFileSync(LEGACY_USERS_FILE, 'utf8'));
        if (Array.isArray(legacy)) initialUsers = legacy;
      }
    } catch (error) {
      console.warn('Could not migrate the old user store:', error.message);
    }
    fs.writeFileSync(USERS_FILE, `${JSON.stringify(initialUsers, null, 2)}
`, 'utf8');
  }
  if (!fs.existsSync(PUBLIC_PORTFOLIOS_FILE)) {
    fs.writeFileSync(PUBLIC_PORTFOLIOS_FILE, `${JSON.stringify([], null, 2)}
`, 'utf8');
  }
  if (!fs.existsSync(REVIEWS_FILE)) {
    fs.writeFileSync(REVIEWS_FILE, `${JSON.stringify([], null, 2)}
`, 'utf8');
  }
  if (!fs.existsSync(USER_HISTORY_FILE)) {
    fs.writeFileSync(USER_HISTORY_FILE, `${JSON.stringify({}, null, 2)}
`, 'utf8');
  }
}

function readUsers() {
  ensureUserStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Could not read user store:', error.message);
    return [];
  }
}

function writeUsers(users) {
  ensureUserStore();
  const temporaryFile = `${USERS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(users, null, 2)}
`, 'utf8');
  fs.renameSync(temporaryFile, USERS_FILE);
}

function readPublicPortfolios() {
  ensureUserStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(PUBLIC_PORTFOLIOS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Could not read public portfolio store:', error.message);
    return [];
  }
}

function writePublicPortfolios(items) {
  ensureUserStore();
  const temporaryFile = `${PUBLIC_PORTFOLIOS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(items, null, 2)}
`, 'utf8');
  fs.renameSync(temporaryFile, PUBLIC_PORTFOLIOS_FILE);
}


function readReviews() {
  ensureUserStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Could not read reviews store:', error.message);
    return [];
  }
}

function writeReviews(items) {
  ensureUserStore();
  const temporaryFile = `${REVIEWS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(items, null, 2)}
`, 'utf8');
  fs.renameSync(temporaryFile, REVIEWS_FILE);
}


function readUserHistoryStore() {
  ensureUserStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(USER_HISTORY_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error('Could not read user history store:', error.message);
    return {};
  }
}

function writeUserHistoryStore(store) {
  ensureUserStore();
  const temporaryFile = `${USER_HISTORY_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(store || {}, null, 2)}
`, 'utf8');
  fs.renameSync(temporaryFile, USER_HISTORY_FILE);
}

function normalizeUserHistoryPayload(input = {}) {
  const history = input && typeof input === 'object' ? input : {};
  return {
    creatorDrafts: history.creatorDrafts && typeof history.creatorDrafts === 'object' && !Array.isArray(history.creatorDrafts) ? history.creatorDrafts : {},
    portfolioVersions: Array.isArray(history.portfolioVersions) ? history.portfolioVersions.slice(0, 3) : [],
    factLockReviews: Array.isArray(history.factLockReviews) ? history.factLockReviews.slice(0, 100) : [],
    localizedOutput: history.localizedOutput && typeof history.localizedOutput === 'object' ? history.localizedOutput : null,
    shareUrl: cleanText(history.shareUrl || ''),
    updatedAt: new Date().toISOString(),
  };
}

function readUserHistoryForEmail(email = '') {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return normalizeUserHistoryPayload({});
  const store = readUserHistoryStore();
  return normalizeUserHistoryPayload(store[normalizedEmail] || {});
}

function saveUserHistoryForEmail(email = '', history = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    const err = new Error('A valid email is required to save history.');
    err.statusCode = 400;
    throw err;
  }
  const store = readUserHistoryStore();
  const previous = store[normalizedEmail] || {};
  const next = normalizeUserHistoryPayload({ ...previous, ...history });
  store[normalizedEmail] = next;
  writeUserHistoryStore(store);
  return next;
}

function normalizeReviewRecord(input = {}) {
  const rating = Math.max(1, Math.min(5, Number.parseInt(input.rating, 10) || 0));
  const review = String(input.review || input.text || '').trim().slice(0, 1000);
  const name = String(input.name || '').trim().slice(0, 100) || 'MuseForge Creator';
  const email = normalizeEmail(input.email || '');
  return {
    id: String(input.id || crypto.randomUUID()),
    name,
    email,
    rating,
    review,
    created_at: input.created_at || input.createdAt || new Date().toISOString(),
  };
}

async function getAllReviews() {
  if (publicPortfolioDatabaseEnabled) {
    try {
      const rows = await supabaseRequest(`${SUPABASE_REVIEWS_TABLE}?select=id,name,email,rating,review,created_at&order=created_at.desc&limit=100`, { method: 'GET' });
      if (Array.isArray(rows)) return rows.map(normalizeReviewRecord);
    } catch (error) {
      console.warn('Supabase reviews read failed; using local JSON fallback:', error.message);
    }
  }
  return readReviews().map(normalizeReviewRecord).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function saveReview(input = {}) {
  const item = normalizeReviewRecord(input);
  if (!item.rating || item.rating < 1 || item.rating > 5) {
    const err = new Error('Please select a rating from 1 to 5 stars.');
    err.statusCode = 400;
    throw err;
  }
  if (!item.review || item.review.length < 5) {
    const err = new Error('Review must be at least 5 characters long.');
    err.statusCode = 400;
    throw err;
  }

  if (publicPortfolioDatabaseEnabled) {
    try {
      const rows = await supabaseRequest(SUPABASE_REVIEWS_TABLE, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          name: item.name,
          email: item.email || null,
          rating: item.rating,
          review: item.review,
          created_at: item.created_at,
        }),
      });
      if (Array.isArray(rows) && rows[0]) return normalizeReviewRecord(rows[0]);
    } catch (error) {
      console.warn('Supabase reviews save failed; using local JSON fallback:', error.message);
    }
  }

  const items = readReviews();
  items.unshift(item);
  writeReviews(items.slice(0, 250));
  return item;
}


async function supabaseRequest(pathname, options = {}) {
  if (!publicPortfolioDatabaseEnabled) return null;
  const url = `${SUPABASE_URL}/rest/v1/${pathname}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Supabase portfolio store failed (${response.status}): ${body || response.statusText}`);
  }

  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

async function savePublicPortfolio(publicPortfolio) {
  if (publicPortfolioDatabaseEnabled) {
    try {
      const rows = await supabaseRequest(SUPABASE_PORTFOLIOS_TABLE, {
        method: 'POST',
        headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify({
          id: publicPortfolio.id,
          portfolio_data: publicPortfolio,
          updated_at: new Date().toISOString(),
        }),
      });
      return Array.isArray(rows) && rows[0]?.portfolio_data ? rows[0].portfolio_data : publicPortfolio;
    } catch (error) {
      console.warn('Supabase portfolio store failed; using local JSON fallback:', error.message);
      publicPortfolio = { ...publicPortfolio, storage: 'local-json-fallback' };
    }
  }

  const items = readPublicPortfolios();
  const withoutDuplicate = items.filter(item => item.id !== publicPortfolio.id);
  withoutDuplicate.unshift(publicPortfolio);
  writePublicPortfolios(withoutDuplicate.slice(0, 200));
  return publicPortfolio;
}

async function findPublicPortfolio(id) {
  const cleanId = cleanText(id);
  if (!cleanId) return null;

  const findLocalPortfolio = () => readPublicPortfolios().find(item => item.id === cleanId) || null;

  if (publicPortfolioDatabaseEnabled) {
    try {
      const encodedId = encodeURIComponent(cleanId);
      const rows = await supabaseRequest(`${SUPABASE_PORTFOLIOS_TABLE}?id=eq.${encodedId}&select=portfolio_data`, {
        method: 'GET',
      });
      const remotePortfolio = Array.isArray(rows) && rows[0]?.portfolio_data ? rows[0].portfolio_data : null;
      if (remotePortfolio) return remotePortfolio;
    } catch (error) {
      console.warn('Supabase portfolio read failed; using local JSON fallback:', error.message);
    }
  }

  return findLocalPortfolio();
}

function createPortfolioSlug(name = '') {
  const base = cleanText(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'portfolio';
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function passwordMatches(password, user) {
  try {
    if (user?.passwordSalt && user?.passwordHash) {
      const actual = crypto.scryptSync(String(password), user.passwordSalt, 64);
      const expected = Buffer.from(String(user.passwordHash), 'hex');
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    }
    // One-time compatibility for a very old local build that may have stored a plain password.
    return typeof user?.password === 'string' && user.password === String(password);
  } catch (error) {
    console.warn('Could not verify a stored password:', error.message);
    return false;
  }
}

function createAuthToken(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.email,
    name: user.name,
    exp: Date.now() + (7 * 24 * 60 * 60 * 1000),
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyAuthToken(token = '') {
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified !== false };
}

function stripAiReasoning(value = '') {
  let text = String(value || '');
  // Qwen-style reasoning blocks must never reach the portfolio UI.
  text = text.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, ' ');
  text = text.replace(/^[\s\S]*?<\/think>/gi, ' ');
  if (/<think[^>]*>/i.test(text)) text = text.replace(/<think[^>]*>[\s\S]*$/i, ' ');
  text = text.replace(/```(?:json)?/gi, ' ').replace(/```/g, ' ');
  text = text.replace(/^okay,?\s+let['’]s[\s\S]*?(final|answer)[:\-]/i, ' ');
  text = text.replace(/^(analysis|reasoning|thoughts?)\s*[:\-][\s\S]*?(final|answer)\s*[:\-]/i, ' ');
  return text;
}

function cleanText(value = '') {
  return stripAiReasoning(value).replace(/\s+/g, ' ').trim();
}

const ACTIVE_OUTPUT_LANGUAGES = new Set([
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Polish',
  'Turkish',
  'Chinese',
  'Japanese',
  'Korean',
  'Russian',
  'Indonesian',
  'Vietnamese'
]);
// Output is restricted to these 15. Input may be written in ANY language: the pipeline detects the
// source script and converts it, so a CV typed in Hindi still produces (for example) a Japanese
// portfolio. Hindi / Roman Urdu dictionaries are still present below and can be re-enabled by
// adding the name to this Set — nothing else needs to change.

function normalizeOutputLanguageName(value = 'English') {
  const clean = String(value || '').trim();
  const aliases = new Map([
    ['simplified chinese', 'Chinese'],
    ['mandarin', 'Chinese'],
    ['bahasa indonesia', 'Indonesian'],
    ['brazilian portuguese', 'Portuguese'],
    ['portuguese brazilian', 'Portuguese'],
  ]);
  const direct = [...ACTIVE_OUTPUT_LANGUAGES].find(item => item.toLowerCase() === clean.toLowerCase());
  return direct || aliases.get(clean.toLowerCase()) || 'English';
}

function normalizeServerOutputLanguage(value = 'English') {
  return normalizeOutputLanguageName(value);
}

function polishDescriptionLocally(value = '', title = '') {
  const text = cleanText(value);
  if (!text) return '';
  const withoutPunctuation = text.replace(/[.!?]+$/, '').trim();
  const loveMatch = withoutPunctuation.match(/^i\s+(?:really\s+)?love\s+(.+)$/i);
  if (loveMatch) return `This project reflects my love for ${loveMatch[1].trim()}.`;
  const inspiredMatch = withoutPunctuation.match(/^inspired\s+by\s+(.+)$/i);
  if (inspiredMatch) return `${cleanText(title) || 'This project'} is inspired by ${inspiredMatch[1].trim()}.`;
  const capitalized = withoutPunctuation.charAt(0).toUpperCase() + withoutPunctuation.slice(1);
  return `${capitalized}.`;
}

function factTokensFromText(value = '') {
  const stop = new Set(['the','and','for','with','that','this','from','into','have','has','had','was','were','are','you','your','their','our','but','not','can','will','about','project','projects','work','works','love','like','using','use','used','create','created','build','built','make','made','my','i','me','a','an','of','to','in','on','by','is','it']);
  return [...new Set(String(value).toLowerCase().match(/[a-z0-9][a-z0-9+#.-]{2,}/g) || [])]
    .filter(token => !stop.has(token))
    .slice(0, 8);
}

function buildFactLockReview(project, enhancedDesc = '') {
  const originalFacts = factTokensFromText(`${project.title} ${project.desc}`);
  const enhancedTokens = factTokensFromText(enhancedDesc);
  const preserved = originalFacts.length ? originalFacts.filter(token => enhancedTokens.includes(token)).slice(0, 6) : [];
  return {
    id: project.id,
    title: project.title,
    originalDesc: project.desc || '',
    desc: enhancedDesc || '',
    factsPreserved: preserved.length ? preserved : [project.title].filter(Boolean),
    unsupportedNewFacts: [],
  };
}

function buildFallbackPortfolio({ name, medium, description, targetLanguage = 'English', creatorType = '', bioHeading: preferredBioHeading = '', statementHeading: preferredStatementHeading = '' }) {
  const displayName = cleanText(name) || 'The creator';
  const displayMedium = cleanText(medium) || 'creative work';
  // Only quote the description when it is safe for this template's language.
  const safeDescription = requiresNonLatinScript(targetLanguage) ? cleanText(description) : quotableOriginal(description);
  const rawDescription = polishDescriptionLocally(safeDescription) || safeDescription || `I am passionate about ${displayMedium}.`;

  const isCareer = /(student|job|career|cv|developer|software|engineer|intern|professional)/i
    .test(`${creatorType} ${medium}`);

  const bioHeading = cleanText(preferredBioHeading) || (isCareer ? 'Bio' : 'Artist Bio');
  const statementHeading = cleanText(preferredStatementHeading) || (isCareer ? 'Professional Statement' : 'Artist Statement');

  if (isCareer) {
    return `## ${bioHeading}
${displayName} is a dedicated ${displayMedium} profile with a clear focus on growth, practical learning, and real-world contribution. ${rawDescription} This portfolio highlights the skills, projects, and experiences the user has provided, presenting them in a polished and professional way. It is written to support internship, job, and academic opportunities without adding unsupported claims.

## ${statementHeading}
My professional direction is shaped by the work, skills, and goals I have shared in this portfolio. I want my portfolio to communicate clarity, credibility, and readiness for meaningful opportunities.

I value practical learning, consistent improvement, and honest presentation of my abilities. Every section is based only on the information I provided, with no fake achievements or unsupported details.`;
  }

  return `## ${bioHeading}
${displayName} is a creative individual working in ${displayMedium}. ${rawDescription} Their portfolio reflects a personal connection with their craft, a desire to keep improving, and a commitment to presenting their work with honesty and care. This bio is based only on the information provided by the creator.

## ${statementHeading}
My creative journey is shaped by my interest in ${displayMedium} and the ideas I have shared through my work. I want my portfolio to reflect my passion, my creative voice, and the direction I am developing as a creator.

I believe creativity should feel personal, expressive, and authentic. Through this portfolio, I present my work clearly while staying faithful to the real facts I provided.`;
}

function parseJsonObject(raw = '') {
  const cleaned = stripAiReasoning(raw).trim().replace(/```json|```/gi, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('AI returned invalid JSON');
  }
}


const OUTPUT_LABELS = {
  English: {
    contact: 'Contact', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Phone', email: 'Email',
    location: 'Location', skills: 'Skills', projects: 'Projects', artistBio: 'Artist Bio',
    artistStatement: 'Artist Statement', technicalSkills: 'Technical Skills', about: 'About',
    statement: 'Statement', factLockTrustReport: 'FactLock Trust Report',
    trustSubtitle: 'Measurable proof that the AI enhancement is reviewable and grounded.',
  },
  French: {
    contact: 'Contact', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Téléphone', email: 'Email',
    location: 'Lieu', skills: 'Compétences', projects: 'Projets', artistBio: "Bio de l'artiste",
    artistStatement: 'Déclaration artistique', technicalSkills: 'Compétences techniques',
    about: 'À propos', statement: 'Déclaration', factLockTrustReport: 'Rapport de confiance FactLock',
    trustSubtitle: "Preuve mesurable que l'amélioration par l'IA reste vérifiable et fondée.",
  },
  Urdu: {
    contact: 'رابطہ', linkedin: 'لنکڈ اِن', github: 'گٹ ہب', phone: 'فون', email: 'ای میل',
    location: 'مقام', skills: 'مہارتیں', projects: 'منصوبے', artistBio: 'تعارف',
    artistStatement: 'تخلیقی بیان', technicalSkills: 'تکنیکی مہارتیں', about: 'تعارف',
    statement: 'بیان', factLockTrustReport: 'فیکٹ لاک ٹرسٹ رپورٹ',
    trustSubtitle: 'یہ رپورٹ دکھاتی ہے کہ AI کی بہتری قابلِ جائزہ اور اصل معلومات پر مبنی ہے۔',
  },
  'Roman Urdu': {
    contact: 'Rabita', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Phone', email: 'Email',
    location: 'Location', skills: 'Skills', projects: 'Projects', artistBio: 'Taaruf',
    artistStatement: 'Creative Statement', technicalSkills: 'Technical Skills', about: 'Taaruf',
    statement: 'Statement', factLockTrustReport: 'FactLock Trust Report',
    trustSubtitle: 'Ye report dikhati hai ke AI enhancement reviewable aur asli facts par based hai.',
  },
  Hindi: {
    contact: 'संपर्क', linkedin: 'LinkedIn', github: 'GitHub', phone: 'फोन', email: 'ईमेल',
    location: 'स्थान', skills: 'कौशल', projects: 'प्रोजेक्ट्स', artistBio: 'परिचय',
    artistStatement: 'रचनात्मक वक्तव्य', technicalSkills: 'तकनीकी कौशल', about: 'परिचय',
    statement: 'वक्तव्य', factLockTrustReport: 'FactLock विश्वास रिपोर्ट',
    trustSubtitle: 'मापने योग्य प्रमाण कि AI सुधार समीक्षा योग्य और तथ्यों पर आधारित है।',
  },
  Spanish: {
    contact: 'Contacto', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Teléfono', email: 'Correo electrónico',
    location: 'Ubicación', skills: 'Habilidades', projects: 'Proyectos', artistBio: 'Biografía',
    artistStatement: 'Declaración artística', technicalSkills: 'Habilidades técnicas', about: 'Acerca de',
    statement: 'Declaración', factLockTrustReport: 'Informe de confianza de FactLock',
    trustSubtitle: 'Prueba medible de que la mejora de IA es revisable y basada en hechos.',
  },
  Arabic: {
    contact: 'التواصل', linkedin: 'لينكدإن', github: 'جيت هب', phone: 'الهاتف', email: 'البريد الإلكتروني',
    location: 'الموقع', skills: 'المهارات', projects: 'المشاريع', artistBio: 'نبذة',
    artistStatement: 'البيان الإبداعي', technicalSkills: 'المهارات التقنية', about: 'نبذة',
    statement: 'بيان', factLockTrustReport: 'تقرير ثقة FactLock',
    trustSubtitle: 'دليل قابل للقياس على أن تحسين الذكاء الاصطناعي قابل للمراجعة ومبني على الحقائق.',
  },
  // The UI language picker offers 15 languages. Any language missing from this table silently
  // rendered its structural labels in English, so every UI option now has a real entry.
  Polish: {
    contact: 'Kontakt', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Telefon', email: 'Email',
    location: 'Lokalizacja', skills: 'Umiejętności', projects: 'Projekty', artistBio: 'Biografia',
    artistStatement: 'Oświadczenie artystyczne', technicalSkills: 'Umiejętności techniczne', about: 'O mnie',
    statement: 'Oświadczenie', factLockTrustReport: 'Raport zaufania FactLock',
    trustSubtitle: 'Mierzalny dowód, że ulepszenie AI jest sprawdzalne i oparte na faktach.',
  },
  German: {
    contact: 'Kontakt', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Telefon', email: 'E-Mail',
    location: 'Ort', skills: 'Fähigkeiten', projects: 'Projekte', artistBio: 'Künstlerbiografie',
    artistStatement: 'Künstlerisches Statement', technicalSkills: 'Technische Fähigkeiten', about: 'Über mich',
    statement: 'Statement', factLockTrustReport: 'FactLock-Vertrauensbericht',
    trustSubtitle: 'Messbarer Nachweis, dass die KI-Verbesserung überprüfbar und faktenbasiert ist.',
  },
  Italian: {
    contact: 'Contatti', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Telefono', email: 'Email',
    location: 'Luogo', skills: 'Competenze', projects: 'Progetti', artistBio: "Biografia dell'artista",
    artistStatement: 'Dichiarazione artistica', technicalSkills: 'Competenze tecniche', about: 'Chi sono',
    statement: 'Dichiarazione', factLockTrustReport: 'Rapporto di fiducia FactLock',
    trustSubtitle: "Prova misurabile che il miglioramento dell'IA è verificabile e fondato sui fatti.",
  },
  Portuguese: {
    contact: 'Contato', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Telefone', email: 'Email',
    location: 'Localização', skills: 'Competências', projects: 'Projetos', artistBio: 'Biografia do artista',
    artistStatement: 'Declaração artística', technicalSkills: 'Competências técnicas', about: 'Sobre',
    statement: 'Declaração', factLockTrustReport: 'Relatório de Confiança FactLock',
    trustSubtitle: 'Prova mensurável de que a melhoria por IA é verificável e baseada em factos.',
  },
  Dutch: {
    contact: 'Contact', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Telefoon', email: 'E-mail',
    location: 'Locatie', skills: 'Vaardigheden', projects: 'Projecten', artistBio: 'Biografie',
    artistStatement: 'Artistieke verklaring', technicalSkills: 'Technische vaardigheden', about: 'Over mij',
    statement: 'Verklaring', factLockTrustReport: 'FactLock-vertrouwensrapport',
    trustSubtitle: 'Meetbaar bewijs dat de AI-verbetering controleerbaar en feitelijk onderbouwd is.',
  },
  Turkish: {
    contact: 'İletişim', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Telefon', email: 'E-posta',
    location: 'Konum', skills: 'Yetenekler', projects: 'Projeler', artistBio: 'Sanatçı Biyografisi',
    artistStatement: 'Sanatçı Beyanı', technicalSkills: 'Teknik Yetenekler', about: 'Hakkımda',
    statement: 'Beyan', factLockTrustReport: 'FactLock Güven Raporu',
    trustSubtitle: 'Yapay zekâ iyileştirmesinin denetlenebilir ve gerçeklere dayalı olduğunun ölçülebilir kanıtı.',
  },
  Chinese: {
    contact: '联系方式', linkedin: '领英', github: 'GitHub', phone: '电话', email: '电子邮箱',
    location: '所在地', skills: '技能', projects: '项目', artistBio: '个人简介',
    artistStatement: '创作自述', technicalSkills: '技术技能', about: '关于我',
    statement: '自述', factLockTrustReport: 'FactLock 可信报告',
    trustSubtitle: '可量化的证据，证明 AI 优化可审查且忠于原始事实。',
  },
  Japanese: {
    contact: '連絡先', linkedin: 'LinkedIn', github: 'GitHub', phone: '電話', email: 'メール',
    location: '所在地', skills: 'スキル', projects: 'プロジェクト', artistBio: 'プロフィール',
    artistStatement: 'ステートメント', technicalSkills: '技術スキル', about: '自己紹介',
    statement: 'ステートメント', factLockTrustReport: 'FactLock 信頼レポート',
    trustSubtitle: 'AIによる推敲が検証可能で、元の事実に忠実であることを示す客観的な証拠です。',
  },
  Korean: {
    contact: '연락처', linkedin: '링크드인', github: 'GitHub', phone: '전화', email: '이메일',
    location: '위치', skills: '보유 기술', projects: '프로젝트', artistBio: '소개',
    artistStatement: '작업 노트', technicalSkills: '기술 역량', about: '소개',
    statement: '노트', factLockTrustReport: 'FactLock 신뢰 리포트',
    trustSubtitle: 'AI 보정이 검토 가능하며 원본 사실에 근거함을 보여주는 측정 가능한 증거입니다.',
  },
  Russian: {
    contact: 'Контакты', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Телефон', email: 'Эл. почта',
    location: 'Местоположение', skills: 'Навыки', projects: 'Проекты', artistBio: 'Биография',
    artistStatement: 'Творческое заявление', technicalSkills: 'Технические навыки', about: 'Обо мне',
    statement: 'Заявление', factLockTrustReport: 'Отчёт о доверии FactLock',
    trustSubtitle: 'Измеримое доказательство того, что улучшение ИИ проверяемо и основано на фактах.',
  },
  Indonesian: {
    contact: 'Kontak', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Telepon', email: 'Email',
    location: 'Lokasi', skills: 'Keahlian', projects: 'Proyek', artistBio: 'Biografi',
    artistStatement: 'Pernyataan Kreatif', technicalSkills: 'Keahlian Teknis', about: 'Tentang Saya',
    statement: 'Pernyataan', factLockTrustReport: 'Laporan Kepercayaan FactLock',
    trustSubtitle: 'Bukti terukur bahwa peningkatan AI dapat ditinjau dan tetap berdasarkan fakta asli.',
  },
  Vietnamese: {
    contact: 'Liên hệ', linkedin: 'LinkedIn', github: 'GitHub', phone: 'Điện thoại', email: 'Email',
    location: 'Địa điểm', skills: 'Kỹ năng', projects: 'Dự án', artistBio: 'Tiểu sử',
    artistStatement: 'Tuyên ngôn sáng tạo', technicalSkills: 'Kỹ năng chuyên môn', about: 'Giới thiệu',
    statement: 'Tuyên ngôn', factLockTrustReport: 'Báo cáo Tin cậy FactLock',
    trustSubtitle: 'Bằng chứng đo lường được rằng phần cải thiện bằng AI có thể kiểm chứng và bám sát sự thật.',
  },
};


function extractGeneratedPortfolioSection(text = '', heading = '') {
  const clean = stripAiReasoning(text).replace(/\r/g, '\n');
  const escaped = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|\\n)\\s*#{1,3}\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=\\n\\s*#{1,3}\\s+[A-Za-zÀ-ÿ\\u0600-\\u06FF\\u0900-\\u097F]|$)`, 'i');
  const match = clean.match(pattern);
  return cleanText(match ? match[1] : '');
}

function sectionSimilarityTokens(value = '') {
  const stop = new Set([
    'the','and','for','with','that','this','from','into','have','has','had','was','were','are',
    'you','your','their','our','but','not','can','will','about','portfolio','work','works',
    'artist','statement','bio','creative','professional','i','am','is','a','an','of','to','in',
    'on','by','my','me','as','it','through','based','only','facts','provided'
  ]);

  return [...new Set(
    cleanText(value)
      .toLowerCase()
      .match(/[a-z0-9\u0600-\u06FF\u0900-\u097F][a-z0-9\u0600-\u06FF\u0900-\u097F-]{2,}/g) || []
  )].filter(token => !stop.has(token));
}

function sectionSimilarityScore(a = '', b = '') {
  const left = sectionSimilarityTokens(a);
  const right = sectionSimilarityTokens(b);
  if (!left.length || !right.length) return 0;

  const rightSet = new Set(right);
  const overlap = left.filter(token => rightSet.has(token)).length;
  return overlap / Math.max(1, Math.min(left.length, right.length));
}

function sectionsTooSimilar(a = '', b = '') {
  const left = cleanText(a);
  const right = cleanText(b);
  if (!left || !right) return false;
  if (sameCleanText(left, right)) return true;

  const leftStart = left.slice(0, 120).toLowerCase();
  const rightStart = right.slice(0, 120).toLowerCase();
  if (leftStart && rightStart && leftStart === rightStart) return true;

  return sectionSimilarityScore(left, right) >= 0.68;
}

function buildLocalDistinctStatement({ medium = '', creatorType = '' , targetLanguage = 'English' } = {}) {
  const native = nativeLocalDraft('statement', targetLanguage, { medium, creatorType });
  if (native) return native;
  const typeText = cleanText(creatorType).toLowerCase();
  const isCareer = /student|job|career|cv|developer|software|engineer|intern|professional/.test(typeText);
  let field = cleanText(medium);

  if (!field || /^(artist|creator|other|portfolio creator)$/i.test(field)) {
    field = isCareer ? 'my professional field' : 'visual art and creative expression';
  }

  if (isCareer) {
    return `My direction is shaped by practical learning, honest growth, and a clear commitment to improving in ${field}. I want my portfolio to show how I think, what I can contribute, and how seriously I approach each opportunity.

I value clarity, consistency, and real progress over empty claims. Every part of this portfolio is meant to present my work truthfully, confidently, and in a way that helps others understand my potential.`;
  }

  return `My creative direction is guided by intention, observation, and a personal connection to ${field}. I want my work to feel expressive and meaningful while staying true to the details I have actually shared.

I see each piece as a chance to communicate mood, personality, and purpose. My goal is to keep developing a recognizable creative voice and present my work with honesty, care, and confidence.`;
}

function stripPortfolioMarkdownHeadingServer(value = '') {
  return cleanText(value)
    .replace(/^#{1,6}\s+(Artist Bio|Bio|Artist Statement|Professional Statement|Statement)\s*/i, '')
    .replace(/\n#{1,6}\s+(Artist Bio|Bio|Artist Statement|Professional Statement|Statement)\s*/gi, '\n')
    .replace(/^["']|["']$/g, '')
    .trim();
}

// True when the text is written in a script (or Roman-Urdu style) that does not belong in an
// English sentence. The local fallback templates are English prose, so quoting a foreign-script
// original inside them would leak the source language into the selected output language.
function isForeignScriptText(value = '') {
  const text = cleanText(value);
  if (!text) return false;
  return containsArabicScript(text) || containsDevanagari(text) || containsCJK(text)
    || containsBengali(text) || containsTamil(text) || containsTelugu(text)
    || containsThai(text) || hasCyrillic(text) || looksRomanUrdu(text);
}

// The original text, but only when it is safe to quote verbatim inside an English template.
function quotableOriginal(value = '') {
  const text = cleanText(value);
  return (text && !isForeignScriptText(text)) ? text : '';
}

// ---------------------------------------------------------------------------
// Native local drafts (Urdu, Arabic).
//
// For every other language the safe local draft is written in English and then translated. If the
// model is weak in a language — or simply unavailable — that path collapses to one generic
// sentence. Urdu and Arabic are written natively here instead, so the worst case is still
// grammatical, grounded, first-person prose in the right language rather than filler.
//
// Nothing in these templates asserts a fact. They carry only what the creator supplied: their
// name, their field, their title and their numbers.
// ---------------------------------------------------------------------------

// A Latin fragment can only be embedded in non-Latin prose if it is short: leaksLatinForTarget
// rejects three or more Latin words. Names and titles longer than that are left out rather than
// allowed to break the language of the whole paragraph.
function latinSafeFragment(value = '') {
  const clean = cleanText(value);
  if (!clean) return '';
  return latinWords(clean).length <= 2 ? clean : '';
}

function nativeLocalDraft(kind = 'bio', targetLanguage = 'English', options = {}) {
  const family = languageFamily(normalizeServerOutputLanguage(targetLanguage));
  if (!['urdu', 'arabic'].includes(family)) return '';

  const field = localizedMediumName(options.medium || '', targetLanguage)
    || (family === 'urdu' ? 'اپنے تخلیقی شعبے' : 'مجالي الإبداعي');
  const name = latinSafeFragment(options.name || '');
  const title = latinSafeFragment(options.title || '');
  const numbers = numbersFromText(options.originalDesc || '');
  const numberList = numbers.length ? numbers.join(family === 'urdu' ? '، ' : '، ') : '';

  if (family === 'urdu') {
    const who = name ? `میں ${name} ہوں اور` : 'میں ایک تخلیق کار ہوں اور';
    if (kind === 'bio') {
      return [
        `${who} میرا تعلق ${field} کے شعبے سے ہے۔`,
        'یہ پورٹ فولیو انہی خیالات، موضوعات اور تخلیقی فیصلوں پر مبنی ہے جو میں نے خود فراہم کیے ہیں، اور اس میں کوئی ایسا دعویٰ شامل نہیں جس کی بنیاد میرے اصل کام میں موجود نہ ہو۔',
        'میرا مقصد اپنے کام کو محنت، توجہ اور دیانت داری کے ساتھ پیش کرنا ہے، تاکہ دیکھنے والا میری اصل سمت اور میرے انداز کو واضح طور پر سمجھ سکے۔',
        'اس پورٹ فولیو کا ہر حصہ اسی معلومات پر کھڑا ہے جو میں نے خود دی ہے۔',
      ].join(' ');
    }
    if (kind === 'statement') {
      return [
        `میری تخلیقی سمت مشاہدے، تجسس اور ${field} سے میرے ذاتی تعلق سے بنتی ہے۔`,
        'ہر کام میرے لیے اپنی سوچ اور اپنے انداز کو مزید واضح کرنے کا موقع ہے، اور اس کی بنیاد صرف وہی معلومات ہیں جو میں نے خود فراہم کی ہیں۔',
        'میرے نزدیک خالی دعووں سے کہیں زیادہ اہم وضاحت، تسلسل اور اصل پیش رفت ہے۔',
        'میرا مقصد اپنے کام کو دیانت داری کے ساتھ اور اس انداز میں پیش کرنا ہے کہ دیکھنے والا میری اصل صلاحیت اور سمت کو سمجھ سکے۔',
      ].join(' ');
    }
    const subject = title ? `${title}` : 'اس پروجیکٹ';
    const counted = numberList ? ` جس میں ${numberList} شامل ہیں،` : '';
    return [
      `میں نے ${subject} پر کام کیا${counted} اور اس میں محنت اور توجہ کے ساتھ اپنی سمت واضح رکھی۔`,
      'اس اندراج کی بنیاد وہی تفصیلات ہیں جو میں نے خود فراہم کی ہیں، اور اس میں کوئی غیر مصدقہ بات شامل نہیں۔',
      'میرا مقصد اس کام کو زیادہ واضح، منظم اور مضبوط انداز میں پیش کرنا ہے، بغیر موضوع بدلے یا کوئی نئی بات شامل کیے۔',
    ].join(' ');
  }

  // Arabic
  const who = name ? `أنا ${name} وأعمل` : 'أنا مبدع وأعمل';
  if (kind === 'bio') {
    return [
      `${who} في مجال ${field}.`,
      'تعتمد هذه المحفظة بالكامل على المعلومات التي قدّمتها بنفسي، ولا تتضمن أي ادعاء لا أساس له في عملي الحقيقي.',
      'هدفي أن أقدّم عملي بوضوح وعناية وأمانة، بحيث يفهم من يطّلع عليه اتجاهي الحقيقي وأسلوبي في العمل.',
      'كل قسم هنا مبني على ما قدّمته فعلاً، دون أي إضافة.',
    ].join(' ');
  }
  if (kind === 'statement') {
    return [
      `يتشكّل اتجاهي الإبداعي من الملاحظة والفضول ومن علاقتي الشخصية بمجال ${field}.`,
      'أرى في كل عمل فرصة لأوضّح فكرتي وأسلوبي بشكل أعمق، وأبني ذلك حصراً على ما قدّمته من معلومات.',
      'أُفضّل الوضوح والاتساق والتقدّم الحقيقي على الادعاءات الفارغة.',
      'هدفي أن أقدّم قدراتي بصدق وبثقة، وبطريقة تساعد من يراها على فهم إمكاناتي الحقيقية.',
    ].join(' ');
  }
  const subject = title ? `${title}` : 'هذا المشروع';
  const counted = numberList ? ` والذي يتضمن ${numberList}،` : '';
  return [
    `عملت على ${subject}${counted} مع تركيز واضح وجهد متواصل في تنفيذه.`,
    'يستند هذا الإدخال إلى التفاصيل التي قدّمتها بنفسي، ولا يتضمن أي معلومة غير مؤكدة.',
    'هدفي أن أعرض هذا العمل بشكل أوضح وأقوى، دون تغيير موضوعه أو إضافة أي ادعاء جديد.',
  ].join(' ');
}

function buildLocalDistinctBio({ name = '', medium = '', description = '', creatorType = '', targetLanguage = 'English' } = {}) {
  const native = nativeLocalDraft('bio', targetLanguage, { name, medium, description, creatorType });
  if (native) return native;
  const displayName = cleanText(name);
  const field = cleanText(medium) || (/student|job|career|cv|developer|software|engineer|intern|professional/i.test(creatorType) ? 'my professional field' : 'my creative field');
  const original = quotableOriginal(description);
  const nameIntro = displayName ? displayName + ', ' : '';

  if (/student|job|career|cv|developer|software|engineer|intern|professional/i.test(creatorType)) {
    return 'I am ' + nameIntro + 'a developing professional focused on ' + field + ', practical learning, and building credible portfolio work. I use this portfolio to present my real skills, project experience, and growth direction in a clear and organized way. ' + (original ? 'My current work and interests are connected to this information: ' + original + '. ' : 'I keep the focus on the real information I have provided without adding unsupported claims. ') + 'I want viewers to understand how I think, what I can contribute, and how seriously I approach new opportunities. My goal is to present myself honestly while making my work feel polished, focused, and opportunity-ready.';
  }

  return 'I am ' + nameIntro + 'an emerging creator working in ' + field + ', and I use my portfolio to present the ideas, subjects, and creative choices that shape my current direction. My work is built around the details I have shared, especially the themes and visual interests that matter to me. ' + (original ? 'My creative practice is connected to this core idea: ' + original + '. ' : 'I want my work to feel honest, expressive, and carefully presented. ') + 'I am still developing my voice, but I approach each piece with care, curiosity, and intention. My goal is to share my work in a way that feels personal, credible, and true to my actual creative journey.';
}


function buildLocalDistinctStatementStrong({ medium = '', description = '', creatorType = '', targetLanguage = 'English' } = {}) {
  const native = nativeLocalDraft('statement', targetLanguage, { medium, description, creatorType });
  if (native) return native;
  const field = cleanText(medium) || (/student|job|career|cv|developer|software|engineer|intern|professional/i.test(creatorType) ? 'my professional field' : 'my creative field');
  const original = quotableOriginal(description);

  if (/student|job|career|cv|developer|software|engineer|intern|professional/i.test(creatorType)) {
    return 'My direction is shaped by practical learning, honest growth, and a clear commitment to improving in ' + field + '. I want my portfolio to show how I think, what I can contribute, and how seriously I approach each opportunity.\n\nI value clarity, consistency, and real progress over empty claims. ' + (original ? 'The details I shared guide this portfolio: ' + original + '. ' : 'Every section is based on the real information I provided. ') + 'My goal is to present my abilities truthfully, confidently, and in a way that helps others understand my potential.';
  }

  return 'My creative direction is shaped by curiosity, observation, and a personal connection to ' + field + '. I want my work to communicate feeling, care, and intention while staying true to the details I have actually shared.\n\nI see each piece as a chance to develop my visual voice and understand my creative process more deeply. ' + (original ? 'The idea behind my work begins here: ' + original + '. ' : 'I want my portfolio to feel honest, expressive, and grounded in my real creative interests. ') + 'My goal is to keep improving with confidence while presenting my work in a clear and meaningful way.';
}


function draftIsUsableForLanguage(value = '', targetLanguage = 'English') {
  const clean = cleanText(value);
  if (!clean) return false;
  if (hasUnexpectedScriptForLanguage(clean, targetLanguage)) return false;
  if (requiresNonLatinScript(targetLanguage) && !hasRequiredScript(clean, targetLanguage)) return false;
  if (looksLikeWrongEnglishForTarget(clean, targetLanguage)) return false;
  return true;
}

async function ensureDistinctBioDraft({ name = '', medium = '', description = '', targetLanguage = 'English', creatorType = '', aiTone = 'Professional', artistStatement = '' } = {}) {
  const localFallback = buildLocalDistinctBio({ name, medium, description, creatorType, targetLanguage });

  if (aiAvailable()) {
    try {
      const aiText = await generateAiText({
        temperature: 0.18,
        maxTokens: 650,
        messages: [
          {
            role: 'system',
            content: `You are MuseForge's strict portfolio BIO writer. ${languageStrictInstruction(targetLanguage)} ${toneInstruction(aiTone)} Write ONLY the bio body, no heading. Use only supplied facts. Never invent awards, clients, numbers, tools, metrics, dates, exhibitions, jobs, education, or achievements. Bio = profile/introduction. It must NOT sound like an artist statement. Write the whole bio in FIRST PERSON: use I, my, me (or the equivalent in the target language). Never write in third person and never refer to the person by name in the third person. Make it strong, polished, human, credible, and 5-6 sentences.`,
          },
          {
            role: 'user',
            content: `Name: ${cleanText(name)}
Creator type: ${cleanText(creatorType)}
Medium/field: ${cleanText(medium)}
User-provided description: ${cleanText(description)}
Existing statement to avoid repeating: ${cleanText(artistStatement)}

Write a strong portfolio bio only.`,
          },
        ],
      });

      const candidate = stripPortfolioMarkdownHeadingServer(aiText || '');
      // Two gates that were missing here entirely, so a model could write the bio in third person
      // AND invent credentials in it, and both went straight to the user.
      const firstPerson = regenerationUsesFirstPerson(candidate, targetLanguage);
      const invents = candidateInventsUnsupportedClaims(description, candidate, { medium, title: name });
      if (candidate && firstPerson && !invents
        && !sectionsTooSimilar(candidate, artistStatement)
        && !hasUnexpectedScriptForLanguage(candidate, targetLanguage)) return candidate;
      if (candidate && !firstPerson) console.warn('AI bio was not in first person; local draft used.');
      if (candidate && invents) console.warn('AI bio contained unsupported claims; local draft used.');
    } catch (error) {
      console.warn('Distinct bio generation failed; local fallback used:', error.message);
    }
  }

  return targetLanguage === 'English' ? localFallback : await translateProseStrict(localFallback, targetLanguage);
}

function replaceGeneratedPortfolioSection(markdown = '', heading = '', newBody = '') {
  const body = cleanText(newBody);
  if (!body) return markdown;

  const escaped = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|\\n)##\\s+${escaped}\\s*\\n[\\s\\S]*?(?=\\n##\\s+|$)`, 'i');
  const replacement = `\n## ${heading}\n${body}`;

  if (pattern.test(String(markdown || ''))) {
    return String(markdown || '').replace(pattern, replacement).trim();
  }

  return `${String(markdown || '').trim()}\n\n## ${heading}\n${body}`.trim();
}

async function ensureDistinctStatementDraft({
  name = '',
  medium = '',
  description = '',
  projects = [],
  targetLanguage = 'English',
  creatorType = '',
  aiTone = 'Professional',
  artistBio = '',
  artistStatement = '',
} = {}) {
  const currentStatement = cleanText(artistStatement);
  // An existing draft may be reused ONLY if it is already in the selected language. Without this,
  // the English text carried over from the local fallback portfolio was returned verbatim, and an
  // Urdu portfolio silently kept an English statement.
  if (currentStatement
    && !sectionsTooSimilar(artistBio, currentStatement)
    && draftIsUsableForLanguage(currentStatement, targetLanguage)) {
    return currentStatement;
  }

  const localFallback = buildLocalDistinctStatement({ medium, creatorType, targetLanguage });

  if (aiAvailable()) {
    try {
      const aiText = await generateAiText({
        temperature: 0.18,
        maxTokens: 650,
        messages: [
          {
            role: 'system',
            content: `You are MuseForge's strict portfolio statement writer. ${languageStrictInstruction(targetLanguage)} ${toneInstruction(aiTone)} Write ONLY the statement body, not headings. Use only supplied facts. Never invent achievements, clients, tools, awards, dates, numbers, metrics, or experience. The statement must be clearly different from the bio. Bio = identity/profile. Statement = purpose, values, creative/professional direction, process, and voice. Write the whole statement in FIRST PERSON: every sentence must use I, my or me (or the equivalent in the target language). Return only valid JSON: {"statement":"..."}.`,
          },
          {
            role: 'user',
            content: `Output language: ${cleanText(targetLanguage) || 'English'}

Name: ${cleanText(name)}
Creator type: ${cleanText(creatorType)}
Medium/field: ${cleanText(medium)}
User description: ${cleanText(description)}
Projects: ${JSON.stringify(Array.isArray(projects) ? projects.map(p => ({ title: p.title, desc: p.desc })) : [])}

Existing bio that must NOT be repeated:
${cleanText(artistBio)}

Write a strong 2 short-paragraph statement. Do not start with the same sentence as the bio. Do not summarize the bio again.`,
          },
        ],
      });

      let candidate = '';
      try {
        const parsed = parseJsonObject(aiText || '');
        candidate = cleanText(parsed.statement || '');
      } catch (_) {
        candidate = cleanText(aiText || '')
          .replace(/^statement\s*[:\-]\s*/i, '')
          .replace(/^["']|["']$/g, '');
      }

      // Same two gates as the bio: the statement must speak as the creator, and it must not
      // invent a credential the creator never claimed.
      if (
        candidate &&
        regenerationUsesFirstPerson(candidate, targetLanguage) &&
        !candidateInventsUnsupportedClaims(description, candidate, { medium }) &&
        !sectionsTooSimilar(artistBio, candidate) &&
        !hasUnexpectedScriptForLanguage(candidate, targetLanguage) &&
        !looksLikeWrongEnglishForTarget(candidate, targetLanguage)
      ) {
        return candidate;
      }
    } catch (error) {
      console.warn('Distinct statement regeneration failed; local fallback used:', error.message);
    }
  }

  const translatedFallback = await translateProseStrict(localFallback, targetLanguage);
  return cleanText(translatedFallback || localFallback);
}

function portfolioBodyForLanguageCheck(portfolio = '') {
  return cleanText(String(portfolio || '')
    .replace(/#{1,6}\s*(Artist\s+Statement|Professional\s+Statement|Artist\s+Bio|Bio|Statement)(?=$|[^\p{L}])/giu, ' ')
    .replace(/#{1,6}/g, ' '));
}

function englishProseScore(value = '') {
  const text = cleanText(value).toLowerCase();
  const matches = text.match(/\b(the|and|with|for|from|that|this|which|where|while|because|creative|portfolio|project|projects|work|works|artist|statement|skills|experience|professional|showcase|presents|provided|user|details|based|clear|authentic|centered|focused|my|is|are|was|were)\b/g) || [];
  return matches.length;
}

function targetLanguageSignalScore(value = '', targetLanguage = 'English') {
  const text = cleanText(value).toLowerCase();
  const family = languageFamily(targetLanguage);
  const packs = {
    spanish: ['el','la','los','las','de','del','y','con','para','que','mi','trabajo','proyecto','portafolio','habilidades','presenta','artística'],
    french: ['le','la','les','de','des','et','avec','pour','que','mon','travail','projet','portfolio','compétences','présente','artistique'],
    german: ['der','die','das','und','mit','für','mein','arbeit','projekt','portfolio','fähigkeiten','stellt','kreativ'],
    italian: ['il','la','gli','le','di','e','con','per','mio','lavoro','progetto','portfolio','competenze'],
    portuguese: ['o','a','os','as','de','e','com','para','meu','trabalho','projeto','portfólio','habilidades'],
    dutch: ['de','het','en','met','voor','mijn','werk','project','portfolio','vaardigheden'],
    turkish: ['ve','ile','için','benim','çalışma','proje','portfolyo','yetenek','alanında'],
    polish: ['i','oraz','z','dla','mój','praca','projekt','portfolio','umiejętności'],
    swahili: ['na','kwa','ya','yangu','kazi','mradi','portfolio','ujuzi'],
    filipino: ['ang','at','sa','para','aking','trabaho','proyekto','portfolio','kasanayan'],
    vietnamese: ['và','với','cho','của','tôi','công','việc','dự','án','hồ','sơ','kỹ','năng'],
    malay: ['dan','dengan','untuk','saya','kerja','projek','portfolio','kemahiran'],
    indonesian: ['dan','dengan','untuk','saya','kerja','proyek','portofolio','keterampilan'],
  };
  const words = packs[family] || [];
  return words.reduce((count, word) => count + (unicodeWordBoundaryPattern([word]).test(text) ? 1 : 0), 0);
}

function looksLikeWrongEnglishForTarget(value = '', targetLanguage = 'English') {
  const family = languageFamily(targetLanguage);
  if (['english', 'roman urdu'].includes(family) || requiresNonLatinScript(targetLanguage)) return false;
  const englishScore = englishProseScore(value);
  const targetScore = targetLanguageSignalScore(value, targetLanguage);
  return englishScore >= 4 && englishScore >= targetScore + 3;
}

// The CV parser emits a FIXED, known set of section names, so they are translated from a table
// instead of being sent to the model. Headings are therefore always correct in the selected
// language, cost zero AI calls, and stay correct even when no AI provider is configured or the
// provider rate-limits mid-demo. Genuinely custom user-created section names still go to the model.
const SECTION_NAME_DICT = {
  education: {
    English:'Education', Spanish:'Educación', French:'Formation', German:'Ausbildung', Italian:'Istruzione',
    Portuguese:'Formação', Dutch:'Opleiding', Polish:'Wykształcenie', Turkish:'Eğitim', Arabic:'التعليم', Chinese:'教育背景',
    Japanese:'学歴', Korean:'학력', Russian:'Образование', Indonesian:'Pendidikan', Vietnamese:'Học vấn',
    Urdu:'تعلیم', 'Roman Urdu':'Taleem', Hindi:'शिक्षा',
  },
  experience: {
    English:'Experience', Spanish:'Experiencia', French:'Expérience', German:'Berufserfahrung', Italian:'Esperienza',
    Portuguese:'Experiência', Dutch:'Werkervaring', Polish:'Doświadczenie', Turkish:'Deneyim', Arabic:'الخبرة', Chinese:'工作经历',
    Japanese:'職務経歴', Korean:'경력', Russian:'Опыт работы', Indonesian:'Pengalaman', Vietnamese:'Kinh nghiệm',
    Urdu:'تجربہ', 'Roman Urdu':'Tajurba', Hindi:'अनुभव',
  },
  projects: {
    English:'Projects', Spanish:'Proyectos', French:'Projets', German:'Projekte', Italian:'Progetti',
    Portuguese:'Projetos', Dutch:'Projecten', Polish:'Projekty', Turkish:'Projeler', Arabic:'المشاريع', Chinese:'项目',
    Japanese:'プロジェクト', Korean:'프로젝트', Russian:'Проекты', Indonesian:'Proyek', Vietnamese:'Dự án',
    Urdu:'منصوبے', 'Roman Urdu':'Projects', Hindi:'परियोजनाएँ',
  },
  skills: {
    English:'Skills', Spanish:'Habilidades', French:'Compétences', German:'Fähigkeiten', Italian:'Competenze',
    Portuguese:'Competências', Dutch:'Vaardigheden', Polish:'Umiejętności', Turkish:'Yetenekler', Arabic:'المهارات', Chinese:'技能',
    Japanese:'スキル', Korean:'보유 기술', Russian:'Навыки', Indonesian:'Keahlian', Vietnamese:'Kỹ năng',
    Urdu:'مہارتیں', 'Roman Urdu':'Skills', Hindi:'कौशल',
  },
  certifications: {
    English:'Workshops & Certifications', Spanish:'Talleres y certificaciones', French:'Ateliers et certifications',
    German:'Workshops & Zertifikate', Italian:'Workshop e certificazioni', Portuguese:'Workshops e certificações',
    Dutch:'Workshops & certificaten', Polish:'Warsztaty i certyfikaty', Turkish:'Atölyeler ve Sertifikalar', Arabic:'الورش والشهادات',
    Chinese:'培训与证书', Japanese:'研修・資格', Korean:'워크숍 및 자격증', Russian:'Тренинги и сертификаты',
    Indonesian:'Lokakarya & Sertifikasi', Vietnamese:'Hội thảo & Chứng chỉ', Urdu:'ورکشاپس اور اسناد',
    'Roman Urdu':'Workshops aur Certifications', Hindi:'कार्यशालाएँ और प्रमाणपत्र',
  },
  awards: {
    English:'Awards', Spanish:'Premios', French:'Distinctions', German:'Auszeichnungen', Italian:'Premi',
    Portuguese:'Prémios', Dutch:'Onderscheidingen', Polish:'Wyróżnienia', Turkish:'Ödüller', Arabic:'الجوائز', Chinese:'奖项',
    Japanese:'受賞歴', Korean:'수상 경력', Russian:'Награды', Indonesian:'Penghargaan', Vietnamese:'Giải thưởng',
    Urdu:'اعزازات', 'Roman Urdu':'Awards', Hindi:'पुरस्कार',
  },
  extracurricular: {
    English:'Extracurricular Activities', Spanish:'Actividades extracurriculares', French:'Activités parascolaires',
    German:'Außerschulische Aktivitäten', Italian:'Attività extracurriculari', Portuguese:'Atividades extracurriculares',
    Dutch:'Buitenschoolse activiteiten', Polish:'Zajęcia dodatkowe', Turkish:'Sosyal Etkinlikler', Arabic:'الأنشطة اللاصفية',
    Chinese:'课外活动', Japanese:'課外活動', Korean:'교외 활동', Russian:'Внеучебная деятельность',
    Indonesian:'Kegiatan Ekstrakurikuler', Vietnamese:'Hoạt động ngoại khóa', Urdu:'غیر نصابی سرگرمیاں',
    'Roman Urdu':'Ghair Nisabi Sargarmiyan', Hindi:'सह-पाठ्यक्रम गतिविधियाँ',
  },
  publications: {
    English:'Publications', Spanish:'Publicaciones', French:'Publications', German:'Publikationen', Italian:'Pubblicazioni',
    Portuguese:'Publicações', Dutch:'Publicaties', Polish:'Publikacje', Turkish:'Yayınlar', Arabic:'المنشورات', Chinese:'发表作品',
    Japanese:'論文・発表', Korean:'출판물', Russian:'Публикации', Indonesian:'Publikasi', Vietnamese:'Công bố',
    Urdu:'مطبوعات', 'Roman Urdu':'Publications', Hindi:'प्रकाशन',
  },
  languages: {
    English:'Languages', Spanish:'Idiomas', French:'Langues', German:'Sprachen', Italian:'Lingue',
    Portuguese:'Idiomas', Dutch:'Talen', Polish:'Języki', Turkish:'Diller', Arabic:'اللغات', Chinese:'语言能力',
    Japanese:'語学', Korean:'언어', Russian:'Языки', Indonesian:'Bahasa', Vietnamese:'Ngôn ngữ',
    Urdu:'زبانیں', 'Roman Urdu':'Zubanain', Hindi:'भाषाएँ',
  },
  interests: {
    English:'Interests', Spanish:'Intereses', French:"Centres d'intérêt", German:'Interessen', Italian:'Interessi',
    Portuguese:'Interesses', Dutch:'Interesses', Polish:'Zainteresowania', Turkish:'İlgi Alanları', Arabic:'الاهتمامات', Chinese:'兴趣爱好',
    Japanese:'趣味・関心', Korean:'관심사', Russian:'Интересы', Indonesian:'Minat', Vietnamese:'Sở thích',
    Urdu:'دلچسپیاں', 'Roman Urdu':'Dilchaspiyan', Hindi:'रुचियाँ',
  },
  references: {
    English:'References', Spanish:'Referencias', French:'Références', German:'Referenzen', Italian:'Referenze',
    Portuguese:'Referências', Dutch:'Referenties', Polish:'Referencje', Turkish:'Referanslar', Arabic:'المراجع', Chinese:'推荐人',
    Japanese:'推薦者', Korean:'추천인', Russian:'Рекомендации', Indonesian:'Referensi', Vietnamese:'Người tham chiếu',
    Urdu:'حوالہ جات', 'Roman Urdu':'References', Hindi:'संदर्भ',
  },
  summary: {
    English:'Summary', Spanish:'Resumen', French:'Résumé', German:'Zusammenfassung', Italian:'Sintesi',
    Portuguese:'Resumo', Dutch:'Samenvatting', Polish:'Podsumowanie', Turkish:'Özet', Arabic:'نبذة', Chinese:'简介',
    Japanese:'概要', Korean:'요약', Russian:'Краткое описание', Indonesian:'Ringkasan', Vietnamese:'Tóm tắt',
    Urdu:'خلاصہ', 'Roman Urdu':'Khulasa', Hindi:'सारांश',
  },
};

// The medium sits directly under the name in the portfolio hero, so leaving it in English is a
// visible language failure. It is free text, but in practice it is one of the UI presets or a
// common field name, so the frequent cases are translated deterministically here. Anything not in
// this table is translated by the model when one is available, and otherwise kept in the user's
// own words rather than replaced by an invented label.
const MEDIUM_DICT = {
  visualarts: {
    English:'Visual Arts & Painting', Spanish:'Artes visuales y pintura', French:'Arts visuels et peinture',
    German:'Bildende Kunst & Malerei', Italian:'Arti visive e pittura', Portuguese:'Artes visuais e pintura',
    Dutch:'Beeldende kunst & schilderkunst', Polish:'Sztuki wizualne i malarstwo', Turkish:'Görsel Sanatlar ve Resim', Arabic:'الفنون البصرية والرسم',
    Chinese:'视觉艺术与绘画', Japanese:'ビジュアルアート・絵画', Korean:'시각 예술 및 회화',
    Russian:'Изобразительное искусство и живопись', Indonesian:'Seni Rupa & Lukis', Vietnamese:'Nghệ thuật thị giác & Hội họa',
    Urdu:'بصری فنون اور مصوری', 'Roman Urdu':'Visual Arts aur Musawwari', Hindi:'दृश्य कला एवं चित्रकला',
  },
  music: {
    English:'Music & Performance', Spanish:'Música y interpretación', French:'Musique et performance',
    German:'Musik & Performance', Italian:'Musica e performance', Portuguese:'Música e performance',
    Dutch:'Muziek & performance', Polish:'Muzyka i występy', Turkish:'Müzik ve Performans', Arabic:'الموسيقى والأداء',
    Chinese:'音乐与表演', Japanese:'音楽・パフォーマンス', Korean:'음악 및 공연',
    Russian:'Музыка и исполнение', Indonesian:'Musik & Pertunjukan', Vietnamese:'Âm nhạc & Biểu diễn',
    Urdu:'موسیقی اور پرفارمنس', 'Roman Urdu':'Mausiqi aur Performance', Hindi:'संगीत एवं प्रदर्शन',
  },
  illustration: {
    English:'Illustration', Spanish:'Ilustración', French:'Illustration', German:'Illustration', Italian:'Illustrazione',
    Portuguese:'Ilustração', Dutch:'Illustratie', Polish:'Ilustracja', Turkish:'İllüstrasyon', Arabic:'الرسم التوضيحي',
    Chinese:'插画', Japanese:'イラストレーション', Korean:'일러스트레이션', Russian:'Иллюстрация',
    Indonesian:'Ilustrasi', Vietnamese:'Minh họa', Urdu:'خاکہ نگاری', 'Roman Urdu':'Illustration', Hindi:'चित्रण',
  },
  photography: {
    English:'Photography', Spanish:'Fotografía', French:'Photographie', German:'Fotografie', Italian:'Fotografia',
    Portuguese:'Fotografia', Dutch:'Fotografie', Polish:'Fotografia', Turkish:'Fotoğrafçılık', Arabic:'التصوير الفوتوغرافي',
    Chinese:'摄影', Japanese:'写真', Korean:'사진', Russian:'Фотография', Indonesian:'Fotografi',
    Vietnamese:'Nhiếp ảnh', Urdu:'فوٹوگرافی', 'Roman Urdu':'Photography', Hindi:'फोटोग्राफी',
  },
  graphicdesign: {
    English:'Graphic Design', Spanish:'Diseño gráfico', French:'Design graphique', German:'Grafikdesign',
    Italian:'Grafica', Portuguese:'Design gráfico', Dutch:'Grafisch ontwerp', Polish:'Projektowanie graficzne', Turkish:'Grafik Tasarım',
    Arabic:'التصميم الجرافيكي', Chinese:'平面设计', Japanese:'グラフィックデザイン', Korean:'그래픽 디자인',
    Russian:'Графический дизайн', Indonesian:'Desain Grafis', Vietnamese:'Thiết kế đồ họa',
    Urdu:'گرافک ڈیزائن', 'Roman Urdu':'Graphic Design', Hindi:'ग्राफ़िक डिज़ाइन',
  },
  animation: {
    English:'Animation', Spanish:'Animación', French:'Animation', German:'Animation', Italian:'Animazione',
    Portuguese:'Animação', Dutch:'Animatie', Polish:'Animacja', Turkish:'Animasyon', Arabic:'الرسوم المتحركة',
    Chinese:'动画', Japanese:'アニメーション', Korean:'애니메이션', Russian:'Анимация',
    Indonesian:'Animasi', Vietnamese:'Hoạt hình', Urdu:'اینیمیشن', 'Roman Urdu':'Animation', Hindi:'एनिमेशन',
  },
  writing: {
    English:'Creative Writing', Spanish:'Escritura creativa', French:'Écriture créative', German:'Kreatives Schreiben',
    Italian:'Scrittura creativa', Portuguese:'Escrita criativa', Dutch:'Creatief schrijven', Polish:'Twórcze pisanie', Turkish:'Yaratıcı Yazarlık',
    Arabic:'الكتابة الإبداعية', Chinese:'创意写作', Japanese:'クリエイティブ・ライティング', Korean:'창작 글쓰기',
    Russian:'Литературное творчество', Indonesian:'Penulisan Kreatif', Vietnamese:'Sáng tác',
    Urdu:'تخلیقی تحریر', 'Roman Urdu':'Takhleeqi Tehreer', Hindi:'रचनात्मक लेखन',
  },
  uiux: {
    English:'UI/UX Design', Spanish:'Diseño UI/UX', French:'Design UI/UX', German:'UI/UX-Design',
    Italian:'Design UI/UX', Portuguese:'Design UI/UX', Dutch:'UI/UX-ontwerp', Polish:'Projektowanie UI/UX', Turkish:'UI/UX Tasarımı',
    Arabic:'تصميم واجهات المستخدم', Chinese:'UI/UX 设计', Japanese:'UI/UXデザイン', Korean:'UI/UX 디자인',
    Russian:'UI/UX-дизайн', Indonesian:'Desain UI/UX', Vietnamese:'Thiết kế UI/UX',
    Urdu:'یو آئی/یو ایکس ڈیزائن', 'Roman Urdu':'UI/UX Design', Hindi:'UI/UX डिज़ाइन',
  },
  film: {
    English:'Film & Video', Spanish:'Cine y vídeo', French:'Cinéma et vidéo', German:'Film & Video',
    Italian:'Cinema e video', Portuguese:'Cinema e vídeo', Dutch:'Film & video', Polish:'Film i wideo', Turkish:'Film ve Video',
    Arabic:'السينما والفيديو', Chinese:'影视', Japanese:'映像', Korean:'영상', Russian:'Кино и видео',
    Indonesian:'Film & Video', Vietnamese:'Phim & Video', Urdu:'فلم اور ویڈیو', 'Roman Urdu':'Film aur Video', Hindi:'फ़िल्म एवं वीडियो',
  },
  gamedesign: {
    English:'Game Design', Spanish:'Diseño de videojuegos', French:'Game design', German:'Game Design',
    Italian:'Game design', Portuguese:'Design de jogos', Dutch:'Gameontwerp', Polish:'Projektowanie gier', Turkish:'Oyun Tasarımı',
    Arabic:'تصميم الألعاب', Chinese:'游戏设计', Japanese:'ゲームデザイン', Korean:'게임 디자인',
    Russian:'Геймдизайн', Indonesian:'Desain Gim', Vietnamese:'Thiết kế trò chơi',
    Urdu:'گیم ڈیزائن', 'Roman Urdu':'Game Design', Hindi:'गेम डिज़ाइन',
  },
  softwareengineering: {
    English:'Software Engineering', Spanish:'Ingeniería de software', French:'Génie logiciel',
    German:'Softwareentwicklung', Italian:'Ingegneria del software', Portuguese:'Engenharia de software',
    Dutch:'Software-engineering', Polish:'Inżynieria oprogramowania', Turkish:'Yazılım Mühendisliği', Arabic:'هندسة البرمجيات',
    Chinese:'软件工程', Japanese:'ソフトウェアエンジニアリング', Korean:'소프트웨어 엔지니어링',
    Russian:'Разработка ПО', Indonesian:'Rekayasa Perangkat Lunak', Vietnamese:'Kỹ thuật phần mềm',
    Urdu:'سافٹ ویئر انجینئرنگ', 'Roman Urdu':'Software Engineering', Hindi:'सॉफ़्टवेयर इंजीनियरिंग',
  },
  webdevelopment: {
    English:'Web Development', Spanish:'Desarrollo web', French:'Développement web', German:'Webentwicklung',
    Italian:'Sviluppo web', Portuguese:'Desenvolvimento web', Dutch:'Webontwikkeling', Polish:'Tworzenie stron internetowych', Turkish:'Web Geliştirme',
    Arabic:'تطوير الويب', Chinese:'网页开发', Japanese:'Web開発', Korean:'웹 개발',
    Russian:'Веб-разработка', Indonesian:'Pengembangan Web', Vietnamese:'Phát triển web',
    Urdu:'ویب ڈیولپمنٹ', 'Roman Urdu':'Web Development', Hindi:'वेब डेवलपमेंट',
  },
};

function mediumCanonicalKey(value = '') {
  const key = cleanText(value).toLowerCase().replace(/[^a-z/]/g, '');
  if (!key) return '';
  if (/visualarts|painting|fineart|paint/.test(key)) return 'visualarts';
  if (/^music|musicperformance|musician|musicproduction|sound/.test(key)) return 'music';
  if (/illustrat/.test(key)) return 'illustration';
  if (/photograph/.test(key)) return 'photography';
  if (/graphicdesign|graphics/.test(key)) return 'graphicdesign';
  if (/animation|animator/.test(key)) return 'animation';
  if (/creativewriting|writer|writing|poet/.test(key)) return 'writing';
  if (/ui\/ux|uiux|uxdesign|uidesign|productdesign/.test(key)) return 'uiux';
  if (/film|video|cinema|filmmak/.test(key)) return 'film';
  if (/gamedesign|gamedev/.test(key)) return 'gamedesign';
  if (/softwareengineer|softwaredevelop|programmer/.test(key)) return 'softwareengineering';
  if (/webdevelop|frontend|fullstack|backend/.test(key)) return 'webdevelopment';
  return '';
}

function localizedMediumName(value = '', language = 'English') {
  const key = mediumCanonicalKey(value);
  if (!key) return '';
  const row = MEDIUM_DICT[key];
  if (!row) return '';
  return cleanText(row[normalizeServerOutputLanguage(language)]) || '';
}

function sectionCanonicalKey(name = '') {
  const key = cleanText(name).toLowerCase()
    .replace(/&/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!key) return '';
  if (/^(education|academics?|academic qualifications?|academic background|educational background)$/.test(key)) return 'education';
  if (/^(experience|work experience|professional experience|work history|employment|employment history|internships?|internship experience)$/.test(key)) return 'experience';
  if (/^(projects?|academic projects|personal projects|selected projects|key projects)$/.test(key)) return 'projects';
  if (/^(skills|technical skills|core skills|skills tools|core competencies|key skills)$/.test(key)) return 'skills';
  if (/^(workshops certifications|certifications?|certificates?|courses certifications|licenses certifications|trainings?|workshops?)$/.test(key)) return 'certifications';
  if (/^(awards?|honors?|honours?|awards honors|achievements?|awards achievements)$/.test(key)) return 'awards';
  if (/^(extracurricular activities|extracurricular|activities|co curricular activities)$/.test(key)) return 'extracurricular';
  if (/^(publications?|research publications|papers)$/.test(key)) return 'publications';
  if (/^(languages?|language proficiency|languages spoken)$/.test(key)) return 'languages';
  if (/^(interests?|hobbies|hobbies interests|interests hobbies)$/.test(key)) return 'interests';
  if (/^(references?|referees?)$/.test(key)) return 'references';
  if (/^(summary|professional summary|profile|about|about me|objective|career objective)$/.test(key)) return 'summary';
  return '';
}

function localizedSectionName(name = '', language = 'English') {
  const key = sectionCanonicalKey(name);
  if (!key) return '';
  const row = SECTION_NAME_DICT[key];
  if (!row) return '';
  return cleanText(row[normalizeServerOutputLanguage(language)]) || '';
}

// Short structural labels (section names, item headings, project titles, medium) must NEVER be
// replaced by a generic sentence. If translation is unavailable the ORIGINAL label is kept: a
// heading left in English is recoverable, a heading replaced by a paragraph is a broken portfolio.
async function translateLabelStrict(text = '', targetLanguage = 'English') {
  const clean = cleanText(text);
  const lang = normalizeServerOutputLanguage(targetLanguage);
  if (!clean) return '';
  if (languageFamily(lang) === 'english') return clean;

  const known = localizedSectionName(clean, lang) || localizedMediumName(clean, lang);
  if (known) return known;
  if (!aiAvailable()) return clean;

  try {
    const aiText = await generateAiText({
      temperature: 0.02,
      maxTokens: 60,
      messages: [
        {
          role: 'system',
          content: `You translate SHORT portfolio headings. ${languageStrictInstruction(lang)} Translate the heading into ${lang}. Keep proper nouns, person names, institution names, company names, brand names, product names and technology names unchanged. Return ONLY the translated heading: no quotes, no explanation, no trailing punctuation, maximum 6 words.`,
        },
        { role: 'user', content: clean },
      ],
    });
    const out = cleanText(aiText).replace(/^["'«»]+|["'«»]+$/g, '').split('\n')[0].trim();
    // Reject a model reply that is a sentence rather than a heading, is in the wrong script, or —
    // for a language that needs its own script — simply came back in English. Accepting an English
    // label would silently print "Education" inside an Arabic or Urdu portfolio.
    if (out
      && out.split(/\s+/).length <= 8
      && !hasUnexpectedScriptForLanguage(out, lang)
      && (!requiresNonLatinScript(lang) || hasRequiredScript(out, lang))) return out;
  } catch (error) {
    console.warn('Label translation failed; original label kept:', error.message);
  }
  return clean;
}

function labelsForLanguage(language = 'English') {
  return OUTPUT_LABELS[cleanText(language)] || OUTPUT_LABELS.English;
}

function sanitizeLocalizedProjects(projects = [], fallbackProjects = []) {
  const raw = Array.isArray(projects) ? projects : [];
  const fallback = Array.isArray(fallbackProjects) ? fallbackProjects : [];
  const source = raw.length ? raw : fallback;
  return source.map((item, index) => {
    const original = fallback.find(project => String(project.id) === String(item.id)) || fallback[index] || {};
    return {
      id: cleanText(item.id || original.id || `project-${index + 1}`),
      title: cleanText(item.title || original.title),
      desc: cleanText(item.desc || original.desc),
      link: cleanText(item.link || original.link),
    };
  }).filter(item => item.title);
}

function sanitizeLocalizedSections(sections = [], fallbackSections = []) {
  const raw = Array.isArray(sections) ? sections : [];
  const fallback = Array.isArray(fallbackSections) ? fallbackSections : [];
  const source = raw.length ? raw : fallback;
  return source.map((section, sectionIndex) => {
    const original = fallback.find(item => String(item.id) === String(section.id)) || fallback[sectionIndex] || {};
    const originalItems = Array.isArray(original.items) ? original.items : [];
    const sectionItems = Array.isArray(section.items) ? section.items : [];
    return {
      id: cleanText(section.id || original.id || `section-${sectionIndex + 1}`),
      name: cleanText(section.name || original.name),
      items: (sectionItems.length ? sectionItems : originalItems).map((item, itemIndex) => {
        const originalItem = originalItems.find(i => String(i.id) === String(item.id)) || originalItems[itemIndex] || {};
        return {
          id: cleanText(item.id || originalItem.id || `item-${itemIndex + 1}`),
          heading: cleanText(item.heading || originalItem.heading),
          desc: cleanText(item.desc || originalItem.desc),
          link: cleanText(item.link || originalItem.link),
          media: originalItem.media || item.media || null,
        };
      }),
    };
  }).filter(section => section.name || section.items.length);
}


function transliterateLatinName(value = '', targetLanguage = 'English') {
  // Preserve proper names by default. Hardcoded demo-name transliteration was removed
  // because it only worked for a few names and could misrepresent real users.
  return cleanText(value);
}

function hasCyrillic(value = '') {
  return /[\u0400-\u04FF]/.test(String(value));
}

function containsArabicScript(value = '') { return /[\u0600-\u06FF]/.test(String(value)); }

// Urdu and Arabic share the SAME Unicode block, so "contains Arabic script" cannot tell them
// apart. Asked for Urdu, a model can reply in Arabic and pass a naive script check. These letters
// separate them:
//   Urdu-only   ٹ ڈ ڑ ژ پ چ ک گ ں ھ ہ ی ے   (none of these are standard Arabic letters)
//   Arabic-only ة ي ك                        (Urdu writes these as ہ/ی/ک)
const URDU_SPECIFIC_LETTERS = /[\u0679\u0688\u0691\u0698\u067E\u0686\u06A9\u06AF\u06BA\u06BE\u06C1\u06CC\u06D2]/;
const ARABIC_SPECIFIC_LETTERS = /[\u0629\u064A\u0643]/;

// Three-way, because short words can be genuinely ambiguous: "اعزازات" (Urdu: Awards) uses only
// letters the two languages share. Prose is never ambiguous — real Arabic always reaches for ي/ك/ة
// and real Urdu always reaches for ی/ہ/ے/ک — so the swap is caught where it actually matters, and
// short shared-letter headings are not falsely rejected.
function arabicScriptFlavour(value = '') {
  const text = String(value);
  if (!containsArabicScript(text)) return 'none';
  const urdu = URDU_SPECIFIC_LETTERS.test(text);
  const arabic = ARABIC_SPECIFIC_LETTERS.test(text);
  if (urdu && !arabic) return 'urdu';
  if (arabic && !urdu) return 'arabic';
  if (urdu && arabic) return 'urdu';       // Urdu freely borrows Arabic words; Arabic never uses ٹ/ڈ/ے
  return 'ambiguous';
}
function looksUrduScript(value = '') {
  return ['urdu', 'ambiguous'].includes(arabicScriptFlavour(value));
}
function looksArabicScript(value = '') {
  return ['arabic', 'ambiguous'].includes(arabicScriptFlavour(value));
}
function containsDevanagari(value = '') { return /[\u0900-\u097F]/.test(String(value)); }
function containsCJK(value = '') { return /[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(String(value)); }
function containsBengali(value = '') { return /[\u0980-\u09FF]/.test(String(value)); }
function containsTamil(value = '') { return /[\u0B80-\u0BFF]/.test(String(value)); }
function containsTelugu(value = '') { return /[\u0C00-\u0C7F]/.test(String(value)); }
function containsThai(value = '') { return /[\u0E00-\u0E7F]/.test(String(value)); }

function latinWords(value = '') {
  return (String(value || '').match(/\b[A-Za-z][A-Za-z]{2,}\b/g) || [])
    .filter(word => !/^(http|https|www|com|net|org|gmail|email|github|linkedin|react|node|python|javascript|typescript|java|html|css|sql|mongodb|express|museforge|factlock|api|ui|ux|cv|pdf|ai|ml)$/i.test(word));
}

function looksRomanUrdu(value = '') {
  const text = String(value || '').toLowerCase();
  const romanWords = ['main','mein','mai','mera','meri','mere','hun','houn','hoon','hai','hain','aur','jo','ke','ki','ka','ko','se','liye','liay','liyay','pasand','karta','karti','banata','banati','shamil','zariye','apne','jismein','par','wala','wali','walay','kudrat','khwab','khayal'];
  const hits = romanWords.filter(word => new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text)).length;
  const englishSignals = (text.match(/\b(the|and|with|for|from|that|this|which|where|while|because|creative|portfolio|project|design|artist|visual|digital|collection|book|cover)\b/g) || []).length;
  return hits >= 3 && hits > englishSignals;
}

function requiresNonLatinScript(targetLanguage = 'English') {
  return ['arabic','urdu','persian','pashto','sindhi','hindi','bengali','punjabi','tamil','telugu','thai','chinese','japanese','korean','russian','greek'].includes(languageFamily(targetLanguage));
}

function hasRequiredScript(value = '', targetLanguage = 'English') {
  const family = languageFamily(targetLanguage);
  const text = String(value || '');
  // Urdu must be Urdu, not Arabic dressed up in the same block — and vice versa.
  if (family === 'urdu') return looksUrduScript(text);
  if (family === 'arabic') return looksArabicScript(text);
  if (['persian','pashto','sindhi'].includes(family)) return containsArabicScript(text);
  if (family === 'hindi') return containsDevanagari(text);
  if (family === 'bengali') return containsBengali(text);
  if (family === 'punjabi') return /[਀-੿]/.test(text); // Gurmukhi
  if (family === 'tamil') return containsTamil(text);
  if (family === 'telugu') return containsTelugu(text);
  if (family === 'thai') return containsThai(text);
  if (['chinese','japanese','korean'].includes(family)) return containsCJK(text);
  if (family === 'russian') return hasCyrillic(text);
  if (family === 'greek') return /[Ͱ-Ͽἀ-῿]/.test(text);
  return true;
}

function leaksLatinForTarget(value = '', targetLanguage = 'English') {
  if (!requiresNonLatinScript(targetLanguage)) return false;
  const words = latinWords(value);
  return words.length >= 3 || (words.join(' ').length > 18 && !hasRequiredScript(value, targetLanguage));
}

function genericLocalizedText(targetLanguage = 'English', kind = 'description') {
  const family = languageFamily(normalizeServerOutputLanguage(targetLanguage));
  const text = {
    // First person, always. A portfolio speaks as the creator, so even the safe fallback that
    // runs when no model is available must say "I", never "the creator". Third-person filler here
    // used to slip into the portfolio whenever the AI was unavailable.
    english:      { medium:'Creative Portfolio', description:'I present this work using only the details I provided, kept clear, honest and professional.', project:'I present this project using only the details I provided, described clearly and without embellishment.', section:'Additional Section', item:'Additional Detail' },
    spanish:      { medium:'Campo creativo', description:'Presento este trabajo utilizando únicamente los datos que aporté, de forma clara, honesta y profesional.', project:'Presento este proyecto utilizando únicamente los datos que aporté, descrito con claridad y sin adornos.', section:'Sección adicional', item:'Detalle adicional' },
    french:       { medium:'Domaine créatif', description:"Je présente ce travail en m'appuyant uniquement sur les informations que j'ai fournies, de manière claire, honnête et professionnelle.", project:"Je présente ce projet en m'appuyant uniquement sur les informations que j'ai fournies, décrit clairement et sans embellissement.", section:'Section supplémentaire', item:'Détail supplémentaire' },
    german:       { medium:'Kreatives Feld', description:'Ich stelle diese Arbeit ausschließlich anhand der Angaben dar, die ich gemacht habe – klar, ehrlich und professionell.', project:'Ich stelle dieses Projekt ausschließlich anhand meiner eigenen Angaben dar, klar beschrieben und ohne Ausschmückung.', section:'Zusätzlicher Abschnitt', item:'Zusätzliches Detail' },
    italian:      { medium:'Ambito creativo', description:'Presento questo lavoro basandomi solo sulle informazioni che ho fornito, in modo chiaro, onesto e professionale.', project:'Presento questo progetto basandomi solo sulle informazioni che ho fornito, descritto con chiarezza e senza abbellimenti.', section:'Sezione aggiuntiva', item:'Dettaglio aggiuntivo' },
    portuguese:   { medium:'Área criativa', description:'Apresento este trabalho usando apenas as informações que forneci, de forma clara, honesta e profissional.', project:'Apresento este projeto usando apenas as informações que forneci, descrito com clareza e sem exageros.', section:'Secção adicional', item:'Detalhe adicional' },
    dutch:        { medium:'Creatief vakgebied', description:'Ik presenteer dit werk uitsluitend op basis van de gegevens die ik heb aangeleverd, helder, eerlijk en professioneel.', project:'Ik presenteer dit project uitsluitend op basis van mijn eigen gegevens, helder beschreven en zonder opsmuk.', section:'Aanvullende sectie', item:'Aanvullend detail' },
    polish:       { medium:'Dziedzina twórcza', description:'Przedstawiam tę pracę wyłącznie na podstawie informacji, które sama podałam — jasno, uczciwie i profesjonalnie.', project:'Przedstawiam ten projekt wyłącznie na podstawie własnych informacji, opisany jasno i bez upiększeń.', section:'Dodatkowa sekcja', item:'Dodatkowy szczegół' },
    turkish:      { medium:'Yaratıcı alan', description:'Bu çalışmayı yalnızca kendi verdiğim bilgilere dayanarak, açık, dürüst ve profesyonel bir şekilde sunuyorum.', project:'Bu projeyi yalnızca kendi verdiğim bilgilere dayanarak, açıkça ve abartmadan anlatıyorum.', section:'Ek bölüm', item:'Ek ayrıntı' },
    arabic:       { medium:'المجال الإبداعي', description:'أقدّم هذا العمل اعتمادًا على المعلومات التي قدمتها فقط، بأسلوب واضح وصادق ومهني.', project:'أقدّم هذا المشروع اعتمادًا على المعلومات التي قدمتها فقط، وأصفه بوضوح ودون مبالغة.', section:'قسم إضافي', item:'تفصيل إضافي' },
    urdu:         { medium:'تخلیقی شعبہ', description:'میں یہ کام صرف اُنہی تفصیلات کی بنیاد پر پیش کرتی ہوں جو میں نے خود فراہم کی ہیں، واضح، دیانت دارانہ اور پیشہ ورانہ انداز میں۔', project:'میں یہ منصوبہ صرف اپنی فراہم کردہ معلومات کی بنیاد پر پیش کرتی ہوں، واضح انداز میں اور بغیر کسی مبالغے کے۔', section:'اضافی حصہ', item:'اضافی تفصیل' },
    chinese:      { medium:'创意领域', description:'我仅根据自己提供的信息来呈现这项工作，力求清晰、真实、专业。', project:'我仅根据自己提供的信息来介绍这个项目，表达清晰，不加修饰。', section:'附加部分', item:'附加细节' },
    japanese:     { medium:'クリエイティブ分野', description:'私は自分が提供した情報だけをもとに、この仕事を明確かつ誠実に、専門的な形で紹介しています。', project:'私は自分が提供した情報だけをもとに、このプロジェクトを明確に、誇張せずに紹介しています。', section:'追加セクション', item:'追加の詳細' },
    korean:       { medium:'창작 분야', description:'저는 제가 제공한 정보만을 바탕으로 이 작업을 명확하고 정직하며 전문적으로 소개합니다.', project:'저는 제가 제공한 정보만을 바탕으로 이 프로젝트를 명확하게, 과장 없이 소개합니다.', section:'추가 섹션', item:'추가 세부 정보' },
    russian:      { medium:'Творческая область', description:'Я представляю эту работу, опираясь только на те сведения, которые я предоставила, — ясно, честно и профессионально.', project:'Я представляю этот проект, опираясь только на собственные сведения, описывая его ясно и без прикрас.', section:'Дополнительный раздел', item:'Дополнительная деталь' },
    indonesian:   { medium:'Bidang kreatif', description:'Saya menyajikan karya ini hanya berdasarkan informasi yang saya berikan sendiri, secara jelas, jujur, dan profesional.', project:'Saya menyajikan proyek ini hanya berdasarkan informasi yang saya berikan, dijelaskan dengan jelas dan tanpa dilebih-lebihkan.', section:'Bagian tambahan', item:'Detail tambahan' },
    vietnamese:   { medium:'Lĩnh vực sáng tạo', description:'Tôi trình bày công việc này chỉ dựa trên những thông tin do chính tôi cung cấp, một cách rõ ràng, trung thực và chuyên nghiệp.', project:'Tôi trình bày dự án này chỉ dựa trên thông tin do chính tôi cung cấp, mô tả rõ ràng và không phóng đại.', section:'Phần bổ sung', item:'Chi tiết bổ sung' },
    hindi:        { medium:'रचनात्मक क्षेत्र', description:'मैं यह कार्य केवल उन्हीं विवरणों के आधार पर प्रस्तुत करती हूँ जो मैंने स्वयं दिए हैं — स्पष्ट, ईमानदार और पेशेवर ढंग से।', project:'मैं यह परियोजना केवल अपनी दी हुई जानकारी के आधार पर प्रस्तुत करती हूँ, स्पष्ट रूप से और बिना अतिशयोक्ति के।', section:'अतिरिक्त अनुभाग', item:'अतिरिक्त विवरण' },
    'roman urdu': { medium:'Takhleeqi Shoba', description:'Main ye kaam sirf un tafseelat ki bunyaad par pesh karti hoon jo maine khud di hain, saaf, diyanatdar aur professional andaz mein.', project:'Main ye project sirf apni di hui maloomat ki bunyaad par pesh karti hoon, saaf andaz mein aur bina mubalghe ke.', section:'Izafi Hissa', item:'Izafi Tafseel' },
  };
  return (text[family] && text[family][kind]) || text.english[kind] || '';
}

function strictLocalizeFallback(value = '', targetLanguage = 'English', kind = 'description') {
  const original = cleanText(value);
  const localized = cleanText(localizeBasicTextFallback(original, targetLanguage));
  const family = languageFamily(normalizeServerOutputLanguage(targetLanguage));
  if (!original) return '';

  // A heading/label must never be swapped for a generic sentence: dictionary -> basic
  // localization -> the original label. Losing a heading is worse than not translating it.
  if (kind === 'label') {
    const known = localizedSectionName(original, targetLanguage);
    if (known) return known;
    if (localized && !sameCleanText(localized, original) && !leaksLatinForTarget(localized, targetLanguage)) return localized;
    return original;
  }

// FactLock applies to fallbacks too. localizeBasicTextFallback deliberately has no phrase
  // dictionaries, so `localized` is (by construction) identical to `original` for every
  // non-English target. The old code demanded that the localized text DIFFER from the original
  // before accepting it — impossible by construction — so EVERY field the AI did not reach was
  // replaced by genericLocalizedText() filler ("Detalle adicional", "اضافی تفصیل", ...).
  // That silently destroyed real user data: certification names, degree details, dates.
  // A true fact in the wrong language beats a fabricated sentence in the right one.
  // Real translation is the AI's job (translateTextStrict, with retry); this fallback's only
  // job is to never lose data. Generic filler is never a substitute for non-empty user text.
  return localized || original;
}

function hasUnexpectedScriptForLanguage(value = '', targetLanguage = 'English') {
  const text = String(value || '');
  const family = languageFamily(targetLanguage);
  if (!cleanText(text)) return false;
  if (leaksLatinForTarget(text, targetLanguage)) return true;
  if (family === 'english') return looksRomanUrdu(text) || containsArabicScript(text) || containsDevanagari(text) || containsCJK(text) || hasCyrillic(text) || containsBengali(text) || containsTamil(text) || containsTelugu(text) || containsThai(text);
  if (family === 'roman urdu') return containsArabicScript(text) || containsDevanagari(text) || containsCJK(text) || hasCyrillic(text) || containsBengali(text) || containsTamil(text) || containsTelugu(text) || containsThai(text);
  if (['spanish','french','german','italian','portuguese','dutch','turkish','malay','indonesian','filipino','swahili','polish','vietnamese'].includes(family)) {
    return looksRomanUrdu(text) || containsArabicScript(text) || containsDevanagari(text) || containsCJK(text) || hasCyrillic(text) || containsBengali(text) || containsTamil(text) || containsTelugu(text) || containsThai(text);
  }
  if (family === 'russian') return containsArabicScript(text) || containsDevanagari(text) || containsCJK(text);
  if (family === 'greek') return containsArabicScript(text) || containsDevanagari(text) || containsCJK(text) || hasCyrillic(text);
  if (family === 'urdu') {
    // Arabic prose answered to an Urdu request is a silent, invisible failure. Catch it.
    if (arabicScriptFlavour(text) === 'arabic') return true;
    return hasCyrillic(text) || containsDevanagari(text) || containsCJK(text);
  }
  if (family === 'arabic') {
    if (arabicScriptFlavour(text) === 'urdu') return true;
    return hasCyrillic(text) || containsDevanagari(text) || containsCJK(text);
  }
  if (['persian','pashto','sindhi'].includes(family)) return hasCyrillic(text) || containsDevanagari(text) || containsCJK(text);
  if (family === 'hindi') return containsArabicScript(text) || hasCyrillic(text) || containsCJK(text);
  if (family === 'bengali') return containsArabicScript(text) || hasCyrillic(text) || containsDevanagari(text) || containsCJK(text);
  if (family === 'punjabi') return containsArabicScript(text) || hasCyrillic(text) || containsDevanagari(text) || containsCJK(text);
  if (family === 'tamil') return containsArabicScript(text) || hasCyrillic(text) || containsDevanagari(text) || containsCJK(text);
  if (family === 'telugu') return containsArabicScript(text) || hasCyrillic(text) || containsDevanagari(text) || containsCJK(text);
  if (family === 'thai') return containsArabicScript(text) || hasCyrillic(text) || containsDevanagari(text) || containsCJK(text);
  if (['chinese','japanese','korean'].includes(family)) return containsArabicScript(text) || hasCyrillic(text) || containsDevanagari(text);
  return false;
}

function languageFamily(language = 'English') {
  const lang = cleanText(language).toLowerCase();
  // RTL / Arabic-script group
  if (lang === 'arabic') return 'arabic';
  if (lang === 'urdu') return 'urdu';
  if (lang === 'persian') return 'persian';
  if (lang === 'pashto') return 'pashto';
  if (lang === 'sindhi') return 'sindhi';
  // Devanagari group
  if (lang === 'hindi') return 'hindi';
  // Bengali script
  if (lang === 'bengali') return 'bengali';
  // Punjabi (Gurmukhi script)
  if (lang === 'punjabi') return 'punjabi';
  // Tamil script
  if (lang === 'tamil') return 'tamil';
  // Telugu script
  if (lang === 'telugu') return 'telugu';
  // CJK group
  if (lang === 'chinese') return 'chinese';
  if (lang === 'japanese') return 'japanese';
  if (lang === 'korean') return 'korean';
  // Cyrillic
  if (lang === 'russian') return 'russian';
  // Thai
  if (lang === 'thai') return 'thai';
  // Roman-script non-English
  if (lang === 'roman urdu') return 'roman urdu';
  if (lang === 'french') return 'french';
  if (lang === 'spanish') return 'spanish';
  if (lang === 'german') return 'german';
  if (lang === 'italian') return 'italian';
  if (lang === 'portuguese') return 'portuguese';
  if (lang === 'dutch') return 'dutch';
  if (lang === 'turkish') return 'turkish';
  if (lang === 'malay') return 'malay';
  if (lang === 'indonesian') return 'indonesian';
  if (lang === 'vietnamese') return 'vietnamese';
  if (lang === 'filipino') return 'filipino';
  if (lang === 'swahili') return 'swahili';
  if (lang === 'greek') return 'greek';
  if (lang === 'polish') return 'polish';
  return lang || 'english';
}

function safeLocalizedValue(candidate = '', fallback = '', targetLanguage = 'English', kind = 'description') {
  const text = cleanText(candidate);
  const fb = cleanText(fallback);
  const family = languageFamily(targetLanguage);
  if (!text) return strictLocalizeFallback(fb, targetLanguage, kind);
  if (hasCyrillic(text) && !['russian', 'ukrainian'].includes(family)) return strictLocalizeFallback(fb || text, targetLanguage, kind);
  if (hasUnexpectedScriptForLanguage(text, targetLanguage)) return strictLocalizeFallback(fb || text, targetLanguage, kind);
  if (looksLikeWrongEnglishForTarget(text, targetLanguage) && fb && !looksLikeWrongEnglishForTarget(fb, targetLanguage)) return fb;
  if (looksLikeWrongEnglishForTarget(text, targetLanguage)) return strictLocalizeFallback(fb || text, targetLanguage, kind);
  return text;
}

function sameCleanText(a = '', b = '') {
  return cleanText(a).toLowerCase() === cleanText(b).toLowerCase();
}

function localizeBasicTextFallback(value = '', targetLanguage = 'English') {
  const original = cleanText(value);
  if (!original) return '';

  const family = languageFamily(normalizeServerOutputLanguage(targetLanguage));

  // Do not use project-specific phrase dictionaries here. This fallback is deliberately
  // generic so MuseForge does not accidentally turn one user's text into another user's
  // song, dance, drama, award, or demo scenario. Real translation is handled by
  // translateTextStrict()/the configured AI provider. If AI is unavailable, this function
  // preserves the user's facts instead of fabricating a translation.
  if (family === 'english' || family === 'roman urdu') return original;

  // For non-English output without AI, strictLocalizeFallback may choose a generic
  // language-safe placeholder. Returning the original here keeps this function factual.
  return original;
}

function stripRegenerateNoiseServer(value = '') {
  let text = stripPortfolioMarkdownHeadingServer(value || '');
  text = text
    .replace(/^item\s*title\s*:\s*[\s\S]{0,180}?\b(?:text|description|original\s+user\s+text)\s*:\s*/i, '')
    .replace(/^(enhanced|description|text|answer|output)\s*:\s*/i, '')
    .replace(/^['\"]|['\"]$/g, '')
    .trim();
  text = text
    .replace(/^\{\s*\"enhanced\"\s*:\s*\"/i, '')
    .replace(/\"\s*\}\s*$/i, '')
    .replace(/\bRegenerate this item only\.?$/i, '')
    .trim();
  return cleanText(text);
}

function regenerationWordCount(value = '') {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function regenerationSentenceCount(value = '') {
  return (String(value || '').match(/[.!?۔؟]+/g) || []).length;
}

function regenerationLooksPromptEcho(value = '') {
  const text = String(value || '').trim();
  return /item\s*title\s*:|original\s+user\s+text\s*:|regenerate\s+this\s+item|output\s+only\s+valid\s+json|creator\s+type\s*:|medium\/field\s*:|^\s*I\s+(included|added)\b|^\s*This\s+(entry|project)\b|^\s*The\s+creator\b|based\s+on\s+the\s+original\s+note/i.test(text);
}

function unicodeWordBoundaryPattern(words = []) {
  const escaped = words.map(word => String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp('(^|[^\\p{L}\\p{N}_])(' + escaped + ')(?=$|[^\\p{L}\\p{N}_])', 'iu');
}

function regenerationUsesFirstPerson(value = '', targetLanguage = 'English') {
  const text = String(value || '').trim();
  const family = languageFamily(targetLanguage || 'English');
  if (!text) return false;

  const latinPatterns = {
    english: ['i','my','me','mine','myself'],
    spanish: ['yo','mi','mis','me','mío','mía','conmigo','soy','estoy','tengo','hago','hice','quiero','puedo','presento','creo','utilizo','mantengo','busco','presenté'],
    french: ['je','j’','j\'','mon','ma','mes','moi','me'],
    german: ['ich','mein','meine','meinen','mir','mich'],
    italian: ['io','mio','mia','miei','mie','mi','me','sono','ho','faccio','voglio','posso','presento','scrivo','creo'],
    portuguese: ['eu','meu','minha','meus','minhas','me','mim','sou','estou','tenho','fiz','quero','posso','apresento','crio','mantenho','escrevo','forneci','criei','escrevi'],
    dutch: ['ik','mijn','me','mij'],
    polish: ['ja','mój','moja','moje','moim','mnie','mi','swoje','swój','swoją','jestem','mam','przedstawiam','tworzę','pracuję','chcę','mogę','buduję','piszę','projektuję'],
    turkish: ['ben','benim','bana','beni','kendim'],
    indonesian: ['saya','aku'],
    vietnamese: ['tôi','mình'],
  };

  // Spanish, Italian, Portuguese, Polish and Turkish are pro-drop: a perfectly good first-person
  // sentence ("Presento este trabajo...", "Zbudowałam tę pracę...") contains NO pronoun at all,
  // and the person is carried by the VERB ending. Matching only pronouns marked all of that prose
  // as third person and quietly pushed those five languages onto the fallback draft every time.
  const verbMorphology = {
    // -é / -í are first-person preterite endings (third person is -ó / -ió), minus common adverbs.
    spanish: /(^|[^\p{L}])(?!aquí|allí|ahí|así|sí)\p{L}{3,}(?:é|í)(?=$|[^\p{L}])/iu,
    // -avo/-evo/-ivo imperfect, -ai/-ei remote past, all first-person singular.
    italian: /(^|[^\p{L}])\p{L}{3,}(?:avo|evo|ivo|ai|ei)(?=$|[^\p{L}])/iu,
    // -ei / -i first-person preterite (forneci, criei, escrevi).
    portuguese: /(^|[^\p{L}])\p{L}{4,}(?:ei)(?=$|[^\p{L}])/iu,
    // -łam / -łem is the unambiguous first-person past (masculine and feminine).
    polish: /(^|[^\p{L}])\p{L}{3,}(?:łam|łem)(?=$|[^\p{L}])/iu,
    // -yorum (present), -dım/-dim/-dum/-düm and -tım/-tim/-tum/-tüm (past), -acağım/-eceğim (future).
    turkish: /(^|[^\p{L}])\p{L}{2,}(?:yorum|dım|dim|dum|düm|tım|tim|tum|tüm|acağım|eceğim|arım|erim|ırım|irim)(?=$|[^\p{L}])/iu,
  };

  if (latinPatterns[family]) {
    if (unicodeWordBoundaryPattern(latinPatterns[family]).test(text)) return true;
    if (verbMorphology[family] && verbMorphology[family].test(text)) return true;
    return false;
  }

  // Non-Latin languages: do not use \b. JavaScript \b is ASCII-biased and gives bad
  // results for CJK, Arabic, Cyrillic, etc.
  if (family === 'arabic') return /أنا|عملي|أعمالي|لي|أنني|قمت|أعمل|أقدّم|أقدم|أصمم|أكتب|أبني|أشارك|بنيت|أردت|قدمتها|قدمت/.test(text);
  if (family === 'urdu') return /میں|میرا|میری|میرے|مجھے|اپنے|اپنی|اپنا|ہوں|کرتی|کرتا|رہی|رہا/.test(text);
  if (family === 'chinese') return /我|我的|本人/.test(text);
  if (family === 'japanese') return /私|僕|自分|わたし|私の/.test(text);
  if (family === 'korean') return /나|저|내|제|제가|나는|저는|저의/.test(text);
  if (family === 'russian') return /(^|[^А-Яа-яЁё])(?:я|мой|моя|моё|мои|меня|мне|мной|свой|свою|свои)(?=$|[^А-Яа-яЁё])/i.test(text);

  return true;
}

function normalizeGroundingText(value = '') {
  return cleanText(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function importantOriginalAnchors(value = '') {
  const stop = new Set([
    'the','and','for','with','that','this','from','into','have','has','had','was','were','are','you','your','their','our','but','not','can','will','about','project','projects','work','works','use','used','using','create','created','make','made','build','built','a','an','of','to','in','on','by','is','it','i','my','me','ma','mai','main','mene','maine','na','ne','ka','ki','ky','ke','ko','se','sy','ha','hai','hain','tha','thee','bht','bohat','aur','or','r','par','liya','liye','liay','liyay','kya','kiya','kr','kar','kro','show','entry','portfolio','section'
  ]);
  const tokens = (normalizeGroundingText(value).match(/[a-z0-9][a-z0-9+#.-]*/g) || []).map(token => token.replace(/^[.-]+|[.-]+$/g, '')).filter(Boolean);
  const unique = [];
  for (const token of tokens) {
    if (stop.has(token)) continue;
    if (token.length < 3 && !/\d/.test(token)) continue;
    if (!unique.includes(token)) unique.push(token);
  }
  return unique.slice(0, 10);
}

function numbersFromText(value = '') {
  return cleanText(value).match(/\b\d+(?:\.\d+)?\+?\b/g) || [];
}

function cleanSectionDisplayTitle(title = '') {
  const raw = cleanText(title || '');
  if (!raw) return 'this portfolio entry';
  const withoutPrefix = raw
    .replace(/^.*?\s+[—–-]\s+/, '')
    .replace(/^(achievements?|certifications?|projects?|experience|portfolio|custom section)\s*[:\-—–]\s*/i, '')
    .trim();
  return withoutPrefix || raw || 'this portfolio entry';
}

function chooseGroundedVerb(original = '', title = '') {
  const lower = normalizeGroundingText(original + ' ' + title);
  const checks = [
    { re: /\b(write|wrote|written|likha|likhe|article|blog|story|poem|lyrics|songs?)\b/i, verb: 'wrote' },
    { re: /\b(design|designed|poster|posters|graphics?|layout|branding|flyer|content design|social media posts? design)\b/i, verb: 'designed' },
    { re: /\b(build|built|develop|developed|code|coded|app|website|web|react|node|python|software)\b/i, verb: 'built' },
    { re: /\b(perform|performed|performance|present|presented|speak|spoke)\b/i, verb: 'performed' },
    { re: /\b(release|released|publish|published|upload|uploaded|share|shared)\b/i, verb: 'shared' },
    { re: /\b(draw|drawing|paint|painting|sketch|illustration|visual|art|artwork|banaya|banai|bnaya|bnai)\b/i, verb: 'created' },
    { re: /\b(win|won|jeet|jeeti|certificate|certification|competition|award|achievement|completed)\b/i, verb: 'completed' },
  ];
  return (checks.find(item => item.re.test(lower)) || { verb: 'worked on' }).verb;
}

function buildLocalStrongProjectRegeneration(options = {}) {
  const native = nativeLocalDraft('project', options.targetLanguage || 'English', options);
  if (native) return native;
  const rawTitle = cleanText(options.title || '') || 'this portfolio entry';
  const original = cleanText(options.originalDesc || '');
  const displayTitle = cleanSectionDisplayTitle(rawTitle);
  const anchors = importantOriginalAnchors(original);
  const numbers = numbersFromText(original);
  const verb = chooseGroundedVerb(original, displayTitle);
  const numberText = numbers.length ? numbers.join(', ') + ' ' : '';
  const anchorText = anchors.length ? anchors.slice(0, 6).join(', ') : displayTitle;
  // The template around it is English, so quoting the original verbatim would drop Urdu / Chinese /
  // Arabic prose into an English sentence whenever the AI is unavailable. The facts that matter
  // (numbers, anchors, title) are already carried above, so a foreign-script original is summarised
  // rather than quoted. Language of the output always wins over echoing the source.
  const factSentence = quotableOriginal(original)
    ? 'I keep the core details from my original note: ' + original.replace(/[.]+$/g, '') + '.'
    : 'I keep this entry grounded in the information I provided.';

  return [
    'I ' + verb + ' ' + numberText + displayTitle + ' with a clear focus on ' + anchorText + '.',
    factSentence,
    'I use this portfolio entry to explain the real work more clearly, show the effort behind it, and present it in a stronger professional voice without changing the subject or adding unsupported details.'
  ].join(' ');
}

function candidateChangesOriginalFacts(original = '', candidate = '', options = {}) {
  const originalClean = cleanText(original);
  const candidateClean = cleanText(candidate);
  const family = languageFamily(options.targetLanguage || 'English');
  if (!originalClean || !candidateClean) return false;

  const sourceNumbers = numbersFromText(originalClean);
  for (const number of sourceNumbers) {
    if (!candidateClean.includes(number)) return true;
  }

  // A number that appears in the candidate but NOT in the original is a fabricated metric
  // (e.g. "used by 5000 users", "won 3 awards"). This is script-agnostic, so it guards
  // every language. FactLock treats any invented number as an unsupported claim.
  const candidateNumbers = numbersFromText(candidateClean);
  for (const number of candidateNumbers) {
    if (!originalClean.includes(number)) return true;
  }

  // Anchor/domain comparison is reliable mainly for English/Roman-source and Latin output.
  // For CJK/Arabic/Russian outputs, numbers and prompt constraints remain the hard safety gate.
  if (['arabic','chinese','japanese','korean','russian'].includes(family)) return false;

  const source = normalizeGroundingText(originalClean + ' ' + (options.title || '') + ' ' + (options.medium || ''));
  const output = normalizeGroundingText(candidateClean);
  const anchors = importantOriginalAnchors(originalClean);
  if (anchors.length >= 2) {
    const kept = anchors.filter(anchor => output.includes(anchor));
    if (kept.length < Math.min(2, anchors.length)) return true;
  }

  const protectedDomains = [
    'music','song','songs','track','tracks','audio','lyrics','performance','perform',
    'design','posts','poster','graphic','branding','flyer','layout',
    'code','coding','website','app','react','node','python','software','developer',
    'painting','drawing','art','artwork','sketch','illustration','flower','flowers',
    'certificate','certification','competition','award','university','school',
    'photo','photography','video','blog','article','story','poem',
    'client','clients','sales','revenue','published','viral','ranked','winner'
  ];
  for (const term of protectedDomains) {
    const termPattern = new RegExp('(^|[^a-z0-9])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^a-z0-9])', 'i');
    if (termPattern.test(output) && !termPattern.test(source)) return true;
  }

  return false;
}

function regenerationAddsValue(original = '', candidate = '', options = {}) {
  const family = languageFamily(options.targetLanguage || 'English');
  if (['chinese','japanese','korean','arabic','russian'].includes(family)) {
    return cleanText(candidate).length >= Math.max(70, cleanText(original).length + 30);
  }
  const originalWords = regenerationWordCount(original);
  const candidateWords = regenerationWordCount(candidate);
  return candidateWords >= Math.max(24, Math.ceil(originalWords * 1.5));
}

// Fabricated-credential words. Deliberately excludes every word the local fallback templates use,
// so a safe local draft can never be mistaken for a fabrication and rejected in a loop.
const UNSUPPORTED_CLAIM_TERMS = [
  'award', 'awards', 'winner', 'won', 'prize', 'medal', 'trophy', 'champion', 'nominated',
  'client', 'clients', 'customer', 'customers', 'revenue', 'sales', 'profit', 'funding', 'funded',
  'investor', 'investors', 'published', 'viral', 'trending', 'ranked', 'featured', 'exhibited',
  'exhibition', 'bestselling', 'certified', 'patent', 'scholarship', 'grant',
  'users', 'downloads', 'followers', 'subscribers', 'streams', 'views',
  'million', 'thousand', 'billion',
];

// Unsupported-claim detection that applies to EVERY regenerated field. The full
// candidateChangesOriginalFacts check is too strict for a bio (a bio legitimately reframes rather
// than repeats), but a bio must still never invent a metric or a credential. Previously the fact
// check only ran for project items, so a model could put "5000 users" or "award-winning" straight
// into the bio and it would sail through untouched.
function candidateInventsUnsupportedClaims(original = '', candidate = '', options = {}) {
  const originalClean = cleanText(original);
  const candidateClean = cleanText(candidate);
  if (!originalClean || !candidateClean) return false;

  // 1) Any number in the output that is not in the source. Script-agnostic: guards all 15 languages.
  for (const number of numbersFromText(candidateClean)) {
    if (!originalClean.includes(number)) return true;
  }

  // 2) Credential words that appear in the output but nowhere in the source. The source includes
  //    the title and medium, so a project actually called "Award Poster" is not falsely flagged.
  const source = normalizeGroundingText(`${originalClean} ${options.title || ''} ${options.medium || ''}`);
  const output = normalizeGroundingText(candidateClean);
  for (const term of UNSUPPORTED_CLAIM_TERMS) {
    const pattern = new RegExp('(^|[^a-z0-9])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^a-z0-9])', 'i');
    if (pattern.test(output) && !pattern.test(source)) return true;
  }
  return false;
}

function regenerationIsStrongEnough(value = '', options = {}) {
  const clean = cleanText(value);
  if (!clean) return false;
  if (regenerationLooksPromptEcho(clean)) return false;
  if (hasUnexpectedScriptForLanguage(clean, options.targetLanguage || 'English')) return false;
  if (!regenerationUsesFirstPerson(clean, options.targetLanguage || 'English')) return false;

  // FactLock applies to bio and statement as well as projects.
  if (candidateInventsUnsupportedClaims(options.originalDesc || '', clean, options)) return false;

  if (options.isProject) {
    if (candidateChangesOriginalFacts(options.originalDesc || '', clean, options)) return false;
    if (!regenerationAddsValue(options.originalDesc || '', clean, options)) return false;
  }

  const family = languageFamily(options.targetLanguage || 'English');
  const wordCount = regenerationWordCount(clean);
  const sentenceCount = regenerationSentenceCount(clean);
  const charCount = clean.length;
  const compactScript = ['chinese', 'japanese', 'korean', 'arabic', 'urdu', 'russian'].includes(family);

  if (options.isBio) return compactScript ? charCount >= 180 : wordCount >= 55 && sentenceCount >= 4;
  if (options.isStatement) return compactScript ? charCount >= 150 : wordCount >= 45 && sentenceCount >= 3;
  if (options.isProject) return compactScript ? charCount >= 90 : wordCount >= 28 && sentenceCount >= 2;
  return compactScript ? charCount >= 80 : wordCount >= 18;
}

// Translating PROSE. The source is always first person (the local drafts are written that way),
// so the translation must be too. A model that quietly flips "I built this" into "the creator
// built this" would put third-person text into the portfolio through the back door — which is
// exactly what used to happen to the bio and the statement.
async function translateProseStrict(text = '', targetLanguage = 'English') {
  const clean = cleanText(text);
  if (!clean) return '';
  if (languageFamily(targetLanguage) === 'english') return clean;

  const translated = cleanText(await translateTextStrict(clean, targetLanguage));
  if (!translated) return clean;
  if (!regenerationUsesFirstPerson(translated, targetLanguage)) {
    console.warn('Translation dropped first person; safe localized draft used instead.');
    return cleanText(strictLocalizeFallback(clean, targetLanguage, 'description')) || translated;
  }
  return translated;
}

async function translateOrLocalRegeneration(text = '', targetLanguage = 'English') {
  const clean = cleanText(text);
  if (!clean) return '';
  if (languageFamily(targetLanguage) === 'english') return clean;

  const translated = cleanText(await translateProseStrict(clean, targetLanguage));
  if (!translated) return clean;

  // The safe local draft is fact-clean by construction, so the translation of it must be too.
  // Without this, a misbehaving model could smuggle an invented metric back in at the very last
  // step — after FactLock had already rejected its first attempt.
  if (candidateInventsUnsupportedClaims(clean, translated, { targetLanguage })) {
    console.warn('Translation of the local draft introduced unsupported facts; using a safe localized draft.');
    return cleanText(strictLocalizeFallback(clean, targetLanguage, 'description')) || clean;
  }
  return translated;
}

app.post('/factlock/regenerate', aiLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const id = body.id;
    const title = body.title;
    const originalDesc = body.originalDesc;
    const targetLanguage = body.targetLanguage || 'English';
    const creatorType = body.creatorType || 'creator';
    const medium = body.medium || '';
    const aiTone = body.aiTone || 'Professional';
    const name = body.name || '';
    const itemKind = body.itemKind || 'project';

    const cleanOriginal = cleanText(originalDesc);
    const cleanTitle = cleanText(title || 'Portfolio item');
    const kind = cleanText(itemKind).toLowerCase();
    const idTitle = String(id || '') + ' ' + cleanTitle;

    const isBio = kind === 'bio' || /meta:bio|\bbio\b|portfolio profile/i.test(idTitle);
    const isStatement = kind === 'statement' || /meta:statement|statement|portfolio voice/i.test(idTitle);
    const isProject = !isBio && !isStatement;

    if (!cleanOriginal) {
      return res.status(400).json({ error: 'Original description is required for regeneration.' });
    }

    const localFallbackBase = isBio
      ? buildLocalDistinctBio({ name, medium, description: cleanOriginal, creatorType, targetLanguage })
      : isStatement
        ? buildLocalDistinctStatementStrong({ medium, description: cleanOriginal, creatorType, targetLanguage })
        : buildLocalStrongProjectRegeneration({ title: cleanTitle, originalDesc: cleanOriginal, medium, creatorType, targetLanguage });

    let enhancedDesc = '';

    if (aiAvailable()) {
      try {
        const systemInstruction = isBio
          ? [
              'You are MuseForge strict portfolio BIO regenerator.',
              languageStrictInstruction(targetLanguage),
              toneInstruction(aiTone),
              'Return only valid JSON: {"enhanced":"..."}',
              'Write a strong 5-6 sentence bio, around 90-130 words.',
              'Bio means profile/introduction: who the creator is, field, visible interests, style, credibility, and opportunity-ready presentation.',
              'Write the whole bio in FIRST PERSON. Every paragraph must clearly use I, my, or me (or the equivalent in the target language). Never write in third person, and never refer to the creator by name in the third person.',
              'Do not write an artist statement.',
              'Use only supplied facts. Never invent awards, clients, tools, years, metrics, exhibitions, degrees, jobs, or achievements.'
            ].join('\n')
          : isStatement
            ? [
                'You are MuseForge strict ARTIST STATEMENT regenerator.',
                languageStrictInstruction(targetLanguage),
                toneInstruction(aiTone),
                'Return only valid JSON: {"enhanced":"..."}',
                'Write exactly 2 short first-person paragraphs, around 80-120 words total. Every paragraph must clearly use I, my, or me.',
                'Statement means purpose, values, process, creative direction, and what guides the work.',
                'Do not write a bio. Do not reintroduce the person. Do not return a single weak sentence.',
                'Use only supplied facts. Never invent awards, clients, tools, years, metrics, exhibitions, jobs, or achievements.'
              ].join('\n')
            : [
                'You are FactLock AI, a strict portfolio project-description regenerator.',
                languageStrictInstruction(targetLanguage),
                toneInstruction(aiTone),
                'Return only valid JSON: {"enhanced":"..."}',
                'Write 2-3 polished first-person portfolio sentences, around 45-75 words total. Use I, my, or me clearly. Start naturally and directly; never start with I included or I added this achievement.',
                'Do not output labels like Item title or Text. Do not write in third person. Do not say the creator, this entry, or this project presents. Do not start with I included or I added this achievement. Start directly with the real action, such as I released, I performed, I wrote, I created, or I took part.',
                'If the original is messy Roman Urdu or mixed language, translate the meaning into the target output language.',
                'Make the description stronger than the original, but preserve meaning 100%. Do not change the subject, field, domain, category, task, object, number, or result described in the original text.',
                'Never add unsupported achievements, awards, dates, numbers, tools, metrics, clients, platforms, popularity, outcomes, or facts. If the original is vague, keep it vague but polished.'
              ].join('\n');

        const aiText = await generateAiText({
          temperature: isBio || isStatement ? 0.28 : 0.18,
          maxTokens: isBio || isStatement ? 850 : 600,
          messages: [
            { role: 'system', content: systemInstruction },
            {
              role: 'user',
              content: [
                'Name: ' + cleanText(name),
                'Creator type: ' + cleanText(creatorType),
                'Medium/field: ' + cleanText(medium),
                'Item title: ' + cleanTitle,
                'Original user text: ' + cleanOriginal,
                '',
                'Regenerate this item only.'
              ].join('\n'),
            },
          ],
        });

        try {
          const parsed = parseJsonObject(aiText || '');
          enhancedDesc = stripRegenerateNoiseServer(parsed.enhanced || '');
        } catch (_) {
          enhancedDesc = stripRegenerateNoiseServer(aiText || '');
        }
      } catch (error) {
        console.warn('FactLock AI regeneration failed; using strong local fallback:', error.message);
      }
    }

    if (!regenerationIsStrongEnough(enhancedDesc, { isBio, isStatement, isProject, targetLanguage, originalDesc: cleanOriginal, title: cleanTitle, medium }) || sameCleanText(enhancedDesc, cleanOriginal)) {
      enhancedDesc = await translateOrLocalRegeneration(localFallbackBase, targetLanguage);
    }

    enhancedDesc = stripRegenerateNoiseServer(enhancedDesc);

    const review = buildFactLockReview(
      { id: cleanText(id) || 'regenerated', title: cleanTitle, desc: cleanOriginal },
      enhancedDesc
    );

    return res.json({ ...review, desc: enhancedDesc, enhancedDesc, status: 'pending' });
  } catch (error) {
    console.error('FactLock regeneration failed:', error);
    return res.status(500).json({ error: 'Could not regenerate this FactLock item.' });
  }
});

// Build the structured, in-language version of the portfolio that the frontend renders
// (separate from the markdown `portfolio` string). This was referenced by /generate but
// never defined, which threw a ReferenceError on EVERY generation and killed the endpoint
// before it could return. Headings/labels/titles AND body text are localized here.
//
// - bio / statement / descriptions arrive already enhanced (and, on the AI path, already
//   in-language); they are only re-translated if they fail the target-script check, so a
//   strong enhanced description is never thrown away.
// - section names, item headings, project titles and the medium are structural labels that
//   the enhancement step does NOT localize, so they are translated here.
// - skills are kept verbatim (tech tokens like "React"/"C++" stay in Latin by convention).
// - proper names are preserved.
// Without a configured AI provider, translateTextStrict falls back to a safe localized
// placeholder; with a provider the translations are real. The function never throws.
async function buildLocalizedOutput({
  targetLanguage = 'English',
  artistBio = '',
  artistStatement = '',
  projects = [],
  customSections = [],
  skills = [],
  name = '',
  medium = '',
  description = '',
} = {}) {
  const lang = normalizeServerOutputLanguage(targetLanguage);
  const labels = labelsForLanguage(lang);
  const isEnglish = lang === 'English';

  // Translate a short structural label/heading/title (always localized for non-English).
  // Dictionary first (instant, deterministic, works with no AI provider), model only for
  // genuinely custom names, and the ORIGINAL text as the last resort — never a generic paragraph.
  const localizeLabel = async (value, kind = 'label') => {
    const clean = cleanText(value);
    if (!clean || isEnglish) return clean;
    const known = kind === 'medium'
      ? (localizedMediumName(clean, lang) || localizedSectionName(clean, lang))
      : localizedSectionName(clean, lang);
    if (known) return known;
    try { return cleanText(await translateLabelStrict(clean, lang)) || clean; }
    catch (_) { return clean; }
  };

  // Keep already-localized body text; only translate if it is NOT in the target script.
  const ensureInLanguage = async (value) => {
    const clean = cleanText(value);
    if (!clean || isEnglish) return clean;
    if (hasRequiredScript(clean, lang) && !looksLikeWrongEnglishForTarget(clean, lang)) return clean;
    try {
      const translated = cleanText(await translateTextStrict(clean, lang));
      if (!translated) return clean;
      // The source was first person, so the translation must be too. If the model flipped it into
      // third person, fall back to the safe localized draft — which is written in first person.
      if (!regenerationUsesFirstPerson(translated, lang)) {
        return cleanText(strictLocalizeFallback(clean, lang, 'description')) || translated;
      }
      return translated;
    } catch (_) { return clean; }
  };

  const localizedName = transliterateLatinName(name, lang);
  const localizedMedium = await localizeLabel(medium, 'medium');
  const bio = await ensureInLanguage(artistBio);
  const statement = await ensureInLanguage(artistStatement);

  const localizedProjects = [];
  for (const project of (Array.isArray(projects) ? projects : [])) {
    if (!project) continue;
    localizedProjects.push({
      id: cleanText(project.id) || `project-${localizedProjects.length + 1}`,
      title: await localizeLabel(project.title),
      desc: await ensureInLanguage(project.desc),
      link: cleanText(project.link) || null,
      media: project.media || null,
    });
  }

  const localizedSections = [];
  for (const section of (Array.isArray(customSections) ? customSections : [])) {
    if (!section) continue;
    const items = [];
    for (const item of (Array.isArray(section.items) ? section.items : [])) {
      if (!item) continue;
      items.push({
        id: cleanText(item.id) || `item-${items.length + 1}`,
        heading: await localizeLabel(item.heading),
        desc: await ensureInLanguage(item.desc),
        link: cleanText(item.link) || null,
        media: item.media || null,
      });
    }
    localizedSections.push({
      id: cleanText(section.id) || `section-${localizedSections.length + 1}`,
      name: await localizeLabel(section.name),
      items,
    });
  }

  // Skills stay verbatim: mistranslating tech tokens is worse than leaving them in English.
  const localizedSkills = (Array.isArray(skills) ? skills : [])
    .map(skill => cleanText(skill))
    .filter(Boolean);

  return {
    language: lang,
    labels,
    name: localizedName,
    medium: localizedMedium,
    bio,
    description: bio,
    artistBio: bio,
    artistStatement: statement,
    statement,
    projects: localizedProjects,
    customSections: localizedSections,
    skills: localizedSkills,
  };
}

// ===========================================================================
// PASTE THIS WHOLE BLOCK INTO server.js
// Put it on the line just ABOVE:   app.post('/generate', aiLimiter, ...
// (anywhere among your other app.post routes works, but above /generate is easy to find)
//
// It adds the missing /suggest-projects route that your App.js "AI Suggestions"
// button calls. It uses your existing IBM Granite dispatch (generateAiText) and
// falls back to your built-in suggestions on ANY failure, so the button never dies.
// It writes in the creator's chosen language and does not invent facts (FactLock-aligned).
// ===========================================================================

// Safe, read-only IBM status probe (booleans + public config only; never secrets).
require('./ibm-status').registerIbmStatus(app, {
  watsonxConfigured,
  watsonxModel: WATSONX_MODEL,
  watsonxStrict: WATSONX_STRICT,
  doclingUrl: DOCLING_URL,
  doclingProbeTimeoutMs: 2500,
});

app.post('/portfolio/share', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name && !body.portfolio) {
      return res.status(400).json({ error: 'Nothing to share yet.' });
    }
    const id = crypto.randomBytes(9).toString('hex');
    const items = readPublicPortfolios();
    items.unshift({ id, createdAt: new Date().toISOString(), data: body });
    writePublicPortfolios(items.slice(0, 500));
    return res.json({ publicPath: `/portfolio/${id}`, id });
  } catch (error) {
    console.error('portfolio/share failed:', error.message);
    return res.status(500).json({ error: 'Could not publish this portfolio.' });
  }
});
 
app.get('/portfolio/:id', (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid portfolio id.' });
    }
    const found = readPublicPortfolios().find(item => item && item.id === id);
    if (!found) return res.status(404).json({ error: 'Portfolio not found.' });
    return res.json(found.data || {});
  } catch (error) {
    console.error('portfolio GET failed:', error.message);
    return res.status(500).json({ error: 'Could not load this portfolio.' });
  }
});
 

app.post('/suggest-projects', aiLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const name = cleanText(body.name || '');
    const medium = cleanText(body.medium || '');
    const description = cleanText(body.description || '');
    const targetLanguage = cleanText(body.targetLanguage || 'English') || 'English';
    const existing = Array.isArray(body.projects)
      ? body.projects.map(p => cleanText(p && p.title)).filter(Boolean)
      : [];

    try {
      const existingLine = existing.length
        ? `The creator already has these projects (do not repeat them): ${existing.join('; ')}.`
        : '';
      const aiText = await generateAiText({
        messages: [
          {
            role: 'system',
            content:
              'You suggest portfolio project ideas for a creative professional. ' +
              'Return ONLY valid JSON in this exact shape: ' +
              '{"suggestions":[{"title":"","desc":""},{"title":"","desc":""},{"title":"","desc":""}]}. ' +
              'Provide exactly 3 suggestions. Each "title" is short (2-5 words). Each "desc" is one or two ' +
              'sentences telling the creator what to include. Write everything in ' + targetLanguage + '. ' +
              'Do not invent facts about the creator; only propose ideas they could build. No text outside the JSON.',
          },
          {
            role: 'user',
            content:
              'Creator name: ' + (name || 'A creator') + '\n' +
              'Medium / field: ' + (medium || 'general creative work') + '\n' +
              'About them: ' + (description || '(not provided)') + '\n' +
              existingLine,
          },
        ],
        temperature: 0.4,
        maxTokens: 600,
      });

      const parsed = parseJsonObject(aiText);
      const suggestions = Array.isArray(parsed && parsed.suggestions) ? parsed.suggestions : [];
      const cleanSuggestions = suggestions
        .map(s => ({ title: cleanText(s && s.title), desc: cleanText(s && s.desc) }))
        .filter(s => s.title && s.desc)
        .slice(0, 3);

      if (cleanSuggestions.length) {
        return res.json({ suggestions: cleanSuggestions });
      }
    } catch (aiError) {
      console.log('suggest-projects: AI path failed, using fallback:', aiError.message);
    }

    return res.json({ suggestions: fallbackProjectSuggestions({ medium, description, targetLanguage }) });
  } catch (error) {
    return res.json({
      suggestions: fallbackProjectSuggestions({
        medium: cleanText((req.body || {}).medium || ''),
        description: cleanText((req.body || {}).description || ''),
        targetLanguage: cleanText((req.body || {}).targetLanguage || 'English') || 'English',
      }),
    });
  }
});


app.post('/generate', aiLimiter, async (req, res) => {
  const {
    name,
    medium,
    description,
    projectList,
    projects = [],
    customSections = [],
    skills = [],
    contact = {},
    creatorType = '',
    enhanceProjectDescriptions = true,
    targetLanguage = 'English',
    aiTone = 'Professional',
  } = req.body || {};

  // Dynamic headings based on creator type
  const _genTypeText = `${cleanText(creatorType)}`.toLowerCase();
  const _genIsCareer = _genTypeText.includes('student') || _genTypeText.includes('job') || _genTypeText.includes('career') || _genTypeText.includes('cv') || _genTypeText.includes('developer');
  const _genBioHeading = _genIsCareer ? 'Bio' : 'Artist Bio';
  const _genStatementHeading = _genIsCareer ? 'Professional Statement' : 'Artist Statement';
  const safeTargetLanguage = normalizeServerOutputLanguage(targetLanguage);

  if (!cleanText(name) || !cleanText(medium) || !cleanText(description)) {
    return res.status(400).json({ error: 'Name, field, and description are required.' });
  }

  try {
  const projectItems = Array.isArray(projects)
    ? projects.filter(project => project && cleanText(project.title)).map(project => ({
        id: String(project.id),
        title: cleanText(project.title),
        desc: cleanText(project.desc),
        link: cleanText(project.link),
      }))
    : [];

  const customSectionItems = Array.isArray(customSections)
    ? customSections.map(section => ({
        id: cleanText(section.id),
        name: cleanText(section.name),
        items: Array.isArray(section.items)
          ? section.items.map(item => ({
              id: cleanText(item.id),
              heading: cleanText(item.heading),
              desc: cleanText(item.desc),
              link: cleanText(item.link),
            })).filter(item => item.heading || item.desc || item.link)
          : [],
      })).filter(section => section.name || section.items.length)
    : [];

  const skillItems = Array.isArray(skills) ? skills.map(cleanText).filter(Boolean) : [];

  let portfolio = '';
  let enhancedProjects = [];
  let enhancedCustomSections = [];
  const warnings = [];

  if (aiAvailable()) {
    let lastPortfolioError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const aiText = await generateAiText({
          temperature: attempt === 1 ? 0.22 : 0.05,
          maxTokens: 1100,
          messages: [
            {
              role: 'system',
            content: `You are MuseForge's STRICT multilingual portfolio generation engine.

            TARGET_OUTPUT_LANGUAGE: ${safeTargetLanguage}

            ${languageStrictInstruction(safeTargetLanguage)}
            ${toneInstruction(aiTone)}

            NON-NEGOTIABLE OUTPUT RULES:
            1. Every user-visible prose sentence must be written in TARGET_OUTPUT_LANGUAGE only.
            2. Parser markdown headings must remain exactly as requested because the frontend parser depends on them.
            3. Do NOT translate parser headings inside this markdown response. The frontend will render localized headings separately.
            4. Body text under each parser heading must be in TARGET_OUTPUT_LANGUAGE only.
            5. Bio, statement, project titles, project descriptions, custom section names, custom item headings, custom item descriptions, and portfolio text must all map to TARGET_OUTPUT_LANGUAGE.
            6. Preserve unchanged only: person names, company names, URLs, emails, phone numbers, usernames, programming language names, technology/tool names, and brand names.
            7. Never invent achievements, clients, dates, metrics, awards, responsibilities, tools, platforms, popularity, recognition, or outcomes.
            8. If the input language differs from TARGET_OUTPUT_LANGUAGE, translate meaning faithfully into TARGET_OUTPUT_LANGUAGE.
            9. If any sentence accidentally remains in the source language, the output is invalid. Rewrite before returning.
            10. Do not output explanations, notes, analysis, or extra sections.
            11. FIRST PERSON ONLY. The creator is speaking in their own voice. Write EVERY sentence — both the bio and the statement — in the first person using "I", "my", and "me". Never use the creator's name as the subject and never use "he", "she", or "they". Write "I am", "I create", "my work" — never "she is a designer" or "the creator builds". Any sentence written in third person makes the whole response INVALID; rewrite it before returning.

            QUALITY CHECK BEFORE RETURN:
            - Check every body sentence.
            - Check every project/custom-section sentence.
            - Check that no English filler remains unless TARGET_OUTPUT_LANGUAGE is English or the word is an allowed proper noun/tool/URL/email.
            - Check that the Bio and Statement are different.
            - Return only the requested portfolio content.`,  
            },
            {
              role: 'user',
             content: `TARGET_OUTPUT_LANGUAGE: ${safeTargetLanguage}

              STRICT PORTFOLIO CONTRACT:
              Generate exactly TWO markdown sections using exactly these parser headings:

              ## ${_genBioHeading}
              ## ${_genStatementHeading}

              Do not add any third section.
              Do not add notes.
              Do not add explanations.
              Do not add markdown outside these two sections.

              CREATOR DATA:
              Name: ${cleanText(name)}
              Medium/field: ${cleanText(medium)}
              Creator type: ${cleanText(creatorType) || 'creator'}
              User description: ${cleanText(description)}
              ${projectList ? `\nProjects supplied by the user:\n${projectList}` : ''}

              LANGUAGE LOCK:
              - The body text under both headings must be written only in ${safeTargetLanguage}.
              - Do not leave source-language sentences inside the portfolio.
              - Do not mix languages.
              - Do not use English filler unless ${safeTargetLanguage} is English.
              - Keep names, emails, URLs, phone numbers, usernames, technology names, and brand names unchanged.
              - Translate normal human-readable prose into ${safeTargetLanguage}.

              FACTLOCK RULES:
              - Use only the facts supplied above.
              - Do not invent achievements, awards, metrics, numbers, clients, tools, years, brands, platforms, certifications, education, job titles, recognition, popularity, or experience.
              - Improve wording, structure, confidence, and presentation only.
              - If details are limited, write honestly with strength using intention, craft, learning, consistency, process, direction, and care.
              - Never fake authority.

              SECTION 1:

              ## ${_genBioHeading}

              Write a strong 5-6 sentence portfolio bio, written entirely in the FIRST PERSON ("I", "my", "me"). 
              I am introducing myself in my own voice — never write my name as the subject, and never use "he", "she", or "they".

              BIO PURPOSE:
              This section is the person's profile.
              It should clearly explain:
              - who this person is,
              - what they create or do,
              - their field or medium,
              - their visible style, skills, interests, or audience,
              - why their portfolio feels credible and opportunity-ready.

              BIO STYLE:
              - polished,
              - human,
              - confident,
              - specific,
              - professional,
              - strong first impression.

              BIO MUST NOT:
              - sound like a manifesto,
              - explain deep philosophy,
              - repeat the statement,
              - use emotional self-reflection,
              - start with statement-style language.

              SECTION 2:

              ## ${_genStatementHeading}

              Write 2 short first-person paragraphs.

              STATEMENT PURPOSE:
              This section is not a bio.
              It should explain:
              - why this person creates or works in this field,
              - what guides their choices,
              - what their work is trying to communicate,
              - how they approach their process,
              - what direction they are developing toward.

              STATEMENT STYLE:
              - first-person,
              - reflective,
              - mature,
              - memorable,
              - sincere,
              - strong but not fake,
              - clearly different from the bio.

              STATEMENT MUST NOT:
              - reintroduce the person like a bio,
              - list the same facts again,
              - start with the same idea as the bio,
              - say "I am a..." if the bio already introduced the identity,
              - add unsupported claims.

              FINAL SELF-CHECK:
              Before returning, silently verify:
              1. Body text is only in ${safeTargetLanguage}.
              2. Bio and Statement are clearly different.
              3. No unsupported fact was added.
              4. No source-language prose remains.
              5. Parser headings are exactly preserved.

              Return only the two markdown sections.`,
            },
          ],
        });
        const candidatePortfolio = cleanText(aiText || '')
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/\*(.*?)\*/g, '$1')
          .trim();
        if (!candidatePortfolio.includes(`## ${_genBioHeading}`) || !candidatePortfolio.includes(`## ${_genStatementHeading}`)) {
          throw new Error('AI response did not contain the required sections');
        }
        if (hasCyrillic(candidatePortfolio) && !['russian', 'ukrainian'].includes(languageFamily(safeTargetLanguage))) {
          throw new Error('AI response used the wrong script for the selected language');
        }
        const portfolioBodyOnly = portfolioBodyForLanguageCheck(candidatePortfolio);
        if (hasUnexpectedScriptForLanguage(portfolioBodyOnly, safeTargetLanguage) || (requiresNonLatinScript(safeTargetLanguage) && !hasRequiredScript(portfolioBodyOnly, safeTargetLanguage)) || looksLikeWrongEnglishForTarget(portfolioBodyOnly, safeTargetLanguage)) {
          throw new Error('AI response used a writing system that does not match the selected language');
        }
        // A portfolio speaks as the creator. /factlock/regenerate already enforced this, but
        // /generate did not — so a model that wrote "the creator built..." sailed straight through
        // into the bio and the statement, in every language.
        if (!regenerationUsesFirstPerson(portfolioBodyOnly, safeTargetLanguage)) {
          throw new Error('AI response was not written in first person');
        }
        portfolio = candidatePortfolio;
        break;
      } catch (error) {
        lastPortfolioError = error;
        console.warn(`AI portfolio generation attempt ${attempt} failed:`, error.message);
      }
    }
    if (!portfolio) {
      console.warn('AI portfolio generation failed after retries; safe fallback used:', lastPortfolioError?.message || 'unknown error');
      warnings.push('AI portfolio generation did not pass the selected-language validation, so MuseForge created a safe local draft using only your text.');
    }
  } else {
    warnings.push('No AI provider is configured, so MuseForge created a safe local draft using only your text.');
  }

  if (!portfolio) {
    const safeDescriptionForPortfolio = await translateProseStrict(description, safeTargetLanguage);
    portfolio = buildFallbackPortfolio({
    name,
    medium,
    description: safeDescriptionForPortfolio,
    targetLanguage: safeTargetLanguage,
    bioHeading: _genBioHeading,
    statementHeading: _genStatementHeading
  });
  }

  if (enhanceProjectDescriptions && projectItems.length) {
    if (aiAvailable()) {
      try {
        const aiText = await generateAiText({
          temperature: 0.1,
          maxTokens: 900,
          messages: [
            {
              role: 'system',
              content: `You are FactLock AI. ${languageStrictInstruction(safeTargetLanguage)} ${toneInstruction(aiTone)} Rewrite project descriptions in a clearer, stronger, first-person portfolio voice while preserving every original fact, number, domain, and subject. Make the improvement noticeable, but never invent tools, metrics, features, outcomes, dates, clients, awards, responsibilities, or any unsupported detail. A short personal sentence may be expanded only by clarifying effort, purpose, process, or presentation; never switch to a different domain. Keep empty descriptions empty. Return only valid JSON.`,
            },
            {
              role: 'user',
              content: `Return exactly this shape: {"projects":[{"id":"original id","desc":"2-3 polished first-person portfolio sentences"}]}. Do not change IDs or links. Requested output language: ${cleanText(safeTargetLanguage) || 'English'}. Creator type: ${cleanText(creatorType) || 'creator'}. Medium/field: ${cleanText(medium)}.\n\nProjects:\n${JSON.stringify(projectItems.map(project => ({ id: project.id, title: project.title, desc: project.desc })))}`,
            },
          ],
        });
        const parsed = parseJsonObject(aiText || '');
        const returned = Array.isArray(parsed.projects) ? parsed.projects : [];
        enhancedProjects = await Promise.all(projectItems.map(async project => {
          const match = returned.find(item => String(item.id) === project.id);
          const candidate = project.desc ? stripRegenerateNoiseServer(cleanText(match && match.desc ? match.desc : '')) : '';
          const original = cleanText(project.desc);
          let desc = '';
          if (original) {
            const strongFallback = await translateOrLocalRegeneration(
              buildLocalStrongProjectRegeneration({ title: project.title, originalDesc: original, medium, creatorType, targetLanguage: safeTargetLanguage }),
              safeTargetLanguage
            );

            if (candidate && !sameCleanText(candidate, original) && regenerationIsStrongEnough(candidate, { isProject: true, targetLanguage: safeTargetLanguage, originalDesc: original, title: project.title, medium })) {
              desc = candidate;
            } else {
              desc = strongFallback;
            }

            if (!regenerationIsStrongEnough(desc, { isProject: true, targetLanguage: safeTargetLanguage, originalDesc: original, title: project.title, medium })) {
              desc = strongFallback;
            }
          }
          return buildFactLockReview(project, desc);
        }));
      } catch (error) {
        console.warn('AI project enhancement failed; local cleanup used:', error.message);
        warnings.push('Project descriptions received safe local grammar cleanup because the AI enhancement service was unavailable.');
      }
    }

    if (!enhancedProjects.length) {
      enhancedProjects = await Promise.all(projectItems.map(async project => buildFactLockReview(
        project,
        project.desc ? await translateOrLocalRegeneration(buildLocalStrongProjectRegeneration({ title: project.title, originalDesc: project.desc, medium, creatorType, targetLanguage: safeTargetLanguage }), safeTargetLanguage) : ''
      )));
    }
  }

  const customFactItems = customSectionItems.flatMap(section =>
    (section.items || [])
      .filter(item => cleanText(item.heading) || cleanText(item.desc))
      .map(item => ({
        sectionId: section.id,
        sectionName: section.name,
        itemId: item.id,
        reviewId: `section:${section.id}:${item.id}`,
        heading: item.heading,
        desc: item.desc,
        link: item.link || '',
      }))
  );

  if (enhanceProjectDescriptions && customFactItems.length) {
    if (aiAvailable()) {
      try {
        const aiText = await generateAiText({
          temperature: 0.1,
          maxTokens: 900,
          messages: [
            {
              role: 'system',
              content: `You are FactLock AI. ${languageStrictInstruction(safeTargetLanguage)} ${toneInstruction(aiTone)} Rewrite custom portfolio-section item descriptions in a clearer, stronger, first-person portfolio voice while preserving every original fact, number, domain, and subject. Never invent tools, metrics, features, outcomes, dates, clients, awards, responsibilities, or any unsupported detail. Do not repeat only the item heading as the description. Do not start with the full section label such as Achievements — Demo Tracks. Write naturally in first person. Keep empty descriptions empty. Return only valid JSON.`,
            },
            {
              role: 'user',
              content: `Return exactly this shape: {"items":[{"reviewId":"original reviewId","desc":"2-3 polished first-person portfolio sentences"}]}. Do not change reviewIds, headings, section names, links, or media. Requested output language: ${safeTargetLanguage}. Medium/field: ${cleanText(medium)}.

Custom section items:
${JSON.stringify(customFactItems.map(item => ({ reviewId: item.reviewId, section: item.sectionName, heading: item.heading, desc: item.desc })))} `,
            },
          ],
        });
        const parsed = parseJsonObject(aiText || '');
        const returned = Array.isArray(parsed.items) ? parsed.items : [];
        enhancedCustomSections = await Promise.all(customSectionItems.map(async section => ({
          ...section,
          items: await Promise.all((section.items || []).map(async item => {
            const reviewId = `section:${section.id}:${item.id}`;
            const match = returned.find(entry => String(entry.reviewId) === reviewId);
            const original = cleanText(item.desc);
            const itemTitle = cleanText(item.heading || section.name);
            const candidate = original ? stripRegenerateNoiseServer(cleanText(match && match.desc ? match.desc : '')) : '';
            let desc = '';
            if (original) {
              const strongFallback = await translateOrLocalRegeneration(
                buildLocalStrongProjectRegeneration({ title: itemTitle, originalDesc: original, medium, creatorType, targetLanguage: safeTargetLanguage }),
                safeTargetLanguage
              );

              if (candidate && !sameCleanText(candidate, original) && regenerationIsStrongEnough(candidate, { isProject: true, targetLanguage: safeTargetLanguage, originalDesc: original, title: itemTitle, medium })) {
                desc = candidate;
              } else {
                desc = strongFallback;
              }

              if (!regenerationIsStrongEnough(desc, { isProject: true, targetLanguage: safeTargetLanguage, originalDesc: original, title: itemTitle, medium })) {
                desc = strongFallback;
              }
            }
            const review = buildFactLockReview({ id: reviewId, title: item.heading || section.name, desc: original }, desc);
            return {
              ...item,
              desc: review.desc,
              reviewId,
              originalDesc: review.originalDesc,
              factsPreserved: review.factsPreserved,
              unsupportedNewFacts: review.unsupportedNewFacts,
            };
          })),
        })));
      } catch (error) {
        console.warn('AI custom-section enhancement failed; local cleanup used:', error.message);
        warnings.push('Custom section entries received safe local grammar cleanup because the AI enhancement service was unavailable.');
      }
    }

    if (!enhancedCustomSections.length) {
      enhancedCustomSections = await Promise.all(customSectionItems.map(async section => ({
        ...section,
        items: await Promise.all((section.items || []).map(async item => {
          const reviewId = `section:${section.id}:${item.id}`;
          const original = cleanText(item.desc);
          const desc = original ? await translateOrLocalRegeneration(buildLocalStrongProjectRegeneration({ title: item.heading || section.name, originalDesc: original, medium, creatorType, targetLanguage: safeTargetLanguage }), safeTargetLanguage) : '';
          const review = buildFactLockReview({ id: reviewId, title: item.heading || section.name, desc: original }, desc);
          return {
            ...item,
            desc: review.desc,
            reviewId,
            originalDesc: review.originalDesc,
            factsPreserved: review.factsPreserved,
            unsupportedNewFacts: review.unsupportedNewFacts,
          };
        })),
      })));
    }
  }

  const customSectionsForOutput = enhancedCustomSections.length ? enhancedCustomSections : customSectionItems;

  let localizedSkillItems = skillItems;

  if (languageFamily(safeTargetLanguage) !== 'english') {
    localizedSkillItems = await translateSkillListStrict(skillItems, safeTargetLanguage);

    for (const project of projectItems) {
      if (!project) continue;
      if (project.title) project.title = cleanText(await translateLabelStrict(project.title, safeTargetLanguage, { useMediumDictionary: false })) || project.title;
      // Technical descriptions contain almost no common English function words, so the
      // englishProseScore gate (threshold 4) skipped them and left an English description
      // sitting under a translated title. Zero target-language words is the better signal.
      if (project.desc) project.desc = stripLeakedJsonAndEcho(project.desc);
      const descNeedsSweep = project.desc && (
        leaksLatinForTarget(project.desc, safeTargetLanguage)
        || looksLikeWrongEnglishForTarget(project.desc, safeTargetLanguage)
        || targetLanguageSignalScore(project.desc, safeTargetLanguage) === 0
      );
      if (descNeedsSweep) {
        const swept = cleanText(await translateTextStrict(project.desc, safeTargetLanguage));
        if (swept && !translationLooksFabricated(project.desc, swept)) project.desc = swept;
      }
    }

    for (const section of customSectionsForOutput) {
      if (!section) continue;
      // Section NAMES keep the dictionary: "Education" -> "Educación" is exactly what it is for.
      if (section.name) section.name = cleanText(await translateLabelStrict(section.name, safeTargetLanguage)) || section.name;
      for (const item of (section.items || [])) {
        if (!item) continue;
        // Item HEADINGS opt out of the medium dictionary. It matches on substrings, so
        // "Freelance Software Developer" hit /software|developer/ and was replaced wholesale by
        // the medium label "Ingeniería de software" — the user's real text destroyed.
        if (item.heading) item.heading = cleanText(await translateLabelStrict(item.heading, safeTargetLanguage, { useMediumDictionary: false })) || item.heading;
        if (item.desc) item.desc = stripLeakedJsonAndEcho(item.desc);
        const itemDescNeedsSweep = item.desc && (
          leaksLatinForTarget(item.desc, safeTargetLanguage)
          || looksLikeWrongEnglishForTarget(item.desc, safeTargetLanguage)
          || targetLanguageSignalScore(item.desc, safeTargetLanguage) === 0
        );
        if (itemDescNeedsSweep) {
          const sweptItem = cleanText(await translateTextStrict(item.desc, safeTargetLanguage));
          if (sweptItem && !translationLooksFabricated(item.desc, sweptItem)) item.desc = sweptItem;
        }
      }
    }
  }

  let generatedArtistBio = stripPortfolioMarkdownHeadingServer(extractGeneratedPortfolioSection(portfolio, _genBioHeading));
  let generatedArtistStatement = stripPortfolioMarkdownHeadingServer(extractGeneratedPortfolioSection(portfolio, _genStatementHeading));

  generatedArtistBio = await ensureDistinctBioDraft({
    name,
    medium,
    description,
    targetLanguage: safeTargetLanguage,
    creatorType,
    aiTone,
    artistStatement: generatedArtistStatement,
  });

  generatedArtistStatement = await ensureDistinctStatementDraft({
    name,
    medium,
    description,
    projects: projectItems,
    targetLanguage: safeTargetLanguage,
    creatorType,
    aiTone,
    artistBio: generatedArtistBio,
    artistStatement: generatedArtistStatement,
  });

  generatedArtistBio = stripPortfolioMarkdownHeadingServer(generatedArtistBio);
  generatedArtistStatement = stripPortfolioMarkdownHeadingServer(generatedArtistStatement);

  if (!generatedArtistStatement || sectionsTooSimilar(generatedArtistBio, generatedArtistStatement)) {
    generatedArtistStatement = safeTargetLanguage === 'English'
      ? buildLocalDistinctStatementStrong({ medium, description, creatorType, targetLanguage: safeTargetLanguage })
      : await translateProseStrict(buildLocalDistinctStatementStrong({ medium, description, creatorType, targetLanguage: safeTargetLanguage }), safeTargetLanguage);
  }

  portfolio = replaceGeneratedPortfolioSection(portfolio, _genBioHeading, generatedArtistBio);
  portfolio = replaceGeneratedPortfolioSection(portfolio, _genStatementHeading, generatedArtistStatement);

  generatedArtistBio = stripLeakedJsonAndEcho(generatedArtistBio);
  generatedArtistStatement = stripLeakedJsonAndEcho(generatedArtistStatement);

  console.log('TITLE debug:', JSON.stringify(projectItems.map(p => p && p.title)));

  const localizedOutput = await buildLocalizedOutput({
    targetLanguage: safeTargetLanguage,
    artistBio: generatedArtistBio,
    artistStatement: generatedArtistStatement,
    projects: enhancedProjects.length
      ? projectItems.map(project => {
          const enhanced = enhancedProjects.find(item => String(item.id) === String(project.id));
          return enhanced ? { ...project, desc: enhanced.desc || project.desc } : project;
        })
      : projectItems,
    customSections: customSectionsForOutput,
    skills: localizedSkillItems,
    name,
    medium,
    description,
  });

  console.log('FactLock debug:', JSON.stringify({ enhanceProjectDescriptions, projects: projectItems.length, enhancedProjects: enhancedProjects.length, withDesc: enhancedProjects.filter(p => p && String(p.desc || '').trim()).length }));

  return res.json({
    portfolio,
    enhancedProjects,
    enhancedCustomSections,
    localizedOutput,
    warning: warnings.join(' '),
    enhancementApplied: Boolean(enhanceProjectDescriptions && projectItems.length),
    targetLanguage: safeTargetLanguage,
  });
  } catch (error) {
    console.error('generate failed:', error && error.stack ? error.stack : error);
    // Never hang the request: fall back to a safe, in-language portfolio draft.
    try {
      const fallbackPortfolio = buildFallbackPortfolio({
        name, medium, description,
        targetLanguage: safeTargetLanguage,
        creatorType,
        bioHeading: _genBioHeading,
        statementHeading: _genStatementHeading,
      });
      const localizedOutput = await buildLocalizedOutput({
        targetLanguage: safeTargetLanguage,
        artistBio: '', artistStatement: '',
        projects, customSections, skills, name, medium, description,
      });
      return res.status(200).json({
        portfolio: fallbackPortfolio,
        enhancedProjects: [],
        enhancedCustomSections: [],
        localizedOutput,
        warning: 'AI enhancement was unavailable, so a safe draft based only on your input was returned.',
        enhancementApplied: false,
        targetLanguage: safeTargetLanguage,
      });
    } catch (fallbackError) {
      return res.status(500).json({ error: 'Portfolio generation failed. Please try again.' });
    }
  }
});


function normalizeCvTextForParsing(text = '') {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// IBM Docling: document understanding for the uploaded CV.
// Docling reconstructs real reading order, headings and tables from a PDF, which is exactly the
// problem a regex/heuristic parser struggles with (two-column CVs, tables, wrapped headings).
// It runs as a service (docling-serve); set DOCLING_URL to enable it. If it is not configured,
// unreachable, or returns something unexpected, extraction falls back to the local PDF parsers,
// so the upload path can never break because Docling is down.
// ---------------------------------------------------------------------------
// Docling returns Markdown, and a real CV is mostly TABLES. Naively replacing "|" with a space
// flattened every table into one 200-character line: section headings stopped being detected, the
// "|---|---|" separator rows leaked into Education and Certifications as rows of dashes, and the
// "<!-- image -->" placeholder Docling emits for the photo became the creator's NAME.
function isMarkdownTableSeparator(line = '') {
  const text = String(line || '').trim();
  return /-{2,}/.test(text) && /^\|?[\s:|-]+\|?$/.test(text);
}

function doclingMarkdownToCvText(markdown = '') {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];

    // Figure/table placeholders are not CV content.
    line = line.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!line) { out.push(''); continue; }

    // Drop separator rows entirely.
    if (isMarkdownTableSeparator(line)) continue;

    if (/^\s*\|.*\|\s*$/.test(line)) {
      // A table row. If the NEXT line is a separator, this is the column-label row, not content.
      if (isMarkdownTableSeparator(lines[i + 1] || '')) continue;
      const cells = line.split('|').map(cell => cell.trim()).filter(Boolean);
      if (!cells.length) continue;
      // One line per table ROW keeps the row readable and keeps headings on their own lines.
      out.push(cells.join(' · '));
      continue;
    }

    line = line.replace(/^#{1,6}\s*/, '');                       // heading markers
    line = line.replace(/^\s*[-*+]\s+/, '• ');                   // bullets
    line = line.replace(/^\s*\d+[.)]\s+/, '• ');                 // numbered bullets
    line = line.replace(/\*\*(.*?)\*\*/g, '$1');                 // bold
    line = line.replace(/__(.*?)__/g, '$1');                      // bold
    line = line.replace(/`([^`]*)`/g, '$1');                      // code
    line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 $2');    // [text](url) -> text url
    line = line.replace(/^>\s*/, '');                             // blockquote
    out.push(line.trim());
  }

  return out.join('\n');
}

async function extractCvTextWithDocling(buffer) {
  if (!DOCLING_URL) return '';

  const base = DOCLING_URL.replace(/\/+$/, '');
  const endpoints = ['/v1/convert/file', '/v1alpha/convert/file'];
  const failures = [];

  for (const endpoint of endpoints) {
    try {
      const form = new FormData();
      form.append('files', new Blob([buffer], { type: 'application/pdf' }), 'cv.pdf');
      form.append('from_formats', 'pdf');
      form.append('to_formats', 'md');
      form.append('do_ocr', DOCLING_OCR === 'true' ? 'true' : 'false');
      form.append('image_export_mode', 'placeholder');
      form.append('table_mode', 'accurate');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DOCLING_TIMEOUT_MS);

      const headers = { Accept: 'application/json' };
      if (DOCLING_API_KEY) headers['X-Api-Key'] = DOCLING_API_KEY;

      const response = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
        headers,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        failures.push(
          `${endpoint} -> HTTP ${response.status}${body ? ` | body: ${body}` : ''}`
        );
        continue;
      }

      const data = await response.json().catch(() => ({}));

      const markdown = String(
        data?.document?.md_content
        || data?.document?.markdown
        || data?.md_content
        || (Array.isArray(data?.documents)
          ? (data.documents[0]?.md_content || '')
          : '')
        || ''
      ).trim();

      if (!markdown) {
        failures.push(
          `${endpoint} -> 200 OK but md_content is EMPTY`
          + ` | status: ${JSON.stringify(data?.status ?? null)}`
          + ` | errors: ${JSON.stringify(data?.errors ?? null)}`
          + ` | document_keys: ${JSON.stringify(Object.keys(data?.document || {}))}`
        );
        continue;
      }

      console.log(
        'CV extraction: Docling succeeded',
        JSON.stringify({ endpoint, chars: markdown.length })
      );

      return normalizeCvTextForParsing(
        doclingMarkdownToCvText(markdown)
      );
    } catch (error) {
      failures.push(`${endpoint} -> ${error.message}`);
    }
  }

  console.warn(
    `Docling produced no text. EVERY attempt, in order:\n${failures
      .map((failure) => `  - ${failure}`)
      .join('\n')}`
  );

  return '';
}

// Both extractions, so the caller can parse each and keep the better result. Docling understands
// document structure far better than a text dump, but it is a service: it can return a layout the
// parser reads worse than the plain text. Trusting it blindly once turned a good CV into a name of
// "ک" and zero sections. Now it has to EARN the win.
async function extractCvTextCandidates(buffer) {
  const docling = await extractCvTextWithDocling(buffer).catch(() => '');
  const local = await extractCvTextLocallyFromPdf(buffer).catch(() => '');
  // Do NOT cleanText() here — it collapses newlines and flattens section structure.
  return { docling: String(docling || '').trim(), local: String(local || '').trim() };
}

function parseBestCv({ docling = '', local = '' } = {}, embeddedLinks = []) {
  const results = [];
  if (docling) {
    const parsed = parseCvTextLocally(docling, embeddedLinks);
    results.push({ source: 'docling', parsed, score: cvParseQuality(parsed) });
  }
  if (local) {
    const parsed = parseCvTextLocally(local, embeddedLinks);
    results.push({ source: 'local', parsed, score: cvParseQuality(parsed) });
  }
  if (!results.length) return { source: 'none', parsed: parseCvTextLocally('', embeddedLinks), score: -1 };

  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  console.log('CV parse: chose', JSON.stringify({
    source: best.source,
    scores: results.map(r => `${r.source}=${r.score}`).join(' '),
    name: best.parsed.name,
    sections: (best.parsed.customSections || []).length,
    skills: (best.parsed.skills || []).length,
  }));
  return best;
}

async function extractCvTextLocallyFromPdf(buffer) {
  if (!buffer || !buffer.length) return '';

  // First parser: modern pdf-parse. It handles many CV PDFs that pdfreader rejects.
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    if (typeof parser.destroy === 'function') await parser.destroy();
    const text = normalizeCvTextForParsing(result?.text || '');
    if (text) return text;
  } catch (error) {
    console.warn('pdf-parse CV extraction failed; trying pdfreader:', error.message);
  }

  // Second parser: existing pdfreader fallback.
  try {
    let cvText = '';
    await new Promise((resolve) => {
      new PdfReader().parseBuffer(buffer, (err, item) => {
        if (err) {
          console.warn('pdfreader CV extraction failed; trying raw text fallback:', err.message);
          return resolve();
        }
        if (!item) return resolve();
        if (item.text) cvText += `${item.text} `;
      });
    });
    const text = normalizeCvTextForParsing(cvText);
    if (text) return text;
  } catch (error) {
    console.warn('pdfreader CV extraction crashed; trying raw text fallback:', error.message);
  }

  // Last fallback: recover visible strings from the raw PDF stream so upload never hard-crashes.
  try {
    const raw = buffer.toString('latin1');
    const strings = [];
    const literalPattern = /\(([^()]{2,200})\)\s*Tj/g;
    let match;
    while ((match = literalPattern.exec(raw)) !== null) {
      strings.push(match[1]);
    }
    const printable = raw.match(/[A-Za-z0-9][A-Za-z0-9@:/._+\-#,&()\s]{3,}/g) || [];
    strings.push(...printable.slice(0, 500));
    return strings
      .join(' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (error) {
    console.warn('Raw CV extraction fallback failed:', error.message);
    return '';
  }
}

app.post('/parse-cv' , aiLimiter, upload.single('cv'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const candidates = await extractCvTextCandidates(req.file.buffer);
    const embeddedCvLinks = await extractCvEmbeddedLinksFromPdfBuffer(req.file.buffer);
    console.log('CV extraction:', JSON.stringify({
      doclingChars: candidates.docling.length,
      localChars: candidates.local.length,
      embeddedLinks: embeddedCvLinks.length,
    }));

    if (!candidates.docling && !candidates.local) {
      return res.json({
        ...parseCvTextLocally('', embeddedCvLinks),
        warning: 'CV text could not be read from this PDF. Please fill the form manually or upload a text-based PDF.'
      });
    }

    // Parse BOTH extractions and keep whichever actually recovered more of the CV.
    const best = parseBestCv(candidates, embeddedCvLinks);
    const cvText = best.source === 'docling' ? candidates.docling : candidates.local;
        // Option B: stop when extracted PDF text is genuinely unreadable.
    const readability = assessCvReadability(cvText, best.parsed);
    console.log('CV readability diagnostic:', JSON.stringify(readability));
    if (readability.unreadable) {
      console.log('CV unreadable:', JSON.stringify(readability));
      return res.json({
        ...parseCvTextLocally('', embeddedCvLinks),
        unreadable: true,
        warning: UNREADABLE_CV_MESSAGE,
      });
    }
    await sendToParserAndRespond(cvText, res, embeddedCvLinks);
  } catch (err) {
    console.error('CV parsing error:', err.message);
    res.status(500).json({ error: 'CV parsing failed', details: err.message });
  }
});


function preprocessText(text = '') {
  let t = String(text || '');
  t = t.replace(/([a-zA-Z])\s+\.\s*(com|edu|pk|org|net|io)\b/gi, '$1.$2');
  t = t.replace(/(github)\s*\.\s*com\s*\/\s*/gi, 'github.com/');
  t = t.replace(/(linkedin)\s*\.\s*com\s*\/\s*in\s*\/\s*/gi, 'linkedin.com/in/');
  return t;
}

function uniq(items = []) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const value = String(item || '').trim();
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      output.push(value);
    }
  }
  return output;
}

function cleanCvLine(value = '') {
  // Docling returns HTML-escaped text, so "Data & ML" arrives as "Data &amp; ML". The skill
  // splitter then breaks on the ";" INSIDE the entity, producing the skill "Data &amp" — which
  // the translator then faithfully rendered as "Datos y". Decode before anything else splits.
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d{2,5});/g, (match, code) => {
      const num = Number(code);
      return num > 0 && num < 1114112 ? String.fromCodePoint(num) : match;
    })
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCvBullet(value = '') {
  return cleanCvLine(value).replace(/^[•\u2022\-*]\s*/, '').trim();
}

// Letters that carry a stroke or ligature rather than an accent do NOT decompose under NFD, so
// Polish "WYKSZTAŁCENIE", Vietnamese "ĐẠI HỌC", German "STRASSE" and Turkish "ışık" would never
// match their aliases. Fold them by hand first.
const CV_LETTER_FOLDS = {
  'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'Ð': 'D', 'ð': 'd',
  'Ø': 'O', 'ø': 'o', 'Æ': 'AE', 'æ': 'ae', 'Œ': 'OE', 'œ': 'oe',
  'ß': 'ss', 'İ': 'I', 'ı': 'i', 'Þ': 'TH', 'þ': 'th', 'Ħ': 'H', 'ħ': 'h',
};
const CV_LETTER_FOLD_RE = new RegExp('[' + Object.keys(CV_LETTER_FOLDS).join('') + ']', 'g');

function normalizeCvHeading(value = '') {
  return String(value || '')
    .replace(CV_LETTER_FOLD_RE, ch => CV_LETTER_FOLDS[ch])
    // Split accents off their base letters, then drop them, so a French CV heading
    // "COMPÉTENCES" normalises to "COMPETENCES" and matches its alias.
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .toUpperCase()   // a no-op for Arabic, Urdu, Chinese, Japanese, Korean — they have no case
    // Keep letters and digits from EVERY script. The old rule was [^A-Z0-9& ] which erased
    // every non-Latin heading to an empty string — which is why a French, Spanish, Chinese,
    // Arabic or Urdu CV used to parse to absolutely nothing.
    .replace(/[^\p{L}\p{N}& ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CV_SECTION_ALIASES = {
  summary: ['SUMMARY', 'PROFESSIONAL SUMMARY', 'PROFILE','PROFILE SUMMARY', 'EXECUTIVE SUMMARY', 'CAREER PROFILE', 'ABOUT ME', 'ABOUT', 'OBJECTIVE', 'CAREER OBJECTIVE', 'SUMMARY OF QUALIFICATIONS', 'PERSONAL SUMMARY', 'PERSONAL PROFILE', 'PROFESSIONAL PROFILE', 'CAREER SUMMARY', 'BIO'],
  skills: ['TECHNICAL SKILLS', 'SKILLS', 'CORE SKILLS', 'TECHNOLOGIES', 'TECHNICAL EXPERTISE', 'CORE COMPETENCIES', 'COMPETENCIES', 'SKILLS & TOOLS', 'SKILLS AND TOOLS', 'TOOLS & TECHNOLOGIES', 'KEY SKILLS', 'AREAS OF EXPERTISE', 'EXPERTISE', 'SKILLS & ABILITIES', 'TECHNICAL SKILLS & TOOLS'],
  projects: ['PROJECTS', 'PROJECT EXPERIENCE', 'ACADEMIC PROJECTS', 'SELECTED PROJECTS', 'KEY PROJECTS', 'PERSONAL PROJECTS', 'NOTABLE PROJECTS', 'FEATURED PROJECTS', 'RELEVANT PROJECTS', 'SIDE PROJECTS', 'EXHIBITIONS', 'SELECTED WORKS', 'SELECTED WORK', 'COMMISSIONS', 'PERFORMANCES', 'SCREENINGS', 'RESIDENCIES'],
  education: ['EDUCATION', 'ACADEMIC BACKGROUND', 'EDUCATIONAL BACKGROUND', 'ACADEMIC QUALIFICATIONS', 'EDUCATION & QUALIFICATIONS', 'QUALIFICATIONS', 'ACADEMICS', 'EDUCATION AND TRAINING'],
  experience: ['EXPERIENCE', 'WORK EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'INTERNSHIPS', 'INTERNSHIP EXPERIENCE', 'WORK HISTORY', 'EMPLOYMENT HISTORY', 'EMPLOYMENT', 'PROFESSIONAL BACKGROUND', 'CAREER HISTORY', 'RELEVANT EXPERIENCE'],
  certifications: ['CERTIFICATIONS', 'CERTIFICATES', 'COURSES', 'ONLINE COURSES', 'WORKSHOPS & CERTIFICATIONS', 'WORKSHOPS AND CERTIFICATIONS', 'TRAINING & CERTIFICATIONS', 'TRAININGS', 'LICENSES & CERTIFICATIONS', 'CERTIFICATIONS & LICENSES', 'RELEVANT COURSEWORK', 'COURSEWORK', 'CERTIFICATIONS & COURSES'],
  awards: ['AWARDS', 'ACHIEVEMENTS', 'HONORS', 'HONOURS', 'AWARDS & HONORS', 'AWARDS AND HONORS', 'ACCOMPLISHMENTS', 'KEY ACHIEVEMENTS', 'HONORS & AWARDS', 'AWARDS & ACHIEVEMENTS'],
  extracurricular: ['EXTRACURRICULAR ACTIVITIES', 'EXTRACURRICULAR', 'ACTIVITIES', 'VOLUNTEERING', 'VOLUNTEER EXPERIENCE', 'VOLUNTEER WORK', 'LEADERSHIP', 'LEADERSHIP EXPERIENCE', 'CO CURRICULAR ACTIVITIES', 'EXTRA CURRICULAR ACTIVITIES', 'EXTRA CURRICULAR', 'COMMUNITY INVOLVEMENT', 'AFFILIATIONS', 'PROFESSIONAL AFFILIATIONS', 'MEMBERSHIPS', 'PROFESSIONAL MEMBERSHIPS', 'POSITIONS OF RESPONSIBILITY', 'POSITION OF RESPONSIBILITY'],
  publications: ['PUBLICATIONS', 'RESEARCH PUBLICATIONS', 'RESEARCH', 'RESEARCH EXPERIENCE', 'PAPERS'],
  languages: ['LANGUAGES', 'LANGUAGE PROFICIENCY', 'LANGUAGES KNOWN', 'SPOKEN LANGUAGES'],
  references: ['REFERENCES', 'REFEREES', 'REFERENCE'],
  interests: ['HOBBIES', 'INTERESTS', 'HOBBIES AND INTERESTS', 'HOBBIES & INTERESTS', 'INTERESTS & HOBBIES', 'PERSONAL INTERESTS'],
};


// ---------------------------------------------------------------------------
// Multilingual CV section headings.
// A creator writes their CV in their own language, so the parser must recognise the heading in
// their language too. These are the headings that appear on real CVs in each of the output
// languages, not just a translation of the English word.
// ---------------------------------------------------------------------------
const CV_SECTION_ALIASES_MULTILINGUAL = {
  summary: [
    'RESUMEN','PERFIL','SOBRE MI','OBJETIVO','PERFIL PROFESIONAL',
    'RESUME','PROFIL','A PROPOS','OBJECTIF','PRESENTATION',
    'ZUSAMMENFASSUNG','UBER MICH','KURZPROFIL',
    'SINTESI','PROFILO','CHI SONO',
    'RESUMO','SOBRE',
    'SAMENVATTING','PROFIEL','OVER MIJ',
    'PODSUMOWANIE','O MNIE',
    'OZET','HAKKIMDA','PROFIL OZETI',
    '简介','个人简介','关于我','概述','自我介绍',
    '概要','自己紹介','プロフィール',
    '요약','자기소개','프로필',
    'КРАТКОЕ ОПИСАНИЕ','О СЕБЕ','ПРОФИЛЬ',
    'RINGKASAN','PROFIL SINGKAT','TENTANG SAYA',
    'TOM TAT','GIOI THIEU','HO SO',
    'نبذة','نبذة عني','الملف الشخصي','الملخص',
    'خلاصہ','تعارف','میرے بارے میں',
  ],
  education: [
    'EDUCACION','FORMACION','FORMACION ACADEMICA','ESTUDIOS',
    'FORMATION','FORMATION ACADEMIQUE','ETUDES','DIPLOMES','PARCOURS ACADEMIQUE',
    'AUSBILDUNG','BILDUNG','STUDIUM','AKADEMISCHER WERDEGANG',
    'ISTRUZIONE','FORMAZIONE','FORMAZIONE ACCADEMICA',
    'FORMACAO','FORMACAO ACADEMICA','ESCOLARIDADE',
    'OPLEIDING','OPLEIDINGEN','ONDERWIJS',
    'WYKSZTALCENIE','EDUKACJA',
    'EGITIM','OGRENIM','EGITIM BILGILERI',
    '教育背景','教育经历','学历','教育',
    '学歴',
    '학력','교육',
    'ОБРАЗОВАНИЕ','УЧЕБА',
    'PENDIDIKAN','RIWAYAT PENDIDIKAN',
    'HOC VAN','TRINH DO HOC VAN','GIAO DUC',
    'التعليم','المؤهلات العلمية','الدراسة','المؤهلات',
    'تعلیم','تعلیمی قابلیت','تعلیمی پس منظر',
  ],
  experience: [
    'EXPERIENCIA','EXPERIENCIA LABORAL','EXPERIENCIA PROFESIONAL',
    'EXPERIENCE PROFESSIONNELLE','PARCOURS PROFESSIONNEL',
    'BERUFSERFAHRUNG','ERFAHRUNG','BERUFLICHE ERFAHRUNG','PRAXISERFAHRUNG',
    'ESPERIENZA','ESPERIENZA LAVORATIVA','ESPERIENZA PROFESSIONALE',
    'EXPERIENCIA PROFISSIONAL',
    'WERKERVARING','ERVARING',
    'DOSWIADCZENIE','DOSWIADCZENIE ZAWODOWE',
    'DENEYIM','IS DENEYIMI','TECRUBE',
    '工作经历','工作经验','职业经历','实习经历',
    '職務経歴','職歴','実務経験',
    '경력','경력사항','업무 경험',
    'ОПЫТ','ОПЫТ РАБОТЫ',
    'PENGALAMAN','PENGALAMAN KERJA',
    'KINH NGHIEM','KINH NGHIEM LAM VIEC',
    'الخبرة','الخبرة العملية','الخبرات المهنية','الخبرات',
    'تجربہ','پیشہ ورانہ تجربہ','کام کا تجربہ',
  ],
  projects: [
    'PROYECTOS','PROJETS','PROJEKTE','PROGETTI','PROJETOS','PROJECTOS',
    'PROJECTEN','PROJEKTY','PROJELER',
    '项目','项目经验','项目经历','作品',
    'プロジェクト','制作物','作品',
    '프로젝트','작업',
    'ПРОЕКТЫ',
    'PROYEK','DU AN',
    'المشاريع','الأعمال',
    'منصوبے','پروجیکٹس',
  ],
  skills: [
    'HABILIDADES','COMPETENCIAS','APTITUDES','CONOCIMIENTOS',
    'COMPETENCES','COMPETENCES TECHNIQUES',
    'FAHIGKEITEN','KENNTNISSE','KOMPETENZEN',
    'COMPETENZE','ABILITA',
    'VAARDIGHEDEN','COMPETENTIES',
    'UMIEJETNOSCI','KOMPETENCJE',
    'YETENEKLER','BECERILER','YETKINLIKLER',
    '技能','专业技能','技术技能',
    'スキル','技術',
    '보유 기술','기술','스킬','역량',
    'НАВЫКИ','КЛЮЧЕВЫЕ НАВЫКИ',
    'KEAHLIAN','KETERAMPILAN','KEMAMPUAN',
    'KY NANG',
    'المهارات','المهارات التقنية',
    'مہارتیں','مہارت','تکنیکی مہارتیں',
  ],
  certifications: [
    'CERTIFICACIONES','CERTIFICADOS','CURSOS',
    'CERTIFICATIONS','CERTIFICATS',
    'ZERTIFIKATE','ZERTIFIZIERUNGEN',
    'CERTIFICAZIONI','CERTIFICATI',
    'CERTIFICACOES',
    'CERTIFICATEN','CERTIFICERINGEN',
    'CERTYFIKATY','KURSY',
    'SERTIFIKALAR','SERTIFIKA',
    '证书','培训','资格证书',
    '資格','認定','研修',
    '자격증','수료증',
    'СЕРТИФИКАТЫ','КУРСЫ',
    'SERTIFIKASI','SERTIFIKAT',
    'CHUNG CHI',
    'الشهادات','الدورات','الدورات التدريبية',
    'اسناد','سرٹیفکیٹ','ورکشاپس',
  ],
  awards: [
    'PREMIOS','RECONOCIMIENTOS','LOGROS',
    'DISTINCTIONS','PRIX','RECOMPENSES',
    'AUSZEICHNUNGEN','PREISE',
    'PREMI','RICONOSCIMENTI',
    'PREMIOS E RECONHECIMENTOS',
    'ONDERSCHEIDINGEN','PRIJZEN',
    'WYROZNIENIA','NAGRODY','OSIAGNIECIA',
    'ODULLER','BASARILAR',
    '奖项','获奖','荣誉',
    '受賞歴','受賞',
    '수상 경력','수상',
    'НАГРАДЫ','ДОСТИЖЕНИЯ',
    'PENGHARGAAN','PRESTASI',
    'GIAI THUONG','THANH TICH',
    'الجوائز','التكريم','الإنجازات',
    'اعزازات','انعامات',
  ],
  extracurricular: [
    'ACTIVIDADES EXTRACURRICULARES','ACTIVITES PARASCOLAIRES','AUSSERSCHULISCHE AKTIVITATEN',
    'ATTIVITA EXTRACURRICULARI','ATIVIDADES EXTRACURRICULARES','BUITENSCHOOLSE ACTIVITEITEN',
    'ZAJECIA DODATKOWE','SOSYAL ETKINLIKLER',
    '课外活动','課外活動','교외 활동',
    'ВНЕУЧЕБНАЯ ДЕЯТЕЛЬНОСТЬ','KEGIATAN EKSTRAKURIKULER','HOAT DONG NGOAI KHOA',
    'الأنشطة اللاصفية','الأنشطة',
    'غیر نصابی سرگرمیاں','سرگرمیاں',
  ],
  publications: [
    'PUBLICACIONES','PUBLICATIONS','PUBLIKATIONEN','PUBBLICAZIONI','PUBLICACOES',
    'PUBLICATIES','PUBLIKACJE','YAYINLAR',
    '发表作品','出版物','論文','発表','출판물',
    'ПУБЛИКАЦИИ','PUBLIKASI','CONG BO',
    'المنشورات','مطبوعات',
  ],
  languages: [
    'IDIOMAS','LENGUAS','LANGUES','SPRACHEN','SPRACHKENNTNISSE',
    'LINGUE','TALEN','JEZYKI','DILLER','YABANCI DILLER',
    '语言','语言能力','語学','言語','언어','어학',
    'ЯЗЫКИ','BAHASA','NGON NGU',
    'اللغات','زبانیں',
  ],
  interests: [
    'INTERESES','AFICIONES','CENTRES D INTERET','LOISIRS',
    'INTERESSEN','HOBBYS','INTERESSI','HOBBY',
    'INTERESSES','PASSATEMPOS','ZAINTERESOWANIA',
    'ILGI ALANLARI','HOBILER',
    '兴趣爱好','爱好','兴趣','趣味','興味','관심사','취미',
    'ИНТЕРЕСЫ','УВЛЕЧЕНИЯ','MINAT','HOBI','SO THICH',
    'الاهتمامات','الهوايات','دلچسپیاں','مشاغل',
  ],
  references: [
    'REFERENCIAS','REFERENCES','REFERENZEN','REFERENZE','REFERENCIAS PROFISSIONAIS',
    'REFERENTIES','REFERENCJE','REFERANSLAR',
    '推荐人','推薦者','추천인',
    'РЕКОМЕНДАЦИИ','REFERENSI','NGUOI THAM CHIEU',
    'المراجع','حوالہ جات',
  ],
};

const CV_HEADING_TO_SECTION = Object.entries(CV_SECTION_ALIASES).reduce((acc, [section, aliases]) => {
  aliases.forEach(alias => { acc[normalizeCvHeading(alias)] = section; });
  return acc;
}, {});

// Fold every language's headings into the same lookup, so one code path handles all of them.
Object.entries(CV_SECTION_ALIASES_MULTILINGUAL).forEach(([section, aliases]) => {
  aliases.forEach(alias => {
    const key = normalizeCvHeading(alias);
    if (key) CV_HEADING_TO_SECTION[key] = section;
  });
});

// Longest alias first so a specific multi-word heading (e.g. "SKILLS & TOOLS") is
// preferred over a bare-word substring ("SKILLS") during fuzzy matching.
const CV_SORTED_ALIASES = Object.keys(CV_HEADING_TO_SECTION).sort((a, b) => b.length - a.length);

// Returns { key, trailing } when `line` is (or begins with) a recognized section
// heading, else null. `trailing` captures same-line body after a "HEADING: content"
// style line so that content is not lost.
function matchCvHeading(line = '') {
  const raw = cleanCvLine(line);
  if (!raw) return null;
  const normalized = normalizeCvHeading(raw);
  if (!normalized) return null;

  // 1) "HEADING: trailing content on the same line" — checked FIRST because the content
  //    after the colon can be long (e.g. a full inline skills list), so we must not reject
  //    it on total line length. Only the heading part is length-bounded (via {2,40}).
  //    Guard: only fire when the heading part is ALL-CAPS (how real CV section headings look)
  //    OR a multi-word alias. This prevents a Title-Case skill sub-label such as
  //    "Languages: Python, C++" (which lives INSIDE a Skills block and means programming
  //    languages) from being mistaken for the CV's spoken-"LANGUAGES" section and hijacking
  //    the skills content.
  const split = raw.match(/^([^:：–—-]{2,40})[:：\-–—]\s*(.+)$/);
  if (split) {
    const headRaw = split[1].trim();
    const headPart = normalizeCvHeading(headRaw);
    if (CV_HEADING_TO_SECTION[headPart]) {
      const upperDominant = headRaw === headRaw.toUpperCase() && /[A-Z]/.test(headRaw);
      const multiWord = headPart.split(' ').length >= 2;
      // Arabic, Urdu, Chinese, Japanese and Korean have no upper case at all, so the
      // "is it ALL-CAPS?" test can never fire for them. A caseless heading that matches a
      // known alias IS a heading.
      const caselessScript = !/[A-Za-z]/.test(headRaw);
      if (upperDominant || multiWord || caselessScript) {
        return { key: CV_HEADING_TO_SECTION[headPart], trailing: split[2].trim() };
      }
    }
  }

  if (raw.length > 60) return null;

  if (CV_HEADING_TO_SECTION[normalized]) return { key: CV_HEADING_TO_SECTION[normalized], trailing: '' };
  if (!raw.includes(',') && raw.length <= 44) {
    const headingShaped = raw === raw.toUpperCase() || /^([A-Z][a-zA-Z]*|&)(\s+([A-Z][a-zA-Z]*|and|of|&)){0,5}$/.test(raw);
    if (headingShaped && !/[a-z]{4,}\./.test(raw)) {
      for (const alias of CV_SORTED_ALIASES) {
        if (normalized === alias) continue;
        if (alias.split(' ').length < 2) continue; // single-word aliases are too risky as a PREFIX
        if (normalized.startsWith(alias + ' ')) return { key: CV_HEADING_TO_SECTION[alias], trailing: '' };
      }
      for (const alias of CV_SORTED_ALIASES) {
        if (normalized === alias) continue;
        if (normalized.endsWith(' ' + alias)) return { key: CV_HEADING_TO_SECTION[alias], trailing: '' };
      }
    }
  }

  return null;
}

function cvHeadingKey(line = '') {
  const match = matchCvHeading(line);
  return match ? match.key : '';
}

function isCvSectionHeading(line = '') {
  return Boolean(cvHeadingKey(line));
}

function linesFromCvText(cvText = '') {
  return String(cvText || '')
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(cleanCvLine)
    .filter(Boolean)
    .filter(line => !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line));
}

// Join a heading split across two consecutive PDF lines (e.g. "TECHNICAL" / "SKILLS")
// when neither line alone is a heading but the two together are.
function joinWrappedCvHeadings(lines = []) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const current = lines[i];
    const next = lines[i + 1];
    if (next && !isCvSectionHeading(current)) {
      const combined = `${current} ${next}`.trim();
      if (combined.length <= 40 && CV_HEADING_TO_SECTION[normalizeCvHeading(combined)]) {
        out.push(combined);
        i += 1; // consume the wrapped second line
        continue;
      }
    }
    out.push(current);
  }
  return out;
}

// A heading that is not in any alias table — in any of the 15 languages — used to be treated
// as body text and swallowed by whatever section came before it. That is how "PROFILE SUMMARY"
// and "MEMBERSHIPS" ended up inside the Awards description. No alias list can ever be complete,
// so recognise heading SHAPE as a fallback: short, all-caps (or a caseless script such as
// Arabic/Urdu/Chinese), no digits, no punctuation, 1-4 words, and actually followed by content.
// Guards are deliberately tight so skill lines ("HTML CSS", "REACT") and credential abbreviations
// ("MBBS", "ACLS", "FCPS") are never promoted to sections.
function looksLikeUnknownCvHeading(line = '', nextLine = '') {
  const raw = cleanCvLine(line);
  if (!raw || raw.length < 4 || raw.length > 40) return false;
  if (/[,.;:()\/@]/.test(raw)) return false;
  if (/\d/.test(raw)) return false;
  if (/^[\u2022\-*]/.test(raw)) return false;
  const hasLatin = /[A-Za-z]/.test(raw);
  if (hasLatin && raw !== raw.toUpperCase()) return false;
  const words = raw.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return false;
  if (hasLatin) {
    const longestWord = Math.max(...words.map(word => word.replace(/[^\p{L}]/gu, '').length));
    if (words.length === 1 ? longestWord < 6 : longestWord < 5) return false;
  }
  const next = cleanCvLine(nextLine);
  if (!next || looksLikeUnknownCvHeading(next)) return false;
  return true;
}

function cvSectionsFromLines(rawLines = []) {
  const lines = joinWrappedCvHeadings(rawLines);
  const sections = {};
  let currentKey = null;

  lines.forEach((line, index) => {
    const match = matchCvHeading(line);
    if (match) {
      currentKey = match.key;
      if (!sections[currentKey]) sections[currentKey] = [];
      if (match.trailing) sections[currentKey].push(match.trailing);
      return;
    }
    if (looksLikeUnknownCvHeading(line, lines[index + 1])) {
      currentKey = 'custom:' + cleanCvLine(line);
      if (!sections[currentKey]) sections[currentKey] = [];
      return;
    }
    if (currentKey) sections[currentKey].push(line);
  });

  return sections;
}

function normalizeCvUrl(value = '') {
  let url = String(value || '').trim();
  if (!url) return '';
  url = url.replace(/[),.;\]\s]+$/g, '');
  if (/^mailto:/i.test(url)) return url;
  if (/^www\./i.test(url)) url = `https://${url}`;
  if (!/^https?:\/\//i.test(url) && /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/|$)/.test(url)) {
    url = `https://${url}`;
  }
  return /^https?:\/\//i.test(url) ? url : '';
}

function extractVisibleUrls(value = '') {
  const pattern = /(?:https?:\/\/)?(?:www\.)?(?:github\.com|linkedin\.com|behance\.net|youtube\.com|youtu\.be|instagram\.com|portfolio\.|[a-zA-Z0-9-]+\.(?:com|dev|io|app|net|org))\/[\w./?%&=\-#]+/gi;
  return uniq((String(value || '').match(pattern) || []).map(normalizeCvUrl).filter(Boolean));
}

function isGithubRepoUrl(url = '') {
  return /^https?:\/\/(www\.)?github\.com\/[^/\s]+\/[^/\s]+/i.test(String(url || ''));
}

function isGithubProfileUrl(url = '') {
  return /^https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9_.-]+\/?$/i.test(String(url || '').replace(/\/$/, ''));
}

function isLinkedInUrl(url = '') {
  return /linkedin\.com\/in\//i.test(String(url || ''));
}

function isContactLevelCvUrl(url = '') {
  const clean = String(url || '').toLowerCase();
  return clean.startsWith('mailto:') || isGithubProfileUrl(clean) || isLinkedInUrl(clean) || /github\.io\/?$/i.test(clean);
}

function sortEmbeddedCvLinksReadingOrder(items = []) {
  return [...items].sort((a, b) => {
    if ((a.page || 0) !== (b.page || 0)) return (a.page || 0) - (b.page || 0);
    // PDF coordinate space has (0,0) at the BOTTOM-left, so a LARGER y is HIGHER on the
    // page. Reading order is top-to-bottom, which means descending y within a page.
    // (The previous ascending sort read links bottom-up and mis-assigned them.)
    if (Math.abs((a.y || 0) - (b.y || 0)) > 1) return (b.y || 0) - (a.y || 0);
    return (a.x || 0) - (b.x || 0);
  });
}


function decodePdfLiteralString(value = '') {
  return String(value)
    .replace(/\\([nrtbf()\\])/g, (match, ch) => {
      if (ch === 'n') return '\n';
      if (ch === 'r') return '\r';
      if (ch === 't') return '\t';
      if (ch === 'b') return '\b';
      if (ch === 'f') return '\f';
      return ch;
    })
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function decodePdfHexString(hex = '') {
  const clean = String(hex).replace(/\s+/g, '');
  let out = '';
  for (let i = 0; i < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (!Number.isNaN(code)) out += String.fromCharCode(code);
  }
  return out;
}

function normalizeExtractedPdfUrl(url = '') {
  let clean = String(url || '').trim();
  clean = clean.replace(/^mailto:/i, 'mailto:');
  clean = clean.replace(/[)\]}>.,;'"\\\s]+$/g, '');
  clean = clean.replace(/^[<('"\\\s]+/g, '');
  return clean;
}

function extractCvEmbeddedLinksFromRawPdfBuffer(buffer) {
  const raw = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : Buffer.from(buffer || []).toString('latin1');
  const links = [];

  const pushLink = (url, text = '') => {
    const clean = normalizeExtractedPdfUrl(url);
    if (!clean) return;
    if (!/^(https?:\/\/|mailto:)/i.test(clean)) return;

    // Ignore PDF metadata namespace URLs captured by raw-byte fallback.
    // These are not user CV links.
    if (/^https?:\/\/(www\.)?w3\.org\//i.test(clean)) return;
    if (/^https?:\/\/ns\.adobe\.com\//i.test(clean)) return;
    if (/^https?:\/\/purl\.org\//i.test(clean)) return;
    if (/^https?:\/\/schemas?\.openxmlformats\.org\//i.test(clean)) return;
    if (/rdf-syntax|xmp|pdf\/1\.[0-9]/i.test(clean)) return;
    if (links.some(item => item.url === clean)) return;
    links.push({ url: clean, text: text || clean, page: null, source: 'raw-pdf-uri' });
  };

  // PDF annotation format: /URI (https://...)
  const literalUriPattern = /\/URI\s*\(((?:\\.|[^\\)])*)\)/g;
  let match;
  while ((match = literalUriPattern.exec(raw)) !== null) {
    pushLink(decodePdfLiteralString(match[1]));
  }

  // PDF annotation format: /URI <68747470733A2F2F...>
  const hexUriPattern = /\/URI\s*<([0-9A-Fa-f\s]+)>/g;
  while ((match = hexUriPattern.exec(raw)) !== null) {
    pushLink(decodePdfHexString(match[1]));
  }

  // Safety fallback for plain URLs embedded anywhere in the PDF bytes
  const plainUrlPattern = /(https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+|mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  while ((match = plainUrlPattern.exec(raw)) !== null) {
    pushLink(match[1]);
  }

  return links;
}

// PDF.js refuses to run when its API and its Worker come from different installs of pdfjs-dist.
// The old code resolved the API with require() and the worker with a SEPARATE require.resolve(),
// so Node was free to pick two different copies (one hoisted at the project root, one in backend).
// The worker path is now derived from the directory the API itself was loaded from, so they can
// never disagree — and the worker is disabled anyway, which removes the failure mode entirely.
let _pdfjsCache;
function loadPdfjsWithMatchingWorker() {
  if (_pdfjsCache !== undefined) return _pdfjsCache;

  const path = require('path');
  const fs = require('fs');
  const entries = [
    'pdfjs-dist/legacy/build/pdf.js',
    'pdfjs-dist/build/pdf.js',
    'pdfjs-dist/legacy/build/pdf.cjs',
  ];

  for (const entry of entries) {
    let resolved;
    try { resolved = require.resolve(entry); } catch (_) { continue; }

    let lib;
    try { lib = require(resolved); } catch (_) { continue; }
    const api = (lib && lib.getDocument) ? lib : (lib && lib.default && lib.default.getDocument ? lib.default : null);
    if (!api) continue;

    if (api.GlobalWorkerOptions) {
      // Same folder as the API => same version, guaranteed.
      const sameDirWorker = path.join(path.dirname(resolved), 'pdf.worker.js');
      if (fs.existsSync(sameDirWorker)) api.GlobalWorkerOptions.workerSrc = sameDirWorker;
      else api.GlobalWorkerOptions.workerSrc = '';
    }
    console.log('pdfjs loaded from', JSON.stringify({ path: resolved, version: api.version || 'unknown' }));
    _pdfjsCache = api;
    return api;
  }

  _pdfjsCache = null;
  return null;
}

async function extractCvEmbeddedLinksFromPdfBuffer(buffer) {
  try {
    const pdfjsLib = loadPdfjsWithMatchingWorker();
    if (!pdfjsLib) {
      console.warn('pdfjs-dist not usable; embedded CV links skipped.');
      return [];
    }

    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      // Run PDF.js on this thread. In Node there is nothing to gain from a worker, and a worker is
      // exactly what produced "The API version 3.11.174 does not match the Worker version 5.4.296"
      // — which silently threw away every embedded link in the CV.
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;

    const results = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const annotations = await page.getAnnotations({ intent: 'display' });
      for (const annotation of annotations || []) {
        const url = normalizeCvUrl(annotation.url || annotation.unsafeUrl || '');
        if (!url) continue;
        const rect = Array.isArray(annotation.rect) ? annotation.rect.map(Number) : [];
        results.push({
          page: pageNumber,
          x: rect.length >= 4 ? Math.min(rect[0], rect[2]) : 0,
          y: rect.length >= 4 ? Math.max(rect[1], rect[3]) : 0,
          url,
        });
      }
    }

    return sortEmbeddedCvLinksReadingOrder(results);
  } catch (error) {
    console.warn('Embedded CV link extraction failed:', error.message);
    const rawLinks = extractCvEmbeddedLinksFromRawPdfBuffer(buffer);
    if (rawLinks.length) console.warn('Recovered embedded CV links from raw PDF:', rawLinks.length);
    return rawLinks;
  }
}

// A real name is not a single stray glyph, a row of dashes, or a Docling "<!-- image -->"
// placeholder. Without this guard the first junk line in the extracted text became the creator's
// name — which is exactly how a CV once came back with the name "ک".
function looksLikeCvNameLine(value = '') {
  const text = cleanCvLine(value);
  if (!text) return false;
  if (text.length < 3 || text.length > 80) return false;
  if (/<!--|-->/.test(text)) return false;
  if (/^[-–—_=*·•|~^#>\s.,:;'"()\[\]]+$/.test(text)) return false;
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (letters < 2) return false;                 // a single letter is a glyph, not a name
  if (letters / text.length < 0.4) return false; // mostly punctuation
  return true;
}

function extractNameAndMedium(lines = []) {
  let name = '';
  let medium = '';

  for (let i = 0; i < Math.min(lines.length, 14); i += 1) {
    const line = cleanCvLine(lines[i]);
    if (!line || isCvSectionHeading(line)) continue;
    if (/@|\|/.test(line) || /\+?\d[\d\s().-]{6,}/.test(line)) continue;
    if (!looksLikeCvNameLine(line)) continue;

    name = line;
    for (const next of lines.slice(i + 1, i + 5)) {
      const candidate = cleanCvLine(next);
      if (!candidate || isCvSectionHeading(candidate)) break;
      if (/@|\|/.test(candidate) || /\+?\d[\d\s().-]{6,}/.test(candidate)) continue;
      if (!looksLikeCvNameLine(candidate)) continue;
      if (candidate.length < 70) {
        medium = candidate;
        break;
      }
    }
    break;
  }

  return { name, medium };
}

// How much did we actually recover from this text? Used to pick between the Docling extraction and
// the local PDF extraction instead of trusting Docling blindly.
function cvParseQuality(parsed) {
  if (!parsed) return -1;
  let score = 0;
  if (parsed.name && parsed.name.length >= 3) score += 4;
  if (parsed.medium) score += 2;
  score += Math.min((parsed.skills || []).length, 12);
  score += Math.min((parsed.projects || []).length * 3, 15);
  score += (parsed.customSections || []).reduce(
    (total, section) => total + 3 + Math.min((section.items || []).length, 6), 0);
  if (cleanText(parsed.description || '').length > 40) score += 2;
  return score;
}

function parseCvContact(fullText = '', embeddedLinks = []) {
  const text = preprocessText(fullText);
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = text.match(/(?:\+?\d[\d\s().-]{8,}\d)/);
  const urls = [
    ...embeddedLinks.map(item => normalizeCvUrl(item.url)).filter(Boolean),
    ...extractVisibleUrls(text),
  ];

  const github = urls.find(isGithubProfileUrl) || null;
  const linkedin = urls.find(isLinkedInUrl) || null;
  const portfolio = urls.find(url => /github\.io\/?$/i.test(String(url))) || null;

  const contact = {
    email: emailMatch ? emailMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0].trim() : null,
    whatsapp: phoneMatch ? phoneMatch[0].trim() : null,
    github,
    linkedin,
    address: null,
    links: [],
  };

  if (portfolio) contact.links.push({ label: 'Portfolio', url: portfolio });

  const addressMatch = text.match(/\|\s*([^|\n]*,\s*[A-Za-z ]+)\s*(?:\n|$)/);
  if (addressMatch) contact.address = cleanCvLine(addressMatch[1]);

  return contact;
}

function isCvBullet(line = '') {
  const clean = cleanCvLine(line);
  return /^[•\u2022\-*]\s*/.test(clean) || ['•', '-', '*'].includes(clean);
}

const CV_TECH_WORDS = /\b(React|Node|Express|Groq|API|MERN|Stack|Oracle|PL\/SQL|Python|Librosa|Scikit|learn|JavaScript|WebRTC|C\+\+|AES|Kyber|SQL|MongoDB|Vercel|Railway|HTML|CSS)\b/i;

function isTechStackLine(line = '') {
  const clean = cleanCvLine(line);
  if (clean.length > 120) return false;
  return Boolean((clean.includes('|') || clean.includes(',')) && CV_TECH_WORDS.test(clean));
}

function cvLineIsDateOnly(value = '') {
  const text = cleanCvLine(value).replace(/[\u2013\u2014]/g, '-');
  if (!text) return false;
  return /^(present|current|ongoing|since)?[\s.,-]*((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*)?\d{2,4}(\s*[-\u2013to]+\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*)?(\d{2,4}|present|current|date|now))?[\s.,-]*$/i.test(text);
}

function cvLineIsContinuation(line = '', previous = '') {
  const text = cleanCvLine(line);
  const prev = cleanCvLine(previous);
  if (!text || !prev) return false;
  if (/^[a-z\u00DF-\u00FF]/.test(text)) return true;
  if (/[,&:;\/]$/.test(prev) || /\b(and|with|of|for|at|in|the)$/i.test(prev)) return true;
  if (cvLineIsDateOnly(text)) return true;
  return false;
}

function bulletItemsFromLines(lines = []) {
  const cleaned = lines.map(cleanCvLine).filter(line => line && !isCvSectionHeading(line));
  const hasBullets = cleaned.some(line => /^[\u2022\-*]/.test(line));

  // A section with NO bullet characters used to collapse into ONE item, because the only
  // split signal was a bullet. That is exactly what Docling table rows produce, so every
  // certification, publication and language merged into a single blob. Split per line and
  // merge only genuine continuations. The " - " join lets splitHeadingDesc() pair a detail
  // line with its entry line as heading + desc, with no downstream change.
  if (!hasBullets) {
    const out = [];
    for (const line of cleaned) {
      if (out.length && cvLineIsContinuation(line, out[out.length - 1])) {
        const joiner = cvLineIsDateOnly(line) || /^[a-z\u00DF-\u00FF]/.test(line) ? ' ' : ' - ';
        out[out.length - 1] += joiner + line;
        continue;
      }
      out.push(line);
    }
    return out.filter(item => item.length > 2);
  }

  const items = [];
  let current = '';

  for (const rawLine of lines) {
    const line = cleanCvLine(rawLine);
    if (!line || isCvSectionHeading(line)) continue;

    if (['•', '-', '*'].includes(line)) {
      if (current) items.push(current.trim());
      current = '';
      continue;
    }

    if (/^[•\u2022\-*]\s*/.test(line)) {
      if (current) items.push(current.trim());
      current = stripCvBullet(line);
      continue;
    }

    if (current) current += ` ${line}`;
    else current = line;
  }

  if (current) items.push(current.trim());
  return items.filter(item => item.length > 2);
}

function parseCvSkills(skillLines = []) {
  // IMPORTANT: process each line independently (do NOT merge consecutive lines) so that
  // category-labeled blocks like:
  //   Languages: Python, C++
  //   Frameworks: React, Node.js
  // don't fuse into a corrupt token such as "C++ Frameworks: React".
  const rawLines = skillLines
    .map(cleanCvLine)
    .map(stripCvBullet)
    .filter(Boolean)
    .filter(line => !isCvSectionHeading(line));

  const skills = [];
  const pushToken = (part) => {
    let item = cleanCvLine(part)
      .replace(/^[-–—•*\s]+/, '')
      .replace(/[.,;:]+$/, '')
      .trim();
    if (!item) return;
    if (item.length < 2 || item.length > 60) return;
    if (/^(and|with|basic|including|etc|other|others|proficient|familiar|advanced|intermediate|beginner|expert)$/i.test(item)) return;
    skills.push(item);
  };

  rawLines.forEach(line => {
    // Strip category labels ("Word:" or "Word & Word:") only when they precede a
    // comma-separated list, so real skills like "C++: Advanced" are not eaten.
    // "/" is intentionally NOT a separator so "UI/UX", "PL/SQL", "Node.js" stay intact.
    // Strip a category label in ANY script ("Languages:", "编程语言：", "اللغات:") when it
    // precedes a list. Then split on the separators those scripts actually use:
    // Latin , ; |   Arabic/Urdu ،   Chinese/Japanese 、 ，   plus the bullet.
    const work = line.replace(/(^|\s)([\p{L}][\p{L} &/+#.-]{1,24})[:：]\s*(?=[^:：]*[,،、，])/gu, '$1');
    work.split(/[,|;\u060C\u3001\uFF0C\uFF1B\u2022]/g).forEach(pushToken);
  });

  return uniq(skills).slice(0, 60);
}

function projectTitleCandidate(line = '', nextLines = []) {
  const clean = stripCvBullet(line);
  if (!clean || isCvSectionHeading(clean)) return false;
  if (clean.length < 3 || clean.length > 120) return false;
  if (/^(?:19|20)\d{2}(?:\s*[–-]\s*(?:Present|(?:19|20)\d{2}))?$/i.test(clean)) return false;
  if (!/^[A-Z0-9]/.test(clean)) return false;
  if (/[.!?]$/.test(clean)) return false;
  if (/@|https?:\/\/|github\.com|linkedin\.com/i.test(clean)) return false;
  if (isTechStackLine(clean)) return false;
  if (/^(Built|Developed|Implemented|Designed|Optimized|Achieved|Demonstrated|Encrypted|Deployed|Engineered|Collaborated|Completed|Learned|Explored|Cleared|Active|Volunteer|Reduced)\b/i.test(clean)) return false;

  const significant = nextLines.map(cleanCvLine).filter(Boolean).slice(0, 4);
  if (!significant.length) return false;
  if (significant.slice(0, 3).some(isCvBullet)) return true;
  if (isTechStackLine(significant[0]) && significant.slice(1, 4).some(isCvBullet)) return true;
  if (/^(?:19|20)\d{2}$/i.test(significant[0]) && (isTechStackLine(significant[1] || '') || significant.slice(1, 4).some(isCvBullet))) return true;
  return false;
}

function projectLinksFromSection(projectLines = [], embeddedLinks = []) {
  const visible = extractVisibleUrls(projectLines.join('\n')).filter(isGithubRepoUrl);
  const embedded = sortEmbeddedCvLinksReadingOrder(embeddedLinks)
    .map(item => normalizeCvUrl(item.url))
    .filter(isGithubRepoUrl);

  return uniq([...visible, ...embedded]);
}

function parseCvProjects(projectLines = [], embeddedLinks = []) {
  const lines = projectLines.map(cleanCvLine).filter(Boolean);
  const projects = [];
  let currentTitle = '';
  let descParts = [];

  const finishProject = () => {
    if (!currentTitle) return;
    let desc = cleanCvLine(descParts.filter(Boolean).join(' '));
    desc = desc.replace(/(?:https?:\/\/)?(?:www\.)?(?:github\.com|linkedin\.com|[\w.-]+\.(?:com|dev|io|app|net|org))\/[\w./?%&=\-#]+/gi, '').trim();
    desc = desc.replace(/^[|.\-\s]+|[|.\-\s]+$/g, '');
    projects.push({ title: currentTitle, desc, link: null });
    currentTitle = '';
    descParts = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (isCvBullet(rawLine) && ['•', '-', '*'].includes(rawLine.trim())) continue;

    const line = stripCvBullet(rawLine);
    const nextLines = lines.slice(i + 1, i + 5);

    if (projectTitleCandidate(line, nextLines) && (!currentTitle || descParts.length)) {
      finishProject();
      currentTitle = line;
      if (i + 1 < lines.length && /^(?:19|20)\d{2}$/i.test(lines[i + 1].trim())) {
        currentTitle += ` ${lines[i + 1].trim()}`;
        i += 1;
      }
      continue;
    }

    if (!currentTitle) {
      if (!isTechStackLine(line) && !/^(Built|Developed|Implemented|Designed|Optimized|Achieved)\b/i.test(line)) {
        currentTitle = line;
      } else {
        descParts.push(line);
      }
    } else {
      descParts.push(line);
    }
  }

  finishProject();

  const projectLinks = projectLinksFromSection(projectLines, embeddedLinks);
  let projectLinkIndex = 0;
  const used = new Set();

  return projects.slice(0, 12).map(project => {
    const combined = `${project.title} ${project.desc}`.toLowerCase();
    let link = projectLinks.find(url => combined.includes(url.toLowerCase()) && !used.has(url.toLowerCase())) || null;
    if (!link) {
      while (projectLinkIndex < projectLinks.length && used.has(projectLinks[projectLinkIndex].toLowerCase())) {
        projectLinkIndex += 1;
      }
      if (projectLinkIndex < projectLinks.length) {
        link = projectLinks[projectLinkIndex];
        projectLinkIndex += 1;
      }
    }
    if (link) used.add(link.toLowerCase());
    return { ...project, link: link || null };
  }).filter(project => project.title);
}

function splitHeadingDesc(item = '') {
  const clean = cleanCvLine(item);
  if (!clean) return { heading: '', desc: '' };
  for (const sep of ['—', ' – ', ' - ', ' — ']) {
    if (clean.includes(sep)) {
      const idx = clean.indexOf(sep);
      const heading = cleanCvLine(clean.slice(0, idx));
      const desc = cleanCvLine(clean.slice(idx + sep.length));
      if (heading && desc) return { heading, desc };
    }
  }

  if (clean.includes(':') && clean.split(':')[0].length < 90) {
    const [head, ...rest] = clean.split(':');
    return { heading: cleanCvLine(head), desc: cleanCvLine(rest.join(':')) };
  }

  if (clean.length <= 120) return { heading: clean, desc: '' };
  const cut = clean.lastIndexOf(' ', 120);
  const at = cut > 40 ? cut : 120;
  return { heading: cleanCvLine(clean.slice(0, at)), desc: cleanCvLine(clean.slice(at)) };
}

// A certificate proof URL virtually always has a path (coursera.org/verify/..., credly.com/badges/...).
// A bare homepage (https://ayesha.dev) is page furniture — a header/footer portfolio link. Letting one
// into the proof pool used to shift every certificate onto the wrong URL.
function hasProofLikePath(url = '') {
  const value = String(url || '');
  try {
    const path = (new URL(value).pathname || '').replace(/\/+$/, '');
    return path.length > 1;
  } catch (_) {
    return /\/[^/]+/.test(value.replace(/^https?:\/\/[^/]+/i, ''));
  }
}

function proofLinksFromEmbedded(embeddedLinks = []) {
  // uniq() dedupes case-insensitively so a repeated header/footer portfolio link does not
  // consume the sequential "proof link" slots meant for certificates/competition pages.
  return uniq(sortEmbeddedCvLinksReadingOrder(embeddedLinks)
    .map(item => normalizeCvUrl(item.url))
    .filter(Boolean)
    .filter(url => !isContactLevelCvUrl(url) && !isGithubRepoUrl(url))
    .filter(hasProofLikePath));
}

const LINK_MATCH_STOPWORDS = new Set([
  'www', 'com', 'org', 'net', 'edu', 'http', 'https', 'verify', 'verification', 'certificate',
  'certificates', 'cert', 'credential', 'credentials', 'badge', 'badges', 'course', 'courses',
  'profile', 'user', 'users', 'share', 'view', 'public', 'online', 'completion', 'record',
  'pdf', 'html', 'index', 'the', 'and', 'for', 'with', 'file', 'drive', 'google', 'docs',
]);

function tokensForLinkMatch(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !LINK_MATCH_STOPWORDS.has(token));
}

function scoreLinkAgainstItem(itemText = '', url = '') {
  const itemTokens = [...new Set(tokensForLinkMatch(itemText))];
  if (!itemTokens.length) return 0;
  const urlTokens = tokensForLinkMatch(url);
  let score = 0;
  for (const urlToken of urlTokens) {
    if (itemTokens.includes(urlToken)) score += 2;
    else if (itemTokens.some(token => token.length >= 4 && urlToken.length >= 4
      && (token.includes(urlToken) || urlToken.includes(token)))) score += 1;
  }
  return score;
}

// Match each certificate to the link that actually belongs to it (token overlap between the
// certificate text and the URL), instead of handing the Nth link to the Nth item. One stray
// link used to push every certificate onto someone else's URL — the worst possible failure for
// a product whose promise is "no unsupported claims". Unmatched items fall back to reading order.
function matchProofLinksByContent(items = [], proofLinks = []) {
  const assigned = new Array(items.length).fill(null);
  const usedUrls = new Set();

  const pairs = [];
  items.forEach((item, index) => {
    proofLinks.forEach(url => {
      const score = scoreLinkAgainstItem(`${item.heading || ''} ${item.desc || ''}`, url);
      if (score > 0) pairs.push({ index, url, score });
    });
  });
  pairs.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  for (const pair of pairs) {
    if (assigned[pair.index] || usedUrls.has(pair.url)) continue;
    assigned[pair.index] = pair.url;
    usedUrls.add(pair.url);
  }
  return assigned;
}

function assignProofLinks(items = [], proofLinks = []) {
  const assigned = matchProofLinksByContent(items, proofLinks);
  const usedUrls = new Set(assigned.filter(Boolean));

  // Items with no content match fall back to reading order over the links nobody claimed.
  const leftovers = proofLinks.filter(url => !usedUrls.has(url));
  let next = 0;
  for (let index = 0; index < assigned.length; index += 1) {
    if (assigned[index] || next >= leftovers.length) continue;
    assigned[index] = leftovers[next];
    next += 1;
  }
  return assigned;
}

function parseCvEducation(educationLines = []) {
  const raw = educationLines.map(line => stripCvBullet(line)).map(cleanCvLine).filter(Boolean);
  if (!raw.length) return [];

  const degreeRegex = /\b(BS|B\.?S\.?|Bachelor|BSc|MS|M\.?S\.?|Master|PhD|Computer Science|Software Engineering|Engineering)\b/i;
  let degreeIndex = raw.findIndex(line => /\b(BS|B\.?S\.?|Bachelor|BSc|MS|M\.?S\.?|Master|PhD)\b/i.test(line));
  if (degreeIndex < 0) degreeIndex = raw.findIndex(line => degreeRegex.test(line));
  if (degreeIndex < 0) degreeIndex = 0;

  const degreeLine = raw[degreeIndex] || '';
  const datePattern = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\.?\s*(?:19|20)\d{2}\s*(?:[–-]\s*(?:Present|(?:19|20)\d{2}))?/gi;
  const dates = raw.flatMap(line => line.match(datePattern) || []);
  let heading = cleanCvLine(degreeLine.split('|')[0]).replace(datePattern, '').replace(/^[|,\-\s]+|[|,\-\s]+$/g, '');
  if (!heading) heading = degreeLine;

  const institution = [];
  const details = [];

  raw.forEach((line, index) => {
    if (index === degreeIndex) {
      const parts = line.split('|');
      if (parts.length > 1) details.push(parts.slice(1).join('|').trim());
      return;
    }

    if (/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\.?\s*(?:19|20)\d{2}\s*(?:[–-]\s*(?:Present|(?:19|20)\d{2}))?$/i.test(line)) return;
    if (index < degreeIndex) institution.push(line);
    else details.push(line);
  });

  const descParts = [];
  if (institution.length) descParts.push(institution.join(' '));
  if (dates.length) descParts.push(dates.join(' '));
  if (details.length) descParts.push(details.join(' '));

  return [{ heading, desc: cleanCvLine(descParts.join('. ')), link: null }];
}

function parseCvExperience(experienceLines = []) {
  const raw = experienceLines
    .map(line => stripCvBullet(line))
    .map(cleanCvLine)
    .filter(Boolean);

  if (!raw.length) return [];

  const actionVerbRegex = /^(Designed|Collaborated|Built|Developed|Implemented|Created|Managed|Led|Worked|Improved|Used|Learned|Assisted|Conducted|Handled|Supported|Maintained|Resolved|Prepared|Presented|Wrote|Fixed|Optimized|Tested|Integrated|Configured)\b/i;

  const roleRegex = /\b(Intern|Internship|Engineer|Developer|Designer|Assistant|Manager|Analyst|Officer|Specialist|Trainee|Coordinator|Volunteer|Researcher|Teacher|Tutor|Consultant|Lead|Head|Member|Representative)\b/i;

  const companyOrDateRegex = /\b(at|@)\b|[—–-]|\b(Pvt|Ltd|Limited|Inc|Company|Bank|Labs|Studio|University|School|College|Institute|SNGPL|MCB|COMSATS|NUST|SEECS)\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*(?:19|20)?\d{0,4}\b|\b(?:19|20)\d{2}\b/i;

  const looksLikeExperienceHeader = (line = '', allowLoose = false) => {
    const clean = cleanCvLine(stripCvBullet(line));
    if (!clean) return false;
    if (clean.length > 190) return false;
    if (actionVerbRegex.test(clean)) return false;
    if (/^(Responsibilities|Key Responsibilities|Achievements|Tasks|Duties)$/i.test(clean)) return false;

    const hasRole = roleRegex.test(clean);
    const hasCompanyOrDate = companyOrDateRegex.test(clean);

    if (hasRole && hasCompanyOrDate) return true;
    if (allowLoose && hasRole && /intern|engineer|developer|designer|assistant|analyst|manager/i.test(clean)) return true;

    return false;
  };

  const isLikelyTitleFragment = (line = '') => {
    const clean = cleanCvLine(stripCvBullet(line));
    if (!clean) return false;
    if (clean.length > 45) return false;
    if (actionVerbRegex.test(clean)) return false;
    if (companyOrDateRegex.test(clean)) return false;
    if (/@|https?:\/\/|www\.|github\.com|linkedin\.com/i.test(clean)) return false;
    if (/[.!?]$/.test(clean)) return false;

    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length > 4) return false;

    return /^[A-Za-z][A-Za-z0-9+#/&.\s-]*$/.test(clean);
  };

  const hasHeaderSoon = (index) => {
    for (let j = index + 1; j < Math.min(raw.length, index + 4); j++) {
      if (looksLikeExperienceHeader(raw[j], true)) return true;
    }
    return false;
  };

  // Fix PDF line breaks like:
  // Web
  // Development
  // Intern — Company
  // => Web Development Intern — Company
  const normalized = [];
  let pendingTitleFragments = [];

  raw.forEach((line, index) => {
    const clean = cleanCvLine(line);
    if (!clean) return;

    if (looksLikeExperienceHeader(clean, true)) {
      const prefix = pendingTitleFragments.join(' ').trim();
      normalized.push(prefix ? cleanCvLine(prefix + ' ' + clean) : clean);
      pendingTitleFragments = [];
      return;
    }

    if (isLikelyTitleFragment(clean) && hasHeaderSoon(index)) {
      pendingTitleFragments.push(clean);
      return;
    }

    if (pendingTitleFragments.length) {
      normalized.push(pendingTitleFragments.join(' '));
      pendingTitleFragments = [];
    }

    normalized.push(clean);
  });

  if (pendingTitleFragments.length) {
    normalized.push(pendingTitleFragments.join(' '));
  }

  const items = [];
  let current = null;

  normalized.forEach((line, index) => {
    const clean = cleanCvLine(line);
    if (!clean) return;

    if (looksLikeExperienceHeader(clean, index === 0)) {
      if (current) items.push(current);
      current = {
        heading: clean.replace(/\s*[.]$/, ''),
        descParts: [],
        link: null
      };
      return;
    }

    if (!current) {
      current = {
        heading: clean.replace(/\s*[.]$/, ''),
        descParts: [],
        link: null
      };
      return;
    }

    current.descParts.push(clean);
  });

  if (current) items.push(current);

  return items
    .map(item => ({
      heading: cleanCvLine(item.heading || ''),
      desc: cleanCvLine((item.descParts || []).join(' ')),
      link: item.link || null
    }))
    .filter(item => item.heading)
    .slice(0, 12);
}





function parseCvCustomSections(sections = {}, embeddedLinks = []) {
  const customSections = [];

  const educationItems = parseCvEducation(sections.education || []);
  if (educationItems.length) customSections.push({ name: 'Education', items: educationItems });

  const experienceItems = parseCvExperience(sections.experience || []);
  if (experienceItems.length) customSections.push({ name: 'Experience', items: experienceItems });

  // One shared pool of verification links, consumed as sections claim them. Certifications get
  // first pick (content match, then reading order); awards/activities then take only links that
  // genuinely match their text, so an unrelated link is never pinned to an award.
  const remainingProofLinks = proofLinksFromEmbedded(embeddedLinks);

  const attachProofLinks = (parsedItems, pool, { matchedOnly = false } = {}) => {
    const links = matchedOnly
      ? matchProofLinksByContent(parsedItems, pool)
      : assignProofLinks(parsedItems, pool);
    const claimed = new Set(links.filter(Boolean));
    for (let i = pool.length - 1; i >= 0; i -= 1) {
      if (claimed.has(pool[i])) pool.splice(i, 1);
    }
    return parsedItems.map((item, index) => ({ ...item, link: links[index] || null }));
  };

  if (Array.isArray(sections.certifications) && sections.certifications.length) {
    const parsed = bulletItemsFromLines(sections.certifications).map(item => {
      const { heading, desc } = splitHeadingDesc(item);
      return { heading, desc, link: null };
    });
    const items = attachProofLinks(parsed, remainingProofLinks);
    if (items.length) customSections.push({ name: 'Workshops & Certifications', items });
  }

  // Awards and activities carry verification links too (competition pages, badge URLs). They used
  // to be hard-coded to null, so any such link was parsed and then thrown away. They now draw from
  // the same pool, by content match, so an embedded link is never silently discarded.
  if (Array.isArray(sections.awards) && sections.awards.length) {
    const parsed = bulletItemsFromLines(sections.awards).map(item => {
      const { heading, desc } = splitHeadingDesc(item);
      return { heading, desc, link: null };
    });
    const items = attachProofLinks(parsed, remainingProofLinks, { matchedOnly: true });
    if (items.length) customSections.push({ name: 'Awards', items });
  }

  if (Array.isArray(sections.extracurricular) && sections.extracurricular.length) {
    const parsed = bulletItemsFromLines(sections.extracurricular).map(item => {
      const { heading, desc } = splitHeadingDesc(item);
      return { heading, desc, link: null };
    });
    const items = attachProofLinks(parsed, remainingProofLinks, { matchedOnly: true });
    if (items.length) customSections.push({ name: 'Extracurricular Activities', items });
  }

  // Previously-dropped sections. Languages/Interests are usually short CSV lines, so we
  // split them into individual items; Publications/References keep whole lines intact
  // (commas inside a citation or a reference contact must not be split).
  const commaSplitSections = new Set(['languages', 'interests']);
  const simpleListSections = [
    { key: 'publications', name: 'Publications' },
    { key: 'languages', name: 'Languages' },
    { key: 'interests', name: 'Interests' },
    { key: 'references', name: 'References' },
  ];

  simpleListSections.forEach(({ key, name }) => {
    const raw = sections[key];
    if (!Array.isArray(raw) || !raw.length) return;

    let items;
    if (commaSplitSections.has(key)) {
      const tokens = [];
      bulletItemsFromLines(raw).forEach(entry => {
        entry.split(/[,;|\u2022]/g).map(cleanCvLine).filter(Boolean).forEach(token => {
          if (token.length >= 2 && token.length <= 60) tokens.push(token);
        });
      });
      items = uniq(tokens).map(token => ({ heading: token, desc: '', link: null }));
    } else {
      items = bulletItemsFromLines(raw).map(item => {
        const { heading, desc } = splitHeadingDesc(item);
        return { heading, desc, link: null };
      });
    }

    if (items.length) customSections.push({ name, items });
  });

  const titleCaseCvHeading = (value = '') => String(value || '')
    .toLowerCase()
    .replace(/\b\p{L}/gu, ch => ch.toUpperCase())
    .trim();

  Object.keys(sections).forEach(key => {
    if (!key.startsWith('custom:')) return;
    const lines = sections[key];
    if (!Array.isArray(lines) || !lines.length) return;
    const rawName = key.slice(7).replace(/\s+/g, ' ').trim();
    if (!rawName) return;
    const items = bulletItemsFromLines(lines).map(item => {
      const { heading, desc } = splitHeadingDesc(item);
      return { heading, desc, link: null };
    });
    if (items.length) customSections.push({ name: titleCaseCvHeading(rawName), items });
  });

  return customSections;
}

function parseCvTextLocally(cvText = '', embeddedLinks = []) {
  const text = preprocessText(String(cvText || '').replace(/\r/g, '\n'));
  const lines = linesFromCvText(text);
  const sections = cvSectionsFromLines(lines);
  const { name, medium: mediumLine } = extractNameAndMedium(lines);
  const projects = parseCvProjects(sections.projects || [], embeddedLinks);
  const skills = parseCvSkills(sections.skills || []);
  const contact = parseCvContact(text, embeddedLinks);
  const customSections = parseCvCustomSections(sections, embeddedLinks);
  const summary = cleanCvLine((sections.summary || []).join(' '));

  const medium = mediumLine || (skills.length || projects.length ? 'Student / Job Seeker' : 'Portfolio Creator');
  let description = summary;
  if (!description && skills.length) {
    description = `I work with ${skills.slice(0, 8).join(', ')}. My portfolio includes ${projects.length} project${projects.length === 1 ? '' : 's'} extracted from my CV.`;
  }
  if (!description) {
    description = 'This portfolio was auto-filled from the uploaded CV. Please review and edit the details before generating the final portfolio.';
  }

  return {
    name: name || (contact.email ? contact.email.split('@')[0].replace(/[._-]+/g, ' ') : 'Your Name'),
    medium,
    description,
    projects,
    skills,
    contact,
    customSections,
    parser: 'robust-local-v2'
  };
}


async function sendToParserAndRespond(cvText, res, embeddedCvLinks = []) {
  const parsed = parseCvTextLocally(cvText, embeddedCvLinks);
  console.log('=== PARSED RESULT ===');
  console.log(JSON.stringify(parsed, null, 2));
  return res.json(parsed);
}


// Authentication and user-history routes restored for the React app.
app.post('/auth/signup', async (req, res) => {
  try {
    const { name = '', email = '', password = '' } = req.body || {};
    const cleanName = cleanText(name) || 'MuseForge Creator';
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const users = readUsers();
    if (users.some(user => normalizeEmail(user.email) === normalizedEmail)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordData = hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      name: cleanName,
      email: normalizedEmail,
      passwordSalt: passwordData.salt,
      passwordHash: passwordData.hash,
      emailVerified: true,
      provider: 'password',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    users.push(user);
    writeUsers(users);

    const welcome = await sendWelcomeEmail(user);
    const token = createAuthToken(user);
    return res.status(201).json({
      token,
      user: publicUser(user),
      history: readUserHistoryForEmail(user.email),
      welcomeEmailSent: Boolean(welcome.sent),
      message: 'Account created successfully.',
    });
  } catch (error) {
    console.error('Signup failed:', error);
    return res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email = '', password = '' } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    const user = readUsers().find(item => normalizeEmail(item.email) === normalizedEmail);
    if (!user || !passwordMatches(password, user)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (user.emailVerified === false) {
      return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', email: user.email, error: 'Please verify your email before logging in.' });
    }
    return res.json({
      token: createAuthToken(user),
      user: publicUser(user),
      history: readUserHistoryForEmail(user.email),
      message: 'Logged in successfully.',
    });
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(500).json({ error: 'Could not log in.' });
  }
});

app.post('/auth/google', async (req, res) => {
  try {
    const { credential = '' } = req.body || {};
    if (!googleAuthClient) {
      return res.status(503).json({ error: 'Google login is not configured on the server.' });
    }
    const ticket = await googleAuthClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload() || {};
    const normalizedEmail = normalizeEmail(payload.email || '');
    if (!normalizedEmail || payload.email_verified === false) {
      return res.status(400).json({ error: 'Google account email could not be verified.' });
    }

    const users = readUsers();
    let user = users.find(item => normalizeEmail(item.email) === normalizedEmail);
    const isNewAccount = !user;
    if (!user) {
      user = {
        id: crypto.randomUUID(),
        name: cleanText(payload.name || normalizedEmail.split('@')[0]) || 'Google User',
        email: normalizedEmail,
        googleId: payload.sub || '',
        picture: payload.picture || '',
        emailVerified: true,
        provider: 'google',
        createdAt: new Date().toISOString(),
      };
      users.push(user);
    } else {
      user.googleId = user.googleId || payload.sub || '';
      user.picture = payload.picture || user.picture || '';
      user.emailVerified = true;
      user.provider = user.provider || 'google';
    }
    user.updatedAt = new Date().toISOString();
    writeUsers(users);

    return res.json({
      token: createAuthToken(user),
      user: publicUser(user),
      history: readUserHistoryForEmail(user.email),
      isNewAccount,
      message: isNewAccount ? 'Google account created successfully.' : 'Logged in with Google successfully.',
    });
  } catch (error) {
    console.error('Google auth failed:', error.message);
    return res.status(401).json({ error: 'Google sign-in failed.' });
  }
});

app.post('/auth/forgot-password', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body?.email || '');
    const users = readUsers();
    const user = users.find(item => normalizeEmail(item.email) === normalizedEmail);
    if (!user) {
      return res.json({ message: 'If that email exists, a reset link has been sent.', emailSent: false });
    }
    const rawToken = createActionToken();
    user.resetTokenHash = hashActionToken(rawToken);
    user.resetTokenExpiresAt = Date.now() + 60 * 60 * 1000;
    user.updatedAt = new Date().toISOString();
    writeUsers(users);
    const sent = await sendPasswordResetEmail(user, rawToken);
    return res.json({
      message: 'If that email exists, a reset link has been sent.',
      emailSent: Boolean(sent.sent),
      ...(process.env.NODE_ENV !== 'production' ? { testResetToken: rawToken } : {}),
    });
  } catch (error) {
    console.error('Forgot password failed:', error);
    return res.status(500).json({ error: 'Could not send password reset email.' });
  }
});

app.post('/auth/reset-password', async (req, res) => {
  try {
    const { token = '', password = '' } = req.body || {};
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    const tokenHash = hashActionToken(token);
    const users = readUsers();
    const user = users.find(item => item.resetTokenHash === tokenHash && Number(item.resetTokenExpiresAt || 0) > Date.now());
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset token.' });
    const passwordData = hashPassword(password);
    user.passwordSalt = passwordData.salt;
    user.passwordHash = passwordData.hash;
    user.emailVerified = true;
    delete user.resetTokenHash;
    delete user.resetTokenExpiresAt;
    user.updatedAt = new Date().toISOString();
    writeUsers(users);
    await sendPasswordChangedEmail(user);
    return res.json({ message: 'Password reset successfully.' });
  } catch (error) {
    console.error('Reset password failed:', error);
    return res.status(500).json({ error: 'Could not reset password.' });
  }
});

app.post('/auth/verify-email', async (req, res) => {
  try {
    const token = cleanText(req.body?.token || '');
    const tokenHash = hashActionToken(token);
    const users = readUsers();
    const user = users.find(item => item.verificationTokenHash === tokenHash && Number(item.verificationTokenExpiresAt || 0) > Date.now());
    if (!user) return res.status(400).json({ error: 'Invalid or expired verification token.' });
    user.emailVerified = true;
    delete user.verificationTokenHash;
    delete user.verificationTokenExpiresAt;
    user.updatedAt = new Date().toISOString();
    writeUsers(users);
    return res.json({ token: createAuthToken(user), user: publicUser(user), history: readUserHistoryForEmail(user.email), welcomeEmailSent: true });
  } catch (error) {
    console.error('Email verification failed:', error);
    return res.status(500).json({ error: 'Could not verify email.' });
  }
});

app.post('/auth/verify-code', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body?.email || '');
    const code = String(req.body?.code || '').replace(/\D/g, '');
    const users = readUsers();
    const user = users.find(item => normalizeEmail(item.email) === normalizedEmail);
    if (!user) return res.status(400).json({ error: 'Invalid verification request.' });
    if (user.emailVerified !== false) {
      return res.json({ token: createAuthToken(user), user: publicUser(user), history: readUserHistoryForEmail(user.email), message: 'Email already verified.' });
    }
    if (!user.verificationCodeHash || user.verificationCodeHash !== hashActionToken(code) || Number(user.verificationCodeExpiresAt || 0) <= Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }
    user.emailVerified = true;
    delete user.verificationCodeHash;
    delete user.verificationCodeExpiresAt;
    user.updatedAt = new Date().toISOString();
    writeUsers(users);
    return res.json({ token: createAuthToken(user), user: publicUser(user), history: readUserHistoryForEmail(user.email), message: 'Email verified successfully.' });
  } catch (error) {
    console.error('Code verification failed:', error);
    return res.status(500).json({ error: 'Could not verify code.' });
  }
});

app.post('/auth/resend-verification', async (req, res) => {
  try {
    const normalizedEmail = normalizeEmail(req.body?.email || '');
    const users = readUsers();
    const user = users.find(item => normalizeEmail(item.email) === normalizedEmail);
    if (!user) return res.status(200).json({ message: 'If the account exists, a verification code has been sent.' });
    if (user.emailVerified !== false) return res.json({ message: 'Email is already verified.' });
    const code = createVerificationCode();
    user.verificationCodeHash = hashActionToken(code);
    user.verificationCodeExpiresAt = Date.now() + 10 * 60 * 1000;
    user.updatedAt = new Date().toISOString();
    writeUsers(users);
    const sent = await sendVerificationCodeEmail(user, code);
    return res.json({ message: 'A new verification code has been sent.', emailSent: Boolean(sent.sent), ...(process.env.NODE_ENV !== 'production' ? { testVerificationCode: code } : {}) });
  } catch (error) {
    console.error('Resend verification failed:', error);
    return res.status(500).json({ error: 'Could not resend verification code.' });
  }
});

app.post('/user-history', async (req, res) => {
  try {
    const { email = '', history = {} } = req.body || {};
    const saved = saveUserHistoryForEmail(email, history);
    return res.json({ history: saved });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'Could not save user history.' });
  }
});

app.get('/user-history', async (req, res) => {
  try {
    const email = req.query.email || '';
    return res.json({ history: readUserHistoryForEmail(email) });
  } catch (error) {
    return res.status(500).json({ error: 'Could not read user history.' });
  }
});

app.get('/user-history/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email || '');
    return res.json({ history: readUserHistoryForEmail(email) });
  } catch (error) {
    return res.status(500).json({ error: 'Could not read user history.' });
  }
});

app.get('/reviews', async (req, res) => {
  try {
    return res.json({ reviews: [] });
  } catch (error) {
    return res.status(500).json({ error: 'Could not read reviews.' });
  }
});

app.post('/reviews', aiLimiter, async (req, res) => {
  try {
    const saved = await saveReview(req.body || {});
    return res.status(201).json({ review: saved });
  } catch (error) {
    const code = error.statusCode || 500;
    return res.status(code).json({ error: error.message || 'Could not submit review.' });
  }
});

// Error handling middleware for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 10MB limit' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Only 1 file allowed' });
    }
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  }
  
  if (err.message === 'Invalid file type. Only PDF files are allowed.') {
    return res.status(400).json({ error: err.message });
  }
  
  // Generic error handler
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
{
  process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
  });
  process.on('uncaughtException', error => {
    console.error('Uncaught server exception:', error);
  });
  

app.post("/api/profile-ai-text", async (req, res) => {
  try {
    const {
      name,
      creatorType,
      creatorLabel,
      category,
      description,
      projects,
      skills,
      contact,
      outputLanguage,
      tone
    } = req.body || {};

    const typeText = `${creatorType || ""} ${creatorLabel || ""}`.toLowerCase();

    const isCareerPerson =
      typeText.includes("student") ||
      typeText.includes("job") ||
      typeText.includes("career") ||
      typeText.includes("cv") ||
      typeText.includes("developer");

    const bioHeading = isCareerPerson ? "Bio" : "Artist Bio";
    const statementHeading = isCareerPerson ? "Professional Statement" : "Artist Statement";

    const safeLanguage = outputLanguage || "English";
    const safeTone = tone || "Professional";

    const prompt = `
You are MuseForge's FactLock AI writer.

TASK:
Generate an enhanced portfolio Bio and Statement using ONLY the user's provided facts.

IMPORTANT RULES:
1. Do NOT invent fake achievements, awards, clients, companies, numbers, universities, years, or experience.
2. Do NOT add unsupported claims.
3. Output language MUST be: ${safeLanguage}
4. Tone MUST be: ${safeTone}
5. If the user is a student, job seeker, developer, CV/career person:
   - Use "Bio"
   - Use "Professional Statement"
   - Do NOT call them an artist unless their actual work is artistic.
6. If the user is musician, singer, photographer, writer, visual artist, media creator, or other creative:
   - Use "Artist Bio"
   - Use "Artist Statement"
7. Bio must be strong: 5-6 polished, human, portfolio-ready sentences based only on supplied facts.
8. Statement must be strong: 2 first-person paragraphs explaining creative/professional direction, motivation, strengths, and goals without fake claims.
9. Keep both natural, specific, and professional. Do not produce generic filler.

USER FACTS:
Name: ${name || ""}
Creator Type: ${creatorLabel || creatorType || ""}
Category/Role: ${category || ""}
User Description: ${description || ""}
Projects: ${JSON.stringify(projects || [])}
Skills: ${JSON.stringify(skills || [])}
Contact: ${JSON.stringify(contact || {})}

Return ONLY valid JSON in this exact format:
{
  "bioHeading": "${bioHeading}",
  "statementHeading": "${statementHeading}",
  "bio": "...",
  "statement": "..."
}
`;

    let profileRaw = '{}';
    if (aiAvailable()) {
      try {
        profileRaw = await generateAiText({
          temperature: 0.45,
          maxTokens: 900,
          messages: [
            { role: 'system', content: 'You are a strict FactLock portfolio writing assistant. Return JSON only. No markdown, no explanation.' },
            { role: 'user', content: prompt }
          ],
        });
      } catch (aiErr) {
        console.warn('Profile AI text generation failed, using fallback:', aiErr.message);
      }
    }

    profileRaw = (profileRaw || '{}').replace(/```json/g, '').replace(/```/g, '').trim();
    let parsed = {};
    try { parsed = JSON.parse(profileRaw); } catch (_) { parsed = {}; }

    // Fallback: if AI returned empty bio/statement, build one from user facts
    const roleLabel = creatorLabel || creatorType || category || 'their field';
    const fallbackBio = description
      ? `${name || 'This creator'} works in ${roleLabel}. ${description} This portfolio presents the supplied work clearly, professionally, and without unsupported claims.`
      : '';
    const fallbackStatement = description
      ? `My work is rooted in ${roleLabel} and shaped by the details provided in this portfolio. I aim to present my skills, projects, and direction with clarity, confidence, and honesty while keeping every claim grounded in real information.`
      : '';

    res.json({
      bioHeading: parsed.bioHeading || bioHeading,
      statementHeading: parsed.statementHeading || statementHeading,
      bio: parsed.bio || fallbackBio,
      statement: parsed.statement || fallbackStatement
    });
  } catch (error) {
    console.error('Profile AI text error:', error);
    res.status(500).json({ error: 'Failed to generate profile bio and statement' });
  }
});


   if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  }
}

Object.assign(app, {
  app,
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  normalizeEmail,
  // Exported for regression tests only; routes still use the same internal functions.
  __test: {
    parseCvTextLocally,
    doclingMarkdownToCvText,
    buildLocalStrongProjectRegeneration,
    regenerationIsStrongEnough,
    regenerationUsesFirstPerson,
    candidateChangesOriginalFacts,
    importantOriginalAnchors,
    extractVisibleUrls,
    // Language-lock gate (used by /generate to reject wrong-language AI output before it reaches the user).
    buildLocalizedOutput,
    translateTextStrict,
    strictLocalizeFallback,
    localizeBasicTextFallback,
    labelsForLanguage,
    normalizeServerOutputLanguage,
    hasUnexpectedScriptForLanguage,
    looksUrduScript,
    nativeLocalDraft,
    buildLocalDistinctStatement,
    looksArabicScript,
    requiresNonLatinScript,
    hasRequiredScript,
    looksLikeWrongEnglishForTarget,
    languageFamily,
  },
});

module.exports = app;