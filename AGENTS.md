# AGENTS.md — Guia do projeto para agentes de IA

> **Leia isto antes de editar qualquer coisa.** Este arquivo é o mapa técnico do
> **Grimório Digital** (nome interno do repo: `grimorio-digital`), um sistema web
> multiusuário para mesas de **D&D 5ª Edição (PHB 2014)**. O `README.md` na raiz
> é a documentação *funcional* (o que cada recurso faz, endpoint por endpoint);
> este arquivo é a documentação *para quem vai mexer no código*: arquitetura,
> convenções, comandos, fluxo de trabalho e armadilhas.
>
> **Responda e escreva código/comentários/commits em PT-BR.** O projeto é todo em
> português: comentários, mensagens de erro, nomes de commit e até nomes de
> variáveis de domínio (ex.: `corrente`, `usos`, `descanso`) quando faz sentido.

---

## 1. O que é o projeto

Uma mesa de RPG fixa (4–6 jogadores + 1 mestre) com:

- **Ficha de personagem dinâmica** do jogador, com todos os cálculos de D&D 5e
  feitos **no servidor** (PV, CA, iniciativa, perícias, salvaguardas, CD de magia,
  espaços de magia, controle de carga etc.). Edição inline: clicar no valor vira
  campo, Enter/sair salva, Esc cancela.
- **Painel do mestre**: enxerga todas as fichas (só leitura, com botão para
  editar), cadastra criaturas/NPCs, itens, regiões e localidades, controla o
  Level Up, libera/reduz níveis e comanda o combate.
- **Combate em tempo real**: iniciativa, ordem de turno, ataques que aplicam dano
  automaticamente e HP sincronizado para todos os conectados.
- **Descanso Curto/Longo**, inclusive **coletivo** (a mesa inteira responde e o
  descanso conclui junto), com restauração automática de espaços de magia,
  dados de vida, recursos de classe e recursos raciais.
- **Tempo real** via Socket.io: ficha (`sheet:updated`), combate, dados, presença,
  regiões/localidades, itens, música ambiente e apresentação de imagens.

### Regras de escopo

- **Uma única mesa fixa** — não há múltiplas campanhas/salas. Não introduza
  `campaignId`/tenancy sem pedido explícito.
- **Sem chat integrado** (usa-se Discord à parte).
- Sistema de regras: **D&D 5e PHB 2014**. Não misture material de outras edições.

---

## 2. Stack e infraestrutura

| Camada | Escolha |
|--------|---------|
| Runtime | Node.js **>= 20** |
| Linguagem | TypeScript em **ESM** (`"type": "module"`) — backend e frontend |
| HTTP | **Express 5** |
| Banco | **PostgreSQL** |
| ORM | **Prisma 6** (migrations versionadas + client tipado) |
| Validação | **Zod 3** (env, payloads de entrada) |
| Auth | **JWT** (`jsonwebtoken`) + **bcryptjs** (custo 12) |
| Tempo real | **Socket.io 4** (HTTP e WS na **mesma porta**) |
| Frontend | **React 19 + Vite 8 + TypeScript** |
| Rate limit | `express-rate-limit` |

- HTTP e WebSocket compartilham o mesmo `http.Server` (Express + Socket.io):
  só existe **uma porta** (`PORT`, padrão `3000`).
- O Express serve o build do client (`client/dist`) de forma estática em produção;
  em dev o Vite (porta `5173`) faz proxy de `/api` e `/socket.io` para `3000`.
- O servidor de arquivos estáticos e uploads (`src/lib/uploads.ts`) grava em
  `uploads/` (ignorado pelo git).

### Variáveis de ambiente (`src/config/env.ts`, validado por Zod)

| Variável | Obrigatória | Padrão | Observação |
|----------|-------------|--------|------------|
| `DATABASE_URL` | sim | — | PostgreSQL |
| `JWT_SECRET` | sim (min. 16 chars) | — | assina os tokens |
| `JWT_EXPIRES_IN` | não | `7d` | formato do `jsonwebtoken` |
| `PORT` | não | `3000` | |
| `CORS_ORIGIN` | não | `*` | lista separada por vírgula em produção |
| `MASTER_INVITE_CODE` | não | — | código para registrar conta `MASTER` |
| `NODE_ENV` | não | `development` | **ver armadilha do systemd abaixo** |

> ⚠️ **`NODE_ENV` no `.env`:** o unit systemd usa `EnvironmentFile`, que tem
> **precedência** sobre `Environment` no systemd. Por isso o `.env` **não deve**
> conter `NODE_ENV`, senão o serviço sobe como `development` (e o rate limiter
> afrouxa). Deixe comentado, como no `.env.example`.

