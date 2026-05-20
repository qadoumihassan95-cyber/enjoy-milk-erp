# 🚀 Deploy Online — اختر منصة واحدة

النظام جاهز للنشر. اختر الأنسب لك:

| المنصة | التكلفة | السرعة | مناسب لـ |
|---|---|---|---|
| **Local Docker** | مجاناً | 5 دقائق | اختبار النسخة الإنتاجية |
| **Railway** ⭐ | $5/شهر | 10 دقائق | **الأسرع — موصى به** |
| **Fly.io** | $5/شهر | 15 دقيقة | تحكم كامل + قرب جغرافي |
| **Render** | مجاناً (مع حدود) | 20 دقيقة | إعداد بدون CLI |

---

## ⭐ الخيار الموصى به: Railway (10 دقائق)

### الخطوة 1: ادفع المشروع إلى GitHub

```bash
cd "/Users/hassankhaledalnatour/Documents/Claude/Projects/قصراوي اخوان/enjoy-milk-erp"
git init
git add .
git commit -m "Initial commit - Enjoy Milk ERP"
gh repo create enjoy-milk-erp --private --source=. --push
```

(لو `gh` غير مثبت: `brew install gh && gh auth login`)

### الخطوة 2: انشر بأمر واحد

```bash
./deploy.sh railway
```

السكربت سيقوم بـ:
1. تثبيت Railway CLI
2. تسجيل الدخول (سيفتح المتصفح)
3. ربط المشروع
4. إضافة PostgreSQL
5. توليد JWT secrets قوية تلقائياً
6. نشر API + Web
7. إعطاؤك الـ URL النهائي

النتيجة:
```
✓ API نُشر:  https://enjoymilk-api.up.railway.app
✓ Web نُشر:  https://enjoymilk-web.up.railway.app
```

---

## 🐳 الخيار 1: Local Docker (للاختبار)

```bash
cd "/Users/hassankhaledalnatour/Documents/Claude/Projects/قصراوي اخوان/enjoy-milk-erp"
./deploy.sh local
```

افتح: **http://localhost:3000**

---

## 🛫 الخيار 2: Fly.io

```bash
cd "/Users/hassankhaledalnatour/Documents/Claude/Projects/قصراوي اخوان/enjoy-milk-erp"
./deploy.sh fly
```

السكربت سيقوم بـ:
1. تثبيت Fly CLI (إذا غير مثبت)
2. تسجيل الدخول
3. إنشاء PostgreSQL
4. نشر API + Web في منطقة Frankfurt (أقرب للأردن)

النتيجة:
```
✓ Web:  https://enjoymilk-web.fly.dev
✓ API:  https://enjoymilk-api.fly.dev
```

---

## 🎨 الخيار 3: Render (بدون CLI)

```bash
./deploy.sh render
```

سيفتح Render Dashboard. اربط GitHub repo، Render سيقرأ `render.yaml` وينشر كل شيء.

---

## 🔑 بعد النشر

سجّل دخول بـ:
- البريد: `admin@enjoymilk.local`
- كلمة السر: `Admin@123`

**⚠️ مهم**: غيّر كلمة السر فوراً من Settings.

---

## 🛠️ Migration + Seed على Production

**Railway:**
```bash
railway run --service api node node_modules/prisma/build/index.js migrate deploy --schema=./prisma/schema.prisma
railway run --service api node -r ts-node/register prisma/seed.ts
```

**Fly.io:**
```bash
fly ssh console --app enjoymilk-api
$ node node_modules/prisma/build/index.js migrate deploy --schema=./prisma/schema.prisma
$ node -r ts-node/register prisma/seed.ts
```

**Local Docker:**
```bash
docker compose -f docker-compose.prod.yml exec api node node_modules/prisma/build/index.js migrate deploy --schema=./prisma/schema.prisma
docker compose -f docker-compose.prod.yml exec api node -r ts-node/register prisma/seed.ts
```

---

## 🆘 إذا فشل النشر

اعرض الـ logs:
- **Railway:** `railway logs --service api`
- **Fly:** `fly logs --app enjoymilk-api`
- **Render:** من Dashboard → Logs

أرسل لي الـ error وسأحلّه.

---

## 📝 ما الذي أنشأناه

```
enjoy-milk-erp/
├── apps/api/Dockerfile          ← Multi-stage build للـ API
├── apps/web/Dockerfile          ← Next.js standalone
├── docker-compose.prod.yml      ← Stack كامل (DB + API + Web)
├── railway.json                 ← Railway config
├── fly.api.toml                 ← Fly.io للـ API
├── fly.web.toml                 ← Fly.io للـ Web
├── render.yaml                  ← Render Blueprint
├── vercel.json                  ← Vercel للـ Web فقط
├── .env.prod.example            ← متغيرات الإنتاج
├── deploy.sh                    ← سكربت نشر واحد
└── DEPLOY.md                    ← هذا الملف
```
