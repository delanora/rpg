/**
 * Teste do helper central de `operationId` (`createOperationId`).
 *
 * O BUG: `crypto.randomUUID()` só é exposto em CONTEXTO SEGURO (HTTPS ou
 * `http://localhost`). Abrindo a mesa por HTTP num IP de rede, ele fica
 * `undefined` e toda ação de combate falhava com
 * `crypto.randomUUID is not a function`.
 *
 * Este script simula cada ambiente (com `randomUUID`, sem `randomUUID` mas com
 * `getRandomValues`, e sem Web Crypto nenhuma) e confirma que:
 *   • o id ainda é criado;
 *   • duas chamadas geram ids DIFERENTES;
 *   • o corpo das operações de combate (`operationFor`) não estoura.
 *
 * Rode com `npm run test:operation-id`. Sai com código 1 se algo falhar (o erro
 * final derruba o processo — não é preciso depender de tipos do Node aqui).
 */
import { createOperationId, newId } from '../src/utils';
import { operationFor } from '../src/combat/combatApi';
import type { CombatDto } from '../src/types';

let failures = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (!condition) failures += 1;
  console.log(
    `  ${condition ? '✔' : '✘'} ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`,
  );
}

/** Formato de um UUID v4 (o que `randomUUID` e o fallback por bytes produzem). */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Gera N ids e devolve quantos são únicos. */
function uniqueCount(generate: () => string, count = 1000): number {
  const ids = new Set<string>();
  for (let index = 0; index < count; index += 1) ids.add(generate());
  return ids.size;
}

/** Substitui `globalThis.crypto` (o runtime define a propriedade com getter). */
function stubCrypto(value: unknown): void {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value });
}

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const combat = { id: 'combat-de-teste', version: 7 } as unknown as CombatDto;

try {
  // 1) Contexto SEGURO: Web Crypto completa (o caminho que sempre existiu).
  check('1) ambiente com randomUUID devolve um UUID v4', UUID_V4.test(createOperationId()));
  check('1) 1000 ids no mesmo ambiente são todos únicos', uniqueCount(createOperationId) === 1000);

  // 2) Contexto NÃO seguro: sem `randomUUID`, mas com `getRandomValues`.
  //    É exatamente o caso de acessar a mesa por HTTP em IP de rede.
  //
  // O stub imita um CSPRNG: uma sequência determinística, MAS que avança entre
  // chamadas (xorshift32 com `Math.imul`, sem estourar a precisão do número).
  let state = 0x9e3779b9;
  const nextByte = (): number => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state & 0xff;
  };
  stubCrypto({
    getRandomValues: (array: Uint8Array) => {
      for (let index = 0; index < array.length; index += 1) array[index] = nextByte();
      return array;
    },
  });
  check('2) sem randomUUID o id continua sendo criado', typeof createOperationId() === 'string' && createOperationId().length > 0);
  check('2) o id do fallback mantém o formato UUID v4', UUID_V4.test(createOperationId()));
  check('2) 1000 ids com getRandomValues são todos únicos', uniqueCount(createOperationId) === 1000);
  check('2) duas chamadas seguidas geram ids diferentes', createOperationId() !== createOperationId());

  const withoutRandomUuid = operationFor(combat);
  check(
    '2) a operação de combate não estoura e carrega o operationId',
    withoutRandomUuid.combatId === 'combat-de-teste' &&
      withoutRandomUuid.expectedVersion === 7 &&
      UUID_V4.test(withoutRandomUuid.operationId),
    withoutRandomUuid.operationId,
  );
  check('2) newId() usa o mesmo mecanismo central', UUID_V4.test(newId()));

  // 3) Ambiente hostil: NENHUMA Web Crypto disponível.
  stubCrypto(undefined);
  const first = createOperationId();
  const second = createOperationId();
  check('3) sem Web Crypto o id ainda é criado', typeof first === 'string' && first.length > 0);
  check('3) sem Web Crypto duas chamadas geram ids diferentes', first !== second);
  check('3) o fallback não depende só do relógio', uniqueCount(createOperationId) === 1000);
  const hostile = operationFor(combat);
  check('3) a operação de combate segue funcionando sem Web Crypto', hostile.operationId.length > 0 && hostile.expectedVersion === 7, hostile.operationId);

  // 4) Volta ao normal: o helper volta a preferir o randomUUID do runtime.
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  check('4) restaurar o ambiente devolve o UUID v4 do runtime', UUID_V4.test(createOperationId()));
  check('4) 1000 ids voltam a ser únicos', uniqueCount(createOperationId) === 1000);
} finally {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
}

if (failures > 0) throw new Error(`operationId: ${failures} verificação(ões) falharam.`);
console.log('\n✅ operationId funciona em todos os ambientes.\n');
