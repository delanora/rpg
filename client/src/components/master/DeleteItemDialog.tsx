import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { categoryLabel } from '../../dnd';
import type { Character, Item } from '../../types';
import { Icon } from '../Icon';

interface DeleteItemDialogProps {
  /** Item que será excluído (o nome dele aparece no texto da confirmação). */
  item: Item;
  /**
   * Personagens que têm este item no inventário — dado que já está carregado no
   * painel. Quando vazio, nenhum aviso extra é mostrado.
   */
  usedBy: Character[];
  onCancel: () => void;
  /**
   * Executa a exclusão no servidor. Deve rejeitar quando falhar — o diálogo
   * continua aberto com a mensagem do erro.
   */
  onConfirm: () => Promise<void>;
}

/**
 * Aviso de que o item está em inventários, dentro da confirmação de exclusão.
 *
 * O conteúdo são sempre as mesmas três ideias — quem usa, e o que a exclusão
 * faz —
 * mas cada uma no seu bloco: um cabeçalho curto, os nomes em chips (nunca
 * soltos no meio de uma frase, que quebravam no meio do nome) e a consequência
 * em dois bullets. O destaque é estrutural; nenhuma palavra do texto é
 * ressaltada isoladamente.
 *
 * Exportado à parte por um motivo prático: é a única parte do diálogo que
 * depende só dos personagens, então dá para conferi-la em SSR — o diálogo
 * inteiro é um portal no `<body>`, que o renderer de servidor não aceita.
 */
export function DeleteItemUsage({ characters }: { characters: Character[] }) {
  if (characters.length === 0) return null;

  // Singular/plural: com um só personagem é "a cópia"/"o inventário".
  const single = characters.length === 1;

  return (
    <section className="delete-item-usage">
      <p className="delete-item-usage-title">
        <Icon name="info" size={15} /> Item em uso
      </p>
      <p className="delete-item-usage-lead">Este item já foi entregue a personagens.</p>

      <p className="delete-item-usage-label">Em uso por:</p>
      <ul className="delete-item-usage-chips">
        {characters.map((character) => (
          <li key={character.id} className="delete-item-usage-chip">
            {character.name}
          </li>
        ))}
      </ul>

      <p className="delete-item-usage-label">Ao excluir este item:</p>
      <ul className="delete-item-usage-list">
        <li>
          {single
            ? 'a cópia já entregue permanece no inventário;'
            : 'as cópias já entregues permanecem nos inventários;'}
        </li>
        <li>
          {single
            ? 'essa cópia deixa de receber atualizações do catálogo do mestre.'
            : 'essas cópias deixam de receber atualizações do catálogo do mestre.'}
        </li>
      </ul>
    </section>
  );
}

/**
 * Confirmação da exclusão de um item do catálogo.
 *
 * A ação é irreversível: o texto diz exatamente o que desaparece e, quando o
 * painel já sabe que o item está em algum inventário, avisa quem o tem — nada
 * de um "tem certeza?" genérico. Só o segundo clique (no botão vermelho) apaga;
 * Esc e "cancelar" fecham.
 *
 * SOBREPOSIÇÃO: o diálogo é montado por **portal no `<body>`**, como o modal do
 * item. Não é detalhe estético: o `#root` do app é um stacking context
 * (`position: relative; z-index: 1`) e o modal do item vive no `<body>` com
 * `z-index: 60` — qualquer confirmação renderizada DENTRO do `#root` fica presa
 * ao nível 1 e aparece ATRÁS do modal, por mais alto que fosse o seu z-index. A
 * classe `is-confirm` põe a confirmação logo acima da faixa dos modais (60) e
 * abaixo do lightbox (70).
 */
export function DeleteItemDialog({ item, usedBy, onCancel, onConfirm }: DeleteItemDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Foco na própria confirmação: o modal do item atrás fica inativo para o
  // teclado (quem devolve o foco ao botão "excluir" é o modal, ao sair daqui).
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Esc cancela — nunca confirma, para um toque errado não apagar nada.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !busy) onCancel();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      await onConfirm();
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir o item.');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="modal-backdrop is-confirm"
      role="dialog"
      aria-modal="true"
      aria-label={`Excluir ${item.name}`}
      // Clicar fora cancela SÓ a confirmação (o modal do item continua aberto).
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="modal delete-dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>
          <Icon name="trash" size={20} /> Excluir item
        </h2>

        <p className="section-note">
          Esta ação <strong>não pode ser desfeita</strong>.
        </p>

        <p className="delete-target">
          {item.name} <span className="muted">· {categoryLabel(item.category)}</span>
        </p>

        <p>Tem certeza que deseja excluir este item?</p>

        <ul>
          <li>O item sai do catálogo central do mestre e não pode mais ser enviado aos jogadores.</li>
          <li>O sprite, os atributos e o preço cadastrados são perdidos.</li>
        </ul>

        <DeleteItemUsage characters={usedBy} />

        {error ? <p className="form-error">{error}</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            cancelar
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void confirm()}
            disabled={busy}
          >
            <Icon name="trash" size={14} />
            {busy ? 'excluindo...' : 'excluir item'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
