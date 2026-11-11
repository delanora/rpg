import type { DeathSavePresentation } from '../types';

/** Narração da apresentação: não calcula salvaguardas nem modifica o ciclo de morte. */
export function deathFateMessage(
  state: DeathSavePresentation | null | undefined,
  natural: number | null = null,
): { text: string; tone: 'neutral' | 'hope' | 'peril' } {
  if (natural === 20)
    return { text: 'Você foi abençoado pelos deuses!', tone: 'hope' };
  if (state?.stabilized || (state?.successes ?? 0) >= 3)
    return { text: 'Os deuses concederam mais uma chance.', tone: 'hope' };
  if (state?.dead || (state?.failures ?? 0) >= 3)
    return { text: 'Seu nome agora pertence às lendas.', tone: 'peril' };
  const successes = state?.successes ?? 0;
  const failures = state?.failures ?? 0;
  if (successes === 0 && failures === 0)
    return { text: 'Que os deuses decidam seu destino.', tone: 'neutral' };
  if (successes === failures)
    return { text: 'Os deuses ainda discutem seu destino.', tone: 'neutral' };
  if (successes > failures)
    return {
      text:
        successes === 1
          ? 'Os deuses parecem estar ao seu favor.'
          : 'Ainda não é hora de escrever seu epitáfio.',
      tone: 'hope',
    };
  return {
    text:
      failures === 1
        ? 'Talvez os deuses tenham se distraído.'
        : 'A morte já sabe o seu nome.',
    tone: 'peril',
  };
}
