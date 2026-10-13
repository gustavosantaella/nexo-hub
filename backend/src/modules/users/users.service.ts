import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Role } from '../../common/constants/enums';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  buildPaginatedResult,
  toSkip,
  type PaginatedResult,
} from '../../common/utils/pagination.util';
import { hashPassword } from '../../common/utils/password.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/** Campos publicos de un usuario global (nunca expone passwordHash). */
const USER_PUBLIC_SELECT = {
  id: true,
  email: true,
  name: true,
  documentId: true,
  phone: true,
  avatarUrl: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof USER_PUBLIC_SELECT;
}>;

/**
 * Miembro de la empresa activa: los datos globales del usuario mas el rol y
 * el estado que ese usuario tiene EN esta empresa (el rol no es global).
 */
export interface CompanyMember {
  id: string;
  email: string;
  name: string;
  documentId: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: Role;
  active: boolean;
  lastLoginAt: Date | null;
  joinedAt: Date;
}

const MEMBER_SELECT = {
  role: true,
  active: true,
  createdAt: true,
  user: { select: USER_PUBLIC_SELECT },
} satisfies Prisma.MembershipSelect;

/** Membresia con la empresa (para armar la sesion). */
const MEMBERSHIP_COMPANY_SELECT = {
  id: true,
  role: true,
  active: true,
  company: {
    select: { id: true, name: true, rif: true, active: true },
  },
} satisfies Prisma.MembershipSelect;

type MembershipRow = Prisma.MembershipGetPayload<{
  select: typeof MEMBER_SELECT;
}>;

export type MembershipCompanyRow = Prisma.MembershipGetPayload<{
  select: typeof MEMBERSHIP_COMPANY_SELECT;
}>;

function toMember(row: MembershipRow): CompanyMember {
  return {
    id: row.user.id,
    email: row.user.email,
    name: row.user.name,
    documentId: row.user.documentId,
    phone: row.user.phone,
    avatarUrl: row.user.avatarUrl,
    role: row.role as Role,
    active: row.active && row.user.active,
    lastLoginAt: row.user.lastLoginAt,
    joinedAt: row.createdAt,
  };
}

