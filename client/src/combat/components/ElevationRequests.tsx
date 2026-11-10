import { metersToElevationFeet } from '../../sceneUnits';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { CombatDto, SpatialPosition } from '../../types';
import { createOperationId } from '../../utils';
interface Request {
  id: string;
  combatantId: string;
  name: string;
  path: SpatialPosition[];
}

/** Fila privada. A autorização executa novamente o movimento no servidor, incluindo Reações. */
export function ElevationRequests({
  combat,
  onCombatChange,
}: {
  combat: CombatDto;
  onCombatChange: (combat: CombatDto) => void;
}) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [cost, setCost] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intention = useRef<{ key: string; body: object } | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await api<{ requests: Request[] }>(
          `/api/combat/${combat.id}/spatial/elevation-requests`,
        );
        if (active) {
          setRequests(result.requests);
          setError(null);
        }
      } catch {
        if (active)
          setError(
            'Não foi possível consultar as travessias. Tentando novamente.',
          );
      }
    };
    void refresh();
    return () => {
      active = false;
    };
  }, [combat.id, combat.version]);
  const first = requests[0];
  useEffect(() => {
    setCost('0');
    setError(null);
    intention.current = null;
  }, [first?.id]);
  if (!first) return null;
  const meters = Number(cost.replace(',', '.'));
  async function decide(approve: boolean) {
    if (busy || !first || (approve && (!Number.isFinite(meters) || meters < 0)))
      return;
    const key = JSON.stringify({
      id: first.id,
      approve,
      meters,
      version: combat.version,
    });
    const body =
      intention.current?.key === key
        ? intention.current.body
        : {
            approve,
            additionalCostFeet: approve ? metersToElevationFeet(meters) : 0,
            expectedVersion: combat.version,
            operationId: createOperationId(),
          };
    intention.current = { key, body };
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ combat: CombatDto }>(
        `/api/combat/${combat.id}/spatial/elevation-requests/${first.id}`,
        { method: 'POST', body },
      );
      onCombatChange(result.combat);
      setRequests((items) => items.filter((item) => item.id !== first.id));
      intention.current = null;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível decidir a travessia.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside
      className="combat-elevation-request"
      aria-label="Decisão de desnível"
    >
      <strong>{first.name} quer atravessar um desnível</strong>
      <svg
        className="combat-elevation-route"
        role="img"
        aria-label="Trajeto solicitado no mapa"
        viewBox={`0 0 ${combat.spatial.widthFeet} ${combat.spatial.heightFeet}`}
      >
        {combat.sceneBackgroundImageUrl ? (
          <image
            href={combat.sceneBackgroundImageUrl}
            width={combat.spatial.widthFeet}
            height={combat.spatial.heightFeet}
            preserveAspectRatio="none"
          />
        ) : null}
        <polyline
          points={first.path
            .map((p) => `${p.xFeet + 2.5},${p.yFeet + 2.5}`)
            .join(' ')}
          fill="none"
          stroke="var(--gold)"
          strokeWidth={1}
        />
        {first.path.map((p, index) => (
          <circle
            key={index}
            cx={p.xFeet + 2.5}
            cy={p.yFeet + 2.5}
            r={1}
            fill="var(--gold)"
          />
        ))}
      </svg>
      <span>
        {first.path.length} passo(s). Confira o trajeto no mapa. Autorizar
        mantém as reações e o custo horizontal.
      </span>
      <label>
        Custo adicional (m)
        <input
          aria-label="Custo adicional da travessia em metros"
          type="text"
          inputMode="decimal"
          value={cost}
          disabled={busy}
          onChange={(event) => setCost(event.target.value)}
        />
      </label>
      <small>
        O adicional é gasto ao autorizar, mesmo se uma reação interromper o
        trajeto. Salto, escalada e queda são decididos pelo Mestre.
      </small>
      <div>
        <button
          className="btn btn-primary btn-small"
          disabled={
            busy ||
            !cost.trim() ||
            !Number.isFinite(meters) ||
            meters < 0 ||
            meters > 3000
          }
          onClick={() => void decide(true)}
        >
          Autorizar trajeto
        </button>{' '}
        <button
          className="btn btn-small"
          disabled={busy}
          onClick={() => void decide(false)}
        >
          Recusar
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </aside>
  );
}
