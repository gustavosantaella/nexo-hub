import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Role } from '../../common/constants/enums';
import { ImageStorageService } from '../../common/media/image-storage.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  buildPaginatedResult,
  type PaginatedResult,
} from '../../common/utils/pagination.util';
import { hashPassword } from '../../common/utils/password.util';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  UsersRepository,
  type MembershipRow,
  type PublicUser,
} from './users.repository';

export type {
  MembershipCompanyRow,
  MembershipRow,
  PublicUser,
} from './users.repository';
export { USER_PUBLIC_SELECT } from './users.repository';

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
  constructor(
    private readonly users: UsersRepository,
    @Optional() private readonly images?: ImageStorageService,
  ) {}

  // =========================== Usuarios de una empresa ======================

  /** Alta de un miembro: reutiliza la cuenta si el correo ya existe. */
  async create(companyId: string, dto: CreateUserDto): Promise<CompanyMember> {
    const email = dto.email.toLowerCase();
    const existing = await this.users.findUserByEmail(email);

    if (existing) {
      const alreadyMember = await this.membershipOf(existing.id, companyId);
      if (alreadyMember) {
        throw new ConflictException(
          'Ese correo ya pertenece a un usuario de esta empresa',
        );
      }
      // La cuenta existe (en otra empresa): solo se agrega la membresia, no
      // se tocan sus datos personales ni su contrasena.
      const membership = await this.users.addMember(
        companyId,
        existing.id,
        dto.role ?? 'CASHIER',
        dto.active ?? true,
      );
      return toMember(membership);
    }

    if (!dto.password) {
      throw new BadRequestException(
        'La contrasena es obligatoria para un usuario nuevo',
      );
    }
    const passwordHash = await hashPassword(dto.password);

    const membership = await this.users.createMemberWithUser(
      companyId,
      {
        email,
        name: dto.name,
        documentId: dto.documentId,
        phone: dto.phone,
        passwordHash,
      },
      dto.role ?? 'CASHIER',
      dto.active ?? true,
    );
    return toMember(membership);
  }

  /** Miembros de la empresa activa (paginado). */
  async findAll(
    companyId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<CompanyMember>> {
    const { rows, total } = await this.users.findMemberPage(companyId, query);

    return buildPaginatedResult(
      rows.map(toMember),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(companyId: string, userId: string): Promise<CompanyMember> {
    const row = await this.users.findMember(companyId, userId);
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
    const current = await this.users.findUserEmail(userId);
    if (!current) throw new NotFoundException('Usuario no encontrado');

    const userData: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) userData.name = dto.name;
    if (dto.documentId !== undefined) userData.documentId = dto.documentId;
    if (dto.phone !== undefined) userData.phone = dto.phone;
    if (dto.password) userData.passwordHash = await hashPassword(dto.password);
    if (dto.email) {
      const email = dto.email.toLowerCase();
      if (email !== current.email) {
        const taken = await this.users.findUserByEmail(email);
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

    await this.users.updateMember(companyId, userId, userData, membershipData);

    return this.findOne(companyId, userId);
  }

  /** Baja logica EN la empresa (la cuenta global sigue existiendo). */
  async remove(companyId: string, userId: string): Promise<CompanyMember> {
    const row = await this.users.findMemberAccess(companyId, userId);
    if (!row) {
      throw new NotFoundException('El usuario no pertenece a esta empresa');
    }
    await this.assertNotLastAdmin(companyId, userId);
    await this.users.setMemberActive(companyId, userId, false);
    return this.findOne(companyId, userId);
  }

  // ================================ Sesion ==================================

  /** Usado por auth: incluye el hash para validar credenciales. */
  findByEmailWithPassword(email: string) {
    return this.users.findUserByEmail(email);
  }

  /** Perfil global del usuario (sin contrasena). */
  async findById(id: string): Promise<PublicUser> {
    const user = await this.users.findPublicUser(id);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  /** Membresia del usuario en una empresa, con el estado de la empresa. */
  membershipOf(userId: string, companyId: string) {
    return this.users.findMembershipWithCompany(userId, companyId);
  }

  /** Todas las empresas a las que pertenece un usuario. */
  membershipsOf(userId: string) {
    return this.users.findMembershipsWithCompany(userId);
  }

  async markLogin(id: string): Promise<void> {
    await this.users.markLogin(id);
  }

  /** Datos personales del usuario autenticado (Configuracion > Mis datos). */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    const current = await this.users.findUserEmail(userId);
    if (!current) throw new NotFoundException('Usuario no encontrado');

    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.documentId !== undefined) data.documentId = dto.documentId;
    if (dto.phone !== undefined) data.phone = dto.phone;
    // El avatar es global (no depende de la empresa): la subida multipart lo
    // agrupa en `private/img/_users/<id>/avatars` y la fila guarda `/media/...`.
    if (dto.avatarUrl !== undefined) {
      data.avatarUrl = this.images
        ? await this.images.persistForOwner(userId, 'avatars', dto.avatarUrl)
        : dto.avatarUrl;
    }
    if (dto.email) {
      const email = dto.email.toLowerCase();
      if (email !== current.email) {
        const taken = await this.users.findUserByEmail(email);
        if (taken) throw new ConflictException('El correo ya esta registrado');
        data.email = email;
      }
    }
    if (dto.password) data.passwordHash = await hashPassword(dto.password);

    return this.users.updateUser(userId, data);
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
    const target = await this.users.findMemberAccess(companyId, userId);
    if (!target || !target.active || target.role !== 'ADMIN') return;

    const otherAdmins = await this.users.countOtherActiveAdmins(
      companyId,
      userId,
    );
    if (otherAdmins === 0) {
      throw new BadRequestException(
        'No puedes desactivar al ultimo administrador activo de la empresa',
      );
    }
  }
}
