import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../../common/constants/enums';
import { companyUnderReviewError } from '../../common/constants/messages';
import type {
  JwtPayload,
  UserCompanySummary,
} from '../../common/interfaces/authenticated-user.interface';
import {
  comparePassword,
  hashPassword,
} from '../../common/utils/password.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CompaniesService,
  type CompanyProfile,
} from '../companies/companies.service';
import { UpdateProfileDto } from '../users/dto/update-profile.dto';
import { UsersService, type PublicUser } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SwitchCompanyDto } from './dto/switch-company.dto';

/** Sesion completa: token + usuario + empresa activa + empresas del usuario. */
export interface SessionResult {
  accessToken: string;
  user: PublicUser;
  /** Empresa activa: todos los datos de la app se filtran por ella. */
  company: CompanyProfile;
  /** Rol del usuario EN la empresa activa (no es un rol global). */
  role: Role;
  companies: UserCompanySummary[];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly companiesService: CompaniesService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /** Registro publico: crea la empresa y su primer usuario ADMIN. */
  async register(dto: RegisterDto): Promise<SessionResult> {
    const email = dto.user.email.toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new ConflictException(
        'Ese correo ya esta registrado. Inicia sesion para unirte a otra empresa.',
      );
    }

    const rif = dto.company.rif.trim().toUpperCase();
    const existingCompany = await this.prisma.company.findUnique({
      where: { rif },
    });
    if (existingCompany) {
      throw new ConflictException(
        'Ya existe una empresa registrada con ese RIF',
      );
    }

    const passwordHash = await hashPassword(dto.user.password);
    const { user, company } = await this.prisma.$transaction(async (tx) => {
      const createdCompany = await tx.company.create({
        data: {
          name: dto.company.name.trim(),
          rif,
          phone: dto.company.phone,
          email: dto.company.email?.toLowerCase(),
          address: dto.company.address,
        },
      });
      const createdUser = await tx.user.create({
        data: {
          email,
          name: dto.user.name,
          documentId: dto.user.documentId,
          phone: dto.user.phone,
          passwordHash,
        },
      });
      await tx.membership.create({
        data: {
          userId: createdUser.id,
          companyId: createdCompany.id,
          role: Role.ADMIN,
          active: true,
        },
      });
      return { user: createdUser, company: createdCompany };
    });

    await this.usersService.markLogin(user.id);
    return this.buildSession(user.id, company.id);
  }

  /** Inicia sesion en la primera empresa activa del usuario. */
  async login(dto: LoginDto): Promise<SessionResult> {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    if (!user || !user.active) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const passwordMatches = await comparePassword(
      dto.password,
      user.passwordHash,
    );
    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const memberships = await this.usersService.membershipsOf(user.id);
    const active = memberships.filter(
      (item) => item.active && item.company.active,
    );
    if (active.length === 0) {
      // Si TODAS sus empresas estan sin activar, la empresa sigue en revision:
      // se avisa con ese mensaje en lugar del generico de "sin empresa activa".
      const withActiveCompany = memberships.filter(
        (item) => item.company.active,
      );
      if (memberships.length > 0 && withActiveCompany.length === 0) {
        throw new ForbiddenException(companyUnderReviewError());
      }
      throw new UnauthorizedException(
        'Tu cuenta no tiene ninguna empresa activa. Contacta al administrador.',
      );
    }

    await this.usersService.markLogin(user.id);
    return this.buildSession(user.id, active[0].company.id);
  }

  /** Cambia la empresa activa reemitiendo el token con su rol en ella. */
  switchCompany(userId: string, dto: SwitchCompanyDto): Promise<SessionResult> {
    return this.buildSession(userId, dto.companyId);
  }

  /** Sesion actual (GET /auth/me) con la empresa activa del token. */
  session(userId: string, companyId: string): Promise<SessionResult> {
    return this.buildSession(userId, companyId);
  }

  /** Datos personales del usuario autenticado (Configuracion > Mis datos). */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    if (dto.password) {
      if (!dto.currentPassword) {
        throw new BadRequestException(
          'Indica tu contrasena actual para poder cambiarla',
        );
      }
      const current = await this.usersService.findById(userId);
      const withPassword = await this.usersService.findByEmailWithPassword(
        current.email,
      );
      const matches =
        withPassword &&
        (await comparePassword(dto.currentPassword, withPassword.passwordHash));
      if (!matches) {
        throw new UnauthorizedException('La contrasena actual no es correcta');
      }
    }

    const { password: _password, currentPassword: _current, ...data } = dto;
    return this.usersService.updateProfile(userId, data);
  }

  // ---------------------------------------------------------------- interno

  /**
   * Arma el token y valida que la membresia siga activa.
   * Una empresa sin activar (en revision) nunca recibe token: ni por login ni
   * por cambio de empresa.
   */
  private async buildSession(
    userId: string,
    companyId: string,
  ): Promise<SessionResult> {
    const membership = await this.usersService.membershipOf(userId, companyId);
    if (!membership || !membership.active) {
      throw new UnauthorizedException('No tienes acceso a esa empresa');
    }
    if (!membership.company.active) {
      throw new ForbiddenException(companyUnderReviewError());
    }

    const user = await this.usersService.findById(userId);
    const company = await this.companiesService.findOne(companyId);
    const memberships = await this.usersService.membershipsOf(userId);
    const role = membership.role as Role;

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      companyId,
      role,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user,
      company,
      role,
      companies: memberships
        .filter((item) => item.company.active)
        .map((item) => ({
          id: item.company.id,
          name: item.company.name,
          rif: item.company.rif,
          role: item.role as Role,
          active: item.active,
        })),
    };
  }
}
