import { useState } from 'react';
import { fileToImagePayload, uploadImage } from '../../api';
import { DAMAGE_TYPES } from '../../dnd';
import { ARMOR_TYPES, ITEM_CATEGORIES } from '../../types';
import type { Character, Item, ItemDetails, ItemPatch, ItemPrice } from '../../types';
import { clampFloat, clampInt } from '../../utils';
import { Icon } from '../Icon';
import { InlineField } from '../InlineField';
import { Portrait } from '../Portrait';
import { Section } from '../Section';

const DIE_OPTIONS = ['4', '6', '8', '10', '12', '20'] as const;

interface ItemEditorProps {
  item: Item;
  characters: Character[];
  onPatch: (patch: ItemPatch) => void;
  onDelete: () => void;
  onSend: (characterId: string, quantity: number) => Promise<void>;
}

/** Campos numéricos/selects específicos da categoria do item. */
function CategoryFields({
  item,
  onPatchDetails,
}: {
  item: Item;
  onPatchDetails: (patch: ItemDetails) => void;
}) {
  const details = item.details;

  if (item.category === 'Arma' || item.category === 'Cajado') {
    return (
      <div className="grid grid-3">
        <label className="field">
          <span>Dados de dano</span>
          <InlineField
            value={details.damageCount ?? 0}
            mode="number"
            min={0}
            max={20}
            ariaLabel="Quantidade de dados de dano"
            onCommit={(value) => onPatchDetails({ damageCount: clampInt(value, 0, 20, 0) })}
          />
        </label>

        <label className="field">
          <span>Dado</span>
          <InlineField
            value={details.damageDie ? String(details.damageDie) : ''}
            mode="select"
            options={DIE_OPTIONS}
            ariaLabel="Tipo do dado de dano"
            onCommit={(value) => onPatchDetails({ damageDie: value ? Number(value) : 0 })}
          />
        </label>

        <label className="field">
          <span>Tipo de dano</span>
          <InlineField
            value={details.damageType ?? ''}
            mode="select"
            options={DAMAGE_TYPES}
            ariaLabel="Tipo de dano"
            onCommit={(value) => onPatchDetails({ damageType: value })}
          />
        </label>

        <label className="field">
          <span>Bônus de ataque</span>
          <InlineField
            value={details.attackBonus ?? 0}
            mode="number"
            min={-30}
            max={30}
            ariaLabel="Bônus de ataque"
            onCommit={(value) => onPatchDetails({ attackBonus: clampInt(value, -30, 30, 0) })}
          />
          <span className="field-hint">
            dano resumido:{' '}
            <strong>
              {details.damageCount && details.damageDie
                ? `${details.damageCount}d${details.damageDie}`
                : '—'}
            </strong>
          </span>
        </label>

        {item.category === 'Cajado' ? (
          <label className="field field-check">
            <span>Foco de conjuração</span>
            <input
              type="checkbox"
              checked={Boolean(details.spellcastingFocus)}
              aria-label="Foco de conjuração"
              onChange={(event) => onPatchDetails({ spellcastingFocus: event.target.checked })}
            />
          </label>
        ) : null}
      </div>
    );
  }

  // A armadura tem CA base e peso (leve/média/pesada): é daí que sai a CA da
  // ficha quando ela está equipada no peitoral.
  if (item.category === 'Armadura') {
    return (
      <div className="grid grid-3">
        <label className="field">
          <span>Tipo</span>
          <InlineField
            value={details.armorType ?? ''}
            mode="select"
            options={ARMOR_TYPES}
            ariaLabel="Tipo da armadura"
            onCommit={(value) => onPatchDetails({ armorType: value || undefined })}
          />
          <span className="field-hint">leve soma a DES · média no máximo +2 · pesada sem DES</span>
        </label>

        <label className="field">
          <span>CA base</span>
          <InlineField
            value={details.baseArmorClass ?? 0}
            mode="number"
            min={0}
            max={30}
            ariaLabel="CA base da armadura"
            onCommit={(value) => onPatchDetails({ baseArmorClass: clampInt(value, 0, 30, 0) })}
          />
          <span className="field-hint">ex.: couro 11 · gibão de peles 12 · cota de malha 16</span>
        </label>

        <label className="field">
          <span>Bônus mágico de CA</span>
          <InlineField
            value={details.armorClassBonus ?? 0}
            mode="number"
            min={-10}
            max={30}
            ariaLabel="Bônus mágico de CA"
            onCommit={(value) => onPatchDetails({ armorClassBonus: clampInt(value, -10, 30, 0) })}
          />
          <span className="field-hint">armadura mágica (+1, +2...) some ao total</span>
        </label>
      </div>
    );
  }

  if (item.category === 'Escudo') {
    return (
      <div className="grid grid-3">
        <label className="field">
          <span>Bônus de CA</span>
          <InlineField
            value={details.armorClassBonus ?? 0}
            mode="number"
            min={-10}
            max={30}
            ariaLabel="Bônus de CA"
            onCommit={(value) => onPatchDetails({ armorClassBonus: clampInt(value, -10, 30, 0) })}
          />
          <span className="field-hint">soma à CA enquanto o escudo estiver equipado</span>
        </label>
      </div>
    );
  }

  if (item.category === 'Poção') {
    return (
      <div className="grid grid-3">
        <label className="field">
          <span>Rolagem do efeito</span>
          <InlineField
            value={details.effectRoll ?? ''}
            placeholder="ex.: 2d4+2"
            ariaLabel="Rolagem do efeito da poção"
            onCommit={(value) => onPatchDetails({ effectRoll: value.trim() })}
          />
        </label>
        <label className="field">
          <span>Duração</span>
          <InlineField
            value={details.duration ?? ''}
            placeholder="ex.: 1 hora"
            ariaLabel="Duração da poção"
            onCommit={(value) => onPatchDetails({ duration: value.trim() })}
          />
        </label>
      </div>
    );
  }

  if (item.category === 'Anel') {
    return (
      <div className="grid grid-3">
        <label className="field">
          <span>Rolagem do efeito</span>
          <InlineField
            value={details.effectRoll ?? ''}
            placeholder="ex.: 1d6"
            ariaLabel="Rolagem do efeito do anel"
            onCommit={(value) => onPatchDetails({ effectRoll: value.trim() })}
          />
        </label>
        <label className="field field-check">
          <span>Exige sintonização</span>
          <input
            type="checkbox"
            checked={Boolean(details.attunement)}
            aria-label="Exige sintonização"
            onChange={(event) => onPatchDetails({ attunement: event.target.checked })}
          />
        </label>
      </div>
    );
  }

  return <p className="section-note">Esta categoria não tem atributos especiais além do preço.</p>;
}

