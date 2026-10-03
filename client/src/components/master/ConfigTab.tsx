import { useEffect, useState, type ReactNode } from 'react';
import { ABILITY_ABBREVIATIONS, ABILITY_LABELS, SKILLS, SPELLCASTING_TYPE_LABELS, SPELL_LEARNING_LABELS, formatModifier } from '../../dnd';
import {
  createCustomRace,
  deleteCustomRace,
  fetchCompendium,
  fetchCustomRaces,
  updateCustomRace,
} from '../../gameApi';
import type {
  AbilityKey,
  Compendium,
  CompendiumClass,
  CompendiumRace,
  CustomRace,
  CustomRacePatch,
} from '../../types';
import { Icon } from '../Icon';
import { RaceEditor } from './RaceEditor';

/**
 * "Configurações da mesa" — o canto do mestre para ajustar a mesa e consultar
 * as listas de referência do jogo (classes, raças, antecedentes e magias).
 *
 * O Nível Inicial mora aqui (antes ele ficava em destaque na barra de abas).
 * As listas são SOMENTE LEITURA por enquanto — a ideia é que, mais adiante, o
 * mestre possa criar e editar cada item; por isso a consulta já é alimentada
 * pela rota `/api/compendium` (uma coleção só), e não por constantes locais:
 * quando a edição chegar, os cards ganham ações sem mudar a estrutura.
 */

type ConfigSection = 'classes' | 'races' | 'backgrounds' | 'spells';

/** Nível mínimo/máximo da mesa (o mesmo do servidor: `LEVEL_MIN`/`LEVEL_MAX`). */
const LEVEL_MIN = 1;
const LEVEL_MAX = 20;

const SKILL_LABELS = new Map(SKILLS.map((skill) => [skill.key, skill.label]));

/** "CON +2 · SAB +1" a partir dos bônus raciais fixos. */
function bonusLabel(bonuses: Partial<Record<AbilityKey, number>>): string {
  const parts = Object.entries(bonuses)
    .filter(([, value]) => (value ?? 0) !== 0)
    .map(([ability, value]) => `${ABILITY_ABBREVIATIONS[ability as AbilityKey]} ${formatModifier(value ?? 0)}`);
  return parts.join(' · ');
}

/** Rótulo do que a raça concede (bônus fixos + os `+1` à escolha). */
function raceBenefits(race: CompendiumRace): string {
  const parts: string[] = [];
  const fixed = bonusLabel(race.abilityBonuses);
  if (fixed) parts.push(fixed);
  if (race.abilityChoice > 0) {
    parts.push(`${formatModifier(1)} em ${race.abilityChoice} atributo(s) à escolha`);
  }
  return parts.join(' · ') || 'Sem bônus de atributo cadastrados';
}

/** Uma lista de referência com título, contagem e estado vazio. */
function ListPanel({
  title,
  hint,
  empty,
  children,
}: {
  title: string;
  hint?: string;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <div className="config-panel">
      <header className="config-panel-head">
        <h3>{title}</h3>
        {hint ? <p className="config-panel-hint">{hint}</p> : null}
      </header>
      {empty ? (
        <p className="config-empty">
          <Icon name="info" size={16} /> Nada por aqui ainda.
        </p>
      ) : (
        <ul className="config-list">{children}</ul>
      )}
    </div>
  );
}

