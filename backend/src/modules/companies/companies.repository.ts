import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Role } from '../../common/constants/enums';
import { PrismaService, type PrismaClientLike } from '../../prisma/prisma.service';

/** Datos publicos de una empresa. */
const COMPANY_SELECT = {
  id: true,
  name: true,
  rif: true,
  phone: true,
  email: true,
  address: true,
  logoUrl: true,
  notes: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CompanySelect;

export type CompanyProfile = Prisma.CompanyGetPayload<{
  select: typeof COMPANY_SELECT;
}>;

/**
 * Acceso a datos de empresas y de las membresias del usuario. Toda
 * consulta/escritura de Prisma del modulo vive aqui: el servicio conserva las
 * reglas de negocio (RIF unico, rol ADMIN al crear), pero no conoce el cliente
 * de base de datos.
 */
@Injectable()
export class CompaniesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Ejecuta una unidad de trabajo dentro de una transaccion de base de datos. */
  transaction<T>(work: (tx: PrismaClientLike) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(tx));
  }

  /** Empresas a las que pertenece el usuario, con su rol en cada una. */
  findMemberships(userId: string) {
    return this.prisma.membership.findMany({
      where: { userId },
      select: {
        role: true,
        active: true,
        company: { select: { id: true, name: true, rif: true, active: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  findOne(companyId: string): Promise<CompanyProfile | null> {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: COMPANY_SELECT,
    });
  }

  create(data: Prisma.CompanyUncheckedCreateInput, tx: PrismaClientLike) {
    return tx.company.create({
      data,
      select: COMPANY_SELECT,
    });
  }

  /** Deja al usuario como miembro de la empresa (ADMIN al crearla). */
  addMember(
    userId: string,
    companyId: string,
    role: Role,
    tx: PrismaClientLike,
  ) {
    return tx.membership.create({
      data: { userId, companyId, role, active: true },
    });
  }

  update(companyId: string, data: Prisma.CompanyUpdateInput) {
    return this.prisma.company.update({
      where: { id: companyId },
      data,
      select: COMPANY_SELECT,
    });
  }

  /** El RIF identifica a la empresa: es unico en todo el sistema. */
  findByRif(rif: string) {
    return this.prisma.company.findUnique({
      where: { rif },
      select: { id: true },
    });
  }
}
