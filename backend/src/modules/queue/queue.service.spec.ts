import type { BackgroundJobRow, QueueRepository } from './queue.repository';
import { QueueService, NonRetryableJobError } from './queue.service';

function job(overrides: Partial<BackgroundJobRow> = {}): BackgroundJobRow {
  return {
    id: 'job-1',
    companyId: 'company-1',
    type: 'TEST_JOB',
    payload: JSON.stringify({ value: 7 }),
    status: 'RUNNING',
    attempts: 1,
    maxAttempts: 3,
    availableAt: new Date(),
    lockedAt: new Date(),
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    finishedAt: null,
    ...overrides,
  } as BackgroundJobRow;
}

function createService() {
  const repo = {
    findNextReady: jest.fn(),
    claim: jest.fn(async () => ({ count: 1 })),
    findById: jest.fn(),
    markDone: jest.fn(async () => ({ count: 1 })),
    reschedule: jest.fn(async () => ({ count: 1 })),
    markFailed: jest.fn(async () => ({ count: 1 })),
    recoverStale: jest.fn(async () => ({ count: 0 })),
    create: jest.fn(),
  };
  const service = new QueueService(repo as unknown as QueueRepository);
  return { service, repo };
}

describe('QueueService', () => {
  it('reclama, ejecuta y marca terminado el trabajo', async () => {
    const { service, repo } = createService();
    const pending = job();
    repo.findNextReady
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(null);
    repo.findById.mockResolvedValue(pending);
    const handler = jest.fn(async () => undefined);
    service.register('TEST_JOB', { handler });

    const processed = await service.drain();

    expect(processed).toBe(1);
    expect(handler).toHaveBeenCalledWith(
      { value: 7 },
      expect.objectContaining({ id: 'job-1', attempt: 1 }),
    );
    expect(repo.markDone).toHaveBeenCalledWith('job-1', expect.any(Date));
    expect(repo.reschedule).not.toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('reintenta con espera cuando el error es transitorio', async () => {
    const { service, repo } = createService();
    const pending = job({ attempts: 1, maxAttempts: 3 });
    repo.findNextReady
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(null);
    repo.findById.mockResolvedValue(pending);
    service.register('TEST_JOB', {
      handler: jest.fn(async () => {
        throw new Error('base de datos ocupada');
      }),
    });

    await service.drain();

    expect(repo.reschedule).toHaveBeenCalledWith(
      'job-1',
      expect.any(Date),
      'base de datos ocupada',
    );
    expect(repo.markFailed).not.toHaveBeenCalled();
    expect(repo.markDone).not.toHaveBeenCalled();
  });

  it('marca fallido y ejecuta el rollback cuando se agotan los intentos', async () => {
    const { service, repo } = createService();
    const pending = job({ attempts: 3, maxAttempts: 3 });
    repo.findNextReady
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(null);
    repo.findById.mockResolvedValue(pending);
    const onFailed = jest.fn(async () => undefined);
    service.register('TEST_JOB', {
      handler: jest.fn(async () => {
        throw new Error('sin caja abierta');
      }),
      onFailed,
    });

    await service.drain();

    expect(repo.markFailed).toHaveBeenCalledWith(
      'job-1',
      expect.any(Date),
      'sin caja abierta',
    );
    expect(onFailed).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ id: 'job-1', payload: { value: 7 } }),
    );
  });

  it('no reintenta los errores de negocio', async () => {
    const { service, repo } = createService();
    const pending = job({ attempts: 1, maxAttempts: 3 });
    repo.findNextReady
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(null);
    repo.findById.mockResolvedValue(pending);
    service.register('TEST_JOB', {
      handler: jest.fn(async () => {
        throw new NonRetryableJobError('pedido ya pagado');
      }),
    });

    await service.drain();

    expect(repo.reschedule).not.toHaveBeenCalled();
    expect(repo.markFailed).toHaveBeenCalledWith(
      'job-1',
      expect.any(Date),
      'pedido ya pagado',
    );
  });
});
