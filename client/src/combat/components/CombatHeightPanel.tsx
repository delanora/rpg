import { feetToMeters, metersToElevationFeet } from '../../sceneUnits';
import { useState } from 'react';
import { api } from '../../api';
import { createOperationId } from '../../utils';
import type { CombatDto, CombatantDto } from '../../types';

export function CombatHeightPanel({
  combat,
  combatant,
  busy,
  onRun,
}: {
  combat: CombatDto;
  combatant: CombatantDto;
  busy: boolean;
  onRun: (action: () => Promise<CombatDto>) => void;
}) {
  const [elevation, setElevation] = useState(
    combatant.spatial?.elevationFeet == null
      ? ''
      : String(feetToMeters(combatant.spatial.elevationFeet)),
  );
  const [height, setHeight] = useState(
    combatant.spatial?.bodyHeightFeet == null
      ? ''
      : String(feetToMeters(combatant.spatial.bodyHeightFeet)),
  );
  const toFeet = (value: string) =>
    value.trim()
      ? metersToElevationFeet(Number(value.replace(',', '.')))
      : null;
  const level = toFeet(elevation);
  const body = toFeet(height);
  const valid =
    (level == null || (Number.isFinite(level) && Math.abs(level) <= 10_000)) &&
    (body == null || (Number.isFinite(body) && body > 0 && body <= 2000));
  return (
    <section className="combat-token-hp">
      <label>
        Elevação da base (m)
        <input
          type="text"
          inputMode="decimal"
          value={elevation}
          disabled={busy}
          placeholder="Superfície do terreno"
          onChange={(event) => setElevation(event.target.value)}
        />
      </label>
      <label>
        Altura corporal (m)
        <input
          type="text"
          inputMode="decimal"
          value={height}
          disabled={busy}
          placeholder="Não informada"
          onChange={(event) => setHeight(event.target.value)}
        />
      </label>
      <p className="section-note">
        Elevação é a altura da base em relação ao nível zero da cena. Altura
        corporal é independente do tamanho do token. Em branco, o caso permanece
        assistido.
      </p>
      <button
        className="btn btn-small"
        disabled={busy || !valid}
        onClick={() =>
          onRun(() =>
            api<{ combat: CombatDto }>(
              `/api/combat/${combat.id}/combatants/${combatant.id}/spatial-height`,
              {
                method: 'PATCH',
                body: {
                  elevationFeet: level,
                  bodyHeightFeet: body,
                  expectedVersion: combat.version,
                  operationId: createOperationId(),
                },
              },
            ).then((result) => result.combat),
          )
        }
      >
        Salvar alturas
      </button>
    </section>
  );
}
