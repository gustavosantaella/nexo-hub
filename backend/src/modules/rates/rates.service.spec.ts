import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { CurrencySetting } from '../../common/constants/currencies';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CurrenciesService } from '../currencies/currencies.service';
import { CUSTOM_RATE_KEY, RatesService } from './rates.service';

/** Empresa de prueba usada en todas las llamadas (multi-tenant). */
const COMPANY_ID = 'company-1';

/** Monedas configuradas por defecto en las pruebas (USD + VES, nada mas). */
const DEFAULT_CURRENCIES: CurrencySetting[] = [
  {
    code: 'USD',
    label: 'Dolares',
    symbol: '$',
    enabled: true,
    rate: null,
    decimals: 2,
  },
  {
    code: 'VES',
    label: 'Bolivares',
    symbol: 'Bs',
    enabled: true,
    rate: null,
    decimals: 2,
  },
];

function currencySetting(input: Partial<CurrencySetting>): CurrencySetting {
  return {
    code: 'XXX',
    label: input.code ?? 'XXX',
    symbol: input.code ?? 'XXX',
    enabled: true,
    rate: null,
    decimals: 2,
    ...input,
  };
}

/** Respuesta real del endpoint publico del BCV. */
const BCV_PAYLOAD = {
  current: { date: '2026-10-13', usd: 876.7976, eur: 982.00454402 },
  previous: { date: '2026-10-09', usd: 875.6505, eur: 980.61472543 },
  changePercentage: { usd: 0.13099975389724816, eur: 0.14172932079829498 },
};

interface SettingRow {
  key: string;
  value: string;
  updatedAt: Date;
  updatedBy?: { name: string } | null;
}

function buildService(options: {
  setting?: SettingRow | null;
  fetchImpl?: jest.Mock;
  cacheTtlSeconds?: number;
  currencies?: CurrencySetting[];
}): { service: RatesService; prisma: Record<string, jest.Mock> } {
  const setting = options.setting ?? null;
  const prisma = {
    findUnique: jest.fn().mockResolvedValue(setting),
    upsert: jest.fn().mockResolvedValue(setting),
    deleteMany: jest.fn().mockResolvedValue({ count: setting ? 1 : 0 }),
  };
  const settingDelegate = {
    findUnique: prisma.findUnique,
    upsert: prisma.upsert,
    deleteMany: prisma.deleteMany,
  };

  const config = {
    get: jest.fn((key: string) => {
      if (key === 'rates.bcvUrl') return 'https://rates.test/bcv/current.json';
      if (key === 'rates.cacheTtlSeconds') return options.cacheTtlSeconds ?? 900;
      if (key === 'rates.timeoutMs') return 5000;
      return undefined;
    }),
  };

  const currencies = {
    list: jest.fn().mockResolvedValue(options.currencies ?? DEFAULT_CURRENCIES),
  };

  const service = new RatesService(
    { setting: settingDelegate } as unknown as PrismaService,
    currencies as unknown as CurrenciesService,
    config as unknown as ConfigService,
  );

  if (options.fetchImpl) {
    (global as unknown as { fetch: jest.Mock }).fetch = options.fetchImpl;
  }

  return { service, prisma };
}

