import { useEffect, useRef, useState } from 'react';
import type { CreatureAbility } from '../../types';
import {
  creatureAbilitySchema,
  CREATURE_ABILITY_COST_LABELS as ABILITY_COST_LABELS,
} from '../../../../src/modules/shared/creature-abilities';
import { createOperationId } from '../../utils';

export function CreatureAbilitiesEditor({
  abilities,
  onChange,
  onEditingChange,
}: {
  abilities: CreatureAbility[];
  onChange: (value: CreatureAbility[]) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<CreatureAbility | null>(null);
  const [error, setError] = useState('');
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (draft)
      formRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [draft?.id]);
  function edit(value: CreatureAbility | null) {
    setDraft(value);
    setError('');
    onEditingChange(value !== null);
  }
  function save() {
    const parsed = creatureAbilitySchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    onChange(
      abilities.some((item) => item.id === parsed.data.id)
        ? abilities.map((item) =>
            item.id === parsed.data.id ? parsed.data : item,
          )
        : [...abilities, parsed.data],
    );
    edit(null);
  }
  return (
    <div className="creature-attacks">
      <div className="creature-section-heading">
        <p>
          Cadastre opções especiais e características. Cada cópia controla seus
          próprios usos.
        </p>
        <button
          type="button"
          className="btn btn-small"
          disabled={!!draft}
          onClick={() =>
            edit({
              id: createOperationId(),
              name: '',
              description: '',
              cost: 'action',
              execution: 'assisted',
              trigger: '',
              maxUses: null,
            })
          }
        >
          Adicionar habilidade
        </button>
      </div>
      {!draft ? (
        <div
          className="creature-card-actions"
          aria-label="Modelos de habilidade"
        >
          <span>Começar com:</span>
          <button
            type="button"
            className="btn btn-small"
            onClick={() =>
              edit({
                id: createOperationId(),
                name: 'Desengajar',
                cost: 'bonus-action',
                execution: 'disengage',
                description: 'Esta criatura pode Desengajar como ação bônus.',
                trigger: '',
                maxUses: null,
              })
            }
          >
            Desengajar como bônus
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={() =>
              edit({
                id: createOperationId(),
                name: 'Esconder-se',
                cost: 'bonus-action',
                execution: 'assisted',
                description:
                  'Esta criatura pode tentar se esconder como ação bônus. O Mestre verifica as circunstâncias e resolve o teste.',
                trigger: '',
                maxUses: null,
              })
            }
          >
            Esconder-se como bônus
          </button>
        </div>
      ) : null}
      {!abilities.length && !draft ? (
        <p className="empty-hint">
          Exemplos: Desengajar como ação bônus, Esconder-se ou uma
          característica passiva.
        </p>
      ) : null}
      {abilities.map((item) => (
        <article className="creature-attack-card" key={item.id}>
          <div>
            <h4>{item.name}</h4>
            <p>
              {ABILITY_COST_LABELS[item.cost]} ·{' '}
              {item.execution === 'assisted'
                ? item.cost === 'passive'
                  ? 'Consulta'
                  : 'Assistida'
                : 'Automática'}{' '}
              ·{' '}
              {item.maxUses === null
                ? 'Sem limite de usos'
                : `${item.maxUses} usos por combate`}
            </p>
            <p>{item.description}</p>
          </div>
          <button
            className="btn btn-small"
            type="button"
            disabled={!!draft}
            onClick={() => edit({ ...item })}
          >
            Editar habilidade
          </button>
        </article>
      ))}
      {draft ? (
        <div className="creature-attack-form" ref={formRef}>
          <div className="creature-form-grid">
            <label>
              Nome da habilidade
              <input
                aria-label="Nome da habilidade"
                maxLength={120}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Custo
              <select
                aria-label="Custo da habilidade"
                value={draft.cost}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    cost: e.target.value as CreatureAbility['cost'],
                    execution: 'assisted',
                    maxUses:
                      e.target.value === 'passive' ? null : draft.maxUses,
                  })
                }
              >
                {Object.entries(ABILITY_COST_LABELS).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Execução
              <select
                aria-label="Execução da habilidade"
                value={draft.execution}
                disabled={draft.cost === 'passive' || draft.cost === 'reaction'}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    execution: e.target.value as CreatureAbility['execution'],
                  })
                }
              >
                <option value="assisted">
                  {draft.cost === 'passive'
                    ? 'Consulta — sem efeito automático'
                    : 'Assistida pelo Mestre'}
                </option>
                <option value="disengage">Desengajar</option>
                <option value="dash">Disparada</option>
                <option value="dodge">Esquivar</option>
              </select>
            </label>
            {draft.cost !== 'passive' ? (
              <label>
                Usos por combate (vazio = livre)
                <input
                  aria-label="Usos da habilidade"
                  type="number"
                  min={1}
                  max={100}
                  value={draft.maxUses ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      maxUses:
                        e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
            ) : null}
          </div>
          {draft.cost === 'reaction' ? (
            <label>
              Gatilho da reação
              <input
                aria-label="Gatilho da habilidade"
                maxLength={500}
                value={draft.trigger}
                onChange={(e) =>
                  setDraft({ ...draft, trigger: e.target.value })
                }
              />
            </label>
          ) : null}
          <label>
            Descrição e instruções
            <textarea
              aria-label="Descrição da habilidade"
              maxLength={3000}
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <p className="section-note">
            Assistida: controla custo e usos; o Mestre resolve o efeito.
            Esconder-se exige avaliação e testes, sem ocultar automaticamente o
            token. Passivas são consultivas. Recarga e descanso ainda não são
            automáticos.
          </p>
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}
          <div className="creature-card-actions">
            <button type="button" className="btn btn-primary" onClick={save}>
              Salvar habilidade
            </button>
            <button type="button" className="btn" onClick={() => edit(null)}>
              Cancelar habilidade
            </button>
            {abilities.some((item) => item.id === draft.id) ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  onChange(abilities.filter((item) => item.id !== draft.id));
                  edit(null);
                }}
              >
                Remover habilidade
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
