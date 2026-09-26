import type { TokenPayload } from '../lib/jwt.js';

declare global {
  namespace Express {
    interface Request {
      /** Preenchido pelo middleware `authenticate` após validar o JWT. */
      user?: TokenPayload;
    }
  }
}

export {};
