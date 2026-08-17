/**
 * JWT secret resolution — fail fast in production.
 * ────────────────────────────────────────────────
 * جذر المشكلة (root cause)
 *
 * كان الكود يستخدم `process.env.JWT_SECRET || 'dev-secret-change-me'`
 * في مكانين: مُصدِّر التوكن (AuthModule) والمُتحقِّق منه (JwtStrategy).
 * لأن القيمة الاحتياطية واحدة في الموضعين، فإن أي نشر إنتاجي يفقد فيه
 * المتغيّر JWT_SECRET يستمر بالعمل بشكل طبيعي تماماً — لكنه يوقّع ويقبل
 * توكنات بسرّ معروف للجميع لأنه مكتوب في الشيفرة المصدرية. أي شخص يستطيع
 * عندها تزوير توكن لأي مستخدم أو دور أو مستأجر (tenant).
 *
 * الفشل الصامت هو الخطر الحقيقي هنا، وليس غياب المتغيّر بحد ذاته.
 *
 * The fix: resolve the secret in ONE place, and in production refuse to
 * boot unless a real secret is configured. A crash at startup is loud,
 * immediate, and safe. A silently-weak signing key is none of those.
 *
 * Non-production keeps a development fallback so local work and tests are
 * unaffected — but it warns, so the situation is visible.
 *
 * Render already sets this automatically (`generateValue: true` in
 * render.yaml), so this check does not change the behaviour of the current
 * production deploy. It prevents a future misconfiguration from being silent.
 */

/** Fallback used ONLY outside production. Never reachable when NODE_ENV=production. */
export const DEV_JWT_SECRET = 'dev-secret-change-me';

/** Minimum length accepted in production. 32 chars ≈ 128 bits of hex. */
export const MIN_PRODUCTION_SECRET_LENGTH = 32;

/**
 * Values that have appeared in this repo's example/env files, or are common
 * placeholders. Rejected in production even if long enough, because a
 * placeholder that ships is a published secret.
 */
const KNOWN_WEAK_SECRETS = new Set(
  [
    DEV_JWT_SECRET,
    'dev-secret-change-me-in-production',
    'CHANGE_ME_TO_64_CHARS_RANDOM_HEX_STRING',
    'local-validate-only',
    'changeme',
    'change-me',
    'secret',
    'jwt-secret',
    'test',
  ].map((s) => s.toLowerCase()),
);

export class JwtSecretConfigError extends Error {
  constructor(reason: string) {
    super(
      `[config] Refusing to start: ${reason}\n` +
        `  JWT_SECRET must be set to a strong random value (>= ${MIN_PRODUCTION_SECRET_LENGTH} characters) ` +
        `when NODE_ENV=production.\n` +
        `  Generate one with:  openssl rand -hex 32\n` +
        `  On Render this is provided automatically by 'generateValue: true' in render.yaml — ` +
        `if you are seeing this, the environment variable was removed or overridden.`,
    );
    this.name = 'JwtSecretConfigError';
  }
}

/**
 * Resolve the JWT signing/verification secret.
 *
 * @throws {JwtSecretConfigError} in production when the secret is missing,
 *   blank, a known placeholder, or too short.
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const isProd = env.NODE_ENV === 'production';
  const raw = env.JWT_SECRET?.trim() ?? '';

  if (isProd) {
    if (!raw) {
      throw new JwtSecretConfigError('JWT_SECRET is not set');
    }
    if (KNOWN_WEAK_SECRETS.has(raw.toLowerCase())) {
      throw new JwtSecretConfigError(
        'JWT_SECRET is a known placeholder value, not a real secret',
      );
    }
    if (raw.length < MIN_PRODUCTION_SECRET_LENGTH) {
      throw new JwtSecretConfigError(
        `JWT_SECRET is only ${raw.length} characters long`,
      );
    }
    return raw;
  }

  // ── non-production ────────────────────────────────────────────────
  if (!raw) {
    // eslint-disable-next-line no-console
    console.warn(
      '[config] JWT_SECRET is not set — using the development fallback. ' +
        'This would refuse to start with NODE_ENV=production.',
    );
    return DEV_JWT_SECRET;
  }
  return raw;
}

/**
 * Explicit startup validation hook. Called from main.ts before the Nest
 * application is created so the failure is reported clearly rather than as
 * a module-resolution stack trace.
 *
 * Returns a short, non-sensitive description for the startup log. It never
 * returns or logs the secret itself — only its length and source.
 */
export function validateJwtSecretAtStartup(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = resolveJwtSecret(env);
  const isFallback = secret === DEV_JWT_SECRET && !env.JWT_SECRET?.trim();
  return isFallback
    ? 'JWT secret: development fallback (NOT valid in production)'
    : `JWT secret: configured (${secret.length} chars)`;
}
