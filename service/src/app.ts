import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ensureAdminAuthSchema } from './auth.js';
import { corsOrigins, env } from './config.js';
import { registerDatabaseRoutes } from './routes/database.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerSystemRoutes } from './routes/system.js';

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

  app.setErrorHandler((error, _request, reply) => {
    const appError = error as Error & { statusCode?: unknown };
    const statusCode = typeof appError.statusCode === 'number'
      ? (appError.statusCode as number)
      : 500;

    reply.status(statusCode).send({
      error: appError.name,
      message: appError.message,
    });
  });

  await ensureAdminAuthSchema();

  await registerHealthRoutes(app);
  await registerSystemRoutes(app);
  await registerDatabaseRoutes(app);
  await registerProjectRoutes(app);
  await registerReportRoutes(app);

  return app;
}
