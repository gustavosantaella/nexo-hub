import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/** Loguea metodo, ruta, status y duracion de cada peticion HTTP. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url } = request;
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - startedAt;
          const status = context.switchToHttp().getResponse().statusCode;
          this.logger.log(`${method} ${url} ${status} - ${ms}ms`);
        },
        error: (err: unknown) => {
          const ms = Date.now() - startedAt;
          const status =
            typeof err === 'object' && err !== null && 'status' in err
              ? (err as { status: number }).status
              : 500;
          this.logger.warn(`${method} ${url} ${status} - ${ms}ms (error)`);
        },
      }),
    );
  }
}
