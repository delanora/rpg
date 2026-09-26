import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { corsOrigins } from '../config/env.js';
import { errorHandler, notFoundHandler } from '../middlewares/errorHandler.js';
import { apiRouter } from './routes/index.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * `src/http` em desenvolvimento e `dist/http` após o build estão ambos a dois
 * níveis da raiz, então o caminho abaixo vale nos dois casos.
 */
const clientDist = path.resolve(currentDir, '../../client/dist');

function securityMiddleware(): ReturnType<typeof helmet> {
  return helmet({
    // O frontend servido de outro domínio (Vite em dev) precisa consumir a API.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // O Vite injeta estilos no documento no modo de desenvolvimento.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        // Removido de propósito: o sistema é acessado por IP em HTTP simples,
        // e o upgrade forçado para HTTPS quebraria o carregamento da página.
        upgradeInsecureRequests: null,
      },
    },
  });
}

/**
 * Monta a aplicação Express (sem `listen`).
 * Fica separada do servidor HTTP para que o Socket.io possa compartilhar
 * a mesma instância de `http.Server`.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  app.use(securityMiddleware());

  app.use(
    cors({
      origin: corsOrigins === '*' ? true : corsOrigins,
      credentials: true,
    }),
  );

  // Limite reduzido: as fichas de personagem são pequenas e trafegam por eventos.
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', apiRouter);

  // Em produção, o Express também serve o app React já buildado, de modo que
  // tudo fica numa única porta (útil para acesso por IP).
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));

    const indexHtml = path.join(clientDist, 'index.html');
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.sendFile(indexHtml);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
