import type { Creature, CreatureKind } from '../../types';
import { Portrait } from '../Portrait';
import { Section } from '../Section';

interface LocalityCreaturesProps {
  /** Criaturas e NPCs vinculados a esta localidade. */
  creatures: Creature[];
  /** Tipo em criação agora (desabilita os botões e mostra o estado). */
  creating: CreatureKind | null;
  /** Abre a ficha completa no bestiário/NPCs. */
  onOpen: (creature: Creature) => void;
  onCreate: (kind: CreatureKind) => void;
}

/**
 * Etapa 4 do assistente: quem habita a localidade aberta.
 *
 * O card mostra retrato, tipo, ND, um resumo do statblock e os números que o
 * mestre consulta na hora (CA, PV, deslocamento). Editar não acontece aqui: o
 * botão leva para a ficha no bestiário, que é a única dona do statblock.
 */
export function LocalityCreatures({
  creatures,
  creating,
  onOpen,
  onCreate,
}: LocalityCreaturesProps) {
  const busy = creating !== null;

  return (
    <Section
      title="Habitantes"
      icon="flame"
      subtitle="Criaturas e NPCs vinculados a esta localidade"
      actions={
        <>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => onCreate('CREATURE')}
          >
            {creating === 'CREATURE' ? 'criando...' : '+ criatura'}
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={busy}
            onClick={() => onCreate('NPC')}
          >
            {creating === 'NPC' ? 'criando...' : '+ NPC'}
          </button>
        </>
      }
    >
      {creatures.length === 0 ? (
        <p className="empty-hint">
          Nenhum habitante vinculado a esta localidade ainda. Crie uma criatura ou um NPC para
          povoar o lugar.
        </p>
      ) : (
        <ul className="creature-locality-grid">
          {creatures.map((creature) => (
            <li key={creature.id} className="creature-locality-card">
              <div className="creature-locality-head">
                <Portrait
                  src={creature.imageUrl}
                  alt={creature.name}
                  size="sm"
                  icon={creature.kind === 'NPC' ? 'crown' : 'flame'}
                />
                <div className="creature-locality-title">
                  <h3>{creature.name}</h3>
                  <p className="creature-locality-tags">
                    <span className="creature-locality-tag">
                      {creature.kind === 'NPC' ? 'NPC' : 'Criatura'}
                    </span>
                    {creature.type ? <span>{creature.type}</span> : null}
                    {creature.challengeRating ? (
                      <span>ND {creature.challengeRating}</span>
                    ) : null}
                  </p>
                </div>
              </div>

              <p className="creature-locality-desc">
                {creature.description.trim() || 'Sem descrição registrada.'}
              </p>

              <dl className="creature-locality-stats">
                <div>
                  <dt>CA</dt>
                  <dd>{creature.effectiveArmorClass}</dd>
                </div>
                <div>
                  <dt>PV</dt>
                  <dd>{creature.hpMax}</dd>
                </div>
                <div>
                  <dt>Desloc.</dt>
                  <dd>{creature.effectiveSpeed} m</dd>
                </div>
              </dl>

              <button
                type="button"
                className="btn btn-small creature-locality-open"
                onClick={() => onOpen(creature)}
              >
                abrir ficha
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
