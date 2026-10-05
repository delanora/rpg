# Revisão de Código — Codex do Aventureiro (D&D 5e)

> **Data:** 2026-09-26
> **Escopo:** backend (`src/`), frontend (`client/src/`) e schema Prisma.
> **Objetivo:** garantir **funcionalidade plena** e **escalabilidade em relação ao sistema de D&D 5e**.
> **Regra desta revisão:** nada foi alterado no código. Este documento reúne os pontos encontrados e as mudanças sugeridas (arquivo de trabalho para as próximas etapas).
> **Status do repositório no momento da revisão:** `f69c315` (main), typecheck limpo, smoke passando.
>
> **Atualizações:** os itens **A13**, **A14** e **A15** foram acrescentados em **2026-09-28** já com o resultado da correção/implementação (multiclasse fiel ao PHB: pré-requisito das classes atuais, salvaguardas só da primeira classe e proficiências de armadura/arma/ferramenta). Na mesma data a **Fase 0** fechou as regras base de PV e CA (**A4**, **A5** e **A10** corrigidos) e as **9 subclasses do PHB** que faltavam (**A19**), com a regressão coberta pelas seções **14 a 19** do smoke. O **dano dos ataques** também deixou de ser texto livre: passou a ser **estruturado** (`{ count, sides, bonus, type }`, tipo entre os 13 canônicos), com migração dos dados antigos (`npm run migrate:attack-damage`), `damageBonus` nos itens de arma e a resistência usando o tipo estruturado. Os itens **Arma/Cajado** ganharam o **perfil de arma do PHB** (uso corpo a corpo/à distância, categoria simples/marcial, propriedades, dado versátil e alcances em metros), com coerência validada (`npm run migrate:item-weapons` completa os itens antigos). O mestre também passou a decidir, por arma, se ela **exige munição**: a categoria **Munição** (Flecha/Virote/Bala de funda/Agulha de zarabatana, com bônus mágicos) foi criada, o ataque pode ser **vinculado a uma arma equipada** (some da ficha se a arma sair da mão) e o combate **consome 1 munição por ataque**, somando os bônus da pilha e publicando `sheet:updated`. Em **2026-09-29** entrou o **sistema de moedas da ficha**: carteira `{ pp, gp, ep, sp, cp }` (JSONB, migration com backfill zerado), em que o jogador **nunca** altera por PATCH (403 com o rótulo "Moedas", mesmo antes de finalizar a criação), o mestre dá/retira (`POST /api/characters/:id/coins`, com trava contra saldo negativo por concorrência) e o jogador **gasta** (`/me/coins/spend`, exato e sem troco), **troca** (`/me/coins/exchange`, conversões do PHB, recusando fração) e **transfere** para outro jogador (`/me/coins/transfer`, transação com as duas fichas e `sheet:updated` nas duas). As moedas pesam 0,01 kg cada (50 = 0,5 kg) dentro de `derived.totalWeight`, e a chave `extraCoins` da mesa (aba **Mesa**, publica `game:config`) liga a exibição de **PL (pp)** e **PE (ep)**. Cobertura na seção **20** do smoke. Logo depois, o **inventário** deixou de ser editável pelo jogador: qualquer PATCH de `inventory` vindo dele é **403** em qualquer fase (inclusive durante a criação, com o rótulo "Inventário"), restando a movimentação (`POST /me/inventory/move`, que nunca toca a quantidade), o novo **uso de consumível** (`POST /me/inventory/use`, que desconta 1 unidade com proteção de concorrência, remove a entrada ao zerar e, com `effectRoll`, devolve a rolagem do efeito registrada como `kind: 'item'` no log) e os itens que o mestre envia. Quantidade, inclusão e remoção ficaram exclusivas do mestre pelo PATCH da ficha, e a categoria **Item Geral/Outro** ganhou o campo `consumable` para marcar o que o jogador pode usar. Cobertura na seção **21** do smoke. Em **2026-09-29** a **Fase 2 virou cobertura de teste** (seções **22 a 26** do smoke): expressão textual DERIVADA do dano estruturado e crítico dobrando os dados com o modificador uma única vez; tipo fora dos 13 canônicos (400); ataque legado preservado com a marca e o texto; o preço do catálogo não indo para a ficha do jogador; arma sem `ammunition` não consumindo e o bônus da munição mágica somando ao ataque E ao dano; **concorrência da munição** (duas requisições simultâneas não gastam a mesma unidade); a transferência de moedas publicando `sheet:updated` nas DUAS fichas, com recusa de saldo insuficiente e de destino mestre; `extraCoins` publicando `game:config`; e o ajuste/remoção de item pelo mestre mais o log `kind: 'item'` do uso de consumível. Em **2026-09-29** o **ataque derivado da arma equipada** foi implementado (`src/modules/shared/weapon-attacks.ts`, exposto como `derivedAttacks` no DTO da ficha e incluído em `combatantAttacks`): habilidade FOR no corpo a corpo / DES à distância / a MELHOR das duas com acuidade, proficiência somada por **categoria** e por **nome** (comparação tolerante a plural/acento), dado **versátil** com a outra mão livre, arma de **duas mãos** com a outra mão ocupada listada mas **recusada (400)**, **segunda arma leve** sem o modificador de dano, variante de **arremesso** (`ranged` usando FOR) e **golpe desarmado**. Cobertura na seção **27** do smoke (incluindo a resolução no combate e o Ataque Furtivo da arma sutil). **Continua PENDENTE (P1/A15) apenas o efeito mecânico das proficiências de ARMADURA na CA** (somar armadura/escudo só com proficiência e penalidades de armadura). Registro completo em `ARQUITETURA-DO-SISTEMA.txt` (`[LACUNA/FASE 2]` e `[IMPLEMENTADO] ATAQUE DERIVADO`). Também em **2026-09-29** o mestre ganhou o **downgrade de nível** (`POST /api/characters/:id/level-down`): o Level Up passou a gravar o **histórico do que cada nível concedeu** (`characters.levelHistory` — dado/rolagem de PV com o delta retroativo de CON, Aumento de Atributo ou Talento, escolhas, subclasse, perícia de multiclasse e proficiências, migração `20260929140000_character_level_history`) e o downgrade reverte exatamente isso; nível 1 → 0 **remove a classe** da ficha (mantendo as proficiências que as classes restantes também concedem), a última classe do personagem e o jogador (403) são recusados, e os níveis **anteriores ao histórico** voltam com `warnings` e PV estimado pela média do dado de vida. Cobertura na seção **28** do smoke. Ver `[IMPLEMENTADO] HISTÓRICO DE NÍVEL E DOWNGRADE PELO MESTRE`. Também em **2026-09-29** cada arma/ataque passou a poder dar **vários tipos de dano independentes**: `attack.damage` segue sendo o principal (o único que o combate rola hoje) e `extraDamages` guarda os adicionais (mesmo formato `{ count, sides, bonus, type }`, teto de 10), valendo para os ataques da ficha, os das criaturas (`Creature.attacks`) e as armas dos `details` do catálogo — o item enviado e o **ataque derivado** da arma equipada levam os extras junto. A interface manteve a linha de dano como estava e ganhou um "+" que acrescenta uma parcela (mesmos campos + o tipo, com "×" para remover), sem bloquear repetição de tipo. **Falta** percorrer `attackDamages()` no combate e aplicar imunidade/resistência/vulnerabilidade **por parcela** (A7). Cobertura na seção **29** do smoke.

