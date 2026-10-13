import * as bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/** Genera el hash de una contrasena en texto plano. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Compara una contrasena en texto plano contra su hash. */
export function comparePassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
