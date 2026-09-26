# Revisão de Código — Codex do Aventureiro (D&D 5e)

> **Data:** 2026-09-26
> **Escopo:** backend (`src/`), frontend (`client/src/`) e schema Prisma.
> **Objetivo:** garantir **funcionalidade plena** e **escalabilidade em relação ao sistema de D&D 5e**.
> **Regra desta revisão:** nada foi alterado no código. Este documento reúne os pontos encontrados e as mudanças sugeridas (arquivo de trabalho para as próximas etapas).
> **Status do repositório no momento da revisão:** `f69c315` (main), typecheck limpo, smoke passando.

---

## 0. Resumo executivo

O projeto está **bem estruturado**: separação clara entre regras puras (`src/modules/shared/`), domínio por módulo, escrita HTTP + notificação WebSocket, DTOs derivados nunca gravados e um smoke test ponta a ponta bastante completo. As regras implementadas (modificadores, proficiência, multiclasse, ASI por classe, espaços de magia combinados) estão, em sua maioria, corretas.

Os riscos mais relevantes são:

| Área | Risco | Severidade |
|------|-------|------------|
| Concorrência | Sem transação/lock em Level Up, combate e edição de ficha → perdade de atualização / duplo level up | **Alta** |
| Regras D&D | Subclasse conjuradora (Trapaceiro/Cavaleiro Arcano) ignorada na magia de multiclasse | **Alta** |
| Regras D&D | PV inicial e PV de Level Up não seguem o PHB (hpMax fixo em 1; `hpCurrent` não sobe) | **Alta** |
| Consistência | `derived.spellSlots` calculado vs. `spells.slots` editável manualmente → dois números na mesma tela | **Média** |
| Escalabilidade | `republishSheetsWithCatalogItem` varre TODAS as fichas e recomputa DTO; eventos carregam a ficha inteira | **Média** |
| Segurança | Token de 7 dias sem revogação; `userId` do token não é reconciliado com o banco | **Média** |
| Segurança | `errorHandler` vaza `err.message` de erros 500 (internos) ao cliente | **Média** |
| Modelagem | Nenhuma restrição de "um combate ativo por vez" no banco | **Média** |
| Cobertura | Sem testes unitários das funções puras de regra; raças/antecedentes não modelados | **Média** |

---

## Parte A — Correção das regras de D&D 5e

### A1. Subclasse conjuradora não entra no nível de conjurador multiclasse — **Alta**
`src/modules/shared/classes.ts` → `multiclassCasterLevel()` e `pactMagicSlots()` leem apenas `definition.spellcasting.type`. As subclasses de **terço-conjurador** (Ladino **Trapaceiro Arcano** e Guerreiro **Cavaleiro Arcano**) têm conjuração própria em `SubclassDefinition.spellcasting`, mas não são somadas.
- **Efeito:** um Mago 3 / Ladino 9 (Trapaceiro Arcano) deveria ter nível de conjurador `3 + floor(9/3) = 6`, mas hoje calcula só `3`.
- **Sugestão:** calcular o tipo de conjuração por entrada considerando a subclasse escolhida (mesma lógica de `spellcastingOf` no DTO) e somar: completo + ½ meio + ⅓ terço.
- **Referência:** `classes.ts` (`multiclassCasterLevel`, `pactMagicSlots`); espelho em `characters.dto.ts` (`spellcastingOf`).

### A2. Magias preparadas por classe incompletas e DTO só mostra a primeira — **Média**
`characters.dto.ts` → `spellcastingOf()` calcula `preparedCount` apenas quando `config.learning === 'prepared' && config.type === 'full'`. Ficam de fora os **meio-conjuradores preparados** (Paladino/Patrulheiro), cuja fórmula é `mod. + floor(nível da classe / 2)`. Além disso, `derived.preparedSpellCount` usa somente o `primaryCasting` (primeira classe conjuradora), o que engana em fichas multiclasse.
- **Sugestão:** retornar `preparedCount` também para `half` preparados (com arredondamento para baixo) e expor o total como a **soma** das preparadas de cada classe (ou uma lista por classe).