---

## 0. Resumo executivo

O projeto está **bem estruturado**: separação clara entre regras puras (`src/modules/shared/`), domínio por módulo, escrita HTTP + notificação WebSocket, DTOs derivados nunca gravados e um smoke test ponta a ponta bastante completo. As regras implementadas (modificadores, proficiência, multiclasse, ASI por classe, espaços de magia combinados) estão, em sua maioria, corretas.

Os riscos mais relevantes são:

| Área | Risco | Severidade |
|------|-------|------------|
| Concorrência | Sem transação/lock em Level Up, combate e edição de ficha → perdade de atualização / duplo level up | **Alta** |
| Regras D&D | Subclasse conjuradora (Trapaceiro/Cavaleiro Arcano) ignorada na magia de multiclasse | **Alta** |
| Consistência | `derived.spellSlots` calculado vs. `spells.slots` editável manualmente → dois números na mesma tela | **Média** |
| Escalabilidade | `republishSheetsWithCatalogItem` varre TODAS as fichas e recomputa DTO; eventos carregam a ficha inteira | **Média** |
| Segurança | Token de 7 dias sem revogação; `userId` do token não é reconciliado com o banco | **Média** |
| Segurança | `errorHandler` vaza `err.message` de erros 500 (internos) ao cliente | **Média** |
| Modelagem | ~~Nenhuma restrição de "um combate ativo por vez" no banco~~ → resolvido com o índice parcial `combats_one_active_key` | **Resolvido** |
| Cobertura | Sem testes unitários das funções puras de regra; raças/antecedentes não modelados | **Média** |

---

## Parte A — Correção das regras de D&D 5e

### A1. Subclasse conjuradora não entra no nível de conjurador multiclasse — **CORRIGIDO (2026-09-28)**
`multiclassCasterLevel()` e `pactMagicSlots()` liam apenas `definition.spellcasting.type`. As subclasses de **terço-conjurador** (Ladino **Trapaceiro Arcano** e Guerreiro **Cavaleiro Arcano**) têm conjuração própria em `SubclassDefinition.spellcasting`.
- **Efeito (antes):** um Mago 3 / Ladino 9 (Trapaceiro Arcano) deveria ter nível de conjurador `3 + floor(9/3) = 6`, mas calculava só `3`.
- **Feito:** as duas funções passam por `effectiveSpellcasting(entry)`, que resolve a subclasse escolhida antes da classe — hoje Mago 3 / Ladino 9 (Trapaceiro) dá nível de conjurador **6** (espaços 4/3/3). O mesmo vale para `ownCasterLevel` e `preparedSpellCountFor`.
- **Referência:** `classes/index.ts` (`effectiveSpellcasting`, `multiclassCasterLevel`, `pactMagicSlots`); espelho em `characters.dto.ts` (`spellcastingOf`).

### A2. Magias preparadas por classe incompletas e DTO só mostra a primeira — **CORRIGIDO (2026-09-28)**
`characters.dto.ts` → `spellcastingOf()` calculava `preparedCount` apenas quando `config.learning === 'prepared' && config.type === 'full'`. Ficavam de fora os **meio-conjuradores preparados** (Paladino) e `derived.preparedSpellCount` usava só a primeira classe conjuradora, o que engana em fichas multiclasse.
- **Feito:** `preparedSpellCountFor(entry, mod)` em `shared/classes/index.ts` é hoje a única fonte: **Clérigo/Druida/Mago** = `max(1, mod + nível da classe)`; **Paladino** = `max(1, mod + floor(nível da classe / 2))`, com **zero** abaixo do nível 2 (não conjura no 1º nível); **conjuradores conhecidos** (Bardo, Feiticeiro, Bruxo, Patrulheiro e os terço-conjuradores Trapaceiro/Cavaleiro Arcano) devolvem `null` — não usam a fórmula.
- **Onde aparece:** `CharacterDto.classes[].spellcasting.preparedCount`, calculado **por classe**, com o próprio atributo e o próprio nível de classe. O total único `derived.preparedSpellCount` foi **removido** do DTO por ser enganador em multiclasse; os textos da ficha (`SpellsSection.tsx`) e do Level Up passaram a ler o valor por classe.

### A17. Bardo, Guerreiro, Paladino e Patrulheiro não tinham NENHUMA característica de classe — **CORRIGIDO (2026-09-28)**
Os quatro arquivos tinham `features: NO_FEATURES` (13 linhas cada): a ficha dessas classes não mostrava nada na aba Características e nenhum efeito (Inspiração de Bardo, Surto de Ação, Aura de Proteção...) existia.
- **Feito:** as características de CLASSE dos quatro foram cadastradas com os efeitos que o motor já sabe aplicar. Bardo: Inspiração de Bardo (usos = mod. de CAR, mínimo 1), Pau para Toda Obra, Canção de Descanso, Especialização, Fonte de Inspiração (recarga curta no 5), Contra-encanto, Segredos Mágicos (10/14/18) e Inspiração Superior. Guerreiro: Estilo de Luta (escolha), Retomar o Fôlego, Surto de Ação (2 usos no 17), Ataque Extra (5/11/20) e Indomável (1/2/3 usos). Paladino: Sentido Divino, Mãos Consagradas (5 × nível), Estilo de Luta (2), Destruição Divina (2 e 11), Saúde Divina, Ataque Extra, Aura de Proteção, Aura de Coragem e Toque Purificador. Patrulheiro: Inimigo Favorito e Explorador Nato (com as melhorias do 6/10/14), Estilo de Luta (2), Consciência Primitiva, Ataque Extra, Esconder-se à Vista de Todos, Desaparecer, Sentidos Selvagens e Matador de Inimigos.
- **Efeitos novos no motor:** `armorClass` (+1 CA da Defesa, só com armadura), `saveBonus` (Aura de Proteção: mod. de CAR, mínimo +1, em TODAS as salvaguardas) e `halfProficiency` (metade da proficiência em testes de habilidade sem proficiência — perícias E iniciativa —, com "vale o maior" quando dois efeitos caem no mesmo teste). Recursos ganharam piso (`min`) para o "1 + mod. de CAR, mínimo 1".
- **Escolhas de característica:** mecanismo genérico em `classState.choices[featureId]` (JSONB, sem migração), declarado pela própria característica (`choice: { count, options, level, prompt }`) e validado por `resolveFeatureChoices` no Level Up e no passo 5 do assistente. Hoje: Estilo de Luta (Guerreiro 1, Paladino 2, Patrulheiro 2), Inimigo Favorito (Patrulheiro 1/6/14) e Explorador Nato (Patrulheiro 1/6/10). Campo de CONSTRUÇÃO: com a criação finalizada o jogador recebe 403 e só o mestre edita (a comparação ignora a ordem das chaves, que o JSONB reordena).
- **Pendências registradas nos arquivos das classes:** PENDENTE Fase 5 (combate por ação/reação/rolagem: gastar Surto de Ação, Retomar o Fôlego, inspirações, auras em aliados, os Estilos de Luta que não a Defesa...) e PENDENTE Fase 4 (Destruição Divina e Segredos Mágicos, que dependem de espaços/catálogo de magias). O reset por descanso continua na Fase 6 — cada recurso só guarda o tipo.
- **Achados da auditoria das outras 8 classes:** Bárbaro, Druida, Monge, Feiticeiro, Mago, **Clérigo**, **Bruxo** e **Ladino** estão completos (o Ladino recebeu a **Gíria de Ladrão** — texto puro, nível 1). (ver A18)

