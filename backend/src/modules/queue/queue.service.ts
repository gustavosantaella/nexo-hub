import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { PrismaClientLike } from '../../prisma/prisma.service';
import {
  JobStatus,
  QueueRepository,
  type BackgroundJobRow,
} from './queue.repository';

/** Cada cuanto el worker busca trabajos nuevos. */
const POLL_INTERVAL_MS = 500;
/** Un RUNNING mas viejo que esto se considera huerfano (proceso caido). */
const STALE_LOCK_MS = 5 * 60 * 1000;
/** Backoff exponencial acotado entre reintentos. */
const MAX_RETRY_DELAY_MS = 60 * 1000;

export interface EnqueueJobInput {
  companyId?: string | null;
  type: string;
  payload: unknown;
  maxAttempts?: number;
  /** Retraso inicial antes del primer intento. */
  delayMs?: number;
}

export interface JobContext {
  id: string;
  companyId: string | null;
  type: string;
  attempt: number;
  maxAttempts: number;
  /** Payload ya decodificado (undefined si el JSON era invalido). */
  payload: unknown;
}

export type JobHandler = (payload: unknown, context: JobContext) => Promise<void>;

export interface JobDefinition {
  handler: JobHandler;
  /**
   * Se ejecuta solo cuando se agotan los intentos. Los errores de negocio
   * (por ejemplo, un cobro invalido) llegan aqui para deshacer el estado
   * temporal del pedido.
   */
  onFailed?: (error: unknown, context: JobContext) => Promise<void> | void;
}

/**
 * Error de un trabajo que no debe reintentarse (datos invalidos, recurso
 * inexistente). Los errores tecnicos/transitorios si se reintentan.
 */
export class NonRetryableJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableJobError';
  }
}

/**
 * Cola de trabajos persistente respaldada por SQLite/Prisma.
 *
 * El productor solo inserta un `BackgroundJob` y responde; este servicio lo
 * reclama con un `updateMany` condicionado (un unico worker por fila), ejecuta
 * el handler registrado y registra el resultado. Los reintentos quedan en la
 * misma base de datos, asi que un reinicio no pierde cobros pendientes.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly handlers = new Map<string, JobDefinition>();
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private stopping = false;

  constructor(private readonly queue: QueueRepository) {}

  onModuleInit(): void {
    this.stopping = false;
    void this.recoverStale();
    this.timer = setInterval(() => {
      void this.drain();
    }, POLL_INTERVAL_MS);
    // No mantiene vivo el proceso por si solo (tests, scripts, apagado).
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Registra el handler de un tipo de trabajo (se llama una vez por modulo). */
  register(type: string, definition: JobDefinition): void {
    if (this.handlers.has(type)) {
      throw new Error(`Ya hay un handler registrado para el trabajo ${type}`);
    }
    this.handlers.set(type, definition);
  }

  /**
   * Inserta un trabajo. Dentro de una transaccion (`tx`) no despierta al worker:
   * el llamador debe invocar `wake()` despues del commit para no leer una fila
   * que aun no existe.
   */
  async enqueue(input: EnqueueJobInput, tx?: PrismaClientLike): Promise<string> {
    const job = await this.queue.create(
      {
        companyId: input.companyId ?? null,
        type: input.type,
        payload: JSON.stringify(input.payload),
        maxAttempts: input.maxAttempts ?? 3,
        availableAt: new Date(Date.now() + Math.max(0, input.delayMs ?? 0)),
      },
      tx,
    );
    if (!tx) this.wake();
    return job.id;
  }

  /** Dispara un ciclo sin esperar al intervalo (no bloquea al llamador). */
  wake(): void {
    void this.drain();
  }

  /**
   * Procesa los trabajos disponibles hasta vaciar la cola. Es publico para que
   * las pruebas y los scripts puedan ejecutar un ciclo deterministico.
   */
  async drain(): Promise<number> {
    if (this.draining || this.stopping) return 0;
    this.draining = true;
    let processed = 0;
    try {
      while (!this.stopping) {
        const job = await this.claimNext();
        if (!job) break;
        await this.run(job);
        processed += 1;
      }
    } catch (error) {
      this.logger.error(
        `La cola no pudo leer trabajos: ${this.errorText(error)}`,
      );
    } finally {
      this.draining = false;
    }
    return processed;
  }

  private async claimNext(): Promise<BackgroundJobRow | null> {
    const now = new Date();
    const candidate = await this.queue.findNextReady(now);
    if (!candidate) return null;
    const claimed = await this.queue.claim(candidate.id, now);
    if (claimed.count === 0) return null;
    return this.queue.findById(candidate.id);
  }

  private async run(job: BackgroundJobRow): Promise<void> {
    let payload: unknown;
    try {
      payload = JSON.parse(job.payload);
    } catch (error) {
      await this.fail(job, this.contextOf(job, undefined), error);
      return;
    }

    const context = this.contextOf(job, payload);
    const definition = this.handlers.get(job.type);
    if (!definition) {
      await this.fail(
        job,
        context,
        new Error(`No hay handler registrado para el trabajo ${job.type}`),
      );
      return;
    }

    try {
      await definition.handler(payload, context);
      await this.queue.markDone(job.id, new Date());
    } catch (error) {
      await this.handleError(job, context, error);
    }
  }

  private contextOf(job: BackgroundJobRow, payload: unknown): JobContext {
    return {
      id: job.id,
      companyId: job.companyId,
      type: job.type,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      payload,
    };
  }

  private async handleError(
    job: BackgroundJobRow,
    context: JobContext,
    error: unknown,
  ): Promise<void> {
    const message = this.errorText(error);
    const finalAttempt =
      error instanceof NonRetryableJobError || job.attempts >= job.maxAttempts;

    if (finalAttempt) {
      await this.fail(job, context, error);
      return;
    }

    const delay = Math.min(
      MAX_RETRY_DELAY_MS,
      1000 * 2 ** Math.max(0, job.attempts - 1),
    );
    await this.queue.reschedule(job.id, new Date(Date.now() + delay), message);
    this.logger.warn(
      `Trabajo ${job.type} ${job.id} fallo (intento ${job.attempts}/${job.maxAttempts}); reintento en ${delay} ms: ${message}`,
    );
  }

  private async fail(
    job: BackgroundJobRow,
    context: JobContext,
    error: unknown,
  ): Promise<void> {
    const message = this.errorText(error).slice(0, 2000);
    await this.queue.markFailed(job.id, new Date(), message);
    this.logger.error(
      `Trabajo ${job.type} ${job.id} agoto sus intentos: ${message}`,
    );
    const definition = this.handlers.get(job.type);
    try {
      await definition?.onFailed?.(error, context);
    } catch (callbackError) {
      this.logger.error(
        `El rollback del trabajo ${job.id} fallo: ${this.errorText(callbackError)}`,
      );
    }
  }

  private async recoverStale(): Promise<void> {
    try {
      const result = await this.queue.recoverStale(
        new Date(Date.now() - STALE_LOCK_MS),
      );
      if (result.count > 0) {
        this.logger.warn(
          `Se recuperaron ${result.count} trabajo(s) que quedaron a medias`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudieron recuperar trabajos huerfanos: ${this.errorText(error)}`,
      );
    }
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

export { JobStatus };
