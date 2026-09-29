import { FEATURE_SOURCES, FEATURE_SOURCE_LABELS } from '../../dnd';
import { useSheetAccess } from '../../readonly';
import type { ActiveClassFeature, Feature, FeatureSource } from '../../types';
import { newId } from '../../utils';
import { choiceInfoOf, FeatureChoiceField } from '../FeatureChoiceField';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import type { SheetSectionProps } from './common';

export function FeaturesSection({ character, update }: SheetSectionProps) {
  // Características (inclusive os talentos) são construção: com a criação
  // finalizada elas só mudam pelo Level Up ou pelo mestre.
  const { lockedConstruction } = useSheetAccess();
  const readOnly = lockedConstruction;
  const choices = character.classState.choices;

  /**
   * Escolha de uma característica de classe (Estilo de Luta, Inimigo Favorito):
   * o jogador com a criação finalizada só VÊ — quem muda é o mestre.
   */
  function setChoice(featureId: string, keys: string[]): void {
    update({
      classState: {
        ...character.classState,
        choices: { ...choices, [featureId]: keys.filter(Boolean) },
      },
    });
  }
  const features = character.features;
  // Talentos escolhidos no Level Up ficam registrados aqui (source: 'feat') e
  // ganham uma subseção própria; a lista editável mostra o resto.
  const feats = features.filter((feature) => feature.source === 'feat');
  const otherFeatures = features.filter((feature) => feature.source !== 'feat');

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
      {feats.length > 0 ? (
        <>
          <h3 className="subsection-title">Talentos</h3>
          <div className="feature-list">
            {feats.map((feat) => (
              <article className="feature-card" key={feat.id}>
                <div className="feature-head">
                  <InlineField
                    value={feat.name}
                    readOnly={readOnly}
                    ariaLabel="Nome do talento"
                    onCommit={(value) => {
                      const name = value.trim();
                      if (name) patchFeature(feat.id, { name });
                    }}
                  />
                  <em className="tag">talento</em>
                </div>
                <InlineField
                  value={feat.description}
                  mode="textarea"
                  readOnly={readOnly}
                  placeholder="Descreva o efeito..."
                  ariaLabel="Descrição do talento"
                  onCommit={(value) => patchFeature(feat.id, { description: value })}
                />
              </article>
            ))}
          </div>
        </>
      ) : null}

      {character.activeFeatures.length > 0 ? (
        <>
          <h3 className="subsection-title">Características de Classe</h3>
          <div className="feature-list">
            {character.activeFeatures.map((feature) => (
              <FeatureCard
                key={`${feature.classKey ?? ''}-${feature.source}-${feature.id}`}
                feature={feature}
                chosen={choices[feature.id] ?? []}
                readOnly={readOnly}
                onChoice={(keys) => setChoice(feature.id, keys)}
              />
            ))}
          </div>

          <h3 className="subsection-title">Minhas características</h3>
        </>
      ) : null}

      {otherFeatures.length === 0 ? (
        <p className="empty-hint">Nenhuma característica cadastrada.</p>
      ) : (
        <div className="feature-list">
          {otherFeatures.map((feature) => (
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

/**
 * Característica de classe já liberada. Quando ela PEDE escolha (Estilo de
 * Luta, Inimigo Favorito), a escolha aparece aqui: em leitura para o jogador
 * com a criação finalizada e editável para o mestre (e durante a criação).
 */
function FeatureCard({
  feature,
  chosen,
  readOnly,
  onChoice,
}: {
  feature: ActiveClassFeature;
  chosen: string[];
  readOnly: boolean;
  onChoice: (keys: string[]) => void;
}) {
  const info = choiceInfoOf(feature, chosen);

  return (
    <article className="feature-card">
      <div className="feature-head">
        <span className="feature-name">{feature.name}</span>
        <em className="tag">
          {feature.source === 'subclass' ? 'subclasse' : 'classe'} · nv {feature.level}
        </em>
      </div>
      <p className="feature-desc">{feature.description}</p>
      {info ? (
        <div className="feature-choice">
          {readOnly ? (
            <p className="section-note">
              {info.prompt}:{' '}
              <strong>
                {info.options
                  .filter((option) => chosen.includes(option.key))
                  .map((option) => option.name)
                  .join(', ') || '— não escolhido —'}
              </strong>
            </p>
          ) : (
            <FeatureChoiceField
              info={{ ...info, chosen }}
              values={chosen}
              onChange={onChoice}
            />
          )}
        </div>
      ) : null}
    </article>
  );
}