### A19. As 9 subclasses do PHB que faltavam (Bardo, Guerreiro, Paladino, Patrulheiro) — **CORRIGIDO (2026-09-28)**
Bardo, Guerreiro, Paladino e Patrulheiro tinham `subclasses: NO_SUBCLASSES`: com a mesa começando no nível 3+ o Level Up pedia uma subclasse que **não existia no catálogo** e travava; além disso, o Campeão (crítico com 19–20) e o Cavaleiro Arcano (terço-conjurador) não existiam, e as escolhas do Caçador não tinham onde ser feitas.
- **Feito — Bardo:** Colégio do Conhecimento (Proficiências Adicionais: 3 perícias com `apply: 'skill'`, que viram proficiência de verdade na ficha; Palavras de Interrupção, Segredos Mágicos Adicionais, Perícia Inigualável) e Colégio da Bravura (`proficiencies` de subclasse — armaduras médias, escudos e armas marciais — somadas às da classe quando escolhida; Inspiração de Combate, Ataque Extra, Magia de Batalha).
- **Feito — Guerreiro:** **Campeão** (Crítico Aprimorado, Atleta Extraordinário, Estilo de Luta Adicional, Crítico Superior, Sobrevivente), **Mestre da Batalha** (Superioridade em Combate: 4/5/6 dados d8→d10→d12 de descanso curto; as 16 manobras do PHB; Estudante da Guerra; Conheça seu Inimigo; Implacável) e **Cavaleiro Arcano** (conjuração `third` de INT sobreposta à da classe, reaproveitando a máquina do Trapaceiro Arcano; Vínculo com Arma, Magia de Guerra, Golpe Místico, Carga Arcana, Magia de Guerra Aprimorada).
- **Feito — Paladino:** Devoção, Anciões e Vingança, cada um com **Canalizar Divindade** (1 uso, descanso curto ou longo), as **magias de juramento** como texto nos níveis 3/5/9/13/17 (listas exatas do PHB; sempre preparadas e fora do limite — o vínculo com o catálogo é da Fase 4) e as características de 7/15/20.
- **Feito — Patrulheiro:** **Caçador** com as quatro escolhas do arquétipo (Presa do Caçador no 3º, Táticas Defensivas no 7º, Multiataque no 11º e Defesa Superior no 15º) e **Senhor das Feras** (companheiro animal como característica informativa — a ficha do companheiro é Fase 5).
- **Motor — novo efeito `critThreshold`:** o ataque do combate passa a usar o limiar da ficha (`characterCritThreshold`, padrão 20); crítico sempre acerta, **1 natural sempre erra** e o **MENOR limiar prevalece** no multiclasse. `halfProficiency` ganhou `round: 'up'` (Atleta Extraordinário) e `SubclassDefinition.proficiencies` é somado no Level Up por `subclassProficiencyGrant`.
- **Motor — escolha no MESMO nível da subclasse:** `featureChoiceInfo`/`pendingFeatureChoices`/`resolveFeatureChoices` recebem o nome da subclasse e usam `featuresWithSubclass`. Como o DTO da classe só enxerga as escolhas da subclasse **depois** que ela está gravada, `classOptionsFor` passou a expor `classOptions[].subclassChoices` (`FeatureChoiceInfo & { subclass }`) — é dele que o `LevelUpDialog` tira o passo quando a subclasse é escolhida agora (Caçador 3º, Colégio do Conhecimento 3º). Trocar de subclasse descarta as escolhas da anterior.
- **Cobertura:** smoke seção **11.5d** (catálogo das 9 subclasses + `subclassChoices` do Caçador; crítico 19/18; Atleta Extraordinário para cima na iniciativa e em FOR/DES/CON; dados de superioridade 4/5/6; as 16 manobras; Estudante da Guerra; terço-conjurador com espaços 2 e depois 4/2; Canalizar Divindade e as 5 faixas de juramento; Colégio do Conhecimento e da Bravura subindo de nível de verdade; Caçador e Senhor das Feras pelo Level Up). 23 verificações.