### A3. Espaços de magia calculados x editáveis divergem — **Média**
`derived.spellSlots` (regra de multiclasse) é exibido em `SpellsSection.tsx`, enquanto a ficha continua editando livremente `spells.slots` (`max`/`used`) no mesmo painel. Não há sincronização nem aviso — há dois "totais" possíveis para o mesmo personagem.
- **Sugestão:** ou o `max` passa a ser **derivado** (somente `used` é editável), ou a seção marca claramente "espaços do sistema (referência)" x "controle manual da mesa".

### A4. Defesa sem Armadura em multiclasse combina o que deveria escolher — **Baixa/Média**
`classes.ts` → `mergeAdjustments()` usa `base.unarmoredDefense || extra` e um único `unarmoredDefenseAbility`. Um Bárbaro/Monge deveria **escolher** uma das fórmulas (10+DES+CON **ou** 10+DES+SAB), não misturar.
- **Sugestão:** ao combinar, manter a fórmula de maior valor e registrar qual classe a concedeu (ou exigir escolha no Level Up).

### A5. PV inicial e PV de Level Up fora do PHB — **Alta**
- `characters.service.ts` → `createCharacter()` cria a ficha com `hpMax = 1` (default do schema). O PHB define PV iniciais = **máximo do dado de vida + mod. de CON** no nível 1.
- `levelUpCharacter()` soma o ganho só em `hpMax`; o PHB soma em **máximo e atual**.
- **Sugestão:** ao escolher a primeira classe, calcular PV iniciais automaticamente (com opção de rolar/média, como no Level Up) e, no Level Up, somar o ganho em `hpCurrent` também.

### A6. Ataque Furtivo é aplicado automaticamente sem as condições táticas — **Média**
`combat.service.ts` → `rollSneakAttack()` adiciona o dano sempre que a arma é sutil/à distância e a feature existe. As condições reais (vantagem **ou** aliado adjacente ao alvo, sem desvantagem) não são verificadas.
- **Sugestão:** transformar em opção do jogador no ataque (checkbox "usar Ataque Furtivo") ou validar vantagem/posição quando o combate passar a rastreá-las.

### A7. Resistências, imunidades e vulnerabilidades — **Média**
`combat.service.ts` → `applyDamageResistance()` apenas **halva** o dano de um tipo resistido. As **imunidades** já existem no modelo de criatura (`Creature.immunities`) mas não são usadas no combate, e **vulnerabilidade** (dano dobrado) não existe.
- **Sugestão:** aplicar imunidade (0), resistência (½) e vulnerabilidade (×2) antes de debitar o HP; usar a lista de `immunities` da criatura.

### A8. Capacidade de carga simplificada — **Baixa**
`dnd5e.ts` → `carryingCapacity()` = FOR × 7,5 kg. Ignora tamanho (Pequeno ×½, Grande ×2) e traços como **Poderoso**. Como raça/tamanho não são modelados, registrar como limitação conhecida.
- **Sugestão:** adicionar `size` ao personagem (ou ao antecedente/raça) e multiplicar; manter 7,5 kg/Força como padrão Médio.

### A9. Bônus de atributo de feature vs. teto no Level Up — **Baixa**
`levelUpCharacter()` valida o +2 com base no valor **bruto** (`character[ability]`), enquanto o DTO usa valores **efetivos** (`abilityBonuses`/`abilityCaps`, ex.: Campeão Primitivo até 24). Pode haver divergência entre o que o assistente permite e o que a ficha mostra.
- **Sugestão:** validar o teto sobre o valor efetivo (reaproveitar o cálculo de `effectiveAbilities`).

### A10. Integração de armadura/escudo na CA — **Média**
`Item.armorClassBonus` é cadastrado, mas `armorClassHint` só cobre "sem armadura". Equipar uma armadura no inventário **não** altera a CA sugerida, e a CA final é sempre manual (`character.armorClass`).
- **Sugestão:** quando houver itens equipados com `armorClassBonus`, somar à CA sugerida (e/ou calcular a CA final automaticamente, com o valor manual como exceção).

