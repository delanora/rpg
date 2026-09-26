import { FEATURE_SOURCES, FEATURE_SOURCE_LABELS } from '../../dnd';
import { useReadOnly } from '../../readonly';
import type { Feature, FeatureSource } from '../../types';
import { newId } from '../../utils';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

export function FeaturesSection({ character, update }: SheetSectionProps) {
  const readOnly = useReadOnly();
  const features = character.features;

  function patchFeature(id: string, patch: Partial<Feature>): void {
    update({
      features: features.map((feature) => (feature.id === id ? { ...feature, ...patch } : feature)),
    });
  }

  function addFeature(): void {
    update({
      features: [
        ...features,
        { id: newId(), name: 'Nova característica', source: 'class', description: '' },
      ],
    });
  }

  function removeFeature(id: string): void {
    update({ features: features.filter((feature) => feature.id !== id) });
  }

  const sourceLabels = FEATURE_SOURCES.map((source) => FEATURE_SOURCE_LABELS[source]);

  function sourceFromLabel(label: string): FeatureSource {
    const found = FEATURE_SOURCES.find((source) => FEATURE_SOURCE_LABELS[source] === label);
    return found ?? 'other';
  }

  return (
    <Section
      title="Características"
      icon="book"
      subtitle="Traços de raça, classe, antecedente e talentos"
      actions={
        readOnly ? undefined : (
          <button type="button" className="btn btn-small" onClick={addFeature}>
            + característica
          </button>
        )
      }
    >
      {character.activeFeatures.length > 0 ? (
        <>
          <h3 className="subsection-title">Características de Classe</h3>
          <div className="feature-list">
            {character.activeFeatures.map((feature) => (
              <article
                className="feature-card feature-card-static"
                key={`${feature.source}-${feature.id}`}
              >
                <div className="feature-head">
                  <span className="feature-name">{feature.name}</span>
                  <em className="tag">
                    {feature.source === 'subclass' ? 'subclasse' : 'classe'} · nv {feature.level}
                  </em>
                </div>
                <p className="feature-desc">{feature.description}</p>
              </article>
            ))}
          </div>

          <h3 className="subsection-title">Minhas características</h3>
        </>
      ) : null}

      {features.length === 0 ? (
        <p className="empty-hint">Nenhuma característica cadastrada.</p>
      ) : (
        <div className="feature-list">
          {features.map((feature) => (
            <article className="feature-card" key={feature.id}>
              <div className="feature-head">
                <InlineField
                  value={feature.name}
                  ariaLabel="Nome da característica"
                  onCommit={(value) => {
                    const name = value.trim();
                    if (name) patchFeature(feature.id, { name });
                  }}
                />
                <InlineField
                  value={FEATURE_SOURCE_LABELS[feature.source]}
                  mode="select"
                  options={sourceLabels}
                  ariaLabel="Origem da característica"
                  onCommit={(value) => patchFeature(feature.id, { source: sourceFromLabel(value) })}
                />
                {readOnly ? null : (
                  <button
                    type="button"
                    className="btn btn-danger btn-small"
                    onClick={() => removeFeature(feature.id)}
                    aria-label={`Remover ${feature.name}`}
                  >
                    ×
                  </button>
                )}
              </div>
              <InlineField
                value={feature.description}
                mode="textarea"
                placeholder="Descreva o efeito..."
                ariaLabel="Descrição da característica"
                onCommit={(value) => patchFeature(feature.id, { description: value })}
              />
            </article>
          ))}
        </div>
      )}
    </Section>
  );
}
