import { createContext, useContext, type ReactNode } from 'react';

/**
 * Modo somente leitura da ficha.
 *
 * O mestre enxerga as fichas dos jogadores sem poder editá-las. Em vez de
 * propagar um prop `readOnly` por todas as seções, o contexto é consumido
 * diretamente pelo `InlineField` e pelos controles (checkboxes e botões).
 */
const ReadOnlyContext = createContext(false);

export function ReadOnlyProvider({
  value,
  children,
}: {
  value: boolean;
  children: ReactNode;
}) {
  return <ReadOnlyContext.Provider value={value}>{children}</ReadOnlyContext.Provider>;
}

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}
