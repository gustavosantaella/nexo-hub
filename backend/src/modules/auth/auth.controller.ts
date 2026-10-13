import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { UpdateProfileDto } from '../users/dto/update-profile.dto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SwitchCompanyDto } from './dto/switch-company.dto';

@ApiTags('Autenticacion')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({
    summary: 'Registrar una empresa nueva con su usuario administrador',
  })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesion y obtener token JWT' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({
    summary: 'Sesion actual: usuario, empresa activa y sus empresas',
  })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.session(user.id, user.companyId);
  }

  @ApiBearerAuth()
  @Post('switch-company')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar de empresa activa (reemite el token)' })
  switchCompany(
    @CurrentUser('id') userId: string,
    @Body() dto: SwitchCompanyDto,
  ) {
    return this.authService.switchCompany(userId, dto);
  }

  @ApiBearerAuth()
  @Patch('profile')
  @ApiOperation({ summary: 'Editar mis datos personales (nombre, cedula, ...)' })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(userId, dto);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar sesion (stateless, invalida en el cliente)' })
  logout() {
    return { message: 'Sesion finalizada' };
  }
}

