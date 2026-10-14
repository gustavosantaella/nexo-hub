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
import { CreateMenuDto } from './dto/menu.dto';
import { MenuQueryDto } from './dto/menu-query.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';
import { MenusService } from './menus.service';

const MENU_ROLES = [Role.ADMIN, Role.MANAGER];

@ApiTags('Menus')
@ApiBearerAuth()
@Controller('menus')
export class MenusController {
  constructor(private readonly menusService: MenusService) {}

  @Post()
  @Roles(...MENU_ROLES)
  @ApiOperation({ summary: 'Crear menu (con su receta de ingredientes)' })
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateMenuDto) {
    return this.menusService.create(companyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar menus (paginado + filtros)' })
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query() query: MenuQueryDto,
  ) {
    return this.menusService.findAll(companyId, query);
  }

  @Get('options')
  @ApiOperation({
    summary: 'Menus activos para el POS y los pedidos (con stock disponible)',
  })
  findOptions(@CurrentUser('companyId') companyId: string) {
    return this.menusService.findOptions(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle del menu (receta, costo y disponibilidad)' })
  findOne(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.menusService.findOne(companyId, id);
  }

  @Patch(':id')
  @Roles(...MENU_ROLES)
  @ApiOperation({
    summary: 'Actualizar menu (si llega la receta, se reemplaza y recostea)',
  })
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMenuDto,
  ) {
    return this.menusService.update(companyId, id, dto);
  }

  @Delete(':id')
  @Roles(...MENU_ROLES)
  @ApiOperation({ summary: 'Desactivar menu (baja logica)' })
  remove(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.menusService.remove(companyId, id);
  }
}
