# 🚀 التشغيل السريع — Enjoy Milk ERP

## ✅ المتطلبات

```bash
node --version    # v20+
pnpm --version    # v8+
docker --version  # v24+
```

> إذا غير مثبتة: `npm install -g pnpm@8` و [Docker Desktop](https://www.docker.com/products/docker-desktop/)

---

## 🏃 التشغيل (5 أوامر)

```bash
# 1. الدخول للمشروع
cd enjoy-milk-erp

# 2. نسخ ملف البيئة
cp .env.example .env

# 3. تثبيت المكتبات
pnpm install

# 4. تشغيل قاعدة البيانات
docker compose up -d

# 5. إعداد قاعدة البيانات + بيانات أولية
pnpm prisma:generate
pnpm prisma:migrate
pnpm prisma:seed

# 6. تشغيل النظام
pnpm dev
```

افتح المتصفح:
- **التطبيق**: http://localhost:3000
- **API**: http://localhost:3001
- **Swagger**: http://localhost:3001/api/docs
- **Adminer DB GUI**: http://localhost:8080

## 🔐 تسجيل الدخول

| الدور | البريد | كلمة السر |
|---|---|---|
| المسؤول | `admin@enjoymilk.local` | `Admin@123` |
| المالك | `owner@enjoymilk.local` | `Admin@123` |
| المدير | `manager@enjoymilk.local` | `Admin@123` |
| المستودع | `warehouse@enjoymilk.local` | `Admin@123` |
| المحاسب | `accountant@enjoymilk.local` | `Admin@123` |
| العامل | `operator@enjoymilk.local` | `Admin@123` |

---

## ✨ ما يمكنك فعله الآن

### 📊 لوحة التحكم
- KPIs لحظية: الإنتاج، الكاش، الحضور، المخزون
- تحديث تلقائي كل دقيقة

### 📦 المخزون
- إضافة أصناف جديدة (POWDER_BULK / PACKAGING / POWDER_RETAIL)
- تعديل وحذف
- البحث بالاسم أو SKU
- تنبيهات المخزون المنخفض

### ⚡ التعبئة (Quick Entry)
- شاشة إدخال سريعة للعمال
- 3 حقول فقط: المعبّأ + الهدر + العطل
- Numeric pad كبير
- يعمل ممتاز على الهاتف

### 💼 العملاء
- CRUD كامل
- 4 أنواع: تجزئة / جملة / موزع / مؤسسة
- حد ائتمان
- متبقي على كل عميل

### 💰 المالية
- صناديق متعددة
- شيكات (مستلمة/صادرة) مع 5 حالات
- مصاريف
- ملخص يومي

### 👥 الموظفون
- إدارة كاملة
- تسجيل حضور وانصراف بنقرة
- إحصائيات يومية

### 📋 الرخص
- تتبع تاريخ الانتهاء
- تنبيهات قبل 30 يوم
- 4 رخص في seed: السجل التجاري، الزراعة، HACCP، حلال

---

## 🔧 الأوامر الإضافية

```bash
# Prisma Studio (GUI لقاعدة البيانات)
pnpm prisma:studio
# http://localhost:5555

# إعادة تعيين قاعدة البيانات
docker compose down -v
docker compose up -d
pnpm prisma:migrate
pnpm prisma:seed

# Build للإنتاج
pnpm build

# تشغيل الإنتاج
pnpm --filter api start
pnpm --filter web start
```

---

## 🐛 مشاكل شائعة

### "Database connection refused"
تأكد أن Postgres شغال:
```bash
docker compose ps
docker compose logs postgres
```

### "Cannot find module @prisma/client"
```bash
pnpm prisma:generate
```

### Port مستخدم
عدّل `.env`:
- `PORT=3002` للـ API
- في `apps/web/package.json`: غير `3000` لرقم آخر

---

## 📁 بنية المشروع

```
enjoy-milk-erp/
├── apps/
│   ├── api/          ← NestJS (Port 3001)
│   └── web/          ← Next.js (Port 3000)
├── prisma/
│   ├── schema.prisma ← قاعدة البيانات
│   └── seed.ts       ← بيانات أولية
├── docker-compose.yml
└── .env
```

---

> **النسخة:** 1.0.0 — جاهز للاستخدام ✅