describe('RatesService', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(BCV_PAYLOAD),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('devuelve solo las 2 tasas BCV cuando no hay tasa personalizada', async () => {
    const { service } = buildService({ fetchImpl: fetchMock });

    const snapshot = await service.snapshot(COMPANY_ID);

    expect(snapshot.rates).toHaveLength(2);
    expect(snapshot.rates.map((rate) => rate.key)).toEqual([
      'BCV_USD',
      'BCV_EUR',
    ]);
    expect(snapshot.rates[0].rate).toBe(876.7976);
    expect(snapshot.rates[1].rate).toBeCloseTo(982.00454402, 6);
    expect(snapshot.activeKey).toBe('BCV_USD');
    expect(snapshot.custom).toBeNull();
    expect(snapshot.bcv.current.date).toBe('2026-10-13');
    expect(snapshot.bcv.previous.usd).toBe(875.6505);
    expect(snapshot.bcv.stale).toBe(false);
  });

  it('agrega la tercera tasa cuando existe una personalizada', async () => {
    const { service, prisma } = buildService({
      fetchImpl: fetchMock,
      setting: {
        key: CUSTOM_RATE_KEY,
        value: '905.5',
        updatedAt: new Date('2026-10-13T12:00:00.000Z'),
        updatedBy: { name: 'Administrador' },
      },
    });

    const snapshot = await service.snapshot(COMPANY_ID);

    expect(snapshot.rates).toHaveLength(3);
    expect(snapshot.rates[2]).toMatchObject({
      key: 'CUSTOM_USD',
      source: 'CUSTOM',
      currency: 'USD',
      rate: 905.5,
    });
    expect(snapshot.activeKey).toBe('CUSTOM_USD');
    expect(snapshot.custom?.updatedBy).toBe('Administrador');
    // La tasa personalizada se lee por empresa (clave compuesta).
    expect(prisma.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_key: { companyId: COMPANY_ID, key: CUSTOM_RATE_KEY },
        },
      }),
    );
  });

  it('reutiliza la cache y no golpea el endpoint externo dos veces', async () => {
    const { service } = buildService({ fetchImpl: fetchMock });

    await service.snapshot(COMPANY_ID);
    await service.snapshot(COMPANY_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('vuelve a consultar el endpoint cuando se pide refresh', async () => {
    const { service } = buildService({ fetchImpl: fetchMock });

    await service.snapshot(COMPANY_ID);
    await service.snapshot(COMPANY_ID, true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('devuelve la ultima tasa conocida marcada como stale si el BCV falla', async () => {
    const { service } = buildService({ fetchImpl: fetchMock });
    await service.snapshot(COMPANY_ID);

    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    const snapshot = await service.snapshot(COMPANY_ID, true);

    expect(snapshot.bcv.stale).toBe(true);
    expect(snapshot.rates[0].rate).toBe(876.7976);
  });

  it('lanza 503 cuando el BCV falla y no hay cache previa', async () => {
    const { service } = buildService({ fetchImpl: fetchMock });
    fetchMock.mockRejectedValueOnce(new Error('timeout'));

    await expect(service.snapshot(COMPANY_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rechaza respuestas del BCV con formato invalido', async () => {
    const { service } = buildService({ fetchImpl: fetchMock });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ current: { usd: 0, eur: 0 } }),
    });

    await expect(service.snapshot(COMPANY_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('elimina la tasa personalizada al guardar null', async () => {
    const { service, prisma } = buildService({
      setting: {
        key: CUSTOM_RATE_KEY,
        value: '900',
        updatedAt: new Date(),
      },
    });

    await expect(service.setCustomRate(COMPANY_ID, null)).resolves.toBeNull();
    // El borrado se limita a la empresa (clave compuesta del negocio).
    expect(prisma.deleteMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID, key: CUSTOM_RATE_KEY },
    });
  });

  describe('monedas y conversiones de pago', () => {
    it('expone las monedas con su tasa en bolivares (USD y VES)', async () => {
      const { service } = buildService({ fetchImpl: fetchMock });

      const snapshot = await service.snapshot(COMPANY_ID);

      expect(snapshot.currencies.map((item) => item.code)).toEqual([
        'USD',
        'VES',
      ]);
      expect(snapshot.currencies[0]).toMatchObject({
        code: 'USD',
        bsPerUnit: 876.7976,
        source: 'BCV',
        isBase: true,
      });
      expect(snapshot.currencies[1]).toMatchObject({
        code: 'VES',
        bsPerUnit: 1,
      });
    });

    it('usa la tasa personalizada como tasa del dolar cuando existe', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        setting: {
          key: CUSTOM_RATE_KEY,
          value: '950',
          updatedAt: new Date('2026-10-13T12:00:00.000Z'),
        },
      });

      const snapshot = await service.snapshot(COMPANY_ID);

      expect(snapshot.currencies[0].bsPerUnit).toBe(950);
      expect(snapshot.currencies[0].bsPerUsd).toBe(950);
      expect(snapshot.currencies[0].source).toBe('CUSTOM');
    });

    it('toma del BCV la tasa del euro cuando no hay tasa manual', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        currencies: [
          ...DEFAULT_CURRENCIES,
          currencySetting({ code: 'EUR' }),
        ],
      });

      const snapshot = await service.snapshot(COMPANY_ID);
      const eur = snapshot.currencies.find((item) => item.code === 'EUR');

      expect(eur?.bsPerUnit).toBeCloseTo(982.00454402, 6);
      expect(eur?.source).toBe('BCV');
    });

    it('usa la tasa manual configurada para otras monedas', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        currencies: [
          ...DEFAULT_CURRENCIES,
          currencySetting({ code: 'COP', rate: 0.22 }),
        ],
      });

      const snapshot = await service.snapshot(COMPANY_ID);
      const cop = snapshot.currencies.find((item) => item.code === 'COP');

      expect(cop?.bsPerUnit).toBe(0.22);
      expect(cop?.source).toBe('MANUAL');
    });

    it('marca sin tasa (source NONE) las monedas sin configurar', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        currencies: [...DEFAULT_CURRENCIES, currencySetting({ code: 'COP' })],
      });

      const snapshot = await service.snapshot(COMPANY_ID);
      const cop = snapshot.currencies.find((item) => item.code === 'COP');

      expect(cop?.bsPerUnit).toBeNull();
      expect(cop?.source).toBe('NONE');
    });

    it('convierte un cobro en bolivares al equivalente en dolares', async () => {
      const { service } = buildService({ fetchImpl: fetchMock });

      const payment = await service.resolvePayment(COMPANY_ID, 876.7976, 'VES');

      expect(payment).toMatchObject({
        currency: 'VES',
        exchangeRate: 1,
        baseAmount: 1,
      });
    });

    it('convierte un cobro en otra moneda usando su tasa configurada', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        currencies: [
          ...DEFAULT_CURRENCIES,
          currencySetting({ code: 'COP', rate: 0.22 }),
        ],
      });

      // 1000 COP * 0.22 = 220 Bs -> 220 / 876.7976 = 0.25 USD
      const payment = await service.resolvePayment(COMPANY_ID, 1000, 'COP');

      expect(payment.baseAmount).toBe(0.25);
      expect(payment.exchangeRate).toBe(0.22);
    });

    it('deja intacto un cobro en la moneda base', async () => {
      const { service } = buildService({ fetchImpl: fetchMock });

      await expect(service.resolvePayment(COMPANY_ID, 25.5, 'USD')).resolves.toMatchObject({
        currency: 'USD',
        baseAmount: 25.5,
      });
      await expect(service.resolvePayment(COMPANY_ID, 25.5, undefined)).resolves.toMatchObject(
        { currency: 'USD', baseAmount: 25.5 },
      );
    });

    it('rechaza cobrar en una moneda que no esta habilitada', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        currencies: [
          ...DEFAULT_CURRENCIES,
          currencySetting({ code: 'EUR', enabled: false }),
        ],
      });

      await expect(service.resolvePayment(COMPANY_ID, 10, 'EUR')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.resolvePayment(COMPANY_ID, 10, 'COP')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rechaza cobrar en una moneda habilitada sin tasa configurada', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        currencies: [...DEFAULT_CURRENCIES, currencySetting({ code: 'COP' })],
      });

      await expect(service.resolvePayment(COMPANY_ID, 10, 'COP')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('expresa un monto de la moneda base en otra moneda', async () => {
      const { service } = buildService({ fetchImpl: fetchMock });

      await expect(service.toCurrencyAmount(COMPANY_ID, 2, 'VES')).resolves.toBe(1753.6);
    });
  });
});
