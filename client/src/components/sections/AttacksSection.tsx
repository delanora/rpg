import { AttacksTable } from '../AttacksTable';
import { Section } from '../Section';
import { damageExpression, formatModifier } from '../../dnd';
import type { SheetSectionProps } from './common';

export function AttacksSection({ character, update }: SheetSectionProps) {
  const defaultBonus = character.derived.proficiencyBonus + character.derived.modifiers.strength;
  // Ataques calculados das armas equipadas (não se editam: são derivados).
  const derived = character.derivedAttacks ?? [];

  return (
    <Section title="Ataques e Armas" icon="sword">
      <AttacksTable
        attacks={character.attacks}
        defaultBonus={defaultBonus}
        inventory={character.inventory}
        onChange={(attacks) => update({ attacks })}
      />

      {derived.length > 0 ? (
        <div className="derived-attacks">
          <h4>Armas equipadas</h4>
          <p className="section-note">
            Calculados da arma equipada (habilidade, proficiência e propriedades). Use-os no
            combate — a ficha não os edita aqui.
          </p>
          <div className="table-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>Ataque</th>
                  <th className="col-narrow">Acerto</th>
                  <th className="col-damage">Dano</th>
                  <th>Tipo</th>
                  <th>Observações</th>
                </tr>
              </thead>
              <tbody>
                {derived.map((attack) => (
                  <tr key={attack.id}>
                    <td>
                      {attack.name}
                      {attack.blocked ? (
                        <span className="legacy-badge" title={attack.blocked}>
                          indisponível
                        </span>
                      ) : null}
                    </td>
                    <td>{formatModifier(attack.attackBonus)}</td>
                    <td>{damageExpression(attack.damage)}</td>
                    <td>{attack.damage.type ?? '—'}</td>
                    <td>{attack.blocked ?? attack.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {character.derived.sneakAttack ? (
        <p className="section-note">
          Ataque Furtivo: +{character.derived.sneakAttack.expression} em armas marcadas como
          sutis ou à distância (somado automaticamente quando o ataque acerta).
        </p>
      ) : null}
    </Section>
  );
}