### A11. XP é manual e não interage com o Level Up — **Baixa**
`xpForNextLevel` é exibido, mas subir de nível não exige/consome XP — depende só da liberação do mestre (decisão de design válida). Registrar para evitar expectativa de "XP destrava o botão".

### A12. Aumento de Atributo por classe e feats — **OK, com ressalva**
`asiLevelsFor` cobre Guerreiro (4/6/8/12/14/16/19), Ladino (4/8/10/12/16/19) e demais (4/8/12/16/19), e o Level Up checa o **nível da classe** — correto. Ressalva: talentos são apenas texto (sem efeito mecânico), o que está documentado, mas deve constar no roadmap.

---

## Parte B — Escalabilidade e concorrência

### B1. Sem transações em operações multi-passo — **Alta**
- `levelUpCharacter()`: lê a ficha → checa `lastLevelUpRelease` → grava. Dois POST simultâneos podem **subir dois níveis** com uma única liberação.
- `setLevelUpUnlocked()`: read-modify-write de `levelUpRelease` (corrida no contador).
- `resolveAttack()` / `changeHp()`: usam `character.hpCurrent` do snapshot carregado no início do ataque; dois ataques concorrentes **perdem dano** (last-write-wins).
- `startCombat()`: checa "já existe combate" e cria em duas etapas → dois combates ativos em corrida.
- **Sugestão:** envolver em `prisma.$transaction`; para HP, usar `UPDATE ... SET hpCurrent = GREATEST(0, hpCurrent - $dano)`; para o combate ativo, criar um **índice único parcial** (`WHERE status IN ('PENDING_INITIATIVE','ACTIVE')`).

### B2. `version` não é imposto no servidor — **Média**
O campo `version` serve só para ordenar eventos no cliente (`payload.character.version >= prev.version`). O `PATCH` não envia a versão esperada, então edições concorrentes (mestre + jogador) se sobrescrevem silenciosamente.
- **Sugestão:** aceitar `expectedVersion` opcional no PATCH e usar `updateMany({ where: { id, version }, ... })`, devolvendo `409` quando não bater.

### B3. `republishSheetsWithCatalogItem` é O(todas as fichas) — **Média**
`items.service.ts` → ao editar um item, carrega **todas** as fichas, filtra em JS e recomputa o DTO (com consulta extra de catálogo) para cada uma. Em uma mesa grande isso vira muitos eventos pesados.
- **Sugestão:** filtrar no banco (`jsonb` → consulta por `itemId` em `inventory`) e/ou publicar um evento leve (`item:updated`) e deixar o cliente re-sincronizar o inventário sob demanda.

### B4. Eventos carregam a ficha completa — **Baixa**
`sheet:updated`, `combat:updated` etc. enviam o DTO inteiro em toda alteração. Para uma mesa fixa é aceitável; se crescer, vale diff incremental.

### B5. Sem paginação nas listagens — **Baixa**
`/api/characters`, `/api/creatures`, `/api/items`, `/api/regions`, `/api/localities` devolvem tudo. Para uma mesa única, OK; documentar o limite.

### B6. Estado de tempo real em memória (single-process) — **Baixa (conhecido)**
`presence.ts` e `presentation.service.ts` vivem na memória do processo. Já está comentado no código que multi-instância exigiria adaptador Redis. Registrar no roadmap de escala.

### B7. `toSheetDto` consulta o catálogo a cada leitura — **Baixa**
Toda resposta de ficha (incluindo `changeHp` do combate) chama `loadCatalogLookup`. Poderia ser cacheado em memória por item ou carregado uma vez por requisição de combate.

---

## Parte C — Segurança

### C1. Token JWT de 7 dias, sem revogação — **Média**
`lib/jwt.ts` + `auth.middleware.ts`: o `userId`/`role` vêm **somente do token**; não há consulta ao banco. Um usuário deletado ou com papel alterado continua válido até expirar. Sem refresh token.
- **Sugestão:** validar existência do usuário (cache curto) no `authenticate`; reduzir a expiração e/ou adicionar `tokenVersion`.

### C2. `errorHandler` vaza mensagens de erro 500 — **Média**
`middlewares/errorHandler.ts` devolve `err.message` mesmo para 500 (ex.: erro do Prisma), expondo detalhes internos.
- **Sugestão:** para `status >= 500`, enviar mensagem genérica ("Erro interno do servidor") e só logar o detalhe.

