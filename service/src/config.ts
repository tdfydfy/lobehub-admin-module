import 'dotenv/config';
import { z } from 'zod';

const envBoolean = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false;

  return value;
}, z.boolean());

const envSchema = z.object({
  PORT: z.coerce.number().default(3321),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  DB_QUERY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
  ADMIN_SESSION_COOKIE_NAME: z.string().default('lobehub_admin_session'),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  ADMIN_SESSION_SECURE_COOKIE: envBoolean.default(false),
  ALLOW_LEGACY_ACTOR_HEADER: envBoolean.default(false),
  TRUST_PROXY: envBoolean.default(false),
  PROJECT_DOCS_INTERNAL_TOKEN: z.string().trim().optional(),
  PROJECT_DOCS_PLUGIN_PUBLIC_BASE_URL: z.string().trim().optional(),
  PROJECT_DOCS_PLUGIN_SECRET: z.string().trim().optional(),
  CRM_SUMMARY_SYNC_ENABLED: envBoolean.default(true),
  CRM_SUMMARY_SYNC_INTERVAL_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  CRM_SUMMARY_SYNC_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(50),
  CRM_SUMMARY_SYNC_QUIET_PERIOD_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  CRM_SUMMARY_SYNC_INITIAL_LOOKBACK_MINUTES: z.coerce.number().int().min(0).max(24 * 60).default(10),
  CORS_ORIGIN: z
    .string()
    .default('http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:4174,http://localhost:4174'),
  DAILY_REPORT_DEFAULT_MODEL_PROVIDER: z.enum(['volcengine', 'fallback']).optional(),
  DAILY_REPORT_DEFAULT_MODEL_NAME: z.string().trim().optional(),
  VOLCENGINE_API_KEY: z.string().trim().optional(),
  VOLCENGINE_BASE_URL: z.string().trim().optional(),
});

export const env = envSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((item) => item.trim())
  .filter(Boolean);
