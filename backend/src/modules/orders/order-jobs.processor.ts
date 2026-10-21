import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NonRetryableJobError,
  QueueService,
  type JobContext,
} from '../queue/queue.service';
import {
  isQueuedOrderPayment,
  isQueuedSaleNotification,
  ORDER_PAYMENT_JOB,
  SALE_NOTIFICATION_JOB,
} from './order-jobs';
import { OrdersService } from './orders.service';

/**
 * Workers del modulo de pedidos.
 *
 * El cobro corre fuera del request: la caja, el pago y el estado COMPLETED se
 * aplican en un trabajo persistente. El aviso de Telegram se encola aparte para
 * que un fallo del bot nunca retrase ni tumbe el cobro.
 */
@Injectable()
export class OrderJobsProcessor implements OnModuleInit {
  private readonly logger = new Logger(OrderJobsProcessor.name);

  constructor(
    private readonly queue: QueueService,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.queue.register(ORDER_PAYMENT_JOB, {
      handler: (payload) => this.processPayment(payload),
      onFailed: (error, context) => this.releasePayment(error, context),
    });
    this.queue.register(SALE_NOTIFICATION_JOB, {
      handler: (payload) => this.sendSaleNotification(payload),
    });
  }

  private async processPayment(payload: unknown): Promise<void> {
    if (!isQueuedOrderPayment(payload)) {
      throw new NonRetryableJobError(
        'El trabajo de cobro no tiene los datos completos',
      );
    }

    try {
      await this.orders.processQueuedPayment(payload);
    } catch (error) {
      // Un pago invalido no mejora reintentandolo: se marca fallido de una vez
      // y el callback onFailed devuelve el pedido a su estado anterior.
      if (isBusinessError(error)) {
        throw new NonRetryableJobError(error.message);
      }
      throw error;
    }
  }

  private async releasePayment(
    error: unknown,
    context: JobContext,
  ): Promise<void> {
    // `context.payload` viaja ya decodificado: con el se restaura el estado que
    // tenia el pedido antes de marcarlo PROCESSING.
    if (isQueuedOrderPayment(context.payload)) {
      await this.orders.releaseQueuedPayment(
        context.payload.companyId,
        context.payload.orderId,
        context.payload.previousStatus,
      );
    }
    this.logger.error(
      `Cobro ${context.id} no se pudo aplicar: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  private async sendSaleNotification(payload: unknown): Promise<void> {
    if (!isQueuedSaleNotification(payload)) {
      throw new NonRetryableJobError(
        'El trabajo de notificacion no tiene los datos completos',
      );
    }
    await this.notifications.notifySale(
      payload.companyId,
      payload.sale,
      payload.userId,
    );
  }
}

function isBusinessError(
  error: unknown,
): error is BadRequestException | NotFoundException | ConflictException {
  return (
    error instanceof BadRequestException ||
    error instanceof NotFoundException ||
    error instanceof ConflictException
  );
}
