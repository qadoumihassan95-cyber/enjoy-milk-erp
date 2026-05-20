# نشر Enjoy Milk ERP على Render + Telegram Bot

> الكود جاهز Production. كل القيم الحسّاسة عبر Environment Variables. النشر عبر Docker + Blueprint.

---

## 1) الملفات النهائية الجاهزة

| الملف | الدور |
|---|---|
| `render.yaml` | Blueprint كامل (DB + API + Web + كل المتغيرات) |
| `apps/api/Dockerfile` | بناء الـ API — يطبّق الـ migrations عند الإقلاع |
| `apps/web/Dockerfile` | بناء الـ Web (Next.js standalone) |
| `apps/api/src/modules/telegram/*` | بوت Telegram (webhook + أوامر) |
| `apps/api/src/main.ts` | PORT + graceful shutdown + معالجة أخطاء عامة |
| `.env.example` | كل المتغيرات الموثّقة |

## 2) أبرز تعديلات الكود

- بُنيت وحدة Telegram كاملة: `webhook` عام محمي بسرّ في الرأس + أوامر `/production /stock /orders /balance /help`.
- `main.ts`: `enableShutdownHooks()` + `trust proxy` + التقاط `unhandledRejection`/`uncaughtException` + كتم سجلات debug في الإنتاج.
- `Dockerfile (api)`: أبقينا `prisma` CLI في صورة التشغيل ليعمل `migrate deploy` عند الإقلاع (كان سيسقط بعد حذف dev deps).
- إزالة كلمة المرور الافتراضية من شاشة الدخول.
- تسجيل الـ webhook تلقائياً عبر `RENDER_EXTERNAL_URL` (بدون إعداد يدوي).

## 3) Build Command

النشر عبر **Docker** — Render يبنيها من الـ Dockerfile تلقائياً، لا حاجة لأمر بناء يدوي.
أمر البناء داخلياً:
```
docker build -f apps/api/Dockerfile -t enjoymilk-api .
docker build -f apps/web/Dockerfile -t enjoymilk-web .
```

## 4) Start Command

معرّف داخل الـ Dockerfile (`CMD`):
```
# API:
sh -c "node node_modules/prisma/build/index.js migrate deploy --schema=./prisma/schema.prisma && node apps/api/dist/main.js"
# Web:
node apps/web/server.js
```

## 5) Environment Variables المطلوبة

### خدمة الـ API (`enjoymilk-api`)
| المتغيّر | المصدر |
|---|---|
| `DATABASE_URL` | تلقائي من قاعدة Render |
| `JWT_SECRET` | تلقائي (generateValue) |
| `JWT_REFRESH_SECRET` | تلقائي (generateValue) |
| `JWT_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `NODE_ENV` | `production` |
| `APP_URL` | **يدوي** ← رابط الـ web بعد نشره |
| `TELEGRAM_BOT_TOKEN` | **يدوي** ← من @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | تلقائي (generateValue) |
| `TELEGRAM_ALLOWED_CHAT_IDS` | **يدوي** (اختياري) معرّفات مفصولة بفواصل |
| `RENDER_EXTERNAL_URL` | يحقنه Render تلقائياً (لا تضفه) |

### خدمة الـ Web (`enjoymilk-web`)
| المتغيّر | المصدر |
|---|---|
| `NODE_ENV` | `production` |
| `NEXT_PUBLIC_API_URL` | **يدوي** ← رابط الـ api بعد نشره |

## 6) رابط الـ Webhook النهائي

```
https://enjoymilk-api.onrender.com/api/telegram/webhook
```
يُسجَّل **تلقائياً** عند إقلاع الـ API (يستخدم `RENDER_EXTERNAL_URL`).
للتسجيل اليدوي عند الحاجة: افتح (وأنت مسجّل دخول كمسؤول) `GET /api/telegram/setup`.
للتحقق: `GET /api/telegram/info`.

## 7) خطوات النشر النهائية

1. ادفع الكود إلى GitHub:
   ```bash
   cd enjoy-milk-erp
   git add -A && git commit -m "deploy: render + telegram"
   git push origin main
   ```
2. Render → **New** → **Blueprint** → اختر الـ repo → سيقرأ `render.yaml` ويُنشئ: قاعدة + api + web.
3. انتظر أول نشر، ثم اضبط المتغيّرات اليدوية:
   - في **enjoymilk-web** → `NEXT_PUBLIC_API_URL` = رابط الـ api (مثال: `https://enjoymilk-api.onrender.com`) ثم **Manual Deploy**.
   - في **enjoymilk-api** → `APP_URL` = رابط الـ web (مثال: `https://enjoymilk-web.onrender.com`).
   - في **enjoymilk-api** → `TELEGRAM_BOT_TOKEN` = توكن البوت.
4. شغّل البذور **مرّة واحدة** (Shell الخاص بخدمة enjoymilk-api):
   ```bash
   pnpm --filter api prisma:seed
   ```
   ينشئ مستخدم الدخول: `admin@enjoymilk.local` / `Admin@123` (غيّرها بعد أول دخول).
5. افتح رابط الـ web وسجّل الدخول. راسل البوت بـ `/start`.

## 8) المفاتيح/التوكنات التي تحتاج إضافتها أنت فقط

| المفتاح | من أين |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather على Telegram → `/newbot` |
| `TELEGRAM_ALLOWED_CHAT_IDS` | راسل البوت بأي رسالة بعد النشر — سيرد بمعرّف دردشتك، أضفه هنا |
| `APP_URL` | رابط الـ web من Render بعد النشر |
| `NEXT_PUBLIC_API_URL` | رابط الـ api من Render بعد النشر |

> كل ما عدا ذلك (DATABASE_URL, JWT secrets, TELEGRAM_WEBHOOK_SECRET) يولّده/يربطه Render تلقائياً.

---

### ملاحظات الاستقرار 24/7
- الـ API يطبّق الـ migrations عند كل إقلاع → القاعدة دائماً محدّثة.
- `enableShutdownHooks` + `tini` → إعادة تشغيل نظيفة بلا تسريب اتصالات.
- `/health` يفحص قاعدة البيانات → Render يعيد التشغيل تلقائياً عند التعطّل.
- البوت يعمل بنمط webhook (لا polling) → استهلاك موارد أقل وأكثر استقراراً.
- خطة Render المجانية تُنيم الخدمة عند الخمول؛ للتشغيل الدائم 24/7 بلا نوم رقّ الخدمتين إلى خطة Starter.
