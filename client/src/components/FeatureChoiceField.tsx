import type { ActiveClassFeature, FeatureChoiceInfo } from '../types';

/**
 * Seletor de uma escolha de característica de classe (Estilo de Luta, Inimigo
 * Favorito, Metamagia).
 *
 * `count` listas, uma por escolha. Cada opção é um botão; a descrição do que ela
 * faz vive SÓ no tooltip (hover/foco), como nas demais informações da ficha —
 * nada de texto explicativo ocupando a ficha. Quando a característica não permite
 * repetição, a opção já usada nas outras listas fica desabilitada (o servidor
 * também recusa — `resolveFeatureChoices`).
 */
export function FeatureChoiceField({
  info,
  values,
  disabled = false,
  onChange,
}: {
  info: FeatureChoiceInfo;
  /** Opções escolhidas (faltando = '' na lista). */
  values: string[];
  disabled?: boolean;
  onChange: (keys: string[]) => void;
}) {
  const current = Array.from({ length: info.count }, (_, index) => values[index] ?? '');

  function toggle(index: number, key: string): void {
    const next = [...current];
    next[index] = next[index] === key ? '' : key;
    onChange(next);
  }

  return (
    <>
      {Array.from({ length: info.count }, (_, slot) => (
        <div className="field" key={slot}>
          <span>
            {info.prompt}
            {info.count > 1 ? ` (${slot + 1} de ${info.count})` : ''}
          </span>
          <div className="choice-options" role="radiogroup" aria-label={info.prompt}>
            {info.options.map((option) => {
              const selected = current[slot] === option.key;
              const taken =
                !info.allowRepeat &&
                current.some((key, other) => other !== slot && key === option.key);
              return (
                <span
                  className={`info-tip choice-tip${selected ? ' is-selected' : ''}`}
                  key={option.key}
                >
                  <button
                    type="button"
                    className="choice-option"
                    disabled={disabled || taken}
                    aria-pressed={selected}
                    onClick={() => toggle(slot, option.key)}
                  >
                    {option.name}
                  </button>
                  {option.description ? (
                    <span className="info-tip-text choice-option-tip" role="tooltip">
                      <strong>{option.name}</strong>
                      {option.description}
                    </span>
                  ) : null}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * Converte a característica de classe (com a escolha declarada) para o formato
 * usado pelo seletor, com o que já está gravado em `classState.choices`.
 *
 * `takenElsewhere` traz as opções já escolhidas em OUTRAS características desta
 * mesma classe: quando a escolha pede `excludeChosen` (Metamagia), elas saem da
 * lista — o mesmo que o servidor faz no DTO do Level Up.
 */
export function choiceInfoOf(
  feature: ActiveClassFeature,
  chosen: string[],
  takenElsewhere: readonly string[] = [],
): FeatureChoiceInfo | null {
  if (!feature.choice) return null;
  const excluded = feature.choice.excludeChosen ? new Set(takenElsewhere) : null;
  return {
    featureId: feature.id,
    name: feature.name,
    prompt: feature.choice.prompt ?? feature.name,
    level: feature.choice.level ?? feature.level,
    count: Math.max(1, feature.choice.count ?? 1),
    allowRepeat: Boolean(feature.choice.allowRepeat),
    options: feature.choice.options
      .filter((option) => !excluded?.has(option.key))
      .map((option) => ({
        key: option.key,
        name: option.name,
        description: option.description ?? '',
      })),
    chosen,
  };
}
