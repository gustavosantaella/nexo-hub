import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { compare } from 'bcryptjs';
import { NotificationsService, randomUppercaseCode } from './notifications.service';
import type {
  NotificationSettingRow,
  NotificationsRepository,
} from './notifications.repository';
import type { TelegramService } from './telegram.service';

const COMPANY_ID = 'company-1';

/** Fila de configuracion con Telegram vinculado y todos los avisos activos. */
function settingsRow(
  overrides: Partial<NotificationSettingRow> = {},
): NotificationSettingRow {
  return {
    telegramEnabled: true,
    notifyLowStock: true,
    notifySales: true,
    notifyCashClose: true,
    notifyCancellations: true,
    telegramChatId: '123456',
    telegramChatTitle: 'Admin del local',
    telegramLinkedAt: new Date('2026-10-20T10:00:00.000Z'),
    telegramLinkCode: null,
    telegramLinkCodeExpiresAt: null,
    updatedAt: new Date('2026-10-20T10:00:00.000Z'),
    ...overrides,
  };
}

function createService(row: NotificationSettingRow | null = settingsRow()) {
  const repo = {
    findSettings: jest.fn(async () => row),
    upsertSettings: jest.fn(async () => row ?? settingsRow()),
    findCompanyByChat: jest.fn(async () => null),
    findSettingsByLinkCode: jest.fn(async () => null),
    findUserName: jest.fn(async () => ({ name: 'Ana Cajera' })),
    invalidateOrderOtps: jest.fn(async () => undefined),
    createOtp: jest.fn(async (data: Record<string, unknown>) => ({
      id: 'otp-1',
      expiresAt: data.expiresAt as Date,
      codeHash: data.codeHash as string,
    })),
    findLatestOtp: jest.fn(),
    markOtpUsed: jest.fn(async () => undefined),
  };
  const telegram = {
    configured: true,
    getBotInfo: jest.fn(async () => ({
      id: 1,
      username: 'nexo_hub_bot',
      firstName: 'Nexo Hub',
    })),
    getUpdates: jest.fn(async () => []),
    sendMessage: jest.fn(
      async (_chatId: string, _html: string): Promise<boolean> => true,
    ),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'telegram.polling' ? false : undefined,
    ),
  };

  const service = new NotificationsService(
    repo as unknown as NotificationsRepository,
    telegram as unknown as TelegramService,
    config as unknown as ConfigService,
  );
  return { service, repo, telegram };
}