function ClassCard({ definition }: { definition: CompendiumClass }) {
  const spellcasting = definition.spellcasting;
  const castingLabel =
    spellcasting.type === 'none'
      ? SPELLCASTING_TYPE_LABELS.none
      : `${SPELLCASTING_TYPE_LABELS[spellcasting.type]} (${SPELL_LEARNING_LABELS[spellcasting.learning]})`;

  return (
    <li className="config-item">
      <div className="config-item-head">
        <span className="config-item-name">{definition.name}</span>
        <span className="config-badge">{`d${definition.hitDie}`}</span>
      </div>

      <dl className="config-facts">
        <div>
          <dt>Salvaguardas</dt>
          <dd>
            {definition.savingThrows
              .map((ability) => `${ABILITY_LABELS[ability]} (${ABILITY_ABBREVIATIONS[ability]})`)
              .join(' · ')}
          </dd>
        </div>
        <div>
          <dt>Conjuração</dt>
          <dd>
            {castingLabel}
            {spellcasting.ability ? ` · ${ABILITY_LABELS[spellcasting.ability]}` : ''}
          </dd>
        </div>
        <div>
          <dt>Subclasse</dt>
          <dd>{definition.subclassLevel === 1 ? 'No nível 1' : `No nível ${definition.subclassLevel}`}</dd>
        </div>
      </dl>

      {definition.subclasses.length > 0 ? (
        <div className="config-tags">
          {definition.subclasses.map((subclass) => (
            <span key={subclass.id} className="config-tag" title={subclass.description}>
              {subclass.name}
            </span>
          ))}
        </div>
      ) : (
        <p className="config-note">Subclasses ainda não cadastradas.</p>
      )}
    </li>
  );
}

function RaceCard({ race }: { race: CompendiumRace }) {
  return (
    <li className="config-item">
      <div className="config-item-head">
        <span className="config-item-name">{race.name}</span>
        {race.baseRace && race.baseRace !== race.name ? (
          <span className="config-badge">{race.baseRace}</span>
        ) : null}
      </div>

      {race.description ? <p className="config-text">{race.description}</p> : null}
      <p className="config-note">{raceBenefits(race)}</p>
    </li>
  );
}

interface ConfigTabProps {
  startingLevel: number;
  onChangeStartingLevel: (level: number) => void;
  /** Exibe PL (pp) e PE (ep) no bloco de moedas das fichas. */
  extraCoins: boolean;
  onChangeExtraCoins: (enabled: boolean) => void;
}

