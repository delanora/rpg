import { useEffect, useState } from 'react';

/**
 * Paginação das listas do painel do mestre.
 *
 * O catálogo do PHB 2014 e os bestiários crescem muito além do que cabe numa
 * tela; as abas **Itens**, **Fichas**, **Criaturas**, **NPCs** e **Regiões**
 * compartilham ESTE controle — 25 linhas por página, rodapé centralizado, mesma
 * aparência em todas elas. A paginação é só de APRESENTAÇÃO: as listas chegam
 * inteiras do servidor (por HTTP ou tempo real) e nada de rota muda.
 */

/** Itens por página em todas as listas do painel do mestre. */
export const MASTER_PAGE_SIZE = 25;

/** Uma página já fatiada, com os limites numéricos usados no rodapé. */
export interface PageSlice<T> {
  /** Página efetiva (1..pageCount), já limitada ao intervalo válido. */
  page: number;
  pageCount: number;
  /** Posição do primeiro item da página na lista filtrada (0 quando vazia). */
  start: number;
  /** Posição do último item da página (0 quando vazia). */
  end: number;
  /** Total de itens da lista FILTRADA. */
  total: number;
  items: T[];
}

/**
 * Fatia a lista em páginas. Página fora do intervalo é ajustada (nunca devolve
 * página vazia por causa de um número antigo) — a mesma conta que o rodapé usa
 * para "Itens 26–50 de 157".
 */
export function paginate<T>(
  list: readonly T[],
  page: number,
  pageSize: number = MASTER_PAGE_SIZE,
): PageSlice<T> {
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
  const offset = (current - 1) * pageSize;
  const items = list.slice(offset, offset + pageSize);
  return {
    page: current,
    pageCount,
    start: items.length === 0 ? 0 : offset + 1,
    end: offset + items.length,
    total,
    items,
  };
}

/** Estado da página corrente de uma lista paginada. */
export interface PagerState {
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
}

/**
 * Estado de paginação de uma lista: `total` é o tamanho da lista JÁ FILTRADA.
 *
 * `resetKey` é o que identifica o recorte (a busca, os filtros): quando ele
 * muda, a lista recomeça na primeira página. Se a lista encolher (exclusão,
 * filtro mais restritivo), a página é limitada à última existente — o painel
 * nunca fica numa página vazia.
 */
export function usePager(total: number, resetKey?: unknown): PagerState {
  const pageCount = Math.max(1, Math.ceil(total / MASTER_PAGE_SIZE));
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  return { page: Math.min(page, pageCount), pageCount, setPage };
}

/**
 * Números de página exibidos, com `'gap'` onde há salto.
 *
 * Até 7 páginas aparecem todas; acima disso fica a primeira, a última e a
 * vizinhança da atual ("1 … 4 5 6 … 13"), para o controle não crescer com a
 * lista.
 */
export function pageWindow(page: number, pageCount: number): (number | 'gap')[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const slots = new Set<number>([1, pageCount, page - 1, page, page + 1]);
  if (page <= 3) {
    slots.add(2);
    slots.add(3);
    slots.add(4);
  }
  if (page >= pageCount - 2) {
    slots.add(pageCount - 3);
    slots.add(pageCount - 2);
    slots.add(pageCount - 1);
  }

  const pages = [...slots].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  for (const [index, value] of pages.entries()) {
    const previous = pages[index - 1];
    if (previous !== undefined && value - previous > 1) out.push('gap');
    out.push(value);
  }
  return out;
}

interface PaginatorProps {
  page: number;
  pageCount: number;
  total: number;
  /** Posição do primeiro item da página na lista filtrada. */
  start: number;
  /** Posição do último item da página na lista filtrada. */
  end: number;
  onPage: (page: number) => void;
  /** Singular do que está sendo paginado ("ficha", "NPC", "região"). */
  one: string;
  /** Plural do que está sendo paginado ("fichas", "NPCs", "regiões"). */
  many: string;
  /** Rótulo acessível do controle (ex.: "Paginação das fichas"). */
  label: string;
  /** Complemento à direita da contagem (ex.: "12 de 40 com a busca atual"). */
  detail?: string;
  className?: string;
}

/**
 * Rodapé de paginação: contagem centralizada e, abaixo, os botões.
 *
 * Com uma página só, o controle desaparece e fica apenas a contagem — nada de
 * botão morto. A página atual usa `aria-current="page"` e fica em dourado.
 */
export function Paginator({
  page,
  pageCount,
  total,
  start,
  end,
  onPage,
  one,
  many,
  label,
  detail,
  className = '',
}: PaginatorProps) {
  const range =
    pageCount > 1
      ? `${many.charAt(0).toUpperCase()}${many.slice(1)} ${start}–${end} de ${total}`
      : `${total} ${total === 1 ? one : many}`;

  return (
    <div className={`list-footer ${className}`.trim()}>
      <p className="list-range">
        {range}
        {detail ? ` · ${detail}` : ''}
      </p>

      {pageCount > 1 ? (
        <nav className="list-pager" aria-label={label}>
          <button
            type="button"
            className="list-page-btn is-step"
            aria-label="Página anterior"
            title="Página anterior"
            disabled={page === 1}
            onClick={() => onPage(page - 1)}
          >
            ‹
          </button>

          {pageWindow(page, pageCount).map((slot, index) =>
            slot === 'gap' ? (
              <span key={`gap-${index}`} className="list-page-gap" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={slot}
                type="button"
                className="list-page-btn"
                aria-label={`Página ${slot}`}
                aria-current={slot === page ? 'page' : undefined}
                onClick={() => onPage(slot)}
              >
                {slot}
              </button>
            ),
          )}

          <button
            type="button"
            className="list-page-btn is-step"
            aria-label="Próxima página"
            title="Próxima página"
            disabled={page === pageCount}
            onClick={() => onPage(page + 1)}
          >
            ›
          </button>
        </nav>
      ) : null}
    </div>
  );
}
