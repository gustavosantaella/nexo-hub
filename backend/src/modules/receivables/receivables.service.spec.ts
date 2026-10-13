import { BadRequestException } from '@nestjs/common';
import { convertToBase } from '../../common/utils/currency.util';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CashService } from '../cash/cash.service';
import type { RatesService } from '../rates/rates.service';
import { ReceivablesService } from './receivables.service';

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

/** Cuenta por cobrar como la entrega el codec (montos en decimales). */
function account(partial: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    companyId: COMPANY_ID,
    customerId: 'c1',
    orderId: null,
    description: 'Venta a credito',
    amount: 9000, // 9000 VES
    currency: 'VES',
    exchangeRate: 1,
    baseAmount: 10, // = 10 USD
    paidAmount: 0,
    dueDate: null,
    status: 'PENDING',
    reference: null,
    notes: null,
    createdById: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
    customer: null,
    payments: [],
    ...partial,
  };
}

/** Servicio con Prisma simulado; `cash` no se usa en estos casos. */
function buildService(prisma: Record<string, unknown>) {
  return new ReceivablesService(
    prisma as unknown as PrismaService,
    {} as CashService,
    rates,
  );
}

describe('ReceivablesService (moneda de la cuenta)', () => {
  it('guarda el monto en la moneda elegida y su equivalente en USD', async () => {
    const create = jest.fn(
      async (args: { data: Record<string, unknown> }) =>
        account({ ...args.data, id: 'r1' }),
    );
    const service = buildService({ accountReceivable: { create } });

    const created = await service.create(
      COMPANY_ID,
      { description: 'Venta a credito', amount: 9000, currency: 'VES' },
      'u1',
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 9000,
          currency: 'VES',
          exchangeRate: 1,
          baseAmount: 10,
        }),
      }),
    );
    expect(created.balance).toBe(10);
    expect(created.status).toBe('PENDING');
  });

  it('exige una tasa configurada para la moneda elegida', async () => {
    const create = jest.fn();
    const service = buildService({ accountReceivable: { create } });

    await expect(
      service.create(
        COMPANY_ID,
        { description: 'Venta a credito', amount: 100, currency: 'EUR' },
        'u1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('deriva estado y saldo del equivalente en USD, no del monto en la moneda', async () => {
    const service = buildService({
      accountReceivable: {
        findFirst: jest.fn(async () =>
          account({ paidAmount: 4, status: 'PARTIAL' }),
        ),
      },
    });

    const found = await service.findOne(COMPANY_ID, 'r1');

    // 9000 VES de monto, pero 10 USD de equivalente y 4 USD cobrados.
    expect(found.balance).toBe(6);
    expect(found.status).toBe('PARTIAL');
  });

  it('rechaza un cobro que supera el saldo pendiente en USD', async () => {
    const service = buildService({
      accountReceivable: {
        findFirst: jest.fn(async () =>
          account({ paidAmount: 9.5, status: 'PARTIAL' }),
        ),
      },
    });

    // 9000 VES equivalen a 10 USD y el saldo es de solo 0.5 USD.
    await expect(
      service.collect(
        COMPANY_ID,
        'r1',
        { amount: 9000, currency: 'VES' },
        'u1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
