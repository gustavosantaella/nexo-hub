import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { Role } from '../constants/enums';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/** Verifica que el usuario autenticado tenga uno de los roles requeridos. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user) throw new UnauthorizedException('No autenticado');
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        'No tienes permisos suficientes para realizar esta accion',
      );
    }
    return true;
  }
}
