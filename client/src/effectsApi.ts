import { api } from './api';
import { createOperationId } from './utils';
import type { EffectDto, EffectModifierDto, EffectVisibility, MechanicalEntity } from './types';

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

/** Encerra UMA instância (o servidor nunca encerra por label). */
export function endEffect(effectId: string): Promise<EffectDto> {
  return api<{ effect: EffectDto }>(`/api/effects/${effectId}/end`, {
    method: 'POST',
    body: { operationId: createOperationId() },
  }).then((result) => result.effect);
}
