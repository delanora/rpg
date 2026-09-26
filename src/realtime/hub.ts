import type { Broadcaster } from './broadcast.js';

/**
 * Ponto único de acesso ao broadcaster de tempo real.
 *
 * Os módulos de domínio (fichas, combate) chamam `getBroadcaster()` para emitir
 * eventos sem conhecer o `io` do Socket.io. A instância é registrada uma única
 * vez em `createRealtimeServer`.
 */
let broadcaster: Broadcaster | null = null;

export function setBroadcaster(value: Broadcaster): void {
  broadcaster = value;
}

export function getBroadcaster(): Broadcaster {
  if (!broadcaster) {
    throw new Error('A camada de tempo real ainda não foi inicializada.');
  }
  return broadcaster;
}
