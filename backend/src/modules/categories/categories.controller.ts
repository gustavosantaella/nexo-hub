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
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('Categorias')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Crear categoria' })
  create(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar categorias (paginado)' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.categoriesService.findAll(companyId, query);
  }

  @Get('options')
  @ApiOperation({ summary: 'Categorias activas para selects' })
  findOptions(@CurrentUser('companyId') companyId: string) {
    return this.categoriesService.findOptions(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener categoria por id' })
  findOne(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.categoriesService.findOne(companyId, id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Actualizar categoria' })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(companyId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Eliminar categoria' })
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.categoriesService.remove(companyId, id);
  }
}
