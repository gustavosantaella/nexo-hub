import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  buildPaginatedResult,
  toSkip,
  type PaginatedResult,
} from '../../common/utils/pagination.util';
import { hashPassword } from '../../common/utils/password.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/** Campos publicos de un usuario (nunca expone passwordHash). */
const USER_PUBLIC_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  phone: true,
  avatarUrl: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{
  select: typeof USER_PUBLIC_SELECT;
}>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto): Promise<PublicUser> {
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (exists) throw new ConflictException('El correo ya esta registrado');

    return this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.name,
        role: dto.role ?? 'CASHIER',
        phone: dto.phone,
        active: dto.active ?? true,
        passwordHash: await hashPassword(dto.password),
      },
      select: USER_PUBLIC_SELECT,
    });
  }

  async findAll(query: PaginationQueryDto): Promise<PaginatedResult<PublicUser>> {
    const where: Prisma.UserWhereInput = query.search
      ? {
          OR: [
            { name: { contains: query.search } },
            { email: { contains: query.search } },
          ],
        }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_PUBLIC_SELECT,
        orderBy: query.toOrderBy(['name', 'email', 'role', 'createdAt']),
        skip: toSkip(query.page, query.limit),
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return buildPaginatedResult(items, total, query.page, query.limit);
  }

  async findOne(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_PUBLIC_SELECT,
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  /** Usado por auth: incluye el hash para validar credenciales. */
  findByEmailWithPassword(email: string) {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  async update(id: string, dto: UpdateUserDto): Promise<PublicUser> {
    await this.findOne(id);

    const data: Prisma.UserUpdateInput = {
      name: dto.name,
      role: dto.role,
      phone: dto.phone,
      active: dto.active,
    };
    if (dto.email) data.email = dto.email.toLowerCase();
    if (dto.password) data.passwordHash = await hashPassword(dto.password);

    return this.prisma.user.update({
      where: { id },
      data,
      select: USER_PUBLIC_SELECT,
    });
  }

  async remove(id: string): Promise<PublicUser> {
    await this.findOne(id);
    // Baja logica para no romper referencias historicas (caja, pedidos).
    return this.prisma.user.update({
      where: { id },
      data: { active: false },
      select: USER_PUBLIC_SELECT,
    });
  }

  async markLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }
}

export { USER_PUBLIC_SELECT };