### C3. Upload sem validação de conteúdo — **Baixa**
`lib/uploads.ts` valida apenas o MIME **declarado** na data URL e grava o buffer. Não há verificação da assinatura do arquivo (magic bytes). Com `Content-Type` correto no static, o risco é baixo, mas registrar.
- **Sugestão:** validar cabeçalhos (`\x89PNG`, `\xFF\xD8\xFF`, `RIFF....WEBP`, `GIF8`) antes de gravar.

### C4. CORS amplo + credenciais — **Baixa**
`http/app.ts` usa `origin: corsOrigins === '*' ? true : corsOrigins` com `credentials: true`. Como a autenticação é por **Bearer token** (não cookie), o impacto é baixo; ainda assim, em produção convém fixar as origens.

### C5. Rate limit só no auth — **Baixa (OK)**
`auth.routes.ts` tem `express-rate-limit`. As rotas de domínio não têm — aceitável, mas o `POST /api/characters/me/level-up` mereceria um limite simples para evitar spam.

### C6. Sem CSRF / sem headers extras — **Informativo**
Por usar Bearer token, não há CSRF. `helmet` está ativo e o CSP está configurado com `upgradeInsecureRequests: null` (necessário para acesso por IP). Adequado ao cenário.

---

## Parte D — Modelagem de dados (Prisma)

### D1. Falta o índice único parcial de "combate ativo" — **Média**
`Combat` tem `@@index([status])`, mas nada impede dois combates ativos. A checagem é só de aplicação.
- **Sugestão:** migração com índice único parcial (`WHERE status <> 'ENDED'`) e tratar o erro como `409`.

### D2. `Character` sem `@@index` para ordenação por nome — **Baixa**
`listCharacters` faz `orderBy: { name }`. Em mesa pequena, irrelevante; se crescer, adicionar índice.

### D3. JSONB validado apenas na aplicação — **Baixa (aceitável)**
`classes`, `inventory`, `spells`, `features`, `classState` são JSONB com validação Zod na leitura/escrita. Dados inválidos só entram por fora da API. `parseJson` já torna a leitura tolerante. OK.

### D4. `lastLevelUpRelease` no `Character` e `levelUpRelease` no `GameConfig` — **Baixa**
Design funcional, mas o "reset" depende de o personagem existir. Se uma ficha for apagada/recriada, o contador reinicia. Documentar.

### D5. Sem histórico/auditoria — **Informativo**
Só existe `version`. Para jogo não é necessário, mas um log de alterações ajudaria a investigar divergências em tempo real.

---

## Parte E — Arquitetura e manutenibilidade

### E1. `classes.ts` com ~2.500 linhas — **Média**
Concentra registro de classes, features, subclasses, pré-requisitos, magia de multiclasse e ASI. Dificulta navegação e revisão.
- **Sugestão:** quebrar por classe (`classes/barbarian.ts`, `classes/rogue.ts`, ...) e manter um `classes/index.ts` com o registro e os utilitários de multiclasse.

### E2. Tipos espelhados manualmente no cliente — **Média**
`client/src/types.ts` re-declara `ClassEntry`, `ClassOption`, `DerivedStats`, etc. Já houve necessidade de sincronizar à mão nesta etapa.
- **Sugestão:** gerar os tipos a partir dos DTOs do servidor (ex.: usar os tipos exportados por um pacote compartilhado) ou, no mínimo, um comentário "espelha X".

### E3. `res.data('class-rest')`/regra duplicada entre DTO e serviço — **Informativa**
`abilitiesOf` existe no `characters.service.ts` e o DTO monta `abilities` inline. Pequena duplicação que pode divergir.
- **Sugestão:** mover `abilitiesOf` para `shared/dnd5e.ts` e reusar.

### E4. `deriveStats` recebe muitos campos opcionais — **Baixa**
A assinatura cresceu (spellSlots, pactSlots, unarmoredDefense...). Considerar agrupar em um objeto `ClassContext` já calculado.

