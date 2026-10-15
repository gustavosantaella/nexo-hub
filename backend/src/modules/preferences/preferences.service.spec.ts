import type { PrismaService } from '../../prisma/prisma.service';
import { PreferencesService } from './preferences.service';

/** Columnas que el servicio pide a Prisma (las que viajan al cliente). */
const SELECT = { tipPercent: true, dialogView: true, priceCurrency: true };

/** Doble de `PrismaService` que solo expone el delegado de preferencias. */
function prismaWith(delegate: {
  findUnique: jest.Mock;
  upsert: jest.Mock;
}): PrismaService {
  return { companyPreference: delegate } as unknown as PrismaService;
}

describe('PreferencesService (preferencias de la empresa)', () => {
  let findUnique: jest.Mock;
  let upsert: jest.Mock;
  let service: PreferencesService;

  beforeEach(() => {
    findUnique = jest.fn(async () => null);
    upsert = jest.fn(async () => ({
      tipPercent: null,
      dialogView: null,
      priceCurrency: null,
    }));
    service = new PreferencesService(prismaWith({ findUnique, upsert }));
  });

  it('sin nada configurado devuelve las preferencias de fábrica (vacías)', async () => {
    await expect(service.find('c1')).resolves.toEqual({
      tipPercent: null,
      dialogView: null,
      priceCurrency: null,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      select: SELECT,
    });
  });

  it('devuelve lo que la empresa tiene configurado', async () => {
    findUnique.mockResolvedValue({
      tipPercent: 15,
      dialogView: 'sidebar',
      priceCurrency: 'VES',
    });

    await expect(service.find('c1')).resolves.toEqual({
      tipPercent: 15,
      dialogView: 'sidebar',
      priceCurrency: 'VES',
    });
  });

  it('cada empresa lee solo su fila', async () => {
    await service.find('c1');
    await service.find('c2');

    expect(findUnique).toHaveBeenNthCalledWith(1, {
      where: { companyId: 'c1' },
      select: SELECT,
    });
    expect(findUnique).toHaveBeenNthCalledWith(2, {
      where: { companyId: 'c2' },
      select: SELECT,
    });
  });

  it('guarda la propina, la moneda de los precios y la presentación de los formularios', async () => {
    upsert.mockResolvedValue({
      tipPercent: 15,
      dialogView: 'sidebar',
      priceCurrency: 'VES',
    });

    const result = await service.update('c1', {
      tipPercent: 15,
      dialogView: 'sidebar',
      priceCurrency: 'VES',
    });

    expect(result).toEqual({
      tipPercent: 15,
      dialogView: 'sidebar',
      priceCurrency: 'VES',
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      create: {
        companyId: 'c1',
        tipPercent: 15,
        dialogView: 'sidebar',
        priceCurrency: 'VES',
      },
      update: { tipPercent: 15, dialogView: 'sidebar', priceCurrency: 'VES' },
      select: SELECT,
    });
  });

  it('un cambio parcial no toca las otras preferencias', async () => {
    upsert.mockResolvedValue({
      tipPercent: null,
      dialogView: 'sidebar',
      priceCurrency: null,
    });

    await service.update('c1', { dialogView: 'sidebar' });

    // En `update` solo viaja lo enviado; al crear la fila, lo ausente es `null`.
    expect(upsert).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      create: {
        companyId: 'c1',
        tipPercent: null,
        dialogView: 'sidebar',
        priceCurrency: null,
      },
      update: { dialogView: 'sidebar' },
      select: SELECT,
    });
  });

  it('acota la propina al rango 0-100 y a dos decimales', async () => {
    await service.update('c1', { tipPercent: 180 });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { tipPercent: 100 } }),
    );

    await service.update('c1', { tipPercent: -5 });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { tipPercent: 0 } }),
    );

    await service.update('c1', { tipPercent: 12.345 });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { tipPercent: 12.35 } }),
    );
  });

  it('normaliza la moneda de los precios y `null` la borra', async () => {
    await service.update('c1', { priceCurrency: 'ves' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { priceCurrency: 'VES' } }),
    );

    // Un codigo que no es una moneda ISO se descarta (vuelve a la moneda base).
    await service.update('c1', { priceCurrency: 'bolivares' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { priceCurrency: null } }),
    );

    await service.update('c1', { priceCurrency: null });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { priceCurrency: null } }),
    );
  });

  it('`null` borra la preferencia (vuelve al valor de fábrica)', async () => {
    upsert.mockResolvedValue({
      tipPercent: null,
      dialogView: null,
      priceCurrency: null,
    });

    const result = await service.update('c1', {
      tipPercent: null,
      dialogView: null,
      priceCurrency: null,
    });

    expect(result).toEqual({
      tipPercent: null,
      dialogView: null,
      priceCurrency: null,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { tipPercent: null, dialogView: null, priceCurrency: null },
      }),
    );
  });

  it('crea la fila la primera vez que la empresa configura algo', async () => {
    upsert.mockResolvedValue({
      tipPercent: 0,
      dialogView: 'modal',
      priceCurrency: null,
    });

    await service.update('c1', { tipPercent: 0 });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'c1' },
        create: {
          companyId: 'c1',
          tipPercent: 0,
          dialogView: null,
          priceCurrency: null,
        },
      }),
    );
  });
});
