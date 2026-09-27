/**
 * Fachada do registro de classes.
 *
 * O registro foi dividido em um arquivo por classe em `./classes/`, e o
 * `classes/index.ts` reúne o mapa `classKey → definição` e as funções
 * utilitárias. Este arquivo só reexporta esse índice para que os imports
 * históricos de `shared/classes.js` continuem funcionando sem alterações.
 */
export * from './classes/index.js';
