import {
  ammoStackTotal,
  ammoStacks,
  availableAttacks,
  equippedWeapons,
  requiredAmmoType,
  weaponOf,
} from '../ammo';
import { DAMAGE_TYPES, damageExpression, formatModifier } from '../dnd';
import { useSheetAccess } from '../readonly';
import type { Attack, Damage, DamageType, InventoryItem } from '../types';
import { clampInt, newId } from '../utils';
import { InlineField } from './InlineField';

const DIE_OPTIONS = ['4', '6', '8', '10', '12', '20'] as const;

interface AttacksTableProps {
  attacks: Attack[];
  onChange: (attacks: Attack[]) => void;
  /** Bônus sugerido ao criar um novo ataque (ex.: proficiência + atributo). */
  defaultBonus?: number;
  /**
   * Inventário da ficha. Quando informado, o ataque pode ser vinculado a uma
   * arma EQUIPADA numa das mãos e os ataques de armas não equipadas somem.
   */
  inventory?: InventoryItem[];
}

/** Tabela de ataques/armas — usada tanto pela ficha quanto pelo bestiário. */
export function AttacksTable({
  attacks,
  onChange,
  defaultBonus = 0,
  inventory,
}: AttacksTableProps) {
  // Ataques são construção: depois de finalizar a criação, só o mestre (ou o
  // Level Up) mexe neles.
  const { lockedConstruction } = useSheetAccess();
  const readOnly = lockedConstruction;

  const weapons = inventory ? equippedWeapons(inventory) : [];
  const weaponOptions = weapons.map((item) => item.id);
  const weaponLabels = Object.fromEntries(weapons.map((item) => [item.id, item.name]));
  // Ataques de arma não equipada nem aparecem (só quando há inventário para avaliar).
  const visible = inventory ? availableAttacks(attacks, inventory) : attacks;

  function patchAttack(id: string, patch: Partial<Attack>): void {
    onChange(attacks.map((attack) => (attack.id === id ? { ...attack, ...patch } : attack)));
  }

  function patchDamage(id: string, patch: Partial<Damage>): void {
    onChange(
      attacks.map((attack) =>
        attack.id === id ? { ...attack, damage: { ...attack.damage, ...patch } } : attack,
      ),
    );
  }

  function addAttack(): void {
    onChange([
      ...attacks,
      {
        id: newId(),
        name: 'Novo ataque',
        damage: { count: 1, sides: 6, bonus: 0, type: null },
        attackBonus: defaultBonus,
        notes: '',
        finesse: false,
        ranged: false,
        legacy: false,
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

      {visible.length === 0 ? (
        <p className="empty-hint">Nenhum ataque cadastrado.</p>
      ) : (
        <div className="table-wrap">
          <table className="sheet-table">
            <thead>
              <tr>
                <th>Ataque</th>
                {inventory ? <th>Arma equipada</th> : null}
                <th className="col-narrow">Acerto</th>
                <th className="col-damage">Dano (dados + bônus)</th>
                <th>Tipo</th>
                <th className="col-narrow">Furtivo</th>
                <th>Observações</th>
                {!readOnly ? <th className="col-narrow" /> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((attack) => {
                const weapon = inventory ? weaponOf(attack, inventory) : null;
                const ammoType = requiredAmmoType(weapon);
                const available = ammoType && inventory ? ammoStackTotal(ammoStacks(inventory, ammoType)) : 0;

                return (
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
                      {attack.legacy ? (
                        <span
                          className="legacy-badge"
                          title={`Dano antigo não convertido: ${attack.damageText ?? '—'}`}
                        >
                          legado
                        </span>
                      ) : null}
                    </td>
                    {inventory ? (
                      <td>
                        <InlineField
                          value={attack.inventoryItemId ?? ''}
                          mode="select"
                          options={weaponOptions}
                          optionLabels={weaponLabels}
                          ariaLabel="Arma equipada vinculada"
                          render={() => weaponLabels[attack.inventoryItemId ?? ''] ?? '—'}
                          onCommit={(value) =>
                            patchAttack(attack.id, { inventoryItemId: value || undefined })
                          }
                        />
                        {ammoType ? (
                          <span
                            className={available > 0 ? 'ammo-info' : 'ammo-info is-empty'}
                            title="Munição disponível para esta arma"
                          >
                            {available > 0 ? `${ammoType}: ${available}` : `sem ${ammoType.toLowerCase()}`}
                          </span>
                        ) : null}
                      </td>
                    ) : null}
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
                      <div className="damage-fields">
                        <InlineField
                          value={attack.damage.count}
                          mode="number"
                          min={0}
                          max={50}
                          ariaLabel="Quantidade de dados de dano"
                          title="Quantidade de dados (0 = dano fixo)"
                          onCommit={(value) =>
                            patchDamage(attack.id, {
                              count: clampInt(value, 0, 50, attack.damage.count),
                            })
                          }
                        />
                        <span className="damage-sep" aria-hidden="true">
                          d
                        </span>
                        <InlineField
                          value={attack.damage.sides ? String(attack.damage.sides) : ''}
                          mode="select"
                          options={DIE_OPTIONS}
                          ariaLabel="Dado de dano"
                          onCommit={(value) =>
                            patchDamage(attack.id, { sides: value ? Number(value) : 0 })
                          }
                        />
                        <span className="damage-sep" aria-hidden="true">
                          +
                        </span>
                        <InlineField
                          value={attack.damage.bonus}
                          mode="number"
                          min={-9999}
                          max={9999}
                          ariaLabel="Bônus de dano"
                          title="Bônus fixo (pode ser negativo)"
                          onCommit={(value) =>
                            patchDamage(attack.id, {
                              bonus: clampInt(value, -9999, 9999, attack.damage.bonus),
                            })
                          }
                        />
                        <span className="damage-preview" title="Expressão derivada (só exibição)">
                          {damageExpression(attack.damage)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <InlineField
                        value={attack.damage.type ?? ''}
                        mode="select"
                        options={DAMAGE_TYPES}
                        ariaLabel="Tipo de dano"
                        onCommit={(value) =>
                          patchDamage(attack.id, { type: (value || null) as DamageType | null })
                        }
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
