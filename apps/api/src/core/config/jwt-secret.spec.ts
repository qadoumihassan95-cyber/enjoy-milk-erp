import {
  resolveJwtSecret,
  validateJwtSecretAtStartup,
  JwtSecretConfigError,
  DEV_JWT_SECRET,
  MIN_PRODUCTION_SECRET_LENGTH,
} from './jwt-secret';

/**
 * The contract these tests pin down:
 *
 *   production  → a missing / placeholder / short secret must THROW.
 *                 The app must not boot with a guessable signing key.
 *   non-prod    → must keep working exactly as before, so local dev and
 *                 the existing test suite are unaffected.
 */

const STRONG = 'a'.repeat(MIN_PRODUCTION_SECRET_LENGTH); // 32 chars
const REAL_LOOKING = '9f2c1b7e4a8d6350f1e9c2b7a4d80351f6e9c2b7a4d80351';

describe('resolveJwtSecret — production', () => {
  const prod = (JWT_SECRET?: string) =>
    ({ NODE_ENV: 'production', ...(JWT_SECRET === undefined ? {} : { JWT_SECRET }) }) as NodeJS.ProcessEnv;

  it('throws when JWT_SECRET is missing entirely', () => {
    expect(() => resolveJwtSecret(prod())).toThrow(JwtSecretConfigError);
  });

  it('throws when JWT_SECRET is an empty string', () => {
    expect(() => resolveJwtSecret(prod(''))).toThrow(JwtSecretConfigError);
  });

  it('throws when JWT_SECRET is only whitespace', () => {
    expect(() => resolveJwtSecret(prod('    '))).toThrow(JwtSecretConfigError);
  });

  it('throws on the old hardcoded fallback — the exact bug being fixed', () => {
    expect(() => resolveJwtSecret(prod('dev-secret-change-me'))).toThrow(
      /known placeholder/,
    );
  });

  it('rejects placeholders regardless of casing', () => {
    expect(() => resolveJwtSecret(prod('DEV-SECRET-CHANGE-ME'))).toThrow(
      /known placeholder/,
    );
  });

  it('throws on the .env.prod.example placeholder', () => {
    expect(() =>
      resolveJwtSecret(prod('CHANGE_ME_TO_64_CHARS_RANDOM_HEX_STRING')),
    ).toThrow(/known placeholder/);
  });

  it('throws on a secret shorter than the minimum length', () => {
    expect(() => resolveJwtSecret(prod('short-but-unique-xyz'))).toThrow(
      /only 20 characters/,
    );
  });

  it('accepts a strong secret at exactly the minimum length', () => {
    expect(resolveJwtSecret(prod(STRONG))).toBe(STRONG);
  });

  it('accepts a realistic generated secret', () => {
    expect(resolveJwtSecret(prod(REAL_LOOKING))).toBe(REAL_LOOKING);
  });

  it('trims surrounding whitespace rather than counting it toward length', () => {
    expect(resolveJwtSecret(prod(`  ${REAL_LOOKING}  `))).toBe(REAL_LOOKING);
  });

  it('error message tells the operator how to generate one', () => {
    expect(() => resolveJwtSecret(prod())).toThrow(/openssl rand -hex 32/);
  });

  it('never leaks the secret value in the thrown message', () => {
    try {
      resolveJwtSecret(prod('tiny'));
      fail('expected throw');
    } catch (err) {
      expect((err as Error).message).not.toContain('tiny');
    }
  });
});

describe('resolveJwtSecret — non-production', () => {
  it('falls back to the dev secret when unset, so local dev still runs', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(resolveJwtSecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(
      DEV_JWT_SECRET,
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not throw in test env with no secret — existing suite is unaffected', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => resolveJwtSecret({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).not.toThrow();
    warn.mockRestore();
  });

  it('honours a short secret outside production instead of rejecting it', () => {
    expect(
      resolveJwtSecret({ NODE_ENV: 'development', JWT_SECRET: 'local-validate-only' } as NodeJS.ProcessEnv),
    ).toBe('local-validate-only');
  });
});

describe('validateJwtSecretAtStartup', () => {
  it('reports the configured length and never the secret itself', () => {
    const msg = validateJwtSecretAtStartup({
      NODE_ENV: 'production',
      JWT_SECRET: REAL_LOOKING,
    } as NodeJS.ProcessEnv);
    expect(msg).toContain(`${REAL_LOOKING.length} chars`);
    expect(msg).not.toContain(REAL_LOOKING);
  });

  it('flags the development fallback explicitly', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(validateJwtSecretAtStartup({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toMatch(
      /NOT valid in production/,
    );
    warn.mockRestore();
  });

  it('propagates the production failure so bootstrap aborts', () => {
    expect(() =>
      validateJwtSecretAtStartup({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toThrow(JwtSecretConfigError);
  });
});

describe('signer and verifier share one source', () => {
  it('AuthModule and JwtStrategy both call resolveJwtSecret', () => {
    // Guards against the original defect returning: two call sites drifting
    // apart, or one of them reintroducing an inline `|| 'fallback'`.
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const read = (p: string) =>
      fs.readFileSync(path.join(__dirname, '..', 'auth', p), 'utf8');

    for (const file of ['auth.module.ts', 'jwt.strategy.ts']) {
      const code = read(file);
      expect(code).toContain('resolveJwtSecret');
      expect(code).not.toMatch(/process\.env\.JWT_SECRET\s*\|\|/);
      expect(code).not.toContain("'dev-secret-change-me'");
    }
  });
});
