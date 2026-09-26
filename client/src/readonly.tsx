import { createContext, useContext, type ReactNode } from 'react';

/**
 * Modo somente leitura da ficha.
 *
 * Vale para a visão do mestre quando ele está só conferindo a ficha. Em vez de
 * propagar um prop `readOnly` por todas as seções, o contexto é consumido
 * diretamente pelo `InlineField` e pelos controles (checkboxes e botões) — o
 * painel do mestre simplesmente deixa de ativá-lo quando entra em edição.
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