### Ambientes de execução

- **Local (esta máquina / dev):** `npm run dev` (backend em `tsx watch`) +
  `npm run dev:client` (Vite em `5173`).
- **Serviço systemd (produção nesta máquina):** `deploy/grimorio.service` roda
  `node dist/index.js` com `NODE_ENV=production`. Alterar código exige
  **rebuild antes de reiniciar**:

  ```bash
  npm run build && npm run build:client
  sudo systemctl restart grimorio
  ```

  O unit é versionado em `deploy/grimorio.service` e copiado para
  `/etc/systemd/system/grimorio.service` (`daemon-reload` + `enable --now`).
- **Deploy genérico:** `npm run prisma:deploy && npm start` (mais `npm run build`).
  Health check em `GET /api/health` → `{ "status": "ok", "database": "up" }`.

---

## 3. Mapa de diretórios

### Backend (`src/`)

```
src/
├── index.ts              # bootstrap: sobe o http.Server, Socket.io e graceful shutdown
├── config/
│   ├── env.ts            # validação Zod das variáveis de ambiente
│   └── prisma.ts         # singleton do PrismaClient
├── http/
│   ├── app.ts            # monta o Express (CORS, helmet, JSON, rotas, static, erros)
│   └── routes/
│       ├── index.ts      # apiRouter: registra todos os routers de domínio sob /api
│       └── health.ts
├── lib/                  # utilitários sem regra de domínio
│   ├── http-error.ts     # classe HttpError(mensagem, status, CODE) + handlers
│   ├── jwt.ts, password.ts, uploads.ts
├── middlewares/          # tratamento central de erros
├── modules/<domínio>/    # um diretório por área (ver padrão na seção 5)
├── realtime/             # Socket.io: hub, rooms, presence, broadcast, events, auth
├── scripts/              # CLIs e o smoke test (ver seção 9)
├── types/                # augmentation de tipos do Express/Socket.io
└── (o domínio de regras puras fica em src/modules/shared/ — ver seção 4)
```

### Frontend (`client/src/`)

```
client/src/
├── main.tsx / App.tsx / auth.tsx / readonly.tsx / theme.ts
├── pages/
│   ├── SheetPage.tsx     # tela do jogador (ficha + inventário + criação)
│   └── MasterPanel.tsx   # painel do mestre (abas: Fichas, Criaturas, Itens, Regiões, Mesa...)
├── components/
│   ├── SheetView.tsx     # a ficha em abas (Personagem, Atributos, Magias, Ataques, Características...)
│   ├── sections/         # uma seção por aba (VitalsSection, SpellsSection, FeaturesSection...)
│   ├── creation/         # assistente de criação (CreationWizard em 9 passos)
│   ├── master/           # painel do mestre (fichas, criaturas, itens, regiões...)
│   ├── Icon.tsx, HpBar.tsx, Lightbox.tsx, ItemDetailModal.tsx, InlineField.tsx, Section.tsx...
├── combat/               # CombatTracker, CombatIntro, CombatStartDialog, estado do combate
├── dice/                 # janela de dados 3D (poliedros com matrix3d)
├── rest/                 # hooks e APIs do descanso curto/longo (useShortRest, restApi...)
├── music/                # música ambiente
├── api.ts                # cliente HTTP com token (fetch)
├── featuresApi.ts, spellbookApi.ts, levelUpApi.ts, inventoryApi.ts, coinsApi.ts,
│   creationApi.ts, gameApi.ts, presentationApi.ts, races.ts, dnd.ts, types.ts...
├── socket.ts, useRealtime.ts, events.ts
├── styles.css            # TODO o tema (tokens claro/escuro, layout, animações)
└── fonts.css             # @font-face das fontes auto-hospedadas (gerado)
```

### Outros

```
prisma/
├── schema.prisma         # models + datasource PostgreSQL
└── migrations/           # migrations versionadas (uma pasta por migração)

deploy/
├── grimorio.service      # unit systemd
└── deploy.sh
```

---

## 4. Modelo de dados (Prisma)

O schema está em `prisma/schema.prisma`. Models principais:

