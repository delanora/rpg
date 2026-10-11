import { useState } from 'react';
import { fileToImagePayload, uploadImage } from '../../api';
import {
  DAMAGE_TYPES,
  ITEM_CATEGORY_LABELS,
  ITEM_RARITY_LABELS,
  MAX_EXTRA_DAMAGES,
  POTION_CATEGORY_LABELS,
  WEAPON_CATEGORY_LABELS,
  WEAPON_PROPERTY_LABELS,
  WEAPON_TYPE_LABELS,
  categoryLabel,
  damageExpression,
} from '../../dnd';
import {
  AMMO_TYPES,
  ARMOR_TYPES,
  HEALING_DICE_SIDES,
  ITEM_CATEGORIES,
  ITEM_RARITIES,
  POTION_CATEGORIES,
  WEAPON_CATEGORIES,
  WEAPON_PROPERTIES,
  WEAPON_TYPES,
} from '../../types';
import type {
  AmmoType,
  CanonicalWeapon,
  Damage,
  DamageType,
  Item,
  ItemDetails,
  ItemPatch,
  ItemPrice,
  ItemRarity,
  PotionCategory,
  WeaponCategory,
  WeaponProperty,
  WeaponType,
} from '../../types';
import { clampFloat, clampInt } from '../../utils';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Portrait } from '../Portrait';
import { Section } from '../Section';

const DIE_OPTIONS = ['4', '6', '8', '10', '12', '20'] as const;

/** Rótulos do dado de cura (d4...d12), usados no select da Poção de Cura. */
const HEALING_DIE_LABELS: Record<string, string> = {
  '4': 'd4',
  '6': 'd6',
  '8': 'd8',
  '10': 'd10',
  '12': 'd12',
};

/** Escada do dado versátil: d4→d6, d6→d8, d8→d10, d10→d12 (senão d8). */
function nextVersatileDie(die: number): number {
  return die >= 4 && die <= 10 ? die + 2 : 8;
}

interface ItemEditorProps {
  item: Item;
  /** Catálogo canônico de armas do PHB (seletor "Arma do PHB"). */
  weapons: CanonicalWeapon[];
  onPatch: (patch: ItemPatch) => void;
  onDelete: () => void;
  /**
   * Renderiza SÓ o formulário, sem o cabeçalho próprio (nome + remover item).
   * Usado dentro do modal de item, que já traz o título e as ações no topo.
   */
  embedded?: boolean;
}

