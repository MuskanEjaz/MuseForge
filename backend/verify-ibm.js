'use strict';

/**
 * MuseForge IBM stack verification
 *
 * Basic verification:
 *   node verify-ibm.js
 *
 * Full Granite + real Docling PDF verification:
 *   node verify-ibm.js "C:\full\path\to\Sample_CV.pdf"
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const WATSONX_API_KEY = String(
  process.env.WATSONX_API_KEY ||
  process.env.IBM_CLOUD_API_KEY ||
  ''
).trim();

const WATSONX_PROJECT_ID = String(
  process.env.WATSONX_PROJECT_ID || ''
).trim();

const WATSONX_URL = String(
  process.env.WATSONX_URL ||
  'https://us-south.ml.cloud.ibm.com'
).trim();

const WATSONX_MODEL = String(
  process.env.WATSONX_MODEL ||
  'ibm/granite-3-8b-instruct'
).trim();

const WATSONX_API_VERSION = String(
  process.env.WATSONX_API_VERSION ||
  '2024-05-31'
).trim();

const DOCLING_URL = String(
  process.env.DOCLING_URL ||
  'http://127.0.0.1:5001'
).trim();

let failureCount = 0;

function pass(message) {
  console.log(`  \x1b[32mPASS\x1b[0m  ${message}`);
}

function fail(message) {
  failureCount += 1;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${message}`);
}

function warn(message) {
  console.log(`  \x1b[33mWARN\x1b[0m  ${message}`);
}

function info(message) {
  console.log(`        ${message}`);
}

async function readResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getApiError(data, fallback) {
  if (data?.errors?.[0]?.message) {
    return data.errors[0].message;
  }

  if (Array.isArray(data?.detail) && data.detail[0]?.msg) {
    return data.detail[0].msg;
  }

  if (typeof data?.detail === 'string') {
    return data.detail;
  }

  if (data?.message) {
    return data.message;
  }

  if (data?.raw) {
    return data.raw;
  }

  return fallback;
}

async function createIamToken() {
  const response = await fetch(
    'https://iam.cloud.ibm.com/identity/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
        apikey: WATSONX_API_KEY,
      }).toString(),
    }
  );

  const data = await readResponse(response);

  if (!response.ok || !data.access_token) {
    throw new Error(
      getApiError(
        data,
        `IAM token request failed with HTTP ${response.status}`
      )
    );
  }

  return data.access_token;
}

async function listGraniteModels(token) {
  const baseUrl = WATSONX_URL.replace(/\/+$/, '');

  const url =
    `${baseUrl}/ml/v1/foundation_model_specs` +
    `?version=${encodeURIComponent(WATSONX_API_VERSION)}` +
    `&limit=200`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  const data = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      getApiError(
        data,
        `Model list failed with HTTP ${response.status}`
      )
    );
  }

  return (data.resources || [])
    .map((model) => model.model_id)
    .filter((modelId) => /granite/i.test(String(modelId)));
}

async function askGranite(token, prompt) {
  const baseUrl = WATSONX_URL.replace(/\/+$/, '');

  const url =
    `${baseUrl}/ml/v1/text/chat` +
    `?version=${encodeURIComponent(WATSONX_API_VERSION)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model_id: WATSONX_MODEL,
      project_id: WATSONX_PROJECT_ID,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 120,
      temperature: 0.2,
    }),
  });

  const data = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      getApiError(
        data,
        `Granite chat failed with HTTP ${response.status}`
      )
    );
  }

  const reply = String(
    data?.choices?.[0]?.message?.content ||
    data?.results?.[0]?.generated_text ||
    ''
  ).trim();

  if (!reply) {
    throw new Error(
      `Granite returned no text. Response keys: ` +
      Object.keys(data).join(', ')
    );
  }

  return reply;
}

async function checkDoclingHealth() {
  const baseUrl = DOCLING_URL.replace(/\/+$/, '');

  const response = await fetch(`${baseUrl}/health`);
  const data = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      getApiError(
        data,
        `Docling health check returned HTTP ${response.status}`
      )
    );
  }
}

async function convertPdfWithDocling(pdfPath) {
  const absolutePath = path.resolve(pdfPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`PDF file not found: ${absolutePath}`);
  }

  if (!fs.statSync(absolutePath).isFile()) {
    throw new Error(
      `The supplied path is not a file: ${absolutePath}`
    );
  }

  if (path.extname(absolutePath).toLowerCase() !== '.pdf') {
    throw new Error(
      'Provide a real PDF file for the Docling conversion test.'
    );
  }

  const fileBuffer = fs.readFileSync(absolutePath);
  const form = new FormData();

  form.append(
    'files',
    new Blob(
      [fileBuffer],
      { type: 'application/pdf' }
    ),
    path.basename(absolutePath)
  );

  form.append('from_formats', 'pdf');
  form.append('to_formats', 'md');
  form.append('do_ocr', 'true');

  const baseUrl = DOCLING_URL.replace(/\/+$/, '');

  const response = await fetch(
    `${baseUrl}/v1/convert/file`,
    {
      method: 'POST',
      body: form,
    }
  );

  const data = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      getApiError(
        data,
        `Docling conversion returned HTTP ${response.status}`
      )
    );
  }

  const markdown = String(
    data?.document?.md_content ||
    data?.document?.markdown ||
    data?.md_content ||
    (
      Array.isArray(data?.documents)
        ? (
            data.documents[0]?.md_content ||
            data.documents[0]?.markdown ||
            ''
          )
        : ''
    ) ||
    ''
  ).trim();

  if (!markdown) {
    throw new Error(
      `Docling returned no Markdown. Response keys: ` +
      Object.keys(data).join(', ')
    );
  }

  return {
    markdown,
    absolutePath,
    status: data?.status || 'success',
  };
}

async function verifyGranite() {
  console.log('IBM watsonx.ai (Granite)');

  if (!WATSONX_API_KEY || !WATSONX_PROJECT_ID) {
    fail(
      'WATSONX_API_KEY or WATSONX_PROJECT_ID is missing ' +
      'from backend/.env.'
    );

    return;
  }

  let token;

  try {
    token = await createIamToken();

    pass(
      'IBM Cloud IAM token minted from your API key.'
    );
  } catch (error) {
    fail(`IAM token failed: ${error.message}`);
    return;
  }

  try {
    const models = await listGraniteModels(token);

    if (!models.length) {
      fail(
        'No Granite models were returned for this region.'
      );
    } else {
      pass(
        `Granite models available in ${WATSONX_URL}:`
      );

      models.forEach((modelId) => {
        const marker =
          modelId === WATSONX_MODEL
            ? '-> '
            : '   ';

        info(`${marker}${modelId}`);
      });

      if (!models.includes(WATSONX_MODEL)) {
        fail(
          `WATSONX_MODEL "${WATSONX_MODEL}" ` +
          'is not available.'
        );
      }
    }
  } catch (error) {
    fail(
      `Could not list Granite models: ${error.message}`
    );
  }

  try {
    const reply = await askGranite(
      token,
      'Reply with exactly: GRANITE OK'
    );

    if (
      reply.trim().toUpperCase() ===
      'GRANITE OK'
    ) {
      pass('Granite replied: "GRANITE OK"');
    } else {
      fail(
        `Granite replied, but not exactly as requested: ` +
        `"${reply.slice(0, 80)}"`
      );
    }
  } catch (error) {
    fail(
      `Granite generation failed: ${error.message}`
    );
  }

  try {
    const urdu = await askGranite(
      token,
      'Translate into Urdu. Reply with only the Urdu text: ' +
      '"I design posters."'
    );

    const containsUrdu =
      /[\u0600-\u06FF]/.test(urdu);

    if (containsUrdu) {
      pass(
        'Granite produced Urdu script; ' +
        'the multilingual path is live.'
      );

      info(urdu.slice(0, 100));
    } else {
      fail(
        'Granite did not return Urdu script ' +
        'for the multilingual test.'
      );

      info(urdu.slice(0, 100));
    }
  } catch (error) {
    fail(
      `Multilingual check failed: ${error.message}`
    );
  }
}

async function verifyDocling(pdfPath) {
  console.log('\nIBM Docling');

  try {
    await checkDoclingHealth();

    pass(
      `Docling service is reachable at ${DOCLING_URL}.`
    );
  } catch (error) {
    fail(
      `Docling health check failed: ${error.message}`
    );

    info(
      'Keep "docling-serve run --enable-ui" ' +
      'running in another terminal.'
    );

    return;
  }

  if (!pdfPath) {
    warn(
      'Health passed, but real PDF conversion ' +
      'was not tested.'
    );

    info(
      'Run: node verify-ibm.js ' +
      '"C:\\full\\path\\to\\Sample_CV.pdf"'
    );

    return;
  }

  try {
    const result =
      await convertPdfWithDocling(pdfPath);

    const firstLine =
      result.markdown
        .split('\n')
        .find((line) => line.trim()) ||
      '(blank)';

    pass(
      `Docling converted ` +
      `${path.basename(result.absolutePath)} ` +
      `and returned ` +
      `${result.markdown.length} Markdown characters.`
    );

    info(`Status: ${result.status}`);
    info(`First line: ${firstLine.slice(0, 100)}`);
  } catch (error) {
    fail(
      `Docling PDF conversion failed: ` +
      error.message
    );

    info(
      'Do not claim Docling in the submission ' +
      'until this conversion passes.'
    );
  }
}

async function main() {
  const pdfPath = process.argv[2];

  console.log(
    '\n=== MuseForge: IBM stack verification ===\n'
  );

  await verifyGranite();
  await verifyDocling(pdfPath);

  if (failureCount === 0) {
    console.log(
      '\nVerification finished with no failures.\n'
    );
  } else {
    console.log(
      `\nVerification finished with ` +
      `${failureCount} failure(s).\n`
    );

    process.exitCode = 1;
  }
}

main().catch((error) => {
  fail(
    `Unexpected verification error: ${error.message}`
  );

  process.exitCode = 1;
});