### E5. Rotas com `.then/.catch` vs. `async/await` — **Baixa**
`game-config.routes.ts` usa promessas encadeadas, diferente do restante. Padronizar em `async/await` e usar `next(err)` para o error handler.

### E6. `console.log/error` espalhado — **Baixa**
Sem logger estruturado. Sugestão: `pino` com `requestId`.

---

## Parte F — Frontend / UX / acessibilidade

### F1. Botão e fluxo de Level Up — **OK**
O botão respeita `levelUpUnlocked` e `lastLevelUpRelease < levelUpRelease`; o modal aplica tudo em uma chamada. Bom.

### F2. Modal sem foco preso e sem ESC — **Baixa**
`LevelUpDialog.tsx` (e `CombatStartDialog.tsx`) não fazem *focus trap* nem fecham com `Esc`.
- **Sugestão:** adicionar handler de `Esc` e foco inicial no modal.

### F3. `SpellsSection` mistura slots derivados e manuais — ver A3.
### F4. Seleção de atributo no ASI esconde opções por teto — **Baixa**
`abilityOptions()` filtra por `score + amount <= 20`; se todos estiverem no teto, o select fica vazio sem explicação.
- **Sugestão:** mostrar mensagem quando não houver atributo elegível.

### F5. Identidade: nível somente leitura — **OK**, mas o bloco "Primeira classe" depende de `classOptions` com `eligible`. Bom.
### F6. Acessibilidade geral — **Baixa**
Bom uso de `aria-label`. Faltam `role`/`aria-live` em eventos de tempo real (ex.: rolagem de dados, aviso de edição do mestre) para leitores de tela.

---

## Parte G — Testes e observabilidade

### G1. Sem testes unitários das funções puras — **Média**
`dnd5e.ts` e `classes.ts` são ideais para teste unitário (modificadores, proficiência, `multiclassCasterLevel`, `spellSlotsForCasterLevel`, `asiLevelsFor`, `averageHitDie`, tabela de XP). Hoje só há o smoke ponta a ponta.
- **Sugestão:** adicionar `vitest` e cobrir as funções puras, incluindo os casos de multiclasse (A1/A2).

### G2. Smoke forte, mas prepara estado via Prisma — **Informativo**
`setCharacterClasses()` grava direto no banco nos testes de regra. Funciona, porém mascara validações da API. Com o assistente de Level Up pronto, dá para exercitar níveis via endpoint.

### G3. Health check raso — **Informativo**
`/api/health` faz ping no banco. Sem métricas/latência. Suficiente por ora.

### G4. Sem testes de concorrência — **Média**
Justamente onde estão os riscos (B1). Sugestão: teste que dispara dois `level-up` simultâneos e espera **um** sucesso e um `409`.

---

## Parte H — Subsistemas de D&D ainda ausentes (roadmap de "plenitude")

Ordem sugerida por impacto na mesa:

1. **Raças e antecedentes** — hoje são texto livre. Sem isso não há bônus de atributo racial, deslocamento, visão no escuro, idiomas nem proficiências iniciais. É o buraco de regra mais visível.
2. **Catálogo de magias e listas por classe** — não há limite de magias conhecidas por classe, nem distinção truque/magia, nem listas de classe para escolher.
3. **Descanso com efeitos automáticos** — hoje `VitalsSection` faz descanso curto/longo, mas sem recuperar espaços de magia, PV por dado de vida (opcional) e usos por descanso de forma unificada (verificar o que o `shortRest`/`longRest` repõe hoje e completar).
4. **Condições e exaustão** — atordoado, caído, envenenado, exausto etc., com efeitos (vantagem/desvantagem, restrição de ações).
5. **Salvaguardas contra morte e estabilização** — HP 0 hoje é só 0.
6. **Concentração** — manter magia com salvaguarda de CON ao levar dano.
7. **Equipamento e CA automáticas** — integração de armadura/escudo (A10) e proficiências.
8. **Efeitos mecânicos dos talentos** (A12) — hoje apenas registro textual.
9. **Encontros/XP** — conceder XP por encontro derrotado, se desejado.

---

## Checklist priorizado — "dados a serem alterados"

