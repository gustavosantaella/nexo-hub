import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { CreateMenuDto, MenuIngredientDto } from './menu.dto';

/**
 * La receta (`ingredients`) se reemplaza completa cuando llega; si se omite, se
 * conserva la que ya tiene el menu (asi un cambio de precio no toca la receta).
 */
export class UpdateMenuDto extends PartialType(
  OmitType(CreateMenuDto, ['ingredients'] as const),
) {
  @ApiPropertyOptional({
    type: [MenuIngredientDto],
    description:
      'Receta completa resultante. Si se omite, se conserva la receta actual.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'El menu debe tener al menos un ingrediente' })
  @ValidateNested({ each: true })
  @Type(() => MenuIngredientDto)
  ingredients?: MenuIngredientDto[];
}
