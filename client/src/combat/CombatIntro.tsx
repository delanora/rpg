import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';

interface CombatIntroProps {
  combatId: string;
}

/**
 * Brasão de batalha exibido quando o combate começa, fazendo a tela "se
 * transformar". Aparece uma única vez por combate e por sessão (guardado no
 * sessionStorage), para não repetir a cada re-render ou reconexão.
 */
export function CombatIntro({ combatId }: CombatIntroProps) {
  const [visible, setVisible] = useState(() => {
    if (typeof sessionStorage === 'undefined') return true;
    return sessionStorage.getItem('grimorio.combatIntro') !== combatId;
  });

  useEffect(() => {
    if (!visible) return;

    try {
      sessionStorage.setItem('grimorio.combatIntro', combatId);
    } catch {
      // Sem sessionStorage o brasão apenas reaparece na próxima entrada.
    }

    const timer = window.setTimeout(() => setVisible(false), 2000);
    return () => window.clearTimeout(timer);
  }, [visible, combatId]);

  if (!visible) return null;

  return (
    <div className="combat-intro" aria-hidden="true">
      <div className="combat-intro-seal">
        <span className="combat-intro-swords">
          <Icon name="sword" />
          <Icon name="sword" />
        </span>
        <span className="combat-intro-text">Que comece a batalha</span>
        <span className="combat-intro-sub">que os dados decidam o destino</span>
      </div>
    </div>
  );
}
