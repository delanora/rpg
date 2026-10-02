/**
 * Fachada do catálogo de ferramentas.
 *
 * O catálogo vive em `./tools/` (`types.ts`, `catalog.ts` e `index.ts`), e este
 * arquivo só reexporta o índice — mesmo padrão de `shared/classes.ts`. Como o
 * projeto usa `moduleResolution: NodeNext`, imports de diretório não resolvem,
 * então quem precisa do catálogo importa `shared/tools.js`.
 */
export * from './tools/index.js';