### A18. Clérigo e Bruxo sem características de classe — **CORRIGIDO (2026-10-04)**
Só as subclasses estavam cadastradas nos dois; agora ambos têm a classe completa.
- **Feito — Clérigo:** características de classe e os **7 Domínios Divinos**. **Canalizar Divindade** usa contador por `maxByLevel` — **1 uso no 2º nível, 2 no 6º e 3 no 18º** (o valor 2/3/4 que constava aqui estava **errado**: o PHB 2014 é 1/2/3), recuperado num descanso curto ou longo; as opções (Expulsar Mortos-Vivos + a de cada domínio) são **toggles** que gastam esse recurso (padrão do Ki do monge). Também entram Destruir Mortos-Vivos (5), Intervenção Divina (10) e Aprimorada (20), as proficiências/reações/resistências de cada domínio (armadura pesada, armas marciais, Lampejo Protetor, Fúria da Tempestade, Sacerdote de Guerra, Avatar da Batalha...) e as **magias de domínio** como texto nos níveis 1/3/5/7/9 (sempre preparadas, fora do limite). De quebra, `resolveClassPatch` passou a aplicar as proficiências da **subclasse escolhida no nível 1** já na criação (antes só o Level Up as aplicava).
- **Feito — Bruxo:** **Dádiva do Pacto** (escolha no 3: Lâmina/Corrente/Grimório) e **Invocações Místicas** como `choice` crescente (2 no 2º, +1 em 5/7/9/12/15/18, `excludeChosen`). **Mecanismo novo:** `FeatureChoiceOption` ganhou `requiresLevel` e `requiresPact`; `featureChoiceInfo` (agora com o nível da classe) esconde as opções não elegíveis e `resolveFeatureChoices` as recusa. Só as invocações do PHB que não dependem de magia foram cadastradas (Influência Sedutora, Visão do Abismo, Olhos do Guardião de Runas, Olhar de Duas Mentes, Um com as Sombras, Voz do Mestre das Correntes, Visão de Bruxa, Lâmina Sedenta e Sorvedouro de Vida). **Arcanum Místico** (11/13/15/17) e as **listas expandidas** dos patronos ficam como texto até a Fase 4 (uma `choice` sem opções quebraria o Level Up). **Mestre Místico** (20): recurso 1x/descanso longo. Os 3 patronos ganharam as características de 1/6/10/14 (Presença Feérica, Escape Enevoado, Bênção do Um Sombrio, Mente Desperta, Escudo Mental —resistência psíquica— etc.). `pactMagicSlots()` **não** foi alterada.

### A20. Catálogo de magias sem vínculo com as classes e ficha sem limites de conjuração — **CORRIGIDO (2026-10-04)**
As 361 magias do catálogo (Prompt 6.1) nasceram com `classes: []` e a ficha aceitava qualquer magia, sem validar a lista da classe, o nível máximo ou os limites de truques/conhecidas/preparadas.
- **Feito:** as listas do PHB entram em `shared/spells/class-lists.ts` (fonte ÚNICA — o `classes` de cada magia é **derivado** dela, sem dado duplicado); `class-tables.ts` traz as contagens por classe/nível (truques conhecidos, magias conhecidas, nível máximo e o grimório do Mago `6 + 2×(nível−1)`, além das tabelas dos terço-conjuradores); `spellbook.ts` → `validateSpellbook` valida uma seleção (existe no catálogo, é da lista da classe, nível ≤ máximo e respeita os limites) e o DTO expõe `cantripsKnown`/`spellsKnown`/`maxSpellLevel`/`grimoireSize` em `classes[].spellcasting` (o `preparedCount` continua). A rota **`PUT /api/characters/me/spellbook`** regrava o livro de UMA classe, com os limites **POR CLASSE** (nunca somados); Cavaleiro Arcano e Trapaceiro Arcano usam a lista do **Mago** com a restrição de escola (Abjuração/Evocação e Encantamento/Ilusão; qualquer escola nos níveis 8/14/20). A interface aparece na aba **Magias**, no passo 8 do assistente de criação e no resumo do Level Up, sempre com contadores por classe.
- **Não altera** `pactMagicSlots()`, a fórmula de magias preparadas nem as tabelas de espaços (fora do escopo).
- **Cobertura:** smoke seção **16.5** (fora da lista 400, acima do nível 400, acima do limite 400, duplicada 400, limites separados no multiclasse e as escolas do CA/TA, inclusive a liberação no 8º).

### A21. Magias de juramento do Paladino eram só texto; e a lista de classe do Paladino estava incompleta — **CORRIGIDO (2026-10-04)**
As magias de juramento apareciam apenas como **texto** na característica (níveis 3/5/9/13/17), sem vínculo com o catálogo. Investigando, descobri também que a **lista de classe do Paladino** (6.2) tinha só **14** magias (as exclusivas do PHB): as listas foram geradas do campo `spell_lists` do open5e, que não marca "paladin" em nenhuma magia — o campo correto é `dnd_class`.
- **Feito (lista do Paladino):** a lista passou a ter as **44** magias do PHB 2014 (`class-lists.ts`), sem as magias de juramento (que vêm por subclasse).
- **Feito (magias de juramento):** cada juramento declara `SubclassDefinition.oathSpells` (IDs do catálogo por nível de PALADINO); `shared/spells/oath-spells.ts` resolve o que está liberado e o DTO injeta as magias como **DERIVADAS** (`oath: true`, sempre preparadas, fora do limite de preparadas), **sem duplicar** o que o jogador já escolheu e sem gravar no banco. Na aba Magias ganham o selo **"Juramento"** e não podem ser removidas/despreparadas; como dependem do nível, o **level-down as remove sozinho**. O resumo do Level Up lista os nomes (a descrição das características "Magias de Juramento" é gerada do catálogo, não mais texto fixo). Não altera `preparedSpellCountFor`, Canalizar Divindade nem as demais features; não conjura nem gasta espaço (Fase 5).
- **Cobertura:** smoke seção **16.6** (Devoção 3 com as 2 magias e `preparedCount` intacto; subir ao 5 soma as do 5; descer ao 4 remove; multiclasse usa o nível de paladino; sem duplicar; lista do Paladino com Bênção/Escudo da Fé/Corcel).

### A16. Tabela de espaços errada em conjurador único — **CORRIGIDO (2026-09-28)**
`spellSlotsForClasses` montava sempre o nível de conjurador pela fórmula combinada (`half = floor(nível/2)`, `third = floor(nível/3)`), inclusive com **uma** classe. O PHB usa a tabela **da própria classe** nesse caso, que arredonda a metade/terço para **CIMA**.
- **Efeito:** Paladino 3 tinha 2 espaços de 1º (deveria ter 3), Patrulheiro 5 tinha 3 de 1º e nenhum de 2º (deveria ter 4 e 2) e Trapaceiro Arcano 3 não tinha espaços (deveria ter 2 de 1º).
- **Feito:** `spellSlotsForClasses` usa `ownCasterLevel(entry)` (metade/terço arredondados para cima, zero antes do nível 2 do Paladino/Patrulheiro e antes do 3 do terço-conjurador) quando há **uma só** classe conjuradora; a tabela combinada (com arredondamento para baixo) só entra com **duas ou mais**. Guerreiro e Ladino **sem** subclasse conjuradora não contam como conjuradores, e o **Bruxo** continua fora da tabela (Magia de Pacto separada).
- **Referência:** `shared/classes/index.ts` (`ownCasterLevel`, `multiclassCasterLevel`, `spellSlotsForClasses`, `pactMagicSlots`); coberto pela seção **8.6** do smoke.

### A3. Espaços de magia calculados x editáveis divergem — **Média**
`derived.spellSlots` (regra de multiclasse) é exibido em `SpellsSection.tsx`, enquanto a ficha continua editando livremente `spells.slots` (`max`/`used`) no mesmo painel. Não há sincronização nem aviso — há dois "totais" possíveis para o mesmo personagem.
- **Sugestão:** ou o `max` passa a ser **derivado** (somente `used` é editável), ou a seção marca claramente "espaços do sistema (referência)" x "controle manual da mesa".

