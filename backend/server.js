const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { PdfReader } = require('pdfreader');
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
  return Boolean(GEMINI_API_KEY || openai || groq);
}

function selectAiProvider() {
  if (AI_PROVIDER === 'groq' && groq && !providerDisabled('groq')) return 'groq';
  if (AI_PROVIDER === 'openai' && openai && !providerDisabled('openai')) return 'openai';
  if (AI_PROVIDER === 'gemini' && GEMINI_API_KEY && !providerDisabled('gemini')) return 'gemini';
  if (groq && !providerDisabled('groq')) return 'groq';
  if (openai && !providerDisabled('openai')) return 'openai';
  if (GEMINI_API_KEY && !providerDisabled('gemini')) return 'gemini';
  return 'none';
}

function orderedAiProviders() {
  const providers = [];
  const add = (name) => {
    if (!name || providers.includes(name) || providerDisabled(name)) return;
    if (name === 'groq' && !groq) return;
    if (name === 'openai' && !openai) return;
    if (name === 'gemini' && !GEMINI_API_KEY) return;
    providers.push(name);
  };

  // If a provider is explicitly selected, do NOT spam quota-exhausted fallback providers.
  // For the user's current setup, AI_PROVIDER=groq should only call Groq.
  if (AI_PROVIDER === 'groq') { add('groq'); return providers; }
  if (AI_PROVIDER === 'openai') { add('openai'); return providers; }
  if (AI_PROVIDER === 'gemini') { add('gemini'); return providers; }

  // Auto mode: practical free/demo order.
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
  for (const provider of providers) {
    try {
      if (provider === 'gemini') return await callGeminiText({ messages, temperature, maxTokens });
      if (provider === 'openai') return await callOpenAIText({ messages, temperature, maxTokens });
      if (provider === 'groq') return await callGroqText({ messages, temperature, maxTokens });
    } catch (error) {
      lastError = error;
      markProviderDisabled(provider, error);
      console.warn(`${provider} AI request failed; trying fallback provider if available:`, error.message);
    }
  }
  throw lastError || new Error('No AI provider configured');
}

async function translateTextStrict(text = '', targetLanguage = 'English') {
  const clean = cleanText(text);
  const lang = cleanText(targetLanguage) || 'English';
  const family = languageFamily(lang);
  const sourceLooksNonEnglish = containsArabicScript(clean) || containsDevanagari(clean) || containsCJK(clean) || containsBengali(clean) || containsTamil(clean) || containsTelugu(clean) || containsThai(clean) || hasCyrillic(clean) || looksRomanUrdu(clean);
  if (!clean) return clean;
  if (family === 'english' && !sourceLooksNonEnglish) return clean;
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
    if (translated && !hasUnexpectedScriptForLanguage(translated, lang) && (!sameCleanText(translated, clean) || family === 'english')) return translated;
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
    arabic:    'Write ONLY in Arabic script (right-to-left). Use Modern Standard Arabic (فصحى). Every word of prose, every heading, every label must be in Arabic script. Never mix in English words except proper names, brand names, emails, URLs, and technology tool names (React, Python, etc.).',
    urdu:      'Write ONLY in Urdu Nastaliq script (right-to-left). Use clear, modern Pakistani Urdu. Every word of prose must be in Urdu script. Never mix in English words except proper names, brand names, emails, URLs, and technology tool names.',
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
    auth: { user, pass },
  });
}

const mailTransporter = createMailTransporter();

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
  if (publicPortfolioDatabaseEnabled) {
    const encodedId = encodeURIComponent(id);
    const rows = await supabaseRequest(`${SUPABASE_PORTFOLIOS_TABLE}?id=eq.${encodedId}&select=portfolio_data`, {
      method: 'GET',
    });
    return Array.isArray(rows) && rows[0]?.portfolio_data ? rows[0].portfolio_data : null;
  }

  return readPublicPortfolios().find(item => item.id === id) || null;
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
  'Turkish',
  'Chinese',
  'Japanese',
  'Korean',
  'Russian',
  'Bengali',
  'Punjabi',
  'Persian',
  'Pashto',
  'Sindhi',
  'Malay',
  'Indonesian',
  'Thai',
  'Vietnamese',
  'Filipino',
  'Swahili',
  'Greek',
  'Polish',
  'Tamil',
  'Telugu',
]);

