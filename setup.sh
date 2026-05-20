#!/bin/bash
# =============================================================================
# Enjoy Milk ERP — Auto Setup Script
# يشغّل كل شيء بأمر واحد
# =============================================================================

set -e  # توقف عند أي خطأ

# ألوان
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# دالة طباعة الخطوات
step() {
  echo ""
  echo -e "${BLUE}▶ $1${NC}"
  echo -e "${BLUE}───────────────────────────────────────────${NC}"
}

ok() { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
err() { echo -e "${RED}✗ $1${NC}"; exit 1; }

# Banner
clear
echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════╗"
echo "║      🥛  Enjoy Milk ERP — Setup           ║"
echo "║         إعداد تلقائي شامل                ║"
echo "╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# ─── 1. التحقق من المتطلبات ───
step "1/7 التحقق من المتطلبات"

command -v node >/dev/null 2>&1 || err "Node.js غير مثبت. حمّله من https://nodejs.org/"
command -v pnpm >/dev/null 2>&1 || {
  warn "pnpm غير مثبت — جاري التثبيت..."
  npm install -g pnpm@8
}
command -v docker >/dev/null 2>&1 || err "Docker غير مثبت. حمّل Docker Desktop"

if ! docker info >/dev/null 2>&1; then
  err "Docker غير شغّال. افتح Docker Desktop وانتظر حتى يبدأ"
fi

ok "Node.js: $(node -v)"
ok "pnpm: $(pnpm -v)"
ok "Docker شغّال"

# ─── 2. ملف البيئة ───
step "2/7 إعداد ملف البيئة"
if [ ! -f .env ]; then
  cp .env.example .env
  ok "تم إنشاء .env"
else
  ok ".env موجود"
fi

# ─── 3. تثبيت الـ packages ───
step "3/7 تثبيت المكتبات (قد يأخذ 2-5 دقائق)"
pnpm install
ok "تم تثبيت المكتبات"

# ─── 4. تشغيل Postgres + Redis ───
step "4/7 تشغيل قاعدة البيانات"
docker compose up -d
ok "Postgres و Redis شغّالين"

# انتظر حتى يجهز Postgres
echo -n "  ⏳ انتظار جاهزية Postgres "
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
    echo " ✓"
    break
  fi
  echo -n "."
  sleep 1
done

# ─── 5. Prisma ───
step "5/7 إنشاء جداول قاعدة البيانات"
pnpm --filter api prisma:generate
ok "تم توليد Prisma Client"

pnpm --filter api prisma migrate deploy --schema=../../prisma/schema.prisma 2>/dev/null || \
pnpm --filter api exec prisma migrate dev --name init --schema=../../prisma/schema.prisma --skip-seed
ok "تم إنشاء الجداول"

# ─── 6. Seed ───
step "6/7 إدخال البيانات الأولية"
pnpm --filter api prisma:seed
ok "تم إدخال البيانات"

# ─── 7. الانتهاء ───
step "7/7 جاهز!"
ok "كل شيء جاهز للتشغيل"

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         ✓ الإعداد اكتمل بنجاح              ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}الآن شغّل النظام بـ:${NC}"
echo ""
echo -e "  ${YELLOW}pnpm dev${NC}"
echo ""
echo -e "${BLUE}ثم افتح المتصفح:${NC}"
echo ""
echo "  📊 التطبيق:    http://localhost:3000"
echo "  🔌 الـ API:     http://localhost:3001"
echo "  🗄  قاعدة البيانات: http://localhost:8080"
echo ""
echo -e "${BLUE}بيانات الدخول:${NC}"
echo ""
echo "  📧 admin@enjoymilk.local"
echo "  🔑 Admin@123"
echo ""
