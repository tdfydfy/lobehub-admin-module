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
  ADMIN_SESSION_COOKIE_NAME: z.string().default('lobehub_admin_session'),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  ADMIN_SESSION_SECURE_COOKIE: envBoolean.default(false),
  ALLOW_LEGACY_ACTOR_HEADER: envBoolean.default(false),
  TRUST_PROXY: envBoolean.default(false),
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
