import { Icon, type IconName } from '../../components/Icon';

const TURN_RESOURCES = [
  { key: 'movement', label: 'Movimento', icon: 'wind' },
  { key: 'action', label: 'Ação', icon: 'sword' },
  { key: 'bonus', label: 'Ação bônus', icon: 'sparkle' },
  { key: 'reaction', label: 'Reação', icon: 'shield' },
  { key: 'end', label: 'Fim do turno', icon: 'sun' },
] as const satisfies readonly { key: string; label: string; icon: IconName }[];

interface TurnResourceBarProps {
  /** O combate está ativo (fora da espera pela iniciativa). */
  active: boolean;
}

/**
 * Barra inferior persistente que prepara a interface para o futuro motor de
 * ações (Fase 8.1). Nesta etapa é SOMENTE visual: não consome nem controla
 * nenhum recurso — o backend ainda não governa a economia de ações. Por isso os
 * espaços aparecem como "em preparação" / "não controlado".
 */
export function TurnResourceBar({ active }: TurnResourceBarProps) {
  return (
    <section className="turn-resource-bar" aria-label="Recursos do turno">
      <span className="turn-resource-title">
        <Icon name="gear" size={14} /> Recursos do turno
      </span>

      <div className="turn-resource-list">
        {TURN_RESOURCES.map((resource) => (
          <span key={resource.key} className="turn-resource" aria-disabled="true">
            <Icon name={resource.icon} size={15} />
            <span className="turn-resource-label">{resource.label}</span>
            <span className="turn-resource-state">
              {active ? 'em preparação' : 'não controlado'}
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}
