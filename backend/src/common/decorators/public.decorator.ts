import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca un endpoint como publico (sin autenticacion JWT). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
