import { Icon } from '../../components/Icon';
import type { CombatantKind } from '../../types';

interface BattleWaitingPanelProps {
  /** Nome do combatente com o turno (informação pública da iniciativa). */
  name: string;
  kind: CombatantKind;
  /** Mestre observando o turno de um personagem de jogador. */
  isMaster: boolean;
}

/**
 * ANIMAÇÃO DE ESPERA — espada × escudo.
 *
 * Fonte ÚNICA da apresentação de espera (6.6M.6.2): a bandeja tática e a Hotbar
 * da dock em espera montam ESTE componente. Nada de segunda implementação da
 * mesma animação para depois precisar de manutenção em dobro. As classes
 * `.battle-waiting-*` continuam as do tema global, e cada contexto só ajusta
 * escala/medidas no CSS do workspace.
 */
export function BattleWaitingAnim() {
  return (
    <div className="battle-waiting-anim" aria-hidden="true">
      <span className="battle-waiting-sword">
        <Icon name="sword" size={30} />
      </span>
      <span className="battle-waiting-clash" />
      <span className="battle-waiting-shield">
        <Icon name="shield" size={30} />
      </span>
    </div>
  );
}

/**
 * PAINEL NEUTRO DO ESPECTADOR.
 *
 * Ocupa o lugar do painel operacional para quem NÃO controla o combatente do
 * turno: nenhum ataque, bônus, alvo, movimento, Ação Bônus ou Encerrar Turno é
 * exibido — só uma animação discreta de espada × escudo e o nome de quem age.
 *
 * É apresentação pura: a privacidade de verdade (vida/CA/deathState de
 * criaturas e NPCs) é aplicada pelo SERVIDOR no DTO.
 */
export function BattleWaitingPanel({ name, kind, isMaster }: BattleWaitingPanelProps) {
  return (
    <section className="battle-waiting" aria-label="Aguardando a ação do turno">
      <BattleWaitingAnim />

      <p className="battle-waiting-title">
        {isMaster ? 'Aguardando a ação do jogador' : 'Aguardando ação...'}
      </p>
      <p className="battle-waiting-name">
        Turno de <strong>{name}</strong>
        <span className="battle-waiting-kind">
          {kind === 'CREATURE' ? 'criatura' : kind === 'NPC' ? 'NPC' : 'personagem'}
        </span>
      </p>
    </section>
  );
}

/**
 * ESPERA COMPACTA NA HOTBAR (6.6M.6.2).
 *
 * Variante da MESMA apresentação para a região funcional da dock do jogador
 * enquanto o turno é de outro combatente. Não é overlay, não bloqueia retrato,
 * utilitários, painel de Reação, salvaguardas pendentes nem Testes Contra a
 * Morte: ocupa só a coluna central (o lugar dos slots).
 */
export function BattleWaitingInline({ name }: { name: string }) {
  return (
    <div className="hotbar-waiting" role="status">
      <BattleWaitingAnim />
      <p className="hotbar-waiting-text">
        Aguardando <strong>{name}</strong> agir…
      </p>
    </div>
  );
}
