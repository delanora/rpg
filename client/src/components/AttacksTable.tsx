import { DAMAGE_TYPES, formatModifier } from '../dnd';
import { useSheetAccess } from '../readonly';
import type { Attack } from '../types';
import { clampInt, newId } from '../utils';
import { InlineField } from './InlineField';

interface AttacksTableProps {
  attacks: Attack[];
  onChange: (attacks: Attack[]) => void;
  /** Bônus sugerido ao criar um novo ataque (ex.: proficiência + atributo). */
  defaultBonus?: number;
}

/** Tabela de ataques/armas — usada tanto pela ficha quanto pelo bestiário. */
export function AttacksTable({ attacks, onChange, defaultBonus = 0 }: AttacksTableProps) {
  // Ataques são construção: depois de finalizar a criação, só o mestre (ou o
  // Level Up) mexe neles.
  const { lockedConstruction } = useSheetAccess();
  const readOnly = lockedConstruction;

  function patchAttack(id: string, patch: Partial<Attack>): void {
    onChange(attacks.map((attack) => (attack.id === id ? { ...attack, ...patch } : attack)));
  }

  function addAttack(): void {
    onChange([
      ...attacks,
      {
        id: newId(),
        name: 'Novo ataque',
        damage: '1d8',
        damageType: '',
        attackBonus: defaultBonus,
        notes: '',
        finesse: false,
        ranged: false,
      },
    ]);
  }

  function removeAttack(id: string): void {
    onChange(attacks.filter((attack) => attack.id !== id));
  }

  return (
    <>
      {!readOnly ? (
        <div className="toolbar">
          <button type="button" className="btn btn-small" onClick={addAttack}>
            + ataque
          </button>
        </div>
      ) : null}

      {attacks.length === 0 ? (
        <p className="empty-hint">Nenhum ataque cadastrado.</p>
      ) : (
        <div className="table-wrap">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Ataque</th>
                <th className="col-narrow">Bônus</th>
                <th className="col-narrow">Dano</th>
                <th>Tipo</th>
                <th className="col-narrow">Furtivo</th>
                <th>Observações</th>
                {!readOnly ? <th className="col-narrow" /> : null}
              </tr>
            </thead>
            <tbody>
              {attacks.map((attack) => (
                <tr key={attack.id}>
                  <td>
                    <InlineField
                      value={attack.name}
                      ariaLabel="Nome do ataque"
                      onCommit={(value) => {
                        const name = value.trim();
                        if (name) patchAttack(attack.id, { name });
                      }}
                    />
                  </td>
                  <td>
                    <InlineField
                      value={attack.attackBonus}
                      mode="number"
                      min={-30}
                      max={30}
                      ariaLabel="Bônus de ataque"
                      render={(value) => formatModifier(Number(value))}
                      onCommit={(value) =>
                        patchAttack(attack.id, {
                          attackBonus: clampInt(value, -30, 30, attack.attackBonus),
                        })
                      }
                    />
                  </td>
                  <td>
                    <InlineField
                      value={attack.damage}
                      placeholder="ex.: 1d8+3"
                      ariaLabel="Dano"
                      onCommit={(value) => patchAttack(attack.id, { damage: value })}
                    />
                  </td>
                  <td>
                    <InlineField
                      value={attack.damageType}
                      mode="select"
                      options={DAMAGE_TYPES}
                      ariaLabel="Tipo de dano"
                      onCommit={(value) => patchAttack(attack.id, { damageType: value })}
                    />
                  </td>
                  <td className="col-center">
                    <span className="check-inline">
                      <input
                        type="checkbox"
                        checked={attack.finesse}
                        disabled={readOnly}
                        title="Arma sutil — habilita o Ataque Furtivo"
                        aria-label={`Arma sutil para ${attack.name}`}
                        onChange={(event) =>
                          patchAttack(attack.id, { finesse: event.target.checked })
                        }
                      />
                      <span>sutil</span>
                    </span>
                    <span className="check-inline">
                      <input
                        type="checkbox"
                        checked={attack.ranged}
                        disabled={readOnly}
                        title="Arma à distância — habilita o Ataque Furtivo"
                        aria-label={`Arma à distância para ${attack.name}`}
                        onChange={(event) =>
                          patchAttack(attack.id, { ranged: event.target.checked })
                        }
                      />
                      <span>dist.</span>
                    </span>
                  </td>
                  <td>
                    <InlineField
                      value={attack.notes}
                      placeholder="observações"
                      ariaLabel="Observações"
                      onCommit={(value) => patchAttack(attack.id, { notes: value })}
                    />
                  </td>
                  {!readOnly ? (
                    <td className="col-center">
                      <button
                        type="button"
                        className="btn btn-danger btn-small"
                        onClick={() => removeAttack(attack.id)}
                        aria-label={`Remover ${attack.name}`}
                      >
                        ×
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
