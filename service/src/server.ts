import { env } from './config.js';
import { db } from './db.js';
import { buildApp } from './app.js';

const app = await buildApp();

const shutdown = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({
  port: env.PORT,
  host: env.HOST,
});
