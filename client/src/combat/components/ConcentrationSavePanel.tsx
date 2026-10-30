import { Icon } from '../../components/Icon';
import type { ConcentrationSave } from '../../types';

/**
 * TESTE DE CONCENTRAÇÃO PENDENTE (PHB 2014, p. 203).
 *
 * Aparece quando um evento de dano é aplicado a uma criatura concentrando. O
 * CD vem do SERVIDOR (`max(10, floor(dano / 2))`); aqui nada é calculado.
 *
 * • Jogador: um botão que abre a MESMA bandeja de dados (sem segunda janela);
 *   o servidor rola a salvaguarda de Constituição e resolve a concentração.
 * • Mestre (criatura/NPC): escolhe PÚBLICO ou PRIVADO para CADA teste — a
 *   privacidade é do servidor, não do CSS.
 */
export function ConcentrationSavePanel({
  name,
  saves,
  isMaster,
  canRoll,
  busy,
  onRollPlayer,
  onRollMaster,
}: {
  name: string;
  saves: ConcentrationSave[];
  isMaster: boolean;
  /** Jogador dono do personagem pode rolar o próprio teste. */
  canRoll: boolean;
  busy: boolean;
  onRollPlayer?: (save: ConcentrationSave) => void;
  onRollMaster?: (save: ConcentrationSave, visibility: 'public' | 'private') => void;
}) {
  if (saves.length === 0) return null;

  return (
    <section className="reaction-panel concentration-panel" aria-label="Teste de concentração">
      <p className="reaction-panel-eyebrow">
        <Icon name="flame" size={13} /> Teste de concentração
      </p>
      {saves.map((save) => (
        <div key={save.id} className="concentration-save">
          <p className="reaction-panel-trigger">
            {name} sofreu {save.damage} de dano
            {save.sourceName ? ` (${save.sourceName})` : ''} — CD {save.dc}
          </p>
          <div className="hp-controls">
            {isMaster ? (
              <>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  title="A mesa inteira vê o resultado deste teste."
                  onClick={() => onRollMaster?.(save, 'public')}
                >
                  Rolar público
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  title="Só os Mestres veem o CD, a rolagem e o resultado."
                  onClick={() => onRollMaster?.(save, 'private')}
                >
                  Rolar privado
                </button>
              </>
            ) : canRoll ? (
              <button
                type="button"
                className="btn btn-small"
                disabled={busy}
                onClick={() => onRollPlayer?.(save)}
              >
                Rolar teste de Constituição (CD {save.dc})
              </button>
            ) : (
              <span className="field-hint">Aguardando o teste de Constituição de {name}.</span>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
