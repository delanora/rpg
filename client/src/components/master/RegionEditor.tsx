import { useState } from 'react';
import { fileToImagePayload, uploadImage } from '../../api';
import type {
  Creature,
  CreatureKind,
  Locality,
  LocalityPatch,
  Region,
  RegionPatch,
} from '../../types';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import { ImageGallery } from './ImageGallery';
import { LocalityCreatures } from './LocalityCreatures';
import { LocalityEditor } from './LocalityEditor';
import { LocalityScenes } from './LocalityScenes';
import './regions.css';

type WizardStep = 1 | 2 | 3 | 4;

/** Etapas do assistente, na ordem em que a região é montada. */
const STEPS: { id: WizardStep; label: string }[] = [
  { id: 1, label: 'Região' },
  { id: 2, label: 'Localidade' },
  { id: 3, label: 'Cenas' },
  { id: 4, label: 'Habitantes' },
];

const NEXT_LABELS: Record<WizardStep, string> = {
  1: 'continuar → localidades',
  2: 'continuar → cenas',
  3: 'continuar → habitantes',
  4: 'concluir',
};

interface RegionEditorProps {
  region: Region;
  /** Localidades dentro desta região (calculado pelo painel). */
  localities: Locality[];
  /** Criaturas/NPCs da mesa, para listar quem vive em cada localidade. */
  creatures: Creature[];
  onPatch: (patch: RegionPatch) => void;
  onDelete: () => void;
  onCreateLocality: () => Promise<Locality>;
  onPatchLocality: (id: string, patch: LocalityPatch) => void;
  onDeleteLocality: (id: string) => void;
  /** Abre a ficha da criatura no bestiário (troca de aba do painel). */
  onOpenCreature: (creature: Creature) => void;
  /** Cria criatura/NPC já vinculado à localidade e abre a ficha dele. */
  onCreateCreature: (localityId: string, kind: CreatureKind) => Promise<Creature>;
  /**
   * Montado dentro da janela flutuante do painel: o cabeçalho com o nome e o
   * botão de excluir mora no modal, então some daqui para não duplicar.
   */
  embedded?: boolean;
}

/**
 * ASSISTENTE DA REGIÃO — aba Regiões do painel do mestre.
 *
 * A ordem é fixa e sequencial: **Região → Localidade → Cenas → Habitantes**.
 * Antes tudo isso vivia empilhado dentro do editor da localidade (identidade,
 * imagens, cenas e criaturas na mesma rolagem), o que produzia o "encavalado"
 * de cards aninhados. Agora cada etapa ocupa a área sozinha e a trilha de
 * passos permite voltar a qualquer etapa já liberada.
 *
 * A trilha NÃO é um router: é estado local do editor. As etapas 3 e 4 só
 * existem depois que há uma localidade escolhida — não há cena nem habitante
 * solto na região, porque o domínio prende os dois à localidade
 * (`Scene.localityId` e `Creature.localities`).
 */
