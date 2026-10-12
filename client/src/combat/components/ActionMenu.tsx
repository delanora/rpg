import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import type { EconomyAction } from '../combatApi';
import { ECONOMY_ACTION_VISUALS, type EconomyActionVisual } from '../combatVisuals';

interface ActionMenuProps {
  /** Sem ação disponível (fora do turno, sem Ação livre ou incapacitado). */
  disabled: boolean;
  /** Envia a ação escolhida para a MESMA infraestrutura de economia do servidor. */
  onSelect: (action: EconomyAction, extra?: { description?: string; trigger?: string; intent?: string }) => void;
}

/**
 * Menu de AÇÃO ancorado à barra persistente e ABRINDO PARA CIMA (a barra vive
 * no rodapé). Não é modal nem painel permanente: fecha ao clicar fora, ao
 * pressionar Esc e após a seleção. Cada item traz a descrição curta do PHB 2014
 * (fonte única em `combatVisuals`). Nenhuma regra é reimplementada aqui — só
 * chamamos `executeEconomyAction`.
 */
export function ActionMenu({ disabled, onSelect }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  // Formulário inline para as duas ações que exigem texto (Preparar / Outra ação).
  const [form, setForm] = useState<'none' | 'ready' | 'improvised'>('none');
  const [trigger, setTrigger] = useState('');
  const [intent, setIntent] = useState('');
  const [description, setDescription] = useState('');
  const anchor = useRef<HTMLDivElement>(null);

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
              disabled={disabled}
              onClick={() => choose(item)}
            >
              <span className="action-menu-item-head">{item.label}</span>
              <span className="action-menu-item-desc">{item.description}</span>
            </button>
          ))}

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
