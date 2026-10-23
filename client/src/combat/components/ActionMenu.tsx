import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import type { EconomyAction } from '../combatApi';
import type { CombatUsableItem } from '../../types';
import { ECONOMY_ACTION_VISUALS, type EconomyActionVisual } from '../combatVisuals';

/** Alvo válido para ESTABILIZAR (0 PV, vivo, sem estabilização/pendência). */
export interface StabilizeTarget {
  id: string;
  name: string;
}

interface ActionMenuProps {
  /** Sem NENHUMA opção (fora do turno, sem Ação livre, incapacitado). */
  disabled: boolean;
  /** As ações do catálogo exigem Ação livre; o contexto (levantar) nem sempre. */
  actionsDisabled?: boolean;
  /** Envia a ação escolhida para a MESMA infraestrutura de economia do servidor. */
  onSelect: (action: EconomyAction, extra?: { description?: string; trigger?: string; intent?: string }) => void;
  /**
   * LEVANTAR-SE — só existe quando o combatente ATIVO está Caído. Custo: metade
   * do deslocamento efetivo; NÃO gasta Ação. `null` = opção não aparece.
   * `available: false` NÃO esconde: mostra o motivo (velocidade 0 / movimento
   * insuficiente), porque o jogador está Caído e precisa entender o bloqueio.
   */
  standUp?: { cost: number; available: boolean; reason?: string } | null;
  onStandUp?: () => void;
  /** ESTABILIZAR — só aparece se existir ao menos um alvo elegível. */
  stabilizeTargets?: StabilizeTarget[];
  onStabilize?: (targetCombatantId: string) => void;
  /**
   * USAR ITEM — consumíveis com saldo do combatente. O servidor decide a
   * lista/efeito. `itemTargets` inclui o próprio usuário (primeiro); o custo é
   * 1 Ação (o servidor valida e consome atomicamente).
   */
  usableItems?: CombatUsableItem[];
  itemTargets?: StabilizeTarget[];
  onUseItem?: (itemInventoryId: string, targetCombatantId?: string) => void;
  busy?: boolean;
}

/**
 * Menu de AÇÃO ancorado à barra persistente e ABRINDO PARA CIMA (a barra vive
 * no rodapé). Não é modal nem painel permanente: fecha ao clicar fora, ao
 * pressionar Esc e após a seleção. Cada item traz a descrição curta do PHB 2014
 * (fonte única em `combatVisuals`). Nenhuma regra é reimplementada aqui — só
 * chamamos `executeEconomyAction` (ou o levantar-se do motor de condições).
 *
 * OPÇÕES CONTEXTUAIS (PHB 2014): LEVANTAR-SE aparece apenas para quem está
 * Caído e ESTABILIZAR apenas quando há alvo a 0 PV estabilizável. Sem contexto,
 * a opção NÃO existe — nada de botão permanentemente desabilitado.
 */
