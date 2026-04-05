import Fastify from 'fastify';
import { config } from '../config.js';
import { ingestRoutes } from './routes/ingest.js';
import { jobRoutes } from './routes/jobs.js';
import { clipRoutes } from './routes/clips.js';
import { startWatcher } from '../ingestion/watcher.js';

const app = Fastify({ logger: true });

// Register routes
app.register(ingestRoutes);
app.register(jobRoutes);
app.register(clipRoutes);

// Health check
app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

// Start file watcher alongside the API
startWatcher();

// Boot
app.listen({ port: config.PORT, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`Server listening on http://localhost:${config.PORT}`);
});
