import { PartialType } from '@nestjs/swagger';
import { CreateMenuCategoryDto } from './menu-category.dto';

/** Todos los campos son opcionales al actualizar una categoria de menu. */
export class UpdateMenuCategoryDto extends PartialType(CreateMenuCategoryDto) {}
