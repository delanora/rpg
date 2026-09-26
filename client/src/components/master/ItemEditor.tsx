import { useState } from 'react';
import { fileToImagePayload, uploadImage } from '../../api';
import { ITEM_CATEGORIES } from '../../types';
import type { Character, Item, ItemPatch } from '../../types';
import { clampFloat } from '../../utils';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Portrait } from '../Portrait';
import { Section } from '../Section';

interface ItemEditorProps {
  item: Item;
  characters: Character[];
  onPatch: (patch: ItemPatch) => void;
  onDelete: () => void;
  onSend: (characterId: string, quantity: number) => Promise<void>;
}

/** Editor de um item: identidade, sprite e envio direto para um jogador. */
export function ItemEditor({ item, characters, onPatch, onDelete, onSend }: ItemEditorProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleFile(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const payload = await fileToImagePayload(file);
      const image = await uploadImage(payload.dataUrl, payload.name, 'items');
      onPatch({ imageUrl: image.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar a imagem.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSend(): Promise<void> {
    if (!targetId) return;
    const amount = Math.max(1, Math.min(1_000_000, Math.trunc(Number(quantity) || 1)));
    setSending(true);
    setError(null);
    setSentTo(null);
    try {
      await onSend(targetId, amount);
      const name = characters.find((character) => character.id === targetId)?.name ?? 'jogador';
      setSentTo(`${amount}× ${item.name} → ${name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar o item.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="creature-editor">
      <div className="detail-head">
        <h2>
          <Portrait src={item.imageUrl} alt={item.name} icon="flask" />
          {item.name}
        </h2>
        <button type="button" className="btn btn-danger btn-small" onClick={onDelete}>
          remover item
        </button>
      </div>

      <Section title="Item" icon="scroll">
        <div className="grid grid-3">
          <label className="field">
            <span>Nome</span>
            <InlineField
              value={item.name}
              ariaLabel="Nome do item"
              onCommit={(value) => {
                const name = value.trim();
                if (name) onPatch({ name });
              }}
            />
          </label>

          <label className="field">
            <span>Categoria</span>
            <InlineField
              value={item.category}
              mode="select"
              options={[...ITEM_CATEGORIES]}
              ariaLabel="Categoria do item"
              onCommit={(value) => onPatch({ category: value as ItemPatch['category'] })}
            />
          </label>

          <label className="field">
            <span>Peso (lb)</span>
            <InlineField
              value={item.weight}
              mode="number"
              min={0}
              ariaLabel="Peso do item"
              onCommit={(value) => onPatch({ weight: clampFloat(value, 0, 100000, item.weight) })}
            />
          </label>
        </div>

        <h3 className="subsection-title">Descrição</h3>
        <InlineField
          value={item.description}
          mode="textarea"
          ariaLabel="Descrição do item"
          placeholder="Propriedades, efeitos, história..."
          onCommit={(value) => onPatch({ description: value })}
        />
      </Section>

      <Section title="Sprite" icon="star" subtitle="PNG, JPEG, WEBP ou GIF · até 5 MB">
        <div className="item-sprite-row">
          <Portrait src={item.imageUrl} alt={item.name} size="lg" icon="flask" />
          <div className="toolbar">
            <label className={uploading ? 'btn btn-small file-btn disabled' : 'btn btn-small file-btn'}>
              {uploading ? 'enviando...' : item.imageUrl ? 'trocar sprite' : '+ adicionar sprite'}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={uploading}
                onChange={(event) => {
                  void handleFile(event.target.files);
                  event.target.value = '';
                }}
              />
            </label>
            {item.imageUrl ? (
              <button type="button" className="btn btn-small" onClick={() => onPatch({ imageUrl: '' })}>
                remover sprite
              </button>
            ) : null}
          </div>
        </div>
      </Section>

      <Section
        title="Enviar para jogador"
        icon="users"
        subtitle="O mestre não tem limite de quantidade — envie quantos itens quiser"
      >
        {characters.length === 0 ? (
          <p className="empty-hint">Nenhum jogador com ficha ainda.</p>
        ) : (
          <div className="toolbar toolbar-wrap">
            <label className="field field-inline">
              <span>Jogador</span>
              <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                <option value="">escolha o jogador</option>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                    {character.ownerUsername ? ` (${character.ownerUsername})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field-inline">
              <span>Quantidade</span>
              <input
                type="number"
                min={1}
                max={1_000_000}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={sending || !targetId}
              onClick={() => void handleSend()}
            >
              <Icon name="plus" size={14} /> {sending ? 'enviando...' : 'enviar'}
            </button>
          </div>
        )}

        {sentTo ? <p className="form-success">Enviado: {sentTo}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </Section>
    </div>
  );
}
