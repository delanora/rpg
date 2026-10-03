import { useState } from 'react';
import { ABILITY_KEYS, ABILITY_LABELS, EXPERTISE_TOOL_PREFIX } from '../../dnd';
import type { AbilityKey } from '../../types';
import { EXPERTISE_TOOLTIP, ExpertiseLaurel } from '../ExpertiseLaurel';
import { Icon } from '../Icon';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

/**
 * Normaliza um rótulo para casar ferramenta × Expertise: minúsculas, sem acento
 * e sem espaços nas pontas. O catálogo grafa "Ferramentas de Ladrão" e a
 * Expertise guarda o rótulo de texto livre ("Ferramentas de ladrão") — sem isso
 * o selo nunca acharia a ferramenta.
 */
function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** "1d20+5" — o total que o teste de ferramenta vai usar (atributo + perícia). */
function formatModifier(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

/**
 * Ferramentas e Proficiências: cada ferramenta em que o personagem tem
 * proficiência simples (`toolProficiencies`), já resolvida pelo catálogo do
 * servidor (nome + categoria + atributo sugerido).
 *
 * Ferramenta NÃO tem atributo fixo, então não vive nos seis cards; o jogador
 * escolhe o atributo do teste (o sugerido já vem selecionado) e o botão abre a
 * MESMA janela de dados das perícias, com o bônus pronto. Sem permissão de
 * rolagem (visão do mestre), a linha fica só de leitura, sem o botão.
 */
export function ToolsSection({ character, onRoll }: SheetSectionProps & {
  onRoll?: (input: { kind: 'skill' | 'save'; label: string; bonus: number }) => void;
}) {
  const { derived } = character;

  // Ferramentas em Expertise: as chaves `tool:<rótulo>` do personagem, já
  // normalizadas para casar com o nome do catálogo (id → namePt).
  const expertisedTools = new Set(
    character.expertiseSkills
      .filter((key) => key.startsWith(EXPERTISE_TOOL_PREFIX))
      .map((key) => normalizeLabel(key.slice(EXPERTISE_TOOL_PREFIX.length))),
  );

  // Atributo escolhido no teste, por ferramenta (o sugerido entra selecionado).
  const [abilities, setAbilities] = useState<Record<string, AbilityKey>>({});

  function abilityFor(id: string, fallback: AbilityKey | null): AbilityKey {
    return abilities[id] ?? fallback ?? 'intelligence';
  }

  return (
    <Section
      title="Ferramentas e Proficiências"
      icon="gear"
      subtitle="Proficiência em ferramentas e testes de ferramenta"
    >
      {character.tools.length === 0 ? (
        <p className="empty-hint">Nenhuma ferramenta com proficiência.</p>
      ) : (
        <ul className="tool-list">
          {character.tools.map((tool) => {
            const isExpertise = expertisedTools.has(normalizeLabel(tool.name));
            const ability = abilityFor(tool.id, tool.defaultAbility);
            // Proficiência simples + o atributo escolhido; em Expertise o bônus
            // de proficiência dobra (mesma regra das perícias).
            const bonus =
              (derived.modifiers[ability] ?? 0) +
              derived.proficiencyBonus * (isExpertise ? 2 : 1);

            return (
              <li className="tool-line" key={tool.id}>
                <span className="tool-line-name">
                  {tool.name}
                  {isExpertise ? <ExpertiseLaurel /> : null}
                </span>
                <span className="tool-line-category">{tool.categoryLabel}</span>
                <span className="tool-line-bonus">{formatModifier(bonus)}</span>
                {onRoll ? (
                  <>
                    <select
                      className="tool-line-ability"
                      value={ability}
                      aria-label={`Atributo do teste de ${tool.name}`}
                      onChange={(event) =>
                        setAbilities((current) => ({
                          ...current,
                          [tool.id]: event.target.value as AbilityKey,
                        }))
                      }
                    >
                      {ABILITY_KEYS.map((key) => (
                        <option key={key} value={key}>
                          {ABILITY_LABELS[key]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="prof-roll"
                      aria-label={`Rolar teste de ${tool.name}`}
                      title={isExpertise ? EXPERTISE_TOOLTIP : 'Rolar teste de ferramenta'}
                      onClick={() =>
                        onRoll({
                          kind: 'skill',
                          label: `${tool.name} (${ABILITY_LABELS[ability]})`,
                          bonus,
                        })
                      }
                    >
                      <Icon name="die" size={13} />
                    </button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
