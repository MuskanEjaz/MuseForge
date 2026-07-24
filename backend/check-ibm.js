require('dotenv').config();

const KEY = (process.env.WATSONX_API_KEY || process.env.IBM_CLOUD_API_KEY || '').trim();
const URL = (process.env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com').trim();
const PROJECT = (process.env.WATSONX_PROJECT_ID || '').trim();
const SPACE = (process.env.WATSONX_SPACE_ID || '').trim();
const MODEL = (process.env.WATSONX_MODEL || 'ibm/granite-3-3-8b-instruct').trim();
const VERSION = (process.env.WATSONX_API_VERSION || '2024-05-31').trim();

(async () => {
  console.log('KEY      :', KEY ? 'present (' + KEY.length + ' chars)' : 'MISSING');
  console.log('URL      :', URL);
  console.log('PROJECT  :', PROJECT || '(none)');
  console.log('SPACE    :', SPACE || '(none)');
  console.log('MODEL    :', MODEL);
  if (!KEY) return console.log('\n=> .env mein WATSONX_API_KEY hai hi nahi.');

  const iam = await fetch('https://iam.cloud.ibm.com/identity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'urn:ibm:params:oauth:grant-type:apikey', apikey: KEY }).toString(),
  });
  const iamData = await iam.json().catch(() => ({}));
  if (!iam.ok || !iamData.access_token) {
    console.log('\nSTEP 1 IAM  : FAILED ->', iam.status, iamData.errorMessage || '');
    return console.log('=> API KEY khud kharab hai. Sirf IS soorat mein regenerate karo.');
  }
  console.log('\nSTEP 1 IAM  : OK — API key VALID hai.');

  const res = await fetch(`${URL.replace(/\/+$/, '')}/ml/v1/text/chat?version=${VERSION}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${iamData.access_token}` },
    body: JSON.stringify({
      model_id: MODEL,
      messages: [{ role: 'user', content: 'Say OK' }],
      max_tokens: 5,
      temperature: 0.05,
      ...(PROJECT ? { project_id: PROJECT } : {}),
      ...(SPACE ? { space_id: SPACE } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  const code = data?.errors?.[0]?.code || '';
  const msg = data?.errors?.[0]?.message || data?.message || '';
  console.log('STEP 2 CALL : HTTP', res.status, code ? '| ' + code : '');
  if (res.ok) return console.log('=> WATSONX ZINDA HAI. Reply:', JSON.stringify(data?.choices?.[0]?.message?.content || ''));
  console.log('   message:', msg);
  if (code === 'token_quota_reached') console.log('=> MONTHLY TOKEN QUOTA KHATAM. Key theek hai — plan ka masla hai.');
  if (res.status === 401 || res.status === 403 && code !== 'token_quota_reached') console.log('=> Project/Space ID ya region ghalat ho sakta hai.');
})();