function normalizeServerOutputLanguage(value = 'English') {
  const clean = String(value || '').trim();
  return ACTIVE_OUTPUT_LANGUAGES.has(clean) ? clean : 'English';
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
  const rawDescription = polishDescriptionLocally(description) || cleanText(description) || `I am passionate about ${displayMedium}.`;

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

function buildLocalDistinctStatement({ medium = '', creatorType = '' } = {}) {
  const typeText = cleanText(creatorType).toLowerCase();
  const isCareer = /student|job|career|cv|developer|software|engineer|intern|professional/.test(typeText);
  const field = cleanText(medium) || (isCareer ? 'my professional field' : 'my creative field');

  if (isCareer) {
    return `My direction is shaped by practical learning, honest growth, and a clear commitment to improving in ${field}. I want my portfolio to show how I think, what I can contribute, and how seriously I approach each opportunity.

I value clarity, consistency, and real progress over empty claims. Every part of this portfolio is meant to present my work truthfully, confidently, and in a way that helps others understand my potential.`;
  }

  return `My creative direction is guided by intention, clarity, and a strong connection to ${field}. I want my work to feel polished, expressive, and meaningful while staying true to the style and details I have actually shared.

I see each piece as a chance to communicate mood, personality, and purpose. My goal is to keep developing a recognizable creative voice and present my work with honesty, care, and confidence.`;
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
  if (currentStatement && !sectionsTooSimilar(artistBio, currentStatement)) {
    return currentStatement;
  }

  const localFallback = buildLocalDistinctStatement({ medium, creatorType });

  if (aiAvailable()) {
    try {
      const aiText = await generateAiText({
        temperature: 0.18,
        maxTokens: 650,
        messages: [
          {
            role: 'system',
            content: `You are MuseForge's strict portfolio statement writer. ${languageStrictInstruction(targetLanguage)} ${toneInstruction(aiTone)} Write ONLY the statement body, not headings. Use only supplied facts. Never invent achievements, clients, tools, awards, dates, numbers, metrics, or experience. The statement must be clearly different from the bio. Bio = identity/profile. Statement = purpose, values, creative/professional direction, process, and voice. Return only valid JSON: {"statement":"..."}.`,
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

      const parsed = parseJsonObject(aiText || '');
      const candidate = cleanText(parsed.statement || '');

      if (
        candidate &&
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

  const translatedFallback = await translateTextStrict(localFallback, targetLanguage);
  return cleanText(translatedFallback || localFallback);
}

function portfolioBodyForLanguageCheck(portfolio = '') {
  return cleanText(String(portfolio || '')
    .split(/\n+/)
    .filter(line => !/^\s*#{1,6}\s+/.test(line))
    .join(' '));
}

function englishProseScore(value = '') {
  const text = cleanText(value).toLowerCase();
  const matches = text.match(/\b(the|and|with|for|from|that|this|which|where|while|because|creative|portfolio|project|projects|work|works|artist|statement|skills|experience|professional|showcase|presents|provided|user|details|based|clear|authentic|centered|focused|my|i|is|are|was|were)\b/g) || [];
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
  return words.reduce((count, word) => count + (new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text) ? 1 : 0), 0);
}

function looksLikeWrongEnglishForTarget(value = '', targetLanguage = 'English') {
  const family = languageFamily(targetLanguage);
  if (['english', 'roman urdu'].includes(family) || requiresNonLatinScript(targetLanguage)) return false;
  const englishScore = englishProseScore(value);
  const targetScore = targetLanguageSignalScore(value, targetLanguage);
  return englishScore >= 4 && englishScore >= targetScore + 3;
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
  const text = cleanText(value);
  const lang = cleanText(targetLanguage).toLowerCase();
  if (!text || lang === 'english' || lang === 'french' || lang === 'spanish' || lang === 'german' || lang === 'turkish') return text;

  const known = {
    'fawad': { arabic: 'فواد', urdu: 'فواد', hindi: 'फ़वाद' },
    'khan': { arabic: 'خان', urdu: 'خان', hindi: 'खान' },
    'muskan': { arabic: 'مسكان', urdu: 'مسکان', hindi: 'मुस्कान' },
    'ejaz': { arabic: 'إعجاز', urdu: 'اعجاز', hindi: 'एजाज़' },
    'jordan': { arabic: 'جوردن', urdu: 'جورڈن', hindi: 'जॉर्डन' },
    'mercer': { arabic: 'ميرسر', urdu: 'مرسر', hindi: 'मर्सर', chinese: '默瑟', japanese: 'マーサー', korean: '머서' },
    'fawad': { arabic: 'فواد', urdu: 'فواد', hindi: 'फ़वाद', chinese: '法瓦德', japanese: 'ファワード', korean: '파와드' },
    'khan': { arabic: 'خان', urdu: 'خان', hindi: 'खान', chinese: '汗', japanese: 'カーン', korean: '칸' },
  };

  if (lang === 'arabic' || lang === 'urdu') {
    const alphabet = {
      sh: 'ش', ch: 'چ', kh: 'خ', gh: 'غ', ph: 'ف', th: 'ث',
      a: 'ا', b: 'ب', c: 'ک', d: 'د', e: 'ی', f: 'ف', g: 'گ', h: 'ہ', i: 'ی', j: 'ج', k: 'ک', l: 'ل', m: 'م', n: 'ن', o: 'و', p: 'پ', q: 'ق', r: 'ر', s: 'س', t: 'ت', u: 'و', v: 'و', w: 'و', x: 'کس', y: 'ی', z: 'ز'
    };
    return text.split(/(\s+)/).map(part => {
      if (/^\s+$/.test(part)) return part;
      const clean = part.toLowerCase().replace(/[^a-z]/g, '');
      const knownValue = known[clean]?.[lang];
      if (knownValue) return knownValue;
      let out = '';
      for (let i = 0; i < clean.length;) {
        const pair = clean.slice(i, i + 2);
        if (alphabet[pair]) { out += alphabet[pair]; i += 2; }
        else { out += alphabet[clean[i]] || part[i] || ''; i += 1; }
      }
      return out || part;
    }).join('');
  }

  if (lang === 'hindi') {
    return text.split(/(\s+)/).map(part => {
      if (/^\s+$/.test(part)) return part;
      const clean = part.toLowerCase().replace(/[^a-z]/g, '');
      return known[clean]?.hindi || part;
    }).join('');
  }

  if (lang === 'chinese' || lang === 'japanese' || lang === 'korean') {
    return text.split(/(\s+)/).map(part => {
      if (/^\s+$/.test(part)) return part;
      const clean = part.toLowerCase().replace(/[^a-z]/g, '');
      return known[clean]?.[lang] || part;
    }).join(lang === 'chinese' ? '' : ' ');
  }

  return text;
}

function hasCyrillic(value = '') {
  return /[\u0400-\u04FF]/.test(String(value));
}

function containsArabicScript(value = '') { return /[\u0600-\u06FF]/.test(String(value)); }
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
  if (['arabic','urdu','persian','pashto','sindhi'].includes(family)) return containsArabicScript(text);
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
  const family = languageFamily(targetLanguage);
  const text = {
    arabic: {
      medium: 'مجال إبداعي', description: 'يعرض هذا القسم المعلومات التي قدّمها المستخدم بأسلوب واضح ومهني يحافظ على الحقائق الأصلية.', project: 'يعرض هذا المشروع فكرة قدّمها المستخدم بطريقة واضحة ومنظمة.', section: 'قسم إضافي', item: 'تفصيل إضافي'
    },
    urdu: {
      medium: 'تخلیقی شعبہ', description: 'یہ حصہ صارف کی فراہم کردہ معلومات کو واضح، پیشہ ورانہ اور اصل حقائق کے مطابق پیش کرتا ہے۔', project: 'یہ منصوبہ صارف کے فراہم کردہ کام کو واضح اور منظم انداز میں پیش کرتا ہے۔', section: 'اضافی سیکشن', item: 'اضافی تفصیل'
    },
    hindi: {
      medium: 'रचनात्मक क्षेत्र', description: 'यह भाग उपयोगकर्ता द्वारा दी गई जानकारी को स्पष्ट, पेशेवर और मूल तथ्यों के अनुसार प्रस्तुत करता है।', project: 'यह प्रोजेक्ट उपयोगकर्ता के दिए गए काम को साफ और व्यवस्थित रूप में प्रस्तुत करता है।', section: 'अतिरिक्त अनुभाग', item: 'अतिरिक्त विवरण'
    },
    chinese: { medium: '创意领域', description: '本部分以清晰、专业的方式呈现用户提供的信息，并保持原始事实。', project: '该项目以清晰、有条理的方式展示用户提供的作品。', section: '附加部分', item: '附加说明' },
    japanese: { medium: 'クリエイティブ分野', description: 'このセクションは、ユーザーが提供した情報を事実に基づいて明確かつ専門的に示します。', project: 'このプロジェクトは、ユーザーが提供した作品を明確で整理された形で紹介します。', section: '追加セクション', item: '追加詳細' },
    korean: { medium: '창작 분야', description: '이 섹션은 사용자가 제공한 정보를 원래 사실에 맞게 명확하고 전문적으로 보여줍니다.', project: '이 프로젝트는 사용자가 제공한 작업을 명확하고 체계적으로 보여줍니다.', section: '추가 섹션', item: '추가 설명' },
    'roman urdu': { medium: 'Creative field', description: 'Yeh section user ki di hui information ko clear aur professional style mein show karta hai, bina naye facts add kiye.', project: 'Yeh project user ke diye hue kaam ko clear aur organized way mein present karta hai.', section: 'Extra Section', item: 'Extra Detail' }
  };
  return (text[family] && text[family][kind]) || '';
}

function strictLocalizeFallback(value = '', targetLanguage = 'English', kind = 'description') {
  const original = cleanText(value);
  const localized = cleanText(localizeBasicTextFallback(original, targetLanguage));
  if (!original) return '';
  if (languageFamily(targetLanguage) === 'english' && looksRomanUrdu(original)) return localized || original;
  if (!requiresNonLatinScript(targetLanguage) && languageFamily(targetLanguage) !== 'roman urdu') return localized || original;
  if (localized && !sameCleanText(localized, original) && !leaksLatinForTarget(localized, targetLanguage)) return localized;
  return genericLocalizedText(targetLanguage, kind) || localized || original;
}


function hasUnexpectedScriptForLanguage(value = '', targetLanguage = 'English') {
  const text = String(value || '');
  const family = languageFamily(targetLanguage);
  if (!cleanText(text)) return false;
  if (leaksLatinForTarget(text, targetLanguage)) return true;
  if (family === 'english') return looksRomanUrdu(text) || containsArabicScript(text) || containsDevanagari(text) || containsCJK(text) || hasCyrillic(text) || containsBengali(text) || containsTamil(text) || containsTelugu(text) || containsThai(text);
  if (family === 'roman urdu') return containsArabicScript(text) || containsDevanagari(text) || containsCJK(text) || hasCyrillic(text) || containsBengali(text) || containsTamil(text) || containsTelugu(text) || containsThai(text);
  if (['spanish','french','german','italian','portuguese','dutch','turkish','malay','indonesian','filipino','swahili','polish','vietnamese'].includes(family)) {
    return containsArabicScript(text) || containsDevanagari(text) || containsCJK(text) || hasCyrillic(text) || containsBengali(text) || containsTamil(text) || containsTelugu(text) || containsThai(text);
  }
  if (family === 'russian') return containsArabicScript(text) || containsDevanagari(text) || containsCJK(text);
  if (family === 'greek') return containsArabicScript(text) || containsDevanagari(text) || containsCJK(text) || hasCyrillic(text);
  if (['arabic','urdu','persian','pashto','sindhi'].includes(family)) return hasCyrillic(text) || containsDevanagari(text) || containsCJK(text);
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
  const text = cleanText(value);
  const lang = languageFamily(targetLanguage);
  if (!text || lang === 'english') return text;
  const key = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const dictionary = {
    arabic: {
      'music performance': 'الموسيقى والأداء',
      'software engineer': 'مهندس برمجيات',
      'software development': 'تطوير البرمجيات',
      'web developer': 'مطوّر ويب',
      'full stack developer': 'مطوّر ويب متكامل',
      'visual arts painting': 'الفنون البصرية والرسم',
      'visual arts': 'الفنون البصرية',
      'painting': 'الرسم',
      'artist': 'فنان',
      'musician': 'موسيقي',
      'music': 'موسيقى',
      'performance': 'أداء',
      'ma music krta hun': 'أنا أعمل في الموسيقى.',
      'ma music karta hun': 'أنا أعمل في الموسيقى.',
      'nachna': 'الرقص',
      'teri yaadain': 'ذكرياتك',
      'teri yadain': 'ذكرياتك',
      'ma is ganay pr bht nacah tha ma na isky liyay bht dance practice ki thee r bht mashoor howa tha apnay famous steps ki wajah sy': 'رقصت كثيرًا على هذه الأغنية وتدربت عليها كثيرًا، وأصبحت مشهورة بسبب خطواتها المميزة.',
      'qamiyabi': 'النجاح',
      'certificate for appreciation': 'شهادة تقدير',
      'i won certificate for appreciation': 'حصلت على شهادة تقدير',
      'i won certificate for appreciation.': 'حصلت على شهادة تقدير',
      'museforge': 'MuseForge',
      'karachi pakistan': 'كراتشي، باكستان',
      'live performance siyara ma': 'أداء مباشر في سيارا',
      'ma na siyara ganay ky liyai dance sikha r usky steps bht hit howay': 'تعلمت الرقص لأغنية سيارا وأصبحت خطواتها شائعة جدًا.',
    },
    urdu: {
      'music performance': 'موسیقی اور پرفارمنس',
      'software engineer': 'سافٹ ویئر انجینئر',
      'software development': 'سافٹ ویئر ڈویلپمنٹ',
      'web developer': 'ویب ڈویلپر',
      'full stack developer': 'فل اسٹیک ڈویلپر',
      'visual arts painting': 'بصری فنون اور پینٹنگ',
      'visual arts': 'بصری فنون',
      'painting': 'پینٹنگ',
      'artist': 'آرٹسٹ',
      'musician': 'موسیقار',
      'music': 'موسیقی',
      'performance': 'پرفارمنس',
      'ma music krta hun': 'میں موسیقی کرتا ہوں۔',
      'ma music karta hun': 'میں موسیقی کرتا ہوں۔',
      'nachna': 'رقص',
      'teri yaadain': 'تیری یادیں',
      'teri yadain': 'تیری یادیں',
      'ma is ganay pr bht nacah tha ma na isky liyay bht dance practice ki thee r bht mashoor howa tha apnay famous steps ki wajah sy': 'میں نے اس گانے پر بہت رقص کیا، اس کے لیے بہت پریکٹس کی، اور یہ اپنے مشہور اسٹیپس کی وجہ سے بہت مشہور ہوا۔',
      'qamiyabi': 'کامیابی',
      'certificate for appreciation': 'تعریفی سرٹیفکیٹ',
      'i won certificate for appreciation': 'مجھے تعریفی سرٹیفکیٹ ملا',
      'i won certificate for appreciation.': 'مجھے تعریفی سرٹیفکیٹ ملا',
      'museforge': 'MuseForge',
    },
    hindi: {
      'music performance': 'संगीत और प्रदर्शन',
      'software engineer': 'सॉफ्टवेयर इंजीनियर',
      'software development': 'सॉफ्टवेयर डेवलपमेंट',
      'web developer': 'वेब डेवलपर',
      'full stack developer': 'फुल-स्टैक डेवलपर',
      'visual arts painting': 'दृश्य कला और पेंटिंग',
      'ma music krta hun': 'मैं संगीत का काम करता हूँ।',
      'ma music karta hun': 'मैं संगीत का काम करता हूँ।',
      'nachna': 'नृत्य',
      'qamiyabi': 'सफलता',
      'certificate for appreciation': 'प्रशंसा प्रमाणपत्र',
      'i won certificate for appreciation': 'मुझे प्रशंसा प्रमाणपत्र मिला',
      'museforge': 'MuseForge',
    },
    spanish: {
      'music performance': 'Música y actuación',
      'music acting': 'Música y actuación',
      'software engineer': 'Ingeniero de software',
      'software development': 'Desarrollo de software',
      'visual arts painting': 'Artes visuales y pintura',
      'projects': 'Proyectos',
      'project': 'Proyecto',
      'ham safar': 'Compañero de viaje',
      'humsafar': 'Compañero de viaje',
      'teray bin': 'Sin ti',
      'teray ben': 'Sin ti',
      'tery bin': 'Sin ti',
      'teray yaadain': 'Tus recuerdos',
      'teri yaadain': 'Tus recuerdos',
      'nachna': 'Bailar',
      'dance': 'Baile',
      'tery liyaye': 'Para ti',
      'tery liyay': 'Para ti',
      'teray liyay': 'Para ti',
      'qamiyabi': 'Éxito',
      'certificate for appreciation': 'Certificado de reconocimiento',
      'i won certificate for appreciation': 'Recibí un certificado de reconocimiento',
      'ma music krta hun': 'Trabajo en música.',
      'ma music karta hun': 'Trabajo en música.',
      'me liked composing music for drama ham safar': 'Me gustó componer la música para el drama Ham Safar.',
      'worked on drama teray bin and received recognition': 'Trabajé en el drama Teray Bin y recibí reconocimiento.',
      'ma is ganay pr bht nacah tha ma na isky liyay bht dance practice ki thee r bht mashoor howa tha apnay famous steps ki wajah sy': 'Disfruté mucho bailar esta canción, practiqué bastante para ella y se hizo conocida por sus pasos memorables.',
      'live performance on teray bin': 'Actuación en vivo en Sin ti',
      'live performance on teray bin ': 'Actuación en vivo en Sin ti',
      'ma na teray bin ganay ky liyay khud dance sikha r performance di thee jisky steps bht hit howay thy': 'Aprendí a bailar por mi cuenta y ofrecí una actuación para Sin ti, cuyos pasos se hicieron muy populares.',
      'ma na is gnay ky liyay dance sikha r ma is dance ky steps ki wajah sy bht famous bhi howa': 'Aprendí un baile para esta canción y sus pasos me hicieron muy reconocido.',
      'museforge': 'MuseForge',
    },
    german: {
      'music performance': 'Musik und Auftritt',
      'software engineer': 'Softwareentwickler',
      'nachna': 'Tanzen',
      'teray bin': 'Ohne dich',
      'ham safar': 'Weggefährte',
      'live performance on teray bin': 'Live-Auftritt zu Ohne dich',
      'tery liyaye': 'Für dich',
      'tery liyay': 'Für dich',
      'qamiyabi': 'Erfolg',
      'certificate for appreciation': 'Anerkennungszertifikat',
      'i won certificate for appreciation': 'Ich habe ein Anerkennungszertifikat erhalten',
      'ma na teray bin ganay ky liyay khud dance sikha r performance di thee jisky steps bht hit howay thy': 'Ich habe mir für Ohne dich selbst Tanzschritte beigebracht und eine Aufführung gezeigt, deren Schritte sehr beliebt wurden.',
      'ma na is gnay ky liyay dance sikha r ma is dance ky steps ki wajah sy bht famous bhi howa': 'Ich habe für dieses Lied einen Tanz gelernt und wurde durch die Schritte sehr bekannt.',
      'museforge': 'MuseForge',
    },
    turkish: {
      'music performance': 'Müzik ve performans',
      'software engineer': 'Yazılım mühendisi',
      'nachna': 'Dans etmek',
      'teray bin': 'Sensiz',
      'ham safar': 'Yol arkadaşı',
      'live performance on teray bin': 'Sensiz için canlı performans',
      'tery liyaye': 'Senin için',
      'tery liyay': 'Senin için',
      'qamiyabi': 'Başarı',
      'certificate for appreciation': 'Takdir belgesi',
      'i won certificate for appreciation': 'Takdir belgesi kazandım',
      'ma na teray bin ganay ky liyay khud dance sikha r performance di thee jisky steps bht hit howay thy': 'Sensiz şarkısı için kendi kendime dans öğrendim ve adımları çok popüler olan bir performans sergiledim.',
      'ma na is gnay ky liyay dance sikha r ma is dance ky steps ki wajah sy bht famous bhi howa': 'Bu şarkı için dans öğrendim ve dans adımları sayesinde oldukça tanındım.',
      'museforge': 'MuseForge',
    },
    chinese: {
      'music performance': '音乐与表演',
      'software engineer': '软件工程师',
      'nachna': '舞蹈',
      'teray bin': '没有你',
      'ham safar': '同行者',
      'live performance on teray bin': '《没有你》的现场表演',
      'tery liyaye': '献给你',
      'tery liyay': '献给你',
      'qamiyabi': '成功',
      'certificate for appreciation': '表彰证书',
      'i won certificate for appreciation': '我获得了表彰证书',
      'ma na teray bin ganay ky liyay khud dance sikha r performance di thee jisky steps bht hit howay thy': '我为《没有你》自学舞蹈并进行了表演，其中的舞步很受欢迎。',
      'ma na is gnay ky liyay dance sikha r ma is dance ky steps ki wajah sy bht famous bhi howa': '我为这首歌学习了舞蹈，并因为这些舞步而广受关注。',
      'museforge': 'MuseForge',
    },
    japanese: {
      'music performance': '音楽とパフォーマンス',
      'software engineer': 'ソフトウェアエンジニア',
      'nachna': 'ダンス',
      'teray bin': '君なしで',
      'ham safar': '旅の仲間',
      'live performance on teray bin': '「君なしで」のライブパフォーマンス',
      'tery liyaye': '君のために',
      'tery liyay': '君のために',
      'qamiyabi': '成功',
      'certificate for appreciation': '感謝状',
      'i won certificate for appreciation': '感謝状を受賞しました',
      'ma na teray bin ganay ky liyay khud dance sikha r performance di thee jisky steps bht hit howay thy': '「君なしで」のために独学でダンスを学び、そのステップがとても人気になったパフォーマンスを行いました。',
      'ma na is gnay ky liyay dance sikha r ma is dance ky steps ki wajah sy bht famous bhi howa': 'この曲のためにダンスを学び、そのステップで広く知られるようになりました。',
      'museforge': 'MuseForge',
    },
    korean: {
      'music performance': '음악과 공연',
      'software engineer': '소프트웨어 엔지니어',
      'nachna': '춤',
      'teray bin': '너 없이',
      'ham safar': '동행자',
      'live performance on teray bin': '너 없이 라이브 공연',
      'tery liyaye': '너를 위해',
      'tery liyay': '너를 위해',
      'qamiyabi': '성공',
      'certificate for appreciation': '감사장',
      'i won certificate for appreciation': '감사장을 받았습니다',
      'ma na teray bin ganay ky liyay khud dance sikha r performance di thee jisky steps bht hit howay thy': '너 없이 곡을 위해 스스로 춤을 익혀 공연했고, 그 동작들이 큰 인기를 얻었습니다.',
      'ma na is gnay ky liyay dance sikha r ma is dance ky steps ki wajah sy bht famous bhi howa': '이 노래를 위해 춤을 배웠고 그 춤 동작 덕분에 많이 알려졌습니다.',
      'museforge': 'MuseForge',
    },
    french: {
      'music performance': 'Musique et performance',
      'software engineer': 'Ingénieur logiciel',
      'software development': 'Développement logiciel',
      'nachna': 'Danser',
      'teray bin': 'Sans toi',
      'ham safar': 'Compagnon de route',
      'live performance on teray bin': 'Performance en direct sur Sans toi',
      'tery liyaye': 'Pour toi',
      'tery liyay': 'Pour toi',
      'qamiyabi': 'Réussite',
      'certificate for appreciation': 'Certificat de reconnaissance',
      'i won certificate for appreciation': 'J’ai reçu un certificat de reconnaissance',
      'projects': 'Projets',
      'ham safar': 'Compagnon de voyage',
      'teray bin': 'Sans toi',
      'nachna': 'Danser',
      'tery liyaye': 'Pour toi',
      'qamiyabi': 'Réussite',
    },
  };
  const exact = dictionary[lang]?.[key];
  if (exact) return exact;

  const phraseFallbacks = {
    'roman urdu': {
      nachna: 'Naachna',
      terayBin: 'Teray Bin ke baghair',
      hamSafar: 'Humsafar',
      liveTerayBin: 'Teray Bin par live performance',
      teryLiyay: 'Tumhare liye',
      qamiyabi: 'Qamiyabi',
      danceSentence: 'Maine is gaane ke liye dance seekha aur apni performance ke steps ki wajah se kaafi mashhoor hua.',
      terayBinSentence: 'Maine Teray Bin gaane ke liye khud dance seekha aur performance di, jiske steps bohat hit hue.',
      terayWastay: 'Tumhare liye',
      siyara: 'Siyara',
      hamSafarComposeSentence: 'Maine drama Humsafar ke liye music compose kiya, jo bohat mashhoor hua.',
      hamSafarDanceSentence: 'Maine Humsafar ke liye ek khaas dance seekha aur audience ne us ke steps ko bohat pasand kiya.',
      siyaraDanceSentence: 'Maine Siyara gaanay ke liye dance seekha aur us ke steps bohat hit hue.',
      karachiPakistan: 'Karachi, Pakistan',
      liveSiyara: 'Siyara mein live performance',
    },
    urdu: {
      nachna: 'رقص', terayBin: 'تیرے بن', hamSafar: 'ہم سفر', liveTerayBin: 'تیرے بن پر لائیو پرفارمنس', teryLiyay: 'تیرے لیے', qamiyabi: 'کامیابی',
      danceSentence: 'میں نے اس گانے کے لیے رقص سیکھا اور اپنے ڈانس اسٹیپس کی وجہ سے کافی مشہور ہوا۔',
      terayBinSentence: 'میں نے تیرے بن گانے کے لیے خود رقص سیکھا اور پرفارمنس دی، جس کے اسٹیپس بہت ہٹ ہوئے۔',
      terayWastay: 'تیرے واسطے',
      siyara: 'سیارا',
      hamSafarComposeSentence: 'میں نے ڈرامہ ہم سفر کے لیے موسیقی ترتیب دی، جو بہت مقبول ہوئی۔',
      hamSafarDanceSentence: 'میں نے ہم سفر کے لیے ایک خاص رقص سیکھا، اور حاضرین نے ان اسٹیپس کو بہت سراہا۔',
      siyaraDanceSentence: 'میں نے سیارا گانے کے لیے رقص سیکھا اور اس کے اسٹیپس بہت مقبول ہوئے۔',
      karachiPakistan: 'کراچی، پاکستان',
      liveSiyara: 'سیارا میں لائیو پرفارمنس',
    },
    arabic: {
      nachna: 'الرقص', terayBin: 'بدونك', hamSafar: 'رفيق الطريق', liveTerayBin: 'أداء مباشر لأغنية بدونك', teryLiyay: 'من أجلك', qamiyabi: 'النجاح',
      danceSentence: 'تعلمت الرقص لهذه الأغنية وأصبحت معروفًا بسبب خطوات هذا الرقص.',
      terayBinSentence: 'تعلمت الرقص بنفسي لأغنية بدونك وقدمت أداءً أصبحت خطواته مشهورة جدًا.',
      terayWastay: 'لأجلك',
      siyara: 'سيارا',
      hamSafarComposeSentence: 'قمت بتأليف الموسيقى لمسلسل رفيق الطريق، وقد أصبح مشهورًا جدًا.',
      hamSafarDanceSentence: 'تعلمت رقصة خاصة لرفيق الطريق، وقد أعجب الجمهور بالخطوات كثيرًا.',
      siyaraDanceSentence: 'تعلمت الرقص لأغنية سيارا وأصبحت خطواتها شائعة جدًا.',
      karachiPakistan: 'كراتشي، باكستان',
      liveSiyara: 'أداء مباشر في سيارا',
    },
    hindi: {
      nachna: 'नृत्य', terayBin: 'तेरे बिना', hamSafar: 'हमसफ़र', liveTerayBin: 'तेरे बिना पर लाइव प्रदर्शन', teryLiyay: 'तुम्हारे लिए', qamiyabi: 'सफलता',
      danceSentence: 'मैंने इस गाने के लिए नृत्य सीखा और इसके डांस स्टेप्स की वजह से काफी प्रसिद्ध हुआ।',
      terayBinSentence: 'मैंने तेरे बिना गाने के लिए खुद नृत्य सीखा और प्रदर्शन किया, जिसके स्टेप्स बहुत लोकप्रिय हुए।',
      terayWastay: 'तेरे वास्ते',
      siyara: 'सियारा',
      hamSafarComposeSentence: 'मैंने नाटक हमसफ़र के लिए संगीत तैयार किया, जो बहुत लोकप्रिय हुआ।',
      hamSafarDanceSentence: 'मैंने हमसफ़र के लिए एक खास नृत्य सीखा और दर्शकों ने उसके स्टेप्स को बहुत सराहा।',
      siyaraDanceSentence: 'मैंने सियारा गाने के लिए नृत्य सीखा और उसके स्टेप्स बहुत लोकप्रिय हुए।',
      karachiPakistan: 'कराची, पाकिस्तान',
      liveSiyara: 'सियारा में लाइव प्रदर्शन',
    },
    spanish: {
      nachna: 'Bailar', terayBin: 'Sin ti', hamSafar: 'Compañero de viaje', liveTerayBin: 'Actuación en vivo en Sin ti', teryLiyay: 'Para ti', qamiyabi: 'Éxito',
      danceSentence: 'Aprendí un baile para esta canción y me hice conocido por sus pasos.',
      terayBinSentence: 'Aprendí a bailar por mi cuenta para Sin ti y realicé una actuación cuyos pasos se hicieron muy populares.',
      terayWastay: 'Para ti',
      siyara: 'Siyara',
      hamSafarComposeSentence: 'Compuse la música para el drama Compañero de viaje, que se volvió muy popular.',
      hamSafarDanceSentence: 'Aprendí un baile especial para Compañero de viaje y el público apreció mucho los pasos.',
      siyaraDanceSentence: 'Aprendí a bailar para Siyara y sus pasos se volvieron muy populares.',
      karachiPakistan: 'Karachi, Pakistán',
      liveSiyara: 'Presentación en vivo en Siyara',
    },
    french: {
      nachna: 'Danser', terayBin: 'Sans toi', hamSafar: 'Compagnon de route', liveTerayBin: 'Performance en direct sur Sans toi', teryLiyay: 'Pour toi', qamiyabi: 'Réussite',
      danceSentence: 'J’ai appris une danse pour cette chanson et je suis devenu connu grâce à ses pas.',
      terayBinSentence: 'J’ai appris seul la danse pour Sans toi et j’ai présenté une performance dont les pas sont devenus très populaires.',
      terayWastay: 'Pour toi',
      siyara: 'Siyara',
      hamSafarComposeSentence: 'J’ai composé la musique du drame Compagnon de route, qui est devenu très populaire.',
      hamSafarDanceSentence: 'J’ai appris une danse spéciale pour Compagnon de route, et le public a beaucoup apprécié les pas.',
      siyaraDanceSentence: 'J’ai appris une danse pour Siyara et ses pas sont devenus très populaires.',
      karachiPakistan: 'Karachi, Pakistan',
      liveSiyara: 'Performance en direct dans Siyara',
    },
    german: {
      nachna: 'Tanzen', terayBin: 'Ohne dich', hamSafar: 'Weggefährte', liveTerayBin: 'Live-Auftritt zu Ohne dich', teryLiyay: 'Für dich', qamiyabi: 'Erfolg',
      danceSentence: 'Ich habe für dieses Lied einen Tanz gelernt und wurde durch die Schritte bekannt.',
      terayBinSentence: 'Ich habe mir für Ohne dich selbst Tanzschritte beigebracht und eine Aufführung gezeigt, deren Schritte sehr beliebt wurden.',
      terayWastay: 'Für dich',
      siyara: 'Siyara',
      hamSafarComposeSentence: 'Ich habe die Musik für das Drama Weggefährte komponiert, das sehr beliebt wurde.',
      hamSafarDanceSentence: 'Ich habe für Weggefährte einen besonderen Tanz gelernt, und das Publikum hat die Schritte sehr geschätzt.',
      siyaraDanceSentence: 'Ich habe für Siyara einen Tanz gelernt und seine Schritte wurden sehr beliebt.',
      karachiPakistan: 'Karachi, Pakistan',
      liveSiyara: 'Live-Auftritt in Siyara',
    },
    turkish: {
      nachna: 'Dans etmek', terayBin: 'Sensiz', hamSafar: 'Yol arkadaşı', liveTerayBin: 'Sensiz için canlı performans', teryLiyay: 'Senin için', qamiyabi: 'Başarı',
      danceSentence: 'Bu şarkı için dans öğrendim ve dans adımları sayesinde tanındım.',
      terayBinSentence: 'Sensiz şarkısı için kendi kendime dans öğrendim ve adımları çok popüler olan bir performans sergiledim.',
      terayWastay: 'Senin için',
      siyara: 'Siyara',
      hamSafarComposeSentence: 'Çok popüler olan Yol arkadaşı dizisi için müzik besteledim.',
      hamSafarDanceSentence: 'Yol arkadaşı için özel bir dans öğrendim ve izleyiciler adımları çok beğendi.',
      siyaraDanceSentence: 'Siyara için dans öğrendim ve adımları çok popüler oldu.',
      karachiPakistan: 'Karaçi, Pakistan',
      liveSiyara: 'Siyara için canlı performans',
    },
    chinese: {
      nachna: '舞蹈', terayBin: '没有你', hamSafar: '同行者', liveTerayBin: '《没有你》的现场表演', teryLiyay: '献给你', qamiyabi: '成功',
      danceSentence: '我为这首歌学习了舞蹈，并因这些舞步而受到关注。',
      terayBinSentence: '我为《没有你》自学舞蹈并进行了表演，其中的舞步很受欢迎。',
      terayWastay: '为你',
      siyara: '西亚拉',
      hamSafarComposeSentence: '我为电视剧《同行者》创作了音乐，这部剧非常受欢迎。',
      hamSafarDanceSentence: '我为《同行者》学习了一支特别的舞蹈，观众非常欣赏这些舞步。',
      siyaraDanceSentence: '我为《西亚拉》学习了舞蹈，它的舞步非常受欢迎。',
      karachiPakistan: '卡拉奇，巴基斯坦',
      liveSiyara: '在《西亚拉》中的现场表演',
    },
    japanese: {
      nachna: 'ダンス', terayBin: '君なしで', hamSafar: '旅の仲間', liveTerayBin: '「君なしで」のライブパフォーマンス', teryLiyay: '君のために', qamiyabi: '成功',
      danceSentence: 'この曲のためにダンスを学び、そのステップで知られるようになりました。',
      terayBinSentence: '「君なしで」のために独学でダンスを学び、そのステップがとても人気になったパフォーマンスを行いました。',
      terayWastay: '君のために',
      siyara: 'シヤラ',
      hamSafarComposeSentence: '私はドラマ「旅の仲間」の音楽を作曲し、この作品はとても人気になりました。',
      hamSafarDanceSentence: '私は「旅の仲間」のために特別なダンスを学び、観客はそのステップをとても高く評価しました。',
      siyaraDanceSentence: '私はシヤラのためにダンスを学び、そのステップはとても人気になりました。',
      karachiPakistan: 'カラチ、パキスタン',
      liveSiyara: 'シヤラでのライブパフォーマンス',
    },
    korean: {
      nachna: '춤', terayBin: '너 없이', hamSafar: '동행자', liveTerayBin: '너 없이 라이브 공연', teryLiyay: '너를 위해', qamiyabi: '성공',
      danceSentence: '이 노래를 위해 춤을 배웠고 그 춤 동작 덕분에 알려졌습니다.',
      terayBinSentence: '너 없이 곡을 위해 스스로 춤을 익혀 공연했고, 그 동작들이 큰 인기를 얻었습니다.',
      terayWastay: '너를 위해',
      siyara: '시아라',
      hamSafarComposeSentence: '저는 드라마 동행자를 위해 음악을 작곡했고, 이 작품은 매우 큰 인기를 얻었습니다.',
      hamSafarDanceSentence: '저는 동행자를 위해 특별한 춤을 배웠고, 관객들은 그 동작을 매우 좋아했습니다.',
      siyaraDanceSentence: '저는 시아라를 위해 춤을 배웠고 그 동작들은 매우 인기를 얻었습니다.',
      karachiPakistan: '카라치, 파키스탄',
      liveSiyara: '시아라 라이브 공연',
    },
  };
  const fb = phraseFallbacks[lang];
  if (fb) {
    if (key.includes('karachi') && key.includes('pakistan')) return fb.karachiPakistan || text;
    if (key.includes('live performance') && key.includes('siyara')) return fb.liveSiyara || fb.siyara || text;
    if (key.includes('siyara') && key.includes('dance')) return fb.siyaraDanceSentence || fb.siyara || text;
    if (key.includes('live performance') && key.includes('teray bin')) return fb.liveTerayBin;
    if (key.includes('ma na teray bin') || (key.includes('teray bin') && key.includes('performance'))) return fb.terayBinSentence;
    if (key.includes('ma na is') && (key.includes('dance') || key.includes('gnay'))) return fb.danceSentence;
    if (key.includes('i composed the music for the drama ham safar')) return fb.hamSafarComposeSentence || fb.hamSafar;
    if (key.includes('i learned a special dance for ham safar')) return fb.hamSafarDanceSentence || fb.hamSafar;
    if (key.includes('nachna')) return fb.nachna;
    if (key.includes('teray wastay')) return fb.terayWastay || fb.teryLiyay;
    if (key.includes('siyara')) return fb.siyara || text;
    if (key.includes('teray bin') || key.includes('tery bin')) return fb.terayBin;
    if (key.includes('ham safar') || key.includes('humsafar')) return fb.hamSafar;
    if (key.includes('tery liyay') || key.includes('tery liyaye') || key.includes('teray liyay')) return fb.teryLiyay;
    if (key.includes('qamiyabi')) return fb.qamiyabi;
  }

  return text;
}

function localizeFallbackProjects(projects = [], targetLanguage = 'English') {
  return sanitizeLocalizedProjects(projects, projects).map(project => ({
    ...project,
    title: strictLocalizeFallback(project.title, targetLanguage, 'project'),
    desc: strictLocalizeFallback(project.desc, targetLanguage, 'project'),
  }));
}

function localizeFallbackSections(customSections = [], targetLanguage = 'English') {
  return sanitizeLocalizedSections(customSections, customSections).map(section => ({
    ...section,
    name: strictLocalizeFallback(section.name, targetLanguage, 'section'),
    items: (section.items || []).map(item => ({
      ...item,
      heading: strictLocalizeFallback(item.heading, targetLanguage, 'item'),
      desc: strictLocalizeFallback(item.desc, targetLanguage, 'item'),
    })),
  }));
}

function buildLocalLocalizedOutput({ targetLanguage = 'English', projects = [], customSections = [], skills = [], name = '', medium = '' } = {}) {
  return {
    labels: labelsForLanguage(targetLanguage),
    name: transliterateLatinName(name, targetLanguage),
    medium: strictLocalizeFallback(medium, targetLanguage, 'medium'),
    projects: localizeFallbackProjects(projects, targetLanguage),
    customSections: localizeFallbackSections(customSections, targetLanguage),
    skills: Array.isArray(skills) ? skills.map(cleanText).filter(Boolean) : [],
  };
}

async function buildLocalizedOutput({ targetLanguage = 'English', projects = [], customSections = [], skills = [], name = '', medium = '', description = '', artistBio = '', artistStatement = '' } = {}) {
  const sourceBio = cleanText(artistBio) || cleanText(description);
  const sourceStatement = cleanText(artistStatement) || cleanText(description);
  const fallback = { ...buildLocalLocalizedOutput({ targetLanguage, projects, customSections, skills, name, medium }), bio: await translateTextStrict(sourceBio, targetLanguage), artistStatement: await translateTextStrict(sourceStatement, targetLanguage) };
  if (!fallback.artistStatement && cleanText(artistStatement)) fallback.artistStatement = cleanText(artistStatement);
  const lang = cleanText(targetLanguage) || 'English';
  if (!aiAvailable() || lang.toLowerCase() === 'english') return fallback;

  try {
    const aiText = await generateAiText({
      temperature: 0.05,
      maxTokens: 1800,
      messages: [
        {
          role: 'system',
          content: `Translate or transliterate user-visible portfolio content into ${lang}. Use the correct script for ${lang}. If ${lang} is Arabic, write Arabic script only for normal prose. If ${lang} is Urdu, write Urdu script only for normal prose. If ${lang} is Hindi, write Devanagari only for normal prose. Never output Cyrillic/Russian letters unless the target language is Russian. Translate Roman Urdu/Urdu/Hindi input by meaning, not letter-by-letter. This includes the person's display name, medium/field, every project title, every project description, every custom section name, every custom item heading, every custom item description, and any location-like plain-text field. Do not leave user-visible titles, headings, or descriptions in the source language unless they are URLs, emails, brand names, or technology names that should remain unchanged. For person names: transliterate into the target script for Arabic, Urdu, Hindi, Chinese, Japanese, and Korean; for Latin-script languages such as Spanish/French/German, keep the same spelling unless a common localized form exists. For project titles and custom section headings, translate by meaning when possible. Preserve only IDs, links, URLs, emails, phone numbers, GitHub names, LinkedIn links, technology/tool names such as React, Node.js, Python, GitHub, Vercel, Railway, and registered brand names. Do not preserve song/drama-style project titles just because they look like names; translate or transliterate them. Do not invent any fact. Return only valid JSON.`,
        },
        {
          role: 'user',
          content: `Return exactly this JSON shape:
{
  "labels": {"contact":"","linkedin":"","github":"","phone":"","email":"","location":"","skills":"","projects":"","artistBio":"","artistStatement":"","technicalSkills":"","about":"","statement":"","factLockTrustReport":"","trustSubtitle":""},
  "name": "",
  "medium": "",
  "bio": "",
  "artistStatement": "",
  "projects": [{"id":"","title":"","desc":"","link":""}],
  "customSections": [{"id":"","name":"","items":[{"id":"","heading":"","desc":"","link":""}]}],
  "skills": []
}

Language: ${lang}
Name: ${cleanText(name)}
Medium/field: ${cleanText(medium)}
Bio/description: ${cleanText(description)}
Generated artist bio draft: ${cleanText(artistBio)}
Generated artist statement draft: ${cleanText(artistStatement)}
Labels fallback: ${JSON.stringify(fallback.labels)}
Projects: ${JSON.stringify(projects)}
Custom sections: ${JSON.stringify(customSections)}
Skills: ${JSON.stringify(skills)}`,
        },
      ],
    });
    const parsed = parseJsonObject(aiText || '');
    const rawProjects = sanitizeLocalizedProjects(parsed.projects, projects);
    const mergedProjects = rawProjects.map((project, index) => {
      const original = projects[index] || {};
      const fb = fallback.projects[index] || {};
      const titleCandidate = sameCleanText(project.title, original.title) && fb.title ? fb.title : project.title;
      const descCandidate = sameCleanText(project.desc, original.desc) && fb.desc ? fb.desc : project.desc;
      return {
        ...project,
        title: safeLocalizedValue(titleCandidate, fb.title || original.title, lang, 'project'),
        desc: safeLocalizedValue(descCandidate, fb.desc || original.desc, lang, 'project'),
      };
    });
    const rawSections = sanitizeLocalizedSections(parsed.customSections, customSections);
    const mergedSections = rawSections.map((section, sectionIndex) => {
      const original = customSections[sectionIndex] || {};
      const fb = fallback.customSections[sectionIndex] || {};
      const originalItems = Array.isArray(original.items) ? original.items : [];
      const fallbackItems = Array.isArray(fb.items) ? fb.items : [];
      const sectionName = sameCleanText(section.name, original.name) && fb.name ? fb.name : section.name;
      return {
        ...section,
        name: safeLocalizedValue(sectionName, fb.name || original.name, lang, 'section'),
        items: (section.items || []).map((item, itemIndex) => {
          const originalItem = originalItems[itemIndex] || {};
          const fbItem = fallbackItems[itemIndex] || {};
          const headingCandidate = sameCleanText(item.heading, originalItem.heading) && fbItem.heading ? fbItem.heading : item.heading;
          const descCandidate = sameCleanText(item.desc, originalItem.desc) && fbItem.desc ? fbItem.desc : item.desc;
          return {
            ...item,
            heading: safeLocalizedValue(headingCandidate, fbItem.heading || originalItem.heading, lang, 'item'),
            desc: safeLocalizedValue(descCandidate, fbItem.desc || originalItem.desc, lang, 'item'),
            link: item.link || originalItem.link || fbItem.link || '',
            media: originalItem.media || item.media || fbItem.media || null,
          };
        }),
      };
    });
    const parsedName = cleanText(parsed.name);
    const parsedMedium = cleanText(parsed.medium);
    return {
      labels: { ...fallback.labels, ...(parsed.labels || {}) },
      name: safeLocalizedValue(parsedName && parsedName.toLowerCase() !== cleanText(name).toLowerCase() ? parsedName : fallback.name, fallback.name || name, lang, 'description'),
      medium: safeLocalizedValue(parsedMedium && parsedMedium.toLowerCase() !== cleanText(medium).toLowerCase() ? parsedMedium : fallback.medium, fallback.medium || medium, lang, 'medium'),
      bio: safeLocalizedValue(cleanText(parsed.bio), fallback.bio || description, lang, 'description'),
      artistStatement: safeLocalizedValue(cleanText(parsed.artistStatement), fallback.artistStatement || description, lang, 'description'),
      projects: mergedProjects,
      customSections: mergedSections,
      skills: Array.isArray(parsed.skills) && parsed.skills.length ? parsed.skills.map(cleanText).filter(Boolean) : fallback.skills,
    };
  } catch (error) {
    console.warn('Localized output generation failed; local labels used:', error.message);
    return fallback;
  }
}


// Log configuration on startup
console.log('=== MuseForge Backend Configuration ===');
console.log('PORT:', process.env.PORT || 5000);
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('FRONTEND_URL:', process.env.FRONTEND_URL || 'not set');
console.log('AI_PROVIDER:', selectAiProvider());
console.log('GEMINI_API_KEY:', GEMINI_API_KEY ? 'SET (length: ' + GEMINI_API_KEY.length + ')' : 'NOT SET');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET (length: ' + process.env.OPENAI_API_KEY.length + ')' : 'NOT SET');
console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? 'SET (length: ' + process.env.GROQ_API_KEY.length + ')' : 'NOT SET');
console.log('GOOGLE_LOGIN:', GOOGLE_CLIENT_ID ? 'CONFIGURED' : 'NOT CONFIGURED');
console.log('ACCOUNT_EMAILS:', mailTransporter ? 'CONFIGURED' : 'NOT CONFIGURED');
console.log('USER_STORE:', USERS_FILE);
console.log('PUBLIC_PORTFOLIO_STORE:', publicPortfolioDatabaseEnabled ? `SUPABASE:${SUPABASE_PORTFOLIOS_TABLE}` : PUBLIC_PORTFOLIOS_FILE);
console.log('REVIEWS_STORE:', publicPortfolioDatabaseEnabled ? `SUPABASE:${SUPABASE_REVIEWS_TABLE}` : REVIEWS_FILE);
console.log('=======================================');

app.get('/', (req, res) => res.send('MuseForge backend running'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    publicPortfolioStorage: publicPortfolioDatabaseEnabled ? 'supabase' : 'local-json',
    reviewsStorage: publicPortfolioDatabaseEnabled ? 'supabase' : 'local-json'
  });
});

app.get('/config', (req, res) => {
  res.json({
    googleClientId: GOOGLE_CLIENT_ID || '',
    googleLoginConfigured: Boolean(GOOGLE_CLIENT_ID),
  });
});



app.get('/reviews', async (req, res) => {
  try {
    const reviews = await getAllReviews();
    return res.json({ reviews });
  } catch (error) {
    console.error('Could not load reviews:', error.message);
    return res.status(500).json({ error: 'Could not load reviews.' });
  }
});

app.post('/reviews', async (req, res) => {
  try {
    const rating = Number.parseInt(req.body?.rating, 10);
    const reviewText = String(req.body?.review || '').trim();
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Please select a rating from 1 to 5 stars.' });
    }
    if (reviewText.length < 5) {
      return res.status(400).json({ error: 'Review must be at least 5 characters long.' });
    }
    if (reviewText.length > 1000) {
      return res.status(400).json({ error: 'Review must be 1000 characters or fewer.' });
    }
    const saved = await saveReview({
      name: String(req.body?.name || '').trim(),
      email: normalizeEmail(req.body?.email || ''),
      rating,
      review: reviewText,
    });
    return res.status(201).json({ success: true, review: saved, message: 'Thank you for sharing your review.' });
  } catch (error) {
    console.error('Could not save review:', error.message);
    return res.status(error.statusCode || 500).json({ error: error.message || 'Could not save review.' });
  }
});

app.post('/auth/signup', async (req, res) => {
  const name = cleanText(req.body?.name);
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must contain at least 8 characters.' });

  const users = readUsers();
  const existingIndex = users.findIndex(user => normalizeEmail(user.email) === email);
  const existing = existingIndex >= 0 ? users[existingIndex] : null;
  if (existing && existing.emailVerified !== false) {
    return res.status(409).json({ error: 'An account with this email already exists. Please log in or use Forgot password.' });
  }

  const { salt, hash } = hashPassword(password);
  const rawVerificationToken = createActionToken();
  const now = new Date();
  const user = {
    ...(existing || {}),
    id: existing?.id || crypto.randomUUID(),
    name,
    email,
    provider: existing?.provider || 'password',
    passwordSalt: salt,
    passwordHash: hash,
    emailVerified: false,
    verificationTokenHash: hashActionToken(rawVerificationToken),
    verificationTokenExpiresAt: new Date(now.getTime() + (24 * 60 * 60 * 1000)).toISOString(),
    createdAt: existing?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };
  delete user.password;

  if (existingIndex >= 0) users[existingIndex] = user;
  else users.push(user);
  writeUsers(users);

  const verificationEmail = await sendVerificationEmail(user, rawVerificationToken);
  return res.status(existing ? 200 : 201).json({
    pendingVerification: true,
    email: user.email,
    verificationEmailSent: verificationEmail.sent,
    message: verificationEmail.sent
      ? `Account created. We sent a verification link to ${user.email}.`
      : 'Account created, but email delivery is not configured yet. Complete the email setup, then use Resend verification.',
    ...(process.env.NODE_ENV === 'test' ? { testVerificationToken: rawVerificationToken } : {}),
  });
});

app.post('/auth/signup', async (req, res) => {
  const name = cleanText(req.body?.name);
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must contain at least 8 characters.' });

  const users = readUsers();
  const existingIndex = users.findIndex(user => normalizeEmail(user.email) === email);
  const existing = existingIndex >= 0 ? users[existingIndex] : null;

  if (existing && existing.emailVerified !== false) {
    return res.status(409).json({ error: 'An account with this email already exists. Please log in or use another email.' });
  }

  const { salt, hash } = hashPassword(password);
  const now = new Date();

  const user = {
    ...(existing || {}),
    id: existing?.id || crypto.randomUUID(),
    name,
    email,
    provider: existing?.provider || 'password',
    passwordSalt: salt,
    passwordHash: hash,
    emailVerified: true,
    emailVerifiedAt: now.toISOString(),
    createdAt: existing?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };

  delete user.password;
  delete user.verificationTokenHash;
  delete user.verificationTokenExpiresAt;
  delete user.passwordResetTokenHash;
  delete user.passwordResetTokenExpiresAt;

  if (existingIndex >= 0) users[existingIndex] = user;
  else users.push(user);

  writeUsers(users);

  return res.status(existing ? 200 : 201).json({
    token: createAuthToken(user),
    user: publicUser(user),
    pendingVerification: false,
    emailVerified: true,
    message: 'Account created successfully. You can now start building your portfolio.',
  });
});

app.post('/auth/resend-verification', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const users = readUsers();
  const userIndex = users.findIndex(user => normalizeEmail(user.email) === email);
  const user = userIndex >= 0 ? users[userIndex] : null;
  let rawVerificationToken = '';
  let verificationEmail = { sent: false };

  if (user && user.emailVerified === false) {
    rawVerificationToken = createActionToken();
    users[userIndex] = {
      ...user,
      verificationTokenHash: hashActionToken(rawVerificationToken),
      verificationTokenExpiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeUsers(users);
    verificationEmail = await sendVerificationEmail(users[userIndex], rawVerificationToken);
  }

  return res.json({
    message: 'If an unverified account exists for that email, a new verification link has been sent.',
    emailSent: verificationEmail.sent,
    ...(process.env.NODE_ENV === 'test' && rawVerificationToken ? { testVerificationToken: rawVerificationToken } : {}),
  });
});

app.post('/auth/forgot-password', async (req, res) => {
  const email = normalizeEmail(req.body?.email);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const users = readUsers();
  const userIndex = users.findIndex(user => normalizeEmail(user.email) === email);
  const user = userIndex >= 0 ? users[userIndex] : null;

  let rawResetToken = '';
  let resetEmail = { sent: false };

  // IMPORTANT:
  // Allow password reset for:
  // 1. normal password users
  // 2. Google-created verified users without passwordHash/passwordSalt
  if (user && user.emailVerified !== false) {
    rawResetToken = createActionToken();

    users[userIndex] = {
      ...user,
      passwordResetTokenHash: hashActionToken(rawResetToken),
      passwordResetTokenExpiresAt: new Date(Date.now() + (60 * 60 * 1000)).toISOString(),
      updatedAt: new Date().toISOString(),
    };

    writeUsers(users);
    resetEmail = await sendPasswordResetEmail(users[userIndex], rawResetToken);
  }

  return res.json({
    message: 'If an account exists for that email, a password reset link has been sent.',
    emailSent: resetEmail.sent,
    ...(process.env.NODE_ENV === 'test' && rawResetToken ? { testResetToken: rawResetToken } : {}),
  });
});

  const users = readUsers();
  const userIndex = users.findIndex(user => normalizeEmail(user.email) === email);
  const user = userIndex >= 0 ? users[userIndex] : null;
  let rawResetToken = '';
  let resetEmail = { sent: false };

  if (user && user.passwordHash && user.passwordSalt) {
    rawResetToken = createActionToken();
    users[userIndex] = {
      ...user,
      passwordResetTokenHash: hashActionToken(rawResetToken),
      passwordResetTokenExpiresAt: new Date(Date.now() + (60 * 60 * 1000)).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeUsers(users);
    resetEmail = await sendPasswordResetEmail(users[userIndex], rawResetToken);
  }

  return res.json({
    message: 'If a password account exists for that email, a reset link has been sent.',
    emailSent: resetEmail.sent,
    ...(process.env.NODE_ENV === 'test' && rawResetToken ? { testResetToken: rawResetToken } : {}),
  });
});

app.post('/auth/reset-password', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');
  if (!token) return res.status(400).json({ error: 'Reset token is required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must contain at least 8 characters.' });

  const tokenHash = hashActionToken(token);
  const users = readUsers();
  const userIndex = users.findIndex(user => user.passwordResetTokenHash === tokenHash);
  const user = userIndex >= 0 ? users[userIndex] : null;
  const expiresAt = user?.passwordResetTokenExpiresAt ? Date.parse(user.passwordResetTokenExpiresAt) : 0;

  if (!user || !expiresAt || expiresAt < Date.now()) {
    return res.status(400).json({ error: 'This password reset link is invalid or has expired. Please request a new one.' });
  }

  const { salt, hash } = hashPassword(password);
  const updatedUser = {
    ...user,
    passwordSalt: salt,
    passwordHash: hash,
    emailVerified: true,
    emailVerifiedAt: user.emailVerifiedAt || new Date().toISOString(),
    passwordChangedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  delete updatedUser.passwordResetTokenHash;
  delete updatedUser.passwordResetTokenExpiresAt;
  delete updatedUser.verificationTokenHash;
  delete updatedUser.verificationTokenExpiresAt;
  users[userIndex] = updatedUser;
  writeUsers(users);
  await sendPasswordChangedEmail(updatedUser);

  return res.json({ message: 'Password changed successfully. You can now log in with your new password.' });
});

app.post('/auth/google', async (req, res) => {
  if (!googleAuthClient || !GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Google login is not configured on the server.' });
  }

  const credential = String(req.body?.credential || '').trim();
  if (!credential) return res.status(400).json({ error: 'Google credential is required.' });

  try {
    const ticket = await googleAuthClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = normalizeEmail(payload?.email);
    if (!email || payload?.email_verified !== true) {
      return res.status(401).json({ error: 'Google could not verify this email address.' });
    }

    const users = readUsers();
    const userIndex = users.findIndex(item => normalizeEmail(item.email) === email);
    let user = userIndex >= 0 ? users[userIndex] : null;
    const isNewAccount = !user;
    const wasUnverified = Boolean(user && user.emailVerified === false);

    if (user) {
      user = {
        ...user,
        name: cleanText(user.name || payload?.name || email.split('@')[0]),
        googleSub: String(payload?.sub || user.googleSub || ''),
        emailVerified: true,
        emailVerifiedAt: user.emailVerifiedAt || new Date().toISOString(),
        avatarUrl: cleanText(payload?.picture || user.avatarUrl || ''),
        lastLoginAt: new Date().toISOString(),
      };
      delete user.verificationTokenHash;
      delete user.verificationTokenExpiresAt;
      users[userIndex] = user;
    } else {
      user = {
        id: crypto.randomUUID(),
        name: cleanText(payload?.name || email.split('@')[0]),
        email,
        googleSub: String(payload?.sub || ''),
        provider: 'google',
        emailVerified: true,
        emailVerifiedAt: new Date().toISOString(),
        avatarUrl: cleanText(payload?.picture || ''),
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };
      users.push(user);
    }

    writeUsers(users);
    const shouldWelcome = isNewAccount || wasUnverified;
    const welcomeEmail = shouldWelcome ? await sendWelcomeEmail(user) : { sent: false };
    return res.json({
      token: createAuthToken(user),
      user: publicUser(user),
      isNewAccount,
      welcomeEmailSent: shouldWelcome ? welcomeEmail.sent : undefined,
      message: isNewAccount
        ? (welcomeEmail.sent ? `Account created successfully. A welcome email was sent to ${user.email}.` : 'Google account connected successfully.')
        : 'Logged in with Google successfully.',
    });
  } catch (error) {
    console.error('Google authentication failed:', error.message);
    return res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
  }
});

app.post('/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const users = readUsers();
  const userIndex = users.findIndex(item => normalizeEmail(item.email) === email);
  const user = userIndex >= 0 ? users[userIndex] : null;

  if (!user || !passwordMatches(password, user)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  // Preserve accounts created by older MuseForge builds, which did not store a verification flag.
  if (typeof user.emailVerified === 'undefined') {
    users[userIndex] = { ...user, emailVerified: true, emailVerifiedAt: new Date().toISOString() };
    writeUsers(users);
  } else if (user.emailVerified === false) {
    return res.status(403).json({
      code: 'EMAIL_NOT_VERIFIED',
      email: user.email,
      error: 'Please verify your email before logging in. You can request a new verification link.',
    });
  }

  const activeBeforeUpgrade = users[userIndex] || user;
  if (!activeBeforeUpgrade.passwordHash || !activeBeforeUpgrade.passwordSalt) {
    const { salt, hash } = hashPassword(password);
    users[userIndex] = { ...activeBeforeUpgrade, passwordSalt: salt, passwordHash: hash };
    delete users[userIndex].password;
    writeUsers(users);
  }

  const activeUser = users[userIndex] || user;
  return res.json({ token: createAuthToken(activeUser), user: publicUser(activeUser), message: 'Logged in successfully.' });
});

app.get('/auth/me', (req, res) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = verifyAuthToken(token);
  if (!payload) return res.status(401).json({ error: 'Session is invalid or expired.' });
  return res.json({ user: { id: payload.sub, name: payload.name, email: payload.email } });
});


app.get('/user-history/:email', (req, res) => {
  try {
    const email = normalizeEmail(req.params.email || '');
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    return res.json({ history: readUserHistoryForEmail(email) });
  } catch (error) {
    console.error('User history read failed:', error);
    return res.status(500).json({ error: 'Could not load saved portfolio history.' });
  }
});

app.post('/user-history', (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email || '');
    const history = saveUserHistoryForEmail(email, req.body?.history || {});
    return res.json({ history });
  } catch (error) {
    console.error('User history save failed:', error);
    return res.status(error.statusCode || 500).json({ error: error.message || 'Could not save portfolio history.' });
  }
});

