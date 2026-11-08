import type { CSSProperties } from 'react';
import type { CombatPingPayload } from '../../types';
import { feetToScenePixel, sceneToScreen, type GridCamera } from './gridCamera';

/** Projeta na tela para manter bandeira e nome legíveis em qualquer zoom. */
export function GridPings({ pings, camera, geometry }: {
  pings: CombatPingPayload[]; camera: GridCamera;
  geometry: { pixelsPerCell: number; cellSizeFeet: number };
}) {
  return <div className="grid-pings" aria-live="polite" aria-atomic="false">
    {pings.map(ping => {
      const point = sceneToScreen(camera, feetToScenePixel(ping.position, geometry));
      return <div key={ping.id} className="grid-ping" style={{ left: point.x, top: point.y,
        '--ping-color': ping.color } as CSSProperties}>
        <span className="grid-ping-ring" aria-hidden="true" />
        <span className="grid-ping-flag" aria-hidden="true">⚑</span>
        <span className="grid-ping-author">{ping.authorName}</span>
      </div>;
    })}
  </div>;
}
