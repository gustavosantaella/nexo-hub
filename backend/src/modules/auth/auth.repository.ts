import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Role } from '../../common/constants/enums';
import {
  PrismaService,
  type PrismaClientLike,
} from '../../prisma/prisma.service';

/** Datos del alta publica: la empresa y la cuenta de su primer ADMIN. */
export interface NewAccountInput {
  company: Prisma.CompanyUncheckedCreateInput;
  user: Prisma.UserUncheckedCreateInput;
}

/**
 * Acceso a datos del registro publico (empresa + cuenta + membresia). Toda
 * consulta/escritura de Prisma que necesita `AuthService` vive aqui: el
 * servicio conserva las reglas de negocio (correo y RIF unicos), pero no
 * conoce el cliente de base de datos.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Ejecuta una unidad de trabajo dentro de una transaccion de base de datos. */
  transaction<T>(work: (tx: PrismaClientLike) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(tx));
  }

  /** Cuenta con ese correo (`null` si el correo esta libre). */
  findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /** Empresa con ese RIF (`null` si el RIF esta libre). */
  findCompanyByRif(rif: string) {
    return this.prisma.company.findUnique({ where: { rif } });
  }

  /**
   * Crea la empresa, la cuenta de su primer usuario y la membresia ADMIN en una
   * sola transaccion: la empresa nunca queda sin administrador.
   */
  async registerWithAdmin(input: NewAccountInput) {
    return this.transaction(async (tx) => {
      const company = await tx.company.create({ data: input.company });
      const user = await tx.user.create({ data: input.user });
      await tx.membership.create({
        data: {
          userId: user.id,
          companyId: company.id,
          role: Role.ADMIN,
          active: true,
        },
      });
      return { user, company };
    });
  }
}
