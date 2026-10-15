import type { PrismaService } from '../../prisma/prisma.service';
import { PreferencesService } from './preferences.service';

/** Columnas que el servicio pide a Prisma (las que viajan al cliente). */
const SELECT = {
  tipPercent: true,
  dialogView: true,
  priceCurrency: true,
  conversionCurrencies: true,
  showBcvPrice: true,
  chargeRateKey: true,
};

/** Preferencias de fabrica: la empresa aun no configuro nada. */
const NO_PREFERENCES = {
  tipPercent: null,
  dialogView: null,
  priceCurrency: null,
  conversionCurrencies: null,
  showBcvPrice: null,
  chargeRateKey: null,
};

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
    upsert = jest.fn(async () => ({ ...NO_PREFERENCES }));
    service = new PreferencesService(prismaWith({ findUnique, upsert }));
  });

  it('sin nada configurado devuelve las preferencias de fábrica (vacías)', async () => {
    await expect(service.find('c1')).resolves.toEqual({ ...NO_PREFERENCES });
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
      conversionCurrencies: JSON.stringify(['USD', 'COP']),
      showBcvPrice: true,
      chargeRateKey: 'CUSTOM_USD',
    });

    await expect(service.find('c1')).resolves.toEqual({
      tipPercent: 15,
      dialogView: 'sidebar',
      priceCurrency: 'VES',
      conversionCurrencies: ['USD', 'COP'],
      showBcvPrice: true,
      chargeRateKey: 'CUSTOM_USD',
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
      conversionCurrencies: null,
      showBcvPrice: null,
      chargeRateKey: null,
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
      conversionCurrencies: null,
      showBcvPrice: null,
      chargeRateKey: null,
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      create: {
        companyId: 'c1',
        tipPercent: 15,
        dialogView: 'sidebar',
        priceCurrency: 'VES',
        conversionCurrencies: null,
        showBcvPrice: null,
        chargeRateKey: null,
      },
      update: {
        tipPercent: 15,
        dialogView: 'sidebar',
        priceCurrency: 'VES',
      },
      select: SELECT,
    });
  });

  it('un cambio parcial no toca las otras preferencias', async () => {
    upsert.mockResolvedValue({
      tipPercent: null,
      dialogView: 'sidebar',
      priceCurrency: null,
      conversionCurrencies: null,
      showBcvPrice: null,
      chargeRateKey: null,
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
        conversionCurrencies: null,
        showBcvPrice: null,
        chargeRateKey: null,
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
    upsert.mockResolvedValue({ ...NO_PREFERENCES });

    const result = await service.update('c1', {
      tipPercent: null,
      dialogView: null,
      priceCurrency: null,
      conversionCurrencies: null,
    });

    expect(result).toEqual({ ...NO_PREFERENCES });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          tipPercent: null,
          dialogView: null,
          priceCurrency: null,
          conversionCurrencies: null,
        },
      }),
    );
  });

  it('crea la fila la primera vez que la empresa configura algo', async () => {
    upsert.mockResolvedValue({
      tipPercent: 0,
      dialogView: 'modal',
      priceCurrency: null,
      conversionCurrencies: null,
      showBcvPrice: null,
      chargeRateKey: null,
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
          conversionCurrencies: null,
          showBcvPrice: null,
          chargeRateKey: null,
        },
      }),
    );
  });

  it('normaliza las conversiones del cajero (JSON, sin repetir y en mayúsculas)', async () => {
    upsert.mockResolvedValue({
      tipPercent: null,
      dialogView: null,
      priceCurrency: 'VES',
      conversionCurrencies: JSON.stringify(['USD', 'COP']),
      showBcvPrice: null,
      chargeRateKey: null,
    });

    const result = await service.update('c1', {
      conversionCurrencies: ['usd', ' COP ', 'usd', 'bolívares'],
    });

    // Los codigos invalidos se descartan y la lista viaja como JSON de texto.
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { conversionCurrencies: JSON.stringify(['USD', 'COP']) },
      }),
    );
    expect(result.conversionCurrencies).toEqual(['USD', 'COP']);
  });

  it('una lista vacía devuelve al cajero a su moneda (sin conversiones)', async () => {
    upsert.mockResolvedValue({ ...NO_PREFERENCES });

    const result = await service.update('c1', { conversionCurrencies: [] });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { conversionCurrencies: null } }),
    );
    expect(result.conversionCurrencies).toBeNull();
  });

  it('tolera una lista guardada corrupta o con ruido', async () => {
    findUnique.mockResolvedValue({
      tipPercent: null,
      dialogView: null,
      priceCurrency: null,
      conversionCurrencies: '{no es json}',
      showBcvPrice: null,
      chargeRateKey: null,
    });
    await expect(service.find('c1')).resolves.toEqual({ ...NO_PREFERENCES });

    findUnique.mockResolvedValue({
      tipPercent: null,
      dialogView: null,
      priceCurrency: null,
      conversionCurrencies: JSON.stringify(['cop', 'X', 7]),
      showBcvPrice: null,
    });
    const found = await service.find('c1');
    expect(found.conversionCurrencies).toEqual(['COP']);
  });

  it('guarda el precio en dolares del BCV y `false` o `null` lo apaga', async () => {
    upsert.mockResolvedValue({
      tipPercent: null,
      dialogView: null,
      priceCurrency: 'VES',
      conversionCurrencies: null,
      showBcvPrice: true,
      chargeRateKey: null,
    });

    const result = await service.update('c1', { showBcvPrice: true });

    expect(result.showBcvPrice).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { showBcvPrice: true } }),
    );

    await service.update('c1', { showBcvPrice: false });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { showBcvPrice: null } }),
    );

    await service.update('c1', { showBcvPrice: null });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { showBcvPrice: null } }),
    );
  });

  it('sin configurar, el precio en dolares del BCV no se muestra', async () => {
    findUnique.mockResolvedValue(null);
    const found = await service.find('c1');
    expect(found.showBcvPrice).toBeNull();
  });

  it('guarda la tasa de cobro del cajero y `null` vuelve a la tasa activa', async () => {
    upsert.mockResolvedValue({
      tipPercent: null,
      dialogView: null,
      priceCurrency: null,
      conversionCurrencies: null,
      showBcvPrice: null,
      chargeRateKey: 'CUSTOM_USD',
    });

    const result = await service.update('c1', { chargeRateKey: 'CUSTOM_USD' });

    expect(result.chargeRateKey).toBe('CUSTOM_USD');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { chargeRateKey: 'CUSTOM_USD' } }),
    );

    await service.update('c1', { chargeRateKey: null });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { chargeRateKey: null } }),
    );
  });

  it('normaliza la tasa de cobro y descarta cualquier otra tasa', async () => {
    await service.update('c1', { chargeRateKey: ' bcv_usd ' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { chargeRateKey: 'BCV_USD' } }),
    );

    // El euro (BCV_EUR) y cualquier valor inventado no se cobran con tasa fija.
    for (const value of ['BCV_EUR', 'dolares', '']) {
      await service.update('c1', { chargeRateKey: value });
    }
    expect(upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ update: { chargeRateKey: null } }),
    );
  });

  it('sin configurar, el cajero cobra con la tasa activa del sistema', async () => {
    findUnique.mockResolvedValue(null);
    const found = await service.find('c1');
    expect(found.chargeRateKey).toBeNull();
  });

  it('descarta una tasa de cobro guardada que no existe', async () => {
    findUnique.mockResolvedValue({
      tipPercent: null,
      dialogView: null,
      priceCurrency: null,
      conversionCurrencies: null,
      showBcvPrice: null,
      chargeRateKey: 'BCV_EUR',
    });
    const found = await service.find('c1');
    expect(found.chargeRateKey).toBeNull();
  });
});
