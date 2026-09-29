import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useReadOnly } from '../readonly';

type Mode = 'text' | 'number' | 'textarea' | 'select';

interface InlineFieldProps {
  value: string | number;
  /** Recebe o texto digitado; quem chama converte/valida. */
  onCommit: (value: string) => void;
  mode?: Mode;
  options?: readonly string[];
  /** Rótulos exibidos no select, por valor (o valor gravado continua sendo a chave). */
  optionLabels?: Record<string, string>;
  placeholder?: string;
  min?: number;
  max?: number;
  className?: string;
  ariaLabel?: string;
  /** Renderização customizada do valor quando não está em edição. */
  render?: (value: string | number) => ReactNode;
  /** Força somente leitura (além do contexto), escondendo a edição. */
  readOnly?: boolean;
  /** Dica exibida ao passar o mouse (ex.: "definido pelo mestre"). */
  title?: string;
}

/**
 * Campo com edição inline: clicar transforma o texto em input (sem abrir
 * formulário ou modal). Enter ou sair do campo salva; Esc cancela.
 */
export function InlineField({
  value,
  onCommit,
  mode = 'text',
  options,
  optionLabels,
  placeholder = '—',
  min,
  max,
  className = '',
  ariaLabel,
  render,
  readOnly,
  title,
}: InlineFieldProps) {
  const readOnlyContext = useReadOnly();
  const isReadOnly = readOnly ?? readOnlyContext;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const skipCommit = useRef(false);

  useEffect(() => {
    if (!editing) return;
    const element = inputRef.current;
    element?.focus();
    element?.select();
  }, [editing]);

  const current = value === null || value === undefined ? '' : String(value);

  function startEditing(): void {
    skipCommit.current = false;
    setDraft(current);
    setEditing(true);
  }

  function commit(): void {
    // Escape desmonta o campo e o blur dispara em seguida; nesse caso não salvamos.
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    setEditing(false);
    if (draft !== current) onCommit(draft);
  }

  function cancel(): void {
    skipCommit.current = true;
    setEditing(false);
  }

  // No modo somente leitura nada é clicável: mostra apenas o valor.
  if (isReadOnly) {
    return (
      <span className={`inline-static ${className}`} aria-label={ariaLabel} title={title}>
        {current === '' ? (
          <span className="placeholder">{placeholder}</span>
        ) : render ? (
          render(value)
        ) : (
          current
        )}
      </span>
    );
  }

  // O select já é, por natureza, edição direta.
  if (mode === 'select') {
    return (
      <select
        className={`inline-field inline-select ${className}`}
        value={current}
        aria-label={ariaLabel}
        onChange={(event) => onCommit(event.target.value)}
      >
        <option value="">—</option>
        {options?.map((option) => (
          <option key={option} value={option}>
            {optionLabels?.[option] ?? option}
          </option>
        ))}
      </select>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={`inline-field inline-display ${className}`}
        onClick={startEditing}
        aria-label={ariaLabel}
        title={title ?? 'Clique para editar'}
      >
        {current === '' ? (
          <span className="placeholder">{placeholder}</span>
        ) : render ? (
          render(value)
        ) : (
          current
        )}
      </button>
    );
  }

  if (mode === 'textarea') {
    return (
      <textarea
        ref={(element) => {
          inputRef.current = element;
        }}
        className={`inline-field inline-input inline-textarea ${className}`}
        value={draft}
        rows={4}
        aria-label={ariaLabel}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
          // Ctrl/Cmd+Enter salva; Enter sozinho cria nova linha.
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            commit();
          }
        }}
      />
    );
  }

  return (
    <input
      ref={(element) => {
        inputRef.current = element;
      }}
      className={`inline-field inline-input ${className}`}
      type={mode === 'number' ? 'number' : 'text'}
      min={min}
      max={max}
      value={draft}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
}
