import { createContext, useContext, type ReactNode } from 'react';

/**
 * O que está travado na ficha — e por quê.
 *
 * São três travas diferentes, e a ficha precisa distingui-las:
 *
 * - `readOnly`: visão do mestre **sem** entrar em edição (nada clicável).
 * - `creationLocked`: o jogador **finalizou a criação**; identidade, atributos,
 *   proficiências, classes, PV máximo, CA e magias conhecidas viram somente
 *   leitura — só o estado de jogo continua editável.
 * - `masterView`: a ficha está aberta no painel do mestre, que pode editar o
 *   que o jogador não pode (ex.: o override manual da CA).
 *
 * Em vez de propagar três props por todas as seções, o contexto é consumido
 * direto pelo `InlineField` e pelos controles.
 */
export interface SheetAccess {
  readOnly: boolean;
  creationLocked: boolean;
  masterView: boolean;
}

const DEFAULT_ACCESS: SheetAccess = {
  readOnly: false,
  creationLocked: false,
  masterView: false,
};

const SheetAccessContext = createContext<SheetAccess>(DEFAULT_ACCESS);

export function SheetAccessProvider({
  value,
  children,
}: {
  value: SheetAccess;
  children: ReactNode;
}) {
  return <SheetAccessContext.Provider value={value}>{children}</SheetAccessContext.Provider>;
}

/** Somente leitura puro — usado pelo `InlineField` para virar texto estático. */
export function useReadOnly(): boolean {
  return useContext(SheetAccessContext).readOnly;
}

/** Todas as travas, mais a junção das que bloqueiam campos de construção. */
export function useSheetAccess(): SheetAccess & { lockedConstruction: boolean } {
  const access = useContext(SheetAccessContext);
  return { ...access, lockedConstruction: access.readOnly || access.creationLocked };
}
