'use strict';

/**
 * Verifies that LangChain is genuinely calling IBM Granite.
 *
 * Run:
 *   node verify-langchain.js
 */

require('dotenv').config();

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

function pass(message) {
  console.log(`\x1b[32mPASS\x1b[0m  ${message}`);
}

function fail(message) {
  console.error(`\x1b[31mFAIL\x1b[0m  ${message}`);
  process.exitCode = 1;
}

function extractText(content) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        return item?.text || item?.content || '';
      })
      .join('')
      .trim();
  }

  return String(content || '').trim();
}

async function main() {
  console.log(
    '\n=== MuseForge: LangChain + IBM Granite verification ===\n'
  );

  if (!WATSONX_API_KEY) {
    throw new Error(
      'WATSONX_API_KEY is missing from backend/.env'
    );
  }

  if (!WATSONX_PROJECT_ID) {
    throw new Error(
      'WATSONX_PROJECT_ID is missing from backend/.env'
    );
  }

  const { ChatWatsonx } =
    await import('@langchain/ibm');

  const { ChatPromptTemplate } =
    await import('@langchain/core/prompts');

  const graniteModel = new ChatWatsonx({
    version: WATSONX_API_VERSION,
    serviceUrl: WATSONX_URL,
    projectId: WATSONX_PROJECT_ID,
    model: WATSONX_MODEL,

    watsonxAIAuthType: 'iam',
    watsonxAIApikey: WATSONX_API_KEY,

    maxTokens: 120,
    temperature: 0.2,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    [
      'system',
      [
        'You are the MuseForge portfolio assistant.',
        'Follow the user instruction exactly.',
        'Do not add explanations.',
      ].join(' '),
    ],
    [
      'human',
      '{instruction}',
    ],
  ]);

  const chain = prompt.pipe(graniteModel);

  const response = await chain.invoke({
    instruction:
      'Reply with exactly: LANGCHAIN GRANITE OK',
  });

  const text = extractText(response?.content);

  if (text.toUpperCase() !== 'LANGCHAIN GRANITE OK') {
    throw new Error(
      `Unexpected response: "${text.slice(0, 150)}"`
    );
  }

  pass(
    'LangChain PromptTemplate successfully called IBM Granite.'
  );

  pass(
    `Model used: ${WATSONX_MODEL}`
  );

  console.log(`Response: "${text}"`);

  console.log(
    '\nLangChain verification finished successfully.\n'
  );
}

main().catch((error) => {
  fail(error.message);

  console.error(
    '\nLangChain verification did not pass.\n'
  );
});