| Model | Papel |
|-------|-------|
| `User` | conta (`PLAYER`/`MASTER`); ficha com `userId` **único** (1 usuário ↔ 1 ficha) |
| `Character` | a ficha (ver abaixo) |
| `CharacterOperation` | **idempotência** das operações de ficha (`unique(characterId, operationId)`) |
| `Combat` / `Combatant` | combate persistido (sobrevive a reload/reconexão) |
| `Creature` | bestiário do mestre (preso a uma `Locality`) |
| `Region` / `Locality` | mundo do mestre (localidades sempre dentro de uma região) |
| `Item` | catálogo de itens (espelhado no inventário dos personagens) |
| `CustomRace` | raças personalizadas do mestre (tabela `custom_races`) |
| `ShortRestSession`/`ShortRestRequest`/`ShortRestOperation` | descanso curto (individual e coletivo) |
| `LongRestSession`/`LongRestRequest`/`LongRestOperation` | descanso longo (individual e coletivo) |
| `LongRestCampSupplyContribution` | suprimentos de acampamento do descanso longo |
| `GameConfig` | linha única de config da mesa (level up release, nível inicial, notas do mestre) |
| `MusicTrack` / `MusicState` | música ambiente |

### `Character`: híbrido colunas + JSONB

Padrão de modelagem: **campos simples e muito consultados em colunas**;
**coleções maiores em `Json` (JSONB) validado por Zod**.

- **Colunas:** `name`, `level`, `experience`, os 6 atributos, `hpCurrent/hpMax/hpTemp`,
  `armorClass` (só override do mestre), `initiativeBonus`, `speed` (fracionário),
  `notes`, `version`, `creationFinalized`, `toolProficiencies` (`text[]`),
  `languages`, `darkvision`, `raceResistances`, `lastLevelUpRelease`, `raceId`/`subraceId`.
- **JSONB:** `classes`, `classState`, `racialState`, `mechanicalState`, `spells`, `hitDice`, `coins`,
  `levelHistory`, `features`, `inventory`, `attacks`, `skills`, `saves`,
  `proficiencies`, `raceChoices`, `creationDraft`.

> **Edição de coleção = substituição integral.** Quando um JSONB é enviado no
> PATCH, ele substitui o valor anterior inteiro — sem merge profundo. Isso torna a
> edição inline previsível; respeite esse contrato.

> **`version`** é o relógio de concorrência da ficha: **toda escrita** faz
> `updateMany({ where: { id, version: expectedVersion }, data: { version: { increment: 1 } } })`.
> O frontend ignora eventos com `version` menor que a atual.

---

## 5. Padrões de código — backend

### 5.1 Estrutura de um módulo (`src/modules/<domínio>/`)

```
<domínio>.routes.ts    # define rotas, aplica middlewares de auth/role e chama o service
<domínio>.service.ts   # regra de negócio, acesso ao Prisma, publicação de eventos
<domínio>.schema.ts    # schemas Zod das entradas
<domínio>.dto.ts       # monta o DTO (payload de resposta/evento) a partir do registro
```

- Routers são montados em `src/http/routes/index.ts` sob `/api` (ex.: `/api/characters`).
- Auth: `authenticate` (exige token válido) e `requireRole('MASTER')` — o role
  **vem sempre do token**, nunca do corpo da requisição.