### A4. Defesa sem Armadura em multiclasse combina o que deveria escolher — **CORRIGIDO (2026-09-28)**
`classes.ts` → `mergeAdjustments()` usava `base.unarmoredDefense || extra` e um único `unarmoredDefenseAbility`. Um Bárbaro/Monge deveria **escolher** uma das fórmulas (10+DES+CON **ou** 10+DES+SAB), não misturar.
- **Feito:** `computeArmorClass` (shared/armor-class.ts) recebe as fórmulas como **candidatas** (`unarmored`) e usa a de **maior valor**, rotulando qual classe a concedeu. A fórmula padrão (10 + DES) entra sempre na disputa.
- **Cobertura:** seção **14** do smoke (Defesa sem Armadura de Bárbaro e de Monge, com e sem escudo).

### A5. PV inicial e PV de Level Up fora do PHB — **CORRIGIDO (2026-09-28)**
- `characters.service.ts` → `createCharacter()` criava a ficha com `hpMax = 1` (default do schema). O PHB define PV iniciais = **máximo do dado de vida + mod. de CON** no nível 1.
- `levelUpCharacter()` somava o ganho só em `hpMax`; o PHB soma em **máximo e atual**.
- **Feito:** `firstLevelHpMax(hitDie, constitution)` (máximo do dado + mod. de CON, mínimo 1) define o PV inicial quando a primeira classe é escolhida/definida no assistente (salvo se o patch já mandou `hpMax`); no Level Up o ganho (`max(1, dado + mod. de CON)`) entra em `hpMax` **e** em `hpCurrent`. O mod. de CON também dispara o **recálculo retroativo** — `constitutionHpDelta` = `(novo mod − mod antigo) × nível total`, aplicado em máximo e atual (ao reduzir, o atual nunca fica negativo).
- **Cobertura:** seção **14** do smoke (PV de d10/d6, CON 16 subindo 40/30 → 45/35, CON 8 caindo para 25/15).

### A6. Ataque Furtivo é aplicado automaticamente sem as condições táticas — **CORRIGIDO (2026-10-03)**
`combat.service.ts` → `rollSneakAttack()` adicionava o dano sempre que a arma era sutil/à distância e a feature existia. As condições reais (vantagem **ou** aliado adjacente ao alvo, sem desvantagem) não eram verificadas.
- **Feito (2026-10-03):** o Ataque Furtivo passa a exigir as condições do PHB 2014 — `(vantagem no ataque || aliado adjacente confirmado) && !desvantagem`, além da feature e da arma `finesse`/`ranged`.
  - **Vantagem/desvantagem** viraram dado da própria rolagem de ataque (`attackSchema` ganhou `advantage`/`disadvantage`; o servidor rola **2d20** e mantém o maior/menor — as duas juntas = nenhuma, igual à janela de dados), com toggles no painel de ataque.
  - Como não há grid/posição (Fase 10), o **aliado adjacente** é confirmação manual do jogador: checkbox "Tenho um aliado adjacente ao alvo", visível só para Ladino com arma qualificadora (`adjacentAlly`).
  - A trava **"uma vez por turno"** entrou como `Combatant.sneakAttackUsedThisTurn` (migration `20261003070000_combatant_sneak_attack_flag`), zerada em `nextTurn()` para o combatente que **inicia o turno**.
  - O log do mestre indica a origem: `— Ataque Furtivo (vantagem)` / `(aliado adjacente)` / `(vantagem + aliado adjacente)`.
- **Cobertura:** seções **27** (arma derivada) e do **Ladino** do smoke.

### A7. Resistências, imunidades e vulnerabilidades — **Resolvido (2026-10-03)**
`combat.service.ts` só rolava o dano principal e `applyDamageResistance()` apenas **halvava** o dano de um tipo resistido de PERSONAGEM; as **imunidades** da criatura não eram usadas e **vulnerabilidade** não existia.
- **Feito (2026-09-29, modelagem):** ataques e armas podem carregar **vários tipos de dano independentes** (`attack.damage` + `extraDamages`, `shared/attacks.ts`; o ataque derivado da arma copia os extras).
- **Feito (2026-10-03):** o combate percorre **`attackDamages(attack)`** e rola **cada parcela** (crítico dobra os dados de cada uma), aplicando a defesa **por parcela e por tipo**: imunidade **zera**, vulnerabilidade **dobra**, resistência **halva** (arredondando para baixo). Funciona para **Personagem** (resistências de classe + raça) e para **Criatura** (`resistances`/`immunities`/`vulnerabilities`). Os bônus corpo a corpo (Fúria, Crítico Brutal, Ataque Furtivo) entram só na **parcela física** (Cortante/Perfurante/Concussão); a munição, na principal. A resposta de ataque e o log do mestre ganharam **`components`** (rolado × aplicado por tipo + o motivo) para explicar quando o total não bate com a soma crua.
- **Feito (2026-10-03, modelagem):** nova coluna `Creature.vulnerabilities` (migration `20261003060000_creature_vulnerabilities`), validada pelos 13 tipos canônicos e editável no editor do mestre. Personagem não tem fonte de vulnerabilidade.
- **Pendente:** resistência condicional ("a dano não-mágico" vs. mágico) — fora do escopo; só o tipo puro é tratado.

### A8. Capacidade de carga simplificada — **Baixa**
`dnd5e.ts` → `carryingCapacity()` = FOR × 7,5 kg. Ignora tamanho (Pequeno ×½, Grande ×2) e traços como **Poderoso**. Como raça/tamanho não são modelados, registrar como limitação conhecida.
- **Sugestão:** adicionar `size` ao personagem (ou ao antecedente/raça) e multiplicar; manter 7,5 kg/Força como padrão Médio.

### A9. Bônus de atributo de feature vs. teto no Level Up — **Baixa**
`levelUpCharacter()` valida o +2 com base no valor **bruto** (`character[ability]`), enquanto o DTO usa valores **efetivos** (`abilityBonuses`/`abilityCaps`, ex.: Campeão Primitivo até 24). Pode haver divergência entre o que o assistente permite e o que a ficha mostra.
- **Sugestão:** validar o teto sobre o valor efetivo (reaproveitar o cálculo de `effectiveAbilities`).