/** Campos numéricos/selects específicos da categoria do item. */
function CategoryFields({
  item,
  weapons,
  onPatchDetails,
  onCampSupplyValue,
}: {
  item: Item;
  weapons: CanonicalWeapon[];
  onPatchDetails: (patch: ItemDetails) => void;
  /** Valor POR UNIDADE em Recursos de Acampamento (categoria `CAMP_SUPPLY`). */
  onCampSupplyValue: (value: number) => void;
}) {
  const details = item.details;

  // RECURSO DE ACAMPAMENTO: a categoria liga o campo próprio do valor por
  // unidade. OBRIGATÓRIO (> 0) — o servidor recusa um recurso sem valor.
  if (item.category === 'CAMP_SUPPLY') {
    const value = item.campSupply?.value ?? 0;
    return (
      <div className="grid grid-3">
        <label className="field">
          <span>Valor em Recursos de Acampamento por unidade</span>
          <InlineField
            value={value}
            mode="number"
            min={1}
            max={1000}
            ariaLabel="Valor em recursos de acampamento por unidade"
            onCommit={(next) => onCampSupplyValue(clampInt(next, 1, 1000, value || 1))}
          />
          <span className="field-hint">
            pontos que UMA unidade contribui (ex.: 1 maçã = 1; 1 peixe assado = 20)
          </span>
        </label>
        <label className="field field-check">
          <span>Consumível (usável)</span>
          <input
            type="checkbox"
            checked={Boolean(details.consumable)}
            aria-label="Item consumível"
            onChange={(event) => onPatchDetails({ consumable: event.target.checked })}
          />
          <span className="field-hint">a comida também pode ser comida (usa 1 unidade da pilha)</span>
        </label>
        <p className="section-note">
          Item de categoria <strong>Recurso de Acampamento</strong>: só ele aparece no grid de
          recursos do Descanso Longo. O preço em PO/PP/PC continua no bloco abaixo (visível apenas
          para o mestre) e NUNCA aparece para o jogador.
        </p>
      </div>
    );
  }

  if (item.category === 'Arma' || item.category === 'Cajado') {
    const properties = details.properties ?? [];
    const extraDamages = details.extraDamages ?? [];
    const weaponType = details.weaponType ?? 'melee';
    const showRange = weaponType === 'ranged' || properties.includes('thrown');
    const hasVersatile = properties.includes('versatile');
    const hasAmmunition = properties.includes('ammunition');
    // Munição só aparece (e só vale) para arma à distância.
    const listedProperties =
      weaponType === 'ranged'
        ? WEAPON_PROPERTIES
        : WEAPON_PROPERTIES.filter((property) => property !== 'ammunition');

    /** Edita UM dano adicional da arma, pelo índice da linha. */
    function patchExtraDamage(index: number, patch: Partial<Damage>): void {
      onPatchDetails({
        extraDamages: extraDamages.map((damage, at) =>
          at === index ? { ...damage, ...patch } : damage,
        ),
      });
    }

    /** Mantém as propriedades coerentes entre si (o servidor revalida). */
    function toggleProperty(property: WeaponProperty): void {
      const next = new Set(properties);
      const removing = next.has(property);
      const patch: ItemDetails = {};

      if (removing) {
        next.delete(property);
        if (property === 'versatile') patch.versatileDie = undefined;
      } else {
        next.add(property);
        if (property === 'versatile') {
          // Versátil e Duas mãos não coexistem.
          next.delete('two-handed');
          patch.versatileDie = details.versatileDie ?? nextVersatileDie(details.damageDie ?? 6);
        }
        if (property === 'two-handed') {
          next.delete('versatile');
          patch.versatileDie = undefined;
        }
        if (property === 'thrown' && details.rangeNormal === undefined) {
          // Arremessável exige os dois alcances: já sugere um par editável.
          patch.rangeNormal = 6;
          patch.rangeLong = 18;
        }
        if (property === 'ammunition') {
          // Munição exigida: já sugere um tipo para o item não ficar inválido.
          patch.ammoType = details.ammoType ?? 'Flecha';
        }
      }

      onPatchDetails({ ...patch, properties: [...next] });
    }

    function changeWeaponType(value: string): void {
      const nextType = (value || 'melee') as WeaponType;
      const patch: ItemDetails = { weaponType: nextType };
      if (nextType === 'melee') {
        patch.properties = properties.filter((property) => property !== 'ammunition');
      } else if (details.rangeNormal === undefined || details.rangeLong === undefined) {
        patch.rangeNormal = details.rangeNormal ?? 6;
        patch.rangeLong = details.rangeLong ?? 18;
      }
      onPatchDetails(patch);
    }

    /**
     * Vincula (ou desvincula) a ARMA CANÔNICA do PHB. Ao escolher, preenche os
     * campos de uso a partir do catálogo (tudo ainda editável); vazio = arma
     * homebrew, que cai no fallback de proficiência por nome/categoria.
     */
    function changeCanonicalWeapon(value: string): void {
      if (!value) {
        onPatchDetails({ canonicalWeaponId: undefined });
        return;
      }
      const weapon = weapons.find((entry) => entry.id === value);
      if (!weapon) return;
      const nextProperties = [...weapon.properties];
      onPatchDetails({
        canonicalWeaponId: weapon.id,
        weaponType: weapon.type,
        weaponCategory: weapon.category,
        properties: nextProperties,
        versatileDie: nextProperties.includes('versatile') ? weapon.versatileDie : undefined,
        // Alcance e munição vêm do catálogo (os campos da arma são inteiros, então
        // arredonda: a zarabatana 7,5 m vira 8). Armas sem esses dados os limpam.
        rangeNormal: weapon.rangeNormal === undefined ? undefined : Math.round(weapon.rangeNormal),
        rangeLong: weapon.rangeLong === undefined ? undefined : Math.round(weapon.rangeLong),
        ammoType: nextProperties.includes('ammunition') ? weapon.ammoType : undefined,
      });
    }

    const weaponOptionLabels: Record<string, string> = {};
    for (const weapon of weapons) {
      weaponOptionLabels[weapon.id] = `${weapon.namePt} — ${
        weapon.category === 'martial' ? 'marcial' : 'simples'
      }`;
    }

    return (
      <>
      {/* Dano principal — todos os números do ataque numa linha compacta, com o
          resumo do dano logo abaixo como leitura (não como campo). */}
      <div className="item-editor-subblock">
        <h4 className="item-editor-subtitle">Dano principal</h4>
        <div className="grid item-editor-damage-row">
          <label className="field">
            <span>Dados</span>
            <InlineField
              value={details.damageCount ?? 0}
              mode="number"
              min={0}
              max={50}
              ariaLabel="Quantidade de dados de dano"
              onCommit={(value) => onPatchDetails({ damageCount: clampInt(value, 0, 50, 0) })}
            />
          </label>

          <label className="field">
            <span>Dado</span>
            <InlineField
              value={details.damageDie ? String(details.damageDie) : ''}
              mode="select"
              options={DIE_OPTIONS}
              ariaLabel="Tipo do dado de dano"
              onCommit={(value) => onPatchDetails({ damageDie: value ? Number(value) : 0 })}
            />
          </label>

          <label className="field">
            <span>Tipo de dano</span>
            <InlineField
              value={details.damageType ?? ''}
              mode="select"
              options={DAMAGE_TYPES}
              ariaLabel="Tipo de dano"
              onCommit={(value) =>
                onPatchDetails({ damageType: (value || undefined) as ItemDetails['damageType'] })
              }
            />
          </label>

          <label className="field">
            <span>Bônus de ataque</span>
            <InlineField
              value={details.attackBonus ?? 0}
              mode="number"
              min={-30}
              max={30}
              ariaLabel="Bônus de ataque"
              onCommit={(value) => onPatchDetails({ attackBonus: clampInt(value, -30, 30, 0) })}
            />
          </label>

          <label className="field">
            <span>Bônus de dano</span>
            <InlineField
              value={details.damageBonus ?? 0}
              mode="number"
              min={-9999}
              max={9999}
              ariaLabel="Bônus de dano"
              onCommit={(value) => onPatchDetails({ damageBonus: clampInt(value, -9999, 9999, 0) })}
            />
          </label>
        </div>

        <p className="item-editor-readout">
          <span className="item-editor-readout-label">Dano resumido</span>
          <span className="item-editor-readout-value">
            {damageExpression({
              count: details.damageCount ?? 0,
              sides: details.damageDie ?? 0,
              bonus: details.damageBonus ?? 0,
              type: details.damageType ?? null,
            })}
            {details.damageType ? ` ${details.damageType}` : ''}
          </span>
        </p>
      </div>

      {/* Dano adicional — bloco próprio; cada linha tem os seus dados e um
          botão de remover. Sem nenhum dano extra, fica só o gatilho. */}
      <div className="item-editor-subblock">
        <h4 className="item-editor-subtitle">Dano adicional</h4>
        {extraDamages.map((extra, index) => (
          <div className="item-editor-extra" key={index}>
            <label className="field">
              <span>Dados</span>
              <InlineField
                value={extra.count}
                mode="number"
                min={0}
                max={50}
                ariaLabel={`Dados do ${index + 2}º dano de ${item.name}`}
                onCommit={(value) => patchExtraDamage(index, { count: clampInt(value, 0, 50, 0) })}
              />
            </label>
            <label className="field">
              <span>Dado</span>
              <InlineField
                value={extra.sides ? String(extra.sides) : ''}
                mode="select"
                options={DIE_OPTIONS}
                ariaLabel={`Dado do ${index + 2}º dano de ${item.name}`}
                onCommit={(value) => patchExtraDamage(index, { sides: value ? Number(value) : 0 })}
              />
            </label>
            <label className="field">
              <span>Tipo de dano</span>
              <InlineField
                value={extra.type ?? ''}
                mode="select"
                options={DAMAGE_TYPES}
                ariaLabel={`Tipo do ${index + 2}º dano de ${item.name}`}
                onCommit={(value) =>
                  patchExtraDamage(index, { type: (value || null) as DamageType | null })
                }
              />
            </label>
            <label className="field">
              <span>Bônus</span>
              <InlineField
                value={extra.bonus}
                mode="number"
                min={-9999}
                max={9999}
                ariaLabel={`Bônus do ${index + 2}º dano de ${item.name}`}
                onCommit={(value) =>
                  patchExtraDamage(index, { bonus: clampInt(value, -9999, 9999, 0) })
                }
              />
            </label>
            <button
              type="button"
              className="btn btn-danger btn-small"
              title="Remover este tipo de dano"
              aria-label={`Remover o ${index + 2}º dano de ${item.name}`}
              onClick={() =>
                onPatchDetails({
                  extraDamages: extraDamages.filter((_, at) => at !== index),
                })
              }
            >
              remover
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-small damage-add item-editor-add-damage"
          disabled={extraDamages.length >= MAX_EXTRA_DAMAGES}
          title="Adicionar outro tipo de dano (ex.: 1d6 de fogo numa espada flamejante)"
          aria-label={`Adicionar outro tipo de dano em ${item.name}`}
          onClick={() =>
            onPatchDetails({
              extraDamages: [
                ...extraDamages,
                {
                  count: details.damageCount ?? 0,
                  sides: details.damageDie ?? 0,
                  bonus: 0,
                  type: null,
                },
              ],
            })
          }
        >
          + adicionar outro tipo de dano
        </button>
      </div>

      {/* Perfil da arma — vínculo PHB, uso, categoria e alcance juntos. */}
      <div className="item-editor-subblock">
        <h4 className="item-editor-subtitle">Perfil da arma</h4>
        <div className="grid item-editor-profile">
          <label className="field item-editor-phb">
            <span>Arma do PHB</span>
            <InlineField
              value={details.canonicalWeaponId ?? ''}
              mode="select"
              options={weapons.map((weapon) => weapon.id)}
              optionLabels={weaponOptionLabels}
              ariaLabel="Arma do PHB vinculada"
              onCommit={changeCanonicalWeapon}
            />
            <span className="field-hint">vazio = arma homebrew</span>
          </label>

          <label className="field">
            <span>Uso</span>
            <InlineField
              value={weaponType}
              mode="select"
              options={WEAPON_TYPES}
              optionLabels={WEAPON_TYPE_LABELS}
              ariaLabel="Uso da arma"
              onCommit={changeWeaponType}
            />
          </label>

          <label className="field">
            <span>Categoria</span>
            <InlineField
              value={details.weaponCategory ?? 'simple'}
              mode="select"
              options={WEAPON_CATEGORIES}
              optionLabels={WEAPON_CATEGORY_LABELS}
              ariaLabel="Categoria da arma"
              onCommit={(value) =>
                onPatchDetails({ weaponCategory: (value || 'simple') as WeaponCategory })
              }
            />
          </label>

          {hasVersatile ? (
            <label className="field">
              <span>Dado com as duas mãos</span>
              <InlineField
                value={details.versatileDie ? `d${details.versatileDie}` : ''}
                mode="select"
                options={DIE_OPTIONS.map((die) => `d${die}`)}
                ariaLabel="Dado do dano versátil"
                onCommit={(value) =>
                  onPatchDetails({ versatileDie: value ? Number(value.slice(1)) : undefined })
                }
              />
            </label>
          ) : null}

          {hasAmmunition ? (
            <label className="field">
              <span>Munição exigida</span>
              <InlineField
                value={details.ammoType ?? ''}
                mode="select"
                options={AMMO_TYPES}
                ariaLabel="Tipo de munição exigida"
                onCommit={(value) => onPatchDetails({ ammoType: (value || 'Flecha') as AmmoType })}
              />
            </label>
          ) : null}

          {showRange ? (
            <>
              <label className="field">
                <span>Alcance normal (m)</span>
                <InlineField
                  value={details.rangeNormal ?? 0}
                  mode="number"
                  min={0}
                  max={1000}
                  ariaLabel="Alcance normal em metros"
                  onCommit={(value) =>
                    onPatchDetails({
                      rangeNormal: clampInt(value, 0, 1000, details.rangeNormal ?? 0),
                    })
                  }
                />
              </label>

              <label className="field">
                <span>Alcance longo (m)</span>
                <InlineField
                  value={details.rangeLong ?? 0}
                  mode="number"
                  min={0}
                  max={1000}
                  ariaLabel="Alcance longo em metros"
                  onCommit={(value) =>
                    onPatchDetails({
                      rangeLong: clampInt(value, 0, 1000, details.rangeLong ?? 0),
                    })
                  }
                />
              </label>
            </>
          ) : null}

          {item.category === 'Cajado' ? (
            <label className="field field-check item-editor-focus">
              <span>Foco de conjuração</span>
              <input
                type="checkbox"
                checked={Boolean(details.spellcastingFocus)}
                aria-label="Foco de conjuração"
                onChange={(event) => onPatchDetails({ spellcastingFocus: event.target.checked })}
              />
            </label>
          ) : null}
        </div>
      </div>

      {/* Propriedades — grade compacta de toggles (3 colunas no desktop). */}
      <div className="item-editor-subblock">
        <h4 className="item-editor-subtitle">Propriedades</h4>
        <div className="property-grid item-editor-properties">
          {listedProperties.map((property) => (
            <label key={property} className="field field-check property-check">
              <input
                type="checkbox"
                checked={properties.includes(property)}
                aria-label={WEAPON_PROPERTY_LABELS[property]}
                onChange={() => toggleProperty(property)}
              />
              <span>{WEAPON_PROPERTY_LABELS[property]}</span>
            </label>
          ))}
        </div>
      </div>
      </>
    );
  }

  // Munição: o tipo e os bônus (mágica +1/+2/+3) que a pilha concede ao ataque.
  if (item.category === 'Munição') {
    return (
      <div className="grid grid-3">
        <label className="field">
          <span>Tipo de munição</span>
          <InlineField
            value={details.ammoType ?? ''}
            mode="select"
            options={AMMO_TYPES}
            ariaLabel="Tipo de munição"
            onCommit={(value) =>
              onPatchDetails({ ammoType: (value || undefined) as AmmoType | undefined })
            }
          />
        </label>

        <label className="field">
          <span>Bônus de ataque</span>
          <InlineField
            value={details.attackBonus ?? 0}
            mode="number"
            min={-30}
            max={30}
            ariaLabel="Bônus de ataque da munição"
            onCommit={(value) => onPatchDetails({ attackBonus: clampInt(value, -30, 30, 0) })}
          />
        </label>

        <label className="field">
          <span>Bônus de dano</span>
          <InlineField
            value={details.damageBonus ?? 0}
            mode="number"
            min={-9999}
            max={9999}
            ariaLabel="Bônus de dano da munição"
            onCommit={(value) => onPatchDetails({ damageBonus: clampInt(value, -9999, 9999, 0) })}
          />
          <span className="field-hint">munição mágica: +1, +2 ou +3</span>
        </label>
      </div>
    );
  }

  // A armadura tem CA base e peso (leve/média/pesada): é daí que sai a CA da
  // ficha quando ela está equipada no peitoral.
  if (item.category === 'Armadura') {
    return (
      <div className="grid grid-3">
        <label className="field">
          <span>Tipo</span>
          <InlineField
            value={details.armorType ?? ''}
            mode="select"
            options={ARMOR_TYPES}
            ariaLabel="Tipo da armadura"
            onCommit={(value) => onPatchDetails({ armorType: value || undefined })}
          />
          <span className="field-hint">leve soma a DES · média no máximo +2 · pesada sem DES</span>
        </label>

        <label className="field">
          <span>CA base</span>
          <InlineField
            value={details.baseArmorClass ?? 0}
            mode="number"
            min={0}
            max={30}
            ariaLabel="CA base da armadura"
            onCommit={(value) => onPatchDetails({ baseArmorClass: clampInt(value, 0, 30, 0) })}
          />
          <span className="field-hint">ex.: couro 11 · gibão de peles 12 · cota de malha 16</span>
        </label>

        <label className="field">
          <span>Bônus mágico de CA</span>
          <InlineField
            value={details.armorClassBonus ?? 0}
            mode="number"
            min={-10}
            max={30}
            ariaLabel="Bônus mágico de CA"
            onCommit={(value) => onPatchDetails({ armorClassBonus: clampInt(value, -10, 30, 0) })}
          />
          <span className="field-hint">armadura mágica (+1, +2...) some ao total</span>
        </label>
      </div>
    );
  }

  if (item.category === 'Escudo') {
    return (
      <div className="grid grid-3">
        <label className="field">
          <span>Bônus de CA</span>
          <InlineField
            value={details.armorClassBonus ?? 0}
            mode="number"
            min={-10}
            max={30}
            ariaLabel="Bônus de CA"
            onCommit={(value) => onPatchDetails({ armorClassBonus: clampInt(value, -10, 30, 0) })}
          />
          <span className="field-hint">soma à CA enquanto o escudo estiver equipado</span>
        </label>
      </div>
    );
  }

  if (item.category === 'Poção') {
    // Poção de Cura: a rolagem de texto livre dá lugar à cura ESTRUTURADA
    // (o uso do item rola e aplica na ficha). As demais finalidades seguem com
    // `effectRoll`/`duration` como texto livre.
    const isHealing = details.potionCategory === 'healing';
    const healing = details.healingDice ?? { count: 1, sides: 8, bonus: 0 };
    const patchHealing = (patch: Partial<typeof healing>): void =>
      onPatchDetails({ healingDice: { ...healing, ...patch } });

    return (
      <div className="grid grid-3">
        {/* Classificação da finalidade: só a Poção tem este campo; é opcional
            (poções antigas seguem sem categoria). */}
        <label className="field">
          <span>Categoria da Poção</span>
          <InlineField
            value={details.potionCategory ?? ''}
            mode="select"
            options={POTION_CATEGORIES}
            optionLabels={POTION_CATEGORY_LABELS}
            ariaLabel="Categoria da poção"
            onCommit={(value) =>
              onPatchDetails({
                potionCategory: (value || undefined) as PotionCategory | undefined,
              })
            }
          />
          <span className="field-hint">a finalidade da poção (classificação manual)</span>
        </label>
        {isHealing ? (
          <>
            <label className="field">
              <span>Dado de cura</span>
              <InlineField
                value={String(healing.sides)}
                mode="select"
                options={HEALING_DICE_SIDES.map(String)}
                optionLabels={HEALING_DIE_LABELS}
                ariaLabel="Dado de cura da poção"
                onCommit={(value) => patchHealing({ sides: Number(value) || healing.sides })}
              />
              <span className="field-hint">faces do dado rolado na cura</span>
            </label>
            <label className="field">
              <span>Quantidade</span>
              <InlineField
                value={healing.count}
                mode="number"
                min={1}
                max={10}
                ariaLabel="Quantidade de dados de cura"
                onCommit={(value) => patchHealing({ count: clampInt(value, 1, 10, 1) })}
              />
              <span className="field-hint">quantos dados de cura (1 a 10)</span>
            </label>
            <label className="field">
              <span>Bônus</span>
              <InlineField
                value={healing.bonus}
                mode="number"
                min={0}
                max={20}
                ariaLabel="Bônus de cura"
                onCommit={(value) => patchHealing({ bonus: clampInt(value, 0, 20, 0) })}
              />
              <span className="field-hint">bônus fixo somado à cura (0 a 20)</span>
            </label>
          </>
        ) : (
          <label className="field">
            <span>Rolagem do efeito</span>
            <InlineField
              value={details.effectRoll ?? ''}
              placeholder="ex.: 2d4+2"
              ariaLabel="Rolagem do efeito da poção"
              onCommit={(value) => onPatchDetails({ effectRoll: value.trim() })}
            />
          </label>
        )}
        <label className="field">
          <span>Duração</span>
          <InlineField
            value={details.duration ?? ''}
            placeholder="ex.: 1 hora"
            ariaLabel="Duração da poção"
            onCommit={(value) => onPatchDetails({ duration: value.trim() })}
          />
        </label>
      </div>
    );
  }

  if (item.category === 'Anel') {
    return (
      <div className="grid grid-3">
        <label className="field">
          <span>Rolagem do efeito</span>
          <InlineField
            value={details.effectRoll ?? ''}
            placeholder="ex.: 1d6"
            ariaLabel="Rolagem do efeito do anel"
            onCommit={(value) => onPatchDetails({ effectRoll: value.trim() })}
          />
        </label>
      </div>
    );
  }

  // Item Geral / Outro: o mestre pode marcar o item como CONSUMÍVEL (aí ele
  // ganha o botão "Usar" na ficha do jogador) e dar uma rolagem de efeito.
  if (item.category === 'Item Geral' || item.category === 'Outro') {
    return (
      <div className="grid grid-3">
        <label className="field">
          <span>Rolagem do efeito</span>
          <InlineField
            value={details.effectRoll ?? ''}
            placeholder="ex.: 2d4+2"
            ariaLabel="Rolagem do efeito do item"
            onCommit={(value) => onPatchDetails({ effectRoll: value.trim() })}
          />
        </label>
        <label className="field field-check">
          <span>Consumível (usável)</span>
          <input
            type="checkbox"
            checked={Boolean(details.consumable)}
            aria-label="Item consumível"
            onChange={(event) => onPatchDetails({ consumable: event.target.checked })}
          />
        </label>
      </div>
    );
  }

  return <p className="section-note">Esta categoria não tem atributos especiais além do preço.</p>;
}

/**
 * Editor de um item: identidade, atributos por categoria, preço e sprite.
 *
 * A ENTREGA ao jogador saiu daqui: virou ação contextual do modal do item
 * (`ItemDeliverDialog`), para o mestre entregar sem entrar no modo de edição.
 */
export function ItemEditor({ item, weapons, onPatch, onDelete, embedded = false }: ItemEditorProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patchDetails(patch: ItemDetails): void {
    onPatch({ details: { ...item.details, ...patch } });
  }

  function patchPrice(patch: Partial<ItemPrice>): void {
    const base = item.price ?? { gold: 0, silver: 0, copper: 0 };
    onPatch({ price: { ...base, ...patch } });
  }

  async function handleFile(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const payload = await fileToImagePayload(file);
      const image = await uploadImage(payload.dataUrl, payload.name, 'items');
      onPatch({ imageUrl: image.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar a imagem.');
    } finally {
      setUploading(false);
    }
  }

  const price = item.price ?? { gold: 0, silver: 0, copper: 0 };

  return (
    <div className="creature-editor item-editor">
      {embedded ? null : (
        <div className="detail-head">
          <h2>
            <Portrait src={item.imageUrl} alt={item.name} icon="flask" />
            {item.name}
          </h2>
          <button type="button" className="btn btn-danger btn-small" onClick={onDelete}>
            remover item
          </button>
        </div>
      )}

      <Section title="Identidade do item" icon="scroll">
        {/* Linha 1 — Nome e categoria em destaque: o que o item É. */}
        <div className="grid item-editor-identity">
          <label className="field">
            <span>Nome</span>
            <InlineField
              value={item.name}
              ariaLabel="Nome do item"
              onCommit={(value) => {
                const name = value.trim();
                if (name) onPatch({ name });
              }}
            />
          </label>

          <label className="field">
            <span>Categoria</span>
            <InlineField
              value={item.category}
              mode="select"
              options={[...ITEM_CATEGORIES]}
              optionLabels={ITEM_CATEGORY_LABELS}
              ariaLabel="Categoria do item"
              onCommit={(value) => {
                const patch: ItemPatch = {
                  category: value as ItemPatch['category'],
                  details: {},
                };
                // Entrar na categoria de acampamento exige um valor por unidade:
                // já sugere 1 para o item não ficar inválido (o mestre ajusta).
                if (value === 'CAMP_SUPPLY' && (item.campSupply?.value ?? 0) <= 0) {
                  patch.campSupply = { value: 1 };
                }
                onPatch(patch);
              }}
            />
          </label>
        </div>

        {/* Linha 2 — peso, raridade e sintonização. Raridade e sintonização são
            propriedades do ITEM, independentes da categoria e uma da outra
            (nada é inferido automaticamente); o helper fica discreto. */}
        <div className="grid item-editor-traits">
          <label className="field">
            <span>Peso (kg)</span>
            <InlineField
              value={item.weight}
              mode="number"
              min={0}
              ariaLabel="Peso do item"
              onCommit={(value) => onPatch({ weight: clampFloat(value, 0, 100000, item.weight) })}
            />
          </label>

          <label className="field">
            <span>Raridade</span>
            <InlineField
              value={item.rarity ?? ''}
              mode="select"
              options={ITEM_RARITIES}
              optionLabels={ITEM_RARITY_LABELS}
              ariaLabel="Raridade do item"
              onCommit={(value) => onPatch({ rarity: (value || null) as ItemRarity | null })}
            />
          </label>

          <label className="field item-editor-attune">
            <span>Requer sintonização</span>
            <span className="item-editor-attune-box">
              <input
                type="checkbox"
                checked={item.requiresAttunement}
                aria-label="Requer sintonização"
                onChange={(event) => onPatch({ requiresAttunement: event.target.checked })}
              />
              <span className="item-editor-attune-state">
                {item.requiresAttunement ? 'Sim' : 'Não'}
              </span>
            </span>
            <span className="field-hint">propriedade manual do mestre</span>
          </label>
        </div>

        {/* Linha 3 — descrição em largura inteira, com cara de textarea. */}
        <h3 className="subsection-title">Descrição</h3>
        <InlineField
          className="item-editor-desc"
          value={item.description}
          mode="textarea"
          ariaLabel="Descrição do item"
          placeholder="Propriedades, efeitos, história..."
          onCommit={(value) => onPatch({ description: value })}
        />
      </Section>

      <Section
        title={`Atributos — ${categoryLabel(item.category)}`}
        icon="sword"
        subtitle="Os campos mudam conforme a categoria escolhida"
      >
        <CategoryFields
          item={item}
          weapons={weapons}
          onPatchDetails={patchDetails}
          onCampSupplyValue={(value) => onPatch({ campSupply: { value } })}
        />
      </Section>

      {/* Economia e Sprite lado a lado no desktop: juntos, ocupam a altura de
          um único bloco e fecham o editor. */}
      <div className="item-editor-economy">
        <Section title="Valor" icon="crown">
          <div className="grid item-editor-price">
            <label className="field">
              <span>PO (ouro)</span>
              <InlineField
                value={price.gold}
                mode="number"
                min={0}
                ariaLabel="Preço em peças de ouro"
                onCommit={(value) => patchPrice({ gold: clampInt(value, 0, 9_999_999, price.gold) })}
              />
            </label>
            <label className="field">
              <span>PP (prata)</span>
              <InlineField
                value={price.silver}
                mode="number"
                min={0}
                ariaLabel="Preço em peças de prata"
                onCommit={(value) =>
                  patchPrice({ silver: clampInt(value, 0, 9_999_999, price.silver) })
                }
              />
            </label>
            <label className="field">
              <span>PC (cobre)</span>
              <InlineField
                value={price.copper}
                mode="number"
                min={0}
                ariaLabel="Preço em peças de cobre"
                onCommit={(value) =>
                  patchPrice({ copper: clampInt(value, 0, 9_999_999, price.copper) })
                }
              />
            </label>
          </div>

          <p className="item-editor-value-note">
            <Icon name="eye" size={13} />
            Visível apenas para o mestre.
          </p>
        </Section>

        <Section title="Sprite" icon="star">
          <div className="item-editor-sprite">
            <span
              className={
                item.imageUrl ? 'item-editor-sprite-preview' : 'item-editor-sprite-preview is-empty'
              }
              aria-hidden={item.imageUrl ? undefined : 'true'}
            >
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.name} />
              ) : (
                <Icon name="flask" size={40} />
              )}
            </span>

            <div className="item-editor-sprite-actions">
              <div className="toolbar">
                <label
                  className={
                    uploading ? 'btn btn-small file-btn disabled' : 'btn btn-small file-btn'
                  }
                >
                  {uploading ? 'enviando...' : item.imageUrl ? 'trocar sprite' : '+ adicionar sprite'}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={uploading}
                    onChange={(event) => {
                      void handleFile(event.target.files);
                      event.target.value = '';
                    }}
                  />
                </label>
                {item.imageUrl ? (
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => onPatch({ imageUrl: '' })}
                  >
                    remover sprite
                  </button>
                ) : null}
              </div>
              <span className="field-hint">PNG, JPEG, WEBP ou GIF · até 5 MB</span>
              {error ? <p className="form-error">{error}</p> : null}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
