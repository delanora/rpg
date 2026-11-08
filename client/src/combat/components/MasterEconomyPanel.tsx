import { useState } from 'react';
import { Icon } from '../../components/Icon';
import type { CombatantDto, CombatDto } from '../../types';
import { overrideEconomy, type EconomyAdjustment } from '../combatApi';

const ADJUSTMENTS: { id: EconomyAdjustment; label: string }[] = [
  { id: 'grant-action', label: 'Conceder +1 Ação' },
  { id: 'restore-action', label: 'Recuperar Ações' },
  { id: 'restore-bonus', label: 'Recuperar Ação Bônus' },
  { id: 'restore-reaction', label: 'Recuperar Reação' },
  { id: 'set-movement', label: 'Ajustar Movimento restante' },
];

/** Ajuste administrativo: a justificativa opcional decide se haverá linha no registro. */
export function MasterEconomyPanel({ combat, combatant, busy, onRun, expanded = false }: {
  combat: CombatDto;
  combatant: CombatantDto;
  busy: boolean;
  expanded?: boolean;
  onRun: (action: () => Promise<CombatDto>) => void;
}) {
  const [adjustment, setAdjustment] = useState<EconomyAdjustment>('grant-action');
  const [reason, setReason] = useState('');
  const [remaining, setRemaining] = useState('0');

  const movementValid = adjustment !== 'set-movement' || (remaining.trim() !== '' &&
    Number.isFinite(Number(remaining)) && Number(remaining) >= 0 && Number(remaining) <= 9999);

  return (
    <details className="combat-subpanel combat-economy-panel" open={expanded || undefined}>
      <summary><Icon name="gear" size={13} /> Economia de ações</summary>
      <div className="combat-economy-fields">
        <label className="field"><span>Ajuste</span>
          <select aria-label="Ajuste de economia" value={adjustment} disabled={busy}
            onChange={event => setAdjustment(event.target.value as EconomyAdjustment)}>
            {ADJUSTMENTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        {adjustment === 'set-movement' ? <label className="field"><span>Movimento restante (m)</span>
          <input type="number" min={0} max={9999} step="0.5" aria-label="Movimento restante em metros"
            value={remaining} disabled={busy} onChange={event => setRemaining(event.target.value)} />
        </label> : null}
        <label className="field"><span>Justificativa <small>(opcional)</small></span>
          <textarea placeholder="Explique o ajuste, se quiser registrá-lo" aria-label="Motivo do ajuste"
            value={reason} maxLength={500} rows={2} disabled={busy} onChange={event => setReason(event.target.value)} />
        </label>
        <p className="field-hint">Sem justificativa, o ajuste não aparece no registro.</p>
        <button type="button" className="btn btn-small" disabled={busy || !movementValid}
          onClick={() => onRun(() => overrideEconomy(combat, {
            combatantId: combatant.id, adjustment,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            ...(adjustment === 'set-movement' ? { remaining: Number(remaining) } : {}),
          }))}>
          {reason.trim() ? 'Aplicar e registrar' : 'Aplicar ajuste'}
        </button>
      </div>
    </details>
  );
}
