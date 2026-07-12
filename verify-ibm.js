'use strict';
/**
 * verify-ibm.js — run this with YOUR keys before the demo.
 *
 *     node verify-ibm.js
 *
 * It answers the three questions that cannot be answered without network access:
 *   1. Does your IBM Cloud API key mint an IAM token?
 *   2. Does WATSONX_MODEL actually exist in YOUR region, and does Granite answer?
 *   3. Is docling-serve reachable, and does it return markdown for a real PDF?
 *
 * Optional: point it at a real CV to test Docling end to end.
 *     node verify-ibm.js ./my-cv.pdf
 */
require('dotenv').config();
const fs = require('fs');

const WATSONX_API_KEY = String(process.env.WATSONX_API_KEY || process.env.IBM_CLOUD_API_KEY || '').trim();
const WATSONX_PROJECT_ID = String(process.env.WATSONX_PROJECT_ID || '').trim();
const WATSONX_URL = String(process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com').trim();
const WATSONX_MODEL = String(process.env.WATSONX_MODEL || 'ibm/granite-3-3-8b-instruct').trim();
const WATSONX_API_VERSION = String(process.env.WATSONX_API_VERSION || '2024-05-31').trim();
const DOCLING_URL = String(process.env.DOCLING_URL || '').trim();

const ok = (m) => console.log('  \x1b[32mPASS\x1b[0m  ' + m);
const bad = (m) => console.log('  \x1b[31mFAIL\x1b[0m  ' + m);
const info = (m) => console.log('        ' + m);

async function iamToken() {
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
    throw new Error(data.errorMessage || `IAM token request failed with ${response.status}`);
  }
  return data.access_token;
}

async function listGraniteModels(token) {
  const url = `${WATSONX_URL.replace(/\/+$/, '')}/ml/v1/foundation_model_specs?version=${WATSONX_API_VERSION}&limit=200`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Model list failed with ${response.status}`);
  return (data.resources || []).map(m => m.model_id).filter(id => /granite/i.test(id));
}

async function askGranite(token, prompt) {
  const url = `${WATSONX_URL.replace(/\/+$/, '')}/ml/v1/text/chat?version=${WATSONX_API_VERSION}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model_id: WATSONX_MODEL,
      project_id: WATSONX_PROJECT_ID,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 120,
      temperature: 0.2,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.errors?.[0]?.message || data?.message || `chat failed with ${response.status}`);
  }
  return String(data?.choices?.[0]?.message?.content || data?.results?.[0]?.generated_text || '').trim();
}

async function checkDocling(pdfPath) {
  const buffer = pdfPath && fs.existsSync(pdfPath)
    ? fs.readFileSync(pdfPath)
    : Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>', 'latin1');

  const form = new FormData();
  form.append('files', new Blob([buffer], { type: 'application/pdf' }), 'cv.pdf');
  form.append('to_formats', 'md');

  const response = await fetch(`${DOCLING_URL.replace(/\/+$/, '')}/v1alpha/convert/file`, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) throw new Error(`Docling responded with ${response.status}`);
  const data = await response.json().catch(() => ({}));
  const markdown = String(
    data?.document?.md_content || data?.document?.markdown || data?.md_content
    || (Array.isArray(data?.documents) ? (data.documents[0]?.md_content || '') : '') || ''
  ).trim();
  if (!markdown) {
    throw new Error('Reachable, but no markdown found. Response keys: ' + Object.keys(data).join(', '));
  }
  return markdown;
}

(async () => {
  const pdfPath = process.argv[2];
  console.log('\n=== MuseForge: IBM stack verification ===\n');

  // ---- watsonx / Granite ----
  console.log('IBM watsonx.ai (Granite)');
  if (!WATSONX_API_KEY || !WATSONX_PROJECT_ID) {
    bad('WATSONX_API_KEY / WATSONX_PROJECT_ID are not set — Granite will NOT be used.');
    info('Set them in .env, then run this again.');
  } else {
    let token = '';
    try {
      token = await iamToken();
      ok('IBM Cloud IAM token minted from your API key.');
    } catch (error) {
      bad('IAM token failed: ' + error.message);
    }

    if (token) {
      try {
        const granite = await listGraniteModels(token);
        if (granite.length) {
          ok(`Granite models available in ${WATSONX_URL}:`);
          granite.forEach(id => info((id === WATSONX_MODEL ? '-> ' : '   ') + id));
          if (!granite.includes(WATSONX_MODEL)) {
            bad(`Your WATSONX_MODEL "${WATSONX_MODEL}" is NOT in that list. Copy one of the ids above into .env.`);
          }
        } else {
          bad('No Granite models listed for this region/project.');
        }
      } catch (error) {
        bad('Could not list models: ' + error.message);
      }

      try {
        const reply = await askGranite(token, 'Reply with exactly: GRANITE OK');
        ok(`Granite replied: "${reply.slice(0, 60)}"`);
      } catch (error) {
        bad('Granite generation failed: ' + error.message);
        info('If this says the model is not supported, fix WATSONX_MODEL using the list above.');
      }

      // The claim "powered by IBM Granite" must be true end to end.
      try {
        const urdu = await askGranite(token, 'Translate into Urdu, reply with only the Urdu text: "I design posters."');
        const hasUrdu = /[\u0600-\u06FF]/.test(urdu);
        if (hasUrdu) ok('Granite produced non-Latin (Urdu) script — multilingual path is live.');
        else bad('Granite did not return Urdu script. Multilingual output will lean on the local fallback.');
        info(urdu.slice(0, 60));
      } catch (error) {
        bad('Multilingual check failed: ' + error.message);
      }
    }
  }

  // ---- Docling ----
  console.log('\nIBM Docling');
  if (!DOCLING_URL) {
    bad('DOCLING_URL is not set — CV parsing will use the local PDF parsers, not Docling.');
    info('Run: docker run -p 5001:5001 quay.io/docling-project/docling-serve');
  } else {
    try {
      const markdown = await checkDocling(pdfPath);
      ok(`Docling returned ${markdown.length} characters of markdown.`);
      if (pdfPath) info('First line: ' + markdown.split('\n').find(Boolean).slice(0, 70));
      else info('Tip: pass a real CV to test properly:  node verify-ibm.js ./my-cv.pdf');
    } catch (error) {
      bad('Docling check failed: ' + error.message);
      info('server.js falls back to the local PDF parsers, so uploads still work — but you cannot claim Docling.');
    }
  }

  console.log('\nEverything above must say PASS before you record the demo.\n');
})();
