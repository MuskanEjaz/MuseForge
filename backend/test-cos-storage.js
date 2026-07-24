'use strict';
/**
 * Network-free tests for cos-storage.js using a mock ibm-cos-sdk.
 * Proves: config detection (iam/hmac/none), correct SDK config per auth mode, and a real
 * put -> get -> delete round-trip through the wrapper.
 *
 *   node test-cos-storage.js
 */
const assert = require('assert');
const cos = require('./cos-storage');

let passed = 0;
const ok = (l) => { console.log('  PASS  ' + l); passed += 1; };

// ---- mock ibm-cos-sdk: an in-memory S3 ----
function makeMockIbm(store, captured) {
  return {
    Credentials: function (accessKeyId, secretAccessKey) {
      this.accessKeyId = accessKeyId; this.secretAccessKey = secretAccessKey;
    },
    S3: function (config) {
      captured.config = config;
      this.putObject = ({ Bucket, Key, Body, ContentType }) => ({
        promise: async () => { store.set(Bucket + '/' + Key, { Body, ContentType }); return { ETag: '"x"' }; },
      });
      this.getObject = ({ Bucket, Key }) => ({
        promise: async () => {
          const v = store.get(Bucket + '/' + Key);
          if (v === undefined) { const err = new Error('NoSuchKey'); err.code = 'NoSuchKey'; throw err; }
          return { Body: Buffer.from(v.Body) };
        },
      });
      this.deleteObject = ({ Bucket, Key }) => ({
        promise: async () => { store.delete(Bucket + '/' + Key); return {}; },
      });
      this.listBuckets = () => ({ promise: async () => ({ Buckets: [{ Name: 'museforge-bucket' }] }) });
    },
  };
}

// ---- 1. config detection ----
(() => {
  assert.strictEqual(cos.cosAuthMode(cos.cosEnv({ COS_API_KEY: 'k', COS_RESOURCE_INSTANCE_ID: 'i' })), 'iam', 'iam mode');
  assert.strictEqual(cos.cosAuthMode(cos.cosEnv({ COS_HMAC_ACCESS_KEY_ID: 'a', COS_HMAC_SECRET_ACCESS_KEY: 's' })), 'hmac', 'hmac mode');
  assert.strictEqual(cos.cosAuthMode(cos.cosEnv({})), 'none', 'none mode');
  ok('auth mode detection: iam / hmac / none');

  assert.strictEqual(cos.cosConfigured({ COS_ENDPOINT: 'e', COS_BUCKET: 'b', COS_API_KEY: 'k', COS_RESOURCE_INSTANCE_ID: 'i' }), true, 'iam configured');
  assert.strictEqual(cos.cosConfigured({ COS_ENDPOINT: 'e', COS_BUCKET: 'b' }), false, 'no auth -> not configured');
  assert.strictEqual(cos.cosConfigured({ COS_API_KEY: 'k', COS_RESOURCE_INSTANCE_ID: 'i' }), false, 'no endpoint/bucket -> not configured');
  ok('cosConfigured requires endpoint + bucket + auth');
})();

// ---- 2. buildCosConfig picks the right shape ----
(() => {
  const ibm = makeMockIbm(new Map(), {});
  const iam = cos.buildCosConfig(cos.cosEnv({ COS_ENDPOINT: 'https://e', COS_API_KEY: 'K', COS_RESOURCE_INSTANCE_ID: 'I' }), ibm);
  assert.strictEqual(iam.apiKeyId, 'K', 'iam config apiKeyId');
  assert.strictEqual(iam.serviceInstanceId, 'I', 'iam config instance');
  assert.ok(!('credentials' in iam), 'iam config has no credentials object');
  ok('buildCosConfig IAM shape correct');

  const hmac = cos.buildCosConfig(cos.cosEnv({ COS_ENDPOINT: 'https://e', COS_HMAC_ACCESS_KEY_ID: 'A', COS_HMAC_SECRET_ACCESS_KEY: 'S' }), ibm);
  assert.strictEqual(hmac.signatureVersion, 'v4', 'hmac signatureVersion v4');
  assert.strictEqual(hmac.credentials.accessKeyId, 'A', 'hmac creds access key');
  assert.strictEqual(hmac.credentials.secretAccessKey, 'S', 'hmac creds secret');
  ok('buildCosConfig HMAC shape correct');

  assert.throws(() => cos.buildCosConfig(cos.cosEnv({ COS_ENDPOINT: 'https://e' }), ibm), /not configured/i, 'throws when no auth');
  ok('buildCosConfig throws with a helpful message when unauthenticated');
})();

// ---- 3. put -> get -> delete round-trip through the wrapper ----
(async () => {
  const store = new Map();
  const captured = {};
  const ibm = makeMockIbm(store, captured);
  const env = { COS_ENDPOINT: 'https://e', COS_BUCKET: 'museforge-bucket', COS_API_KEY: 'K', COS_RESOURCE_INSTANCE_ID: 'I' };
  const client = cos.makeCosClient(env, ibm);
  assert.strictEqual(client.bucket, 'museforge-bucket', 'client bucket');
  assert.strictEqual(client.authMode, 'iam', 'client authMode iam');

  const buckets = await cos.listBuckets(client);
  assert.deepStrictEqual(buckets, ['museforge-bucket'], 'listBuckets returns names');
  ok('listBuckets round-trip');

  const value = { users: [{ id: 1, name: 'Ayesha' }], at: 'now' };
  await cos.putJson(client, 'data/users.json', value);
  assert.ok(store.has('museforge-bucket/data/users.json'), 'object stored under bucket/key');
  const stored = store.get('museforge-bucket/data/users.json');
  assert.strictEqual(stored.ContentType, 'application/json', 'ContentType set to application/json');
  ok('putJson writes JSON under bucket/key with correct content type');

  const back = await cos.getJson(client, 'data/users.json');
  assert.deepStrictEqual(back, value, 'getJson returns the exact object written');
  ok('getJson round-trips the exact object');

  await cos.deleteObject(client, 'data/users.json');
  assert.strictEqual(store.has('museforge-bucket/data/users.json'), false, 'deleteObject removes it');
  ok('deleteObject removes the object');

  // getJson on a missing key surfaces the SDK error (caller decides fallback)
  let threw = false;
  try { await cos.getJson(client, 'data/users.json'); } catch (err) { threw = err.code === 'NoSuchKey'; }
  assert.ok(threw, 'missing key throws NoSuchKey (so the data layer can fall back to local)');
  ok('missing key throws NoSuchKey (enables local fallback in Step 2)');

  console.log('\n  ALL ' + passed + ' CHECKS PASSED');
})().catch((e) => { console.error('  FAIL ', e.message); process.exit(1); });