- Erros: lance `HttpError(mensagem, status, CODE)` em `src/lib/http-error.ts`.
  O middleware central formata `{ error, message }`. Códigos conhecidos incluem
  `VALIDATION_ERROR` (400), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT`
  (409), `IDEMPOTENCY_KEY_REUSED` (409), `TOO_MANY_REQUESTS` (429).
- Validação de entrada com Zod: `schema.safeParse(req.body)`; em erro, responda
  `400 { error: 'VALIDATION_ERROR', issues }`.

### 5.2 Escritas **server-authoritative** de estado de jogo

Toda operação que **gasta/restaura recursos** (usar recurso de classe/racial,
descansar, usar item, level up/down...) segue **três invariantes**:

1. **`expectedVersion`** — o cliente manda a `version` que tem em mãos; a escrita
   usa `updateMany where { id, version: expectedVersion }` e, se o `count` for 0,
   **409** sem efeito. Isso é controle de concorrência (evita duas abas
   sobrescreverem), e é conferido **antes** de rolar qualquer dado.
2. **`operationId`** — chave de idempotência. Antes de aplicar, procure a operação
   (`findOperation`) no model `*Operation` / `CharacterOperation`; se já existe,
   devolva o resultado salvo (`replaySnapshot`) e marque `replayed: true`, **sem
   aplicar de novo**. Mesmo `operationId` com **payload diferente** (fingerprint)
   ou com **outro tipo** → **409 `IDEMPOTENCY_KEY_REUSED`**.
3. **O dado é rolado no servidor** (`src/modules/shared/dice.ts`, `crypto.randomInt`).
   O cliente **nunca** envia o resultado. Efeito + consumo do recurso entram na
   **mesma** escrita (transação) para não divergir.

Padrões de idempotência em `characters.service.ts` (`replaySnapshot`, `findOperation`,
`SHORT_REST_START_TYPE`...) e em `rest/rest.service.ts` / `rest/long-rest.service.ts`
(última classe de execução).

### 5.3 Persistência de recursos: `used` vs `max`

**Regra de ouro:** a ficha só persiste o **estado de uso** (`used` ou `usos`);
o **máximo** e as demais definições são **derivados** do catálogo (classe/raça/nível)
a cada requisição. Nunca grave o `max` — ele muda com a progressão e ficaria
desatualizado. Reconciliadores (`reconcileClassResourceState`,
`reconcileRacialResourceState`) ajustam o `used` quando o nível/raça muda.

### 5.4 Domínio de regras puras — `src/modules/shared/`

Tudo que é **regra de D&D 5e sem I/O** vive aqui, para ser reutilizado por
services, DTOs e pelo smoke:

```
shared/
├── dnd5e.ts        # modificadores, proficiência, perícias, passiva, carga
├── dice.ts         # rolador (expressões 2d6+3, crítico dobra só os dados)
├── attacks.ts      # dano estruturado { count, sides, bonus, type } + tipos canônicos
├── armor-class.ts  # cálculo de CA (armaduras, escudos, Defesa sem Armadura)
├── hit-dice.ts, coins.ts, level-history.ts, creation.ts, languages.ts
├── camp-supplies.ts, ammo.ts, weapon-attacks.ts, item-details.ts, images.ts, json.ts
├── classes/        # motor de classes: types.ts + index.ts + um arquivo por classe
│                   # ClassState, normalizeClassState, computeClassAdjustments,
│                   # reconcileClassResourceState, cleanupActiveEffectsForRest,
│                   # restore*RestResources, tabelas de spaces/ASI/proficiências
├── races/          # catálogo racial: types.ts + index.ts + um arquivo por raça
│                   # + resources.ts (recursos raciais PHB 2014)
├── spells/         # catálogo de magias (catalog/ com as 361 do PHB)
├── feats/, tools/, weapons/, backgrounds/
```

- **Dado de vida / PV / CA / espaços / CD / iniciativa / percepção passiva / carga**
  são sempre **calculados**, nunca guardados como valor fixo (exceto o override de
  CA do mestre em `armorClass`).
- Adicionar uma classe/raça/magia = adicionar/editar o arquivo daquele item e
  registrar no `index.ts` do catálogo. Siga o formato dos arquivos vizinhos.

---

## 6. Padrões de código — frontend

- **`client/src/api.ts`**: `fetch` com `Authorization: Bearer <token>`; base
  relativa (`/api/...`), funciona em dev (proxy) e produção (mesma origem).
- **Sem libs de estado/roteamento**: React puro + contexto (`auth.tsx`,
  `readonly.tsx`, `theme.ts`). Não adicione Redux/Zustand/react-router sem pedido.
- **`useRealtime.ts`** assina os eventos do Socket.io e atualiza o estado; o
  backend é sempre a fonte de verdade.
- **APIs por domínio** (`featuresApi.ts`, `restApi.ts`, `spellbookApi.ts`...)
  geram o `operationId` por chamada (`newId()`) e mandam a `expectedVersion`.
- **`InlineField`** = campo que vira input ao clicar; Enter/salva, Esc/cancela.
- **`readonly.tsx`** coloca a ficha inteira em modo leitura (visão do mestre).
- **`styles.css`** concentra o tema (tokens `data-theme`, `:root`) — mudanças
  visuais ficam lá, não em estilos inline espalhados.
- **Tema:** claro = "pergaminho", escuro = "grimório amaldiçoado"; `index.html`
  aplica o tema salvo **antes da primeira pintura** para evitar flash.
- **`client/dist` é estático**: para publicar no serviço basta `npm run build:client`
  (o Express serve os arquivos; **não** precisa reiniciar o backend), mas mudanças
  no **backend** exigem `npm run build` **e** restart.

---

## 7. Tempo real (Socket.io)

- O contrato de eventos está **centralizado em `src/realtime/events.ts`**
  (`ServerEvents`, `ClientEvents`, payloads tipados). **Registre todo evento novo
  ali** — nunca espalhe strings soltas.
- Convenção de nome: `dominio:acao` (ex.: `sheet:updated`, `combat:turn`).
- **O WebSocket é canal de notificação, não de escrita.** As escritas acontecem
  por HTTP (PATCH/rotas de ação), que persiste e **então** publica o evento.
  Isso evita dois caminhos de gravação divergentes. Não crie writes por socket.
- Salas (`rooms.ts`): `table:main` (mesa toda), `user:<userId>` (as abas do próprio
  jogador) e `role:masters` (só mestres).
- **A identidade nunca vem do cliente** (`userId`/`username` são carimbados do
  token). Handshake WS e cada requisição HTTP **conferem a conta no banco**, então
  excluir um usuário invalida o token na hora.
- Eventos efêmeros (apresentação de imagem, janela de dados) vivem **só na memória**
  do servidor e são reenviados a quem conecta no meio.

---

## 8. Comandos, build e testes

Scripts do `package.json` raiz:

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | backend em dev (`tsx watch`) |
| `npm run build` | compila o backend (`tsc -p`) para `dist/` |
| `npm start` | roda o build (`node dist/index.js`) |
| `npm run typecheck` | `tsc --noEmit` (backend) |
| `npm run prisma:generate` | gera o Prisma Client (rodar após mexer no schema) |
| `npm run prisma:migrate` | cria/aplica migration em dev (`prisma migrate dev`) |
| `npm run prisma:deploy` | aplica migrations em produção |
| `npm run db:push` | sincroniza o schema sem migration (evite em produção) |
| `npm run smoke` | smoke test ponta a ponta (**exige servidor rodando**) |
| `npm run setup` | instala deps do backend e do frontend |
| `npm run dev:client` / `build:client` / `typecheck:client` | frontend |
| `npm run create-master -- ...` | cria/promove a conta de mestre |

### Smoke test — a verificação do projeto

**Não há testes unitários.** A verificação é `src/scripts/smoke-realtime.ts`
(~21k linhas): sobe contas próprias, exercita HTTP + WebSocket de ponta a ponta e
limpa tudo no fim. Ele cobre dezenas de seções (fichas, regras, combate, level
up/down, compêndio, itens, moedas, descansos, recursos raciais...).

Boa prática de execução (preserva o status real apesar do `tee`):

```bash
set -o pipefail
npm run smoke 2>&1 | tee /tmp/smoke.log | tail -60
echo "SMOKE=${PIPESTATUS[0]}"
```

- O servidor **precisa estar rodando** e, de preferência, com combates limpos:
  `PGPASSWORD=postgres psql -h localhost -U postgres -d grimorio -c "DELETE FROM combats;"`
- **Rate limiter do login** (`authLimiter` em `src/modules/auth/auth.routes.ts`):
  100 tentativas/15 min em dev, **30 em produção**, por IP. O smoke cria/reaproveita
  contas e as seções novas **reutilizam fichas** para não estourar o limite.
  **Reinicie o serviço entre execuções** (`sudo systemctl restart grimorio`),
  porque o limite é em memória.

Checklist de validação antes de encerrar uma tarefa:

```bash
set -o pipefail
npm run typecheck 2>&1 | tail -5;        echo "T=${PIPESTATUS[0]}"
npm run typecheck:client 2>&1 | tail -5; echo "TC=${PIPESTATUS[0]}"
npm run build 2>&1 | tail -5;            echo "B=${PIPESTATUS[0]}"
npm run build:client 2>&1 | tail -5;     echo "BC=${PIPESTATUS[0]}"
```

Só depois reinicie o serviço e rode o smoke. **Sem navegador/Chrome neste ambiente**
— não há validação visual real; declare essa limitação em vez de fingir que validou.

---

## 9. Migrations

1. Edite `prisma/schema.prisma`.
2. Crie a migration: `npm run prisma:migrate` (dev) — nomeie com data/hora como as
   existentes (`20261011120000_add_racial_state`).
3. Rode `npm run prisma:generate` e, se houver mudança de dados, escreva o backfill
   na própria `migration.sql` (ou num script em `src/scripts/`).
4. Em produção/serviço: `npm run prisma:deploy` antes de reiniciar.

> **Nunca** edite uma migration já aplicada. Sempre crie uma nova.
> Migrações antigas do projeto às vezes **apagam ou convertem** dados legados
> (ex.: a coluna `race` de texto livre foi abandonada) — confira o histórico antes
> de assumir que uma coluna antiga existe.

---

## 10. Estado atual do projeto (roadmap)

Referência do handoff oficial: `HEAD = origin/main = 91d537d` antes desta
atualização documental. As Fases 0–4 estão concluídas no escopo base/original;
a **Fase 5 está funcionalmente concluída**.

### Roadmap oficial

| Fase | Tema |
|------|------|
| 0 | Estabilidade |
| 1 | Regras fundamentais |
| 2 | Personagem/raças/backgrounds |
| 3 | Itens/inventário/economia |
| 4 | Catálogo de classes/feats/spells |
| 5 | Descansos/recursos/lifecycle |
| 6 | Engine mecânica |
| 7 | Combate |
| 8 | Compêndio/ferramentas do Mestre |
| 9 | Legacy/qualidade dos dados |
| 10 | Segurança/escala/qualidade |

A existência de funcionalidades atuais de combate e ferramentas do Mestre não
significa que as respectivas fases futuras estejam concluídas.

**Fase 6 — engine mecânica em andamento:**

- 6.1 Action Economy — fundação implementada (PHB 2014)
- 6.2 Conditions + Exhaustion — implementada (PHB 2014)
- 6.3 0 HP / Death Saves / Stabilization / Instant Death
- 6.4 Concentration
- 6.5 Generic Effect Engine
- 6.6 Basic Spell Execution
- 6.7 Duration / Effects
- 6.8 Components / Materials
- 6.9 Special Spell Handlers
- 6.10 Class/Racial Feature Integration

A 6.1 usa `Combatant.turnEconomy`, `Combat.version` e `CombatOperation`:
consumo, ataque, munição e dano são atômicos; retries devolvem snapshot sem
reaplicar. `nextTurn` mantém a ordem única e os hooks `onTurnEnd`/`onTurnStart`.
Reação recupera no início próprio, nunca no fim. Movimento é fracionável em
metros, usando o deslocamento atual da ficha/criatura; Dash soma esse valor.

Attack Action persiste id, quantidade realizada e limite derivado no servidor
pelo maior Extra Attack aplicável (não soma em multiclasse). Mão secundária
usa Ação Bônus, exige outra arma corpo a corpo leve usada em Attack Action e
fica fora do contador. Ready é assistido: preparar gasta Ação, executar gasta
Reação, sem detectar gatilho ou executar magia. Ações improvisadas e ajustes
explícitos do Mestre são logados. A disponibilidade de Ação Bônus não concede
uma ação genérica. Fora de combate não há orçamento de turno na ficha.

Lâmina Sedenta aguarda vínculo confiável de arma do pacto. Action Surge, Haste,
Protection, Great Weapon Fighting e execução avançada de características
permanecem pendentes. Não iniciar Fases 6.3+ sem especificação posterior e
decisões explícitas com o usuário. Decisões ambíguas devem ser reportadas antes
de implementar.

### Condições e Exaustão (6.2)

- `mechanicalState` é JSONB dedicado em `Character`, `Creature` e `Combatant`:
  instâncias/fontes de condições, `exhaustionLevel` separado (0–6) e log. Nunca
  guardar essas condições em `classState`, `racialState` ou `turnEconomy`.
- A mesma engine atende personagens, NPCs, templates e instâncias. Cada cópia
  de criatura recebe snapshot inicial com IDs de condição próprios e evolui
  independentemente; não devolve alterações ao bestiário ao encerrar combate.
  Personagens mantêm o estado canônico da ficha. Condições não somem ao encerrar.
- Regras agregadas em `shared/conditions.ts`. Efeitos de Incapacitated são
  derivados para Paralyzed/Stunned/Petrified/Unconscious. Incapacitated isolado
  não impede Movement. Advantage/disadvantage cancelam pela presença, não soma.
- Orçamento de movimento nominal da 6.1 é preservado; `reconcileMovement`
  projeta saldo utilizável pelo speed efetivo, sem apagar gasto. Ajustes do Mestre
  mantêm limite absoluto, sem multiplicar saldo ao remover half speed. Levantar gasta
  metade do speed efetivo e nenhuma Action/Bonus; fora de combate não há orçamento.
- Saves tipados identificam atributo/entidade; falha automática STR/DEX não
  rola dado. Rótulos livres não são interpretados como atributo. Desvantagens
  de checks também alcançam iniciativa. Rolagem livre continua narrativa.
- PV máximo efetivo é derivado, com piso inteiro em Exhaustion 4+, sem destruir
  a base. Cura, descanso, progressão e PATCH respeitam a redução; baixar Exaustão
  não cura PV. Long Rest NÃO reduz Exaustão automaticamente nesta fase.
- API `/api/mechanical`: MASTER administra fontes e Exaustão; PLAYER só usa a
  operação específica de levantar no próprio personagem. Versões de entidade
  e combate + `MechanicalOperation` protegem concorrência/retry; aliases de
  combatente de personagem usam chave canônica. Autoridade de regra é argumento
  interno do domínio, nunca um campo aceito da requisição HTTP.
- Petrified suspende Poisoned preexistente, não apaga sua fonte; rejeita novo
  envenenamento, imuniza dano Veneno e resiste a todo dano. Resistência se aplica
  antes de vulnerabilidade. Não há catálogo estruturado de condition immunities.
- Unconscious causa Prone; a queda persiste depois de acordar até levantar ou
  remoção explícita. Largar objetos é assistido/logado: nunca guardar na mochila
  ou inventar ground items. Invisible não aplica Hidden.
- Sem distância/posição/linha de visão confiáveis: Frightened fica assistido;
  modificadores contra Prone e críticos de proximidade ficam pendentes. Checks
  de visão/audição, sociais, doença, peso e envelhecimento expõem flags futuros.
- Exhaustion 6 sinaliza fatalidade, sem zerar PV, criar dead ou death saves.
  Death lifecycle, concentração, magias e duração genérica continuam futuros.
- Realtime reutiliza ficha/criatura/combate e acrescenta `mechanical:updated`
  tipado. Publicação só após commit. `smoke-conditions.ts` integra o smoke; a
  limpeza de combates do teste se limita aos IDs criados pela própria execução.

### Marcos da Fase 5 e correção posterior

| Fase | Tema | Commit (histórico da sessão) |
|------|------|------------------------------|
| 5.3A | — | `653c80f` |
| 5.3B | — | `adf61a1` |
| 5.3B.1 | — | `31f31e1` |
| 5.3C | — | `0491692` |
| 5.3D.1 | reconciliação estrutural de recursos: used/max, Level Up/Down e progressão de Inspiração de Bardo | `6907fd8` |
| 5.3D.2 | lifecycle explícito de `classState.active` e limpeza seletiva em descansos | `c87b4ba` |
| 5.3D.2.1 | Artes das Sombras (Shadow Arts) com lifecycle `special` | `5d5846e` |
| 5.3E.1 | **recursos raciais PHB 2014 separados do estado de classe** | `c9485b6` |
| 5.3E.2 | apresentação unificada de recursos de classe e raça | `be60167` |
| Pós-Fase 5 | correção dos Estilos de Luta passivos | `91d537d` |

A validação visual da 5.3E.2 foi concluída pelo usuário. O polimento visual
permanece como pendência futura não bloqueante; não iniciar redesign geral sem
tarefa específica.

### Estilos de Luta após `91d537d`

- **Defesa (Defense):** automatizado; +1 CA enquanto usar armadura.
- **Arquearia (Archery):** automatizado; +2 no ataque com armas à distância,
  sem alterar dano. Arremessar uma arma corpo a corpo não concede esse bônus.
- **Duelismo (Dueling):** automatizado; +2 no dano com arma corpo a corpo em
  uma mão, sem segunda arma empunhada; escudo permitido. Não altera ataque.
- **Combate com Duas Armas (Two-Weapon Fighting):** automatizado; modificador
  de atributo no dano do ataque apropriado com a mão secundária (offhand).
- **Combate com Armas Grandes (Great Weapon Fighting):** deferido para a
  Fase 6; exige suporte à rerrolagem dos dados de dano.
- **Proteção (Protection):** deferido para a Fase 6; exige reação, alvo e alcance.

Os estilos coexistem em multiclasse. A seleção ainda pode permitir o mesmo
estilo por fontes diferentes, mas os efeitos não acumulam. Essa lacuna conhecida
não deve ser corrigida fora de tarefa específica.

### Política de “once per day”

Somente os seguintes casos têm conversão explicitamente aprovada para Descanso
Longo (Long Rest):

- Recuperação Arcana (Arcane Recovery).
- Usos diários de Legado Infernal do tiefling (Tiefling Infernal Legacy).
- Usos diários de Magia Drow (Drow Magic).

**Não existe conversão global automática de once/day para Long Rest.** Para
qualquer novo caso, parar e perguntar ao usuário antes de implementar.

> Migrations: **43**. Os hashes acima são o estado no momento em que este arquivo
> foi escrito — confirme com `git log` antes de assumir.

### Lacunas conhecidas (não são bugs, são fases futuras)

- Fundação de **ações/reações em combate** implementada na Fase 6.1; integração
  do catálogo ainda é futura. Referências antigas no código a
  `TODO (Fase 5 — motor de ações)` usam a numeração anterior.
- Execução real de magias/efeitos e integração de características de classe/raça
  pertencem à Fase 6; o catálogo estruturado não equivale à execução mecânica.
- Companheiro animal do Senhor das Feras como ficha própria permanece futuro.
- Raças **personalizadas** do mestre (`custom_races`) **não** modelam recursos.

---

## 11. Armadilhas e regras de convivência (leia antes de editar)

1. **O smoke é enorme.** Adicionar uma seção grande pode estourar
   `TS2563: The containing function or module body is too large for control flow
   analysis`. Envolva blocos novos em **IIFE assíncrono**
   (`await (async () => { ... })();`) — às vezes sub-IIFEs aninhados.
2. **Flakies conhecidas do smoke (não "consertar"):**
   - a seção de **Short Rest coletivo concorrente** pode devolver
     `{"statuses":[200,409],"a":1}` (corrida esperada — um ganha, o outro recebe 409);
   - um teste de **crítico 2d10** aleatório pode oscilar no log de ataque derivado.
   Se aparecerem, apenas registre; não são regressão.
3. **Rate limiter em memória:** reinicie o serviço antes de cada smoke; sem isso
   execuções repetidas dão `TOO_MANY_REQUESTS`.
4. **`NODE_ENV` fora do `.env`** (ver seção 2) para não quebrar o serviço.
5. **Backend exige rebuild + restart**; só o client é estático.
6. **Nunca versione arquivos temporários `tmp-*`** nem `uploads/`, `dist/`,
   `node_modules/`, `.env`.
7. **Estado do working tree nesta máquina (ao escrever este arquivo):** há um WIP
   não commitado de longa data em
   `client/src/components/sections/InventorySection.tsx` e no hunk `.inv-hover`
   de `client/src/styles.css`. **Não os inclua em commits** de outras tarefas —
   confira `git status`/`git diff --cached` antes de commitar (cheque que as
   mudanças preparadas são só as suas).
8. **Não commite `tmp-*`** e sempre confira o que está staged quando o usuário
   pedir um commit.

---

## 12. Convenções de git e fluxo de trabalho

- **Commit em PT-BR**, focado no **porquê** (não no "o quê"), com rodapé:

  ```
  <mensagem concisa>

  🤖 Generated with Codebuff
  Co-Authored-By: Codebuff <noreply@codebuff.com>
  ```

- Antes de commitar, faça os guards óbvios: `git status --short`,
  `git diff --cached --name-only` e confirme que não entrou WIP alheio.
- **Push só quando o usuário autorizar** (`git push origin main`).
- Prefira **editar arquivos existentes** a criar novos; faça a menor mudança que
  resolve o pedido, seguindo o padrão do módulo vizinho.
- Comentários e mensagens de erro em **PT-BR**, explicando a *decisão* (o código já
  diz o "o quê").
- Imports relativos no backend ESM terminam em **`.js`** (ex.:
  `import { x } from './y.js'`), mesmo o arquivo-fonte sendo `.ts`.

---

## 13. Contas e dados de teste (ambiente local desta máquina)

O banco `grimorio` (PostgreSQL 17, `postgres`/`postgres` em `localhost:5432`) pode
conter contas reais de teste, por exemplo um `MASTER` (`mestre_mun1khyj`) e
jogadores (`razzil`, `umbrae`). **Trate-as como dados de verdade:** não as apague
nem seus personagens fora de um teste que você mesmo criou. O smoke cria e limpa
as **próprias** contas — não reaproveite contas reais sem necessidade.

---

## 14. Resumo rápido para a IA

1. Objetivo: sistema de mesa de D&D 5e PHB 2014, **PT-BR**, servidor autoritativo.
2. Backend Node/TS ESM + Express 5 + Prisma/Postgres + Zod + Socket.io; frontend
   React 19 + Vite. Uma porta, sem multi-tenancy.
3. Regras de D&D puras em `src/modules/shared/`; ficha grava só **estado de uso**,
   o resto é derivado; `version` protege concorrência; `operationId` dá idempotência.
4. WebSocket só **notifica**; escrita é HTTP.
5. Validar com `typecheck` (backend+client), `build` (backend+client) e `smoke`
   (servidor rodando, restarte entre execuções).
6. Regras de ouro: não commite WIP alheio nem `tmp-*`; não edite migrations prontas;
   não invente lib/estado global; siga o padrão do módulo vizinho.
7. Sem navegador aqui: declare a limitação em vez de alegar validação visual.
