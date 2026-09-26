import { api } from './api';
import type { Presentation } from './types';

/**
 * Escritas da apresentação de imagens. Como as demais escritas do domínio,
 * passam por HTTP; o WebSocket apenas divulga o resultado para a mesa.
 */

/** Mostra a imagem na tela de todos os participantes (somente mestre). */
export async function presentImage(imageUrl: string, alt = ''): Promise<Presentation> {
  const { presentation } = await api<{ presentation: Presentation }>('/api/presentation', {
    method: 'POST',
    body: { imageUrl, alt },
  });
  return presentation;
}

/** Fecha a imagem na tela de todos (somente mestre). */
export async function closePresentation(): Promise<void> {
  await api('/api/presentation/close', { method: 'POST' });
}
