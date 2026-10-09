/**
 * Ideias para o Mestre quando FALTAM recursos de acampamento.
 *
 * A lista é fixa e pequena (PASSO 27) e NÃO executa nada: nenhuma DC, nenhuma
 * rolagem, nenhum ganho de recurso, nenhuma consequência. É material de apoio
 * narrativo — quem decide e conduz é o Mestre.
 *
 * A 5.2.8 trará sugestões CONTEXTUAIS (região, perícias, NPCs, ouro, contexto
 * da sessão): por isso a lista é INJETÁVEL. Aqui nada disso é implementado.
 */
export interface CampSupplySuggestion {
  id: string;
  title: string;
  text: string;
  /** Perícias/caminhos POSSÍVEIS — sugestão, nunca uma DC nem uma rolagem automática. */
  hints: string[];
}

/** Biblioteca FIXA (PASSO 27) — sem enum de resolução, só ideias amplas. */
export const CAMP_SUPPLY_SUGGESTIONS: readonly CampSupplySuggestion[] = [
  {
    id: 'hunt',
    title: 'Caça ou coleta',
    text: 'O grupo pode procurar alimento nos arredores.',
    hints: ['Sobrevivência', 'Natureza'],
  },
  {
    id: 'npc',
    title: 'Ajuda de NPC',
    text: 'Um morador, viajante, templo ou comerciante pode oferecer comida ou abrigo.',
    hints: [],
  },
  {
    id: 'bargain',
    title: 'Barganha',
    text: 'Alguém pode fornecer recursos em troca de um favor, informação ou promessa.',
    hints: ['Persuasão', 'Enganação'],
  },
  {
    id: 'buy',
    title: 'Compra',
    text: 'Os personagens podem tentar adquirir os recursos restantes.',
    hints: [],
  },
  {
    id: 'environment',
    title: 'Recursos do ambiente',
    text: 'A região pode oferecer pesca, frutos, caça ou abrigo.',
    hints: ['Sobrevivência'],
  },
  {
    id: 'narrative',
    title: 'Consequência narrativa',
    text: 'O Mestre pode permitir o descanso em troca de um custo ou complicação narrativa.',
    hints: [],
  },
];

/**
 * Lista de sugestões (somente leitura).
 *
 * Recebe a lista por parâmetro para que a fase de sugestões CONTEXTUAIS possa
 * injetar as suas sem mudar este componente (PASSO 29) — mas nenhuma ação é
 * disparada a partir daqui: não há botão, estado nem chamada de API.
 */
export function CampSupplySuggestions({
  suggestions = CAMP_SUPPLY_SUGGESTIONS,
}: {
  suggestions?: readonly CampSupplySuggestion[];
}) {
  return (
    <div>
      <p className="section-note">
        Sugestões para o Mestre — nada aqui é aplicado automaticamente (sem DC, sem rolagem, sem
        recompensa).
      </p>

      <div className="suggestion-list" role="list">
        {suggestions.map((suggestion) => (
          <div className="suggestion-card" role="listitem" key={suggestion.id}>
            <strong className="suggestion-title">{suggestion.title}</strong>
            <p className="suggestion-text">{suggestion.text}</p>
            {suggestion.hints.length > 0 ? (
              <span className="suggestion-hints">
                Pode envolver: {suggestion.hints.join(' · ')}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
