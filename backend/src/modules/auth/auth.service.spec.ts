import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { Role } from '../../common/constants/enums';
import {
  COMPANY_UNDER_REVIEW_CODE,
  COMPANY_UNDER_REVIEW_MESSAGE,
} from '../../common/constants/messages';
import { hashPassword } from '../../common/utils/password.util';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CompaniesService } from '../companies/companies.service';
import type { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import type { LoginDto } from './dto/login.dto';
import type { SwitchCompanyDto } from './dto/switch-company.dto';

/** Cuenta usada en las pruebas (su hash se calcula en cada caso). */
const USER_ID = 'u1';
const EMAIL = 'admin@nexohub.com';
const PASSWORD = 'Admin123!';

/** Mensaje exacto que ve el usuario cuando su empresa sigue en revision. */
const ESPERADO_EMPRESA_EN_REVISION =
  'Su empresa aun sigue estando en revision. por favor espere a que lo contactemos';

/** Membresia tal como la devuelve `UsersService.membershipsOf`. */
function membership(
  companyId: string,
  role: Role,
  options: { membershipActive?: boolean; companyActive?: boolean } = {},
) {
  const { membershipActive = true, companyActive = true } = options;
  return {
    id: `m-${companyId}`,
    role,
    active: membershipActive,
    company: {
      id: companyId,
      name: `Empresa ${companyId}`,
      rif: `J-${companyId}`,
      active: companyActive,
    },
  };
}

/** Perfil de empresa tal como lo devuelve `CompaniesService.findOne`. */
function companyProfile(companyId: string) {
  return {
    id: companyId,
    name: `Empresa ${companyId}`,
    rif: `J-${companyId}`,
    phone: null,
    email: null,
    address: null,
    notes: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Usuario tal como lo devuelve `UsersService.findById`. */
function usuario() {
  return {
    id: USER_ID,
    email: EMAIL,
    name: 'Administrador',
    documentId: 'V-1',
    phone: null,
    avatarUrl: null,
    active: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Ejecuta la promesa y devuelve el error con el que fallo (falla si resuelve). */
async function expectFailure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba un error y la promesa se resolvio');
}

describe('AuthService (acceso por empresa)', () => {
  let service: AuthService;
  let passwordHash: string;
  let users: {
    findByEmailWithPassword: jest.Mock;
    membershipsOf: jest.Mock;
    membershipOf: jest.Mock;
    findById: jest.Mock;
    markLogin: jest.Mock;
  };
  let companies: { findOne: jest.Mock };

  /** Deja al usuario con las membresias indicadas y la contrasena correcta. */
  function session(
    rows: ReturnType<typeof membership>[],
    userActive = true,
  ): void {
    users.findByEmailWithPassword.mockResolvedValue({
      ...usuario(),
      active: userActive,
      passwordHash,
    });
    users.membershipsOf.mockResolvedValue(rows);
    users.membershipOf.mockImplementation(
      async (_userId: string, companyId: string) =>
        rows.find((row) => row.company.id === companyId) ?? null,
    );
    users.findById.mockResolvedValue(usuario());
    companies.findOne.mockImplementation(async (companyId: string) =>
      companyProfile(companyId),
    );
  }

  function loginDto(password = PASSWORD): LoginDto {
    return { email: EMAIL, password };
  }

  beforeEach(async () => {
    passwordHash = await hashPassword(PASSWORD);
    users = {
      findByEmailWithPassword: jest.fn(),
      membershipsOf: jest.fn(async () => []),
      membershipOf: jest.fn(async () => null),
      findById: jest.fn(async () => usuario()),
      markLogin: jest.fn(async () => undefined),
    };
    companies = { findOne: jest.fn(async (id: string) => companyProfile(id)) };

    service = new AuthService(
      users as unknown as UsersService,
      companies as unknown as CompaniesService,
      {} as PrismaService,
      { signAsync: jest.fn(async () => 'jwt-token') } as unknown as JwtService,
    );
  });

  it('inicia sesion en la primera empresa activa del usuario', async () => {
    session([
      membership('c1', Role.ADMIN, { companyActive: false }),
      membership('c2', Role.MANAGER),
    ]);

    const result = await service.login(loginDto());

    expect(result.company.id).toBe('c2');
    expect(result.role).toBe(Role.MANAGER);
    expect(result.accessToken).toBe('jwt-token');
    // La empresa en revision ni siquiera se ofrece para cambiar de empresa.
    expect(result.companies.map((item) => item.id)).toEqual(['c2']);
    expect(users.markLogin).toHaveBeenCalledWith(USER_ID);
  });

  it('bloquea el login si su empresa aun sigue en revision', async () => {
    session([membership('c1', Role.ADMIN, { companyActive: false })]);

    const error = (await expectFailure(
      service.login(loginDto()),
    )) as unknown as ForbiddenException;

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getStatus()).toBe(403);
    const body = error.getResponse() as { message: string; code: string };
    expect(body.message).toBe(ESPERADO_EMPRESA_EN_REVISION);
    expect(COMPANY_UNDER_REVIEW_MESSAGE).toBe(ESPERADO_EMPRESA_EN_REVISION);
    expect(body.code).toBe(COMPANY_UNDER_REVIEW_CODE);
    // No se emite token ni se marca el ultimo acceso.
    expect(users.markLogin).not.toHaveBeenCalled();
  });

  it('bloquea el login tambien si la membresia y la empresa estan inactivas', async () => {
    session([
      membership('c1', Role.ADMIN, {
        companyActive: false,
        membershipActive: false,
      }),
    ]);

    const error = (await expectFailure(
      service.login(loginDto()),
    )) as unknown as ForbiddenException;

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error.getResponse() as { message: string }).message).toBe(
      ESPERADO_EMPRESA_EN_REVISION,
    );
  });

  it('avisa cuando al usuario le quitaron el acceso a sus empresas activas', async () => {
    session([membership('c1', Role.ADMIN, { membershipActive: false })]);

    const error = (await expectFailure(
      service.login(loginDto()),
    )) as unknown as UnauthorizedException;

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error.getResponse() as { message: string }).message).toBe(
      'Tu cuenta no tiene ninguna empresa activa. Contacta al administrador.',
    );
  });

  it('avisa cuando la cuenta no pertenece a ninguna empresa', async () => {
    session([]);

    const error = (await expectFailure(
      service.login(loginDto()),
    )) as unknown as UnauthorizedException;

    expect(error).toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza la contrasena incorrecta', async () => {
    session([membership('c1', Role.ADMIN)]);

    const error = (await expectFailure(
      service.login(loginDto('Otra123!')),
    )) as unknown as UnauthorizedException;

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error.getResponse() as { message: string }).message).toBe(
      'Credenciales invalidas',
    );
    expect(users.markLogin).not.toHaveBeenCalled();
  });

  it('rechaza usuarios inactivos sin filtrar informacion', async () => {
    session([membership('c1', Role.ADMIN)], false);

    const error = (await expectFailure(
      service.login(loginDto()),
    )) as unknown as UnauthorizedException;

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error.getResponse() as { message: string }).message).toBe(
      'Credenciales invalidas',
    );
  });

  it('no emite token al cambiar a una empresa en revision', async () => {
    users.membershipOf.mockResolvedValue(
      membership('c2', Role.MANAGER, { companyActive: false }),
    );

    const error = (await expectFailure(
      service.switchCompany(USER_ID, { companyId: 'c2' } as SwitchCompanyDto),
    )) as unknown as ForbiddenException;

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toEqual({
      message: ESPERADO_EMPRESA_EN_REVISION,
      code: COMPANY_UNDER_REVIEW_CODE,
    });
  });

  it('no emite token al cambiar a una empresa donde no tiene acceso', async () => {
    users.membershipOf.mockResolvedValue(null);

    const error = (await expectFailure(
      service.switchCompany(USER_ID, { companyId: 'c9' } as SwitchCompanyDto),
    )) as unknown as UnauthorizedException;

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error.getResponse() as { message: string }).message).toBe(
      'No tienes acceso a esa empresa',
    );
  });
});