### A10. Integração de armadura/escudo na CA — **CORRIGIDO (2026-09-28)**
`Item.armorClassBonus` era cadastrado, mas `armorClassHint` só cobria "sem armadura". Equipar uma armadura no inventário **não** alterava a CA sugerida, e a CA final era sempre manual (`character.armorClass`).
- **Feito:** `computeArmorClass` monta a CA a partir do **equipamento** (shared/armor-class.ts): armadura no peitoral (`armorType` + `baseArmorClass`, com o teto de DES por tipo — 0 na pesada, +2 na média), escudo e bônus mágicos dos demais itens equipados. `character.armorClass` virou **apenas o override do mestre** (0 = automático) e `derived.armorClass` traz o detalhamento (automatic, dexterityBonus, shieldBonus, magicBonus, classBonus...). O combate passou a usar a mesma conta.
- **Cobertura:** seções **14** (leve/média/pesada, escudo, override) e **18** (Estilo de Luta Defesa +1 só com armadura) do smoke.

### A11. XP é manual e não interage com o Level Up — **Baixa**
`xpForNextLevel` é exibido, mas subir de nível não exige/consome XP — depende só da liberação do mestre (decisão de design válida). Registrar para evitar expectativa de "XP destrava o botão".

### A12. Aumento de Atributo por classe e feats — **OK, com ressalva**
`asiLevelsFor` cobre Guerreiro (4/6/8/12/14/16/19), Ladino (4/8/10/12/16/19) e demais (4/8/12/16/19), e o Level Up checa o **nível da classe** — correto. Ressalva: talentos são apenas texto (sem efeito mecânico), o que está documentado, mas deve constar no roadmap.
- **Feito (2026-09-29):** o Aumento de Atributo e o Talento agora ficam registrados no **histórico do nível** (`characters.levelHistory`), então o downgrade do mestre desfaz o aumento (`−amount` por atributo, piso 1) e remove a característica de origem `feat` pelo id — ver §12.5/§12.6 de `ARQUITETURA-DO-SISTEMA.txt`.
- **Feito (2026-10-04):** os talentos deixaram de ser só texto. O catálogo do PHB 2014 (`shared/feats/`, categorias A/B/C) liga a escolha do Level Up ao efeito mecânico por `featId`, resolvido pelo MESMO pipeline das classes (`computeFeatAdjustments` + `mergeAdjustments`): o +1 dos half-feats vai para o atributo escolhido (`featAbility`) e o Resiliente dá proficiência na salvaguarda do atributo escolhido — tudo **derivado** (a pontuação gravada não muda). Os talentos B/C ficam como registro + TODO do sistema de que dependem. Cobertura na seção **28.5** do smoke.

### A13. Pré-requisito de multiclasse ignorava as classes atuais — **CORRIGIDO (2026-09-28)**
`multiclassMissingLabel` conferia apenas a classe NOVA. O PHB (cap. 6) exige 13 nos atributos exigidos pela classe nova **e por todas as classes que o personagem já tem** — um Paladino com Força 8 podia multiclassar livremente.
- **Feito:** `multiclassPrerequisiteLabel(classKey, abilities, entries)` monta a mensagem citando cada classe bloqueadora ("Para entrar em Ladino você precisa de Destreza 13; para continuar como Paladino você precisa de Força 13 e Carisma 13"), com os mesmos atributos gravados que o sistema já usava. Aplicada no serviço (`resolveClassPatch` e `applyLevelUp`) e no `classOptions[].eligible/missing` do DTO; o assistente de Level Up mostra o mesmo texto.
- **Referência:** `shared/classes/index.ts`, `characters.service.ts`, `characters.dto.ts`, `client/src/components/LevelUpDialog.tsx`.

### A14. Multiclasse concedia as salvaguardas de TODAS as classes — **CORRIGIDO (2026-09-28)**
`lockedSavesOf` (serviço) e `lockedSaves` (DTO) somavam as salvaguardas de cada entrada da lista, então entrar em Ladino marcava Destreza/Inteligência como fixas. O PHB (p.164) diz o contrário: multiclasse **nunca** concede salvaguardas.
- **Feito:** as salvaguardas fixas passam a vir só da **primeira** classe (as de features, como Mente Escorregadia, continuam valendo). Dados antigos que gravaram as salvaguardas extras seguem gravados até a próxima escrita da ficha.

### A15. Proficiências de armadura, arma e ferramenta não eram modeladas — **IMPLEMENTADO (2026-09-28, Fase 1)**
A ficha só tinha perícias e salvaguardas, então nenhuma proficiência de equipamento existia.
- **Feito:** JSONB `characters.proficiencies` (`{ armor, weapons, tools }`, migração `20260928160000_character_proficiencies`, com backfill das fichas existentes a partir de `classes`); tabela `CLASS_PROFICIENCIES` (`shared/classes/index.ts`) com o conjunto completo do nível 1 e o reduzido de multiclasse (PHB p.164); a primeira classe concede o conjunto completo, entrar numa classe nova concede o reduzido e, para Bardo/Patrulheiro/Ladino, **uma perícia à escolha** validada no servidor (`skillChoice` no Level Up); exibição somente leitura na ficha e edição restrita ao mestre (campo de construção, 403 para o jogador com a criação finalizada).
- **Feito (2026-09-29, Fase 2 parcial):** o efeito da proficiência no **ataque** — o novo ataque derivado da arma equipada (`shared/weapon-attacks.ts`, `derivedAttacks` no DTO) soma o bônus de proficiência por **categoria** ("Armas simples"/"Armas marciais") ou por **nome** específico, além de resolver habilidade (FOR/DES/acuidade), versátil, duas mãos, segunda arma leve, arremesso e golpe desarmado. Cobertura na seção **27** do smoke.
- **Feito (2026-10-03, Fase 1.2):** a proficiência de **armadura/escudo** passou a ser resolvida por uma regra COMPARTILHADA (`shared/armor-class.ts`: `isArmorTypeProficient`, `isShieldProficient`, `armorProficiencyOf`) e exposta no detalhe da CA (`derived.armorClass.armorProficiency` / `armorNonProficiency`), usado pela ficha E pelo combate — uma única fonte. **A CA NÃO muda sem proficiência** (correção da regra do PHB 2014: vestir armadura sem proficiência mantém a CA; o que entra são as penalidades de não proficiência). Cobertura na seção **14** do smoke (Casos 1-5, 8, 9).
- **Pendente (Fase 8):** o EFEITO mecânico da não proficiência — desvantagem em testes de habilidade/salvaguardas/jogadas de ataque que usem Força ou Destreza e impossibilidade de conjurar magias. A Fase 1.2 deixou só o ESTADO derivado (`armorNonProficiency`) pronto para ser consumido; a penalidade em si é do motor da Fase 8. Também pendente: escolha interativa das ferramentas abertas ("1 instrumento musical à sua escolha" entra como descrição) e o teto de Destreza +3 da armadura média do talento Armadura Média (depende do mesmo motor).

---

## Parte B — Escalabilidade e concorrência

### B1. Sem transações em operações multi-passo — **Resolvido (2026-10-03)**

