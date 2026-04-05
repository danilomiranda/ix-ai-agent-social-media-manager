import { Queue } from 'bullmq';
import { config } from '../config.js';

const connection = {
  host: new URL(config.REDIS_URL).hostname,
  port: parseInt(new URL(config.REDIS_URL).port || '6379'),
};

export const queues = {
  transcribe: new Queue('transcribe', { connection }),
  select:     new Queue('select',     { connection }),
  reframe:    new Queue('reframe',    { connection }),
  edit:       new Queue('edit',       { connection }),
  publish:    new Queue('publish',    { connection }),
};

export { connection };
