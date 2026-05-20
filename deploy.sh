#!/usr/bin/env bash
# =============================================================================
# Enjoy Milk ERP — One-command Production Deploy
# Usage:  ./deploy.sh [local|railway|fly|render]
# =============================================================================

set -e
GREEN='\033[0;32m'; BLUE='\033[0;34m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
say() { echo -e "${BLUE}▶ $1${NC}"; }
ok()  { echo -e "${GREEN}✓ $1${NC}"; }
err() { echo -e "${RED}✗ $1${NC}"; exit 1; }
warn(){ echo -e "${YELLOW}⚠ $1${NC}"; }

TARGET="${1:-local}"

# ─── Generate strong secrets if env file missing ───
gen_secret() { node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"; }

ensure_prod_env() {
  if [ ! -f .env.prod ]; then
    say "إنشاء .env.prod مع secrets قوية"
    cp .env.prod.example .env.prod
    PG_PWD=$(gen_secret | cut -c1-24)
    JWT=$(gen_secret)
    JWT_REF=$(gen_secret)
    sed -i.bak "s|CHANGE_ME_STRONG_RANDOM_PASSWORD|${PG_PWD}|" .env.prod
    sed -i.bak "s|CHANGE_ME_TO_64_CHARS_RANDOM_HEX_STRING|${JWT}|" .env.prod
    sed -i.bak "s|CHANGE_ME_DIFFERENT_64_CHARS_RANDOM_HEX_STRING|${JWT_REF}|" .env.prod
    rm -f .env.prod.bak
    ok "تم توليد secrets قوية → .env.prod"
    warn "عدّل APP_URL و NEXT_PUBLIC_API_URL في .env.prod قبل النشر للسحابة"
  else
    ok ".env.prod موجود"
  fi
}

# ─── LOCAL — full docker stack on this machine ───
deploy_local() {
  say "بناء + تشغيل Production Stack محلياً"
  ensure_prod_env
  docker compose -f docker-compose.prod.yml --env-file .env.prod build
  docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
  sleep 8
  docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api \
    node node_modules/prisma/build/index.js migrate deploy --schema=./prisma/schema.prisma || true
  docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api \
    node -e "require('ts-node/register'); require('./prisma/seed.ts');" 2>/dev/null || \
    warn "Seed محلياً يحتاج: docker compose ... exec api node -r ts-node/register prisma/seed.ts"
  ok "النظام شغّال على:"
  echo "  📊 Web:  http://localhost:${WEB_PORT:-3000}"
  echo "  🔌 API:  http://localhost:${API_PORT:-3001}"
}

# ─── RAILWAY ───
deploy_railway() {
  say "Deploy إلى Railway"
  command -v railway >/dev/null 2>&1 || {
    say "تثبيت Railway CLI..."
    npm install -g @railway/cli
  }
  railway whoami >/dev/null 2>&1 || railway login
  railway link 2>/dev/null || railway init
  railway add --plugin postgresql 2>/dev/null || true

  JWT=$(gen_secret)
  JWT_REF=$(gen_secret)
  railway variables \
    --set "JWT_SECRET=${JWT}" \
    --set "JWT_REFRESH_SECRET=${JWT_REF}" \
    --set "JWT_EXPIRES_IN=15m" \
    --set "NODE_ENV=production"

  railway up --service api --detach
  ok "API نُشر — احصل على الـ URL بـ: railway domain"
  warn "كرّر للـ web service:  railway service web && railway up"
}

# ─── FLY.IO ───
deploy_fly() {
  say "Deploy إلى Fly.io"
  command -v fly >/dev/null 2>&1 || {
    say "تثبيت Fly CLI..."
    curl -L https://fly.io/install.sh | sh
    export FLYCTL_INSTALL="$HOME/.fly"
    export PATH="$FLYCTL_INSTALL/bin:$PATH"
  }
  fly auth whoami >/dev/null 2>&1 || fly auth login

  say "إنشاء Postgres"
  fly postgres create --name enjoymilk-db --region fra --vm-size shared-cpu-1x --volume-size 1 || true

  say "إنشاء API app + secrets"
  fly apps create enjoymilk-api 2>/dev/null || true
  fly postgres attach enjoymilk-db --app enjoymilk-api 2>/dev/null || true
  JWT=$(gen_secret); JWT_REF=$(gen_secret)
  fly secrets set JWT_SECRET="$JWT" JWT_REFRESH_SECRET="$JWT_REF" JWT_EXPIRES_IN=15m \
    NODE_ENV=production --app enjoymilk-api

  fly deploy --config fly.api.toml --remote-only

  say "إنشاء Web app"
  fly apps create enjoymilk-web 2>/dev/null || true
  fly deploy --config fly.web.toml --remote-only

  ok "تم النشر!"
  echo "  📊 Web:  https://enjoymilk-web.fly.dev"
  echo "  🔌 API:  https://enjoymilk-api.fly.dev"
}

# ─── RENDER ───
deploy_render() {
  say "Render Deployment"
  echo "Render لا يدعم CLI كامل — استخدم Blueprint:"
  echo "  1. ادفع المشروع لـ GitHub"
  echo "  2. اذهب لـ https://dashboard.render.com/blueprints"
  echo "  3. اختر 'New Blueprint Instance' وأشر إلى الـ repo"
  echo "  4. Render سيقرأ render.yaml تلقائياً وينشر كل شيء"
  open https://dashboard.render.com/blueprints 2>/dev/null || true
}

# ─── Main dispatch ───
case "$TARGET" in
  local)   deploy_local   ;;
  railway) deploy_railway ;;
  fly)     deploy_fly     ;;
  render)  deploy_render  ;;
  *) err "Unknown target: $TARGET. استخدم: local | railway | fly | render" ;;
esac
