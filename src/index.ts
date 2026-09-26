import { createServer } from 'node:http';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { createApp } from './http/app.js';
import { createRealtimeServer } from './realtime/index.js';

async function bootstrap(): Promise<void> {
  const app = createApp();
  const httpServer = createServer(app);

  const io = createRealtimeServer(httpServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(env.PORT, resolve);
  });

  console.log(`🐉 Grimório Digital — ${env.NODE_ENV}`);
  console.log(`   HTTP + WebSocket em http://localhost:${env.PORT}`);
  console.log(`   Health check em http://localhost:${env.PORT}/api/health`);

  /** Fecha conexões e o banco antes de encerrar o processo. */
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n${signal} recebido, encerrando...`);

    // Rede de segurança: se alguma conexão segurar o fechamento, não ficamos presos.
    const forceExit = setTimeout(() => {
      console.error('Encerramento demorou demais; forçando saída.');
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    io.close();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    await prisma.$disconnect();

    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('❌ Falha ao iniciar o servidor:', err);
  process.exit(1);
});
