import { useEffect, useState } from 'react';
import type { MasterTab } from '../components/master/MasterHome';

export type MasterPageTab = MasterTab | 'combat';

/** Um combate novo abre sua aba; atualizações de turno respeitam a navegação do Mestre. */
export function useMasterNavigation(combatId: string | null) {
  const [tab, setTab] = useState<MasterPageTab>('home');
  useEffect(() => {
    setTab(current => combatId ? 'combat' : current === 'combat' ? 'home' : current);
  }, [combatId]);
  return { tab, setTab };
}
