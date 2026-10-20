import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Opciones de notificacion de la EMPRESA. El chat y los codigos de vinculacion
 * no se aceptan desde el cliente: se obtienen con el flujo de `/vincular`.
 */
export class UpdateNotificationSettingsDto {
  @ApiPropertyOptional({
    description: 'Interruptor general de Telegram para la empresa',
  })
  @IsOptional()
  @IsBoolean({ message: 'El interruptor de Telegram debe ser verdadero o falso' })
  telegramEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Avisar cuando un producto llega al stock minimo' })
  @IsOptional()
  @IsBoolean({ message: 'El aviso de stock minimo debe ser verdadero o falso' })
  notifyLowStock?: boolean;

  @ApiPropertyOptional({ description: 'Avisar cada venta/cobro con su resumen' })
  @IsOptional()
  @IsBoolean({ message: 'El aviso de ventas debe ser verdadero o falso' })
  notifySales?: boolean;

  @ApiPropertyOptional({ description: 'Avisar al cerrar caja con el total recaudado' })
  @IsOptional()
  @IsBoolean({ message: 'El aviso de cierre de caja debe ser verdadero o falso' })
  notifyCashClose?: boolean;

  @ApiPropertyOptional({ description: 'Avisar cuando se cancela un pedido' })
  @IsOptional()
  @IsBoolean({ message: 'El aviso de cancelaciones debe ser verdadero o falso' })
  notifyCancellations?: boolean;
}
