# Roadmap de desenvolvimento — Obsyrium RPG

> **Guia de contexto para agentes que trabalham no repositório `delanora/rpg`.**
> Estado consolidado em **10/11/2026**, com base no código da `main` e na aba **Roadmap** do documento *Codex do Aventureiro*.
> Este arquivo resume **o que existe, o que está parcial e o que vem depois**. Não substitui a inspeção do código.

## 1. Leitura obrigatória e fontes de verdade

1. **`AGENTS.md`** — arquitetura, convenções, comandos e cuidados de implementação.
2. **Este `roadmap.md`** — orientação sintética de histórico, status e prioridades.
3. **GitHub `main`** — verdade sobre o que foi realmente implementado; confirme `HEAD` e `origin/main` no início de cada tarefa.
4. **[Codex do Aventureiro — aba Roadmap](https://docs.google.com/document/d/1eaAVzlqM3YPcCnI74AN95io8HRiku94f3LrPL8HIgCI/edit)** — planejamento compartilhado, atualizado com as entregas aceitas; pode evoluir antes deste arquivo.
5. **`README.md`, `prisma/schema.prisma` e `docs/`** — contratos funcionais, persistência e auditorias específicas.
6. **PHB D&D 5e 2014** — referência mecânica principal. **O Mestre tem a decisão final na mesa.**

**Legenda:** ✅ concluída/validada no escopo descrito; 🟡 parcial, fundação ou hardening; ⬜ planejada; **P0** bloqueia jogabilidade/integridade. Uma fundação ✅ não significa que todo o domínio PHB esteja executável.

**Atualização deste documento:** ao finalizar uma fase, conferir o commit remoto e os testes, atualizar **somente as linhas afetadas** aqui e no Roadmap compartilhado, sem apagar trabalho de outros agentes. Não transformar uma ideia em ✅ apenas porque há código.

## 2. Estado atual em poucas linhas

- **Núcleo jogável:** ficha, inventário, recursos/descansos, iniciativa, Action Economy, ataques, movimento, grid, cobertura parcial, condições, concentração, morte e realtime já têm fundações operacionais.
- **UI de combate:** workspace com grid central, iniciativa, Registro e Testes em blocos separados e **dock do jogador com Hotbar personalizável 2 × 24 (48 slots)**; fluxo de pré-iniciativa, espera, targeting em tokens e Death Saves consolidado.
- **6.6M.9–9.2:** Golden Path de sessão jogável e consistência de deslocamento foram marcados como ✅ no Roadmap compartilhado; há teste integrado `src/scripts/smoke-combat-playable.ts`.
- **Trabalho recente:** paredes com bloqueios independentes de movimento e ataques/magias; caminho livre validado nos casos claros, além do editor, ping e menus dos tokens.
- **Áreas de criaturas:** cadastro e execução com salvaguardas no Registro e dano compartilhado implementados, testados e publicados. A elevação vem do grid: mesmo nível entra, outro nível só por exceção do Mestre. Paredes que bloqueiam ataques barram a área. Recarga em 1d6 publicada. Prévia com cor do dano e compartilhamento aos jogadores implementada, testada e publicada. Ataques Múltiplos implementados, testados e publicados. Próximo: validar sopro e composição na mesa.
- **Não concluir que “PHB completo” está pronto:** existem lacunas de magias especiais, características, reações avançadas, passagem do tempo fora de combate e ferramentas do Mestre.

## 3. Regras de arquitetura que nenhuma etapa deve violar

- **Servidor é a autoridade mecânica.** O cliente pode apresentar preview, animações e intenções; não arbitra dano, salvaguarda, custo, economia, alvos, recursos ou movimento válido.
- **Reutilizar os motores:** Action Economy, Movement Engine, Spell Engine, Effect Engine, Reaction Foundation, Damage/Healing, Concentration, Resolution Cards, realtime, controle de versão e idempotência. Hotbar, Tomo e HUD são superfícies, não engines.
- **Não misturar silenciosamente** D&D 2024, regras opcionais do DMG, house rules ou convenções de outro VTT. Quando o PHB 2014 não determinar uma decisão de interface/VTT, documentar regra, lacuna, opções e **adjudicação do Obsyrium**.
- **Geometria espacial:** quadrados; diagonal custa o mesmo que ortogonal; sem distância Euclidiana; distância entre footprints; Tiny 2,5 ft, Small/Medium 5 ft, Large 10 ft, Huge 15 ft, Gargantuan 20 ft; `baseSize` ≠ `effectiveSize`.
- **Direct Drag:** origem autoritativa → ponteiro/ghost visual → destino mecânico snapado → caminho derivado → preview → commit. Pan/zoom da câmera não gastam Movimento.
- **Unidades:** padrão arquitetural desejado: **FEET nos cálculos espaciais/mecânicos, METERS na UI** (5 ft = 1,5 m; 30 ft = 9 m). **Atenção ao legado:** `Character.speed`, `Creature.speed` e parte da `TurnEconomy` ainda possuem contratos persistidos em **metros**. Não reinterpretar valores históricos (`9` não vira `9 ft`) nem fazer migração parcial; converter explicitamente na fronteira correta. Ver `docs/auditoria-unidades-movimento-6.6M.9.1.md`.
- **Combate e Scene:** publicar DTO completo e coerente por HTTP e Socket.io; nunca remover a Scene do evento e cair implicitamente em `assisted`. Fluxos de morte e outros produtores devem consumir o carregador canônico.

## 4. Visão geral das fases

| Fase | Estado | Entrega / escopo restante |
|---|---|---|
| **0 — Fundação técnica** | ✅ | Aplicação, autenticação, banco, API, realtime e base de testes. |
| **1 — Fundação das regras** | ✅ | Cálculos essenciais de D&D 5e 2014. |
| **2 — Personagem, classes e antecedentes** | ✅ estrutural | Ficha, criação e progressão; ampliar características executáveis na Fase 6/10. |
| **3 — Inventário, equipamentos e economia** | 🟡 quase fechada | Itens, moedas, armas e recursos; completar integrações restantes. |
| **4 — Catálogos / compêndio operacional** | 🟡 | Conteúdo consultável; ampliar cadastros, busca e vínculo com execuções. |
| **5 — Recursos, descansos e lifecycle** | ✅ escopo atual | Descanso Curto/Longo, recursos por classe/raça e Camp Supplies. |
| **6 — Motor de combate e regras** | 🟡 muito avançada | Núcleo jogável integrado; ampliar regras especiais, conteúdo e geometria. |
| **7 — Reações e combate avançado** | 🟡 fundação | Opportunity Attacks existentes; faltam reações/fluxos especiais. |
| **8 — Compêndio e ferramentas do Mestre** | 🟡 | Gestão de criaturas, itens, localidades e conteúdo operacional; ampliar. |
| **8.5 — Arquivo do Mestre** | ⬜ conceito definido | Quadros, cards, encontros, locais, pistas, armadilhas, áudio e revelações. |
| **9 — Compatibilidade / conteúdo complementar** | ⬜ | Importação, exportação, compatibilidade e ferramentas administrativas. |
| **10 — Segurança, produção e escala** | 🟡 fundação | Backups, autorização, recuperação, observabilidade e deploy. |
| **11 — UX, acessibilidade e acabamento** | 🟡 | Responsividade, feedback, navegação, gestos e polimento. |

### Fases anteriores ao combate — referência rápida

| Marco | Estado | O que o agente deve saber |
|---|---|---|
| **0–2** | ✅ | Base técnica, regras e ficha estrutural existem. Não criar sistemas paralelos de usuário, ficha ou progressão. |
| **3** | 🟡 | Inventário/equipamento e moedas são persistidos e alimentam ataques e recursos. Expandir a partir dos DTOs existentes. |
| **4** | 🟡 | Há catálogo/compêndio; “constar do catálogo” não significa ter handler executável. |
| **5.1–5.2** | ✅ | Descansos Curto e Longo e recursos no escopo atual; sessões, operações, permissões e idempotência já existem. |
| **5 — Camp Supplies** | ✅ fundação | Recurso de Acampamento é categoria real; valor por unidade; contribuição individual de 10 pontos por personagem no Long Rest, com aprovação coletiva. |
| **5 — culinária** | ⬜ expansão | Receitas cadastráveis (ingredientes, rendimento, pontos de suprimento); preparo simples/complexo; Cook's Utensils pertinentes; sem buffs automáticos iniciais. |

## 5. Fase 6 — Histórico de implementação

### 5.1 Economia, condições, morte e efeitos

| Etapa | Estado | Descrição breve |
|---|---|---|
| **6.1 — Action Economy** | ✅ | Ação, Ação Bônus, Reação, Movimento, Disparada, Esquiva, Preparar, Extra Attack e economia autoritativa. |
| **6.2 — Condições e Exaustão** | ✅ | Modificadores de ataques, testes, salvaguardas, CA e deslocamento conforme os estados mecânicos. |
| **6.3 — Zero PV / Death Lifecycle** | ✅ | Inconsciente, Death Saves, estabilização, cura, morte e decisões do Mestre. |
| **6.3.5 — Reaction Foundation** | ✅ | Gestão do recurso de Reação e oportunidades; expandir reações especiais na Fase 7. |
| **6.3.6 — Barra de ações** | ✅ fundação | Superfície evoluiu para a dock/Hotbar moderna; não manter duas economias. |
| **6.4 — Concentração** | ✅ | Estado, salvaguardas após dano, término e efeitos dependentes. |
| **6.5 — Effect Engine** | 🟡 fundação entregue | Efeitos, fontes, condições e modificadores; aumentar cobertura de magias/itens/habilidades. |

### 5.2 Conjuração e resolução

| Etapa | Estado | Descrição breve |
|---|---|---|
| **6.6 — Spell Engine** | 🟡 avançada | Conjuração, custos, alvos, execução e integração com combate. |
| **6.6A–H — Fundamentos** | ✅ | Perfil/repertório, espaços, casting time, targeting, componentes e duração. |
| **6.6I — Resolution Cards** | ✅ | Apresentação e resolução de rolagens, dano, cura e salvaguardas. |
| **6.6J.0 — Testes isolados** | ✅ | Padrões de fixtures e verificações sem tocar na campanha. |
| **6.6J.1 — Salvaguarda e dano** | ✅ | Dano completo, parcial ou anulado, incluindo defesas. |
| **6.6J.2 — Múltiplos alvos** | ✅ | Saves e resultados separados por alvo na mesma conjuração. |
| **6.6J.3 — Áreas** | ✅ fundação | Seleção de área com assistência/confirmação quando o motor ainda não cobre geometria integral. |
| **6.6J.4 — Múltiplos ataques/raios** | ✅ | Magias com várias rolagens de ataque. |
| **6.6J.5 — Cobertura** | ✅ casos claros | Grau definido no obstáculo, aplicado pelo servidor a ataques e salvaguardas de Destreza; cantos e frestas seguem assistidos. |
| **6.6K — Resultados especiais** | ⬜ | Encadear dano, cura, condições, PV temporários e resultados incomuns. |

### 5.3 Regras espaciais, grid e cenas

| Etapa | Estado | Descrição breve |
|---|---|---|
| **6.6L — Spatial Rules** | 🟡 avançada | Distância, reach, footprints, tamanhos, movimento, obstáculos e Opportunity Attacks. |
| **6.6L.4.1 — Paredes/obstáculos** | ✅ fundação | Barreira de cena e bloqueio de movimento, inclusive diagonal e tokens grandes. |
| **6.6L.4.1.1 — Cenas por localidade** | ✅ | Scene e mapa vinculados à localidade e ao combate. |
| **6.6M.3.1.4.3 — Movimento integrado** | ✅ | Direct Drag, preview/commit, custos e feedback entre clientes. |
| **6.6M.3.1.4.3.1 — Registro de movimento** | ✅ | Distância, custo e restante mostrados em metros no log. |
| **6.6M.3.1.4.4 — Tamanhos** | ✅ | Base/effective size e ocupação dos tokens. |
| **6.6M.4.1–4.1.4 — Editor e alinhamento** | ✅ | Cenas, imagem, grid SVG, preview, snapping, geometria e arraste consistente. |
| **6.6M.4.2 — Editor de paredes** | ✅ | Traçados com múltiplos cantos, desfazer, persistência e barreiras de movimento. |
| **6.6M — Ping no grid** | ✅ | Alt+clique sincronizado, bandeira temática e etiqueta arredondada com nome do personagem ou Mestre; sem consumir economia. |

### 5.4 Interface, Hotbar e estabilidade

| Etapa | Estado | Descrição breve |
|---|---|---|
| **6.6M.5–5.2 — Workspace** | ✅ | Combate em aba própria, grid central, iniciativa/log e menus do Mestre no token, com economia visível fora do turno e recuperação automática de movimento. Registro e Testes separados, com altura reservada e rolagens independentes; morte, salvaguardas e concentração ficam somente em Testes, sem aviso sobre o grid. Jogador recebe só os próprios testes; Mestre recebe todos. |
| **6.6M.6–6.1.5.1 — Dock do jogador** | ✅ | Retrato, recursos, Hotbar, deslocamento, câmera e utilitários. |
| **6.6M.6.2–6.2.2 — Estados/filtros** | ✅ | Filtros Ação/Bônus/Reação, espera, tooltip, seleção/desseleção de atalhos. |
| **6.6M.6.3–6.3.1 — Hotbar 48 slots** | ✅ | Grade 2×24, edição, troca/remoção, salvamento e persistência por personagem. |
| **6.6M.6.4 — Targeting por token** | ✅ | Escolha de alvo no grid, modo de rolagem e execução pelo fluxo autoritativo existente. |
| **Habilidades do bestiário** | ✅ fundação | Cadastro de ações, bônus, reações assistidas e passivas; usos por cópia e execução na economia existente. Nome e descrição do uso no registro público; saldos privados. Áreas com salvaguarda e dano publicadas. Recarga em 1d6 implementada, testada e publicada. Ataques Múltiplos com quantidades por ataque, uma Ação e alvos por golpe implementados, testados e publicados. Ações Lendárias implementadas e testadas: pausa entre turnos, saldo por cópia, ataques automáticos e efeitos assistidos. Publicação pendente da migração e reinício. |
| **Bestiário e tokens** | ✅ | Cadastro em etapas com rolagem interna, campos sem cortes e atributos em bandeirinhas; ataques por cards e galeria com imagens por cópia e números só nas criaturas repetidas. Olho clicável para ocultar/revelar. Ocultação no grid/iniciativa e sinal de inconsciência; mortos e incapazes não geram oportunidade. |
| **Preparação e encontros salvos** | ✅ | Aba Combate com encontros salvos, criação e início no cabeçalho. Wizard ampliado com zoom no mapa, jogadores e NPCs únicos por botão; batalha em aba temporária Combate em andamento. Reforços incluem jogadores, aguardam iniciativa no topo e permitem antecipação explícita do Mestre. |
| **Participantes durante o combate** | ✅ | Incluir criaturas/NPCs pelo grid e remover pelo token, preservando cadastros e turno. Iniciativa do jogador com rolagem interna. |
| **6.6M.7 — Pré-iniciativa** | ✅ | Mesma dock, CTA de iniciativa sobre Hotbar indisponível e transição para espera/turno. |
| **6.6M.8–8.3 — Death UI/realtime** | ✅ | Hooks React, dock no estado de morte, Scene preservada, contadores sem F5 e End Turn correto. Dado tem arremesso, saltos e pouso suave dentro do círculo da bandeja, com animação própria de morte para autor e espectador. Giro acompanha os saltos até o pouso. Antes de rolar, exibe a face de oração na vertical, sem selo D20. Frases conforme contadores e resultado, com adorno acima do círculo, implementadas, testadas e publicadas. Título ilustrado compacto e centralizado abaixo da bandeja, antes de rolar, sem divisórias e com dourado harmonizado. |
| **6.6M.9 — Golden Path** | ✅ | Smoke de sessão contínua Mestre + jogadores, combate, ataque, movimento, morte, realtime e encerramento. |
| **6.6M.9.1 — Contrato de unidades** | ✅ | Fixture e testes alinhados ao contrato histórico; velocidades fracionárias como 7,5 m. |
| **6.6M.9.2 — Consistência do saldo** | ✅ | Unifica consumo/reconciliação entre grid, Ação Mover, Disparada e Levantar, incluindo bônus e Exaustão. |

**Cuidado com o Golden Path:** `src/scripts/smoke-combat-playable.ts` usa schema descartável. Não interpretar velocidade histórica `speed=9` como `9 ft`; não alterar as asserções para esconder falhas mecânicas. A 6.6M.9.2 é integração validada no escopo, **não** uma conversão global de toda a persistência para pés.

## 6. Próximas etapas e prioridades

A **sequência abaixo é direcional**, não autorização para antecipar fases. Escolha **uma única microfase** por implementação, verificando antes os contratos reais no GitHub e atualizando o Roadmap compartilhado.

### Prioridade atual — Refinar ataques de oportunidade

| Entrega | Estado | Resumo |
|---|---|---|
| **Gatilho, hotbar e área de ameaça** | ✅ implementada e testada | Relações na preparação e no token, alcances, aura e confirmação de movimento. Pergunta de reação direcionada ao dono; neutros e hostis se ameaçam nos dois sentidos. Aros por relação e ajustes do token disponíveis. |
| **Pendências do personagem assumido** | ✅ implementada e testada | Mestre responde testes de morte, concentração e salvaguardas no contexto do turno. Rolagens públicas, sem cards duplicados nem resolução simultânea repetida. |
| **Hostilidade após ataques** | ✅ implementada e testada | Ataques de arma e ataques mágicos envolvendo NPC neutro abrem decisão privada do Mestre, com seleção dos envolvidos e relação mútua por participante. Fila persistente, inclusive fora da aba de combate. |
| **Duelo entre jogadores** | ✅ implementada e testada | Convite privado com aceite do destinatário, hostilidade somente entre os dois e encerramento por envolvidos ou Mestre. Ataques manuais continuam disponíveis; oportunidades pendentes são encerradas sem gastar Reação. Atalho retrátil compartilhado por Mestre e jogadores. |
| **Conjurador de Guerra** | ✅ implementado e testado | Magia elegível na janela de oportunidade, usando Reação; salvaguardas pausam o movimento. Talento da ficha ou passiva explícita no bestiário, vantagem na concentração e gestos com arma/escudo. Limitado às magias executáveis. |

### Prioridade 1 — Consolidar linha de visão e cobertura espacial

| Frente | Estado | Próxima entrega desejada |
|---|---|---|
| **6.6L — Linha de visão / caminho livre** | ✅ casos claros; 🟡 expansão | Flags independentes, footprints completos e visão no ponto de saída do alcance. Paredes distantes não pedem confirmação; barreiras opacas completas impedem a oportunidade e magias que exigem visão. Cantos, frestas, iluminação e sentidos especiais seguem assistidos ou planejados. |
| **6.6J.5 / 6.6L — Cobertura geométrica** | ✅ casos claros; 🟡 expansão | Mestre define nenhuma, meia, três quartos ou total no obstáculo. Servidor aplica o maior grau interposto, sem somar; movimento e visão independentes. Cantos, frestas e altura seguem assistidos. |
| **6.6J.3 — Áreas no grid** | ✅ cadastro e execução publicados | Cinco formas, seleção no grid, salvaguardas no Registro e dano compartilhado. Usa elevação do token/terreno; outro nível só por exceção do Mestre. Bloqueio de ataques nas paredes respeitado. Recarga em 1d6 publicada. Prévia por tipo de dano e compartilhamento aos jogadores testados e publicados. Ataques Múltiplos implementados, testados e publicados. Próximo: validar as habilidades na mesa. |
| **Elevações e desníveis** | ✅ fundação assistida | Prévias do fundo e do mapa salvo nas configurações; medidas alinhadas em metros. Zoom nítido e novos mapas na resolução original. Editor em tela dedicada, sem rolagem da página, com câmera WASD/zoom, Espaço para salvar e radial animado de ferramentas e ajustes das paredes. Campo fixo de altura por escrita manual em metros, recolhido durante a pintura. Pinceladas acumuladas, Novo traço para paredes, borracha universal e pintura âmbar de terreno difícil com custo no servidor. Pincel por quadrados, altura em metros, plataformas/fossos e altura corporal por token. Travessias dependem do Mestre, com custo adicional e reações preservadas. Áreas usam a elevação do executor, com exceções pontuais do Mestre; altura corporal não é exigida nesse fluxo. |
| **Unidades FEET/METERS — normalização interna** | ⬜ dívida arquitetural | Auditoria e migração/versionamento explícitos para campos legados em metros, especialmente `TurnEconomy`/JSONB de combates ativos; não fazer conversão oportunista. |

### Prioridade 2 — Ampliar conteúdo PHB executável

| Etapa | Estado | Próxima entrega desejada |
|---|---|---|
| **6.7 — Duração e passagem do tempo** | 🟡 núcleo de combate | Ampliar expiração, pausas e passagem de tempo fora de combate. |
| **6.8 — Componentes de magia** | 🟡 quase concluída | Completar casos de voz, gestos, focos, mãos e componentes materiais. |
| **6.9 — Magias especiais** | ⬜ | Handlers específicos quando nenhum padrão do Spell/Effect Engine cobre o PHB. |
| **6.10 — Classes, raças, subclasses e talentos** | 🟡 | Executar características faltantes reaproveitando recursos, efeitos e economia. |
| **6.11 — Catálogo PHB executável** | 🟡 cobertura inicial | Ampliar magias e habilidades realmente executáveis; separar entrada catalogada de handler funcional. |
| **6.12 — Hotbar ampliada / Tomo** | 🟡 fundação de ataques | Ligar magias, características e itens somente quando seus fluxos autoritativos estiverem implementados; Tomo consome Spell Engine. |
| **6.6K — Resultados adicionais** | ⬜ | Novos padrões de resolução combinada (condições, PV temporários e efeitos especiais) sem duplicar motores. |

### Prioridade 3 — Reações e integrações complexas

- **Fase 7 (🟡 fundação):** Opportunity Attacks já existem. Ampliar reações PHB 2014 como *Shield*, *Counterspell*, estilo *Protection* e usos de *Ready*, integrando Reaction Foundation, Concentração e Resolution Cards.
- Testar autorização, janela de decisão, recurso de Reação, simultaneidade, cancelamentos e resultados em servidor/Socket.io.

### Prioridade 4 — Mestre, robustez e UX

- **Fase 8 (🟡):** enriquecer compêndio, buscas, cadastros, reutilização de conteúdo, encontros e controles administrativos.
- **Fase 8.5 (⬜):** Arquivo do Mestre com múltiplos quadros, cards de Cena/NPC/Local/Armadilha, conexões, encontros e revelações. Estados narrativos dos cards são **manuais do Mestre**.
- **Fase 8.5 (⬜ conceito complementar):** Soundboard e áudio sincronizado por Scene/sessão, biblioteca ou upload; armadilhas com execução assistida e confirmação do Mestre, sem dano automático não autorizado.
- **Fase 9 (⬜):** importação/exportação, compatibilidade de dados, migrações e conteúdo complementar.
- **Fase 10 (🟡):** segurança, backups, recuperação, observabilidade, deploy e verificações operacionais.
- **Fase 11 (🟡):** acessibilidade, responsividade, performance, feedback e consistência visual. Estabilidade mecânica vem primeiro.

## 7. Critérios comuns de conclusão

Uma etapa só recebe ✅ quando o escopo foi implementado **e** há evidências proporcionais ao risco. Separar claramente:

1. **Análise:** HEAD/origin, WIPs, contratos existentes, regra PHB e causa raiz.
2. **Implementação mínima:** reaproveitar engines, servidor autoritativo, sem ampliar escopo.
3. **Testes:** unitários/invariantes, integração/autorização, idempotência, concorrência e realtime conforme risco.
4. **Segurança dos dados:** NUNCA usar usuários, fichas, NPCs ou combates reais como fixtures mutáveis. Criar IDs exclusivos, limpar apenas os próprios, exigir schema/banco descartável e verificar **ANTES = DEPOIS** nos dados reais. Não selecionar fixture com `findFirst()` em dados da campanha.
5. **Validação:** distinguir typecheck, build, smoke, render jsdom, navegador real e validação manual do usuário. **Não afirmar navegador se não houve navegador.** Falha nova não é flake por presunção.
6. **Entrega:** revisar `git diff`, `git status` e staging, preservar WIPs alheios, criar **um commit isolado**, push sem force conforme autorização da tarefa e confirmar `origin/main`. Se houver divergência/rejeição, **parar**, sem rebase/merge/overwrite automático.
7. **Relatório:** HEAD inicial/final, causa, arquivos, testes, dados, browser ou ausência, commit SHA, push, pendências e próxima etapa. Sincronizar apenas o trecho afetado deste arquivo e da aba Roadmap.

Comandos de referência (não executá-los contra banco real sem revisar o que fazem):

```bash
npm run typecheck
npm run typecheck:client
npm run build
npm run build:client
npm run test:combat-ui
npm run test:operation-id
# Smokes dedicados: somente com schema/servidor de teste explicitamente isolados.
# Evite npm run smoke legado contra dados reais; revise seu isolamento primeiro.
```

## 8. Como um agente deve usar este arquivo

1. Ler `AGENTS.md`, este roadmap e a seção do Roadmap compartilhado correspondente à tarefa.
2. Conferir código **atual** antes de confiar em estados/SHAs históricos.
3. Identificar exatamente **uma** fase/microfase a executar e suas dependências.
4. Formular escopo, PHB 2014, arquitetura reutilizada, casos de borda, testes, **não implementar** e critérios de aceite.
5. Implementar/testar sem tocar na campanha; preservar WIPs e produzir commit isolado e relatório.
6. Só alterar o status para ✅ após evidência técnica e, quando for crítica, validação do usuário. Uma regressão descoberta depois **rebaixa** a etapa para 🟡.
7. Não reescrever o Roadmap inteiro: atualizar apenas status, dívida, resumo da entrega e próxima ação.

> **Lembrete:** GitHub diz **o que existe**; o Roadmap compartilhado diz **onde estamos e para onde vamos**; PHB 2014 determina **as regras**; o Mestre mantém **a palavra final**.
