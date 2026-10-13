import { PrismaService } from './prisma.service';

/**
 * Regresion del bug "Cannot read properties of undefined (reading
 * 'runInChildSpan')": los metodos del cliente que dependen de `this`
 * (`$transaction`, `$on`, ...) deben exponerse *bindeados*, de lo contrario al
 * llamarlos como `prisma.$transaction(...)` el `this` apunta al `PrismaService`
 * y no al cliente interno.
 */
describe('PrismaService (delegacion de metodos del cliente)', () => {
  let prisma: PrismaService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    // `client` es privado; se accede para cerrar el engine y no dejar handles.
    await (
      prisma as unknown as { client: { $disconnect(): Promise<void> } }
    ).client.$disconnect();
  });

  it('permite llamar a $transaction sin perder el `this`', async () => {
    // Una transaccion con lista vacia no toca la base y resuelve a [].
    await expect(prisma.$transaction([])).resolves.toEqual([]);
  });

  it('permite registrar eventos con $on (bindeado al cliente base)', () => {
    expect(() => prisma.$on('error', () => undefined)).not.toThrow();
  });

  it('expone los delegates de modelo', () => {
    expect(typeof prisma.product.findMany).toBe('function');
    expect(typeof prisma.order.create).toBe('function');
    expect(typeof prisma.cashMovement.aggregate).toBe('function');
  });
});
