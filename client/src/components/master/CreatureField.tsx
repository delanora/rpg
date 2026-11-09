import { useEffect, useState, type ComponentProps } from 'react';
import { InlineField } from '../InlineField';
/** Campos visíveis no cadastro, com o mesmo contrato de conversão do editor. */
export function CreatureField(props: ComponentProps<typeof InlineField>) {
  const [value, setValue] = useState(String(props.value));
  useEffect(() => setValue(String(props.value)), [props.value]);
  const commit = () => {
    if (value !== String(props.value)) props.onCommit(value);
  };
  const common = {
    value,
    'aria-label': props.ariaLabel,
    placeholder: props.placeholder,
    title: props.title,
    onBlur: commit,
    onChange: (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => setValue(e.target.value),
  };
  if (props.mode === 'select')
    return (
      <select
        {...common}
        onChange={(e) => {
          setValue(e.target.value);
          props.onCommit(e.target.value);
        }}
      >
        {props.options?.map((v) => (
          <option key={v} value={v}>
            {props.optionLabels?.[v] ?? v}
          </option>
        ))}
      </select>
    );
  if (props.mode === 'textarea') return <textarea {...common} />;
  return (
    <input
      {...common}
      type={props.mode === 'number' ? 'number' : 'text'}
      min={props.min}
      max={props.max}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
