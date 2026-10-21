import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import path from 'path';
import * as express from 'express';

/**
 * Tamano maximo del cuerpo JSON. Las imagenes viajan por multipart
 * (`POST /api/media/upload`), no dentro del JSON.
 */
const BODY_LIMIT = '25mb';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  // El parser por defecto se desactiva para poder ajustar el limite: importar
  // un catalogo JSON puede superar los 100 KB por defecto de Express. Las fotos
  // ya no viajan en el JSON: se suben aparte por multipart.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT });

  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 3000;
  const apiPrefix = config.get<string>('apiPrefix') ?? 'api';
  const corsOrigins = config.get<string[]>('corsOrigins') ?? [];
  const isProduction = config.get<boolean>('isProduction') ?? false;

  app.setGlobalPrefix(apiPrefix);

  // helmet protege las cabeceras; en desarrollo se desactiva el CSP para que
  // Swagger UI pueda cargar sus scripts.
  app.use(
    helmet({
      contentSecurityPolicy: isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
      // Las fotos se sirven desde `/media`: el front puede estar en otro origen
      // (por ejemplo `localhost:4200` con el proxy de Angular).
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Nexo Hub API')
    .setDescription(
      'API de gestion para restaurante / bodega / local: caja, inventario, ' +
      'pedidos, cuentas por cobrar y pagar, gastos y estadisticas.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
  app.use('/public', express.static(path.join(process.cwd(), 'public')));

  // Imagenes locales (productos, menus, logos y comprobantes de pago). Se
  // guardan en `private/img` y se publican solo por este prefijo estatico; la
  // base de datos guarda la URL relativa (`/media/<rif>/<carpeta>/<archivo>`).
  const mediaRoot =
    config.get<string>('media.root') ?? path.join(process.cwd(), 'private', 'img');
  app.use(
    '/media',
    express.static(mediaRoot, {
      maxAge: '30d',
      setHeaders: (res) => {
        // El front de desarrollo corre en otro puerto; sin esta cabecera el
        // navegador bloquea la imagen al pintarla desde el POS.
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cache-Control', 'public, max-age=2592000');
      },
    }),
  );

  await app.listen(port);
  logger.log(`API escuchando en http://localhost:${port}/${apiPrefix}`);
  logger.log(`Documentacion en http://localhost:${port}/${apiPrefix}/docs`);
}

void bootstrap();
