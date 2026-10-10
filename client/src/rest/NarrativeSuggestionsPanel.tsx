import { useState, type ReactElement } from 'react';
import { Icon } from '../components/Icon';
import type { NarrativeRanking, RankedNarrativeSuggestion } from './narrativeSuggestions';

/**
 * Painel "Ideias para o Mestre" (5.2.8A/5.2.8B) — exclusivo do Mestre.
 *
 * Só APRESENTAÇÃO: recebe o ranking já calculado e mostra cards expansíveis. Não
 * há botão que role dado, defina DC, conceda recurso, crie encontro ou aplique
 * consequência — a única interação é abrir/fechar a ideia. Nenhuma mutação, nenhum
 * requisito de rede: a lista é inspiração, e a decisão continua sendo do Mestre.
 *
 * Reutiliza as classes de card já existentes (`.suggestion-*`), sem CSS novo:
 * o painel é a evolução do antigo `CampSupplySuggestions`, não um redesign.
 */
export function NarrativeSuggestionsPanel({
  ranking,
}: {
  ranking: NarrativeRanking;
}): ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div>
      <p className="section-note">
        Sugestões para o Mestre — ideias para a cena, nunca resolução. Nada aqui é aplicado
        automaticamente (sem DC, sem rolagem, sem recompensa).
      </p>

      {ranking.hasContext && ranking.contextNotes.length > 0 ? (
        <p className="section-note">
          <span className="muted">Contexto considerado:</span>{' '}
          {ranking.contextNotes.join(' · ')}
        </p>
      ) : (
        <p className="section-note">
          Sem contexto da mesa para priorizar: a lista abaixo é a biblioteca completa, sem
          destaque.
        </p>
      )}

      <div className="suggestion-list" role="list">
        {ranking.suggestions.map((ranked) => (
          <NarrativeSuggestionCard
            key={ranked.suggestion.id}
            ranked={ranked}
            expanded={openId === ranked.suggestion.id}
            onToggle={() =>
              setOpenId((current) => (current === ranked.suggestion.id ? null : ranked.suggestion.id))
            }
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Card de UMA ideia. `expanded` é controlado (o painel guarda qual está aberto)
 * para o teste conseguir renderizar os dois estados.
 */
export function NarrativeSuggestionCard({
  ranked,
  expanded,
  onToggle,
}: {
  ranked: RankedNarrativeSuggestion;
  expanded: boolean;
  onToggle: () => void;
}): ReactElement {
  const { suggestion, highlighted, reasons, participantNotes } = ranked;

  return (
    <div className="suggestion-card" role="listitem">
      <strong className="suggestion-title">{suggestion.title}</strong>
      {highlighted ? (
        <span className="suggestion-hints"> · Relevante para esta situação</span>
      ) : null}

      <p className="suggestion-text">{suggestion.summary}</p>

      {reasons.map((reason) => (
        <p className="suggestion-hints" key={reason}>
          {reason}
        </p>
      ))}

      <button type="button" className="btn btn-small" onClick={onToggle}>
        {expanded ? (
          <>
            <Icon name="x" size={13} /> Recolher
          </>
        ) : (
          'Ver possibilidades'
        )}
      </button>

      {expanded ? (
        <div>
          <p className="section-note">{suggestion.description}</p>

          <ul>
            {suggestion.possibilities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          {suggestion.hints.length > 0 ? (
            <span className="suggestion-hints">
              Pode envolver: {suggestion.hints.join(' ou ')}
            </span>
          ) : null}

          {participantNotes.map((note) => (
            <p className="suggestion-hints" key={note}>
              {note}
            </p>
          ))}

          <p className="section-note">
            O Mestre decide se há teste, qual é a dificuldade e qual consequência existe.
          </p>
        </div>
      ) : null}
    </div>
  );
}
