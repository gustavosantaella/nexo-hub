import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Role } from '../../common/constants/enums';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toSkip } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';

/** Campos publicos de un usuario global (nunca expone passwordHash). */
export const USER_PUBLIC_SELECT = {
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

export type MembershipRow = Prisma.MembershipGetPayload<{
  select: typeof MEMBER_SELECT;
}>;

export type MembershipCompanyRow = Prisma.MembershipGetPayload<{
  select: typeof MEMBERSHIP_COMPANY_SELECT;
}>;

/** Columnas de la membresia que se consultan para validar bajas y permisos. */
export type MembershipAccessRow = {
  role: string;
  active: boolean;
};

/**
 * Acceso a datos de usuarios y de sus membresias por empresa. Toda
 * consulta/escritura de Prisma del modulo vive aqui: el servicio conserva las
 * reglas de negocio (correo unico, ultimo ADMIN activo, contrasena), pero no
 * conoce el cliente de base de datos.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ============================ Cuenta global ===============================

  /** Cuenta por correo, con el hash (alta de miembros y validacion de acceso). */
  findUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  /** Correo actual de la cuenta (para detectar cambios de correo). */
  findUserEmail(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
  }

  /** Perfil global del usuario (sin contrasena). */
  findPublicUser(id: string): Promise<PublicUser | null> {
    return this.prisma.user.findUnique({
      where: { id },
      select: USER_PUBLIC_SELECT,
    });
  }

  updateUser(id: string, data: Prisma.UserUpdateInput): Promise<PublicUser> {
    return this.prisma.user.update({
      where: { id },
      data,
      select: USER_PUBLIC_SELECT,
    });
  }

  /** Ultimo acceso exitoso (se marca despues de emitir el token). */
  async markLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  // ======================= Usuarios de una empresa ==========================

  /** Miembro de la empresa (datos de la cuenta + rol en ESA empresa). */
  findMember(companyId: string, userId: string): Promise<MembershipRow | null> {
    return this.prisma.membership.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: MEMBER_SELECT,
    });
  }

  /** Miembros de la empresa, filtrados y paginados. */
  async findMemberPage(
    companyId: string,
    query: PaginationQueryDto,
  ): Promise<{ rows: MembershipRow[]; total: number }> {
    const where = this.listWhere(companyId, query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.membership.findMany({
        where,
        select: MEMBER_SELECT,
        orderBy: this.listOrderBy(query),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.membership.count({ where }),
    ]);

    return { rows, total };
  }

  /** Alta de la membresia de una cuenta que ya existe en otra empresa. */
  addMember(
    companyId: string,
    userId: string,
    role: Role,
    active: boolean,
  ): Promise<MembershipRow> {
    return this.prisma.membership.create({
      data: { userId, companyId, role, active },
      select: MEMBER_SELECT,
    });
  }

  /**
   * Alta de una cuenta nueva y su membresia en la empresa dentro de una sola
   * transaccion: no puede quedar un usuario global sin empresa.
   */
  createMemberWithUser(
    companyId: string,
    data: Prisma.UserUncheckedCreateInput,
    role: Role,
    active: boolean,
  ): Promise<MembershipRow> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data });
      return tx.membership.create({
        data: { userId: user.id, companyId, role, active },
        select: MEMBER_SELECT,
      });
    });
  }

  /** Rol y estado del usuario EN la empresa (bajas y permisos). */
  findMemberAccess(
    companyId: string,
    userId: string,
  ): Promise<MembershipAccessRow | null> {
    return this.prisma.membership.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: { role: true, active: true },
    });
  }

  /** Administradores activos de la empresa distintos del usuario indicado. */
  countOtherActiveAdmins(companyId: string, userId: string): Promise<number> {
    return this.prisma.membership.count({
      where: {
        companyId,
        role: 'ADMIN',
        active: true,
        userId: { not: userId },
      },
    });
  }

  /**
   * Guarda los datos de la cuenta y su rol/estado en la empresa en una sola
   * transaccion.
   */
  async updateMember(
    companyId: string,
    userId: string,
    userData: Prisma.UserUpdateInput,
    membershipData: Prisma.MembershipUpdateInput,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: userData }),
      this.prisma.membership.update({
        where: { userId_companyId: { userId, companyId } },
        data: membershipData,
      }),
    ]);
  }

  /** Baja logica del usuario EN la empresa (la cuenta global sigue existiendo). */
  setMemberActive(companyId: string, userId: string, active: boolean) {
    return this.prisma.membership.update({
      where: { userId_companyId: { userId, companyId } },
      data: { active },
    });
  }

  // ================================ Sesion ==================================

  /** Membresia del usuario en una empresa, con el estado de la empresa. */
  findMembershipWithCompany(
    userId: string,
    companyId: string,
  ): Promise<MembershipCompanyRow | null> {
    return this.prisma.membership.findUnique({
      where: { userId_companyId: { userId, companyId } },
      select: MEMBERSHIP_COMPANY_SELECT,
    });
  }

  /** Todas las empresas a las que pertenece un usuario. */
  findMembershipsWithCompany(userId: string): Promise<MembershipCompanyRow[]> {
    return this.prisma.membership.findMany({
      where: { userId },
      select: MEMBERSHIP_COMPANY_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  // ---------------------------------------------------------------- interno

  /** Filtro del listado: la empresa activa y la busqueda sobre la cuenta. */
  private listWhere(
    companyId: string,
    query: PaginationQueryDto,
  ): Prisma.MembershipWhereInput {
    const search = query.search?.trim();

    return {
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
  }

  /** Orden del listado: por rol/fecha de alta o, por defecto, por nombre. */
  private listOrderBy(
    query: PaginationQueryDto,
  ): Prisma.MembershipOrderByWithRelationInput {
    return query.sortBy && ['role', 'createdAt'].includes(query.sortBy)
      ? { [query.sortBy]: query.sortOrder }
      : { user: { name: 'asc' } };
  }
}