app.post('/portfolio/share', async (req, res) => {
  const payload = req.body || {};
  const portfolioText = cleanText(payload.portfolio);
  const name = cleanText(payload.name);
  if (!portfolioText || !name) {
    return res.status(400).json({ error: 'Generate a portfolio with a name before creating a share link.' });
  }

  const id = createPortfolioSlug(name);
  const publicPortfolio = {
    id,
    name,
    medium: cleanText(payload.medium),
    language: cleanText(payload.language || 'English'),
    portfolio: String(payload.portfolio || ''),
    projects: Array.isArray(payload.projects) ? payload.projects : [],
    customSections: Array.isArray(payload.customSections) ? payload.customSections : [],
    imagePreview: typeof payload.imagePreview === 'string' ? payload.imagePreview : '',
    imagePosition: payload.imagePosition || { x: 50, y: 50 },
    contact: payload.contact || {},
    skills: Array.isArray(payload.skills) ? payload.skills : [],
    factLockReviews: Array.isArray(payload.factLockReviews) ? payload.factLockReviews : [],
    localizedOutput: payload.localizedOutput && typeof payload.localizedOutput === 'object' ? payload.localizedOutput : null,
    trustReport: payload.trustReport && typeof payload.trustReport === 'object' ? payload.trustReport : null,
    createdBy: cleanText(payload.createdBy),
    createdAt: new Date().toISOString(),
    storage: publicPortfolioDatabaseEnabled ? 'supabase' : 'local-json',
  };

  try {
    const savedPortfolio = await savePublicPortfolio(publicPortfolio);
    const frontendBase = String(process.env.FRONTEND_URL || 'http://localhost:3000').trim().replace(/\/$/, '');
    return res.status(201).json({
      id,
      publicPath: `/portfolio/${id}`,
      publicUrl: `${frontendBase}/portfolio/${id}`,
      storage: savedPortfolio.storage || publicPortfolio.storage,
    });
  } catch (error) {
    console.error('Could not create public portfolio link:', error.message);
    return res.status(500).json({ error: 'Could not create a persistent public portfolio link. Check the backend storage configuration.' });
  }
});