- ✅ `levelUpCharacter()`: **já usa `prisma.$transaction`** e o `applyLevelUp` grava com `updateMany` cujo `where` inclui o `lastLevelUpRelease` lido, tratando `count === 0` como **409** — dois POST simultâneos não sobem dois níveis com uma liberação. (`levelUpDraft`, do nível inicial, usa o mesmo caminho.)
- ✅ `setLevelUpUnlocked()`: **não existe mais** — a coluna foi removida pela migration `20260928150000_release_level_up_per_click`. O equivalente é `releaseLevelUp()`, que usa `{ increment: 1 }` (atômico de banco). Dois cliques simultâneos contam como duas liberações **de propósito** (documentado).
- ✅ `resolveAttack()` / `changeHp()`: trocado o ler-calcula-grava em JS por **`UPDATE` atômico** (`$executeRaw` com `GREATEST`/`LEAST`). Dano consome os PV temporários no próprio SQL, piso 0, teto `hpMax`; o personagem é **relido** após a escrita para montar o DTO/evento. Dois ataques concorrentes no mesmo alvo não perdem mais dano (combatentes-criatura idem).
- ✅ `startCombat()`: além da checagem de aplicação, o banco agora impõe o combate único pelo índice parcial `combats_one_active_key` (ver D1); o erro `P2002` do INSERT vira o mesmo 409.
- **Padrão aplicado em (2026-09-29):** `levelDownCharacter()` (downgrade do mestre) usa `updateMany` com o `version` lido no `where` — dois cliques seguidos não tiram dois níveis (o segundo recebe 409).

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

### D1. Índice único parcial de "combate ativo" — **Resolvido (2026-10-03)**
`Combat` tinha só `@@index([status])` e a checagem era apenas de aplicação.
- **Feito:** migration `20261003050000_single_active_combat` cria `combats_one_active_key`, índice único PARCIAL sobre a expressão constante `(1)` com `WHERE status <> 'ENDED'`. Um índice único em `(status)` não serviria: permitiria um `PENDING_INITIATIVE` e um `ACTIVE` conviverem. `startCombat` traduz o `P2002` em `409`.
- **Observação:** o Prisma não expressa índice único parcial no schema, então ele vive só na migration (documentado no modelo `Combat`).

### D2. `Character` sem `@@index` para ordenação por nome — **Baixa**
`listCharacters` faz `orderBy: { name }`. Em mesa pequena, irrelevante; se crescer, adicionar índice.

### D3. JSONB validado apenas na aplicação — **Baixa (aceitável)**
`classes`, `inventory`, `spells`, `features`, `classState` são JSONB com validação Zod na leitura/escrita. Dados inválidos só entram por fora da API. `parseJson` já torna a leitura tolerante. OK.

### D4. `lastLevelUpRelease` no `Character` e `levelUpRelease` no `GameConfig` — **Baixa**
Design funcional, mas o "reset" depende de o personagem existir. Se uma ficha for apagada/recriada, o contador reinicia. Documentar.

### D5. Sem histórico/auditoria — **Informativo**
Só existe `version`. Para jogo não é necessário, mas um log de alterações ajudaria a investigar divergências em tempo real.
- **Parcialmente resolvido (2026-09-29):** a PROGRESSÃO passou a ter histórico — `characters.levelHistory` guarda o que cada nível concedeu (PV com o dado/rolagem, Aumento de Atributo/Talento, escolhas, subclasse, perícia e proficiências), gravado no próprio `applyLevelUp` e consumido pelo downgrade do mestre (`levelDownCharacter`). Não é um log de alterações da ficha (o `version` continua sendo a única pegada das edições do mestre e do jogador), mas cobre justamente o que não é reconstruível a partir da ficha.

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
### F7. Log de rolagens do mestre só mostrava o total — **CORRIGIDO (2026-09-28)**
`DiceDock.historyLine` montava `[Jogador]: [Perícia]: [total]` e jogava fora o resto do `DiceRollDto`. O mestre não conseguia saber de onde vinha o número (dado + bônus).
- **Feito:** `rollDebug(roll)` (em `client/src/dice/format.ts`) exibe a depuração ao lado do total — `Umbrae: Percepção: 10 (d20 6 + 4 perícia)`, com o tipo de cada dado, o bônus rotulado pela origem (perícia/salvaguarda/bônus) e os dados descartados pela vantagem/desvantagem (`d20 6, descartado d20 2`). É só apresentação: o DTO já trazia `dice[]`, `bonus` e `total`, então nenhum dado novo trafega nem é gravado.
- **Referência:** `client/src/dice/format.ts`, `client/src/dice/DiceDock.tsx`, `.dice-log-debug` em `client/src/styles.css`.

### F8. Log de rolagens só existia dentro da janela de dados — **AMPLIADO (2026-09-28)**
O histórico do mestre só aparecia abaixo dos dados, dentro da janela de rolagem: para consultar o log era preciso abrir o tabuleiro (que ocupa a tela).
- **Feito:** o log continua na bandeja de rolagem **e** ganhou um **botão flutuante "Log"** (com o contador de rolagens) acima do botão "Dados", que abre um **painel flutuante só com o histórico** — cartão ancorado acima dos botões, com rolagem própria, fechar e limpar, sem ocupar a tela (`components/master/RollLogPanel.tsx`, lista compartilhada em `dice/RollLogList.tsx`).
- **Junto:** abaixo do botão "Dados" entrou o botão **Anotações** do mestre, com o MESMO esquema das anotações do jogador (pena + painel flutuante, salvamento automático ao sair do campo), gravadas em `GameConfig.masterNotes` e visíveis só para ele (`GET`/`PATCH /api/game/notes`, exclusivas de `MASTER`, migração `20260928170000_game_config_master_notes`). Os dois painéis abrem um por vez.
- **Escolha consciente:** as anotações do mestre **não** publicam evento em tempo real (texto privado de um único usuário). Com o painel aberto em duas abas, a segunda só sincroniza ao recarregar.
- **Referência:** `components/master/{RollLogPanel,MasterNotes}.tsx`, `pages/MasterPanel.tsx`, `gameApi.ts`, `game-config.{service,routes,dto}.ts`, `.roll-log-fab`/`.master-fab-panel`/`.dice-fab.is-master` em `styles.css`.

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
7. **Equipamento e CA automáticas** — integração de armadura/escudo (A10) e o **efeito** das proficiências (Fase 2 de A15).
8. **Efeitos mecânicos dos talentos** (A12) — ✅ **Feito (2026-10-04)**: catálogo estruturado (A com efeito; B/C com TODO) + `computeFeatAdjustments`/`mergeAdjustments`; half-feat e Resiliente derivados. _(seção 28.5 do smoke)_
9. **Encontros/XP** — conceder XP por encontro derrotado, se desejado.

