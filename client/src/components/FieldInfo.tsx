import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * "i" ao lado do rótulo de um campo: explica em uma frase o que aquilo é.
 * O texto vive no tooltip, sem ocupar espaço permanente na ficha.
 */
export function FieldInfo({ children }: { children: ReactNode }) {
  return (
    <span className="info-tip field-info" tabIndex={0}>
      <Icon name="info" size={12} />
      <span className="info-tip-text" role="tooltip">
        {children}
      </span>
    </span>
  );
}
