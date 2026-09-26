/**
 * Erro de aplicação com status HTTP embutido.
 * O `errorHandler` central reconhece a propriedade `status` e responde com ela.
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
