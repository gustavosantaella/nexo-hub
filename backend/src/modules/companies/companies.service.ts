import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Role } from '../../common/constants/enums';
import { ImageStorageService } from '../../common/media/image-storage.service';
import type { UserCompanySummary } from '../../common/interfaces/authenticated-user.interface';
import {
  CompaniesRepository,
  type CompanyProfile,
} from './companies.repository';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

export type { CompanyProfile };

/**
 * Empresas del sistema.
 *
 * Un usuario puede pertenecer a varias: aqui se listan las suyas y se editan
 * los datos de la empresa ACTIVA (nombre, RIF, telefono, correo, direccion).
 */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly companies: CompaniesRepository,
    @Optional() private readonly images?: ImageStorageService,
  ) {}

  /** Empresas a las que pertenece el usuario (con su rol en cada una). */
  async listMine(userId: string): Promise<UserCompanySummary[]> {
    const memberships = await this.companies.findMemberships(userId);

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
    const company = await this.companies.findOne(companyId);
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

    const company = await this.companies.transaction(async (tx) => {
      const created = await this.companies.create(
        {
          name: dto.name.trim(),
          rif,
          phone: dto.phone,
          email: dto.email?.toLowerCase(),
          address: dto.address,
        },
        tx,
      );
      await this.companies.addMember(userId, created.id, Role.ADMIN, tx);
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
    // El logo viaja como URL local ya subida por multipart: cadena vacia =
    // quitar el logo. La fila conserva la ruta `/media/...`.
    if (dto.logoUrl !== undefined) {
      data.logoUrl = this.images
        ? await this.images.persist(companyId, 'logo', dto.logoUrl)
        : dto.logoUrl.trim() || null;
    }
    if (dto.rif !== undefined) {
      const rif = dto.rif.trim().toUpperCase();
      await this.assertRifAvailable(rif, companyId);
      data.rif = rif;
    }

    return this.companies.update(companyId, data);
  }

  // ---------------------------------------------------------------- interno

  /** El RIF identifica a la empresa: no se puede repetir en todo el sistema. */
  private async assertRifAvailable(
    rif: string,
    exceptCompanyId?: string,
  ): Promise<void> {
    const existing = await this.companies.findByRif(rif);
    if (existing && existing.id !== exceptCompanyId) {
      throw new ConflictException(
        'Ya existe una empresa registrada con ese RIF',
      );
    }
  }
}
