import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Patch,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { Role } from '../../common/constants/enums';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { NotificationsService } from './notifications.service';

const ADMIN_ROLES = [Role.ADMIN, Role.MANAGER];

/**
 * Configuracion de notificaciones de la empresa y vinculacion del bot.
 * Solo ADMIN/MANAGER pueden ver o cambiar los avisos; el QR es publico porque
 * lo carga directamente un `<img>` (no puede enviar la cabecera JWT).
 */
@ApiTags('Notificaciones')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Public()
  @Get('telegram/qr')
  @ApiOperation({ summary: 'Imagen QR del bot de Telegram' })
  telegramQr(@Res({ passthrough: true }) res: Response): StreamableFile {
    const file = join(process.cwd(), 'public', 'bot', 'qr.jpeg');
    if (!existsSync(file)) {
      throw new NotFoundException('No se encontró la imagen QR del bot');
    }
    // Helmet marca los recursos como `same-origin`: el frontend corre en otro
    // puerto y necesita poder pintar el QR dentro de un <img>.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return new StreamableFile(createReadStream(file), {
      type: 'image/jpeg',
    });
  }

  @Get('settings')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Configuración de notificaciones de la empresa' })
  settings(@CurrentUser('companyId') companyId: string) {
    return this.notifications.getSettings(companyId);
  }

  @Patch('settings')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Guardar los avisos que recibe el administrador' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: UpdateNotificationSettingsDto,
  ) {
    return this.notifications.updateSettings(companyId, dto);
  }

  @Post('telegram/link-code')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Generar el código para vincular el chat del admin' })
  linkCode(@CurrentUser('companyId') companyId: string) {
    return this.notifications.issueLinkCode(companyId);
  }

  @Delete('telegram/link')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Desvincular el Telegram de la empresa' })
  unlink(@CurrentUser('companyId') companyId: string) {
    return this.notifications.unlink(companyId);
  }

  @Post('telegram/test')
  @Roles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Enviar un mensaje de prueba al chat vinculado' })
  test(@CurrentUser('companyId') companyId: string) {
    return this.notifications.sendTest(companyId);
  }
}
