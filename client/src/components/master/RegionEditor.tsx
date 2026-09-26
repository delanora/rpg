import { useState } from 'react';
import { fileToImagePayload, uploadImage } from '../../api';
import type { Creature, Locality, LocalityPatch, Region, RegionPatch } from '../../types';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Section } from '../Section';
import { ImageGallery } from './ImageGallery';
import { LocalityEditor } from './LocalityEditor';

type RegionTab = 'overview' | 'localities';

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
}

/**
 * Editor de uma região, com sub-abas: **Visão geral** (nome, descrição,
 * anotações e imagens da região) e **Localidades** (onde ficam as cidades,
 * masmorras e tavernas — e, dentro delas, as criaturas e NPCs).
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
}: RegionEditorProps) {
  const [tab, setTab] = useState<RegionTab>('overview');
  const [selectedLocalityId, setSelectedLocalityId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const selectedLocality = localities.find((locality) => locality.id === selectedLocalityId) ?? null;

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
    setCreating(true);
    try {
      const created = await onCreateLocality();
      setSelectedLocalityId(created.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="creature-editor">
      <div className="detail-head">
        <h2>
          <Icon name="scroll" size={22} /> {region.name}
        </h2>
        <button type="button" className="btn btn-danger btn-small" onClick={onDelete}>
          remover região
        </button>
      </div>

      <nav className="tabs tabs-inline subtabs" aria-label="Seções da região">
        <button
          type="button"
          className={tab === 'overview' ? 'tab active' : 'tab'}
          onClick={() => setTab('overview')}
        >
          <Icon name="book" size={15} /> Visão geral
        </button>
        <button
          type="button"
          className={tab === 'localities' ? 'tab active' : 'tab'}
          onClick={() => setTab('localities')}
        >
          <Icon name="scroll" size={15} /> Localidades ({localities.length})
        </button>
      </nav>

      {tab === 'overview' ? (
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
      ) : selectedLocality ? (
        <>
          <div className="toolbar">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setSelectedLocalityId(null)}
            >
              ← voltar para a lista
            </button>
          </div>

          <LocalityEditor
            locality={selectedLocality}
            creatures={creatures.filter((creature) =>
              creature.localities.some((locality) => locality.id === selectedLocality.id),
            )}
            onPatch={(patch) => onPatchLocality(selectedLocality.id, patch)}
            onDelete={() => {
              onDeleteLocality(selectedLocality.id);
              setSelectedLocalityId(null);
            }}
          />
        </>
      ) : (
        <>
          <div className="toolbar">
            <button
              type="button"
              className="btn btn-primary btn-small"
              onClick={() => void handleCreateLocality()}
              disabled={creating}
            >
              {creating ? 'criando...' : '+ nova localidade'}
            </button>
          </div>

          {localities.length === 0 ? (
            <p className="empty-hint">
              Nenhuma localidade nesta região ainda. Crie uma para colocar cidades, masmorras e
              tavernas — é nelas que as criaturas e NPCs ficam.
            </p>
          ) : (
            <ul className="locality-cards">
              {localities.map((locality) => (
                <li key={locality.id}>
                  <button
                    type="button"
                    className="locality-card"
                    onClick={() => setSelectedLocalityId(locality.id)}
                  >
                    <span className="locality-thumb">
                      {locality.images[0] ? (
                        <img src={locality.images[0].url} alt="" loading="lazy" />
                      ) : (
                        <Icon name="scroll" size={18} />
                      )}
                    </span>
                    <span className="locality-info">
                      <span className="card-name">{locality.name}</span>
                      <span className="card-line">{locality.creatureCount} criatura(s)</span>
                      {locality.description ? (
                        <span className="locality-desc">{locality.description}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
