import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../lib/http-error.js';

/** Rota não encontrada (404). */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Rota não encontrada: ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Tratador central de erros. Deve ser o último middleware registrado no Express.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: number }).status) || 500
      : 500;

  const message = err instanceof Error ? err.message : 'Erro interno do servidor';

  if (status >= 500) {
    console.error('[erro]', err);
  }

  // `code` só vale para os erros de aplicação (HttpError). Um `code` de erro do
  // Prisma (ex.: P2002) NÃO deve vazar para o cliente.
  const code =
    err instanceof HttpError && err.code
      ? err.code
      : status >= 500
        ? 'INTERNAL_ERROR'
        : 'REQUEST_ERROR';

  // Dados estruturados do erro (ex.: `required`/`contributed`/`remaining` no 409
  // de recursos de acampamento insuficientes). Só vêm de erros de aplicação.
  const details =
    err instanceof HttpError && err.details ? { details: err.details } : {};

  res.status(status).json({
    error: code,
    message,
    ...details,
    ...(env.NODE_ENV === 'development' && err instanceof Error
      ? { stack: err.stack }
      : {}),
  });
}
