/** Frases e revelação com o componente real, sem rede nem dados da mesa. */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
  url: 'http://localhost',
});
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = dom.window;
globals.document = dom.window.document;
globals.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { DeathFateHeader } = await import('../src/dice/DeathFateHeader');
const { deathFateMessage } = await import('../src/dice/deathFateMessages');
import type { DiceRollDto, DeathSavePresentation } from '../src/types';
const state = (
  successes: number,
  failures: number,
  stabilized = false,
): DeathSavePresentation => ({ successes, failures, stabilized, dead: false });
const cases: [DeathSavePresentation, string][] = [
  [state(0, 0), 'Que os deuses decidam seu destino.'],
  [state(1, 0), 'Os deuses parecem estar ao seu favor.'],
  [state(2, 0), 'Ainda não é hora de escrever seu epitáfio.'],
  [state(3, 0), 'Os deuses concederam mais uma chance.'],
  [state(0, 1), 'Talvez os deuses tenham se distraído.'],
  [state(0, 2), 'A morte já sabe o seu nome.'],
  [state(0, 3), 'Seu nome agora pertence às lendas.'],
  [state(1, 1), 'Os deuses ainda discutem seu destino.'],
  [state(2, 2), 'Os deuses ainda discutem seu destino.'],
  [state(2, 1), 'Ainda não é hora de escrever seu epitáfio.'],
  [state(1, 2), 'A morte já sabe o seu nome.'],
  [state(0, 0, true), 'Os deuses concederam mais uma chance.'],
];
for (const [input, text] of cases)
  assert.equal(deathFateMessage(input).text, text);
assert.equal(
  deathFateMessage(state(0, 0), 20).text,
  'Você foi abençoado pelos deuses!',
);
const result = {
  kind: 'death-save',
  dice: [{ sides: 20, value: 20 }],
  deathSaveState: { before: state(0, 2), after: state(0, 0) },
} as DiceRollDto;
const root = createRoot(document.getElementById('root')!);
try {
  await act(async () =>
    root.render(
      h(DeathFateHeader, { before: state(0, 2), result, settled: false }),
    ),
  );
  assert.ok(document.body.textContent?.includes('A morte já sabe o seu nome.'));
  assert.ok(!document.body.textContent?.includes('abençoado'));
  await act(async () =>
    root.render(
      h(DeathFateHeader, { before: state(0, 2), result, settled: true }),
    ),
  );
  assert.ok(
    document.body.textContent?.includes('Você foi abençoado pelos deuses!'),
  );
  const image = document.querySelector('img')!;
  assert.equal(image.getAttribute('alt'), '');
  assert.equal(image.getAttribute('src'), '/death-save/adorno-destino.png');
  console.log(
    '✔ 13 estados aprovados, desempate, estabilização com contadores zerados, 20 natural e mensagem preservada até revelar.',
  );
} finally {
  await act(async () => root.unmount());
  dom.window.close();
}
