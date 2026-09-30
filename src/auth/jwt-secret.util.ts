import { ConfigService } from '@nestjs/config';

// Never used in production — only lets `npm run start:dev` boot when a local
// .env hasn't been created yet. Any real deployment must set JWT_SECRET.
const INSECURE_DEV_FALLBACK = 'dev-only-insecure-secret-change-me';

export function getJwtSecret(configService: ConfigService): string {
  const secret = configService.get<string>('JWT_SECRET');
  if (secret) {
    return secret;
  }

  if (configService.get<string>('NODE_ENV') === 'production') {
    throw new Error(
      'JWT_SECRET wajib diset di environment variable pada production. Server dihentikan.',
    );
  }

  return INSECURE_DEV_FALLBACK;
}
