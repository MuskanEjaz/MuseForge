'use strict';
/**
 * MuseForge — IBM Cloud Object Storage wrapper (S3-compatible via ibm-cos-sdk).
 *
 * WHY this exists (the honest, real use case — not decoration):
 * The app persists users, public portfolios, reviews, and history to local JSON files in data/.
 * Local files are WIPED on every restart/redeploy on IBM Cloud (ephemeral filesystem), so those
 * would vanish the moment the app is deployed. COS gives durable storage that survives restarts —
 * which is exactly what makes deployment (Feasibility / Real-World Impact) possible.
 *
 * This module is standalone and does NOT rewire the app yet. Step 1 proves COS works in isolation
 * (see verify-cos.js). Step 2 will swap the data-layer reads/writes to COS with a local fallback.
 *
 * Auth: IAM (apiKeyId + serviceInstanceId) is preferred and matches the app's existing IAM usage.
 * HMAC (access key + secret) is supported as an alternative. Credentials are NEVER logged.
 */

function cosEnv(env = process.env) {
  return {
    endpoint: String(env.COS_ENDPOINT || '').trim(),
    apiKeyId: String(env.COS_API_KEY || env.COS_APIKEYID || '').trim(),
    serviceInstanceId: String(env.COS_RESOURCE_INSTANCE_ID || env.COS_INSTANCE_ID || '').trim(),
    hmacAccessKeyId: String(env.COS_HMAC_ACCESS_KEY_ID || '').trim(),
    hmacSecretAccessKey: String(env.COS_HMAC_SECRET_ACCESS_KEY || '').trim(),
    ibmAuthEndpoint: String(env.COS_IBM_AUTH_ENDPOINT || 'https://iam.cloud.ibm.com/identity/token').trim(),
    bucket: String(env.COS_BUCKET || '').trim(),
  };
}

// Which auth style is available from the environment?
function cosAuthMode(e) {
  if (e.apiKeyId && e.serviceInstanceId) return 'iam';
  if (e.hmacAccessKeyId && e.hmacSecretAccessKey) return 'hmac';
  return 'none';
}

// Fully configured = endpoint + bucket + a usable auth style.
function cosConfigured(env = process.env) {
  const e = cosEnv(env);
  return Boolean(e.endpoint && e.bucket && cosAuthMode(e) !== 'none');
}

// Build the ibm-cos-sdk S3 config for whichever auth style is present.
function buildCosConfig(e, ibm) {
  const mode = cosAuthMode(e);
  if (mode === 'iam') {
    return {
      endpoint: e.endpoint,
      apiKeyId: e.apiKeyId,
      serviceInstanceId: e.serviceInstanceId,
      ibmAuthEndpoint: e.ibmAuthEndpoint,
    };
  }
  if (mode === 'hmac') {
    return {
      endpoint: e.endpoint,
      credentials: new ibm.Credentials(e.hmacAccessKeyId, e.hmacSecretAccessKey),
      signatureVersion: 'v4',
    };
  }
  throw new Error(
    'COS not configured. Set COS_ENDPOINT, COS_BUCKET, and either ' +
    '(COS_API_KEY + COS_RESOURCE_INSTANCE_ID) for IAM, or ' +
    '(COS_HMAC_ACCESS_KEY_ID + COS_HMAC_SECRET_ACCESS_KEY) for HMAC.'
  );
}

// ibmLib is injectable so tests can pass a mock instead of the real SDK.
function makeCosClient(env = process.env, ibmLib) {
  const ibm = ibmLib || require('ibm-cos-sdk');
  const e = cosEnv(env);
  const cos = new ibm.S3(buildCosConfig(e, ibm));
  return { cos, bucket: e.bucket, endpoint: e.endpoint, authMode: cosAuthMode(e) };
}

async function putJson(client, key, value) {
  await client.cos.putObject({
    Bucket: client.bucket,
    Key: key,
    Body: JSON.stringify(value),
    ContentType: 'application/json',
  }).promise();
  return true;
}

async function getJson(client, key) {
  const res = await client.cos.getObject({ Bucket: client.bucket, Key: key }).promise();
  const body = res && res.Body ? res.Body.toString('utf8') : '';
  return body ? JSON.parse(body) : null;
}

async function deleteObject(client, key) {
  await client.cos.deleteObject({ Bucket: client.bucket, Key: key }).promise();
  return true;
}

async function listBuckets(client) {
  const res = await client.cos.listBuckets().promise();
  return ((res && res.Buckets) || []).map(b => b.Name);
}

module.exports = {
  cosEnv, cosAuthMode, cosConfigured, buildCosConfig,
  makeCosClient, putJson, getJson, deleteObject, listBuckets,
};
