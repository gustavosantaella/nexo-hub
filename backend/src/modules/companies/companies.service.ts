import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Role } from '../../common/constants/enums';
import type { UserCompanySummary } from '../../common/interfaces/authenticated-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

/** Datos publicos de una empresa. */
const COMPANY_SELECT = {
  id: true,
  name: true,
  rif: true,
  phone: true,
  email: true,
  address: true,
  notes: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CompanySelect;

export type CompanyProfile = Prisma.CompanyGetPayload<{
  select: typeof COMPANY_SELECT;
}>;

/**
 * Empresas del sistema.
 *
 * Un usuario puede pertenecer a varias: aqui se listan las suyas y se editan
 * los datos de la empresa ACTIVA (nombre, RIF, telefono, correo, direccion).
 */
@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Empresas a las que pertenece el usuario (con su rol en cada una). */
  async listMine(userId: string): Promise<UserCompanySummary[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: {
        role: true,
        active: true,
        company: { select: { id: true, name: true, rif: true, active: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      id: membership.company.id,
      name: membership.company.name,
      rif: membership.company.rif,
      role: membership.role as Role,
      active: membership.active && membership.company.active,
    }));
  }

  /** Datos de la empresa activa. */
  async current(companyId: string): Promise<CompanyProfile> {
    return this.findOne(companyId);
  }

  async findOne(companyId: string): Promise<CompanyProfile> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: COMPANY_SELECT,
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return company;
  }

  /**
   * Crea una empresa nueva y deja al usuario autenticado como su ADMIN.
   * Sirve para que una misma cuenta administre varias empresas.
   */
  async create(
    userId: string,
    dto: CreateCompanyDto,
  ): Promise<{ company: CompanyProfile; companies: UserCompanySummary[] }> {
    const rif = dto.rif.trim().toUpperCase();
    await this.assertRifAvailable(rif);

    const company = await this.prisma.$transaction(async (tx) => {
      const created = await tx.company.create({
        data: {
          name: dto.name.trim(),
          rif,
          phone: dto.phone,
          email: dto.email?.toLowerCase(),
          address: dto.address,
        },
        select: COMPANY_SELECT,
      });
      await tx.membership.create({
        data: { userId, companyId: created.id, role: Role.ADMIN, active: true },
      });
      return created;
    });

    return { company, companies: await this.listMine(userId) };
  }

  /** Edita los datos de la empresa activa (Configuracion > Empresa). */
  async update(
    companyId: string,
    dto: UpdateCompanyDto,
  ): Promise<CompanyProfile> {
    await this.findOne(companyId);

    const data: Prisma.CompanyUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email.toLowerCase();
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.rif !== undefined) {
      const rif = dto.rif.trim().toUpperCase();
      await this.assertRifAvailable(rif, companyId);
      data.rif = rif;
    }

    return this.prisma.company.update({
      where: { id: companyId },
      data,
      select: COMPANY_SELECT,
    });
  }

  // ---------------------------------------------------------------- interno

  /** El RIF identifica a la empresa: no se puede repetir en todo el sistema. */
  private async assertRifAvailable(
    rif: string,
    exceptCompanyId?: string,
  ): Promise<void> {
    const existing = await this.prisma.company.findUnique({
      where: { rif },
      select: { id: true },
    });
    if (existing && existing.id !== exceptCompanyId) {
      throw new ConflictException(
        'Ya existe una empresa registrada con ese RIF',
      );
    }
  }
}
