import { useState } from 'react';
import type { CampSupplyOverrideType, LongRestCampSuppliesDto } from '../types';

/**
 * Confirmação das exceções do Mestre sobre os recursos de acampamento.
 *
 * Duas intenções, visualmente distintas (PASSO 34):
 *  • NARRATIVE — o Mestre resolveu a falta dentro da ficção; a observação é
 *    OPCIONAL e curta (≤ 300 caracteres), porque serve para dar contexto à mesa
 *    e não para virar formulário burocrático.
 *  • ADMINISTRATIVE — o Mestre dispensou a exigência (mesa/teste); sem nota.
 *
 * Antes de confirmar, a UI informa que os pontos JÁ CONTRIBUÍDOS serão
 * consumidos (PASSO 35) — nada de surpresa depois.
 */
export function CampSupplyOverrideDialog({
  type,
  supplies,
  busy,
  onCancel,
  onConfirm,
}: {
  type: CampSupplyOverrideType;
  supplies: LongRestCampSuppliesDto;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (input: { type: CampSupplyOverrideType; note?: string }) => void;
}) {
  const [note, setNote] = useState('');
  const narrative = type === 'NARRATIVE';

  function confirm(): void {
    if (!narrative) {
      onConfirm({ type: 'ADMINISTRATIVE' });
      return;
    }
    const trimmed = note.trim();
    onConfirm({ type: 'NARRATIVE', ...(trimmed ? { note: trimmed } : {}) });
  }

  return (
    <div
      className={`override-card is-${narrative ? 'narrative' : 'administrative'}`}
      role="alertdialog"
      aria-label={narrative ? 'Conceder exceção narrativa' : 'Forçar administrativamente'}
    >
      <h4>{narrative ? 'Conceder exceção narrativa' : 'Forçar administrativamente'}</h4>

      <p className="section-note">
        {narrative
          ? 'Permitir Descanso Longo apesar dos recursos insuficientes?'
          : 'Isto ignora o requisito de recursos por uma decisão administrativa do Mestre.'}
      </p>

      <dl className="override-facts">
        <div>
          <dt>Recursos necessários</dt>
          <dd>{supplies.required}</dd>
        </div>
        <div>
          <dt>Contribuídos</dt>
          <dd>{supplies.contributed}</dd>
        </div>
        <div>
          <dt>Faltam</dt>
          <dd>{supplies.remaining}</dd>
        </div>
      </dl>

      {supplies.contributed > 0 ? (
        <p className="section-note">
          Os {supplies.contributed} pontos já oferecidos serão consumidos.
        </p>
      ) : null}

      {narrative ? (
        <>
          <p className="override-examples">
            Exemplos: ajuda de um NPC · caça ou coleta · barganha · abrigo · um favor · outra
            resolução narrativa.
          </p>

          <label className="field">
            <span>OBSERVAÇÃO NARRATIVA (OPCIONAL)</span>
            <textarea
              maxLength={300}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="O grupo conseguiu abrigo e comida em troca de um favor."
            />
          </label>
          <span className="muted">{note.length}/300</span>
        </>
      ) : null}

      <div className="modal-actions">
        <button type="button" className="btn btn-small" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          className={narrative ? 'btn btn-small btn-primary' : 'btn btn-small btn-danger'}
          disabled={busy}
          onClick={confirm}
        >
          {busy ? 'aplicando…' : narrative ? 'Permitir descanso' : 'Autorizar conclusão'}
        </button>
      </div>
    </div>
  );
}
