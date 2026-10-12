import { useState } from 'react';
import { buildResourceGroups, type DisplayedResource } from '../../resourceDisplay';
import { useSheetAccess } from '../../readonly';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

/**
 * Área "Recursos do Personagem" (5.3E.2).
 *
 * Reúne visualmente os recursos de CLASSE e de RAÇA, agrupados por ORIGEM, sem
 * misturar as fontes de verdade: cada recurso continua vindo do próprio pipeline
 * (`classAdjustments.resources` / `racialAdjustments.resources`). A informação
 * principal é `remaining / max` (nunca `used`) e a recarga aparece em linguagem
 * humana — o jogador responde "o que tenho, quantos usos, de onde vem, quando
 * recupera" num só lugar, sem ids técnicos.
 *
 * Só aparecem BOTÕES quando existe uma ação real implementada (hoje: a Arma de
 * Sopro e a Resistência Implacável, ambas server-authoritative). As magias
 * raciais limitadas continuam acionadas na aba Magias — o card aqui só mostra o
 * contador, para não duplicar o mesmo uso em dois lugares.
 */
interface ResourcesSectionProps extends SheetSectionProps {
  /**
   * Uso de um recurso RACIAL limitado no SERVIDOR (5.3E.1/5.3E.2): o servidor
   * deriva a posse, o máximo e a recarga. Sem esta prop os recursos só aparecem.
   */
  onRacialUse?: (resourceId: string, expectedVersion: number) => void | Promise<void>;
}

export function ResourcesSection({ character, onRacialUse }: ResourcesSectionProps) {
  const { readOnly } = useSheetAccess();
  /** Recurso racial com requisição em andamento (bloqueia o duplo clique). */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = buildResourceGroups(character);
  // Sem recursos limitados a área some por completo (nada de seção vazia).
  if (groups.length === 0) return null;

  const hasRaceGroup = groups.some((group) => group.origin === 'race');

  async function requestUse(resource: DisplayedResource): Promise<void> {
    if (!onRacialUse || pending !== null) return;
    setPending(resource.id);
    setError(null);
    try {
      await onRacialUse(resource.id, character.version);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível usar o recurso.');
    } finally {
      setPending(null);
    }
  }

  return (
    <Section title="Recursos do Personagem" icon="star" subtitle="Classe e raça">
      <div className="resource-groups">
        {groups.map((group) => (
          <section className="resource-group" key={group.origin}>
            {/* Hierarquia por título/divisor leve — sem caixa dentro de caixa. */}
            <h3 className="resource-group-title">{group.label}</h3>
            <div className="resource-grid">
              {group.resources.map((resource) => {
                const empty = !resource.unlimited && resource.remaining <= 0;
                const busy = pending === resource.id;
                return (
                  <article
                    className={`resource-card${empty ? ' is-empty' : ''}`}
                    key={resource.id}
                  >
                    <div className="resource-card-head">
                      <span className="resource-name" title={resource.notes ?? undefined}>
                        {resource.name}
                      </span>
                      <span className="resource-origin">{resource.originLabel}</span>
                    </div>

                    <div className="resource-card-body">
                      <span className="resource-count">
                        {resource.unlimited ? '∞' : `${resource.remaining} / ${resource.max}`}
                      </span>
                      {resource.rechargeLabel ? (
                        <span className="resource-recharge">{resource.rechargeLabel}</span>
                      ) : null}
                    </div>

                    {/* Estado em texto (não depende só de cor) para acessibilidade. */}
                    {empty ? (
                      <span className="resource-status">
                        {resource.rechargeLabel
                          ? `Indisponível · recupera em ${resource.rechargeLabel.toLowerCase()}`
                          : 'Indisponível'}
                      </span>
                    ) : null}

                    {resource.action && onRacialUse ? (
                      <button
                        type="button"
                        className="btn btn-small btn-primary resource-action"
                        disabled={readOnly || busy || empty}
                        aria-disabled={readOnly || busy || empty}
                        title={
                          empty
                            ? `${resource.name} já foi usado; recupera no descanso.`
                            : resource.action.label
                        }
                        onClick={() => {
                          void requestUse(resource);
                        }}
                      >
                        {busy ? '…' : resource.action.label}
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {hasRaceGroup ? (
        <p className="section-note">
          Dano, alcance, CD e salvaguarda dos recursos raciais são resolvidos manualmente nesta
          fase — o sistema controla a disponibilidade e o consumo.
        </p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </Section>
  );
}
