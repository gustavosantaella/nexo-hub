import {
  INestApplication,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  applyMoneyCodec,
  type MoneyDbClient,
  type PrismaTx,
} from '../common/utils/money-codec';

/**
 * Cliente de Prisma que pueden recibir los servicios: el inyectado
 * (`PrismaService`) o el `tx` de una transaccion. Ambos llevan el codec de
 * dinero aplicado, por eso los helpers internos aceptan cualquiera de los dos.
 */
export type PrismaClientLike = PrismaService | PrismaTx;

/**
 * Firma de `$on` del cliente de Prisma, reescrita para conservar la sobrecarga
 * del evento `query` (devuelve `QueryEvent`, el resto `LogEvent`). El tipo
 * original vive en un generico de la clase que se pierde al indezar/bindear.
 */
type PrismaEventHandler = <V extends 'query' | 'info' | 'warn' | 'error'>(
  eventType: V,
  callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void,
) => void;

/**
 * Acceso a la base de datos.
 *
 * Envuelve un cliente de Prisma con el codec de dinero aplicado: el dinero se
 * guarda en centavos (entero) y este cliente traduce en la frontera, de modo
 * que los servicios siguen leyendo y escribiendo decimales (`194.34`) sin
 * conocer la representacion interna.
 *
 * Cada modelo se expone con un `get` en lugar de heredar de `PrismaClient`
 * porque `$extends` devuelve un cliente nuevo (no una instancia heredable), y
 * asi todas las llamadas existentes (`this.prisma.order.create(...)`) siguen
 * funcionando igual.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** Cliente base: expone los eventos de log (`$on`). */
  private readonly base: PrismaClient;

  /** Cliente con el codec de dinero (centavos <-> decimales). */
  private readonly client: MoneyDbClient;

  constructor() {
    this.base = new PrismaClient({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
    this.client = applyMoneyCodec(this.base);
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    this.logger.log('Conexion a la base de datos establecida');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /**
   * Habilita el apagado limpio al recibir senales del sistema (opcional).
   */
  enableShutdownHooks(app: INestApplication): void {
    process.on('beforeExit', () => {
      void app.close();
    });
  }

  // =============================== Modelos ==================================
  // Cada `get` delega en el cliente extendido: los montos ya vienen en
  // decimales al leer y se convierten a centavos al escribir.

  get user() {
    return this.client.user;
  }
  get category() {
    return this.client.category;
  }
  get supplier() {
    return this.client.supplier;
  }
  get customer() {
    return this.client.customer;
  }
  get product() {
    return this.client.product;
  }
  get stockMovement() {
    return this.client.stockMovement;
  }
  get order() {
    return this.client.order;
  }
  get orderItem() {
    return this.client.orderItem;
  }
  get orderPayment() {
    return this.client.orderPayment;
  }
  get expense() {
    return this.client.expense;
  }
  get accountPayable() {
    return this.client.accountPayable;
  }
  get payablePayment() {
    return this.client.payablePayment;
  }
  get accountReceivable() {
    return this.client.accountReceivable;
  }
  get receivablePayment() {
    return this.client.receivablePayment;
  }
  get cashSession() {
    return this.client.cashSession;
  }
  get cashMovement() {
    return this.client.cashMovement;
  }
  get setting() {
    return this.client.setting;
  }

  // ==================== Transacciones y consultas crudas ====================
  // `$queryRaw` / `$executeRaw` hablan SQL directo: no pasan por el codec, los
  // montos llegan en centavos. Usarlos solo cuando el SQL lo tenga en cuenta.
  //
  // Estos metodos se exponen *bindeados* al cliente: a diferencia de los
  // delegates de modelo (`product`, `order`, ...), que son objetos con su propio
  // estado, `$transaction`/`$queryRaw`/... leen datos internos del cliente a
  // traves de `this`. Si se devolviera la funcion sin bind, al llamarla como
  // `prisma.$transaction(...)` el `this` seria el `PrismaService` y reventaria
  // con "Cannot read properties of undefined (reading 'runInChildSpan')".

  get $transaction() {
    return this.client.$transaction.bind(this.client);
  }
  get $queryRaw() {
    return this.client.$queryRaw.bind(this.client);
  }
  get $executeRaw() {
    return this.client.$executeRaw.bind(this.client);
  }
  get $queryRawUnsafe() {
    return this.client.$queryRawUnsafe.bind(this.client);
  }
  get $executeRawUnsafe() {
    return this.client.$executeRawUnsafe.bind(this.client);
  }
  /**
   * Los eventos de log viven en el cliente base (`$extends` no los expone).
   * Se conserva la firma sobrecargada de `$on` (evento + callback) pese al bind.
   */
  get $on(): PrismaEventHandler {
    return this.base.$on.bind(this.base) as PrismaEventHandler;
  }
}
