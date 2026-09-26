import 'dotenv/config';
import { z } from 'zod';

/**
 * Toda variável de ambiente lida pela aplicação passa por aqui.
 * Se alguma estiver ausente ou inválida, o processo encerra na inicialização
 * com uma mensagem clara — evita falhas silenciosas em produção.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  CORS_ORIGIN: z.string().default('*'),

  // Autenticação
  JWT_SECRET: z.string().min(16, 'JWT_SECRET precisa de ao menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  /** Código exigido no cadastro para criar uma conta de Mestre. */
  MASTER_INVITE_CODE: z.string().min(4).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas ou ausentes:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** Lista de origens permitidas para CORS. `*` libera todas (útil em dev). */
export const corsOrigins =
  env.CORS_ORIGIN === '*'
    ? '*'
    : env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
