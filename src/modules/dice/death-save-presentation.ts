import type { DeathSavePresentation } from './dice.dto.js';

/** Projeção mínima: não publica PV, pendências narrativas nem o log privado. */
export function deathSavePresentationOf(
  state: DeathSavePresentation,
): DeathSavePresentation {
  return {
    successes: state.successes,
    failures: state.failures,
    stabilized: state.stabilized,
    dead: state.dead,
  };
}
