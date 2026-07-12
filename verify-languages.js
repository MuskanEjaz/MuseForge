'use strict';
/**
 * verify-languages.js — measure, don't guess.
 *
 *     node verify-languages.js
 *
 * Asks YOUR IBM Granite model to write a portfolio bio in each of the 17 output languages,
 * from the same English source, and scores the reply with the SAME validators the server uses:
 *
 *   in-language   the reply is actually in that language / script (not English, not wrong script)
 *   no invented   the reply did not smuggle in a number the source never contained
 *   substantial   the reply is a real paragraph, not one weak line
 *
 * A language that fails here is a language you should drop from LANGUAGE_OPTIONS — with evidence,
 * instead of a feeling. A language that passes is one you can demo with confidence.
 */
require('dotenv').config();

const { __test } = require('./server.js');
const { hasUnexpectedScriptForLanguage, requiresNonLatinScript, hasRequiredScript,
        looksLikeWrongEnglishForTarget } = __test;

const WATSONX_API_KEY = String(process.env.WATSONX_API_KEY || process.env.IBM_CLOUD_API_KEY || '').trim();
const WATSONX_PROJECT_ID = String(process.env.WATSONX_PROJECT_ID || '').trim();
const WATSONX_URL = String(process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com').trim();
const WATSONX_MODEL = String(process.env.WATSONX_MODEL || 'ibm/granite-3-3-8b-instruct').trim();
const WATSONX_API_VERSION = String(process.env.WATSONX_API_VERSION || '2024-05-31').trim();

const LANGS = ['English','Spanish','French','German','Italian','Portuguese','Dutch','Polish',
               'Turkish','Chinese','Japanese','Korean','Russian','Indonesian','Vietnamese',
               'Arabic','Urdu'];

// One fixed source, in English, containing exactly one number: 12.
const SOURCE = 'I am an illustrator. I drew 12 character sketches for an indie game jam.';

let cachedToken = { token: '', expiresAt: 0 };
async function iamToken() {
  if (cachedToken.token && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const response = await fetch('https://iam.cloud.ibm.com/identity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
      apikey: WATSONX_API_KEY,
    }).toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(data.errorMessage || `IAM failed ${response.status}`);
  cachedToken = { token: data.access_token, expiresAt: Date.now() + ((data.expires_in || 3600) * 1000) - 60000 };
  return cachedToken.token;
}

async function askGranite(token, language) {
  const response = await fetch(`${WATSONX_URL.replace(/\/+$/, '')}/ml/v1/text/chat?version=${WATSONX_API_VERSION}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model_id: WATSONX_MODEL,
      project_id: WATSONX_PROJECT_ID,
      max_tokens: 220,
      temperature: 0.2,
      messages: [
        { role: 'system', content: `Write ONLY in ${language}. Do not use any other language. Write a two-sentence first-person portfolio bio based strictly on the facts given. Never invent numbers, awards, clients or achievements. Return only the bio.` },
        { role: 'user', content: SOURCE },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.errors?.[0]?.message || data?.message || `chat failed ${response.status}`);
  return String(data?.choices?.[0]?.message?.content || data?.results?.[0]?.generated_text || '').trim();
}

const numbersIn = (text) => (String(text).match(/\d+/g) || []);

(async () => {
  if (!WATSONX_API_KEY || !WATSONX_PROJECT_ID) {
    console.log('\nSet WATSONX_API_KEY and WATSONX_PROJECT_ID in .env first, then run this again.\n');
    process.exit(1);
  }

  console.log(`\n=== Granite language check — ${WATSONX_MODEL} @ ${WATSONX_URL} ===\n`);
  console.log('  language      in-language   no invented facts   substantial   verdict');
  console.log('  ' + '-'.repeat(72));

  const token = await iamToken();
  const weak = [];

  for (const lang of LANGS) {
    let reply = '';
    let error = '';
    try {
      reply = await askGranite(token, lang);
    } catch (e) {
      error = e.message;
    }

    if (error) {
      console.log(`  ${lang.padEnd(12)}  ERROR: ${error.slice(0, 45)}`);
      weak.push(lang);
      continue;
    }

    const wrongScript = hasUnexpectedScriptForLanguage(reply, lang);
    const missingScript = requiresNonLatinScript(lang) && !hasRequiredScript(reply, lang);
    const wrongEnglish = looksLikeWrongEnglishForTarget(reply, lang);
    const inLanguage = !wrongScript && !missingScript && !wrongEnglish;

    const invented = numbersIn(reply).some(n => !SOURCE.includes(n));
    const compact = ['Chinese', 'Japanese', 'Korean'].includes(lang);
    const substantial = reply.length >= (compact ? 30 : 90);

    const pass = inLanguage && !invented && substantial;
    if (!pass) weak.push(lang);

    const tick = (b) => (b ? '  yes  ' : '  NO   ');
    console.log(`  ${lang.padEnd(12)}  ${tick(inLanguage)}       ${tick(!invented)}          ${tick(substantial)}     ${pass ? 'OK' : 'WEAK'}`);
    if (!pass) console.log(`                "${reply.replace(/\s+/g, ' ').slice(0, 62)}"`);
  }

  console.log('  ' + '-'.repeat(72));
  if (!weak.length) {
    console.log('\n  All 17 languages passed. Ship the list as it is.\n');
  } else {
    console.log(`\n  WEAK: ${weak.join(', ')}`);
    console.log('  Granite does not handle these well from your account. Two options:');
    console.log('    1. Remove them from LANGUAGE_OPTIONS in App.js and ACTIVE_OUTPUT_LANGUAGES in server.js.');
    console.log('    2. Keep them: the deterministic dictionaries still give correct headings and labels,');
    console.log('       and FactLock still blocks fabrication — but the prose will be generic, not rich.');
    console.log('  Do not demo a weak language.\n');
  }
})();
