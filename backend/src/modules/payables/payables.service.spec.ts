import { BadRequestException } from '@nestjs/common';
import { convertToBase } from '../../common/utils/currency.util';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CashService } from '../cash/cash.service';
import type { RatesService } from '../rates/rates.service';
import { PayablesRepository } from './payables.repository';
import { PayablesService } from './payables.service';

/** Tasa del dolar usada en las pruebas (Bs por USD): 1 VES = 1/900 USD. */
const BS_PER_USD = 900;

/** Empresa activa en las pruebas: el `companyId` viaja en el token. */
const COMPANY_ID = 'company-1';

/** `RatesService` simulado: 900 Bs por USD, 1 Bs por VES (sin tasa para el resto). */
const rates = {
  resolvePayment: async (
    _companyId: string,
    amount: number,
    currency?: string | null,
  ) => {
    const code = String(currency ?? 'USD').toUpperCase();
    const bsPerCurrency =
      code === 'VES' ? 1 : code === 'USD' ? BS_PER_USD : null;
    const converted = convertToBase(amount, code, {
      bsPerUsd: BS_PER_USD,
      bsPerCurrency,
    });
    if (!converted) {
      throw new BadRequestException(`Falta la tasa de ${code}`);
    }
    return converted;
  },
} as unknown as RatesService;

/** Cuenta por pagar como la entrega el codec (montos en decimales). */
function account(partial: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    companyId: COMPANY_ID,
    supplierId: 's1',
    description: 'Compra a credito',
    amount: 4500, // 4500 VES
    currency: 'VES',
    exchangeRate: 1,
    baseAmount: 5, // = 5 USD
    paidAmount: 0,
    dueDate: null,
    status: 'PENDING',
    reference: null,
    notes: null,
    createdById: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    supplier: null,
    payments: [],
    ...partial,
  };
}

/** Servicio con Prisma simulado (via repositorio); `cash` no se usa aqui. */
function buildService(prisma: Record<string, unknown>) {
  return new PayablesService(
    new PayablesRepository(prisma as unknown as PrismaService),
    {} as CashService,
    rates,
  );
}

describe('PayablesService (moneda de la cuenta)', () => {
  it('guarda el monto en la moneda elegida y su equivalente en USD', async () => {
    const create = jest.fn(
      async (args: { data: Record<string, unknown> }) =>
        account({ ...args.data, id: 'p1' }),
    );
    const service = buildService({ accountPayable: { create } });

    const created = await service.create(
      COMPANY_ID,
      { description: 'Compra a credito', amount: 4500, currency: 'VES' },
      'u1',
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 4500,
          currency: 'VES',
          exchangeRate: 1,
          baseAmount: 5,
        }),
      }),
    );
    expect(created.balance).toBe(5);
    expect(created.status).toBe('PENDING');
  });

  it('exige una tasa configurada para la moneda elegida', async () => {
    const create = jest.fn();
    const service = buildService({ accountPayable: { create } });

    await expect(
      service.create(
        COMPANY_ID,
        { description: 'Compra a credito', amount: 100, currency: 'EUR' },
        'u1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('deriva estado y saldo del equivalente en USD, no del monto en la moneda', async () => {
    const service = buildService({
      accountPayable: {
        findFirst: jest.fn(async () =>
          account({ paidAmount: 2, status: 'PARTIAL' }),
        ),
      },
    });

    const found = await service.findOne(COMPANY_ID, 'p1');

    // 4500 VES de monto, pero 5 USD de equivalente y 2 USD abonados.
    expect(found.balance).toBe(3);
    expect(found.status).toBe('PARTIAL');
  });

  it('rechaza un abono que supera el saldo pendiente en USD', async () => {
    const service = buildService({
      accountPayable: {
        findFirst: jest.fn(async () =>
          account({ paidAmount: 4.5, status: 'PARTIAL' }),
        ),
      },
    });

    // 4500 VES equivalen a 5 USD y el saldo es de solo 0.5 USD.
    await expect(
      service.addPayment(
        COMPANY_ID,
        'p1',
        { amount: 4500, currency: 'VES' },
        'u1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
