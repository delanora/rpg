/**
 * Erro de aplicação com status HTTP embutido.
 * O `errorHandler` central reconhece a propriedade `status` e responde com ela.
 *
 * `code` é um identificador LEGÍVEL PELA MÁQUINA do erro (ex.:
 * `IDEMPOTENCY_KEY_REUSED`). Quando presente, o handler o usa como `error` na
 * resposta em vez do genérico `REQUEST_ERROR` — ver middlewares/errorHandler.ts.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
