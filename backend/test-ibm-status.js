'use strict';
/**
 * Network-free tests for ibm-status.js.
 * Proves: correct booleans, correct field set (exactly 6), no secret leakage,
 * and that doclingReachable degrades to false without throwing.
 *
 *   node test-ibm-status.js
 */
const assert = require('assert');
const mod = require('./ibm-status');

let passed = 0;
const ok = (label) => { console.log('  PASS  ' + label); passed += 1; };

// ---- 1. buildIbmStatusBase: pure boolean derivation ----
(() => {
  const a = mod.buildIbmStatusBase({
    watsonxConfigured: true, watsonxModel: 'ibm/granite-3-8b-instruct',
    watsonxStrict: 'true', doclingUrl: 'http://127.0.0.1:5001',
  });
  assert.strictEqual(a.watsonxConfigured, true, 'watsonxConfigured true');
  assert.strictEqual(a.graniteModel, 'ibm/granite-3-8b-instruct', 'graniteModel echoed');
  assert.strictEqual(a.doclingConfigured, true, 'doclingConfigured true when URL set');
  assert.strictEqual(a.strictIbmMode, true, 'strictIbmMode true for "true"');
  ok('buildIbmStatusBase — all-configured case');

  const b = mod.buildIbmStatusBase({
    watsonxConfigured: false, watsonxModel: '', watsonxStrict: 'false', doclingUrl: '',
  });
  assert.strictEqual(b.watsonxConfigured, false, 'watsonxConfigured false');
  assert.strictEqual(b.doclingConfigured, false, 'doclingConfigured false when URL empty');
  assert.strictEqual(b.strictIbmMode, false, 'strictIbmMode false for "false"');
  ok('buildIbmStatusBase — nothing-configured case');

  // strict must be case/whitespace tolerant but ONLY true for "true"
  assert.strictEqual(mod.buildIbmStatusBase({ watsonxStrict: '  TRUE ' }).strictIbmMode, true, 'strict TRUE/space');
  assert.strictEqual(mod.buildIbmStatusBase({ watsonxStrict: '1' }).strictIbmMode, false, 'strict "1" is NOT true');
  assert.strictEqual(mod.buildIbmStatusBase({ watsonxStrict: 'yes' }).strictIbmMode, false, 'strict "yes" is NOT true');
  ok('strictIbmMode is exactly "true", tolerant of case/space');

  assert.strictEqual(typeof mod.isLangchainInstalled(), 'boolean', 'isLangchainInstalled returns boolean');
  ok('isLangchainInstalled returns a boolean (installed=' + mod.isLangchainInstalled() + ' in this sandbox)');
})();

// ---- 2. checkDoclingReachable: mocked fetch, never throws ----
(async () => {
  const realFetch = global.fetch;
  const withFetch = async (impl, url, timeout) => {
    global.fetch = impl;
    try { return await mod.checkDoclingReachable(url, timeout); }
    finally { global.fetch = realFetch; }
  };

  assert.strictEqual(await withFetch(async () => ({ ok: true }), 'http://x:5001'), true, 'health ok -> true');
  ok('doclingReachable true when /health responds ok');

  // /health throws, base URL ok -> true (fallback path)
  let call = 0;
  const r2 = await withFetch(async () => { call += 1; if (call === 1) throw new Error('no /health'); return { ok: true }; }, 'http://x:5001');
  assert.strictEqual(r2, true, 'fallback to base ok -> true');
  ok('doclingReachable falls back from /health to base URL');

  assert.strictEqual(await withFetch(async () => { throw new Error('down'); }, 'http://x:5001'), false, 'all throw -> false');
  ok('doclingReachable false (never throws) when server is down');

  assert.strictEqual(await withFetch(async () => ({ ok: true }), ''), false, 'empty url -> false');
  ok('doclingReachable false when DOCLING_URL is empty');

  assert.strictEqual(await withFetch(async () => ({ ok: false, status: 500 }), 'http://x:5001'), false, '500 -> false');
  ok('doclingReachable false on non-ok response');
})().then(() => runRouteTest());

// ---- 3. registerIbmStatus: exact field set + NO secret leakage ----
function runRouteTest() {
  const SECRET_KEY = 'sk-SUPER-SECRET-ibm-apikey-should-never-appear';
  const SECRET_PROJECT = 'proj-uuid-secret-should-never-appear';

  // Fake express app that captures the GET handler.
  let handler = null;
  const app = { get: (path, h) => { if (path === '/ibm-status') handler = h; } };

  mod.registerIbmStatus(app, {
    watsonxConfigured: true,
    watsonxModel: 'ibm/granite-3-8b-instruct',
    watsonxStrict: 'true',
    doclingUrl: 'http://127.0.0.1:5001',
    doclingProbeTimeoutMs: 200,
    // deliberately smuggle secrets into cfg to prove they never surface
    _apiKey: SECRET_KEY,
    _projectId: SECRET_PROJECT,
  });
  assert(handler, 'handler registered on /ibm-status');

  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('offline in sandbox'); }; // doclingReachable -> false

  let body = null;
  const res = { status: () => res, json: (b) => { body = b; } };
  const req = {};

  handler(req, res).then(() => {
    global.fetch = realFetch;

    const keys = Object.keys(body).sort();
    const expected = ['doclingConfigured', 'doclingReachable', 'graniteModel', 'langchainInstalled', 'strictIbmMode', 'watsonxConfigured'].sort();
    assert.deepStrictEqual(keys, expected, 'response has EXACTLY the six allowed fields');
    ok('response shape is exactly the six brief-specified fields');

    // every value is boolean except graniteModel (public string)
    for (const [k, v] of Object.entries(body)) {
      if (k === 'graniteModel') assert.strictEqual(typeof v, 'string', 'graniteModel string');
      else assert.strictEqual(typeof v, 'boolean', k + ' is boolean');
    }
    assert.strictEqual(body.doclingReachable, false, 'doclingReachable false when offline');
    assert.strictEqual(body.watsonxConfigured, true, 'watsonxConfigured surfaced');
    ok('all fields correctly typed; offline docling -> reachable:false');

    const serialized = JSON.stringify(body);
    assert(!serialized.includes(SECRET_KEY), 'API key MUST NOT appear in response');
    assert(!serialized.includes(SECRET_PROJECT), 'project id MUST NOT appear in response');
    assert(!/apikey|api_key|token|secret|password/i.test(serialized), 'no secret-like keys in response');
    ok('NO secret leakage — key/project/token absent from response');

    console.log('\n  ALL ' + passed + ' CHECKS PASSED');
  }).catch((e) => { console.error('  FAIL ', e.message); process.exit(1); });
}
