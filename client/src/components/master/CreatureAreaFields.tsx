import { CONDITION_LABELS } from '../../../../src/modules/shared/conditions';
import type { CreatureAreaDefinition } from '../../../../src/modules/shared/creature-abilities';
import { DAMAGE_TYPES } from '../../../../src/modules/shared/attacks';
import { ABILITY_LABELS } from '../../dnd';
import { feetToMeters, metersToFeet } from '../../sceneUnits';
export const defaultCreatureArea: CreatureAreaDefinition = {
  shape: { kind: 'cone', lengthFeet: 30 },
  rangeFeet: 0,
  saveAbility: 'dexterity',
  dc: 12,
  onSuccess: 'half',
  damage: [{ type: 'Fogo', dice: { count: 2, sides: 6 } }],
};
/** Dimensões do cadastro; durante o uso o cliente escolhe somente a colocação. */
export function CreatureAreaFields({
  value,
  onChange,
}: {
  value: CreatureAreaDefinition;
  onChange: (next: CreatureAreaDefinition) => void;
}) {
  const shape = value.shape;
  const dimension =
    'radiusFeet' in shape
      ? shape.radiusFeet
      : 'sizeFeet' in shape
        ? shape.sizeFeet
        : shape.lengthFeet;
  const changeDimension = (feet: number) =>
    onChange({
      ...value,
      shape:
        shape.kind === 'sphere'
          ? { ...shape, radiusFeet: feet }
          : shape.kind === 'cylinder'
            ? { ...shape, radiusFeet: feet }
            : shape.kind === 'cube'
              ? { ...shape, sizeFeet: feet }
              : { ...shape, lengthFeet: feet },
    });
  return (
    <fieldset className="creature-area-fields">
      <legend>Área e salvaguarda</legend>
      <p className="field-hint">
        Use os valores do bloco da criatura. A elevação vem do token; paredes
        que bloqueiam ataques impedem a área.
      </p>
      <div className="creature-form-grid">
        <label>
          Forma
          <select
            aria-label="Forma da habilidade em área"
            value={shape.kind}
            onChange={(event) => {
              const kind = event.target.value as typeof shape.kind;
              onChange({
                ...value,
                shape:
                  kind === 'sphere'
                    ? { kind, radiusFeet: dimension }
                    : kind === 'cylinder'
                      ? { kind, radiusFeet: dimension, heightFeet: 20 }
                      : kind === 'cube'
                        ? { kind, sizeFeet: dimension }
                        : kind === 'line'
                          ? { kind, lengthFeet: dimension, widthFeet: 5 }
                          : { kind, lengthFeet: dimension },
              });
            }}
          >
            {[
              ['cone', 'Cone'],
              ['line', 'Linha'],
              ['sphere', 'Esfera'],
              ['cube', 'Cubo'],
              ['cylinder', 'Cilindro'],
            ].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {shape.kind === 'sphere' || shape.kind === 'cylinder'
            ? 'Raio'
            : shape.kind === 'cube'
              ? 'Aresta'
              : 'Comprimento'}{' '}
          (m)
          <input
            aria-label="Dimensão da habilidade em metros"
            type="number"
            min={0.75}
            step={0.75}
            value={feetToMeters(dimension)}
            onChange={(event) =>
              changeDimension(metersToFeet(Number(event.target.value)))
            }
          />
        </label>
        {shape.kind === 'line' ? (
          <label>
            Largura (m)
            <input
              aria-label="Largura da habilidade em metros"
              type="number"
              min={0.75}
              step={0.75}
              value={feetToMeters(shape.widthFeet)}
              onChange={(event) =>
                onChange({
                  ...value,
                  shape: {
                    ...shape,
                    widthFeet: metersToFeet(Number(event.target.value)),
                  },
                })
              }
            />
          </label>
        ) : null}
        {!['cone', 'line'].includes(shape.kind) ? (
          <label>
            Alcance até a origem (m)
            <input
              aria-label="Alcance da origem em metros"
              type="number"
              min={0}
              step={1.5}
              value={feetToMeters(value.rangeFeet)}
              onChange={(event) =>
                onChange({
                  ...value,
                  rangeFeet: metersToFeet(Number(event.target.value)),
                })
              }
            />
          </label>
        ) : null}
        <label>
          Salvaguarda
          <select
            aria-label="Atributo da salvaguarda da habilidade"
            value={value.saveAbility}
            onChange={(event) =>
              onChange({
                ...value,
                saveAbility: event.target.value as typeof value.saveAbility,
              })
            }
          >
            {Object.entries(ABILITY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          CD
          <input
            aria-label="CD da habilidade"
            type="number"
            min={1}
            max={40}
            value={value.dc}
            onChange={(event) =>
              onChange({ ...value, dc: Number(event.target.value) })
            }
          />
        </label>
        {value.damage.length?<label>
          No sucesso
          <select
            aria-label="Dano no sucesso da salvaguarda"
            value={value.onSuccess}
            onChange={(event) =>
              onChange({
                ...value,
                onSuccess: event.target.value as 'half' | 'none',
              })
            }
          >
            <option value="half">Metade do dano</option>
            <option value="none">Nenhum dano</option>
          </select>
        </label>:null}
      </div>
      <h4>Resultado na falha</h4>
      <label className="creature-checkbox"><input type="checkbox" aria-label="Causar dano na falha" checked={value.damage.length>0} onChange={event=>onChange({...value,damage:event.target.checked?structuredClone(defaultCreatureArea.damage):[],...(!event.target.checked?{onSuccess:'none' as const}:{})})}/> Causar dano</label>
      <div className="creature-form-grid">{Object.entries(CONDITION_LABELS).map(([key,label])=><label className="creature-checkbox" key={key}><input type="checkbox" checked={value.conditions?.includes(key as keyof typeof CONDITION_LABELS)??false} onChange={event=>onChange({...value,conditions:event.target.checked?[...(value.conditions??[]),key as keyof typeof CONDITION_LABELS]:(value.conditions??[]).filter(condition=>condition!==key)})}/>{label}</label>)}</div>
      <p className="field-hint">Condições são aplicadas na falha e podem ser encerradas nos efeitos do alvo. Duração, novos testes e imunidades ficam sob decisão do Mestre; descreva essas regras na habilidade.</p>
      {value.damage.length?<h4>Dano compartilhado</h4>:null}
      {value.damage.map((component, index) => (
        <div className="creature-form-grid" key={index}>
          <label>
            Quantidade de dados
            <input
              aria-label={`Dados de dano ${index + 1}`}
              type="number"
              min={1}
              max={100}
              value={component.dice.count}
              onChange={(event) =>
                onChange({
                  ...value,
                  damage: value.damage.map((row, i) =>
                    i === index
                      ? {
                          ...row,
                          dice: {
                            ...row.dice,
                            count: Number(event.target.value),
                          },
                        }
                      : row,
                  ),
                })
              }
            />
          </label>
          <label>
            Dado
            <select
              aria-label={`Tipo do dado ${index + 1}`}
              value={component.dice.sides}
              onChange={(event) =>
                onChange({
                  ...value,
                  damage: value.damage.map((row, i) =>
                    i === index
                      ? {
                          ...row,
                          dice: {
                            ...row.dice,
                            sides: Number(
                              event.target.value,
                            ) as typeof row.dice.sides,
                          },
                        }
                      : row,
                  ),
                })
              }
            >
              {[4, 6, 8, 10, 12, 20].map((sides) => (
                <option key={sides} value={sides}>
                  d{sides}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bônus de dano
            <input aria-label={`Bônus de dano ${index + 1}`} type="number" min={-9999} max={9999} step={1} value={component.bonus??0} onChange={event=>onChange({...value,damage:value.damage.map((row,i)=>i===index?{...row,bonus:Number(event.target.value)}:row)})}/>
          </label>
          <label>
            Tipo de dano
            <select
              aria-label={`Tipo de dano ${index + 1}`}
              value={component.type}
              onChange={(event) =>
                onChange({
                  ...value,
                  damage: value.damage.map((row, i) =>
                    i === index
                      ? { ...row, type: event.target.value as typeof row.type }
                      : row,
                  ),
                })
              }
            >
              {DAMAGE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        </div>
      ))}
      <p className="field-hint">
        {value.damage.length?'Um único dano rolado para todos os alvos.':''} Cada um aplica a salvaguarda e
        suas resistências/imunidades. As condições selecionadas são aplicadas somente na falha.
      </p>
    </fieldset>
  );
}
