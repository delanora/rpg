import { useState } from 'react';
import { fileToImagePayload, uploadImage } from '../../api';
import type { Creature, CreaturePatch } from '../../types';
export function CreatureTokenGallery({
  creature,
  onPatch,
  onBusy,
}: {
  creature: Creature;
  onPatch: (patch: CreaturePatch) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const images = creature.tokenImages ?? [];
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (images.length + files.length > 20) {
      setError('Use até 20 variações de token.');
      return;
    }
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const payload = await fileToImagePayload(file);
        urls.push(
          (await uploadImage(payload.dataUrl, payload.name, 'creatures')).url,
        );
      }
      onPatch({
        tokenImages: [...images, ...urls],
        ...(!creature.imageUrl ? { imageUrl: urls[0] } : {}),
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Não foi possível enviar os tokens.',
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="creature-token-gallery">
      <h3>Variações de token</h3>
      <p className="section-note">
        Cada cópia recebe uma imagem ao entrar no combate. Ela é mantida ao
        recarregar. Sem variações, vale o retrato principal.
      </p>
      <div className="creature-gallery-grid">
        {images.map((url, index) => (
          <div key={url + index}>
            <img src={url} alt={`Token ${index + 1} de ${creature.name}`} />
            <button
              type="button"
              className="btn btn-small"
              disabled={busy}
              onClick={() =>
                onPatch({ tokenImages: images.filter((_, i) => i !== index) })
              }
            >
              Remover token {index + 1}
            </button>
          </div>
        ))}
      </div>
      <div className="creature-card-actions">
        <label className="btn btn-small file-btn">
          {busy ? 'Enviando…' : 'Adicionar imagens de token'}
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            disabled={busy || images.length >= 20}
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {creature.imageUrl && !images.includes(creature.imageUrl) ? (
          <button
            type="button"
            className="btn btn-small"
            disabled={busy || images.length >= 20}
            onClick={() =>
              onPatch({ tokenImages: [...images, creature.imageUrl] })
            }
          >
            Usar retrato como token
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
