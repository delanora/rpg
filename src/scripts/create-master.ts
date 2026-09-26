import { prisma } from '../config/prisma.js';
import { hashPassword } from '../lib/password.js';

/**
 * Cria (ou atualiza) a conta de Mestre pela linha de comando.
 *
 *   npm run create-master -- --username mestre --password "senha-forte" --name "Mestre"
 *
 * É o caminho administrativo para o primeiro mestre; depois disso, outros
 * mestres podem ser criados pelo cadastro usando o `MASTER_INVITE_CODE`.
 */
function readArg(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);

  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1];

  return undefined;
}

async function main(): Promise<void> {
  const username = (readArg('username') ?? process.env.MASTER_USERNAME)?.trim().toLowerCase();
  const password = readArg('password') ?? process.env.MASTER_PASSWORD;
  const displayName = readArg('name') ?? process.env.MASTER_NAME ?? 'Mestre';

  if (!username || !password) {
    console.error(
      'Uso: npm run create-master -- --username <usuario> --password <senha> [--name "Nome"]',
    );
    process.exitCode = 1;
    return;
  }

  if (password.length < 8) {
    console.error('A senha precisa ter ao menos 8 caracteres.');
    process.exitCode = 1;
    return;
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash, displayName, role: 'MASTER' },
    create: { username, passwordHash, displayName, role: 'MASTER' },
  });

  console.log(`✔ Mestre pronto: ${user.username} (${user.id})`);
}

main()
  .catch((error) => {
    console.error('❌ Falha ao criar o mestre:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
