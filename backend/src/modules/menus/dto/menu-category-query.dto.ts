import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Query del listado de categorias de menu: filtra por categoria principal. */
export class MenuCategoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Devuelve solo las subcategorias de esa categoria principal',
  })
  @IsOptional()
  @IsString()
  parentId?: string;
}
