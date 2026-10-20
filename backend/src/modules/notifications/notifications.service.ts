import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import { randomInt } from 'crypto';
import type { RateHistory } from '../rates/rates.service';
import type { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import {
  NotificationsRepository,
  type NotificationSettingRow,
} from './notifications.repository';
import {
  TelegramService,
  escapeHtml,
  type TelegramChat,
  type TelegramMessage,
} from './telegram.service';

/** Vigencia del codigo que vincula el chat del administrador. */
const LINK_CODE_TTL_MS = 15 * 60 * 1000;

/** Vigencia del OTP de cancelacion: exactamente 10 minutos. */
export const CANCELLATION_OTP_TTL_MS = 10 * 60 * 1000;

/** Letras sin caracteres ambiguos (no se confunden al dictar el codigo). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

/** Configuracion que ve la pantalla de Configuracion → Notificaciones. */
export interface NotificationSettings {
  /** `true` si el despliegue tiene token del bot. */
  telegramConfigured: boolean;
  telegramEnabled: boolean;
  notifyLowStock: boolean;
  notifySales: boolean;
  notifyCashClose: boolean;
  notifyCancellations: boolean;
  telegramLinked: boolean;
  telegramChatTitle: string | null;
  telegramLinkedAt: string | null;
  /** Codigo vigente para enviar `/vincular CODIGO` al bot. */
  linkCode: string | null;
  linkCodeExpiresAt: string | null;
  /** `@usuario` del bot, para mostrar las instrucciones. */
  botUsername: string | null;
  updatedAt: string | null;
}

export interface LinkCodeResult {
  code: string;
  expiresAt: string;
  botUsername: string | null;
  deepLink: string | null;
}

/** Datos del cobro que se resumen en el aviso de venta. */
export interface SaleNotification {
  orderCode: string;
  total: number;
  paidNow: number;
  paidTotal: number;
  paymentCurrency: string;
  method: string;
  /** Tasas vigentes al momento del cobro (para mostrar equivalencias exactas). */
  rates?: RateHistory | null;
  /** Referencia bancaria del comprobante (transferencia / pago movil). */
  paymentReference?: string | null;
  /** Foto del comprobante como data URL. */
  paymentPhotoUrl?: string | null;
  items: { name: string; quantity: number }[];
}

/** Producto que acaba de cruzar su stock minimo. */
export interface LowStockNotification {
  name: string;
  sku: string | null;
  stock: number;
  minStock: number;
  unit: string;
}

/** Resumen del cierre de caja que se envia al administrador. */
export interface CashCloseNotification {
  code: string;
  openedAt: string | null;
  closedAt: string | null;
  salesTotal: number;
  totalIn: number;
  expectedCash: number;
  countedAmount: number;
  difference: number;
  result: string;
  movementCount: number;
}

export interface CancellationNotification {
  orderCode: string;
  total: number;
  items: { name: string; quantity: number }[];
  usedOtp: boolean;
}

/** Datos de la orden para emitir el OTP de cancelacion. */
export interface CancellationOtpRequest {
  orderId: string;
  orderCode: string;
  total: number;
  items: { name: string; quantity: number }[];
  requestedById: string;
}

const NO_SETTINGS: Omit<
  NotificationSettings,
  'telegramConfigured' | 'botUsername'
> = {
  telegramEnabled: false,
  notifyLowStock: true,
  notifySales: true,
  notifyCashClose: true,
  notifyCancellations: true,
  telegramLinked: false,
  telegramChatTitle: null,
  telegramLinkedAt: null,
  linkCode: null,
  linkCodeExpiresAt: null,
  updatedAt: null,
};

/** Codigo de 8 letras en mayusculas, generado con aleatoriedad criptografica. */
export function randomUppercaseCode(length = CODE_LENGTH): string {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Formato corto de montos en la moneda base (USD). */
function usd(value: number): string {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

/** Monto con dos decimales para las equivalencias del aviso. */
function amount(value: number): string {
  return Number(value ?? 0).toFixed(2);
}

/** Tasa de una clave de la foto tomada al momento del cobro. */
function rateOf(sale: SaleNotification, key: string): number | null {
  const found = sale.rates?.rates.find((rate) => rate.key === key);
  return found && Number.isFinite(found.rate) && found.rate > 0
    ? found.rate
    : null;
}

/**
 * Equivalencias del monto cobrado en las otras monedas del local.
 *
 * Se usan las tasas guardadas con el cobro (no las vigentes ahora), para que el
 * aviso muestre exactamente la conversion de ese pago:
 * - pago en VES -> dolares a la tasa personalizada (si existe), dolares BCV y euros BCV.
 * - pago en USD -> bolivares a la tasa personalizada (si existe), bolivares BCV y euros BCV.
 */
function equivalenceLines(sale: SaleNotification): string[] {
  const paid = Number(sale.paidNow);
  if (!Number.isFinite(paid) || paid <= 0) return [];

  const currency = String(sale.paymentCurrency ?? '').trim().toUpperCase();
  const bcvUsd = rateOf(sale, 'BCV_USD');
  const bcvEur = rateOf(sale, 'BCV_EUR');
  const customUsd = rateOf(sale, 'CUSTOM_USD');
  const lines: string[] = [];

  if (currency === 'VES') {
    if (customUsd) {
      lines.push(`• Dólares (tasa personalizada): $${amount(paid / customUsd)}`);
    }
    if (bcvUsd) {
      lines.push(`• Dólares (BCV): $${amount(paid / bcvUsd)}`);
    }
    if (bcvEur) {
      lines.push(`• Euros (BCV): €${amount(paid / bcvEur)}`);
    }
  } else if (currency === 'USD') {
    if (customUsd) {
      lines.push(`• Bolívares (tasa personalizada): Bs ${amount(paid * customUsd)}`);
    }
    if (bcvUsd) {
      lines.push(`• Bolívares (BCV): Bs ${amount(paid * bcvUsd)}`);
    }
    if (bcvUsd && bcvEur) {
      lines.push(`• Euros (BCV): €${amount((paid * bcvUsd) / bcvEur)}`);
    }
  }

  return lines;
}

/** Fecha/hora local corta para los mensajes de Telegram. */
function when(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-VE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Lista de productos de un pedido (limitada para no superar el mensaje). */
function itemsText(items: readonly { name: string; quantity: number }[]): string {
  if (items.length === 0) return '• Sin productos';
  const visible = items.slice(0, 10);
  const lines = visible.map(
    (item) => `• ${item.quantity} × ${escapeHtml(item.name)}`,
  );
  if (items.length > visible.length) {
    lines.push(`• … y ${items.length - visible.length} más`);
  }
  return lines.join('\n');
}

function toSettings(
  row: NotificationSettingRow | null,
  telegramConfigured: boolean,
  botUsername: string | null,
): NotificationSettings {
  const now = Date.now();
  const linkCode =
    row?.telegramLinkCode &&
    row.telegramLinkCodeExpiresAt &&
    row.telegramLinkCodeExpiresAt.getTime() > now
      ? row.telegramLinkCode
      : null;

  return {
    ...NO_SETTINGS,
    ...(row
      ? {
          telegramEnabled: row.telegramEnabled,
          notifyLowStock: row.notifyLowStock,
          notifySales: row.notifySales,
          notifyCashClose: row.notifyCashClose,
          notifyCancellations: row.notifyCancellations,
          telegramLinked: !!row.telegramChatId,
          telegramChatTitle: row.telegramChatTitle ?? null,
          telegramLinkedAt: row.telegramLinkedAt?.toISOString() ?? null,
          linkCode,
          linkCodeExpiresAt: linkCode
            ? row.telegramLinkCodeExpiresAt?.toISOString() ?? null
            : null,
          updatedAt: row.updatedAt.toISOString(),
        }
      : {}),
    telegramConfigured,
    botUsername,
  };
}

/**
 * Notificaciones del local por Telegram y OTP de cancelacion.
 *
 * El servicio es el unico que conoce el token del bot, el chat vinculado y los
 * codigos temporales. Los avisos atrapan sus propios errores: si Telegram esta
 * caido, la venta/cierre/cancelacion sigue funcionando.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly pollingEnabled: boolean;
  private pollAbort: AbortController | null = null;
  private pollingStopped = false;
  private updateOffset = 0;

  constructor(
    private readonly notifications: NotificationsRepository,
    private readonly telegram: TelegramService,
    config: ConfigService,
  ) {
    this.pollingEnabled = config.get<boolean>('telegram.polling') ?? false;
  }

  onModuleInit(): void {
    if (!this.telegram.configured || !this.pollingEnabled) return;
    this.pollAbort = new AbortController();
    void this.pollingLoop();
  }

  onModuleDestroy(): void {
    this.pollingStopped = true;
    this.pollAbort?.abort();
  }

  /** Configuracion de notificaciones de la empresa. */
  async getSettings(companyId: string): Promise<NotificationSettings> {
    const [row, bot] = await Promise.all([
      this.notifications.findSettings(companyId),
      this.telegram.getBotInfo(),
    ]);
    return toSettings(row, this.telegram.configured, bot?.username ?? null);
  }

  /** Guarda las opciones enviadas y devuelve el estado completo. */
  async updateSettings(
    companyId: string,
    dto: UpdateNotificationSettingsDto,
  ): Promise<NotificationSettings> {
    const update = {
      ...(dto.telegramEnabled !== undefined
        ? { telegramEnabled: dto.telegramEnabled }
        : {}),
      ...(dto.notifyLowStock !== undefined
        ? { notifyLowStock: dto.notifyLowStock }
        : {}),
      ...(dto.notifySales !== undefined ? { notifySales: dto.notifySales } : {}),
      ...(dto.notifyCashClose !== undefined
        ? { notifyCashClose: dto.notifyCashClose }
        : {}),
      ...(dto.notifyCancellations !== undefined
        ? { notifyCancellations: dto.notifyCancellations }
        : {}),
    };

    await this.notifications.upsertSettings(
      companyId,
      {
        companyId,
        telegramEnabled: dto.telegramEnabled ?? false,
        notifyLowStock: dto.notifyLowStock ?? true,
        notifySales: dto.notifySales ?? true,
        notifyCashClose: dto.notifyCashClose ?? true,
        notifyCancellations: dto.notifyCancellations ?? true,
      },
      update,
    );
    return this.getSettings(companyId);
  }

  /**
   * Genera un codigo temporal para que el administrador lo envie al bot como
   * `/vincular CODIGO` (o `/start CODIGO`). Al recibirlo, el bot guarda su chat.
   */
  async issueLinkCode(companyId: string): Promise<LinkCodeResult> {
    if (!this.telegram.configured) {
      throw new ServiceUnavailableException(
        'El bot de Telegram no está configurado en el servidor (TELEGRAM_BOT_API_TOKEN).',
      );
    }

    const code = randomUppercaseCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await this.notifications.upsertSettings(
      companyId,
      { companyId, telegramLinkCode: code, telegramLinkCodeExpiresAt: expiresAt },
      { telegramLinkCode: code, telegramLinkCodeExpiresAt: expiresAt },
    );

    const bot = await this.telegram.getBotInfo();
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      botUsername: bot?.username ?? null,
      deepLink: bot?.username ? `https://t.me/${bot.username}?start=${code}` : null,
    };
  }

  /** Desvincula el chat del administrador; deja de recibir avisos. */
  async unlink(companyId: string): Promise<NotificationSettings> {
    await this.notifications.upsertSettings(
      companyId,
      { companyId },
      {
        telegramChatId: null,
        telegramChatTitle: null,
        telegramLinkedAt: null,
        telegramLinkCode: null,
        telegramLinkCodeExpiresAt: null,
      },
    );
    return this.getSettings(companyId);
  }

  /** Envia un mensaje de prueba al chat vinculado. */
  async sendTest(companyId: string): Promise<{ sent: boolean }> {
    const row = await this.notifications.findSettings(companyId);
    if (!row?.telegramChatId) {
      throw new BadRequestException(
        'Primero vincula el Telegram del administrador escaneando el QR.',
      );
    }
    const sent = await this.telegram.sendMessage(
      row.telegramChatId,
      '✅ <b>Nexo Hub conectado</b>\nLos avisos de esta empresa llegarán a este chat.',
    );
    if (!sent) {
      throw new ServiceUnavailableException(
        'Telegram no confirmó el mensaje. Revisa el token del bot e inténtalo de nuevo.',
      );
    }
    return { sent: true };
  }


  /**
   * Emite el OTP de cancelacion y lo envia al administrador. Sin Telegram
   * vinculado no se genera: el cajero no puede cancelar por su cuenta.
   */
  async requestCancellationOtp(
    companyId: string,
    request: CancellationOtpRequest,
  ): Promise<{ expiresAt: string }> {
    const row = await this.notifications.findSettings(companyId);
    if (!row?.telegramEnabled || !row.telegramChatId) {
      throw new BadRequestException(
        'El administrador no tiene Telegram vinculado. No se puede cancelar el pedido sin su autorización.',
      );
    }

    const code = randomUppercaseCode();
    const expiresAt = new Date(Date.now() + CANCELLATION_OTP_TTL_MS);
    const codeHash = await hash(code, 10);

    await this.notifications.invalidateOrderOtps(companyId, request.orderId);
    const otp = await this.notifications.createOtp({
      companyId,
      orderId: request.orderId,
      requestedById: request.requestedById,
      codeHash,
      expiresAt,
    });

    const cashier = await this.notifications.findUserName(request.requestedById);
    const text = [
      '🔐 <b>Autorización para cancelar un pedido</b>',
      '',
      `<b>Pedido:</b> ${escapeHtml(request.orderCode)}`,
      `<b>Total:</b> ${usd(request.total)}`,
      `<b>Cajero:</b> ${escapeHtml(cashier?.name ?? 'Cajero')}`,
      '',
      itemsText(request.items),
      '',
      `<b>Código:</b> <code>${code}</code>`,
      'Válido durante <b>10 minutos</b> y de un solo uso.',
      'El cajero debe escribirlo en el sistema para confirmar la cancelación.',
    ].join('\n');

    const sent = await this.telegram.sendMessage(row.telegramChatId, text);
    if (!sent) {
      await this.notifications.markOtpUsed(otp.id);
      throw new ServiceUnavailableException(
        'No se pudo enviar el código por Telegram. El pedido no se puede cancelar todavía.',
      );
    }

    return { expiresAt: expiresAt.toISOString() };
  }

  /**
   * Valida el codigo del cajero sin consumirlo (la cancelacion lo consume al
   * completarse). Devuelve el id del OTP o `null` si no es valido/vencio.
   */
  async validateCancellationCode(
    companyId: string,
    orderId: string,
    code: string,
  ): Promise<string | null> {
    const normalized = String(code ?? '').trim().toUpperCase();
    if (!new RegExp(`^[A-Z]{${CODE_LENGTH}}$`).test(normalized)) return null;

    const otp = await this.notifications.findLatestOtp(companyId, orderId);
    if (!otp || otp.expiresAt.getTime() <= Date.now()) return null;
    return (await compare(normalized, otp.codeHash)) ? otp.id : null;
  }

  /** Consume el OTP una vez que el pedido quedo cancelado. */
  async consumeCancellationCode(id: string): Promise<void> {
    await this.notifications.markOtpUsed(id);
  }


  // =========================================================================
  //  AVISOS AUTOMATICOS
  // =========================================================================

  /** Avisa una venta/cobro con el resumen de lo cobrado y sus equivalencias. */
  async notifySale(
    companyId: string,
    sale: SaleNotification,
    userId?: string,
  ): Promise<boolean> {
    try {
      return await this.deliverSale(companyId, sale, userId);
    } catch (error) {
      this.logger.warn(`No se pudo enviar el aviso de venta: ${this.errorText(error)}`);
      return false;
    }
  }

  private async deliverSale(
    companyId: string,
    sale: SaleNotification,
    userId?: string,
  ): Promise<boolean> {
    const row = await this.notifications.findSettings(companyId);
    if (!row?.telegramEnabled || !row.telegramChatId || !row.notifySales) {
      return false;
    }

    const cashier = userId
      ? await this.notifications.findUserName(userId)
      : null;
    const equivalents = equivalenceLines(sale);
    const text = [
      '💳 <b>Venta / cobro registrado</b>',
      '',
      `<b>Pedido:</b> ${escapeHtml(sale.orderCode)}`,
      `<b>Cobrado ahora:</b> ${escapeHtml(sale.paymentCurrency)} ${sale.paidNow.toFixed(2)}`,
      ...(equivalents.length > 0
        ? ['<b>Equivalencias:</b>', ...equivalents]
        : []),
      `<b>Método:</b> ${escapeHtml(sale.method)}`,
      ...(sale.paymentReference
        ? [`<b>Referencia:</b> ${escapeHtml(sale.paymentReference)}`]
        : []),
      `<b>Total del pedido:</b> ${usd(sale.total)}`,
      `<b>Acumulado:</b> ${usd(sale.paidTotal)}`,
      `<b>Cajero:</b> ${escapeHtml(cashier?.name ?? '—')}`,
      `<b>Fecha:</b> ${when(new Date())}`,
      '',
      itemsText(sale.items),
    ].join('\n');

    // El comprobante viaja como foto con el resumen de pie de foto. Si el
    // envio de la imagen falla, el aviso de texto igual llega.
    if (sale.paymentPhotoUrl) {
      const sentPhoto = await this.telegram.sendPhoto(
        row.telegramChatId,
        sale.paymentPhotoUrl,
        text,
      );
      if (sentPhoto) return true;
    }

    return this.telegram.sendMessage(row.telegramChatId, text);
  }

  /** Avisa cuando un producto cruza su stock minimo (sin repetir cada venta). */
  async notifyLowStock(
    companyId: string,
    product: LowStockNotification,
  ): Promise<boolean> {
    try {
      return await this.deliverLowStock(companyId, product);
    } catch (error) {
      this.logger.warn(`No se pudo enviar el aviso de stock: ${this.errorText(error)}`);
      return false;
    }
  }

  private async deliverLowStock(
    companyId: string,
    product: LowStockNotification,
  ): Promise<boolean> {
    const row = await this.notifications.findSettings(companyId);
    if (!row?.telegramEnabled || !row.telegramChatId || !row.notifyLowStock) {
      return false;
    }

    const text = [
      '⚠️ <b>Stock en el mínimo</b>',
      '',
      `<b>Producto:</b> ${escapeHtml(product.name)}`,
      product.sku ? `<b>SKU:</b> ${escapeHtml(product.sku)}` : '',
      `<b>Stock actual:</b> ${product.stock} ${escapeHtml(product.unit)}`,
      `<b>Mínimo:</b> ${product.minStock} ${escapeHtml(product.unit)}`,
      '',
      'Repón existencias para no quedarte sin venta.',
    ]
      .filter(Boolean)
      .join('\n');

    return this.telegram.sendMessage(row.telegramChatId, text);
  }


  /** Avisa el cierre de caja con lo recaudado y la diferencia del arqueo. */
  async notifyCashClose(
    companyId: string,
    close: CashCloseNotification,
  ): Promise<boolean> {
    try {
      return await this.deliverCashClose(companyId, close);
    } catch (error) {
      this.logger.warn(`No se pudo enviar el cierre de caja: ${this.errorText(error)}`);
      return false;
    }
  }

  private async deliverCashClose(
    companyId: string,
    close: CashCloseNotification,
  ): Promise<boolean> {
    const row = await this.notifications.findSettings(companyId);
    if (!row?.telegramEnabled || !row.telegramChatId || !row.notifyCashClose) {
      return false;
    }

    const resultLabel =
      close.result === 'SURPLUS'
        ? 'Sobrante'
        : close.result === 'SHORTAGE'
          ? 'Faltante'
          : 'Cuadrado';
    const text = [
      '🧾 <b>Cierre de caja</b>',
      '',
      `<b>Sesión:</b> ${escapeHtml(close.code)}`,
      `<b>Apertura:</b> ${when(close.openedAt)}`,
      `<b>Cierre:</b> ${when(close.closedAt)}`,
      '',
      `<b>Ventas netas:</b> ${usd(close.salesTotal)}`,
      `<b>Total recaudado (ingresos):</b> ${usd(close.totalIn)}`,
      `<b>Efectivo esperado:</b> ${usd(close.expectedCash)}`,
      `<b>Efectivo contado:</b> ${usd(close.countedAmount)}`,
      `<b>Diferencia:</b> ${usd(close.difference)} (${resultLabel})`,
      `<b>Movimientos:</b> ${close.movementCount}`,
    ].join('\n');

    return this.telegram.sendMessage(row.telegramChatId, text);
  }

  /** Avisa una cancelacion (el OTP ya se envio al pedir la autorizacion). */
  async notifyCancellation(
    companyId: string,
    cancellation: CancellationNotification,
    userId?: string,
  ): Promise<boolean> {
    try {
      return await this.deliverCancellation(companyId, cancellation, userId);
    } catch (error) {
      this.logger.warn(
        `No se pudo enviar el aviso de cancelación: ${this.errorText(error)}`,
      );
      return false;
    }
  }

  private async deliverCancellation(
    companyId: string,
    cancellation: CancellationNotification,
    userId?: string,
  ): Promise<boolean> {
    const row = await this.notifications.findSettings(companyId);
    if (
      !row?.telegramEnabled ||
      !row.telegramChatId ||
      !row.notifyCancellations
    ) {
      return false;
    }

    const cashier = userId
      ? await this.notifications.findUserName(userId)
      : null;
    const text = [
      '🚫 <b>Pedido cancelado</b>',
      '',
      `<b>Pedido:</b> ${escapeHtml(cancellation.orderCode)}`,
      `<b>Total:</b> ${usd(cancellation.total)}`,
      `<b>Cancelado por:</b> ${escapeHtml(cashier?.name ?? '—')}`,
      `<b>Autorización OTP:</b> ${
        cancellation.usedOtp ? 'Sí' : 'No (admin/manager)'
      }`,
      `<b>Fecha:</b> ${when(new Date())}`,
      '',
      itemsText(cancellation.items),
    ].join('\n');
    return this.telegram.sendMessage(row.telegramChatId, text);
  }


  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  // =========================================================================
  //  VINCULACION POR LONG POLLING
  // =========================================================================

  private async pollingLoop(): Promise<void> {
    this.logger.log('Escuchando mensajes del bot de Telegram para vincular chats');
    while (!this.pollingStopped) {
      try {
        const updates = await this.telegram.getUpdates(
          this.updateOffset,
          this.pollAbort?.signal,
        );
        for (const update of updates) {
          this.updateOffset = Math.max(this.updateOffset, update.update_id + 1);
          await this.handleUpdate(update.message);
        }
      } catch (error) {
        if (this.pollingStopped) break;
        this.logger.warn(
          `No se pudieron leer los mensajes de Telegram: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private async handleUpdate(message?: TelegramMessage): Promise<void> {
    const text = message?.text?.trim();
    if (!message || !text) return;

    const match =
      /^\/(?:start|vincular)(?:@\w+)?(?:\s+([A-Za-z0-9]{8}))?\s*$/.exec(text);
    if (!match) return;

    const chatId = String(message.chat.id);
    const code = match[1]?.toUpperCase();
    if (!code) {
      await this.telegram.sendMessage(
        chatId,
        [
          '👋 <b>Nexo Hub</b>',
          '',
          'Para vincular este chat con tu empresa:',
          '1. Entra en Configuración → Notificaciones.',
          '2. Genera el código de vinculación.',
          '3. Envía aquí: <code>/vincular CODIGO</code>',
        ].join('\n'),
      );
      return;
    }

    const pending = await this.notifications.findSettingsByLinkCode(code);
    if (!pending) {
      await this.telegram.sendMessage(
        chatId,
        '❌ El código no existe o venció. Genera uno nuevo en Configuración → Notificaciones.',
      );
      return;
    }

    const other = await this.notifications.findCompanyByChat(chatId);
    if (other && other.companyId !== pending.companyId) {
      await this.telegram.sendMessage(
        chatId,
        `❌ Este chat ya está vinculado a <b>${escapeHtml(other.company.name)}</b>. Desvincúlalo allí antes de usarlo en otra empresa.`,
      );
      return;
    }

    await this.notifications.upsertSettings(
      pending.companyId,
      { companyId: pending.companyId },
      {
        telegramEnabled: true,
        telegramChatId: chatId,
        telegramChatTitle: this.chatTitle(message.chat),
        telegramLinkedAt: new Date(),
        telegramLinkCode: null,
        telegramLinkCodeExpiresAt: null,
      },
    );

    await this.telegram.sendMessage(
      chatId,
      [
        '✅ <b>Telegram vinculado</b>',
        '',
        `Este chat recibirá los avisos de <b>${escapeHtml(pending.company.name)}</b>.`,
        'Ya puedes cerrar esta conversación: los avisos llegarán automáticamente.',
      ].join('\n'),
    );
  }

  private chatTitle(chat: TelegramChat): string {
    const name = [chat.first_name, chat.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    return chat.title ?? (name || chat.username || String(chat.id));
  }
}

