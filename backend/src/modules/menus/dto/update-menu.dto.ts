import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { CreateMenuDto, MenuIngredientDto } from './menu.dto';

/**
 * La receta (`ingredients`) se reemplaza completa cuando llega; si se omite, se
 * conserva la que ya tiene el menu (asi un cambio de precio no toca la receta).
 * Enviarla vacia (`[]`) elimina la receta, dejando el menu sin descuento de
 * inventario.
 */
export class UpdateMenuDto extends PartialType(
  OmitType(CreateMenuDto, ['ingredients'] as const),
) {
  @ApiPropertyOptional({
    type: [MenuIngredientDto],
    description:
      'Receta completa resultante. Si se omite, se conserva la receta actual; si se envia vacia, se elimina.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MenuIngredientDto)
  ingredients?: MenuIngredientDto[];
}
