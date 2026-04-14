import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { ensureAdminAuthSchema } from './auth.js';
import { corsOrigins, env } from './config.js';
import { registerCustomerAnalysisRoutes } from './routes/customer-analysis.js';
import { registerDailyReportRoutes } from './routes/daily-reports.js';
import { registerDatabaseRoutes } from './routes/database.js';
import { registerGlobalDocumentRoutes } from './routes/global-documents.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMobileRoutes } from './routes/mobile.js';
import { registerOverviewRoutes } from './routes/overview.js';
import { registerPortfolioRoutes } from './routes/portfolio.js';
import { registerProjectDocumentRoutes } from './routes/project-documents.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerSystemMetricsRoutes } from './routes/system-metrics.js';

function normalizeOriginCandidate(value: string) {
  const trimmed = value.trim();

  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : '';

    return {
      exact: `${protocol}//${hostname}${port}`,
      hostname,
    };
  } catch {
    return {
      exact: trimmed.toLowerCase(),
      hostname: trimmed.toLowerCase(),
    };
  }
}

function createAllowedOriginMatcher(origins: string[]) {
  const normalized = origins
    .map((origin) => normalizeOriginCandidate(origin))
    .filter(Boolean) as Array<{ exact: string; hostname: string }>;

  const exactOrigins = new Set(normalized.map((item) => item.exact));
  const hostnames = new Set(normalized.map((item) => item.hostname));

  return (origin: string) => {
    const normalizedOrigin = normalizeOriginCandidate(origin);

    if (!normalizedOrigin) return false;
    if (exactOrigins.has(normalizedOrigin.exact)) return true;
    if (hostnames.has(normalizedOrigin.hostname)) return true;

    return false;
  };
}

function formatValidationMessage(error: ZodError) {
  const messages = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });

  return [...new Set(messages)].join('; ');
}

export async function buildApp() {
  const app = Fastify({
    logger: true,
    trustProxy: env.TRUST_PROXY,
  });
  const isAllowedOrigin = createAllowedOriginMatcher(corsOrigins);

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString();
    const trimmed = text.trim();

    if (!trimmed) {
      done(null, {});
      return;
    }

    try {
      done(null, JSON.parse(trimmed));
    } catch {
      // Keep malformed JSON as raw text so routes can apply tolerant parsing
      done(null, trimmed);
    }
  });

  await app.register(cors, {
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    origin: (origin, callback) => {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed: ${origin}`), false);
    },
    credentials: true,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: 'ValidationError',
        message: formatValidationMessage(error),
      });
      return;
    }

    const appError = error as Error & { statusCode?: unknown };
    const statusCode = typeof appError.statusCode === 'number'
      ? (appError.statusCode as number)
      : 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled request error');

      reply.status(500).send({
        error: 'InternalServerError',
        message: 'Internal server error',
      });
      return;
    }

    reply.status(statusCode).send({
      error: appError.name || 'Error',
      message: appError.message,
    });
  });

  await ensureAdminAuthSchema();

  await registerHealthRoutes(app);
  await registerSystemRoutes(app);
  await registerSystemMetricsRoutes(app);
  await registerGlobalDocumentRoutes(app);
  await registerDatabaseRoutes(app);
  await registerPortfolioRoutes(app);
  await registerProjectRoutes(app);
  await registerProjectDocumentRoutes(app);
  await registerOverviewRoutes(app);
  await registerReportRoutes(app);
  await registerDailyReportRoutes(app);
  await registerCustomerAnalysisRoutes(app);
  await registerMobileRoutes(app);

  return app;
}
