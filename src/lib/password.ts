import { compare, hash } from 'bcryptjs';

/** Custo do bcrypt. 12 é um bom equilíbrio entre segurança e tempo de login. */
const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  return compare(plain, passwordHash);
}
