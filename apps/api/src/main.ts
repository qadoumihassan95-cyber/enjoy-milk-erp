import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';

  // قائمة العناوين المسموح لها (CORS)
  const allowedOrigins = (process.env.APP_URL?.split(',').map((s) => s.trim()) ?? [
    'http://localhost:3000',
  ]).filter(Boolean);

  const app = await NestFactory.create(AppModule, {
    // مستويات السجل: في الإنتاج نخفي debug/verbose لتقليل الضوضاء
    logger: isProd
      ? ['log', 'warn', 'error']
      : ['log', 'warn', 'error', 'debug', 'verbose'],
    cors: {
      // نقبل: العناوين المضبوطة + localhost + أي نطاق onrender.com (الـ API محمي بـ JWT)
      origin: (origin, callback) => {
        if (
          !origin ||
          allowedOrigins.includes(origin) ||
          /^https:\/\/[a-z0-9-]+\.onrender\.com$/i.test(origin) ||
          /^http:\/\/localhost:\d+$/i.test(origin)
        ) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
    },
  });

  // Render/أي بروكسي عكسي أمام التطبيق — نثق بالـ X-Forwarded-* headers
  try {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  } catch {
    /* غير حرج إذا لم يكن المحرّك Express */
  }

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('api', { exclude: ['health'] });

  // إغلاق نظيف عند استلام SIGTERM/SIGINT (مهم لإعادة التشغيل على Render)
  app.enableShutdownHooks();

  // Swagger — في غير الإنتاج فقط
  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('Enjoy Milk ERP API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = parseInt(process.env.PORT || '3001', 10);
  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`🥛 Enjoy Milk API listening on port ${port} (${process.env.NODE_ENV ?? 'development'})`);
  if (!isProd) logger.log(`📚 Swagger: http://localhost:${port}/api/docs`);
}

bootstrap().catch((err) => {
  // أعلى مستوى من معالجة الأخطاء — يضمن سجلاً واضحاً قبل الخروج
  // eslint-disable-next-line no-console
  console.error('❌ Bootstrap failed:', err);
  process.exit(1);
});

// شبكة أمان لأي خطأ غير مُلتقَط — نسجّله بدل أن يسقط التطبيق صامتاً
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('⚠️ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('⚠️ Uncaught Exception:', err);
});