/**
 * Identidad global + membresias por empresa.
 *
 * El usuario (email/contrasena/datos personales) es global: la misma cuenta
 * puede trabajar en varias empresas. El ROL y el alta/baja en cada empresa
 * viven en `Membership`, por eso todas las operaciones de este servicio
 * reciben el `companyId` de la sesion.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // =========================== Usuarios de una empresa ======================

  /** Alta de un miembro: reutiliza la cuenta si el correo ya existe. */
  async create(companyId: string, dto: CreateUserDto): Promise<CompanyMember> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      const alreadyMember = await this.membershipOf(existing.id, companyId);
      if (alreadyMember) {
        throw new ConflictException(
          'Ese correo ya pertenece a un usuario de esta empresa',
        );
      }
      // La cuenta existe (en otra empresa): solo se agrega la membresia, no
      // se tocan sus datos personales ni su contrasena.
      const membership = await this.prisma.membership.create({
        data: {
          userId: existing.id,
          companyId,
          role: dto.role ?? 'CASHIER',
          active: dto.active ?? true,
        },
        select: MEMBER_SELECT,
      });
      return toMember(membership);
    }

    if (!dto.password) {
      throw new BadRequestException(
        'La contrasena es obligatoria para un usuario nuevo',
      );
    }
    const passwordHash = await hashPassword(dto.password);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: dto.name,
          documentId: dto.documentId,
          phone: dto.phone,
          passwordHash,
        },
      });
      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          companyId,
          role: dto.role ?? 'CASHIER',
          active: dto.active ?? true,
        },
        select: MEMBER_SELECT,
      });
      return toMember(membership);
    });
  }

  /** Miembros de la empresa activa (paginado). */
  async findAll(
    companyId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<CompanyMember>> {
    const search = query.search?.trim();
    const where: Prisma.MembershipWhereInput = {
      companyId,
      ...(search
        ? {
            user: {
              OR: [
                { name: { contains: search } },
                { email: { contains: search } },
                { documentId: { contains: search } },
                { phone: { contains: search } },
              ],
            },
          }
        : {}),
    };

    const orderBy: Prisma.MembershipOrderByWithRelationInput =
      query.sortBy && ['role', 'createdAt'].includes(query.sortBy)
        ? { [query.sortBy]: query.sortOrder }
        : { user: { name: 'asc' } };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.membership.findMany({
        where,
        select: MEMBER_SELECT,
        orderBy,
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.membership.count({ where }),
    ]);

    return buildPaginatedResult(
      rows.map(toMember),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(companyId: string, userId: string): Promise<CompanyMember> {
    const row = await this.prisma.membership.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: MEMBER_SELECT,
    });
    if (!row) {
      throw new NotFoundException('El usuario no pertenece a esta empresa');
    }
    return toMember(row);
  }
  /** Actualiza los datos del usuario y/o su rol dentro de la empresa. */
  async update(
    companyId: string,
    userId: string,
    dto: UpdateUserDto,
  ): Promise<CompanyMember> {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!current) throw new NotFoundException('Usuario no encontrado');

    const userData: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) userData.name = dto.name;
    if (dto.documentId !== undefined) userData.documentId = dto.documentId;
    if (dto.phone !== undefined) userData.phone = dto.phone;
    if (dto.password) userData.passwordHash = await hashPassword(dto.password);
    if (dto.email) {
      const email = dto.email.toLowerCase();
      if (email !== current.email) {
        const taken = await this.prisma.user.findUnique({ where: { email } });
        if (taken && taken.id !== userId) {
          throw new ConflictException('El correo ya esta registrado');
        }
        userData.email = email;
      }
    }

    const membershipData: Prisma.MembershipUpdateInput = {};
    if (dto.role !== undefined) membershipData.role = dto.role;
    if (dto.active !== undefined) {
      if (!dto.active) await this.assertNotLastAdmin(companyId, userId);
      membershipData.active = dto.active;
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: userData }),
      this.prisma.membership.update({
        where: { userId_companyId: { userId, companyId } },
        data: membershipData,
      }),
    ]);

    return this.findOne(companyId, userId);
  }

  /** Baja logica EN la empresa (la cuenta global sigue existiendo). */
  async remove(companyId: string, userId: string): Promise<CompanyMember> {
    const row = await this.prisma.membership.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { role: true },
    });
    if (!row) {
      throw new NotFoundException('El usuario no pertenece a esta empresa');
    }
    await this.assertNotLastAdmin(companyId, userId);
    await this.prisma.membership.update({
      where: { userId_companyId: { userId, companyId } },
      data: { active: false },
    });
    return this.findOne(companyId, userId);
  }
  // ================================ Sesion ==================================

  /** Usado por auth: incluye el hash para validar credenciales. */
  findByEmailWithPassword(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  /** Perfil global del usuario (sin contrasena). */
  async findById(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_PUBLIC_SELECT,
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  /** Membresia del usuario en una empresa, con el estado de la empresa. */
  membershipOf(
    userId: string,
    companyId: string,
  ): Promise<MembershipCompanyRow | null> {
    return this.prisma.membership.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: MEMBERSHIP_COMPANY_SELECT,
    });
  }

  /** Todas las empresas a las que pertenece un usuario. */
  membershipsOf(userId: string): Promise<MembershipCompanyRow[]> {
    return this.prisma.membership.findMany({
      where: { userId },
      select: MEMBERSHIP_COMPANY_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  async markLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  /** Datos personales del usuario autenticado (Configuracion > Mis datos). */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.documentId !== undefined) data.documentId = dto.documentId;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.email) {
      const email = dto.email.toLowerCase();
      if (email !== user.email) {
        const taken = await this.prisma.user.findUnique({ where: { email } });
        if (taken) throw new ConflictException('El correo ya esta registrado');
        data.email = email;
      }
    }
    if (dto.password) data.passwordHash = await hashPassword(dto.password);

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: USER_PUBLIC_SELECT,
    });
  }

  // ---------------------------------------------------------------- interno

  /**
   * Una empresa no puede quedarse sin ningun ADMIN activo: nadie podria
   * volver a administrarla. Se comprueba antes de desactivar/bajar a alguien.
   */
  private async assertNotLastAdmin(
    companyId: string,
    userId: string,
  ): Promise<void> {
    const target = await this.prisma.membership.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { role: true, active: true },
    });
    if (!target || !target.active || target.role !== 'ADMIN') return;

    const otherAdmins = await this.prisma.membership.count({
      where: {
        companyId,
        role: 'ADMIN',
        active: true,
        userId: { not: userId },
      },
    });
    if (otherAdmins === 0) {
      throw new BadRequestException(
        'No puedes desactivar al ultimo administrador activo de la empresa',
      );
    }
  }
}

export { USER_PUBLIC_SELECT };



