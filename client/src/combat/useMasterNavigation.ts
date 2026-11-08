import { useEffect, useState } from 'react';
import type { MasterTab } from '../components/master/MasterHome';

export type MasterPageTab = MasterTab | 'combat' | 'active-combat';

/** Um combate novo abre a aba temporária; atualizações de turno respeitam a navegação do Mestre. */
export function useMasterNavigation(combatId: string | null) {
  const [tab, setTab] = useState<MasterPageTab>('home');
  useEffect(() => {
    setTab(current => combatId ? 'active-combat' : current === 'active-combat' ? 'combat' : current);
  }, [combatId]);
  return { tab, setTab };
}
