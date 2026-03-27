import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { ensureAdminAuthSchema } from './auth.js';
import { corsOrigins, env } from './config.js';
import { registerCustomerAnalysisRoutes } from './routes/customer-analysis.js';
import { registerDailyReportRoutes } from './routes/daily-reports.js';
import { registerDatabaseRoutes } from './routes/database.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerMobileRoutes } from './routes/mobile.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerSystemRoutes } from './routes/system.js';

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

  await app.register(cors, {
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) {
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
  await registerDatabaseRoutes(app);
  await registerProjectRoutes(app);
  await registerReportRoutes(app);
  await registerDailyReportRoutes(app);
  await registerCustomerAnalysisRoutes(app);
  await registerMobileRoutes(app);

  return app;
}
