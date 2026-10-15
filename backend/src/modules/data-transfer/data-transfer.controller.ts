import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Role } from '../../common/constants/enums';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import type { CatalogDocument, CatalogImportResult } from './catalog-format';
import { catalogFileName } from './catalog-format';
import { DataTransferService } from './data-transfer.service';
import { ImportCatalogQueryDto } from './dto/import-catalog-query.dto';

/**
 * Exportar / importar el catalogo del local en un solo archivo JSON.
 *
 * Es la via de escape del negocio: llevarse los datos a otro equipo o a otra
 * empresa, y volver a cargarlos tras un borrado accidental. Solo ADMIN y MANAGER:
 * la importacion escribe precios, costos y stock de golpe.
 */
@ApiTags('Datos')
@ApiBearerAuth()
@Controller('data-transfer')
export class DataTransferController {
  constructor(private readonly dataTransferService: DataTransferService) {}

  @Get('export')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Exportar catalogo (categorias, proveedores, productos y menus)',
  })
  async export(
    @CurrentUser('companyId') companyId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CatalogDocument> {
    const document = await this.dataTransferService.exportCatalog(companyId);
    // El nombre viaja tambien en la cabecera para que un navegador que abra la
    // URL directa (con el token en la sesion) descargue el archivo con su nombre.
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${catalogFileName(document.exportedAt)}"`,
    );
    return document;
  }

  @Post('import')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Importar catalogo desde un archivo exportado previamente',
  })
  import(
    @Body() payload: unknown,
    @Query() query: ImportCatalogQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CatalogImportResult> {
    return this.dataTransferService.importCatalog(user.companyId, payload, {
      mode: query.mode,
      userId: user.id,
    });
  }
}
