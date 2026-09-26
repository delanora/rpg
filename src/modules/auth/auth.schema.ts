import { z } from 'zod';

/** Nomes de usuário são normalizados para minúsculas para evitar duplicatas. */
const usernameField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'O usuário precisa ter ao menos 3 caracteres.')
  .max(32, 'O usuário pode ter no máximo 32 caracteres.')
  .regex(/^[a-z0-9_.-]+$/, 'Use apenas letras, números, ponto, hífen ou sublinhado.');

export const registerSchema = z.object({
  username: usernameField,
  displayName: z
    .string()
    .trim()
    .min(1, 'Informe o nome de exibição.')
    .max(60, 'O nome de exibição pode ter no máximo 60 caracteres.'),
  password: z
    .string()
    .min(8, 'A senha precisa ter ao menos 8 caracteres.')
    .max(100, 'A senha pode ter no máximo 100 caracteres.'),
  /** Quando informado e válido, cria a conta com papel MASTER. */
  masterInviteCode: z.string().trim().min(1).optional(),
});

export const loginSchema = z.object({
  username: usernameField,
  password: z.string().min(1, 'Informe a senha.').max(100),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
