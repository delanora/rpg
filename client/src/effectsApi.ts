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

/** Encerra UMA instância (o servidor nunca encerra por label). */
export function endEffect(effectId: string): Promise<EffectDto> {
  return api<{ effect: EffectDto }>(`/api/effects/${effectId}/end`, {
    method: 'POST',
    body: { operationId: createOperationId() },
  }).then((result) => result.effect);
}
