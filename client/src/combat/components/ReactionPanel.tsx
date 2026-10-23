import { Icon } from '../../components/Icon';
import type { ReactionOpportunity } from '../reactions';

interface ReactionPanelProps {
  opportunity: ReactionOpportunity;
  busy?: boolean;
  /** Escolher uma opção válida resolve a janela (execução futura). */
  onChoose: (optionId: string) => void;
  /** \"Não reagir\" fecha a janela sem gastar a Reação. */
  onDecline: () => void;
}

/**
 * PAINEL CONTEXTUAL DE REAÇÃO — pequeno, temporário e por reactor.
 *
 * NÃO é um painel de turno: não devolve Ação, Ação Bônus, Movimento nem
 * Encerrar Turno. Só aparece quando existe uma `ReactionOpportunity` concreta
 * para ESTE usuário e some ao recusar/resolver. Fora do próprio turno, sem
 * oportunidade, nada é renderizado (nada de \"REAÇÃO DISPONÍVEL\" fixo).
 */
export function ReactionPanel({ opportunity, busy = false, onChoose, onDecline }: ReactionPanelProps) {
  return (
    <section className="reaction-panel" aria-label="Reação disponível" role="alertdialog">
      <p className="reaction-panel-eyebrow">
        <Icon name="bolt" size={13} /> Reação disponível
      </p>
      <p className="reaction-panel-trigger">{opportunity.trigger}</p>

      <div className="reaction-panel-options">
        {opportunity.availableReactions.map((option) => (
          <button
            key={option.id}
            type="button"
            className="reaction-option"
            disabled={busy}
            onClick={() => onChoose(option.id)}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>

      <button type="button" className="btn btn-small reaction-decline" disabled={busy} onClick={onDecline}>
        Não reagir
      </button>
    </section>
  );
}