app.get('/portfolio/:id', async (req, res) => {
  const id = cleanText(req.params.id);
  try {
    const portfolio = await findPublicPortfolio(id);
    if (!portfolio) return res.status(404).json({ error: 'Portfolio not found.' });
    return res.json({ portfolio });
  } catch (error) {
    console.error('Could not read public portfolio:', error.message);
    return res.status(500).json({ error: 'Could not load this public portfolio link.' });
  }
});



app.post('/suggest-projects', aiLimiter, async (req, res) => {
  try {
    const { name = '', medium = '', description = '', projects = [], targetLanguage = 'English', aiTone = 'Professional' } = req.body || {};
    const cleanDescription = cleanText(description);
    if (!cleanDescription) return res.status(400).json({ error: 'Bio / description is required before suggesting projects.' });

    let suggestions = [];
    if (aiAvailable()) {
      try {
        const aiText = await generateAiText({
          temperature: 0.3,
          maxTokens: 800,
          messages: [
            { role: 'system', content: `You are a careful creative portfolio coach. ${languageStrictInstruction(targetLanguage)} ${toneInstruction(aiTone)} Suggest realistic, medium-specific portfolio project ideas based only on the user's bio, medium, and existing project style. These are IDEAS, not claimed completed achievements. Avoid generic filler like 'project 1'. Titles must be short, natural, and relevant to the medium. Descriptions must be one practical sentence. Do not invent awards, clients, metrics, dates, or completed outcomes. Return only valid JSON.` },
            { role: 'user', content: `Return exactly this JSON shape: {"suggestions":[{"title":"short project idea title","desc":"one practical sentence explaining what the creator could build/show"}]}. Provide exactly 3 suggestions.

Name: ${cleanText(name)}
Medium: ${cleanText(medium)}
Bio: ${cleanDescription}
Existing projects: ${JSON.stringify(Array.isArray(projects) ? projects.slice(0, 8) : [])}
Target language: ${cleanText(targetLanguage) || 'English'}` },
          ],
        });
        const parsed = parseJsonObject(aiText || '');
        suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      } catch (error) {
        console.warn('AI project suggestions failed; local fallback used:', error.message);
      }
    }
    if (!suggestions.length) suggestions = fallbackProjectSuggestions({ medium, description, targetLanguage });
    suggestions = suggestions.slice(0, 3).map((item, index) => ({
      id: `suggestion-${index + 1}`,
      title: localizeBasicTextFallback(cleanText(item.title) || `Project idea ${index + 1}`, targetLanguage),
      desc: localizeBasicTextFallback(cleanText(item.desc) || 'Create a focused portfolio entry using your existing creative direction.', targetLanguage),
    }));
    return res.json({ suggestions });
  } catch (error) {
    console.error('Project suggestion failed:', error);
    return res.status(500).json({ error: 'Could not generate project suggestions.' });
  }
});

