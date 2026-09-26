import { randomUUID } from 'node:crypto';
import { ServerEvents, type PresentationDto } from '../../realtime/events.js';
import { getBroadcaster } from '../../realtime/hub.js';
import type { PresentImageInput } from './presentation.schema.js';

/**
 * Apresentação de imagens ("mostrar aos jogadores").
 *
 * É um estado efêmero da sessão: vive só na memória do servidor enquanto o
 * mestre quiser, sem tocar no banco. Guardar o valor atual em memória também
 * permite reenviá-lo a quem conectar no meio da apresentação.
 */
let current: PresentationDto | null = null;

/** Apresentação em andamento (ou `null`). */
export function getCurrentPresentation(): PresentationDto | null {
  return current;
}

function toTable(event: (typeof ServerEvents)[keyof typeof ServerEvents], payload: unknown): void {
  try {
    getBroadcaster().toTable(event, payload);
  } catch (error) {
    console.error('[presentation] falha ao publicar evento em tempo real:', error);
  }
}

/** Coloca uma imagem na tela de toda a mesa. */
export function presentImage(input: PresentImageInput, presentedBy: string): PresentationDto {
  const presentation: PresentationDto = {
    id: randomUUID(),
    imageUrl: input.imageUrl,
    alt: input.alt ?? '',
    presentedBy,
    at: new Date().toISOString(),
  };

  current = presentation;
  toTable(ServerEvents.PRESENTATION_SHOWN, { presentation });

  return presentation;
}

/**
 * Encerra a apresentação atual e limpa as telas. Idempotente: fechar sem nada
 * aberto apenas reenvia o fechamento (útil se algum cliente perdeu o evento).
 */
export function closePresentation(): void {
  const id = current?.id ?? null;
  current = null;
  toTable(ServerEvents.PRESENTATION_CLOSED, { presentationId: id });
}
