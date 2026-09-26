import type { Role, SheetUpdatedPayload } from './types';

export type { SheetUpdatedPayload };

export interface ConnectionReadyPayload {
  socketId: string;
  connectedAt: string;
  user: {
    userId: string;
    username: string;
    role: Role;
  };
}
