import { SetMetadata } from '@nestjs/common';
import type { Role } from '../constants/enums';

export const ROLES_KEY = 'roles';

/** Restringe un endpoint a los roles indicados. Requiere JwtAuthGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
