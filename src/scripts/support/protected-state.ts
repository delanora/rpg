import { prisma } from '../../config/prisma.js';

/**
 * 6.6M.3.1.4.3 — INTEGRIDADE DO ESTADO REAL DA MESA.
 *
 * O smoke é a verificação do projeto e roda contra o MESMO banco da mesa real
 * (inclusive quando sobe numa instância paralela). A regra principal é de
 * ISOLAMENTO: cada execução usa fixtures próprias e nunca escolhe ficha/NPC
 * existente como alvo mecânico. Este módulo é a BARREIRA DEFENSIVA, não a
 * estratégia: ele fotografa fichas e NPCs persistentes ANTES da primeira
 * escrita e, no fim, prova que continuaram idênticos.
 *
 * Comparação é de LINHA INTEIRA, contra o schema real (nada de lista de campos
 * "conhecidos"): qualquer coluna alterada — HP, PV temporário, `deathState`,
 * `mechanicalState` (condições/exaustão/concentração), recursos, espaços,
 * inventário, `version`, `updatedAt` — aparece no relatório.
 *
 * Restauração é EXATA (devolve o valor anterior, nunca "cura todos" nem
 * "ressuscita todos") e guardada por `version`: se alguém escreveu depois do
 * diff, o restore NÃO sobrescreve — ele reporta e o smoke falha.
 */

export type ProtectedTable = 'character' | 'creature';

type Row = Record<string, unknown> & { id: string; version?: number };

export interface ProtectedRowSnapshot {
  table: ProtectedTable;
  id: string;
  label: string;
  data: Row;
}

export interface ProtectedGameState {
  takenAt: string;
  rows: ProtectedRowSnapshot[];
}

export interface ProtectedRowDiff {
  table: ProtectedTable;
  id: string;
  label: string;
  fields: string[];
}

export interface ProtectedStateDiff {
  characters: ProtectedRowDiff[];
  creatures: ProtectedRowDiff[];
  total: number;
  description: string;
}

const MISSING = '<registro removido>';

/** Normaliza para comparação: JSON puro, sem referência viva do Prisma. */
function serialize(row: unknown): Row {
  return JSON.parse(JSON.stringify(row)) as Row;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function labelOf(table: ProtectedTable, row: Row): string {
  const name = typeof row.name === 'string' && row.name.trim() ? row.name : row.id;
  return table === 'character' ? `personagem ${name}` : `NPC ${name}`;
}

async function readTable(table: ProtectedTable): Promise<Map<string, Row>> {
  const rows =
    table === 'character'
      ? await prisma.character.findMany({ orderBy: { id: 'asc' } })
      : await prisma.creature.findMany({ orderBy: { id: 'asc' } });
  return new Map(rows.map((row) => [row.id, serialize(row)] as const));
}

/** Fotografia ANTES da primeira escrita do teste. */
export async function snapshotProtectedGameState(): Promise<ProtectedGameState> {
  const rows: ProtectedRowSnapshot[] = [];
  for (const table of ['character', 'creature'] as const) {
    for (const [id, data] of await readTable(table)) {
      rows.push({ table, id, label: labelOf(table, data), data });
    }
  }
  return { takenAt: new Date().toISOString(), rows };
}

/** Compara o estado atual com a fotografia. Zero diferença é o esperado. */
export async function diffProtectedGameState(state: ProtectedGameState): Promise<ProtectedStateDiff> {
  const current = {
    character: await readTable('character'),
    creature: await readTable('creature'),
  } as const;

  const rows: ProtectedRowDiff[] = [];
  for (const snapshot of state.rows) {
    const now = current[snapshot.table].get(snapshot.id);
    if (!now) {
      rows.push({
        table: snapshot.table,
        id: snapshot.id,
        label: snapshot.label,
        fields: [MISSING],
      });
      continue;
    }
    const keys = new Set([...Object.keys(snapshot.data), ...Object.keys(now)]);
    const fields = [...keys]
      .filter((key) => !sameValue(snapshot.data[key], now[key]))
      .sort();
    if (fields.length > 0) {
      rows.push({ table: snapshot.table, id: snapshot.id, label: snapshot.label, fields });
    }
  }

  const description =
    rows.length === 0
      ? 'nenhuma ficha nem NPC real mudou'
      : rows.map((row) => `${row.label} (${row.id}): ${row.fields.join(', ')}`).join(' | ');

  return {
    characters: rows.filter((row) => row.table === 'character'),
    creatures: rows.filter((row) => row.table === 'creature'),
    total: rows.length,
    description,
  };
}

/**
 * Restauração DEFENSIVA e EXATA dos registros que o teste alterou.
 *
 * Só age sobre os campos que divergiram, escrevendo o valor ANTERIOR — nunca
 * defaults. `updateMany where { id, version }` é compare-and-set: se a linha
 * mudou depois do diff (jogador real escrevendo durante o smoke), o update
 * afeta 0 linhas e o registro entra em `refused` em vez de ser sobrescrito.
 */
export async function restoreProtectedGameState(
  state: ProtectedGameState,
  diff: ProtectedStateDiff,
): Promise<{ restored: number; refused: ProtectedRowDiff[] }> {
  const refused: ProtectedRowDiff[] = [];
  let restored = 0;
  const byId = new Map(state.rows.map((row) => [`${row.table}:${row.id}`, row] as const));

  for (const row of [...diff.characters, ...diff.creatures]) {
    const snapshot = byId.get(`${row.table}:${row.id}`);
    if (!snapshot || row.fields.includes(MISSING)) {
      // Registro apagado durante o teste: recriar seria inventar dado real.
      refused.push(row);
      continue;
    }
    const current =
      row.table === 'character'
        ? await prisma.character.findUnique({ where: { id: row.id } })
        : await prisma.creature.findUnique({ where: { id: row.id } });
    if (!current) {
      refused.push(row);
      continue;
    }
    const currentRow = serialize(current);
    const data: Record<string, unknown> = {};
    for (const field of row.fields) {
      if (field === MISSING || field === 'id') continue;
      if (!(field in snapshot.data)) continue;
      data[field] = snapshot.data[field];
    }
    if (Object.keys(data).length === 0) continue;
    const guard = typeof currentRow.version === 'number' ? { version: currentRow.version } : {};
    const result =
      row.table === 'character'
        ? await prisma.character.updateMany({ where: { id: row.id, ...guard }, data })
        : await prisma.creature.updateMany({ where: { id: row.id, ...guard }, data });
    if (result.count === 0) {
      refused.push(row);
      continue;
    }
    restored += 1;
  }

  return { restored, refused };
}
