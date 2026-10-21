import type { SaleNotification } from '../notifications/notifications.service';
import type { AddOrderPaymentDto } from './dto/order.dto';

/** Tipos de trabajo que produce el modulo de pedidos. */
export const ORDER_PAYMENT_JOB = 'ORDER_PAYMENT';
export const SALE_NOTIFICATION_JOB = 'SALE_NOTIFICATION';

/** Cobro pendiente: se aplica cuando el worker toma el trabajo. */
export interface QueuedOrderPayment {
  companyId: string;
  orderId: string;
  userId: string;
  dto: AddOrderPaymentDto;
  /** Clave estable del cobro para que un reintento no lo aplique dos veces. */
  paymentKey: string;
  /** Estado que tenia el pedido antes de marcarlo PROCESSING. */
  previousStatus: string;
}

/** Aviso de venta encolado despues de que el pago quedo registrado. */
export interface QueuedSaleNotification {
  companyId: string;
  sale: SaleNotification;
  userId?: string;
}

export function isQueuedOrderPayment(
  value: unknown,
): value is QueuedOrderPayment {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<QueuedOrderPayment>;
  return Boolean(
    payload.companyId &&
      payload.orderId &&
      payload.userId &&
      payload.dto &&
      typeof payload.dto === 'object' &&
      payload.paymentKey &&
      payload.previousStatus,
  );
}

export function isQueuedSaleNotification(
  value: unknown,
): value is QueuedSaleNotification {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<QueuedSaleNotification>;
  return Boolean(
    payload.companyId &&
      payload.sale &&
      typeof payload.sale === 'object' &&
      payload.sale.orderCode,
  );
}
