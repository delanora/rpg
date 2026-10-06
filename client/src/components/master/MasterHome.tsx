import type { ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';

/** Abas do painel do mestre — a home concentra todas elas. */
export type MasterTab = 'home' | 'sheets' | 'creatures' | 'npcs' | 'regions' | 'items' | 'config';

interface Shortcut {
  tab: MasterTab;
  label: string;
  hint: string;
  icon: IconName;
  count: number;
  unit: string;
}

interface MasterHomeProps {
  /** Nome de exibição do mestre, para a saudação. */
  userName: string;
  sheets: number;
  creatures: number;
  npcs: number;
  regions: number;
  localities: number;
  items: number;
  levelUpRelease: number;
  startingLevel: number;
  extraCoins: boolean;
  /** Abre a aba escolhida (a home sai de cena). */
  onOpenTab: (tab: MasterTab) => void;
  onStartCombat: () => void;
  onReleaseLevelUp: () => void;
  /**
   * Busca global, renderizada ACIMA do salão. Vem como slot para a home seguir
   * sem conhecer os dados que a busca consulta.
   */
  search?: ReactNode;
}

/**
 * Central do mestre: o salão de entrada do painel.
 *
 * Antes o mestre caía direto na lista de fichas. Esta home é o hub que reúne
 * os atalhos de todas as abas, um resumo vivo da mesa e as ações rápidas
 * (iniciar combate e liberar Level Up) — sem tirar nenhuma aba do lugar nem
 * criar rota nova: é só a primeira aba do painel.
 */
export function MasterHome({
  userName,
  sheets,
  creatures,
  npcs,
  regions,
  localities,
  items,
  levelUpRelease,
  startingLevel,
  extraCoins,
  onOpenTab,
  onStartCombat,
  onReleaseLevelUp,
  search,
}: MasterHomeProps) {
  const shortcuts: Shortcut[] = [
    {
      tab: 'sheets',
      label: 'Fichas',
      hint: 'Personagens dos jogadores: ver, editar e subir de nível.',
      icon: 'users',
      count: sheets,
      unit: 'ficha(s)',
    },
    {
      tab: 'creatures',
      label: 'Criaturas',
      hint: 'Bestiário: monstros prontos para o combate.',
      icon: 'flame',
      count: creatures,
      unit: 'criatura(s)',
    },
    {
      tab: 'npcs',
      label: 'NPCs',
      hint: 'Aliados, vilões e gente do mundo da campanha.',
      icon: 'crown',
      count: npcs,
      unit: 'NPC(s)',
    },
    {
      tab: 'regions',
      label: 'Regiões',
      hint: 'Regiões, localidades e o mapa do mundo.',
      icon: 'book',
      count: regions,
      unit: 'região(ões)',
    },
    {
      tab: 'items',
      label: 'Itens',
      hint: 'Catálogo de itens e a entrega de moedas.',
      icon: 'flask',
      count: items,
      unit: 'item(ns)',
    },
    {
      tab: 'config',
      label: 'Mesa',
      hint: 'Compêndio, nível inicial e os ajustes da mesa.',
      icon: 'gear',
      count: 0,
      unit: '',
    },
  ];

  return (
    <div className="master-home">
      {search}

      <section className="home-hero">
        <span className="home-hero-mark">
          <Icon name="dragon" size={26} />
        </span>
        <h2 className="home-title">Salão do Mestre</h2>
        <p className="home-lede">
          Bem-vindo, {userName}. Reúna as fichas, o bestiário e o mundo da sua campanha aqui.
        </p>

        <ul className="home-stats">
          <li>
            <span className="home-stat-value">{sheets}</span>
            <span className="home-stat-label">Fichas</span>
          </li>
          <li>
            <span className="home-stat-value">{creatures}</span>
            <span className="home-stat-label">Criaturas</span>
          </li>
          <li>
            <span className="home-stat-value">{npcs}</span>
            <span className="home-stat-label">NPCs</span>
          </li>
          <li>
            <span className="home-stat-value">{regions}</span>
            <span className="home-stat-label">Regiões</span>
          </li>
          <li>
            <span className="home-stat-value">{localities}</span>
            <span className="home-stat-label">Localidades</span>
          </li>
          <li>
            <span className="home-stat-value">{items}</span>
            <span className="home-stat-label">Itens</span>
          </li>
        </ul>

        <div className="home-actions">
          <button type="button" className="btn btn-primary" onClick={onStartCombat}>
            <Icon name="sword" size={16} /> Iniciar combate
          </button>
          <button
            type="button"
            className="btn"
            onClick={onReleaseLevelUp}
            title={`Libera um Level Up para quem ainda não usou a liberação atual. Liberações dadas: ${levelUpRelease}.`}
          >
            <Icon name="sparkle" size={16} /> Liberar Level Up
            <span className="config-count">{levelUpRelease}</span>
          </button>
        </div>
      </section>

      <section className="home-section">
        <h3 className="home-section-title">
          <Icon name="table" size={16} /> Suas abas
        </h3>
        <ul className="home-cards">
          {shortcuts.map((shortcut) => (
            <li key={shortcut.tab}>
              <button
                type="button"
                className="home-card"
                onClick={() => onOpenTab(shortcut.tab)}
              >
                <span className="home-card-icon">
                  <Icon name={shortcut.icon} size={22} />
                </span>
                <span className="home-card-body">
                  <span className="home-card-name">{shortcut.label}</span>
                  <span className="home-card-hint">{shortcut.hint}</span>
                </span>
                {shortcut.unit ? (
                  <span className="home-card-count" title={`${shortcut.count} ${shortcut.unit}`}>
                    {shortcut.count}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="home-section">
        <h3 className="home-section-title">
          <Icon name="gear" size={16} /> Ajustes da mesa
        </h3>
        <dl className="home-meta">
          <div>
            <dt>Nível inicial</dt>
            <dd>{startingLevel}</dd>
          </div>
          <div>
            <dt>Moedas extras (PL/PE)</dt>
            <dd>{extraCoins ? 'Ligadas' : 'Desligadas'}</dd>
          </div>
          <div>
            <dt>Level Ups liberados</dt>
            <dd>{levelUpRelease}</dd>
          </div>
          <div>
            <dt>Localidades</dt>
            <dd>{localities}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
