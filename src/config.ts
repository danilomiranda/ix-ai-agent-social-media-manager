import { z } from 'zod';

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  DATABASE_URL: z.string().default('file:./dev.db'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ZERNIO_API_KEY: z.string().min(1, 'ZERNIO_API_KEY is required'),
  ZERNIO_PROFILE_ID: z.string().min(1, 'ZERNIO_PROFILE_ID is required'),
  KIE_API_KEY: z.string().min(1, 'KIE_API_KEY is required'),
  PORT: z.coerce.number().default(3001),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
