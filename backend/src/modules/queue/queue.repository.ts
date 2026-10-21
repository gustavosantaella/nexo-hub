import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';

/** Estados de un trabajo persistente. */
export const JobStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export interface CreateBackgroundJob {
  companyId?: string | null;
  type: string;
  payload: string;
  maxAttempts: number;
  availableAt?: Date;
}

export type BackgroundJobRow = Prisma.BackgroundJobGetPayload<Record<string, never>>;

/**
 * Acceso a datos de la cola. Toda la interaccion con Prisma de la cola vive aqui
 * para que el servicio conserve el control de reintentos y tiempos.
 */
@Injectable()
export class QueueRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: PrismaClientLike): PrismaClientLike {
    return tx ?? this.prisma;
  }

  create(data: CreateBackgroundJob, tx?: PrismaClientLike) {
    return this.client(tx).backgroundJob.create({ data });
  }

  /** Primer trabajo pendiente cuya hora de ejecucion ya llego. */
  findNextReady(now: Date) {
    return this.prisma.backgroundJob.findFirst({
      where: {
        status: JobStatus.PENDING,
        availableAt: { lte: now },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Toma el trabajo con un update condicionado por `PENDING`. Si otro worker se
   * adelanto, `count` es 0 y este proceso no lo ejecuta.
   */
  claim(id: string, now: Date) {
    return this.prisma.backgroundJob.updateMany({
      where: { id, status: JobStatus.PENDING },
      data: {
        status: JobStatus.RUNNING,
        lockedAt: now,
        attempts: { increment: 1 },
      },
    });
  }

  findById(id: string) {
    return this.prisma.backgroundJob.findUnique({ where: { id } });
  }

  markDone(id: string, now: Date) {
    return this.prisma.backgroundJob.updateMany({
      where: { id, status: JobStatus.RUNNING },
      data: {
        status: JobStatus.DONE,
        lockedAt: null,
        lastError: null,
        finishedAt: now,
      },
    });
  }

  /** Devuelve el trabajo a la cola para el siguiente intento. */
  reschedule(id: string, availableAt: Date, error: string) {
    return this.prisma.backgroundJob.updateMany({
      where: { id, status: JobStatus.RUNNING },
      data: {
        status: JobStatus.PENDING,
        availableAt,
        lockedAt: null,
        lastError: error,
      },
    });
  }

  markFailed(id: string, now: Date, error: string) {
    return this.prisma.backgroundJob.updateMany({
      where: { id, status: JobStatus.RUNNING },
      data: {
        status: JobStatus.FAILED,
        lockedAt: null,
        lastError: error,
        finishedAt: now,
      },
    });
  }

  /**
   * Recupera trabajos que quedaron en RUNNING porque el proceso se cayo antes
   * de terminarlos. Se vuelven a poner en cola para que otro worker los tome.
   */
  recoverStale(lockedBefore: Date) {
    return this.prisma.backgroundJob.updateMany({
      where: {
        status: JobStatus.RUNNING,
        OR: [{ lockedAt: null }, { lockedAt: { lt: lockedBefore } }],
      },
      data: {
        status: JobStatus.PENDING,
        lockedAt: null,
        availableAt: new Date(),
      },
    });
  }
}
