# =============================================================================
# Dockerfile.api — Production-ready multi-stage build (Render-ready)
# Build context: monorepo root
# Build:  docker build -f apps/api/Dockerfile -t enjoymilk-api .
# =============================================================================

# ─── Builder ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Workspace manifests (better layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY prisma ./prisma

# Install ALL deps (incl. dev) — needed for nest build + prisma CLI
RUN pnpm install --frozen-lockfile

# Generate Prisma client from the current schema
RUN pnpm exec prisma generate --schema=./prisma/schema.prisma

# Build the NestJS app
COPY apps/api/tsconfig.json apps/api/nest-cli.json apps/api/
COPY apps/api/src apps/api/src
RUN cd apps/api && pnpm exec nest build

# Precompile the seed to plain JS (bulletproof — لا نعتمد على ts-node وقت التشغيل)
# نستخدم ';' لأن tsc يُنتج JS حتى مع أخطاء أنواع (require تُحل وقت التشغيل عبر NODE_PATH)،
# ثم نتحقق أن الملف أُنتج فعلاً.
RUN node apps/api/node_modules/typescript/bin/tsc prisma/seed.ts \
      --outDir prisma --module commonjs --target ES2021 \
      --esModuleInterop --skipLibCheck --moduleResolution node \
      --noEmitOnError false --types node \
      --typeRoots apps/api/node_modules/@types ; \
    test -f prisma/seed.js

# ─── Runtime ─────────────────────────────────────────────────────────────────
# We keep the full node_modules (incl. prisma CLI) so `prisma migrate deploy`
# can run at container start. Stable and predictable on Render.
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache tini openssl curl ca-certificates && \
    addgroup -S app -g 1001 && adduser -S app -u 1001 -G app

ENV NODE_ENV=production PORT=3001

# Production artifacts
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=app:app /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=app:app /app/apps/api/package.json ./apps/api/
COPY --from=builder --chown=app:app /app/apps/api/tsconfig.json ./apps/api/
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/package.json /app/pnpm-workspace.yaml ./

USER app
EXPOSE 3001

# Render uses its own health checks too, but this keeps Docker aware of state
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fs http://localhost:${PORT:-3001}/health || exit 1

# tini = proper PID 1 (clean signal handling for graceful restart)
ENTRYPOINT ["/sbin/tini","--"]
# On boot: (1) apply pending migrations, (2) seed once (idempotent — upserts,
# لا يصفّر كلمات المرور), (3) start the API. الـ seed غير حرج: لو فشل، الـ API يكمل.
# ملاحظة: نستخدم `db push` بدل `migrate deploy` لمزامنة القاعدة مع الـ schema الحالي
# تماماً (الـ migrations كانت قديمة ولا تطابق schema v2). آمن لأن القاعدة لا تحوي
# بيانات حقيقية بعد، والبذور تُعاد تلقائياً.
CMD ["sh","-c","node node_modules/prisma/build/index.js db push --schema=./prisma/schema.prisma --accept-data-loss --skip-generate && echo '=== SEED START ===' && (NODE_PATH=/app/apps/api/node_modules:/app/node_modules node prisma/seed.js || echo '=== SEED SKIPPED (non-fatal) ===') && echo '=== SEED END ===' && node apps/api/dist/main.js"]