export function ActionMenu({
  disabled,
  actionsDisabled = false,
  onSelect,
  standUp = null,
  onStandUp,
  stabilizeTargets = [],
  onStabilize,
  usableItems = [],
  itemTargets = [],
  onUseItem,
  busy = false,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  // Formulário inline para as ações que exigem texto/escolha.
  const [form, setForm] = useState<'none' | 'ready' | 'improvised' | 'stabilize' | 'item'>('none');
  // Alvo do item (vazio = o próprio usuário, sempre a primeira opção).
  const [itemTargetId, setItemTargetId] = useState('');
  const [trigger, setTrigger] = useState('');
  const [intent, setIntent] = useState('');
  const [description, setDescription] = useState('');
  const anchor = useRef<HTMLDivElement>(null);

  const canStand = Boolean(standUp && onStandUp);
  const canActuallyStand = Boolean(standUp?.available);
  const canStabilize = stabilizeTargets.length > 0 && Boolean(onStabilize);
  const canUseItem = usableItems.length > 0 && Boolean(onUseItem);
  const standCost = standUp ? Number(standUp.cost.toFixed(2)) : 0;

  // Fora do turno/menu: recolhe tudo para não deixar estado pendurado.
  useEffect(() => {
    if (!open) setForm('none');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (anchor.current && !anchor.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function choose(item: EconomyActionVisual) {
    if (item.id === 'ready') return setForm('ready');
    if (item.id === 'improvised') return setForm('improvised');
    onSelect(item.id);
    setOpen(false);
  }

  function chooseStabilize() {
    if (stabilizeTargets.length === 1) {
      onStabilize?.(stabilizeTargets[0].id);
      setOpen(false);
      return;
    }
    setForm('stabilize');
  }

  const readyValid = trigger.trim() !== '' && intent.trim() !== '';
  const improvisedValid = description.trim() !== '';

  return (
    <div className="action-menu-anchor" ref={anchor}>
      <button
        type="button"
        className={open ? 'action-menu-trigger active' : 'action-menu-trigger'}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="sword" size={13} /> Ação
      </button>

      {open ? (
        <div className="action-menu" role="menu" aria-label="Ações gerais">
          <p className="action-menu-head">
            <Icon name="sword" size={13} /> Ação
          </p>

          {ECONOMY_ACTION_VISUALS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="action-menu-item"
              disabled={actionsDisabled || busy}
              onClick={() => choose(item)}
            >
              <span className="action-menu-item-head">{item.label}</span>
              <span className="action-menu-item-desc">{item.description}</span>
            </button>
          ))}

          {/* Contexto: só entra quando a regra permite. */}
          {canStand || canStabilize || canUseItem ? (
            <p className="action-menu-head action-menu-head-context">
              <Icon name="sparkle" size={13} /> Contexto
            </p>
          ) : null}

          {canStand ? (
            <button
              type="button"
              role="menuitem"
              className="action-menu-item context"
              disabled={busy || !canActuallyStand}
              title={
                standUp?.reason ??
                'Levantar-se custa metade do deslocamento efetivo e não gasta a Ação.'
              }
              onClick={() => {
                onStandUp?.();
                setOpen(false);
              }}
            >
              <span className="action-menu-item-head">
                <Icon name="wind" size={12} /> Levantar-se
              </span>
              <span className="action-menu-item-desc">
                {standUp?.reason ??
                  `Custo: metade do deslocamento (${standCost} m) — não gasta a Ação.`}
              </span>
            </button>
          ) : null}

          {canStabilize ? (
            <button
              type="button"
              role="menuitem"
              className="action-menu-item context"
              disabled={busy || actionsDisabled}
              title="O alvo precisa estar ao alcance físico do personagem. O Mestre resolve posicionamento quando necessário."
              onClick={chooseStabilize}
            >
              <span className="action-menu-item-head">
                <Icon name="flask" size={12} /> Estabilizar
              </span>
              <span className="action-menu-item-desc">
                Custo: 1 Ação — Sabedoria (Medicina) CD 10. O alvo precisa estar ao
                alcance físico; o Mestre resolve posicionamento quando necessário.
              </span>
            </button>
          ) : null}

          {canUseItem ? (
            <button
              type="button"
              role="menuitem"
              className="action-menu-item context"
              disabled={busy || actionsDisabled}
              title="O alvo precisa estar ao alcance físico. O Mestre resolve o posicionamento quando necessário."
              onClick={() => setForm(form === 'item' ? 'none' : 'item')}
            >
              <span className="action-menu-item-head">
                <Icon name="flask" size={12} /> Usar Item
              </span>
              <span className="action-menu-item-desc">
                Custo: 1 Ação — consome uma unidade. Itens sem efeito modelado são
                resolvidos pelo Mestre.
              </span>
            </button>
          ) : null}

          {form === 'item' && canUseItem ? (
            <div className="action-menu-form">
              {itemTargets.length > 1 ? (
                <label className="field">
                  <span>Alvo</span>
                  <select
                    value={itemTargetId}
                    onChange={(event) => setItemTargetId(event.target.value)}
                  >
                    <option value="">Em mim mesmo</option>
                    {itemTargets.slice(1).map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {usableItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className="action-menu-item"
                  disabled={busy}
                  title={item.description || undefined}
                  onClick={() => {
                    onUseItem?.(item.id, itemTargetId || undefined);
                    setForm('none');
                    setItemTargetId('');
                    setOpen(false);
                  }}
                >
                  <span className="action-menu-item-head">
                    {item.name} ×{item.quantity}
                  </span>
                  <span className="action-menu-item-desc">
                    {item.automated
                      ? `Cura ${item.healing?.count ?? 0}d${item.healing?.sides ?? 0}${
                          item.healing?.bonus ? `+${item.healing.bonus}` : ''
                        } — aplicada pelo servidor.`
                      : 'Resolução pelo Mestre — nenhum efeito é inventado.'}
                  </span>
                </button>
              ))}
              <p className="action-menu-note">
                O alvo precisa estar ao alcance físico. O Mestre resolve o
                posicionamento quando necessário.
              </p>
            </div>
          ) : null}

          {form === 'stabilize' && canStabilize ? (
            <div className="action-menu-form">
              <p className="action-menu-form-head">Quem estabilizar?</p>
              {stabilizeTargets.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  role="menuitem"
                  className="action-menu-item"
                  disabled={busy}
                  onClick={() => {
                    onStabilize?.(target.id);
                    setOpen(false);
                  }}
                >
                  <span className="action-menu-item-head">Estabilizar {target.name}</span>
                  <span className="action-menu-item-desc">0 PV — Medicina CD 10.</span>
                </button>
              ))}
            </div>
          ) : null}

          {form === 'ready' ? (
            <div className="action-menu-form">
              <label className="field">
                <span>Gatilho</span>
                <input
                  value={trigger}
                  maxLength={200}
                  placeholder="Quando algo acontecer..."
                  onChange={(event) => setTrigger(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Ação pretendida (sem magia)</span>
                <input
                  value={intent}
                  maxLength={500}
                  placeholder="O que você fará"
                  onChange={(event) => setIntent(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn-small btn-primary"
                disabled={!readyValid}
                onClick={() => {
                  onSelect('ready', { trigger, intent });
                  setOpen(false);
                }}
              >
                Preparar (gasta a Ação)
              </button>
            </div>
          ) : null}

          {form === 'improvised' ? (
            <div className="action-menu-form">
              <label className="field">
                <span>Descrição</span>
                <input
                  value={description}
                  maxLength={500}
                  placeholder="Ação improvisada combinada com o Mestre"
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn btn-small btn-primary"
                disabled={!improvisedValid}
                onClick={() => {
                  onSelect('improvised', { description });
                  setOpen(false);
                }}
              >
                Registrar ação
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