export function ConfigTab({
  startingLevel,
  onChangeStartingLevel,
  extraCoins,
  onChangeExtraCoins,
}: ConfigTabProps) {
  const [section, setSection] = useState<ConfigSection>('classes');
  const [compendium, setCompendium] = useState<Compendium | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Raças personalizadas do mestre (Prompt 2.10).
  const [customRaces, setCustomRaces] = useState<CustomRace[]>([]);
  const [editingRaceId, setEditingRaceId] = useState<string | null>(null);
  const [customBusy, setCustomBusy] = useState(false);
  const [customRaceError, setCustomRaceError] = useState<string | null>(null);

  // O nível inicial é editado localmente e só sobe ao servidor quando o campo
  // é confirmado (Enter ou sair do campo) — evita uma requisição por tecla.
  const [levelDraft, setLevelDraft] = useState(String(startingLevel));

  useEffect(() => {
    setLevelDraft(String(startingLevel));
  }, [startingLevel]);

  useEffect(() => {
    let active = true;

    fetchCompendium()
      .then((data) => {
        if (!active) return;
        setCompendium(data);
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Falha ao carregar o compêndio.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    fetchCustomRaces()
      .then(setCustomRaces)
      .catch(() => setCustomRaces([]));
  }, []);

  const editingRace = customRaces.find((race) => race.id === editingRaceId) ?? null;

  /** Recarrega o compêndio para a lista refletir a raça criada/editada. */
  function refreshCompendium(): void {
    void fetchCompendium()
      .then(setCompendium)
      .catch(() => undefined);
  }

  async function addCustomRace(): Promise<void> {
    setCustomBusy(true);
    setCustomRaceError(null);
    try {
      const race = await createCustomRace();
      setCustomRaces((prev) => [...prev, race].sort((a, b) => a.name.localeCompare(b.name)));
      setEditingRaceId(race.id);
      refreshCompendium();
    } catch (err) {
      setCustomRaceError(err instanceof Error ? err.message : 'Falha ao criar a raça.');
    } finally {
      setCustomBusy(false);
    }
  }

  async function patchCustomRace(id: string, patch: CustomRacePatch): Promise<void> {
    try {
      const race = await updateCustomRace(id, patch);
      setCustomRaces((prev) => prev.map((item) => (item.id === id ? race : item)));
      refreshCompendium();
    } catch (err) {
      setCustomRaceError(err instanceof Error ? err.message : 'Falha ao salvar a raça.');
    }
  }

  async function removeCustomRace(id: string): Promise<void> {
    try {
      await deleteCustomRace(id);
      setCustomRaces((prev) => prev.filter((item) => item.id !== id));
      setEditingRaceId(null);
      refreshCompendium();
    } catch (err) {
      setCustomRaceError(err instanceof Error ? err.message : 'Falha ao remover a raça.');
    }
  }

  function commitLevel(): void {
    const parsed = Number(levelDraft);
    if (!Number.isFinite(parsed)) {
      setLevelDraft(String(startingLevel));
      return;
    }

    const clamped = Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.floor(parsed)));
    setLevelDraft(String(clamped));
    if (clamped !== startingLevel) onChangeStartingLevel(clamped);
  }

  const sections: { id: ConfigSection; label: string; count: number }[] = [
    { id: 'classes', label: 'Classes', count: compendium?.classes.length ?? 0 },
    { id: 'races', label: 'Raças', count: compendium?.races.length ?? 0 },
    { id: 'backgrounds', label: 'Antecedentes', count: compendium?.backgrounds.length ?? 0 },
    { id: 'spells', label: 'Magias', count: compendium?.spells.length ?? 0 },
  ];

  return (
    <div className="config-shell">
      {/* Ajuste da mesa ------------------------------------------------------ */}
      <section className="config-card config-card-level">
        <div className="config-level-copy">
          <h2>
            <Icon name="gear" size={18} /> Nível inicial da mesa
          </h2>
          <p>
            Nível em que os personagens novos começam. Quando é maior que 1, o assistente de criação
            aplica os níveis 2 até ele ao concluir a montagem. Personagens já prontos não mudam.
          </p>
        </div>

        <label className="field config-level-field">
          <span>NÍVEL</span>
          <input
            type="number"
            min={LEVEL_MIN}
            max={LEVEL_MAX}
            value={levelDraft}
            onChange={(event) => setLevelDraft(event.target.value)}
            onBlur={commitLevel}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </label>
      </section>

      {/* Moedas extras ------------------------------------------------------- */}
      <section className="config-card config-card-level">
        <div className="config-level-copy">
          <h2>
            <Icon name="sparkle" size={18} /> Moedas extras
          </h2>
          <p>
            Desligado, o bloco de moedas das fichas mostra só PO (ouro), PP (prata) e PC (cobre).
            Ligado, mostra também PL (platina) e PE (electrum). Os valores das cinco
            denominações existem de qualquer forma.
          </p>
        </div>

        <label className="field config-level-field field-check">
          <input
            type="checkbox"
            checked={extraCoins}
            onChange={(event) => onChangeExtraCoins(event.target.checked)}
          />
          <span>MOSTRAR PL/PE</span>
        </label>
      </section>

      {/* Consulta das listas -------------------------------------------------- */}
      <section className="config-card">
        <header className="config-card-head">
          <h2>
            <Icon name="book" size={18} /> Compêndio da mesa
          </h2>
          <p>Listas de referência do jogo. Somente leitura por enquanto.</p>
        </header>

        <nav className="subtabs" aria-label="Seções do compêndio">
          {sections.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={section === entry.id ? 'tab active' : 'tab'}
              onClick={() => setSection(entry.id)}
            >
              {entry.label}
              {compendium ? <span className="config-count">{entry.count}</span> : null}
            </button>
          ))}
        </nav>

        {error ? <p className="config-empty config-empty-error">{error}</p> : null}

        {loading ? (
          <p className="config-empty">Carregando o compêndio...</p>
        ) : !compendium ? (
          <p className="config-empty">Não foi possível carregar o compêndio.</p>
        ) : section === 'classes' ? (
          <ListPanel
            title={`${compendium.classes.length} classe(s)`}
            hint="Dado de vida, salvaguardas, conjuração e subclasses."
            empty={compendium.classes.length === 0}
          >
            {compendium.classes.map((definition) => (
              <ClassCard key={definition.key} definition={definition} />
            ))}
          </ListPanel>
        ) : section === 'races' ? (
          <>
            <ListPanel
              title={`${compendium.races.length} linhagem(ns)`}
              hint="Uma entrada por linhagem, com a história e os bônus."
              empty={compendium.races.length === 0}
            >
              {compendium.races.map((race) => (
                <RaceCard key={race.key} race={race} />
              ))}
            </ListPanel>

            {/* Raças PERSONALIZADAS do mestre: entram no assistente junto das
                raças fixas. Traços em texto livre, sem sub-raças. */}
            <div className="config-panel">
              <header className="config-panel-head">
                <h3>{customRaces.length} raça(s) personalizada(s)</h3>
                <p className="config-panel-hint">
                  Raças criadas por você: aparecem no passo de Raça do assistente e na ficha.
                </p>
              </header>

              <div className="config-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={customBusy}
                  onClick={() => void addCustomRace()}
                >
                  <Icon name="plus" size={14} /> raça personalizada
                </button>
              </div>

              {customRaceError ? (
                <p className="config-empty config-empty-error">{customRaceError}</p>
              ) : null}

              {customRaces.length === 0 ? (
                <p className="config-empty">
                  <Icon name="info" size={16} /> Nenhuma raça personalizada ainda.
                </p>
              ) : (
                <ul className="config-list">
                  {customRaces.map((race) => (
                    <li key={race.id} className="config-item">
                      <div className="config-item-head">
                        <span className="config-item-name">{race.name}</span>
                        <button
                          type="button"
                          className={editingRaceId === race.id ? 'btn btn-small btn-primary' : 'btn btn-small'}
                          onClick={() => setEditingRaceId(editingRaceId === race.id ? null : race.id)}
                        >
                          {editingRaceId === race.id ? 'fechar' : 'editar'}
                        </button>
                      </div>
                      {race.description ? (
                        <p className="config-text">{race.description}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {editingRace ? (
                <RaceEditor
                  race={editingRace}
                  onPatch={(patch) => void patchCustomRace(editingRace.id, patch)}
                  onDelete={() => void removeCustomRace(editingRace.id)}
                />
              ) : null}
            </div>
          </>
        ) : section === 'backgrounds' ? (
          <ListPanel
            title={`${compendium.backgrounds.length} antecedente(s)`}
            hint="Cada antecedente concede duas perícias."
            empty={compendium.backgrounds.length === 0}
          >
            {compendium.backgrounds.map((background) => (
              <li key={background.key} className="config-item">
                <div className="config-item-head">
                  <span className="config-item-name">{background.name}</span>
                </div>
                {background.description ? (
                  <p className="config-text">{background.description}</p>
                ) : null}
                <div className="config-tags">
                  {background.skills.map((skill) => (
                    <span key={skill} className="config-tag">
                      {SKILL_LABELS.get(skill) ?? skill}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ListPanel>
        ) : (
          <ListPanel
            title="Magias"
            hint="Truques e magias de 1º a 9º nível."
            empty={compendium.spells.length === 0}
          >
            {null}
          </ListPanel>
        )}

        {/* O catálogo de magias ainda está vazio: o ambiente está pronto (tipo,
            rota e aba), mas o conteúdo entra numa etapa seguinte. */}
        {!loading && compendium && section === 'spells' && compendium.spells.length === 0 ? (
          <p className="config-empty">
            O catálogo de magias ainda não foi preenchido — o espaço já está preparado.
          </p>
        ) : null}
      </section>
    </div>
  );
}
