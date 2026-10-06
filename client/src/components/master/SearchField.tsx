import { Icon } from '../Icon';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Rótulo acessível do campo (o ícone é decorativo). */
  label?: string;
  className?: string;
}

/**
 * Campo de busca do mestre: lupa, entrada de texto e um botão para limpar.
 *
 * É o mesmo controle em todas as abas, então a busca fica sempre no mesmo
 * lugar e com a mesma aparência — à mão na barra de ferramentas da lista.
 */
export function SearchField({
  value,
  onChange,
  placeholder = 'Buscar...',
  label = 'Buscar',
  className = '',
}: SearchFieldProps) {
  return (
    <label className={`search-field ${className}`.trim()}>
      <Icon name="search" size={15} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          className="search-clear"
          aria-label="Limpar busca"
          title="Limpar busca"
          onClick={() => onChange('')}
        >
          <Icon name="x" size={13} />
        </button>
      ) : null}
    </label>
  );
}
