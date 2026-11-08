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
  SceneCreatedPayload,
  SceneDeletedPayload,
  SceneUpdatedPayload,
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
  SceneCreatedPayload,
  SceneDeletedPayload,
  SceneUpdatedPayload,
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

export const COMBAT_PING_EVENT = 'combat:ping' as const;
