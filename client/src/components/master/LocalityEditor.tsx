import { useState } from 'react';
import { fileToImagePayload, uploadImage } from '../../api';
import type { Creature, Locality, LocalityPatch } from '../../types';
import { ImageGallery } from './ImageGallery';
import { InlineField } from '../InlineField';
import { Portrait } from '../Portrait';
import { Section } from '../Section';

interface LocalityEditorProps {
  locality: Locality;
  /** Criaturas/NPCs vinculados a esta localidade (com seus ícones). */
  creatures: Creature[];
  onPatch: (patch: LocalityPatch) => void;
  onDelete: () => void;
}

/** Editor de uma localidade: nome, descrição, imagens e criaturas do local. */
export function LocalityEditor({ locality, creatures, onPatch, onDelete }: LocalityEditorProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;

    setUploading(true);
    setError(null);
    try {
      const images = [...locality.images];
      for (const file of Array.from(files)) {
        const payload = await fileToImagePayload(file);
        images.push(await uploadImage(payload.dataUrl, payload.name));
      }
      onPatch({ images });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar a imagem.');
    } finally {
      setUploading(false);
    }
  }

  function removeImage(url: string): void {
    onPatch({ images: locality.images.filter((image) => image.url !== url) });
  }

  return (
    <div className="creature-editor">
      <Section
        title="Localidade"
        icon="scroll"
        actions={
          <button type="button" className="btn btn-danger btn-small" onClick={onDelete}>
            remover
          </button>
        }
      >
        <label className="field">
          <span>Nome</span>
          <InlineField
            value={locality.name}
            ariaLabel="Nome da localidade"
            onCommit={(value) => {
              const name = value.trim();
              if (name) onPatch({ name });
            }}
          />
        </label>

        <h3 className="subsection-title">Descrição</h3>
        <InlineField
          value={locality.description}
          mode="textarea"
          ariaLabel="Descrição da localidade"
          placeholder="Descreva o lugar, seus moradores e perigos..."
          onCommit={(value) => onPatch({ description: value })}
        />
      </Section>

      <Section title="Imagens" icon="star" subtitle="PNG, JPEG, WEBP ou GIF · até 5 MB cada">
        <ImageGallery
          images={locality.images}
          addLabel="+ adicionar imagens"
          uploading={uploading}
          error={error}
          altFallback={locality.name}
          onAdd={(files) => void handleFiles(files)}
          onRemove={removeImage}
        />
      </Section>

      <Section
        title="Criaturas e NPCs"
        icon="flame"
        subtitle="Quem habita este lugar (com seus ícones)"
      >
        {creatures.length === 0 ? (
          <p className="empty-hint">Nenhuma criatura vinculada a esta localidade ainda.</p>
        ) : (
          <ul className="creature-mini-list">
            {creatures.map((creature) => (
              <li key={creature.id} className="creature-mini">
                <Portrait
                  src={creature.imageUrl}
                  alt={creature.name}
                  icon={creature.kind === 'NPC' ? 'crown' : 'flame'}
                />
                <span className="creature-mini-name">{creature.name}</span>
                <span className="muted">{creature.kind === 'NPC' ? 'NPC' : creature.type || 'criatura'}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
