import { env } from './config.js';

const PLACEHOLDER_API_KEYS = new Set([
  'your-volcengine-api-key',
  'sk-your-api-key',
  'your-api-key',
  'test',
  'placeholder',
]);

function stripWrappingQuotes(value: string) {
  let normalized = value.trim();

  while (
    normalized.length >= 2
    && (
      (normalized.startsWith('"') && normalized.endsWith('"'))
      || (normalized.startsWith('\'') && normalized.endsWith('\''))
      || (normalized.startsWith('`') && normalized.endsWith('`'))
    )
  ) {
    normalized = normalized.slice(1, -1).trim();
  }

  return normalized;
}

function sanitizeApiKey(rawValue: string | undefined) {
  if (!rawValue) {
    return {
      apiKey: null,
      issue: null,
    };
  }

  let normalized = stripWrappingQuotes(rawValue);

  if (!normalized) {
    return {
      apiKey: null,
      issue: null,
    };
  }

  if (/^authorization\s*:/i.test(normalized)) {
    normalized = normalized.replace(/^authorization\s*:\s*/i, '').trim();
  }

  if (/^bearer\s+/i.test(normalized)) {
    normalized = normalized.replace(/^bearer\s+/i, '').trim();
  }

  normalized = stripWrappingQuotes(normalized);

  if (!normalized) {
    return {
      apiKey: null,
      issue: 'VOLCENGINE_API_KEY is empty after normalization',
    };
  }

  if (PLACEHOLDER_API_KEYS.has(normalized.toLowerCase())) {
    return {
      apiKey: null,
      issue: 'VOLCENGINE_API_KEY is still using a placeholder value',
    };
  }

  if (
    /^[{\[]/.test(normalized)
    || /"error"\s*:|"code"\s*:|"message"\s*:|"type"\s*:|"param"\s*:/i.test(normalized)
    || /AuthenticationError|Unauthorized/i.test(normalized)
  ) {
    return {
      apiKey: null,
      issue: 'VOLCENGINE_API_KEY looks like a copied error payload instead of an API key',
    };
  }

  if (/\s/.test(normalized)) {
    return {
      apiKey: null,
      issue: 'VOLCENGINE_API_KEY contains whitespace after normalization',
    };
  }

  return {
    apiKey: normalized,
    issue: null,
  };
}

function sanitizeBaseUrl(rawValue: string | undefined) {
  const normalized = stripWrappingQuotes(rawValue ?? '');
  return normalized || 'https://ark.cn-beijing.volces.com/api/v3';
}

export function getVolcengineRuntimeConfig() {
  const apiKey = sanitizeApiKey(env.VOLCENGINE_API_KEY);

  return {
    endpoint: sanitizeBaseUrl(env.VOLCENGINE_BASE_URL),
    apiKey: apiKey.apiKey,
    apiKeyIssue: apiKey.issue,
    hasUsableApiKey: Boolean(apiKey.apiKey),
  };
}
