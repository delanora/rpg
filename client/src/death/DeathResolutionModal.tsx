import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { overrideDeath, resolveDeath, rollNpcDeathSave } from '../deathApi';
import type { DeathDecision, DeathDto, DiceRollDto } from '../types';

interface DeathResolutionModalProps {
  death: DeathDto;
  onClose: () => void;
  onResolved: (death: DeathDto) => void;
  /** Resultado da rolagem privada do NPC, exibido no próprio modal. */
  onRolled?: (roll: DiceRollDto) => void;
}

/**
 * Janela "Destino de [Nome]" — EXCLUSIVA do Mestre.
 *
 * O sistema determina que, pelas regras do PHB 2014, a criatura morreria; o
 * desfecho final é uma decisão do Mestre. Nada aqui é confirmação nativa do
 * navegador: é o modal/portal do projeto.
 */
export function DeathResolutionModal({
  death,
  onClose,
  onResolved,
  onRolled,
}: DeathResolutionModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roll, setRoll] = useState<DiceRollDto | null>(null);
  const isCreature = death.kind === 'creature';

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const decide = async (decision: DeathDecision) => {
    setBusy(true);
    setError(null);
    try {
      const result = await resolveDeath({
        entity: death.entity,
        decision,
        expectedVersion: death.version,
      });
      onResolved(result.death);
      if (!result.death.pending) onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao decidir.');
    } finally {
      setBusy(false);
    }
  };

  const toDeathSaves = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await overrideDeath({
        entity: death.entity,
        action: 'death-saves',
        expectedVersion: death.version,
        reason: 'Mestre colocou a criatura no fluxo de Testes contra a Morte',
      });
      onResolved(result.death);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao preparar os Testes.');
    } finally {
      setBusy(false);
    }
  };

  const privateRoll = async () => {
    setBusy(true);
    setError(null);
    try {
      const rolled = await rollNpcDeathSave(death.entity);
      setRoll(rolled);
      onRolled?.(rolled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falha ao rolar.');
    } finally {
      setBusy(false);
    }
  };

  const cause = death.pending?.cause ?? null;

  return createPortal(
    <div className="death-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="death-stage" onClick={(event) => event.stopPropagation()}>
        <header className="death-stage-head">
          <Icon name="crown" size={16} />
          <h2>Destino de {death.name}</h2>
          <button type="button" className="death-stage-close" aria-label="Fechar" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </header>

        <p className="death-text">
          {death.pendingLabel ?? 'As regras do PHB 2014 indicam que a criatura morreria.'}
          {cause
            ? ` (dano restante ${cause.remaining} vs. PV máximo ${cause.hpMax}).`
            : null}{' '}
          O sistema NÃO declara morte automaticamente: o desfecho é a sua decisão.
        </p>

        {death.pending ? (
          <div className="death-options">
            <button
              type="button"
              className="death-button danger"
              disabled={busy}
              onClick={() => void decide('confirm-death')}
            >
              <strong>Confirmar morte</strong>
              <span>Aplicar a morte segundo o PHB 2014.</span>
            </button>
            <button
              type="button"
              className="death-button"
              disabled={busy}
              onClick={() => void decide('narrative-1hp')}
            >
              <strong>Recurso narrativo — 1 PV</strong>
              <span>
                O Mestre intervém e mantém {death.name} com 1 PV (você narra como).
              </span>
            </button>
            <button
              type="button"
              className="death-button"
              disabled={busy}
              onClick={() => void decide('fall-to-zero')}
            >
              <strong>Cair a 0 PV</strong>
              <span>
                Ignora a morte: fica a 0 PV
                {isCreature
                  ? ' (sem Testes contra a Morte automáticos).'
                  : ' e entra no fluxo normal de Testes contra a Morte.'}
              </span>
            </button>
            <button
              type="button"
              className="death-button"
              disabled={busy}
              onClick={() => void decide('leave-stabilized')}
            >
              <strong>Deixar estabilizado</strong>
              <span>
                0 PV, vivo e Inconsciente; contadores zerados e sem novos Testes contra
                a Morte. Permanece Caído — não recupera PV.
              </span>
            </button>
            {isCreature ? (
              <button
                type="button"
                className="death-button"
                disabled={busy}
                onClick={() => void decide('roll-death-saves')}
              >
                <strong>Rodar Death Saves</strong>
                <span>
                  Entra no fluxo de Testes contra a Morte. As rolagens são PRIVADAS do Mestre.
                </span>
              </button>
            ) : null}
          </div>
        ) : (
          <div className="death-options">
            <p className="death-text">
              Nenhuma decisão pendente.
              {death.death.dead ? ' A criatura está morta.' : ''}
              {death.death.stabilized ? ' A criatura está estabilizada.' : ''}
            </p>
            {isCreature && death.death.deathSaves ? (
              <button
                type="button"
                className="death-button primary"
                disabled={busy || !death.deathSave.available}
                onClick={() => void privateRoll()}
              >
                <strong>Rolar Teste contra a Morte (privado)</strong>
                <span>
                  {death.deathSave.available
                    ? `Privado: só os mestres veem. (${death.death.successes}/3 sucessos, ${death.death.failures}/3 falhas)`
                    : death.deathSave.reason}
                </span>
              </button>
            ) : null}
            {isCreature && !death.death.deathSaves && !death.death.dead ? (
              <button
                type="button"
                className="death-button"
                disabled={busy}
                onClick={() => void toDeathSaves()}
              >
                <strong>Rodar Death Saves</strong>
                <span>Coloca a criatura no fluxo privado de Testes contra a Morte (0 PV).</span>
              </button>
            ) : null}
          </div>
        )}

        {roll ? (
          <p className="death-roll-result">
            🎲 Teste contra a Morte (privado): <strong>{roll.total}</strong>
            <span className="death-hint"> — {roll.actorName}</span>
          </p>
        ) : null}

        {error ? <p className="death-error">{error}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

interface DeathPendingBannerProps {
  entries: DeathDto[];
  onOpen: (death: DeathDto) => void;
}

/**
 * Faixa do Mestre com as decisões de morte em aberto e os Testes contra a Morte
 * privados disponíveis. Fica visível em qualquer aba do painel.
 */
export function DeathPendingBanner({ entries, onOpen }: DeathPendingBannerProps) {
  if (entries.length === 0) return null;
  return (
    <div className="death-banner" role="status">
      <Icon name="heart" size={16} />
      <span className="death-banner-label">Morte:</span>
      {entries.map((death) => (
        <button
          key={`${death.entity.kind}:${death.entity.id}`}
          type="button"
          className={death.pending ? 'death-banner-item pending' : 'death-banner-item'}
          onClick={() => onOpen(death)}
        >
          {death.name}
          {death.pending ? ' — decidir' : ' — rolar (privado)'}
        </button>
      ))}
    </div>
  );
}
