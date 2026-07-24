#!/usr/bin/env node
'use strict';
/**
 * MuseForge — verify IBM Cloud Object Storage works, end to end.
 *
 *   node verify-cos.js
 *
 * Proves, against your real COS instance:
 *   1. credentials authenticate (listBuckets)
 *   2. the target bucket is reachable
 *   3. a JSON object round-trips: put -> get -> content matches -> delete
 *
 * Prints ONLY booleans, the bucket/endpoint host, and which env vars are SET (not their values).
 * It never prints your API key, HMAC secret, or instance id.
 *
 * Run from inside backend/ after: npm install ibm-cos-sdk  and setting the COS_* env vars.
 */

try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }

const cosLib = require('./cos-storage');

function setLabel(v) { return v ? 'set' : 'MISSING'; }

(async () => {
  const e = cosLib.cosEnv(process.env);
  const mode = cosLib.cosAuthMode(e);

  console.log('=== COS configuration (no secrets) ===');
  console.log('  COS_ENDPOINT              : ' + (e.endpoint ? e.endpoint : 'MISSING'));
  console.log('  COS_BUCKET                : ' + (e.bucket ? e.bucket : 'MISSING'));
  console.log('  auth mode                 : ' + mode);
  console.log('  COS_API_KEY               : ' + setLabel(e.apiKeyId) + '   (IAM)');
  console.log('  COS_RESOURCE_INSTANCE_ID  : ' + setLabel(e.serviceInstanceId) + '   (IAM)');
  console.log('  COS_HMAC_ACCESS_KEY_ID    : ' + setLabel(e.hmacAccessKeyId) + '   (HMAC alt)');
  console.log('  COS_HMAC_SECRET_ACCESS_KEY: ' + setLabel(e.hmacSecretAccessKey) + '   (HMAC alt)');

  if (!cosLib.cosConfigured(process.env)) {
    console.error('\nFAIL: COS is not fully configured.');
    console.error('Need COS_ENDPOINT + COS_BUCKET + either (COS_API_KEY + COS_RESOURCE_INSTANCE_ID)');
    console.error('or (COS_HMAC_ACCESS_KEY_ID + COS_HMAC_SECRET_ACCESS_KEY).');
    console.error('Find these in IBM Cloud -> your COS instance -> Service credentials / Buckets -> Configuration -> Endpoints.');
    process.exit(1);
  }

  let client;
  try {
    client = cosLib.makeCosClient(process.env);
  } catch (err) {
    console.error('\nFAIL building COS client: ' + err.message);
    process.exit(1);
  }

  const testKey = `museforge/_healthcheck/verify-${Date.now()}.json`;
  const payload = { ok: true, at: new Date().toISOString(), marker: 'museforge-cos-verify' };

  // 1. auth
  try {
    const t = Date.now();
    const buckets = await cosLib.listBuckets(client);
    console.log('\n[1/4] listBuckets OK in ' + (Date.now() - t) + 'ms — ' + buckets.length + ' bucket(s) visible.');
    console.log('      target bucket present: ' + (buckets.includes(e.bucket) ? 'yes' : 'NOT in list (check name/region)'));
  } catch (err) {
    console.error('\n[1/4] listBuckets FAILED: ' + err.message);
    console.error('      -> usually wrong endpoint, wrong credentials, or wrong auth mode.');
    process.exit(1);
  }

  // 2 + 3. put -> get -> verify
  try {
    let t = Date.now();
    await cosLib.putJson(client, testKey, payload);
    console.log('[2/4] putObject OK in ' + (Date.now() - t) + 'ms — wrote ' + testKey);

    t = Date.now();
    const back = await cosLib.getJson(client, testKey);
    const matches = back && back.marker === payload.marker && back.at === payload.at;
    console.log('[3/4] getObject OK in ' + (Date.now() - t) + 'ms — round-trip content matches: ' + Boolean(matches));
    if (!matches) throw new Error('round-trip mismatch: got ' + JSON.stringify(back));
  } catch (err) {
    console.error('[2-3/4] put/get FAILED: ' + err.message);
    console.error('      -> bucket may not exist, or the credential lacks Writer/Manager role on it.');
    process.exit(1);
  }

  // 4. cleanup
  try {
    const t = Date.now();
    await cosLib.deleteObject(client, testKey);
    console.log('[4/4] deleteObject OK in ' + (Date.now() - t) + 'ms — cleaned up test object.');
  } catch (err) {
    console.error('[4/4] deleteObject FAILED (object may linger): ' + err.message);
    // not fatal to the verification of read/write
  }

  console.log('\n=== VERDICT: IBM COS is WORKING (auth + bucket + read/write round-trip). ===');
  console.log('Next step (2): wire the data layer (users / public portfolios / history) to COS with a local fallback.');
})();
