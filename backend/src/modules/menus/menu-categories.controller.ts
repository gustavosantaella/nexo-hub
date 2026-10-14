import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../common/constants/enums';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { MenuCategoriesService } from './menu-categories.service';
import { CreateMenuCategoryDto } from './dto/menu-category.dto';
import { UpdateMenuCategoryDto } from './dto/update-menu-category.dto';

@ApiTags('Menus - Categorias')
@ApiBearerAuth()
@Controller('menu-categories')
export class MenuCategoriesController {
  constructor(private readonly categories: MenuCategoriesService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Crear categoria de menu' })
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateMenuCategoryDto,
  ) {
    return this.categories.create(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar categorias de menu (paginado)' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.categories.findAll(companyId, query);
  }

  @Get('options')
  @ApiOperation({ summary: 'Categorias de menu activas para selects y filtros' })
  findOptions(@CurrentUser('companyId') companyId: string) {
    return this.categories.findOptions(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener categoria de menu por id' })
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.categories.findOne(companyId, id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Actualizar categoria de menu' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMenuCategoryDto,
  ) {
    return this.categories.update(companyId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Eliminar categoria de menu' })
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.categories.remove(companyId, id);
  }
}