export function RegionEditor({
  region,
  localities,
  creatures,
  onPatch,
  onDelete,
  onCreateLocality,
  onPatchLocality,
  onDeleteLocality,
  onOpenCreature,
  onCreateCreature,
  embedded = false,
}: RegionEditorProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedLocalityId, setSelectedLocalityId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingLocality, setCreatingLocality] = useState(false);
  const [creatingKind, setCreatingKind] = useState<CreatureKind | null>(null);

  const selectedLocality =
    localities.find((locality) => locality.id === selectedLocalityId) ?? null;
  // Habitantes da LOCALIDADE aberta: a criatura pertence a uma ou mais
  // localidades e a região só é alcançada por essa relação.
  const localityCreatures = selectedLocality
    ? creatures.filter((creature) =>
        creature.localities.some((locality) => locality.id === selectedLocality.id),
      )
    : [];

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;

    setUploading(true);
    setError(null);
    try {
      const images = [...region.images];
      for (const file of Array.from(files)) {
        const payload = await fileToImagePayload(file);
        images.push(await uploadImage(payload.dataUrl, payload.name, 'localities'));
      }
      onPatch({ images });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar a imagem.');
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateLocality(): Promise<void> {
    setCreatingLocality(true);
    setError(null);
    try {
      const created = await onCreateLocality();
      setSelectedLocalityId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar a localidade.');
    } finally {
      setCreatingLocality(false);
    }
  }

  async function handleCreateCreature(kind: CreatureKind): Promise<void> {
    if (!selectedLocality) return;
    setCreatingKind(kind);
    setError(null);
    try {
      await onCreateCreature(selectedLocality.id, kind);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar o habitante.');
    } finally {
      setCreatingKind(null);
    }
  }

  /** Texto curto de cada etapa: o contexto do que está aberto agora. */
  function stepHint(id: WizardStep): string {
    if (id === 1) return `${localities.length} localidade(s)`;
    if (id === 2) return selectedLocality ? selectedLocality.name : 'nenhuma aberta';
    if (!selectedLocality) return 'requer localidade';
    if (id === 3) return selectedLocality.name;
    return `${localityCreatures.length} habitante(s)`;
  }

  function renderStep() {
    if (step === 1) {
      return (
        <>
          <Section title="Região" icon="scroll">
            <label className="field">
              <span>Nome</span>
              <InlineField
                value={region.name}
                ariaLabel="Nome da região"
                onCommit={(value) => {
                  const name = value.trim();
                  if (name) onPatch({ name });
                }}
              />
            </label>

            <h3 className="subsection-title">Descrição</h3>
            <InlineField
              value={region.description}
              mode="textarea"
              ariaLabel="Descrição da região"
              placeholder="Descreva o clima, a cultura, os perigos da região..."
              onCommit={(value) => onPatch({ description: value })}
            />
          </Section>

          <Section title="Anotações" icon="quill" subtitle="Só o mestre vê">
            <InlineField
              value={region.notes}
              mode="textarea"
              ariaLabel="Anotações da região"
              placeholder="Ganchos de aventura, segredos, o que está por vir..."
              onCommit={(value) => onPatch({ notes: value })}
            />
          </Section>

          <Section title="Imagens" icon="star" subtitle="PNG, JPEG, WEBP ou GIF · até 5 MB cada">
            <ImageGallery
              images={region.images}
              addLabel="+ adicionar imagens"
              uploading={uploading}
              error={error}
              altFallback={region.name}
              onAdd={(files) => void handleFiles(files)}
              onRemove={(url) =>
                onPatch({ images: region.images.filter((image) => image.url !== url) })
              }
            />
          </Section>
        </>
      );
    }

    if (step === 2) {
      if (selectedLocality) {
        return (
          <>
            <div className="wizard-inline-actions">
              <button
                type="button"
                className="btn btn-small"
                onClick={() => setSelectedLocalityId(null)}
              >
                ← trocar localidade
              </button>
              <span className="region-wizard-context">
                Identidade do lugar — cenas e habitantes vêm nas etapas seguintes.
              </span>
            </div>
            <LocalityEditor
              locality={selectedLocality}
              onPatch={(patch) => onPatchLocality(selectedLocality.id, patch)}
              onDelete={() => {
                onDeleteLocality(selectedLocality.id);
                setSelectedLocalityId(null);
              }}
            />
          </>
        );
      }

      return (
        <Section
          title="Localidades"
          icon="home"
          subtitle={`Lugares dentro de ${region.name} — cidades, masmorras, tavernas`}
          actions={
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={() => void handleCreateLocality()}
              disabled={creatingLocality}
            >
              {creatingLocality ? 'criando...' : '+ nova localidade'}
            </button>
          }
        >
          {error ? <p className="form-error">{error}</p> : null}
          {localities.length === 0 ? (
            <p className="empty-hint">
              Nenhuma localidade nesta região ainda. Crie a primeira para depois desenhar cenas e
              povoar o lugar com criaturas e NPCs.
            </p>
          ) : (
            <ul className="locality-cards locality-cards-grid">
              {localities.map((locality) => (
                <li key={locality.id}>
                  <button
                    type="button"
                    className="locality-card locality-card-lg"
                    onClick={() => setSelectedLocalityId(locality.id)}
                  >
                    <span className="locality-thumb">
                      {locality.images[0] ? (
                        <img src={locality.images[0].url} alt="" loading="lazy" />
                      ) : (
                        <Icon name="home" size={18} />
                      )}
                    </span>
                    <span className="locality-info">
                      <span className="card-name">{locality.name}</span>
                      <span className="card-line">{locality.creatureCount} habitante(s)</span>
                      {locality.description ? (
                        <span className="locality-desc">{locality.description}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      );
    }

    if (!selectedLocality) {
      return (
        <Section title="Escolha uma localidade" icon="info">
          <p className="empty-hint">
            Cenas e habitantes existem DENTRO de uma localidade. Volte uma etapa e escolha ou crie a
            localidade primeiro.
          </p>
          <div className="wizard-inline-actions">
            <button type="button" className="btn btn-small" onClick={() => setStep(2)}>
              ← ir para localidades
            </button>
          </div>
        </Section>
      );
    }

    if (step === 3) {
      return (
        <LocalityScenes
          localityId={selectedLocality.id}
          localityName={selectedLocality.name}
        />
      );
    }

    return (
      <LocalityCreatures
        creatures={localityCreatures}
        creating={creatingKind}
        onOpen={onOpenCreature}
        onCreate={(kind) => void handleCreateCreature(kind)}
      />
    );
  }

  const nextDisabled = step >= 2 && !selectedLocality;

  return (
    <div className="creature-editor region-wizard">
      {embedded ? null : (
        <div className="detail-head">
          <h2>
            <Icon name="scroll" size={22} /> {region.name}
          </h2>
          <button type="button" className="btn btn-danger btn-small" onClick={onDelete}>
            remover região
          </button>
        </div>
      )}

      <nav className="wizard-track wizard-track-region" aria-label="Etapas da região">
        {STEPS.map((item) => {
          const disabled = item.id >= 3 && !selectedLocality;
          const current = step === item.id;
          const done = step > item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`wizard-step-chip${current ? ' current' : ''}${done ? ' done' : ''}`}
              aria-current={current ? 'step' : undefined}
              disabled={disabled}
              title={disabled ? 'Escolha uma localidade primeiro' : item.label}
              onClick={() => setStep(item.id)}
            >
              <span className="wizard-step-number">
                {done ? <Icon name="check" size={12} /> : item.id}
              </span>
              <span className="wizard-step-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="wizard-step-body">{renderStep()}</div>

      <footer className="wizard-actions region-wizard-footer">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => setStep((previous) => (previous - 1) as WizardStep)}
          disabled={step === 1}
        >
          ← voltar
        </button>
        <span className="region-wizard-context">{stepHint(step)}</span>
        {step < 4 ? (
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => setStep((previous) => (previous + 1) as WizardStep)}
            disabled={nextDisabled}
          >
            {NEXT_LABELS[step]}
          </button>
        ) : null}
      </footer>
    </div>
  );
}
