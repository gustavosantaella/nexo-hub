import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { PreferencesService } from './preferences.service';

/**
 * Preferencias de interfaz de la EMPRESA activa (Configuracion).
 *
 * Son configuracion del local, no de cada persona: las comparte todo el personal
 * y el cajero que entra desde otro navegador recibe al iniciar sesion lo mismo
 * que veia el resto del equipo. Las puede leer y escribir cualquier rol porque
 * no tocan datos de dominio; si mas adelante se decide que la propina o los
 * formularios solo los cambien ADMIN o MANAGER, basta anadir el guard de rol.
 */
@ApiTags('Preferencias')
@ApiBearerAuth()
@Controller('preferences')
export class PreferencesController {
  constructor(private readonly preferencesService: PreferencesService) {}

  @Get()
  @ApiOperation({ summary: 'Preferencias de interfaz de la empresa' })
  find(@CurrentUser('companyId') companyId: string) {
    return this.preferencesService.find(companyId);
  }

  @Patch()
  @ApiOperation({ summary: 'Guardar las preferencias de interfaz de la empresa' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.preferencesService.update(companyId, dto);
  }
}
