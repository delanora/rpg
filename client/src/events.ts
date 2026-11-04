import type {
  CreatureCreatedPayload,
  CreatureDeletedPayload,
  CreatureUpdatedPayload,
  GameConfigPayload,
  ItemCreatedPayload,
  ItemDeletedPayload,
  ItemUpdatedPayload,
  LocalityCreatedPayload,
  LocalityDeletedPayload,
  LocalityUpdatedPayload,
  PresentationClosedPayload,
  PresentationShownPayload,
  RegionCreatedPayload,
  RegionDeletedPayload,
  RegionUpdatedPayload,
  Role,
  SheetUpdatedPayload,
  SpellIntentUpdatedPayload,
} from './types';

export type {
  CreatureCreatedPayload,
  CreatureDeletedPayload,
  CreatureUpdatedPayload,
  GameConfigPayload,
  ItemCreatedPayload,
  ItemDeletedPayload,
  ItemUpdatedPayload,
  LocalityCreatedPayload,
  LocalityDeletedPayload,
  LocalityUpdatedPayload,
  PresentationClosedPayload,
  PresentationShownPayload,
  RegionCreatedPayload,
  RegionDeletedPayload,
  RegionUpdatedPayload,
  SheetUpdatedPayload,
  SpellIntentUpdatedPayload,
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