---

## Checklist priorizado — "dados a serem alterados"

> Marcações: **P0** = corrigir antes de uso intenso; **P1** = importante; **P2** = melhoria.

### Regras de D&D
- [x] **Corrigido (2026-09-28)** Pré-requisito de multiclasse: conferir também as classes que o personagem já tem. _(A13)_
- [x] **Corrigido (2026-09-28)** Multiclasse não concede salvaguardas (só a primeira classe). _(A14)_
- [x] **Implementado (2026-09-28)** Proficiências de armadura/arma/ferramenta na ficha (Fase 1: registro, concessão e exibição). _(A15)_
- [x] **Implementado (2026-09-29)** Proficiências de arma: efeito no ATAQUE via ataque derivado da arma equipada (habilidade, categoria/nome, versátil, duas mãos, mão secundária, arremesso e golpe desarmado). _(A15 · seção 27)_
- [x] **Corrigido (2026-10-03)** Proficiência de armadura/escudo resolvida por regra compartilhada e exposta no DTO da ficha E do combate (`armorProficiency`/`armorNonProficiency`); a CA não muda sem proficiência (PHB 2014). A penalidade mecânica (desvantagem em testes/salvaguardas/ataques e conjuração) fica para a **Fase 8**. _(A15 · seção 14 do smoke)_
- [x] **Implementado (2026-09-29)** Downgrade de nível pelo mestre: histórico por nível (`characters.levelHistory`) gravado no Level Up e revertido por `POST /api/characters/:id/level-down` (PV, Aumento de Atributo/Talento, escolhas, subclasse, perícia e proficiências; nível 1 → 0 remove a classe). _(A12/D5 · seção 28)_
- [x] **Implementado (2026-10-04)** Motor de talentos do PHB: catálogo `shared/feats/` (A/B/C), escolha no Level Up por `featId`/`featAbility` e efeitos derivados (half-feat, Resiliente) pelo mesmo pipeline das classes. _(A12 · seção 28.5)_
- [x] **Implementado (2026-10-04)** `hpBonus` de classe/talento aplicado no `derived`: o PV máximo EFETIVO = gravado + bônus (Resiliência Dracônica +1/nível de feiticeiro; talento Vigoroso +2/nível), usado pela ficha e pelo teto de cura do combate — antes o rótulo prometia o bônus mas ele nunca era somado. _(A12 · seção 28.5)_
- [ ] **P2** Backfill do histórico para as fichas antigas: hoje um nível sem registro só pode ter o PV estimado pela média (com aviso) e o resto ajustado à mão. _(D5)_
- [x] **Corrigido (2026-09-28)** `classes/index.ts`: incluir conjuração de **subclasse** em `multiclassCasterLevel`/`pactMagicSlots` (Trapaceiro/Cavaleiro Arcano). _(A1)_
- [x] **Corrigido (2026-09-28)** `characters.service.ts`: PV iniciais = dado de vida máx + CON; no Level Up somar o ganho também em `hpCurrent`; recálculo retroativo de CON. _(A5)_
- [x] **Corrigido (2026-09-28)** `characters.dto.ts`: `preparedCount` para o Paladino (metade do nível) e por classe no multiclasse, com o total único removido. _(A2)_
- [x] **Corrigido (2026-09-28)** Características de CLASSE de Bardo, Guerreiro, Paladino e Patrulheiro + mecanismo genérico de escolhas (`classState.choices`). _(A17)_
- [x] **Corrigido (2026-09-28)** As 9 subclasses do PHB de Bardo, Guerreiro, Paladino e Patrulheiro + efeito `critThreshold` no combate + `subclassChoices` no catálogo (escolha no mesmo nível da subclasse). _(A19)_
- [ ] **P1** Fase 5: efeito em combate do Mestre da Batalha (gastar os dados de superioridade e resolver as manobras) e a ficha do companheiro animal do Senhor das Feras. _(A19)_
- [x] **Implementado (2026-10-04)** Características de classe do **Bruxo** e os 3 Patronos Extraplanares (Dádiva do Pacto, Invocações Místicas com pré-requisitos de nível/pacto, Arcanum Místico e listas expandidas como texto, Mestre Místico). _(A18)_
- [x] **Implementado (2026-10-04)** Características de classe do **Clérigo** e os 7 Domínios Divinos (Canalizar Divindade 1/2/3 com opções em toggle, Destruir Mortos-Vivos, Intervenção Divina, magias de domínio como texto). _(A18)_
- [x] **Corrigido (2026-09-28)** Tabela de espaços: conjurador único usa a tabela da própria classe (metade/terço para cima); a combinada só com 2+ conjuradores. _(A16)_
- [x] **Implementado (2026-09-29)** Vários tipos de dano por ataque e por arma: `extraDamages` no schema do ataque (ficha e criaturas) e em `details` das armas do catálogo, com o ataque derivado copiando os extras; interface com o "+" na linha de dano. _(A7 · seção 29)_
- [x] **Corrigido (2026-10-03)** `combat.service.ts`: imunidade/resistência/vulnerabilidade **por parcela** de `attackDamages()`, para Personagem e Criatura, com `components` no resultado. _(A7)_
- [ ] **P1** `SpellsSection.tsx` + DTO: decidir se `spellSlots` é derivado (recomendado) ou manual, e remover a duplicidade. _(A3)_
- [x] **Corrigido (2026-10-03)** Ataque Furtivo: condicionado à vantagem no ataque ou ao aliado adjacente confirmado, sem desvantagem e uma vez por turno. _(A6)_
- [x] **Corrigido (2026-09-28)** Defesa sem Armadura no multiclasse: vale a fórmula de maior valor (Bárbaro x Monge). _(A4)_
- [x] **Corrigido (2026-09-28)** CA automática somando armadura/escudo/bônus mágicos equipados (override do mestre como exceção). _(A10)_
- [ ] **P2** Validação de teto de atributo pelo valor efetivo no Level Up. _(A9)_
- [ ] **P2** Capacidade de carga por tamanho/traços. _(A8)_

### Concorrência e escalabilidade
- [x] **P0** Transação/lock no Level Up (uma liberação = no máximo um uso). _(B1)_ — **já estava feito** (`$transaction` + `updateMany` com `lastLevelUpRelease` no `WHERE`).
- [x] **Corrigido (2026-10-03)** HP do combate com `UPDATE` atômico (`GREATEST`/`LEAST` via `$executeRaw`). _(B1)_
- [x] **Desnecessário (2026-10-03)** `setLevelUpUnlocked` não existe mais; `releaseLevelUp` já usa incremento atômico. _(B1)_
- [x] **Corrigido (2026-10-03)** Índice único parcial de "um combate ativo" (`combats_one_active_key`). _(B1/D1)_
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
