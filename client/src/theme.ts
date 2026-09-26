/**
 * Tema visual da mesa.
 *
 * O padrão é o modo claro ("pergaminho"); o modo escuro é o "grimório
 * amaldiçoado" — fundo de couro queimado com dourado mais brilhante. O tema é
 * aplicado como `data-theme` no `<html>`, então basta trocar o atributo para o
 * CSS inteiro reagir. A escolha fica salva no navegador.
 */

export type Theme = 'light' | 'dark';

const THEME_KEY = 'grimorio.theme';
const DEFAULT_THEME: Theme = 'light';

let current: Theme = DEFAULT_THEME;

function readStored(): Theme {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME;
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'dark' || stored === 'light' ? stored : DEFAULT_THEME;
}

function paint(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
}

/** Lê a preferência salva e aplica o tema no documento. */
export function initTheme(): Theme {
  current = readStored();
  paint(current);
  return current;
}

export function getTheme(): Theme {
  return current;
}

export function setTheme(theme: Theme): void {
  current = theme;
  paint(theme);
  if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, theme);
}

/** Alterna entre pergaminho e grimório amaldiçoado; devolve o novo tema. */
export function toggleTheme(): Theme {
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
