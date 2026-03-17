import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3321),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ADMIN_SESSION_COOKIE_NAME: z.string().default('lobehub_admin_session'),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(12),
  ADMIN_SESSION_SECURE_COOKIE: z.coerce.boolean().default(false),
  ALLOW_LEGACY_ACTOR_HEADER: z.coerce.boolean().default(false),
  TRUST_PROXY: z.coerce.boolean().default(false),
  CORS_ORIGIN: z
    .string()
    .default('http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:4174,http://localhost:4174'),
});

export const env = envSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((item) => item.trim())
  .filter(Boolean);
