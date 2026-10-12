/** Converte um texto em inteiro dentro de limites, com valor de reserva. */
export function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/** Converte um texto em número decimal dentro de limites. */
export function clampFloat(raw: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseFloat(raw.replace(',', '.'));
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Forma mínima da Web Crypto que este arquivo usa.
 *
 * Declarada à mão porque `globalThis.crypto` é tipado como se `randomUUID`
 * existisse SEMPRE — e é justamente ele que falta fora de contexto seguro.
 */
type WebCryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

/**
 * `operationId`/chave de idempotência: um identificador EFÊMERO do cliente.
 *
 * POR QUE ESTE HELPER EXISTE: `crypto.randomUUID()` só é exposto em CONTEXTOS
 * SEGUROS (HTTPS ou `http://localhost`). Acessando a mesa por HTTP num IP de
 * rede (ex.: `http://192.168.0.10:3000`), `crypto.randomUUID` fica `undefined`
 * e QUALQUER chamada direta estoura `crypto.randomUUID is not a function` — era
 * o que derrubava todas as ações de combate. `crypto.getRandomValues` continua
 * disponível nesses contextos, então é o primeiro recurso de reserva.
 *
 * Ordem: `randomUUID` → `getRandomValues` (UUID v4 montado dos bytes) →
 * relógio + entropia do `Math` (último recurso, NUNCA só o relógio).
 *
 * O contrato de idempotência NÃO muda: o servidor continua sendo a autoridade
 * (`operationId` único por operação + `expectedVersion`). Aqui só se garante
 * que a string é produzida em qualquer ambiente do navegador.
 */
export function createOperationId(): string {
  const webCrypto = (globalThis as { crypto?: WebCryptoLike }).crypto;

  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();

  if (typeof webCrypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    // UUID v4 (RFC 4122): versão `4` e variante `10` nos bits certos.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Último recurso (ambiente sem Web Crypto): relógio + duas fontes de
  // entropia, para dois ids no mesmo milissegundo NÃO colidirem.
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Gera um id local para itens de coleções (inventário, magias, ataques...) e
 * para chaves de idempotência: MESMO mecanismo do `createOperationId`, para
 * não existir um segundo fallback espalhado pelo cliente.
 */
export function newId(): string {
  return createOperationId();
}

/** Momento atual em ISO — usado para marcar alterações otimistas. */
export function nowIso(): string {
  return new Date().toISOString();
}
