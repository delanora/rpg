import { api } from './api';
import { createOperationId } from './utils';
import type {
  EffectDto,
  EffectModifierDto,
  EffectVisibility,
  MechanicalEntity,
  PendingEffectSaveDto,
} from './types';

/**
 * EFEITOS GENÉRICOS (Fase 6.5A) — só lifecycle.
 *
 * O servidor filtra a privacidade: o jogador recebe apenas os efeitos `public`
 * do próprio personagem; o Mestre recebe tudo. O cliente nunca decide o modo
 * de visibilidade de um efeito existente.
 */
export function fetchEffects(entity: MechanicalEntity): Promise<EffectDto[]> {
  return api<{ effects: EffectDto[] }>(`/api/effects/${entity.kind}/${entity.id}`).then(
    (result) => result.effects,
  );
}

/**
 * Criação MANUAL (Mestre): nome + visibilidade + alvo já selecionado.
 *
 * `modifiers` são as fixtures de teste da engine (Fase 6.5B): nada aqui é
 * conteúdo de PHB. O servidor valida cada modificador com a união tipada —
 * um cliente adulterado não consegue inventar um modificador fora do schema.
 */
export function createManualEffect(input: {
  label: string;
  target: MechanicalEntity;
  visibility: EffectVisibility;
  modifiers?: EffectModifierDto[];
  /** Conditions que o efeito aplica (6.5C) — chaves do catálogo PHB. */
  conditions?: string[];
}): Promise<EffectDto> {
  return api<{ effect: EffectDto }>('/api/effects', {
    method: 'POST',
    body: {
      ...input,
      operationId: createOperationId(),
      sourceType: 'manual',
    },
  }).then((result) => result.effect);
}

/**
 * APLICAÇÃO CONTROLADA DE BLESS (Mestre, 6.5G).
 *
 * Ferramenta de prova da engine — não é conjuração de jogador: o servidor cria
 * o grupo, uma instância por alvo (até 3) e a concentração do caster. Nenhum
 * dado de magia (slot/Ação/alcance) é enviado ou consumido.
 */
export function applyBlessEffect(input: {
  caster: MechanicalEntity;
  targets: MechanicalEntity[];
}): Promise<{ groupId: string; effects: EffectDto[] }> {
  return api<{ groupId: string; effects: EffectDto[] }>('/api/effects/bless', {
    method: 'POST',
    body: { ...input, operationId: createOperationId() },
  });
}

/**
 * APLICAÇÃO CONTROLADA DE IMOBILIZAR PESSOA (Mestre, 6.5H).
 *
 * Ferramenta de prova da engine — NÃO é conjuração de jogador. O servidor só
 * cria a PENDÊNCIA de salvaguarda de Sabedoria; Effect/Paralyzed/Concentração
 * nascem na falha do save. A CD é manual nesta fase (fallback documentado).
 */
export function applyHoldPersonEffect(input: {
  caster: MechanicalEntity;
  target: MechanicalEntity;
  dc: number;
}): Promise<{ pending: PendingEffectSaveDto }> {
  return api<{ pending: PendingEffectSaveDto }>('/api/effects/hold-person', {
    method: 'POST',
    body: { ...input, operationId: createOperationId() },
  });
}

/** Pendências de salvaguarda de um alvo (o servidor filtra a privacidade). */
export function fetchPendingEffectSaves(
  entity: MechanicalEntity,
): Promise<PendingEffectSaveDto[]> {
  return api<{ pending: PendingEffectSaveDto[] }>(
    `/api/effects/pending/${entity.kind}/${entity.id}`,
  ).then((result) => result.pending);
}

/** Cancela a aplicação ANTES do save (ferramenta do Mestre). */
export function cancelPendingEffectSave(pendingId: string): Promise<PendingEffectSaveDto> {
  return api<{ pending: PendingEffectSaveDto }>(`/api/effects/pending/${pendingId}/cancel`, {
    method: 'POST',
  }).then((result) => result.pending);
}

/**
 * Resolve o save pelo MESMO pipeline de dados: o servidor rola o d20, calcula o
 * bônus (ficha + Condições + Effects) e usa o atributo/CD da pendência. O
 * cliente não envia resultado, bônus nem atributo.
 */
export function rollPendingEffectSave(input: {
  pendingId: string;
  visibility?: 'public' | 'private';
  selectedEffectModifiers?: string[];
}): Promise<void> {
  return api('/api/dice/roll', {
    method: 'POST',
    body: {
      kind: 'save',
      pendingEffectSaveId: input.pendingId,
      // Pool fixo: o servidor ignora e rola UM d20 (dois com vantagem/desvantagem).
      dice: [{ sides: 20 }],
      ...(input.visibility ? { visibility: input.visibility } : {}),
      ...(input.selectedEffectModifiers?.length
        ? { selectedEffectModifiers: input.selectedEffectModifiers }
        : {}),
      clientId: createOperationId(),
    },
  }).then(() => undefined);
}

/** Encerra UMA instância (o servidor nunca encerra por label). */
export function endEffect(effectId: string): Promise<EffectDto> {
  return api<{ effect: EffectDto }>(`/api/effects/${effectId}/end`, {
    method: 'POST',
    body: { operationId: createOperationId() },
  }).then((result) => result.effect);
}
