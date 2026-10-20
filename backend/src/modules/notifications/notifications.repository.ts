import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Columnas de la configuracion que viajan al servicio (sin `companyId`). */
const SETTINGS_SELECT = {
  telegramEnabled: true,
  notifyLowStock: true,
  notifySales: true,
  notifyCashClose: true,
  notifyCancellations: true,
  telegramChatId: true,
  telegramChatTitle: true,
  telegramLinkedAt: true,
  telegramLinkCode: true,
  telegramLinkCodeExpiresAt: true,
  updatedAt: true,
} satisfies Prisma.NotificationSettingSelect;

export type NotificationSettingRow = Prisma.NotificationSettingGetPayload<{
  select: typeof SETTINGS_SELECT;
}>;

/** Datos minimos del OTP para validar el codigo. */
export interface CancellationOtpRow {
  id: string;
  codeHash: string;
  expiresAt: Date;
}

/**
 * Acceso a datos de notificaciones. Toda consulta/escritura de Prisma vive aqui:
 * el servicio conserva las reglas (vinculacion, vencimientos, hash del OTP) y no
 * conoce el cliente de base de datos.
 */
@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Configuracion de la empresa (`null` si nunca configuro notificaciones). */
  findSettings(companyId: string): Promise<NotificationSettingRow | null> {
    return this.prisma.notificationSetting.findUnique({
      where: { companyId },
      select: SETTINGS_SELECT,
    });
  }

  /** Crea o actualiza la fila unica de configuracion de la empresa. */
  upsertSettings(
    companyId: string,
    create: Prisma.NotificationSettingUncheckedCreateInput,
    update: Prisma.NotificationSettingUncheckedUpdateInput,
  ): Promise<NotificationSettingRow> {
    return this.prisma.notificationSetting.upsert({
      where: { companyId },
      create,
      update,
      select: SETTINGS_SELECT,
    });
  }

  /** Empresa que ya tiene vinculado un chat de Telegram (evita cruces). */
  findCompanyByChat(chatId: string) {
    return this.prisma.notificationSetting.findFirst({
      where: { telegramChatId: chatId },
      select: {
        companyId: true,
        company: { select: { name: true } },
      },
    });
  }

  /** Vinculacion pendiente a partir del codigo que envio el administrador. */
  findSettingsByLinkCode(code: string) {
    return this.prisma.notificationSetting.findFirst({
      where: {
        telegramLinkCode: code,
        telegramLinkCodeExpiresAt: { gt: new Date() },
      },
      select: {
        companyId: true,
        telegramEnabled: true,
        company: { select: { name: true } },
      },
    });
  }

  /** Nombre del usuario que origino el aviso (cajero/operador). */
  findUserName(userId: string): Promise<{ name: string } | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
  }

  /** Invalida los codigos anteriores del pedido antes de emitir uno nuevo. */
  async invalidateOrderOtps(companyId: string, orderId: string): Promise<void> {
    await this.prisma.cancellationOtp.updateMany({
      where: { companyId, orderId, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  createOtp(data: Prisma.CancellationOtpUncheckedCreateInput) {
    return this.prisma.cancellationOtp.create({
      data,
      select: { id: true, expiresAt: true },
    });
  }

  /** Ultimo OTP vigente del pedido (aun sin usar). */
  findLatestOtp(
    companyId: string,
    orderId: string,
  ): Promise<CancellationOtpRow | null> {
    return this.prisma.cancellationOtp.findFirst({
      where: { companyId, orderId, usedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, codeHash: true, expiresAt: true },
    });
  }

  /** Marca el OTP como usado (un codigo no puede cancelar dos pedidos). */
  async markOtpUsed(id: string): Promise<void> {
    await this.prisma.cancellationOtp.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: new Date() },
    });
  }
}
