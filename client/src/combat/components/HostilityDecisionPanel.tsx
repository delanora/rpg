import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CombatDto } from '../../types';
import { decideAttackHostility } from '../combatApi';
import './hostility.css';

/** Fila persistida no servidor; adiar só fecha a apresentação nesta tela. */
export function HostilityDecisionPanel({
  combat,
  busy,
  onRun,
}: {
  combat: CombatDto;
  busy: boolean;
  onRun: (action: () => Promise<CombatDto>) => void;
}) {
  const prompts = combat.hostilityPrompts ?? [];
  const [postponed, setPostponed] = useState(false);
  useEffect(() => setPostponed(false), [prompts[0]?.id]);
  if (!prompts.length || combat.status !== 'ACTIVE') return null;
  return createPortal(
    postponed ? (
      <button
        type="button"
        className="btn hostility-resume"
        onClick={() => setPostponed(false)}
      >
        Decisões de hostilidade ({prompts.length})
      </button>
    ) : (
      <HostilityPrompt
        key={prompts[0].id}
        combat={combat}
        busy={busy}
        onRun={onRun}
        onPostpone={() => setPostponed(true)}
      />
    ),
    document.body,
  );
}
function HostilityPrompt({
  combat,
  busy,
  onRun,
  onPostpone,
}: {
  combat: CombatDto;
  busy: boolean;
  onRun: (action: () => Promise<CombatDto>) => void;
  onPostpone: () => void;
}) {
  const prompt = combat.hostilityPrompts![0];
  const npc = combat.combatants.find((unit) => unit.id === prompt.npcId)!;
  const attacker = combat.combatants.find(
    (unit) => unit.id === prompt.attackerId,
  );
  const target = combat.combatants.find((unit) => unit.id === prompt.targetId);
  const otherId =
    prompt.attackerId === prompt.npcId ? prompt.targetId : prompt.attackerId;
  const choices = combat.combatants.filter(
    (unit) => unit.id !== prompt.npcId && !unit.missing,
  );
  const [selected, setSelected] = useState([otherId]);
  const validSelected = selected.filter((id) =>
    choices.some((unit) => unit.id === id),
  );
  function decide(hostile: boolean) {
    onRun(() =>
      decideAttackHostility(combat, {
        promptId: prompt.id,
        hostile,
        selectedIds: hostile ? validSelected : [],
      }),
    );
  }
  return (
    <aside
      className="hostility-panel"
      role="dialog"
      aria-label="Decidir hostilidade"
      aria-describedby="hostility-description"
    >
      <header>
        <div>
          <small>
            Decisão do Mestre · {combat.hostilityPrompts!.length} pendente(s)
          </small>
          <h3>Definir hostilidade?</h3>
        </div>
        <button type="button" className="btn btn-small" onClick={onPostpone}>
          Depois
        </button>
      </header>
      <p id="hostility-description">
        <strong>{attacker?.name ?? 'Participante'}</strong> atacou{' '}
        <strong>{target?.name ?? 'participante'}</strong> com{' '}
        {prompt.attackName}.
      </p>
      <p>
        Escolha contra quem <strong>{npc?.name ?? 'o NPC'}</strong> ficará
        hostil. A relação será mútua somente entre os selecionados.
      </p>
      <div className="hostility-shortcuts">
        <button
          type="button"
          className="btn btn-small"
          disabled={busy}
          onClick={() => setSelected([otherId])}
        >
          Só os envolvidos
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy}
          onClick={() =>
            setSelected(
              choices
                .filter((unit) => unit.kind === 'CHARACTER')
                .map((unit) => unit.id),
            )
          }
        >
          Grupo de jogadores
        </button>
      </div>
      <fieldset disabled={busy}>
        <legend>Participantes envolvidos</legend>
        <div className="hostility-choices">
          {choices.map((unit) => (
            <label key={unit.id}>
              <input
                type="checkbox"
                checked={validSelected.includes(unit.id)}
                onChange={() =>
                  setSelected(
                    validSelected.includes(unit.id)
                      ? validSelected.filter((id) => id !== unit.id)
                      : [...validSelected, unit.id],
                  )
                }
              />
              {unit.name}
            </label>
          ))}
        </div>
      </fieldset>
      <small>
        A decisão afeta relações e ataques de oportunidade. Não concede ataques
        imediatos nem muda os lados do encontro.
      </small>
      <footer>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => decide(false)}
        >
          Manter relação
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !validSelected.length}
          onClick={() => decide(true)}
        >
          Tornar hostil ({validSelected.length})
        </button>
      </footer>
    </aside>
  );
}
