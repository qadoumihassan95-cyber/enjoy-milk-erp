# 🥛 Enjoy Milk ERP

> نظام إدارة سحابي لمصنع تعبئة وتغليف حليب البودرة.

---

## ✅ ما يحتويه هذا المشروع

- **Backend**: NestJS + Prisma + PostgreSQL + JWT
- **Frontend**: Next.js 14 + Tailwind + shadcn/ui + RTL عربي
- **CRUD كامل** لـ: المخزون، الإنتاج، العملاء، الموظفين، الصندوق، الشيكات، الرخص
- **Authentication**: JWT + Refresh Tokens
- **Dashboard** تنفيذي مع KPIs لحظية
- **Quick Entry** للعمال (3 حقول فقط)
- **Mobile First** + PWA Ready

---

## 🚀 التشغيل في 5 دقائق

### 1) المتطلبات

تأكد من تثبيت:

```bash
node --version    # v20+
pnpm --version    # v8+
docker --version  # v24+
```

### 2) الإعداد

```bash
# في مجلد المشروع
cd enjoy-milk-erp

# نسخ متغيرات البيئة
cp .env.example .env

# تثبيت المكتبات
pnpm install
```

### 3) تشغيل قاعدة البيانات

```bash
docker compose up -d postgres redis
```

### 4) تطبيق Prisma

```bash
# توليد Prisma Client
pnpm prisma:generate

# إنشاء قاعدة البيانات والجداول
pnpm prisma:migrate

# إدخال البيانات الأولية (مستخدم admin، أصناف، إلخ)
pnpm prisma:seed
```

### 5) تشغيل النظام

```bash
pnpm dev
```

سيتم تشغيل:
- **API**: http://localhost:3001 (Swagger: http://localhost:3001/api/docs)
- **Web**: http://localhost:3000
- **Adminer** (DB UI): http://localhost:8080  (Server: postgres, User: postgres, Pass: postgres, DB: enjoymilk)

### 6) تسجيل الدخول

افتح http://localhost:3000 واستخدم:

```
البريد:    admin@enjoymilk.local
كلمة السر: Admin@123
```

---

## 📁 بنية المشروع

```
enjoy-milk-erp/
├── apps/
│   ├── api/              ← NestJS Backend
│   │   └── src/
│   │       ├── core/     ← Auth, Prisma
│   │       ├── modules/  ← Inventory, Repack, Dashboard, ...
│   │       └── common/   ← Filters, Pipes
│   └── web/              ← Next.js Frontend
│       ├── app/          ← Pages (App Router)
│       ├── components/   ← UI components
│       └── lib/          ← Utilities, API client
├── prisma/
│   ├── schema.prisma     ← Database schema
│   └── seed.ts           ← Initial data
├── docker-compose.yml    ← Postgres + Redis
└── .env.example
```

---

## 🛠️ الأوامر الأساسية

```bash
pnpm dev                  # تشغيل API + Web بالتوازي
pnpm prisma:studio        # واجهة GUI لقاعدة البيانات
pnpm prisma:migrate       # تطبيق migrations جديدة
pnpm prisma:seed          # إعادة إدخال البيانات الأولية
pnpm build                # بناء الإصدار النهائي
```

---

## 🎯 الموديولات الجاهزة

| الموديول | الحالة | المسار |
|---|---|---|
| 🔐 Authentication | ✅ كامل | `/login` |
| 📊 Dashboard | ✅ كامل | `/dashboard` |
| 📦 Inventory CRUD | ✅ كامل | `/inventory` |
| ⚡ Quick Entry | ✅ كامل | `/repack/quick` |
| 🏭 Production | ✅ كامل | `/production` |
| 💼 Customers | ✅ كامل | `/customers` |
| 💰 Cashbox | ✅ كامل | `/finance` |
| 👥 Employees | ✅ كامل | `/hr` |

---

## 📝 الترخيص

نظام مغلق المصدر — لاستخدام مصنع قصراوي إخوان حصرياً.

**النسخة:** 1.0.0 · **آخر تحديث:** 10 مايو 2026