> Marcações: **P0** = corrigir antes de uso intenso; **P1** = importante; **P2** = melhoria.

### Regras de D&D
- [ ] **P0** `classes.ts`: incluir conjuração de **subclasse** em `multiclassCasterLevel`/`pactMagicSlots` (Trapaceiro/Cavaleiro Arcano). _(A1)_
- [ ] **P0** `characters.service.ts`: PV iniciais = dado de vida máx + CON; no Level Up somar o ganho também em `hpCurrent`. _(A5)_
- [ ] **P1** `characters.dto.ts`: `preparedCount` para meio-conjuradores preparados e total por classe no multiclasse. _(A2)_
- [ ] **P1** `combat.service.ts`: imunidade/resistência/vulnerabilidade por tipo de dano (usar `Creature.immunities`). _(A7)_
- [ ] **P1** `SpellsSection.tsx` + DTO: decidir se `spellSlots` é derivado (recomendado) ou manual, e remover a duplicidade. _(A3)_
- [ ] **P1** Ataque Furtivo: condicionar a vantagem/aliado adjacente ou expor toggle. _(A6)_
- [ ] **P2** `mergeAdjustments`: escolher uma fórmula de Defesa sem Armadura no multiclasse. _(A4)_
- [ ] **P2** CA sugerida somar `armorClassBonus` de itens equipados. _(A10)_
- [ ] **P2** Validação de teto de atributo pelo valor efetivo no Level Up. _(A9)_
- [ ] **P2** Capacidade de carga por tamanho/traços. _(A8)_

### Concorrência e escalabilidade
- [ ] **P0** Transação/lock no Level Up (uma liberação = no máximo um uso). _(B1)_
- [ ] **P0** HP do combate com `UPDATE` atômico (`GREATEST(0, hpCurrent - dano)`). _(B1)_
- [ ] **P1** Transação em `setLevelUpUnlocked` (contador de liberação). _(B1)_
- [ ] **P1** Índice único parcial de "um combate ativo". _(B1/D1)_
- [ ] **P1** `expectedVersion` opcional no PATCH (controle otimista de concorrência). _(B2)_
- [ ] **P1** `republishSheetsWithCatalogItem`: filtrar no banco e/ou evento incremental. _(B3)_
- [ ] **P2** Cache do catálogo por requisição/curto prazo. _(B7)_

### Segurança
- [ ] **P1** `errorHandler`: mensagem genérica para erros 5xx. _(C2)_
- [ ] **P1** `authenticate`: reconciliar usuário/role com o banco (ou `tokenVersion`). _(C1)_
- [ ] **P2** Validar *magic bytes* no upload. _(C3)_
- [ ] **P2** Fixar `CORS_ORIGIN` em produção. _(C4)_
- [ ] **P2** Rate limit leve no `POST /api/characters/me/level-up`. _(C5)_

### Código e testes
- [ ] **P1** Quebrar `classes.ts` por classe. _(E1)_
- [ ] **P1** Adicionar testes unitários (vitest) das funções puras. _(G1)_
- [ ] **P1** Teste de concorrência do Level Up. _(G4)_
- [ ] **P2** Unificar tipos do cliente com os DTOs do servidor. _(E2)_
- [ ] **P2** Padronizar `async/await` em `game-config.routes.ts`. _(E5)_
- [ ] **P2** Logger estruturado (`pino`). _(E6)_
- [ ] **P2** Focus trap + `Esc` nos modais. _(F2)_

---

## Pontos fortes (preservar)

- Escrita sempre por HTTP + WebSocket apenas notificando; o autor é sempre carimbado pelo token.
- DTOs com valores derivados calculados no servidor; nada derivado é gravado.
- `parseJson` tolerante + Zod, evitando quebra por dado antigo em JSONB.
- Multiclasse correta na maior parte (features por classe, ASI por classe, salvaguardas somadas).
- Inventário espelhando o catálogo (uma fonte de verdade para nome/peso/atributos).
- Smoke test ponta a ponta cobrindo auth, tempo real, regras, combate, apresentação e Level Up.
- Boa separação de responsabilidades por módulo e uso consistente de `HttpError`.
