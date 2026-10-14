import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/** Query del listado de categorias: ademas de la busqueda, filtra por principal. */
export class CategoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Devuelve solo las subcategorias de esa categoria principal',
  })
  @IsOptional()
  @IsString()
  parentId?: string;
}
