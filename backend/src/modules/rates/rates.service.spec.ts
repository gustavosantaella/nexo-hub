import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { CurrencySetting } from '../../common/constants/currencies';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CurrenciesService } from '../currencies/currencies.service';
import type { PreferencesService } from '../preferences/preferences.service';
import { CUSTOM_RATE_KEY, RatesService } from './rates.service';
import { RatesRepository } from './rates.repository';

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

/** Respuesta real del endpoint informativo de la tasa USDT/VES. */
const USDT_PAYLOAD = {
  pair: 'USDT/VES',
  source: 'binance',
  method: 'p2p_floor',
  price: 1005.8,
  asOf: '2026-10-13T20:54:00.203Z',
  fetchedAt: '2026-10-13T20:54:00.203Z',
  side: 'FLOOR',
  paymentMethod: null,
};

/** Respuesta HTTP simulada con un cuerpo JSON. */
function okResponse(payload: unknown): {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
} {
  return { ok: true, status: 200, json: () => Promise.resolve(payload) };
}

/** `true` cuando la URL corresponde a la fuente informativa de la tasa USDT. */
function isReferenceUrl(url: unknown): boolean {
  return !String(url).includes('bcv');
}

/** `fetch` simulado que responde segun la URL consultada. */
function fetchByUrl(
  bcv: () => Promise<unknown> = () => Promise.resolve(okResponse(BCV_PAYLOAD)),
  usdt: () => Promise<unknown> = () => Promise.resolve(okResponse(USDT_PAYLOAD)),
): jest.Mock {
  return jest.fn((url: unknown) => (isReferenceUrl(url) ? usdt() : bcv()));
}

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
  baseCurrency?: string;
  preferencePriceCurrency?: string | null;
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
      if (key === 'rates.usdtUrl') return 'https://rates.test/usdt/latest';
      if (key === 'rates.usdtCacheTtlSeconds') return 300;
      return undefined;
    }),
  };

  const currencies = {
    list: jest.fn().mockResolvedValue(options.currencies ?? DEFAULT_CURRENCIES),
    baseCurrencyCode: jest.fn().mockResolvedValue(options.baseCurrency ?? 'USD'),
  };

  const preferences = {
    find: jest.fn().mockResolvedValue({
      priceCurrency: options.preferencePriceCurrency ?? 'VES',
    }),
  };

  const service = new RatesService(
    new RatesRepository({ setting: settingDelegate } as unknown as PrismaService),
    currencies as unknown as CurrenciesService,
    preferences as unknown as PreferencesService,
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

  /** URLs consultadas por el `fetch` simulado que contienen `fragment`. */
  const callsTo = (fragment: string): string[] =>
    fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes(fragment));

  beforeEach(() => {
    fetchMock = fetchByUrl();
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

  it('reutiliza la cache y no golpea los endpoints externos dos veces', async () => {
    const { service } = buildService({ fetchImpl: fetchMock });

    await service.snapshot(COMPANY_ID);
    await service.snapshot(COMPANY_ID);

    expect(callsTo('bcv')).toHaveLength(1);
    expect(callsTo('usdt')).toHaveLength(1);
  });

  it('vuelve a consultar los endpoints externos cuando se pide refresh', async () => {
    const { service } = buildService({ fetchImpl: fetchMock });

    await service.snapshot(COMPANY_ID);
    await service.snapshot(COMPANY_ID, true);

    expect(callsTo('bcv')).toHaveLength(2);
    expect(callsTo('usdt')).toHaveLength(2);
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

  describe('tasa USDT de referencia (solo informativa)', () => {
    it('publica la tasa de la fuente externa sin usarla en las conversiones', async () => {
      const { service } = buildService({ fetchImpl: fetchMock });

      const snapshot = await service.snapshot(COMPANY_ID);

      expect(snapshot.reference).toMatchObject({
        pair: 'USDT/VES',
        label: 'Binance · P2P piso',
        source: 'binance',
        method: 'p2p_floor',
        side: 'FLOOR',
        paymentMethod: null,
        price: 1005.8,
        asOf: '2026-10-13T20:54:00.203Z',
        stale: false,
        sourceUrl: 'https://rates.test/usdt/latest',
      });

      // La referencia NO entra en las tasas utilizables ni en las conversiones.
      expect(snapshot.rates.map((rate) => rate.rate)).toEqual([
        876.7976,
        982.00454402,
      ]);
      expect(snapshot.activeKey).toBe('BCV_USD');
      expect(snapshot.currencies[0].bsPerUnit).toBe(876.7976);
      // 876.7976 Bs = 1 USD con la tasa del BCV, no con los 1005.8 Bs del USDT.
      await expect(
        service.resolvePayment(COMPANY_ID, 876.7976, 'VES'),
      ).resolves.toMatchObject({ baseAmount: 1, exchangeRate: 1 });
    });

    it('devuelve null cuando la fuente falla y no hay dato previo', async () => {
      const failing = fetchByUrl(undefined, () =>
        Promise.reject(new Error('timeout')),
      );
      const { service } = buildService({ fetchImpl: failing });

      const snapshot = await service.snapshot(COMPANY_ID);

      expect(snapshot.reference).toBeNull();
      // El BCV sigue respondiendo: la pantalla de tasas no se cae.
      expect(snapshot.rates[0].rate).toBe(876.7976);
    });

    it('reutiliza la ultima tasa USDT conocida (stale) si la fuente falla luego', async () => {
      const { service } = buildService({ fetchImpl: fetchMock });
      await service.snapshot(COMPANY_ID);

      fetchMock.mockImplementation(
        fetchByUrl(undefined, () => Promise.reject(new Error('timeout'))),
      );
      const snapshot = await service.snapshot(COMPANY_ID, true);

      expect(snapshot.reference?.price).toBe(1005.8);
      expect(snapshot.reference?.stale).toBe(true);
    });

    it('ignora respuestas de la fuente USDT sin precio valido', async () => {
      fetchMock.mockImplementation(
        fetchByUrl(undefined, () =>
          Promise.resolve(okResponse({ ...USDT_PAYLOAD, price: 0 })),
        ),
      );
      const { service } = buildService({ fetchImpl: fetchMock });

      const snapshot = await service.snapshot(COMPANY_ID);

      expect(snapshot.reference).toBeNull();
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

    it('calcula el factor de venta vitrina/BCV', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        setting: {
          key: CUSTOM_RATE_KEY,
          value: '950',
          updatedAt: new Date('2026-10-13T12:00:00.000Z'),
        },
      });

      // 950 / 876,7976: un precio de catalogo de 10 USD se vende como 10,83 USD
      // (los Bs 9.500 de vitrina valorados a la tasa oficial).
      await expect(service.saleFactor(COMPANY_ID)).resolves.toBeCloseTo(
        950 / 876.7976,
        8,
      );
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

    /**
     * El operador puede elegir CON CUAL de las tasas del sistema se convierte un
     * monto del catalogo (precio, costo, costo unitario): la elegida reemplaza al
     * puente por defecto (`personalizada ?? BCV dolar`).
     */
    it('convierte un monto con la tasa elegida (BCV euro)', async () => {
      const { service } = buildService({ fetchImpl: fetchMock });

      // 9.820,05 Bs al cambio del euro (982,00454402 Bs por USD) = 10 USD. Con la
      // tasa activa del dolar (876,7976) habrian sido 11,20 USD.
      const conversion = await service.resolveAmount(
        COMPANY_ID,
        9820.05,
        'VES',
        'BCV_EUR',
      );

      expect(conversion.baseAmount).toBe(10);
      // La tasa aplicada sigue siendo la de la moneda (1 Bs por 1 Bs).
      expect(conversion.exchangeRate).toBe(1);
    });

    it('usa la tasa activa cuando no se elige tasa o la elegida no existe', async () => {
      const { service } = buildService({ fetchImpl: fetchMock });

      const chosen = await service.resolveAmount(COMPANY_ID, 876.7976, 'VES', 'BCV_USD');
      // Sin tasa personalizada configurada, `CUSTOM_USD` cae en la activa (BCV $).
      const missing = await service.resolveAmount(
        COMPANY_ID,
        876.7976,
        'VES',
        'CUSTOM_USD',
      );
      const none = await service.resolveAmount(COMPANY_ID, 876.7976, 'VES');

      expect(chosen.baseAmount).toBe(1);
      expect(missing.baseAmount).toBe(1);
      expect(none.baseAmount).toBe(1);
    });

    it('prefiere la tasa personalizada cuando se elige y existe', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        setting: {
          key: CUSTOM_RATE_KEY,
          value: '905.5',
          updatedAt: new Date('2026-10-13T12:00:00.000Z'),
          updatedBy: null,
        },
      });

      const conversion = await service.resolveAmount(
        COMPANY_ID,
        905.5,
        'VES',
        'CUSTOM_USD',
      );

      expect(conversion.baseAmount).toBe(1);
    });

    it('usa la tasa elegida como puente al convertir otra moneda', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        currencies: [
          ...DEFAULT_CURRENCIES,
          currencySetting({ code: 'COP', rate: 0.22 }),
        ],
      });

      // 1000 COP x 0,22 = 220 Bs; al cambio del euro son 0,22 USD (con la tasa
      // activa, 876,7976, habrian sido 0,25).
      const conversion = await service.resolveAmount(
        COMPANY_ID,
        1000,
        'COP',
        'BCV_EUR',
      );

      expect(conversion.baseAmount).toBe(0.22);
      expect(conversion.exchangeRate).toBe(0.22);
    });

    it('re-expresa un monto en bolivares con la misma tasa elegida', async () => {
      const { service } = buildService({ fetchImpl: fetchMock });

      // 10 USD al cambio del euro: 10 x 982,00454402 = 9.820,05 Bs. Con la tasa
      // activa habrian sido 8.767,98 Bs.
      await expect(
        service.toCurrencyAmount(COMPANY_ID, 10, 'VES', 'BCV_EUR'),
      ).resolves.toBe(9820.05);
    });
  });

  describe('moneda base (lo que se muestra primero)', () => {
    it('usa el dolar cuando el local no ha elegido otra moneda', async () => {
      const { service } = buildService({ fetchImpl: fetchMock });

      const snapshot = await service.snapshot(COMPANY_ID);

      expect(snapshot.baseCurrency).toMatchObject({
        code: 'USD',
        symbol: '$',
        decimals: 2,
        bsPerUnit: 876.7976,
        bsPerUsd: 876.7976,
      });
      expect(snapshot.currencies[0].isDisplayBase).toBe(true);
      expect(snapshot.currencies[0].isBase).toBe(true);
    });

    it('publica la moneda elegida con su tasa y marca la ficha correspondiente', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        baseCurrency: 'VES',
      });

      const snapshot = await service.snapshot(COMPANY_ID);
      const ves = snapshot.currencies.find((item) => item.code === 'VES');
      const usd = snapshot.currencies.find((item) => item.code === 'USD');

      expect(snapshot.baseCurrency).toMatchObject({
        code: 'VES',
        label: 'Bolivares',
        symbol: 'Bs',
        bsPerUnit: 1,
        bsPerUsd: 876.7976,
      });
      expect(ves?.isDisplayBase).toBe(true);
      expect(ves?.isBase).toBe(false);
      // El dolar sigue siendo la moneda base contable (puente de conversion).
      expect(usd?.isBase).toBe(true);
      expect(usd?.isDisplayBase).toBe(false);
    });

    it('vuelve al dolar cuando la moneda base guardada ya no esta configurada', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        baseCurrency: 'COP',
      });

      const snapshot = await service.snapshot(COMPANY_ID);

      expect(snapshot.baseCurrency.code).toBe('USD');
      expect(snapshot.currencies.some((item) => item.isDisplayBase)).toBe(true);
    });
  });

  describe('ratesHistory (historial de tasas del cobro)', () => {
    it('guarda TODAS las tasas del dia, no solo la activa', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        setting: {
          key: CUSTOM_RATE_KEY,
          value: '905.5',
          updatedAt: new Date('2026-10-13T12:00:00.000Z'),
        },
      });

      const history = await service.ratesHistory(COMPANY_ID);

      expect(history.rates.map((rate) => rate.key)).toEqual([
        'BCV_USD',
        'BCV_EUR',
        'CUSTOM_USD',
      ]);
      expect(history.rates[0]).toEqual({
        key: 'BCV_USD',
        currency: 'USD',
        source: 'BCV',
        rate: 876.7976,
        date: '2026-10-13',
      });
      expect(history.rates[2]).toEqual({
        key: 'CUSTOM_USD',
        currency: 'USD',
        source: 'CUSTOM',
        rate: 905.5,
        date: null,
      });
      expect(history.bcvDate).toBe('2026-10-13');
      expect(history.activeKey).toBe('CUSTOM_USD');
      expect(history.stale).toBe(false);
      expect(Date.parse(history.capturedAt)).not.toBeNaN();
      // La serie del BCV se consulta una sola vez (la cache sirve al cobro).
      expect(callsTo('bcv')).toHaveLength(1);
    });

    it('guarda las 2 tasas del BCV cuando el local no tiene personalizada', async () => {
      const { service } = buildService({ fetchImpl: fetchMock });

      const history = await service.ratesHistory(COMPANY_ID);

      expect(history.rates.map((rate) => rate.key)).toEqual([
        'BCV_USD',
        'BCV_EUR',
      ]);
      expect(history.activeKey).toBe('BCV_USD');
      expect(history.bcvDate).toBe('2026-10-13');
    });

    it('marca la serie del BCV como stale cuando el endpoint falla y ya hay tasa previa', async () => {
      // TTL 0: la cache caduca al instante y cada lectura vuelve a consultar.
      const { service } = buildService({
        fetchImpl: fetchMock,
        cacheTtlSeconds: 0,
      });
      await service.ratesHistory(COMPANY_ID);

      fetchMock.mockRejectedValueOnce(new Error('timeout'));
      const history = await service.ratesHistory(COMPANY_ID);

      expect(history.stale).toBe(true);
      expect(history.rates[0].rate).toBe(876.7976);
    });

    /**
     * El cobro ya se convirtio bien: perder la foto de las tasas no puede
     * impedir registrarlo, asi que el historial degrada a lo que si se pudo leer.
     */
    it('no lanza y devuelve el historial vacio si el BCV no responde', async () => {
      const { service } = buildService({ fetchImpl: fetchMock });
      fetchMock.mockRejectedValue(new Error('timeout'));

      const history = await service.ratesHistory(COMPANY_ID);

      expect(history.rates).toEqual([]);
      expect(history.bcvDate).toBeNull();
      expect(history.activeKey).toBe('BCV_USD');
    });

    it('conserva la tasa personalizada cuando el BCV no responde', async () => {
      const { service } = buildService({
        fetchImpl: fetchMock,
        setting: {
          key: CUSTOM_RATE_KEY,
          value: '905.5',
          updatedAt: new Date('2026-10-13T12:00:00.000Z'),
        },
      });
      fetchMock.mockRejectedValue(new Error('timeout'));

      const history = await service.ratesHistory(COMPANY_ID);

      expect(history.rates).toEqual([
        {
          key: 'CUSTOM_USD',
          currency: 'USD',
          source: 'CUSTOM',
          rate: 905.5,
          date: null,
        },
      ]);
      expect(history.activeKey).toBe('CUSTOM_USD');
    });
  });
});
