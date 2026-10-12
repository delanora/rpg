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

/**
 * Ajuste explícito do Mestre (override da economia). Fica no drawer recolhido
 * "Estado e ajustes" — a barra persistente é o lugar do fluxo normal; aqui é só
 * a exceção que o Mestre registra com motivo. Mesma rota de sempre
 * (`/economy/override`); nenhuma regra nova.
 */
export function MasterEconomyPanel({ combat, combatant, busy, onRun }: {
  combat: CombatDto;
  combatant: CombatantDto;
  busy: boolean;
  onRun: (action: () => Promise<CombatDto>) => void;
}) {
  const [adjustment, setAdjustment] = useState<EconomyAdjustment>('grant-action');
  const [reason, setReason] = useState('');
  const [remaining, setRemaining] = useState('0');

  return (
    <details className="combat-subpanel">
      <summary>
        <Icon name="gear" size={13} /> Ajuste explícito do Mestre
      </summary>
      <div className="hp-controls">
        <select
          aria-label="Ajuste de economia"
          value={adjustment}
          onChange={(event) => setAdjustment(event.target.value as EconomyAdjustment)}
        >
          {ADJUSTMENTS.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        {adjustment === 'set-movement' ? (
          <input
            type="number"
            min="0"
            step="0.5"
            aria-label="Movimento restante em metros"
            value={remaining}
            onChange={(event) => setRemaining(event.target.value)}
          />
        ) : null}
        <input
          placeholder="Motivo do ajuste"
          aria-label="Motivo do ajuste"
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
        />
        <button
          type="button"
          className="btn btn-small"
          disabled={busy || !reason.trim()}
          onClick={() =>
            onRun(() =>
              overrideEconomy(combat, {
                combatantId: combatant.id,
                adjustment,
                reason,
                ...(adjustment === 'set-movement' ? { remaining: Number(remaining) } : {}),
              }),
            )
          }
        >
          Aplicar e registrar
        </button>
      </div>
    </details>
  );
}