/** Editor de um item: identidade, atributos por categoria, preço e envio. */
export function ItemEditor({ item, characters, onPatch, onDelete, onSend }: ItemEditorProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  function patchDetails(patch: ItemDetails): void {
    onPatch({ details: { ...item.details, ...patch } });
  }

  function patchPrice(patch: Partial<ItemPrice>): void {
    const base = item.price ?? { gold: 0, silver: 0, copper: 0 };
    onPatch({ price: { ...base, ...patch } });
  }

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

  const price = item.price ?? { gold: 0, silver: 0, copper: 0 };

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
              onCommit={(value) =>
                onPatch({ category: value as ItemPatch['category'], details: {} })
              }
            />
          </label>

          <label className="field">
            <span>Peso (kg)</span>
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

      <Section
        title={`Atributos — ${item.category}`}
        icon="sword"
        subtitle="Os campos mudam conforme a categoria escolhida"
      >
        <CategoryFields item={item} onPatchDetails={patchDetails} />
      </Section>

      <Section title="Valor (PO / PP / PC)" icon="crown" subtitle="Visível apenas para o mestre">
        <div className="grid grid-3">
          <label className="field">
            <span>PO (ouro)</span>
            <InlineField
              value={price.gold}
              mode="number"
              min={0}
              ariaLabel="Preço em peças de ouro"
              onCommit={(value) => patchPrice({ gold: clampInt(value, 0, 9_999_999, price.gold) })}
            />
          </label>
          <label className="field">
            <span>PP (prata)</span>
            <InlineField
              value={price.silver}
              mode="number"
              min={0}
              ariaLabel="Preço em peças de prata"
              onCommit={(value) =>
                patchPrice({ silver: clampInt(value, 0, 9_999_999, price.silver) })
              }
            />
          </label>
          <label className="field">
            <span>PC (cobre)</span>
            <InlineField
              value={price.copper}
              mode="number"
              min={0}
              ariaLabel="Preço em peças de cobre"
              onCommit={(value) =>
                patchPrice({ copper: clampInt(value, 0, 9_999_999, price.copper) })
              }
            />
          </label>
        </div>
      </Section>

      <Section title="Sprite" icon="star" subtitle="PNG, JPEG, WEBP ou GIF · até 5 MB">
        <div className="item-sprite-row">
          <Portrait src={item.imageUrl} alt={item.name} size="lg" icon="flask" />
          <div className="toolbar">
            <label
              className={uploading ? 'btn btn-small file-btn disabled' : 'btn btn-small file-btn'}
            >
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
              <button
                type="button"
                className="btn btn-small"
                onClick={() => onPatch({ imageUrl: '' })}
              >
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
