import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  CATALOG_IMPORT_MODES,
  type CatalogImportMode,
} from '../catalog-format';

/**
 * Opciones de la importacion (viajan en el query string, no en el archivo: el
 * archivo es el respaldo tal cual se descargo y se puede volver a subir sin
 * tocarlo).
 */
export class ImportCatalogQueryDto {
  @ApiPropertyOptional({
    enum: CATALOG_IMPORT_MODES,
    default: 'merge',
    description:
      'Que hacer con los registros que ya existen (misma clave natural): `merge` los actualiza con el archivo, `skip` los deja intactos.',
  })
  @IsOptional()
  @IsIn(CATALOG_IMPORT_MODES as unknown as string[])
  mode?: CatalogImportMode;
}
