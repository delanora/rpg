import type {
  CreatureCreatedPayload,
  CreatureDeletedPayload,
  CreatureUpdatedPayload,
  ItemCreatedPayload,
  ItemDeletedPayload,
  ItemUpdatedPayload,
  LocalityCreatedPayload,
  LocalityDeletedPayload,
  LocalityUpdatedPayload,
  PresentationClosedPayload,
  PresentationShownPayload,
  Role,
  SheetUpdatedPayload,
} from './types';

export type {
  CreatureCreatedPayload,
  CreatureDeletedPayload,
  CreatureUpdatedPayload,
  ItemCreatedPayload,
  ItemDeletedPayload,
  ItemUpdatedPayload,
  LocalityCreatedPayload,
  LocalityDeletedPayload,
  LocalityUpdatedPayload,
  PresentationClosedPayload,
  PresentationShownPayload,
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
