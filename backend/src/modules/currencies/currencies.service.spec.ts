import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { CURRENCIES_KEY, CurrenciesService } from './currencies.service';

/** Empresa de prueba usada en todas las llamadas (multi-tenant). */
const COMPANY_ID = 'company-1';

interface PrismaStub {
  setting: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
}

/** Prisma simulado: `findUnique` devuelve la fila de `Setting` indicada. */
function buildService(stored?: string | null): {
  service: CurrenciesService;
  prisma: PrismaStub;
} {
  const prisma: PrismaStub = {
    setting: {
      findUnique: jest.fn().mockResolvedValue(
        stored === undefined
          ? null
          : stored === null
            ? null
            : { key: CURRENCIES_KEY, value: stored, updatedAt: new Date() },
      ),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };

  return {
    service: new CurrenciesService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('CurrenciesService', () => {
  it('devuelve USD, VES y EUR habilitadas cuando nunca se configuro nada', async () => {
    const { service, prisma } = buildService();

    const currencies = await service.list(COMPANY_ID);

    expect(currencies.map((item) => item.code)).toEqual(['USD', 'VES', 'EUR']);
    expect(currencies.every((item) => item.enabled)).toBe(true);
    expect(currencies[0]).toMatchObject({
      code: 'USD',
      label: 'Dolares',
      symbol: '$',
      rate: null,
    });
    // El euro tambien queda activo por defecto y toma su tasa del BCV.
    expect(currencies[2]).toMatchObject({
      code: 'EUR',
      label: 'Euros',
      symbol: '€',
      enabled: true,
      rate: null,
    });
    // La configuracion se lee siempre por empresa (clave compuesta).
    expect(prisma.setting.findUnique).toHaveBeenCalledWith({
      where: { companyId_key: { companyId: COMPANY_ID, key: CURRENCIES_KEY } },
    });
  });

  it('vuelve a incluir las monedas por defecto que falten en la configuracion guardada', async () => {
    const { service } = buildService(
      JSON.stringify([
        { code: 'USD', enabled: true },
        { code: 'VES', enabled: true },
      ]),
    );

    const currencies = await service.list(COMPANY_ID);

    // USD, VES y EUR son por defecto: siempre estan (el EUR vuelve habilitado).
    expect(currencies.map((item) => item.code)).toEqual(['USD', 'VES', 'EUR']);
    expect(currencies[2]).toMatchObject({ code: 'EUR', enabled: true, rate: null });
  });

  it('conserva las monedas por defecto desactivadas por el local', async () => {
    const { service } = buildService(
      JSON.stringify([
        { code: 'USD', enabled: true },
        { code: 'VES', enabled: true },
        { code: 'EUR', enabled: false },
      ]),
    );

    const currencies = await service.list(COMPANY_ID);

    expect(currencies.map((item) => item.code)).toEqual(['USD', 'VES', 'EUR']);
    expect(currencies[2]).toMatchObject({ code: 'EUR', enabled: false });
  });

  it('guarda la configuracion como un unico documento JSON en Setting', async () => {
    const { service, prisma } = buildService();

    const saved = await service.save(
      COMPANY_ID,
      [
        { code: 'USD', enabled: true },
        { code: 'VES', enabled: true },
        { code: 'EUR', enabled: true },
        { code: 'COP', enabled: true, rate: 0.22 },
      ],
      'user-1',
    );

    expect(saved.map((item) => item.code)).toEqual([
      'USD',
      'VES',
      'EUR',
      'COP',
    ]);
    expect(saved[3]).toMatchObject({ code: 'COP', enabled: true, rate: 0.22 });
    expect(prisma.setting.upsert).toHaveBeenCalledTimes(1);
    // El guardado usa la clave compuesta por empresa.
    expect(prisma.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          companyId_key: { companyId: COMPANY_ID, key: CURRENCIES_KEY },
        },
      }),
    );

    const payload = prisma.setting.upsert.mock.calls[0][0] as {
      create: { companyId: string; key: string; value: string };
    };
    expect(payload.create.companyId).toBe(COMPANY_ID);
    expect(payload.create.key).toBe(CURRENCIES_KEY);
    expect(JSON.parse(payload.create.value)).toHaveLength(4);
  });

  it('rechaza quitar de la configuracion una moneda por defecto', async () => {
    const { service } = buildService();

    // Ni por el endpoint de borrado...
    await expect(service.remove(COMPANY_ID, 'VES')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.remove(COMPANY_ID, 'EUR')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // ...ni mandando la configuracion completa sin ellas.
    await expect(
      service.save(COMPANY_ID, [{ code: 'USD' }, { code: 'EUR' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.save(COMPANY_ID, [{ code: 'USD' }, { code: 'VES' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza desactivar la moneda base', async () => {
    const { service } = buildService();

    await expect(
      service.save(COMPANY_ID, [
        { code: 'USD', enabled: false },
        { code: 'VES' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exige la tasa de las monedas que no publica el BCV', async () => {
    const { service } = buildService();

    await expect(
      service.save(COMPANY_ID, [{ code: 'USD' }, { code: 'COP', enabled: true }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('permite el euro sin tasa manual porque la publica el BCV', async () => {
    const { service } = buildService();

    const saved = await service.save(COMPANY_ID, [
      { code: 'USD' },
      { code: 'VES' },
      { code: 'EUR', enabled: true },
    ]);

    expect(saved.find((item) => item.code === 'EUR')).toMatchObject({
      code: 'EUR',
      enabled: true,
      rate: null,
      symbol: '€',
    });
  });

  it('rechaza codigos de moneda invalidos o repetidos', async () => {
    const { service } = buildService();

    await expect(service.save(COMPANY_ID, [{ code: 'X' }])).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.save(COMPANY_ID, [{ code: 'USD' }, { code: 'usd' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('agrega una moneda nueva conservando las existentes', async () => {
    const { service } = buildService(
      JSON.stringify([
        { code: 'USD', enabled: true },
        { code: 'VES', enabled: true },
        { code: 'EUR', enabled: true, rate: null },
      ]),
    );

    const currencies = await service.upsert(COMPANY_ID, 'COP', {
      enabled: true,
      rate: 0.22,
    });

    expect(currencies.map((item) => item.code)).toEqual([
      'USD',
      'VES',
      'EUR',
      'COP',
    ]);
  });

  it('no permite eliminar la moneda base ni las monedas por defecto, pero si las demas', async () => {
    const { service } = buildService(
      JSON.stringify([
        { code: 'USD', enabled: true },
        { code: 'VES', enabled: true },
        { code: 'EUR', enabled: true },
        { code: 'COP', enabled: true, rate: 0.22 },
      ]),
    );

    await expect(service.remove(COMPANY_ID, 'USD')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.remove(COMPANY_ID, 'VES')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.remove(COMPANY_ID, 'EUR')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const remaining = await service.remove(COMPANY_ID, 'COP');
    expect(remaining.map((item) => item.code)).toEqual(['USD', 'VES', 'EUR']);
  });

  it('ignora un JSON corrupto y vuelve a los valores por defecto', async () => {
    const { service } = buildService('{no-es-json');

    const currencies = await service.list(COMPANY_ID);

    expect(currencies.map((item) => item.code)).toEqual(['USD', 'VES', 'EUR']);
  });

  it('expone solo las monedas habilitadas', async () => {
    const { service } = buildService(
      JSON.stringify([
        { code: 'USD', enabled: true },
        { code: 'VES', enabled: true },
        { code: 'EUR', enabled: false },
      ]),
    );

    const enabled = await service.enabled(COMPANY_ID);

    expect(enabled.map((item) => item.code)).toEqual(['USD', 'VES']);
  });
});
