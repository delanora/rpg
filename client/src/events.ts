import type {
  CreatureCreatedPayload,
  CreatureDeletedPayload,
  CreatureUpdatedPayload,
  Role,
  SheetUpdatedPayload,
} from './types';

export type {
  CreatureCreatedPayload,
  CreatureDeletedPayload,
  CreatureUpdatedPayload,
  SheetUpdatedPayload,
};

export interface ConnectionReadyPayload {
  socketId: string;
  connectedAt: string;
  user: {
    userId: string;
    username: string;
    role: Role;
  };
}
