import { useState } from 'react';
import { Icon } from '../../components/Icon';
import type { ConditionEffects, MechanicalEntity, MechanicalState } from '../../types';

export interface ConditionSourceChoice {
  entity: MechanicalEntity;
  name: string;
}

/**
 * CONDIÇÕES — ferramenta compacta do Mestre dentro de "Estado e ajustes".
 *
 * NÃO é uma engine nova: aplica/remove pelo MESMO domínio (`/api/mechanical/
 * mutate`), cria uma INSTÂNCIA por aplicação (múltiplas fontes continuam
 * valendo) e respeita o estado derivado do ciclo de morte.
 *
 * • `+ Adicionar condição` abre um seletor compacto com busca (as 14 do PHB
 *   2014; Exaustão fica de fora — tem controles próprios).
 * • Charmed/Frightened/Grappled podem receber uma criatura FONTE opcional;
 *   sem fonte, a instância é do Mestre e nada é inventado.
 * • Condições derivadas (0 PV) aparecem com a origem e o cadeado: remover fica
 *   indisponível, porque quem manda nelas é o lifecycle, não este painel.
 */
export function MasterConditionsPanel({
  name,
  state,
  effects,
  protectedInstanceIds = [],
  sources = [],
  busy,
  onApply,
  onRemove,
}: {
  /** Nome do combatente selecionado — evita aplicar no alvo errado. */
  name: string;
  state: MechanicalState;
  effects: ConditionEffects;
  /** Derivadas de outro estado (0 PV): remoção manual bloqueada. */
  protectedInstanceIds?: string[];
  sources?: ConditionSourceChoice[];
  busy: boolean;
  onApply: (condition: string, source: ConditionSourceChoice | null) => void;
  onRemove: (instanceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [sourceKey, setSourceKey] = useState('');
  const protectedSet = new Set(protectedInstanceIds);

  // Catálogo do SERVIDOR (labels), sem lista paralela. Exaustão não está nele.
  const catalog = Object.entries(effects.labels);
  const term = query.trim().toLowerCase();
  const filtered = term
    ? catalog.filter(([, label]) => label.toLowerCase().includes(term))
    : catalog;
  const selectedSource =
    sources.find((choice) => `${choice.entity.kind}:${choice.entity.id}` === sourceKey) ?? null;

  function apply(condition: string): void {
    onApply(condition, selectedSource);
    // Fecha o seletor: um clique = uma instância (sem aplicação dupla acidental).
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="master-conditions">
      <div className="master-conditions-head">
        <span className="master-conditions-title">
          <Icon name="flame" size={13} /> Condições — {name}
        </span>
        <button
          type="button"
          className="btn btn-small master-conditions-add"
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={busy}
          onClick={() => {
            setOpen((value) => !value);
            setQuery('');
          }}
        >
          <Icon name="plus" size={13} /> Adicionar condição
        </button>
      </div>

      {open ? (
        <div className="condition-picker" role="dialog" aria-label={`Adicionar condição em ${name}`}>
          <div className="condition-picker-search">
            <Icon name="search" size={13} />
            <input
              type="search"
              aria-label="Buscar condição"
              placeholder="Buscar condição..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {sources.length > 0 ? (
            <label className="condition-picker-source">
              <span>Fonte (opcional)</span>
              <select value={sourceKey} onChange={(event) => setSourceKey(event.target.value)}>
                <option value="">Sem fonte vinculada (Mestre)</option>
                {sources.map((choice) => (
                  <option
                    key={`${choice.entity.kind}:${choice.entity.id}`}
                    value={`${choice.entity.kind}:${choice.entity.id}`}
                  >
                    {choice.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="condition-picker-list">
            {filtered.map(([condition, label]) => (
              <button
                key={condition}
                type="button"
                className="condition-picker-option"
                disabled={busy}
                title={`Aplicar ${label}${selectedSource ? ` — fonte ${selectedSource.name}` : ''}`}
                onClick={() => apply(condition)}
              >
                {label}
              </button>
            ))}
            {filtered.length === 0 ? (
              <p className="field-hint">Nenhuma condição com esse nome.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {state.conditions.length === 0 ? (
        <p className="field-hint">Nenhuma condição ativa.</p>
      ) : (
        <ul className="master-conditions-list">
          {state.conditions.map((instance) => {
            const label = effects.labels[instance.condition] ?? instance.condition;
            const derived = protectedSet.has(instance.id);
            const origin = derived ? '0 PV' : (instance.sourceLabel ?? 'Mestre');
            return (
              <li className="master-condition-row" key={instance.id} data-condition={instance.condition}>
                <span className="master-condition-name">{label}</span>
                <span className="master-condition-origin" title={derived ? 'Mantida pelo ciclo de 0 PV' : undefined}>
                  Origem: {origin}
                </span>
                {derived ? (
                  <span
                    className="master-condition-lock"
                    role="img"
                    aria-label="Condição derivada: não pode ser removida diretamente"
                    title="Esta condição é mantida por outro estado e não pode ser removida diretamente."
                  >
                    <Icon name="shield" size={12} />
                  </span>
                ) : (
                  <button
                    type="button"
                    className="master-condition-remove"
                    disabled={busy}
                    aria-label={`Remover ${label} (${origin})`}
                    title={`Remover esta fonte de ${label}`}
                    onClick={() => onRemove(instance.id)}
                  >
                    <Icon name="x" size={12} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
