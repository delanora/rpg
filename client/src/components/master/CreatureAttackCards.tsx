import { useState, useEffect } from 'react';
import {
  DAMAGE_TYPES,
  damageExpression,
  formatModifier,
  MAX_EXTRA_DAMAGES,
} from '../../dnd';
import type { Attack, Damage } from '../../types';
import { newId } from '../../utils';
/** Edição do statblock; mantém o mesmo contrato de ataque usado pelo servidor. */
export function CreatureAttackCards({
  attacks,
  onChange,
  defaultBonus = 0,
  onEditingChange,
}: {
  onEditingChange?: (editing: boolean) => void;
  attacks: Attack[];
  onChange: (attacks: Attack[]) => void;
  defaultBonus?: number;
}) {
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Attack | null>(null),
    [reach, setReach] = useState('1,5');
  useEffect(() => {
    onEditingChange?.(Boolean(draft));
    return () => onEditingChange?.(false);
  }, [Boolean(draft), onEditingChange]);
  const [remove, setRemove] = useState<string | null>(null);
  function edit(attack: Attack) {
    setError('');
    setDraft(structuredClone(attack));
    setReach(
      attack.reachFeet === undefined
        ? ''
        : String(Math.round(attack.reachFeet * 0.3 * 100) / 100),
    );
  }
  function add() {
    edit({
      id: newId(),
      name: '',
      attackBonus: defaultBonus,
      damage: { count: 1, sides: 6, bonus: 0, type: null },
      extraDamages: [],
      notes: '',
      ranged: false,
      finesse: false,
      legacy: false,
      reachFeet: 5,
    });
  }
  function patchDamage(index: number, patch: Partial<Damage>) {
    setDraft((d) => {
      if (!d) return d;
      if (index === 0) return { ...d, damage: { ...d.damage, ...patch } };
      return {
        ...d,
        extraDamages: d.extraDamages.map((v, i) =>
          i === index - 1 ? { ...v, ...patch } : v,
        ),
      };
    });
  }
  function save() {
    if (!draft) return;
    const meters = Number(reach.replace(',', '.'));
    if (
      !draft.ranged &&
      reach.trim() &&
      (!Number.isFinite(meters) || meters <= 0 || meters > 300)
    ) {
      setError('Informe um alcance maior que zero, em metros (ex.: 1,5).');
      return;
    }
    const attack = {
      ...draft,
      name: draft.name.trim(),
      reachFeet:
        draft.ranged || !reach.trim()
          ? undefined
          : Math.round((meters / 0.3) * 100) / 100,
    };
    onChange(
      attacks.some((a) => a.id === attack.id)
        ? attacks.map((a) => (a.id === attack.id ? attack : a))
        : [...attacks, attack],
    );
    setDraft(null);
  }
  return (
    <div className="creature-attacks">
      <div className="creature-section-heading">
        <p>
          Cadastre cada opção do bloco de estatísticas, com acerto, alcance e
          parcelas de dano.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-small"
          onClick={add}
        >
          Adicionar ataque
        </button>
      </div>
      {!attacks.length && !draft ? (
        <p className="empty-hint">
          Nenhum ataque. Adicione uma opção como Garra, Mordida ou Espada.
        </p>
      ) : null}
      <div className="creature-attack-list">
        {attacks.map((a) => (
          <article className="creature-attack-card" key={a.id}>
            <div>
              <h4>{a.name}</h4>
              <p>
                {a.ranged
                  ? 'À distância'
                  : a.reachFeet
                    ? `Corpo a corpo · ${a.reachFeet * 0.3} m`
                    : 'Corpo a corpo · alcance não informado'}{' '}
                · {formatModifier(a.attackBonus)} para acertar
              </p>
              <strong>
                {[a.damage, ...a.extraDamages]
                  .map(
                    (d) =>
                      `${damageExpression(d)}${d.type ? ' ' + d.type.toLowerCase() : ''}`,
                  )
                  .join(' + ')}
              </strong>
              {a.notes ? <p>{a.notes}</p> : null}
            </div>
            <div className="creature-card-actions">
              <button
                type="button"
                className="btn btn-small"
                onClick={() => edit(a)}
              >
                Editar ataque
              </button>
              {remove === a.id ? (
                <>
                  <button
                    type="button"
                    className="btn btn-danger btn-small"
                    onClick={() => {
                      onChange(attacks.filter((v) => v.id !== a.id));
                      setRemove(null);
                    }}
                  >
                    Confirmar exclusão
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => setRemove(null)}
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setRemove(a.id)}
                >
                  Excluir ataque
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {draft ? (
        <form
          className="creature-attack-form"
          aria-label="Editor de ataque"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <p className="form-error" role="alert">
            {error}
          </p>
          <h4>
            {attacks.some((a) => a.id === draft.id)
              ? 'Editar ataque'
              : 'Novo ataque'}
          </h4>
          <div className="creature-form-grid">
            <label>
              Nome
              <input
                autoFocus
                required
                maxLength={120}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Ex.: Mordida"
              />
            </label>
            <label>
              Categoria
              <select
                value={draft.ranged ? 'ranged' : 'melee'}
                onChange={(e) =>
                  setDraft({ ...draft, ranged: e.target.value === 'ranged' })
                }
              >
                <option value="melee">Corpo a corpo</option>
                <option value="ranged">À distância</option>
              </select>
            </label>
            <label>
              Bônus total para acertar
              <input
                type="number"
                required
                min={-30}
                max={30}
                value={draft.attackBonus}
                onChange={(e) =>
                  setDraft({ ...draft, attackBonus: Number(e.target.value) })
                }
              />
            </label>
            {!draft.ranged ? (
              <label>
                Alcance corpo a corpo (m)
                <input
                  value={reach}
                  onChange={(e) => setReach(e.target.value)}
                  placeholder="1,5"
                  inputMode="decimal"
                />
                <small>
                  Necessário para a área de ameaça e ataques de oportunidade.
                </small>
              </label>
            ) : (
              <p className="section-note">
                Este ataque não gera oportunidade. O alcance à distância segue a
                confirmação assistida existente.
              </p>
            )}
          </div>
          <fieldset>
            <legend>Dano</legend>
            {[draft.damage, ...draft.extraDamages].map((d, index) => (
              <div className="creature-damage-row" key={index}>
                <label>
                  Dados
                  <input
                    type="number"
                    min={0}
                    max={50}
                    required
                    value={d.count}
                    onChange={(e) =>
                      patchDamage(index, { count: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Dado
                  <select
                    value={d.sides}
                    onChange={(e) =>
                      patchDamage(index, { sides: Number(e.target.value) })
                    }
                  >
                    {[...new Set([4, 6, 8, 10, 12, 20, d.sides])]
                      .sort((a, b) => a - b)
                      .map((n) => (
                        <option key={n} value={n}>
                          d{n}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Bônus
                  <input
                    type="number"
                    min={-9999}
                    max={9999}
                    required
                    value={d.bonus}
                    onChange={(e) =>
                      patchDamage(index, { bonus: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Tipo
                  <select
                    value={d.type ?? ''}
                    onChange={(e) =>
                      patchDamage(index, {
                        type: (e.target.value as Damage['type']) || null,
                      })
                    }
                  >
                    <option value="">Sem tipo</option>
                    {DAMAGE_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                {index > 0 ? (
                  <button
                    type="button"
                    className="btn btn-small"
                    aria-label={`Remover dano adicional ${index}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        extraDamages: draft.extraDamages.filter(
                          (_, i) => i !== index - 1,
                        ),
                      })
                    }
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
            <p className="section-note">
              Use zero dados para dano fixo; informe o valor no bônus.
            </p>
            <button
              className="btn btn-small"
              type="button"
              disabled={draft.extraDamages.length >= MAX_EXTRA_DAMAGES}
              onClick={() =>
                setDraft({
                  ...draft,
                  extraDamages: [
                    ...draft.extraDamages,
                    { count: 1, sides: 6, bonus: 0, type: null },
                  ],
                })
              }
            >
              Adicionar outro tipo de dano
            </button>
          </fieldset>
          <label>
            Observações
            <textarea
              maxLength={1000}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Ex.: efeito adicional ou restrição do ataque"
            />
          </label>
          <label className="creature-checkbox">
            <input
              type="checkbox"
              checked={draft.finesse}
              onChange={(e) =>
                setDraft({ ...draft, finesse: e.target.checked })
              }
            />{' '}
            Ataque com arma sutil
          </label>
          {draft.legacy ? (
            <p className="section-note">
              Dano legado preservado: {draft.damageText}. Confira os valores
              antes de utilizar.
            </p>
          ) : null}
          <div className="creature-card-actions">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!draft.name.trim()}
            >
              Salvar ataque
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setDraft(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
