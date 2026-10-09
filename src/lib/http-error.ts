/**
 * Erro de aplicação com status HTTP embutido.
 * O `errorHandler` central reconhece a propriedade `status` e responde com ela.
 *
 * `code` é um identificador LEGÍVEL PELA MÁQUINA do erro (ex.:
 * `IDEMPOTENCY_KEY_REUSED`). Quando presente, o handler o usa como `error` na
 * resposta em vez do genérico `REQUEST_ERROR` — ver middlewares/errorHandler.ts.
 *
 * `details` são dados ESTRUTURADOS que o cliente precisa para explicar o erro ao
 * usuário (ex.: `required`/`contributed`/`remaining` no 409
 * `CAMP_SUPPLIES_INSUFFICIENT`) — vão no corpo sob a chave `details`.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
