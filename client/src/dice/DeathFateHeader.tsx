import type { DeathSavePresentation, DiceRollDto } from '../types';
import { deathFateMessage } from './deathFateMessages';

/** O resultado recebido durante o giro só muda a frase depois do pouso. */
export function DeathFateHeader({
  before,
  result,
  settled,
}: {
  before?: DeathSavePresentation | null;
  result: DiceRollDto | null;
  settled: boolean;
}) {
  const message = deathFateMessage(
    settled ? (result?.deathSaveState?.after ?? before) : before,
    settled
      ? (result?.dice.find((die) => die.sides === 20 && !die.dropped)?.value ??
          null)
      : null,
  );
  return (
    <section
      className={`death-fate-header is-${message.tone}`}
      aria-label="Mensagem do destino"
    >
      <p className="death-fate-message" role="status" aria-live="polite">
        {message.text}
      </p>
      <div className="death-fate-ornament" aria-hidden="true">
        <img
          src="/death-save/adorno-destino.png"
          alt=""
          width={2172}
          height={724}
          draggable={false}
        />
      </div>
    </section>
  );
}
