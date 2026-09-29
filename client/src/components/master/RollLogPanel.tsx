import { RollLogList } from '../../dice/RollLogList';
import type { DiceRollDto } from '../../types';
import { Icon } from '../Icon';
import { Section } from '../Section';

interface RollLogPanelProps {
  history: DiceRollDto[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onClear: () => void | Promise<void>;
}

/**
 * Botão flutuante do LOG e o painel compacto só com o histórico.
 *
 * O histórico continua onde sempre esteve — dentro da bandeja de rolagem (a
 * janela de dados). Este par é o atalho para consultá-lo sem abrir o
 * tabuleiro: o painel é FLUTUANTE (não ocupa a tela) e abre acima dos botões,
 * com rolagem própria quando o log é longo.
 *
 * Exclusivo do mestre — quem decide é o painel (MasterPanel), que passa o
 * histórico da sessão e zera o log pelo mesmo endpoint de sempre.
 */
export function RollLogPanel({ history, open, onToggle, onClose, onClear }: RollLogPanelProps) {
  return (
    <>
      <button
        type="button"
        className={open ? 'roll-log-fab active' : 'roll-log-fab'}
        aria-expanded={open}
        aria-controls="master-roll-log"
        title={open ? 'Fechar o histórico de rolagens' : 'Abrir o histórico de rolagens'}
        onClick={onToggle}
      >
        <Icon name="scroll" size={18} />
        <span className="roll-log-fab-label">Log</span>
        {history.length > 0 ? <span className="roll-log-count">{history.length}</span> : null}
      </button>

      {open ? (
        <div
          className="master-fab-panel"
          id="master-roll-log"
          role="dialog"
          aria-label="Histórico de rolagens"
        >
          <button
            type="button"
            className="notes-drawer-close"
            aria-label="Fechar o histórico de rolagens"
            onClick={onClose}
          >
            ×
          </button>

          <Section
            title="Histórico de rolagens"
            icon="scroll"
            subtitle={`${history.length} rolagem(ns) da sessão — some ao reiniciar o servidor`}
            actions={
              history.length > 0 ? (
                <button type="button" className="btn btn-small" onClick={() => void onClear()}>
                  limpar
                </button>
              ) : null
            }
          >
            <RollLogList history={history} />
          </Section>
        </div>
      ) : null}
    </>
  );
}