app.post('/factlock/regenerate', aiLimiter, async (req, res) => {
  try {
    const { id, title, originalDesc, targetLanguage = 'English', creatorType = 'creator', medium = '', aiTone = 'Professional' } = req.body || {};
    const cleanOriginal = cleanText(originalDesc);
    const cleanTitle = cleanText(title || 'Portfolio item');
    if (!cleanOriginal) {
      return res.status(400).json({ error: 'Original description is required for regeneration.' });
    }

    let enhancedDesc = '';
    if (aiAvailable()) {
      try {
        const aiText = await generateAiText({
          temperature: 0.08,
          maxTokens: 450,
          messages: [
            {
              role: 'system',
              content: `You are FactLock AI — an extremely strict fact-checking creative assistant. ${languageStrictInstruction(targetLanguage)} ${toneInstruction(aiTone)} Improve only this one FactLock item. Output only valid JSON in this exact shape: {"enhanced":"..."}. Only enhance grammar, flow, emotional tone, and professionalism. Preserve original meaning 100%. Never add new achievements, awards, dates, numbers, tools, metrics, or facts.`,
            },
            {
              role: 'user',
              content: `Creator type: ${cleanText(creatorType)}
Medium/field: ${cleanText(medium)}
Item title: ${cleanTitle}
Original user text: ${cleanOriginal}

Regenerate a better portfolio description for this single item only.`,
            },
          ],
        });
        const parsed = parseJsonObject(aiText || '');
        enhancedDesc = cleanText(parsed.enhanced || aiText).replace(/^"|"$/g, '');
        if (!enhancedDesc || sameCleanText(enhancedDesc, cleanOriginal) || hasUnexpectedScriptForLanguage(enhancedDesc, targetLanguage)) {
          enhancedDesc = await translateTextStrict(polishDescriptionLocally(cleanOriginal, cleanTitle), targetLanguage);
        }
      } catch (error) {
        enhancedDesc = await translateTextStrict(polishDescriptionLocally(cleanOriginal, cleanTitle), targetLanguage);
      }
    } else {
      enhancedDesc = localizeBasicTextFallback(polishDescriptionLocally(cleanOriginal, cleanTitle), targetLanguage);
    }

    const review = buildFactLockReview({ id: cleanText(id) || 'regenerated', title: cleanTitle, desc: cleanOriginal }, enhancedDesc);
    return res.json({ ...review, status: 'pending' });
  } catch (error) {
    console.error('FactLock regeneration failed:', error);
    return res.status(500).json({ error: 'Could not regenerate this FactLock item.' });
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

              Write a strong 5-6 sentence portfolio bio.

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
    const safeDescriptionForPortfolio = await translateTextStrict(description, safeTargetLanguage);
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
              content: `You are FactLock AI. ${languageStrictInstruction(safeTargetLanguage)} ${toneInstruction(aiTone)} Rewrite project descriptions in a clearer, more polished tone while preserving every original fact. Make the improvement noticeable, but never invent tools, metrics, features, outcomes, dates, clients, awards, responsibilities, or any unsupported detail. A short personal sentence such as \"I love flowers\" may become \"This project reflects my love for flowers.\" Keep empty descriptions empty. Return only valid JSON.`,
            },
            {
              role: 'user',
              content: `Return exactly this shape: {"projects":[{"id":"original id","desc":"one polished sentence"}]}. Do not change IDs or links. Requested output language: ${cleanText(safeTargetLanguage) || 'English'}. Creator type: ${cleanText(creatorType) || 'creator'}. Medium/field: ${cleanText(medium)}.\n\nProjects:\n${JSON.stringify(projectItems.map(project => ({ id: project.id, title: project.title, desc: project.desc })))}`,
            },
          ],
        });
        const parsed = parseJsonObject(aiText || '');
        const returned = Array.isArray(parsed.projects) ? parsed.projects : [];
        enhancedProjects = await Promise.all(projectItems.map(async project => {
          const match = returned.find(item => String(item.id) === project.id);
          const candidate = project.desc ? cleanText(match?.desc || '') : '';
          const original = cleanText(project.desc);
          let desc = '';
          if (original) {
            desc = candidate && candidate.toLowerCase() !== original.toLowerCase()
              ? candidate
              : await translateTextStrict(polishDescriptionLocally(original, project.title), safeTargetLanguage);
            if (hasUnexpectedScriptForLanguage(desc, safeTargetLanguage) || sameCleanText(desc, original)) {
              desc = await translateTextStrict(polishDescriptionLocally(original, project.title), safeTargetLanguage);
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
        project.desc ? await translateTextStrict(polishDescriptionLocally(project.desc, project.title), safeTargetLanguage) : ''
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
              content: `You are FactLock AI. ${languageStrictInstruction(safeTargetLanguage)} ${toneInstruction(aiTone)} Rewrite custom portfolio-section item descriptions in a clearer, more polished tone while preserving every original fact. Never invent tools, metrics, features, outcomes, dates, clients, awards, responsibilities, or any unsupported detail. Do not repeat only the item heading as the description. Keep empty descriptions empty. Return only valid JSON.`,
            },
            {
              role: 'user',
              content: `Return exactly this shape: {"items":[{"reviewId":"original reviewId","desc":"one polished sentence"}]}. Do not change reviewIds, headings, section names, links, or media. Requested output language: ${safeTargetLanguage}. Medium/field: ${cleanText(medium)}.

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
            const candidate = original ? cleanText(match?.desc || '') : '';
            let desc = '';
            if (original) {
              desc = candidate && candidate.toLowerCase() !== original.toLowerCase()
                ? candidate
                : await translateTextStrict(polishDescriptionLocally(original, item.heading || section.name), safeTargetLanguage);
              if (hasUnexpectedScriptForLanguage(desc, safeTargetLanguage) || sameCleanText(desc, original)) {
                desc = await translateTextStrict(polishDescriptionLocally(original, item.heading || section.name), safeTargetLanguage);
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
          const desc = original ? await translateTextStrict(polishDescriptionLocally(original, item.heading || section.name), safeTargetLanguage) : '';
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
  const generatedArtistBio = extractGeneratedPortfolioSection(portfolio, _genBioHeading);

  let generatedArtistStatement = extractGeneratedPortfolioSection(portfolio, _genStatementHeading);

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

portfolio = replaceGeneratedPortfolioSection(portfolio, _genStatementHeading, generatedArtistStatement);

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
    skills: skillItems,
    name,
    medium,
    description,
  });

  return res.json({
    portfolio,
    enhancedProjects,
    enhancedCustomSections,
    localizedOutput,
    warning: warnings.join(' '),
    enhancementApplied: Boolean(enhanceProjectDescriptions && projectItems.length),
    targetLanguage: safeTargetLanguage,
  });
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

async function extractCvTextFromPdfBuffer(buffer) {
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
    const cvText = await extractCvTextFromPdfBuffer(req.file.buffer);
    if (!cleanText(cvText)) {
      return res.json({
        ...parseCvTextLocally(''),
        warning: 'CV text could not be read from this PDF. Please fill the form manually or upload a text-based PDF.'
      });
    }
    await sendToParserAndRespond(cvText, res);
  } catch (err) {
    console.error('CV parsing error:', err.message);
    res.status(500).json({ error: 'CV parsing failed', details: err.message });
  }
});

function preprocessText(text) {
  let t = text;
  t = t.replace(/([a-zA-Z])\s+\.\s*(com|edu|pk|org|net|io)\b/gi, '$1.$2');
  t = t.replace(/(github)\s*\.\s*com\s*\/\s*/gi, 'github.com/');
  t = t.replace(/(linkedin)\s*\.\s*com\s*\/\s*in\s*\/\s*/gi, 'linkedin.com/in/');
  return t;
}


function uniq(items = []) {
  return [...new Set(items.map(item => String(item || '').trim()).filter(Boolean))];
}

function extractSection(text, headings = []) {
  const escaped = headings.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`(?:^|\\n)\\s*(?:${escaped})\\s*[:\\-]?\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(?:Education|Experience|Projects?|Skills?|Certifications?|Awards?|Achievements?|Contact|Profile|Summary|Languages?|Interests?|Volunteering|Publications)\\s*[:\\-]?\\s*(?:\\n|$)|$)`, 'i');
  const match = text.match(pattern);
  return match ? match[1].trim() : '';
}

function splitEntries(sectionText = '') {
  return sectionText
    .split(/\n|•|\u2022|\||;/g)
    .map(item => item.replace(/^[-*]\s*/, '').trim())
    .filter(item => item.length > 2)
    .slice(0, 18);
}

function parseCvTextLocally(cvText = '') {
  const text = String(cvText || '').replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  const lines = text.split(/\n| {3,}/).map(line => line.trim()).filter(Boolean);
  const firstUsefulLine = lines.find(line => !/@/.test(line) && !/^(curriculum|resume|cv|profile|summary|contact)$/i.test(line) && /[A-Za-z]/.test(line)) || '';
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = text.match(/(?:\+?\d[\d\s().-]{8,}\d)/);
  const githubMatch = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9_.-]+/i);
  const linkedinMatch = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_.%-]+\/?/i);
  const urlMatches = uniq(text.match(/(?:https?:\/\/)?(?:www\.)?(?:github\.com|linkedin\.com|behance\.net|youtube\.com|youtu\.be|instagram\.com|portfolio\.|[a-zA-Z0-9-]+\.(?:com|dev|io|app|net|org))\/[\w./?%&=-]+/gi) || []);

  const skillsSection = extractSection(text, ['Skills', 'Technical Skills', 'Core Skills', 'Technologies']);
  const skills = uniq((skillsSection || '')
    .split(/,|\n|•|\u2022|\||;/g)
    .map(s => s.replace(/^[-*]\s*/, '').trim())
    .filter(s => s.length > 1 && s.length < 45));

  const projectsSection = extractSection(text, ['Projects', 'Project Experience', 'Academic Projects']);
  const projectEntries = splitEntries(projectsSection).slice(0, 6);
  const projects = projectEntries.length
    ? projectEntries.map((entry, index) => {
        const title = entry.split(/[-:–—]/)[0].trim().slice(0, 80) || `Project ${index + 1}`;
        const link = urlMatches.find(url => entry.toLowerCase().includes(url.toLowerCase())) || null;
        return { title, desc: entry, link };
      })
    : [];

  const educationEntries = splitEntries(extractSection(text, ['Education', 'Academic Background']));
  const experienceEntries = splitEntries(extractSection(text, ['Experience', 'Work Experience', 'Internships']));
  const certificationEntries = splitEntries(extractSection(text, ['Certifications', 'Certificates', 'Courses']));
  const awardsEntries = splitEntries(extractSection(text, ['Awards', 'Achievements']));
  const customSections = [];
  const addSection = (name, entries) => {
    if (!entries.length) return;
    customSections.push({
      name,
      items: entries.slice(0, 8).map(entry => {
        const [heading, ...rest] = entry.split(/[-:–—]/);
        return { heading: (heading || entry).trim().slice(0, 90), desc: (rest.join(' - ').trim() || entry).slice(0, 240) };
      })
    });
  };
  addSection('Education', educationEntries);
  addSection('Experience', experienceEntries);
  addSection('Certifications', certificationEntries);
  addSection('Awards', awardsEntries);

  const name = firstUsefulLine || (emailMatch ? emailMatch[0].split('@')[0].replace(/[._-]+/g, ' ') : 'Your Name');
  const medium = skills.length ? 'Student / Job Seeker' : 'Portfolio Creator';
  const descriptionParts = [];
  if (skills.length) descriptionParts.push(`I work with ${skills.slice(0, 8).join(', ')}.`);
  if (projects.length) descriptionParts.push(`My portfolio includes ${projects.length} project${projects.length > 1 ? 's' : ''} extracted from my CV.`);
  if (!descriptionParts.length) descriptionParts.push('This portfolio was auto-filled from the uploaded CV. Please review and edit the details before generating the final portfolio.');

  return {
    name,
    medium,
    description: descriptionParts.join(' '),
    projects,
    skills,
    contact: {
      email: emailMatch ? emailMatch[0] : null,
      phone: phoneMatch ? phoneMatch[0].trim() : null,
      whatsapp: phoneMatch ? phoneMatch[0].trim() : null,
      github: githubMatch ? (githubMatch[0].startsWith('http') ? githubMatch[0] : `https://${githubMatch[0]}`) : null,
      linkedin: linkedinMatch ? (linkedinMatch[0].startsWith('http') ? linkedinMatch[0] : `https://${linkedinMatch[0]}`) : null,
      address: null,
    },
    customSections,
    parser: 'local-fallback'
  };
}

async function sendToParserAndRespond(cvText, res) {
  if (!aiAvailable()) {
    return res.json(parseCvTextLocally(cvText));
  }

  let parsed;
  try {
    const aiText = await generateAiText({
      temperature: 0,
      maxTokens: 2200,
      messages: [
        { role: 'system', content: 'You extract portfolio data from CVs and return ONLY valid JSON. Be very careful extracting URLs exactly as they appear. Never add facts that are not present in the CV text.' },
        { role: 'user', content: `Extract portfolio data from this CV text. Return ONLY valid JSON with no extra text:

{
  "name": "full name",
  "medium": "creative field or profession",
  "description": "3-4 sentences about their work, skills, and background",
  "projects": [
    {
      "title": "project name",
      "desc": "description",
      "link": "https://github.com/username/repo or null"
    }
  ],
  "skills": ["skill1", "skill2"],
  "contact": {
    "email": "email@example.com or null",
    "phone": "+92... or null",
    "github": "https://github.com/username or null",
    "linkedin": "https://linkedin.com/in/username or null",
    "address": "City, Country or null"
  },
  "customSections": [
    {
      "name": "Section Name (e.g. Education, Certifications, Experience, Awards)",
      "items": [
        {
          "heading": "Main title of the entry (e.g. degree name, certification name, job title)",
          "desc": "Supporting detail (e.g. institution, issuer, date range, location)"
        }
      ]
    }
  ]
}

IMPORTANT RULES:
- For projects: extract any GitHub repo link mentioned near/with that project. If no project-specific link, use null.
- For customSections: detect ALL sections in the CV beyond basic info (Education, Experience, Certifications, Awards, Volunteering, Publications, Languages, Interests, etc.)
- Each section must have its actual entries as items with heading + desc
- Do NOT include Projects, Skills, or Contact as customSections — those are separate fields
- For contact.github: extract the profile-level GitHub URL (not repo links)
- For skills: extract EVERY skill listed in the CV. Copy the EXACT names as written (e.g. "Node.js" not "NodeJS", "C++" not "CPP"). Do NOT skip any skill. Do NOT rename or merge skills.
- Return null (not empty string) if not found

CV Text:
${cvText || '[No readable text extracted from this PDF]'}

RETURN ONLY VALID JSON:` }
      ],
    });
    parsed = parseJsonObject(aiText || '');
  } catch (error) {
    console.warn('AI CV parsing failed; using local fallback:', error.message);
    return res.json(parseCvTextLocally(cvText));
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.warn('AI CV JSON parsing failed; using local fallback.');
    return res.json(parseCvTextLocally(cvText));
  }

  if (parsed.name) {
    parsed.name = parsed.name
      .replace(/\b([A-Z][a-z]?)\s+([a-z]+)\b/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (parsed.projects && Array.isArray(parsed.projects)) {
    parsed.projects = parsed.projects.map(p => ({
      ...p,
      link: (p.link && p.link !== 'null' && p.link.trim() !== '') ? p.link : null
    }));
  }

  const processedText = preprocessText(cvText);
  const aiContact = parsed.contact || {};

  if (!aiContact.github || aiContact.github === 'null') {
    const gMatch = processedText.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)(?:\/)?(?!\S)/i);
    aiContact.github = gMatch ? `https://github.com/${gMatch[1].replace(/\/$/, '')}` : null;
  } else if (!aiContact.github.startsWith('http')) {
    const gMatch = aiContact.github.match(/github\.com\/([a-zA-Z0-9_.-]+)/i);
    aiContact.github = gMatch ? `https://github.com/${gMatch[1]}` : `https://${aiContact.github}`;
  }

  if (!aiContact.linkedin || aiContact.linkedin === 'null') {
    const lMatch = processedText.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_.-]+)\/?/i);
    aiContact.linkedin = lMatch ? `https://www.linkedin.com/in/${lMatch[1].replace(/\/$/, '')}` : null;
  } else if (!aiContact.linkedin.startsWith('http')) {
    const lMatch = aiContact.linkedin.match(/linkedin\.com\/in\/([a-zA-Z0-9_.-]+)/i);
    aiContact.linkedin = lMatch ? `https://www.linkedin.com/in/${lMatch[1]}` : `https://${aiContact.linkedin}`;
  }

  if (!aiContact.email || aiContact.email === 'null') {
    const eMatch = cvText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    aiContact.email = eMatch ? eMatch[0] : null;
  }

  if (!aiContact.phone || aiContact.phone === 'null') {
    const pMatch = cvText.match(/\+[\d\s\(\)-]{9,}/);
    aiContact.phone = pMatch ? pMatch[0].trim() : null;
  }

  aiContact.whatsapp = aiContact.phone;

  Object.keys(aiContact).forEach(k => {
    if (aiContact[k] === 'null' || aiContact[k] === '') aiContact[k] = null;
  });

  parsed.contact = aiContact;

  if (!parsed.customSections || !Array.isArray(parsed.customSections)) {
    parsed.customSections = [];
  }

  parsed.customSections = parsed.customSections
    .filter(s => s.name && s.items && s.items.length > 0)
    .map(s => ({
      ...s,
      items: s.items.map(it => ({
        heading: (it.heading && it.heading !== 'null') ? it.heading : '',
        desc: (it.desc && it.desc !== 'null') ? it.desc : ''
      })).filter(it => it.heading || it.desc)
    }));

  console.log('=== PARSED RESULT ===');
  console.log(JSON.stringify(parsed, null, 2));
  return res.json(parsed);
}

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
if (require.main === module) {
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


  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = {
  app,
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  normalizeEmail,
};