describe('NotificationsService', () => {
  it('genera codigos de 8 letras mayusculas sin caracteres ambiguos', () => {
    const code = randomUppercaseCode();
    expect(code).toMatch(/^[A-Z]{8}$/);
    expect(code).not.toMatch(/[IO]/);
  });

  it('sin fila devuelve valores de fabrica y Telegram apagado', async () => {
    const { service } = createService(null);
    const settings = await service.getSettings(COMPANY_ID);

    expect(settings.telegramConfigured).toBe(true);
    expect(settings.telegramEnabled).toBe(false);
    expect(settings.notifyLowStock).toBe(true);
    expect(settings.botUsername).toBe('nexo_hub_bot');
    expect(settings.telegramLinked).toBe(false);
  });

  it('emite un OTP, lo envia al admin y lo valida sin guardar el codigo en claro', async () => {
    const { service, repo, telegram } = createService();

    const result = await service.requestCancellationOtp(COMPANY_ID, {
      orderId: 'order-1',
      orderCode: 'PED-0001',
      total: 30,
      requestedById: 'cashier-1',
      items: [{ name: 'Cafe', quantity: 2 }],
    });

    const data = repo.createOtp.mock.calls[0][0] as {
      codeHash: string;
      expiresAt: Date;
    };
    const message = telegram.sendMessage.mock.calls[0][1] as string;
    const code = /<code>([A-Z]{8})<\/code>/.exec(message)?.[1] ?? '';

    expect(code).toMatch(/^[A-Z]{8}$/);
    expect(message).toContain('PED-0001');
    expect(message).toContain('10 minutos');
    expect(data.codeHash).not.toBe(code);
    expect(await compare(code, data.codeHash)).toBe(true);

    // Vigencia de 10 minutos (con un margen de un segundo por el reloj).
    const ttl = data.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);
    expect(result.expiresAt).toBe(data.expiresAt.toISOString());

    repo.findLatestOtp.mockResolvedValue({
      id: 'otp-1',
      codeHash: data.codeHash,
      expiresAt: data.expiresAt,
    });
    expect(
      await service.validateCancellationCode(COMPANY_ID, 'order-1', code),
    ).toBe('otp-1');
    expect(
      await service.validateCancellationCode(COMPANY_ID, 'order-1', 'ZZZZZZZZ'),
    ).toBeNull();
  });

  it('no permite cancelar con OTP si el admin no vinculo Telegram', async () => {
    const { service } = createService(settingsRow({ telegramChatId: null }));

    await expect(
      service.requestCancellationOtp(COMPANY_ID, {
        orderId: 'order-1',
        orderCode: 'PED-0001',
        total: 30,
        requestedById: 'cashier-1',
        items: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no entrega un OTP cuyo mensaje de Telegram fallo', async () => {
    const { service, repo, telegram } = createService();
    telegram.sendMessage.mockResolvedValue(false);

    await expect(
      service.requestCancellationOtp(COMPANY_ID, {
        orderId: 'order-1',
        orderCode: 'PED-0001',
        total: 30,
        requestedById: 'cashier-1',
        items: [],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.markOtpUsed).toHaveBeenCalledWith('otp-1');
  });


  it('envia el resumen de venta solo si el aviso esta activo', async () => {
    const { service, telegram } = createService();
    const sent = await service.notifySale(
      COMPANY_ID,
      {
        orderCode: 'PED-0001',
        total: 30,
        paidNow: 10,
        paidTotal: 10,
        balance: 20,
        paymentCurrency: 'USD',
        method: 'CASH',
        items: [{ name: 'Cafe', quantity: 1 }],
      },
      'cashier-1',
    );

    expect(sent).toBe(true);
    expect(telegram.sendMessage).toHaveBeenCalledWith(
      '123456',
      expect.stringContaining('PED-0001'),
    );

    const disabled = createService(settingsRow({ notifySales: false }));
    expect(
      await disabled.service.notifySale(COMPANY_ID, {
        orderCode: 'PED-0002',
        total: 1,
        paidNow: 1,
        paidTotal: 1,
        balance: 0,
        paymentCurrency: 'USD',
        method: 'CASH',
        items: [],
      }),
    ).toBe(false);
    expect(disabled.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('el aviso de stock minimo incluye producto y minimo', async () => {
    const { service, telegram } = createService();
    const sent = await service.notifyLowStock(COMPANY_ID, {
      name: 'Cafe',
      sku: 'CAF-1',
      stock: 2,
      minStock: 2,
      unit: 'UND',
    });

    expect(sent).toBe(true);
    expect(telegram.sendMessage.mock.calls[0][1]).toContain('Stock en el mínimo');
    expect(telegram.sendMessage.mock.calls[0][1]).toContain('Cafe');
  });

  it('el cierre de caja resume lo recaudado y la diferencia', async () => {
    const { service, telegram } = createService();
    await service.notifyCashClose(COMPANY_ID, {
      code: 'CJ-0001',
      openedAt: '2026-10-20T08:00:00.000Z',
      closedAt: '2026-10-20T16:00:00.000Z',
      salesTotal: 120,
      totalIn: 150,
      expectedCash: 100,
      countedAmount: 98,
      difference: -2,
      result: 'SHORTAGE',
      movementCount: 12,
    });

    const message = telegram.sendMessage.mock.calls[0][1] as string;
    expect(message).toContain('Cierre de caja');
    expect(message).toContain('CJ-0001');
    expect(message).toContain('$150.00');
    expect(message).toContain('Faltante');
  });
});

