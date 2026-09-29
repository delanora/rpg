import type { ActiveClassFeature, FeatureChoiceInfo } from '../types';

/**
 * Seletor de uma escolha de característica de classe (Estilo de Luta, Inimigo
 * Favorito, Explorador Nato).
 *
 * `count` seletores, um por escolha. Quando a característica não permite
 * repetição, a opção já usada nos outros seletores fica desabilitada — o
 * servidor também recusa (`resolveFeatureChoices`).
 */
export function FeatureChoiceField({
  info,
  values,
  disabled = false,
  onChange,
}: {
  info: FeatureChoiceInfo;
  /** Opções escolhidas (faltando = '' no seletor). */
  values: string[];
  disabled?: boolean;
  onChange: (keys: string[]) => void;
}) {
  const current = Array.from({ length: info.count }, (_, index) => values[index] ?? '');

  function setAt(index: number, key: string): void {
    const next = [...current];
    next[index] = key;
    onChange(next);
  }

  return (
    <>
      <label className="field">
        <span>
          {info.prompt}
          {info.count > 1 ? ` (${info.count} escolhas)` : ''}
        </span>
        <select
          value={current[0] ?? ''}
          disabled={disabled}
          onChange={(event) => setAt(0, event.target.value)}
        >
          <option value="">— escolha —</option>
          {info.options.map((option) => (
            <option
              key={option.key}
              value={option.key}
              disabled={!info.allowRepeat && current.slice(1).includes(option.key)}
            >
              {option.name}
            </option>
          ))}
        </select>
      </label>

      {Array.from({ length: Math.max(0, info.count - 1) }, (_, index) => (
        <label className="field" key={index}>
          <span>
            {info.prompt} ({index + 2})
          </span>
          <select
            value={current[index + 1] ?? ''}
            disabled={disabled}
            onChange={(event) => setAt(index + 1, event.target.value)}
          >
            <option value="">— escolha —</option>
            {info.options.map((option) => (
              <option
                key={option.key}
                value={option.key}
                disabled={
                  !info.allowRepeat &&
                  current.some((key, other) => other !== index + 1 && key === option.key)
                }
              >
                {option.name}
              </option>
            ))}
          </select>
        </label>
      ))}

      <p className="section-note">{optionHints(info, current)}</p>
    </>
  );
}

/**
 * Explica a opção escolhida AGORA nos seletores (e o que ela faz) — é o que dá
 * ao jogador a certeza do que a escolha muda na ficha.
 */
function optionHints(info: FeatureChoiceInfo, current: string[]): string {
  const chosen = info.options.filter((option) => current.includes(option.key));
  if (chosen.length === 0) {
    return `${info.name}: escolha ${info.count} ${info.count === 1 ? 'opção' : 'opções'}.`;
  }
  return chosen
    .map((option) => (option.description ? `${option.name} — ${option.description}` : option.name))
    .join(' · ');
}

/**
 * Converte a característica de classe (com a escolha declarada) para o formato
 * usado pelo seletor, com o que já está gravado em `classState.choices`.
 */
export function choiceInfoOf(
  feature: ActiveClassFeature,
  chosen: string[],
): FeatureChoiceInfo | null {
  if (!feature.choice) return null;
  return {
    featureId: feature.id,
    name: feature.name,
    prompt: feature.choice.prompt ?? feature.name,
    level: feature.choice.level ?? feature.level,
    count: Math.max(1, feature.choice.count ?? 1),
    allowRepeat: Boolean(feature.choice.allowRepeat),
    options: feature.choice.options.map((option) => ({
      key: option.key,
      name: option.name,
      description: option.description ?? '',
    })),
    chosen,
  };
}
