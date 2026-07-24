'use strict';
/**
 * MuseForge — GET /ibm-status
 *
 * A SAFE, read-only probe of the IBM configuration for demo/judging.
 * It returns ONLY booleans and public, non-secret config. It NEVER returns or logs:
 *   API keys, IAM tokens, project/space IDs, CV contents, emails, or any user data.
 *
 * Self-contained on purpose: the only wiring into server.js is a single require + call,
 * so it cannot disturb the existing generation / upload / auth flows.
 *
 * Wire it in server.js AFTER `const app = express()` and after the WATSONX_/DOCLING_ consts:
 *
 *   require('./ibm-status').registerIbmStatus(app, {
 *     watsonxConfigured,                 // existing const
 *     watsonxModel: WATSONX_MODEL,       // existing const (public model id)
 *     watsonxStrict: WATSONX_STRICT,     // existing const ('true'/'false' string)
 *     doclingUrl: DOCLING_URL,           // existing const
 *     doclingProbeTimeoutMs: 2500,       // status must be fast; NOT the 180s gen timeout
 *   });
 */

// Is @langchain/ibm actually installed? Sync, no network. Layered so an ESM-only
// package whose '.' export is not require-able still resolves via its package.json.
function isLangchainInstalled() {
  for (const spec of ['@langchain/ibm/package.json', '@langchain/ibm']) {
    try { require.resolve(spec); return true; } catch (_) { /* try next spec */ }
  }
  return false;
}

// Can we reach docling-serve right now? Fast, best-effort, NEVER throws.
// Tries GET /health (docling-serve exposes it), then the base URL. Any failure => false.
async function checkDoclingReachable(doclingUrl, timeoutMs = 2500) {
  if (!doclingUrl) return false;
  const base = String(doclingUrl).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(timeoutMs) || 2500);
  try {
    let res;
    try {
      res = await fetch(base + '/health', { method: 'GET', signal: controller.signal });
    } catch (_) {
      res = await fetch(base + '/', { method: 'GET', signal: controller.signal });
    }
    clearTimeout(timer);
    return Boolean(res && res.ok);
  } catch (_) {
    clearTimeout(timer);
    return false;
  }
}

// Pure config -> booleans/strings. No I/O, trivially testable. Contains NO secrets.
function buildIbmStatusBase(cfg = {}) {
  return {
    watsonxConfigured: Boolean(cfg.watsonxConfigured),
    graniteModel: String(cfg.watsonxModel || ''),
    langchainInstalled: isLangchainInstalled(),
    doclingConfigured: Boolean(cfg.doclingUrl),
    strictIbmMode: String(cfg.watsonxStrict || '').toLowerCase().trim() === 'true',
  };
}

function registerIbmStatus(app, cfg = {}) {
  app.get('/ibm-status', async (req, res) => {
    try {
      const base = buildIbmStatusBase(cfg);
      const doclingReachable = await checkDoclingReachable(cfg.doclingUrl, cfg.doclingProbeTimeoutMs);
      // Exactly the six fields the brief specifies, in order. Nothing else.
      res.json({
        watsonxConfigured: base.watsonxConfigured,
        graniteModel: base.graniteModel,
        langchainInstalled: base.langchainInstalled,
        doclingConfigured: base.doclingConfigured,
        doclingReachable,
        strictIbmMode: base.strictIbmMode,
      });
    } catch (_) {
      // A status endpoint must never 500 the app. Degrade to a safe, secret-free shape.
      res.status(200).json({
        watsonxConfigured: false,
        graniteModel: '',
        langchainInstalled: false,
        doclingConfigured: false,
        doclingReachable: false,
        strictIbmMode: false,
      });
    }
  });
}

module.exports = {
  registerIbmStatus,
  buildIbmStatusBase,
  isLangchainInstalled,
  checkDoclingReachable,
};
