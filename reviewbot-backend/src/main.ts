import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false, // We'll configure body parser manually
  });

  // Configure body parser with size limit (10MB). The `verify` callback
  // captures the raw request body so the GitHub webhook guard can compute
  // an HMAC signature over it (GitHub signs the raw bytes, not the parsed
  // JSON, so this can't be reconstructed after parsing).
  app.use(
    express.json({
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Enable CORS for frontend with strict origin validation
  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl && process.env.NODE_ENV === 'production') {
    throw new Error('FRONTEND_URL must be set in production');
  }

  app.enableCors({
    origin: frontendUrl || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Hub-Signature-256', 'X-GitHub-Event'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip unknown properties
      transform: true, // Auto-transform payloads to DTO instances
      forbidNonWhitelisted: true, // Throw error if unknown properties
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger API documentation
  const config = new DocumentBuilder()
    .setTitle('Code Buddy API')
    .setDescription('GitHub Code Review Bot - AI-powered code review automation with Gemini')
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Enter JWT token from /api/auth/login endpoint',
    })
    .addTag('Authentication', 'Admin authentication endpoints')
    .addTag('Projects', 'GitHub repository management')
    .addTag('Reviews', 'Code review queries and statistics')
    .addTag('Developers', 'Developer performance and leaderboard')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true, // Keep JWT token after page refresh
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: 'Code Buddy API Documentation',
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`✓ Code Buddy Backend running on http://localhost:${port}`);
  console.log(`✓ API Documentation: http://localhost:${port}/api/docs`);
}
bootstrap();
