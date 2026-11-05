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

**Regra de fixtures:** smokes NUNCA devem usar, normalizar ou apagar personagens,
contas, criaturas ou combates reais da campanha. Cada seção cria as PRÓPRIAS
fixtures (usuários/personagens com sufixo aleatório) e o `finally` remove apenas
os IDs que ela criou — nunca "delete all test-looking rows".

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
- 6.4 Concentration — implementada (PHB 2014: estado, dano → save, fila e
  público/privado de NPC); duração automática continua na 6.7
- 6.5 Generic Effect Engine — **concluída no escopo de provas (6.5A–6.5H)
  implementadas**:
  `EffectInstance` em tabela própria, lifecycle criar/encerrar (individual e
  por grupo), leitura por alvo/fonte, privacidade no servidor, vínculo explícito
  com Concentração, modificadores tipados que entram nos pipelines reais de
  ataque/salvaguarda/teste, CA e deslocamento, Conditions aplicadas pelo MESMO
  motor de Conditions (`sourceType = 'effect'`) e UM lifecycle de encerramento
  que desmonta modificadores e Conditions, inclusive na remoção estrutural de
  entidades.
- 6.6 Spell Execution Engine — **6.6A (contrato de conjuração), 6.6B (perfil de
  conjuração), 6.6C (espaços/recursos), 6.6D (casting time/economia), 6.6E
  (targeting/alcance assistido), 6.6F (conjuração do jogador/repertório) e 6.6F.1
  (wiring da UI de conjuração na ficha) implementadas**:
  `SpellCast` persistente (status `resolving`/`resolved`/`cancelled` + outcome
  `effect`/`no-effect`/`cancelled`), `SpellExecutionDefinition` por `spellId`
  (`immediate-effect` / `save-effect`) referenciando Effect Definitions, registry
  apenas com magias provadas, pipeline único validate → commit → resolve, commit
  encerrando a Concentração anterior e lock de UM cast `resolving` por caster no
  BANCO.
  **6.6B**: `SpellcastingSource` (`class`/`subclass`/`creature`) com atributo por
  FONTE (multiclasse Mago/Clérigo usa INT e SAB, com PB do nível TOTAL), Spell
  Save DC = 8 + PB + atributo e Spell Attack Bonus = PB + atributo derivados no
  SERVIDOR, statblock de criatura como autoridade (`saveDc`/`attackBonus`
  explícitos) e snapshot imutável no `SpellCast` (migration
  `20261102120000_add_spellcasting_profile`). Hold Person passou a usar a CD
  derivada — não existe mais CD manual de prova.
  **6.6C**: `CastingResource` (`spell-slot`/`pact-slot`) ORTOGONAL à fonte — o
  espaço gasto não decide a matemática, e a fonte não decide o espaço. Slots
  NORMAIS usam o pool multiclasse derivado (`spellSlotsForClasses`, meio/terço
  arredondados como no PHB) com uso persistido em `Character.spells`; Magia de
  Pacto é pool separado (Bruxo fora do nível combinado). Criatura/NPC declara o
  MÁXIMO no statblock (`Creature.spellcastingResources`) e o USO fica em quem
  conjura (template ou `Combatant.spellcastingUsed`) — cópias do mesmo template
  não compartilham gasto. O espaço é gasto no COMMIT, na MESMA transação do
  `SpellCast`, com guarda de versão: retry não gasta de novo, a corrida do
  último espaço tem um só vencedor e passar no save/cancelar/perder a
  Concentração NÃO devolve o espaço. `spellLevel` vem do catálogo e
  `castAtLevel` do espaço escolhido (snapshot no cast).
  **6.6D**: o casting time vem do catálogo/execution (`action`/`bonusAction`/
  `reaction`) e é traduzido para a MESMA Action Economy (`spendEconomy`);
  `1 minuto`/`1 hora` falham com `SPELL_CASTING_TIME_NOT_IMPLEMENTED` em vez de
  virarem uma Ação. O COMMIT consome Ação/Bônus (e o espaço) na mesma transação,
  com guarda de versão, revalidando turno e economia. `Combat.turnSequence` é a
  identidade MONOTÔNICA do turno (incrementada só na ativação real; reconnect
  não altera) e o `SpellCast` snapshota `castingTimeKind`/`combatId`/
  `turnSequence`/`combatantId`. A regra da Bonus Action (PHB 2014) é derivada do
  histórico de casts committed daquele turno: depois de uma spell de Ação Bônus
  só um cantrip de 1 Ação passa — NÃO existe "uma magia de nível por turno"
  (duas Action leveled com Action Surge são válidas). Reaction spell exige
  Reaction Opportunity server-authoritative, que ainda não existe, então é
  recusada (`SPELL_REACTION_NOT_AVAILABLE`).
  **6.6E**: `SpellTargetingDefinition` por magia (quantidade base + progressão por
  espaço, alcance em PÉS, visão, caminho livre, filtros e restrições de grupo),
  com `maximumTargets` derivado de `castAtLevel` — o cliente nunca envia máximo,
  alcance ou quantidade. Validação espacial TRI-STATE (`pass`/`fail`/`unknown`):
  o que o servidor não mede é confirmado pelo Mestre (`spatialConfirmation`,
  booleans por requisito, sem distância digitada), e um `fail` autoritativo
  (ex.: `canSee = false` por Invisible/Cego) NUNCA é sobrescrito. Canonicalização
  reaproveita o `loadEntity` (ficha e combatente do mesmo personagem = UM alvo).
  Hold Person multi-alvo continua UM `SpellCast`/UM espaço/UM slot, com N
  `PendingEffectSave` e RESOLUTION BARRIER transacional (`pg_advisory_xact_lock`):
  nenhum Effect nasce antes do último save; então UM grupo com uma instância por
  falha e UMA Concentração.
  **6.6F/6.6F.1**: conjuração pelo JOGADOR (ownership → repertório → fonte → perfil
  → recurso → componentes → casting time → economia → targeting) e o wiring da
  UI na ficha.
  **6.6G**: componentes V/S/M derivados do CATÁLOGO (nunca do texto), com
  fornecedor/foco por FONTE e mãos vindas do inventário.
  **6.6H**: duração ESTRUTURADA, relógio de ROUNDS em combate, triggers de fim
  de turno, salvaguarda repetida e expiração no lifecycle — ver a seção própria
  abaixo.
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
- **Invisible é uma RELAÇÃO de visão**, não um bônus solto (`shared/vision.ts`
  → `canSee(viewer, subject)`): o atacante Invisível só tem vantagem contra quem
  NÃO o enxerga, e atacar um alvo Invisível só tem desvantagem quando o ATACANTE
  não o enxerga. `MechanicalState.seesInvisible` é o único meio CONFIÁVEL de
  ver o invisível hoje; sem ele, vale a suposição assistida de visibilidade (o
  projeto não modela posição/linha de visão). A Esquiva usa a mesma relação.
  Nunca derivar vantagem/desvantagem só de "tem Invisible" fora de
  `conditionAttackMode`.
- **A Esquiva valida pelo deslocamento EFETIVO** —
  `effectiveSpeed(base, estado, speed-flat dos Efeitos)`, nunca a velocidade
  base: um `speed-flat` que leve a velocidade a 0 suspende os benefícios
  (ataque sem desvantagem e Destreza sem vantagem), e Condition que zera
  (Grappled etc.) vence por último mesmo com bônus de efeito. Movimento
  RESTANTE zero não invalida. Ataque (`conditionAttackMode`) e Teste de
  Destreza usam a MESMA derivação.
- Sem distância/posição/linha de visão confiáveis: Frightened fica assistido;
  modificadores contra Prone e críticos de proximidade ficam pendentes. Checks
  de visão/audição, sociais, doença, peso e envelhecimento expõem flags futuros.
- Exhaustion 6 sinaliza fatalidade, sem zerar PV, criar dead ou death saves.
  Magias, duração genérica e o motor de efeitos continuam futuros.
- Ferramenta do MESTRE em "Estado e ajustes" (combate): lista as condições do
  combatente selecionado com a ORIGEM, adiciona por seletor compacto com busca
  (as 14 do PHB; Exaustão tem controles próprios) e remove fonte por fonte.
  Aplicação manual grava `sourceType: 'manual'` — ou a criatura escolhida como
  fonte (`sourceEntity` + `sourceId`) — e `sourceLabel: 'Mestre'` quando não há
  fonte. Cada aplicação cria uma INSTÂNCIA nova; nunca sobrescreve as existentes.
- Condições DERIVADAS de 0 PV (Inconsciente `hp-zero` e a Queda que a acompanha)
  são protegidas: o DTO expõe `protectedInstanceIds`, a UI trava a remoção e o
  servidor responde 409 `CONDITION_DERIVED`. O caminho é resolver PV/estado de
  morte; remover a fonte manual nunca apaga a derivada.
- Na FICHA as condições não têm card, cabeçalho nem título próprios: viram uma
  FAIXA (`.conditions-strip`) no canto inferior direito de "Vida e Defesa",
  logo abaixo dos números que elas alteram, com a administração do Mestre
  recolhida. O HISTÓRICO não ocupa espaço fixo: clicar numa etiqueta abre
  `ConditionHistoryModal` com o `mechanicalState.log` inteiro (contexto = a
  condição clicada). O destaque de condição pertence ao COMBATE (etiquetas no
  card da iniciativa) — a ficha identifica o estado sem gastar uma seção para ele.
- Condições não têm visibility/private por INSTÂNCIA: são tão públicas quanto
  hoje (sem o que vazar), e log privado de condição ainda não é modelado
  (limitação conhecida, não silenciosa). A privacidade que existe no servidor é
  a do lifecycle de NPC/criatura a 0 PV (`hideCombatantPrivateState`: Inconsciente
  `hp-zero` + Queda derivada filtradas, efeitos recalculados) — não confiar em
  CSS/UI para esconder estado.
- Realtime reutiliza ficha/criatura/combate e acrescenta `mechanical:updated`
  tipado. Publicação só após commit. `smoke-conditions.ts` integra o smoke; a
  limpeza de combates do teste se limita aos IDs criados pela própria execução.

### Effects genéricos (6.5A)

- **Effect NÃO é Condition, NÃO é Concentração, NÃO é magia.** É o registro de
  que uma origem mecânica está produzindo consequências sobre UM alvo.
  `EffectInstance` vive em **tabela própria** (`effect_instances`), não no
  `mechanicalState`: as consultas são por alvo, por fonte e por grupo, e o
  volume cresce com spells/auras. `mechanicalState` continua dono de Conditions,
  Exaustão, Concentração e do log mecânico.
- Identidade em três eixos: `id` (a instância), `groupId` (a MESMA aplicação em
  vários alvos — Bless em três pessoas) e `definitionId` ("spell.bless"). O
  `label` é exibição e NUNCA decide regra. `endReason`/`endedAt` guardam o fim.
- Alvo/fonte usam a chave polimórfica `kind + id` (character | creature |
  combatant). **Combatente de personagem é canonicalizado para a FICHA**: a
  instância é uma só e o combatente apenas projeta (`GET /api/effects/combatant/:id`
  devolve a mesma linha do personagem). Criatura/NPC em combate usa o id da
  INSTÂNCIA — duas cópias do mesmo template não compartilham efeito e o template
  nunca é alterado.
- API: `/api/effects` (POST manual, só MASTER), `/api/effects/:id/end` (só
  MASTER, idempotente por estado — encerrar duas vezes mantém o primeiro
  `endedAt`), `GET /api/effects/:kind/:id` (MASTER vê tudo; PLAYER só o próprio
  personagem e só `public`). `endEffectGroup(groupId)` é helper de domínio para
  Concentração/dispel futuros.
- Privacidade: `visibility = public | private`, filtrada em `effectsVisibleTo`
  no SERVIDOR. O dono recebe só `public` em `effects:updated`; os Mestres
  recebem tudo. `metadata` fica fora do DTO nesta fase.
- Idempotência: `EffectOperation.operationId` único devolve o snapshot da mesma
  instância (payload diferente → 409 `IDEMPOTENCY_KEY_REUSED`). Encerramento não
  registra operação porque o estado final já é idempotente.
- Concentração → grupo: só quando a concentração declara `sourceType: 'effect'`
  e `sourceId = groupId`. Encerrar a concentração (voluntário, Incapacitado, 0 PV
  ou falha no save) encerra o grupo. Concentração manual legada continua sem
  consultar efeito nenhum. Efeito terminar NÃO encerra concentração.
- O log mínimo usa o Registro do combate (`economyLog`, ação `effect`) e entrada
  privada não chega ao PLAYER; fora de combate não há Registro persistente
  (limitação conhecida).
- `smoke-effects.ts` cobre criação/privacidade/permissão, alvo por alvo, grupo,
  idempotência, isolamento de template, projeção do combatente, log privado, o
  vínculo com Concentração e (6.5B) todos os modificadores.

### Effect → Condition (6.5C)

- **Effect NÃO tem motor próprio de Conditions.** A instância declara
  `conditions` (`effect_instances.conditions`, JSONB, migration aditiva) — a
  DEFINIÇÃO — e a criação materializa `ConditionInstance` NORMAIS em
  `mechanicalState.conditions[]` do alvo, com `sourceType: 'effect'` e
  `sourceId = EffectInstance.id`. Toda interpretação continua em
  `deriveConditionEffects` (Paralyzed ⇒ Incapacitated/speed 0/auto-fail,
  Invisible ⇒ visão, Charmed/Frightened ⇒ charmers/fearSources).
- Schema em `effect-modifiers.ts` reutiliza o `conditionSchema` real (máx. 20
  por instância). JSON inválido na leitura vira lista VAZIA.
- Identidade do cleanup é `sourceType + sourceId` — nunca `label`/`condition`.
  Duas fontes iguais coexistem; encerrar A preserva B, a Condition MANUAL e as
  protegidas (`hp-zero`). Remover a Condition na mão NÃO encerra o efeito e o
  refresh não a reaplica; `endEffect` depois disso continua funcionando.
- Atomicidade: Effect + Conditions são criados na MESMA transação e o
  encerramento (individual ou de grupo) remove as Conditions na mesma
  transação — nunca efeito sem Condition nem Condition órfã. Quando o alvo do
  cleanup é a MESMA entidade que o chamador está gravando (mutação mecânica,
  teste de Concentração), o helper recebe o estado em memória
  (`EffectConditionTarget`) e não relê/regrava a linha — sem conflito de versão.
- Privacidade: efeito `private` grava `sourceLabel: 'Efeito'` na instância, então
  o nome secreto não existe em DTO algum; a mecânica (Incapacitado, visão,
  CA/deslocamento) continua valendo. `sourceEntity` é preservado porque é
  relação mecânica (Charmed/Frightened), não segredo.
- Concentração: falha/Incapacitação/0 PV → `endEffectGroup` → Conditions do
  grupo removidas no mesmo instante. Effect que Incapacita o próprio
  concentrador encerra a concentração dele e o grupo — o fluxo termina sem
  recursão. Encerrar uma Condition NUNCA encerra concentração ou efeito.
- UI: `MasterEffectsPanel` permite marcar Conditions (multi-select compacto) na
  criação manual e mostra `Condições:` nas instâncias ativas; o PLAYER continua
  vendo Conditions somente na área de Conditions do motor atual.
- `smoke-effect-conditions.ts` cobre create/derive/end, múltiplas fontes, manual
  + efeito, grupo, Concentração (falha e auto-incapacitação), privacidade,
  combatente de personagem, isolamento de NPC, 0 PV protegido, remoção manual,
  retry, encerramento concorrente, Charmed/Frightened/Invisible e a interação
  com modificadores/Esquiva.

### Lifecycle de encerramento (6.5D)

- **Um Effect ENCERRADO não produz consequência nenhuma.** `endEffect` e
  `endEffectGroup` compartilham o MESMO pipeline (`effect-lifecycle.ts` →
  `endEffectInstances`): transição `active → ended` guardada por status, depois
  remoção das Conditions. Não há segunda implementação de limpeza no grupo nem
  no fluxo de Concentração.
- MODIFICADORES não são apagados nem zerados: o resolver só lê
  `status = 'active'`, então o efeito deixa de participar da derivação no mesmo
  instante. Nada é escrito na CA/velocidade base da ficha.
- Identidade do cleanup continua `sourceType + sourceId`; fonte manual, outro
  Effect e as derivadas protegidas (`hp-zero`) permanecem. `endReason` é
  histórico/auditoria e NUNCA ramifica a limpeza.
- Retry/concorrência: a guarda `status = 'active'` preserva o primeiro
  `endedAt`/`endReason`, remove as Conditions uma vez e só registra log quando
  houve transição real.
- `endReason` ganhou `source-removed`/`target-removed` (remoção ESTRUTURAL de
  entidade, não morte). `group`/`source-ended`/`target-invalid` continuam
  aceitos para o histórico já gravado.
- Remoção estrutural: `deleteCreature` e `deleteCharacter` encerram, na MESMA
  transação do delete, os efeitos que tinham a entidade como ALVO
  (`target-removed`) e como ORIGEM (`source-removed`) — inclusive os das
  instâncias de combate da criatura. Sair da iniciativa ou chegar a 0 PV NÃO
  encerra efeito persistente; combate termina e a ficha segue com ele.
- Diagnóstico `findEndedEffectsWithLiveConditions` é READ-ONLY e verifica o
  invariante "efeito ended sem Condition viva da própria fonte"; o smoke da
  6.5D usa e espera zero. Nenhum GET repara/muta o banco.
- `smoke-effect-lifecycle.ts` cobre cleanup combinado (CA/speed/Condition),
  idempotência de retry, concorrência, fontes múltiplas, grupo multi-alvo com
  isolamento, privacidade, 0 PV protegido, fonte a 0 PV, saída do combate e
  remoção estrutural de criatura.

### Bless — primeiro efeito real (6.5G)

- Definição em `src/modules/effects/definitions/bless.ts`: `definitionId`
  `spell.bless` (mesmo id do catálogo de magias, sem duplicar nome/nível/range),
  até 3 alvos, **+1d4 OPCIONAL** em Attack Rolls e Saving Throws e exigência de
  Concentração. Nenhum resolver de ataque/save/concentração conhece "Bless":
  eles leem apenas modificadores tipados.
- `optional: true` (default `false`) é genérico: o modificador é OFERECIDO pelo
  servidor e só entra se o ator escolher na rolagem. `stackingKey` é genérica:
  duas aplicações de Bless no mesmo alvo persistem como instâncias, mas a
  derivação mantém UMA contribuição (a fonte mais antiga); quando ela termina, a
  outra assume automaticamente. Bless NÃO cria Condition "Blessed", não grava
  flag na ficha/combatente e não altera bônus base.
- Identidade do modificador: `key` declarada pela definição (fallback: índice),
  resolvida como `effectId:key`. O cliente devolve apenas esses IDs em
  `selectedEffectModifiers`; o servidor revalida no momento da rolagem
  (`INVALID_EFFECT_MODIFIER`), rola o d4 e nunca aceita valor/estrutura do
  cliente. Falha automática (Paralyzed em FOR/DES etc.) não é contornada.
- Aplicação `POST /api/effects/bless` é **MASTER-only** e é ferramenta de prova:
  não consome Ação/slot, não valida alcance/componentes/preparação e não tem
  duração automática (Duration Engine futura). Cria UM grupo + uma instância por
  alvo (1–3, sem repetição), liga a Concentração do caster ao grupo pelo motor
  existente (substituindo a anterior na mesma transação) e é idempotente por
  `operationId`.
- UI: `MasterEffectsPanel` ganhou o bloco temporário "Bless — prova da engine"
  (caster = entidade do painel, até 3 alvos). A bandeja de dados e o painel de
  ataque exibem os modificadores opcionais oferecidos, desmarcados por padrão;
  o teste de Concentração usa a MESMA bandeja e aceita o d4 quando elegível.
- `smoke-bless-effect.ts` cobre definição/limites, ataque e save com e sem o d4,
  teste de habilidade sem opção, IDs inválidos, dois Bless sem acumular (e o
  fallback quando o primeiro termina), Concentração (self-bless, falha,
  substituição e encerramento), alvo isolado, idempotência e invariante.

### Imobilizar Pessoa — segundo efeito real (6.5H)

- Definição em `src/modules/effects/definitions/hold-person.ts`: `definitionId`
  `spell.hold-person` (mesmo id do catálogo), UM alvo humanoide, salvaguarda de
  **Sabedoria** e `conditions: ['paralyzed']`. Paralyzed é do motor de
  Conditions (Incapacitado, deslocamento 0, etc. vêm de `deriveConditionEffects`);
  não existe Condition "Held"/"Held Person" e nenhum resolver genérico conhece
  a magia.
- `PendingEffectSave` (`pending_effect_saves`) representa o intervalo entre
  "efeito direcionado" e "save rolado": persistente (sobrevive a refresh,
  reconnect e restart), com `status` (`pending`/`resolved`/`cancelled`),
  `operationId` único e `fingerprint`. Nenhum Effect/Condition/Concentração
  existe antes do resultado; a transição é guardada por status, então retry e
  concorrência nunca criam dois grupos.
- Aplicação `POST /api/effects/hold-person` é **MASTER-only** e ferramenta de
  prova: valida caster/alvo no servidor, canonicaliza combatente→ficha, exige
  humanoide (`Creature.type`; personagens do PHB são humanoides) antes de pedir
  save e usa **CD manual de prova (1..30)** — `dcSource: 'manual'`, a Spell
  Execution Engine futura derivará `8 + proficiência + atributo`. Não gasta
  Ação/slot, não valida alcance/componentes/preparação e não tem upcasting.
- A salvaguarda é resolvida pelo MESMO endpoint de dados (`POST /api/dice/roll`
  com `pendingEffectSaveId`): o servidor fixa o atributo e a CD da pendência,
  rola o d20, calcula o bônus com `savingThrowBonus` (mesma conta da ficha +
  Esquiva/fontes de Condições + modificadores de Effect) e aceita os
  modificadores OPCIONAIS server-derived (ex.: Bless +1d4). O cliente não envia
  atributo, bônus, CD, dados nem resultado.
- Falha → UM grupo + UMA instância (`conditions: ['paralyzed']`) + Concentração
  do caster (`sourceType: 'effect'`, `sourceId = groupId`) na MESMA transação;
  sucesso → nada é criado (nem Effect, nem Condition, nem Concentração).
  **Desde a 6.6A a concentração anterior NÃO é preservada** no caminho de
  conjuração: o COMMIT (antes do save) já a encerrou — ver "Fundação de
  conjuração". A 6.5H preservava a anterior no sucesso por simplificação da
  prova, semântica agora corrigida.
- Self-target falha → Paralyzed deixa o caster Incapacitado → Concentração
  termina → lifecycle encerra o grupo → Paralyzed sai; o fluxo estabiliza sem
  recursão. Encerrar apenas a instância de um alvo não encerra a Concentração
  do caster (relação é Concentração → Grupo, nunca o inverso).
- Duas aplicações de Hold Person coexistem como ConditionInstances distintas
  (multi-source do motor): encerrar uma mantém a outra. Remoção ESTRUTURAL de
  caster/alvo cancela pendências e encerra efeitos (`source-removed`/
  `target-removed`); morrer ou sair da iniciativa NÃO encerra nada.
- UI: bloco temporário "Imobilizar Pessoa — prova da engine (6.5H)" no
  `MasterEffectsPanel` (alvo + CD manual) e painel de **salvaguarda pendente**
  no estado mecânico do alvo (jogador rola; Mestre escolhe público/privado e
  pode cancelar). `effects:pending` publica a solicitação (filtro no servidor).
- `smoke-hold-person-effect.ts` cobre definição, permissão, humanoide, sucesso,
  falha, derivação de Paralyzed, multi-source, composição com Bless,
  self-target, isolamento de NPC, cancelamento, remoção estrutural,
  idempotência e canonicalização para a ficha.
- **Continua pendente (intencional):** duração de 1 minuto, save repetido no fim
  do turno, upcasting, múltiplos alvos, alcance/linha de visão, componentes,
  Ação/slot e conjuração por PLAYER — tudo da Spell Execution/Duration Engine.

### Fundação de conjuração — Spell Execution Engine (6.6A)

- `SpellCast` (`spell_casts`) é o EVENTO de conjuração: identidade de domínio
  para auditoria/idempotência/origem e, no futuro, para custos (Ação/slot).
  `operationId` (único) continua sendo idempotência do request; `SpellCast.id`
  é a identidade permanente. Mesmo id + mesmo payload → replay do MESMO cast;
  id + payload diferente → `409 IDEMPOTENCY_KEY_REUSED`.
- Status mínimo (`resolving` → `resolved`/`cancelled`) e outcome separado
  (`effect`/`no-effect`/`cancelled`). **Histórico, não estado ativo:**
  `EffectInstance` segue sendo a fonte de verdade; um Effect encerrado depois
  NÃO reescreve o cast. `effectGroupId` liga o cast ao grupo, mas não decide se
  o efeito vale.
- `SpellExecutionDefinition` (`src/modules/spells/execution/`) diz COMO a magia
  resolve — `immediate-effect` (Bless) ou `save-effect` (Hold Person) — e
  referencia a Effect Definition por id, sem duplicar modificadores/Conditions.
  `requiresConcentration`, `castingTime?`, `targeting` (6.6E) e `validateTargets`
  rodam na fase de VALIDAÇÃO, que é read-only. O `targeting` declara quantidade
  base + progressão por espaço, alcance em PÉS, visão/caminho livre, filtros
  (`creature-type: humanoid`) e restrições de grupo (`mutual-distance`); o
  máximo de alvos é DERIVADO do espaço escolhido. O registry só contém magias
  PROVADAS; catálogo sem execução → `409 SPELL_EXECUTION_NOT_IMPLEMENTED`.
- Pipeline ÚNICO (`castProofSpell`): VALIDATE → COMMIT → RESOLVE → PRODUCE
  EFFECTS/RESULT → COMPLETE, na mesma transação. O núcleo não tem `if` por nome
  de magia; as rotas `/api/effects/bless` e `/api/effects/hold-person` viraram
  wrappers finos e existe `POST /api/spells/cast-proof` (MASTER-only). PLAYER
  continua sem conjurar por nenhuma rota.
- **Semântica de Concentração corrigida:** o COMMIT de uma magia concentrada
  encerra a Concentração ANTERIOR imediatamente (group anterior desmontado pelo
  lifecycle), ANTES da resolução. A nova Concentração só nasce se a resolução
  produzir Effect durável e o caster ainda puder concentrar. Passar no save,
  cancelar a pendência ou ter o alvo removido NÃO restaura a anterior.
- Lock: **um cast `resolving` por caster**, garantido por índice único parcial
  no Postgres (`spell_casts_one_resolving_per_caster`), nunca por Map do
  processo. Retry do mesmo `operationId` é respondido antes do lock; outro
  caster não é afetado. `409 SPELL_CAST_IN_PROGRESS` no conflito.
- `PendingEffectSave.spellCastId` (nullable) liga a pendência à conjuração;
  resolve success → cast `resolved`/`no-effect` sem Effect; failure →
  Effect+Condition+Concentração+cast na mesma transação. Caster Incapacitado
  durante a pendência: a falha resolve, mas `enforceCasterConcentration`
  encerra o grupo (nenhum Effect concentrado permanece).
- `smoke-spell-casting-foundation.ts` cobre commit boundary, idempotência,
  reused key, magia não executável, validação antes do commit, Hold Person
  success/failure, cancelamento, remoção estrutural, self-target, caster
  incapacitado, permissões, histórico, lock e concorrência real.
- `smoke-spell-slots.ts` cobre tabelas (completo/meio/pacto/multiclasse),
  seleção por `kind`+nível, gasto no commit, retry sem segundo gasto, corrida do
  último espaço, espaço inválido/vazio, isolamento do NPC e histórico imutável
  depois do descanso.
- `smoke-spell-action-economy.ts` cobre casting time, matriz pura da Bonus
  Action (bidirecional + Action Surge), Reaction recusada, Ação gasta no
  COMMIT, fora de turno, Ação extra, corrida pela única Ação, retry sem segundo
  gasto, snapshot de turno e cast fora de combate.
- **Continua pendente (intencional):** duração/save repetido (Duration Engine),
  componentes V/S/M (6.6G), Counterspell, Reaction windows, área/cone/linha e
  upcast de dano/duração. Spell Save DC (6.6B), slots (6.6C), casting time/Action
  Economy (6.6D), targeting/alcance assistido (6.6E) e conjuração do jogador
  (6.6F + 6.6F.1) estão implementados.

### Conjuração do jogador e da ficha (6.6F / 6.6F.1)

- **Repertório é POR FONTE** (`shared/spells/repertoire.ts`): `known`,
  `prepared-list`, `spellbook-prepared` (Mago exige grimório + preparação ACTIVE),
  `explicit` (statblock de criatura) e `alwaysPrepared`. ACTIVE × PLANEJADO é
  separado: salvar o plano (`PUT /api/spells/preparation-plan/...`) NÃO conjura
  nem ativa nada — a preparação só muda no Descanso Longo válido
  (`activatePreparationPlans`). Ter a magia registrada no grimório não a torna
  conjurável.
- `evaluateSpellAvailability(caster, spellId, db)` é a **única** conta de
  elegibilidade: devolve uma entrada por fonte (`view` + `result`).
  `resolveSpellAuthorization` só ESCOLHE entre as autorizadas (0 → erro com o
  motivo mais útil; 1 → automático; >1 → `SPELLCASTING_SOURCE_REQUIRED`), e o
  read-model da ficha consome a mesma função — nunca há segunda implementação.
- `POST /api/spells/cast` é a rota do jogador: caster do próprio personagem
  (ou Mestre), fonte quando ambígua, espaço quando a magia é de nível 1+,
  `operationId`. Sem geometria confiável o resultado é **202 com
  `SpellCastIntent`** (`status: 'pending'`) e **zero custo**: nenhum espaço,
  Ação, Concentração ou Effect antes da aprovação do Mestre, que revalida tudo
  no commit. `approve/deny/cancel` e a fila ficam em `/api/spells/intents*`.
- `GET /api/spells/cast-options/:characterId/:spellId` (6.6F.1) é o read-model
  da UI, **read-only e ownership-guarded** (dono ou Mestre; `403
  SPELL_CASTER_FORBIDDEN`): fontes que AUTORIZAM agora, espaços com
  `remaining > 0`, `targeting` resumido **por nível de espaço** (`maxTargets`
  derivado por `targetingSummary`) e o roster canônico de alvos (combatentes em
  combate, fichas + bestiário fora; combatente de personagem → ficha, sem
  duplicar entidade). Não cria Intent/cast e não gasta nada — o POST revalida.
- `SpellRepertoirePanel` (ficha) conduz o fluxo estado explícito (`idle` →
  `configuring` → `submitting` → `awaiting-master`): source selector só com
  ambiguidade (nunca auto-escolhe a primeira), resource selector nunca
  auto-escolhe "o mais barato", `castAtLevel` é apenas EXIBIÇÃO do nível do
  espaço escolhido, o máximo de alvos acompanha o espaço (Bless 1º→3 / 2º→4) e
  alvos em excesso bloqueiam o submit em vez de sumirem sozinhos. O cliente não
  envia `castAtLevel`, `maxTargets` nem confirmação espacial.
- `operationId` é gerado UMA vez por tentativa e reusado no retry; intenção
  pendente é restaurada por `listIntents()` ao abrir/recarregar a ficha e
  atualizada pelo evento `spells:intent-updated` (filtrado por papel no
  servidor), consumido por um barramento de módulo (`subscribeSpellIntents`) —
  aprovar/negar no painel do Mestre reflete na ficha sem depender de estado
  local. Gasto otimista não existe: slots/Ação/Concentração só mudam pelo estado
  autoritativo (`sheet:updated`, `combat:updated`, `effects:updated`).

### Componentes V/S/M da conjuração (6.6G)

- **Componente é metadado do CATÁLOGO, nunca texto interpretado.** O catálogo já
  declara `components { verbal, somatic, material }` e, quando há material,
  `material { text, costGp?, consumed?, componentKey? }`. `shared/spells/components.ts`
  traduz isso para o formato mecânico (`spellComponentRequirement`); nenhum
  `split(",")`/regex sobre `componentsText` participa de regra.
- **Custo e consumo são os da MAGIA.** Preço de mercado do item do inventário
  NUNCA decide substituição de foco/bolsa. Material comum (sem custo, sem
  consumo) aceita bolsa de componentes ou foco compatível; material com custo ou
  consumido exige o item específico, identificado por `details.spellComponentKeys`
  (chave estável) e, quando houver valor, por `details.componentValueGp`.
- **Foco é da FONTE, não da lista de magias.** `shared/spells/casting-focus.ts`
  lê `spellcasting.focusKinds` do metadado da classe/subclasse
  (`wizard/sorcerer/warlock → arcane`, `cleric/paladin → holy-symbol`,
  `druid → druidic`, `bard → musical-instrument`, `ranger → []`). Cavaleiro
  Arcano e Trapaceiro Arcano do PHB 2014 declaram `[]` de propósito: usar a lista
  do Mago não concede foco. Criatura declara `spellcastingProfile.focusKinds` no
  statblock. Bolsa de componentes é universal.
- **Tags mecânicas do item** (JSONB `details`, mantidas em QUALQUER categoria):
  `spellFocusKinds`, `componentPouch`, `spellComponentKeys`, `componentValueGp`,
  `wornVisible`. `spellcastingFocus` (campo antigo do Cajado) continua valendo
  como foco arcano.
- **Mãos vêm do inventário existente** (`hand1`/`hand2`) — não há segundo sistema
  de equipamento nem checkboxes de "confirmo que tenho uma mão livre". Arma
  `two-handed` empunhada sozinha deixa uma mão momentaneamente livre; duas armas
  (ou arma+escudo) não deixam. **S + M usa a MESMA mão do foco/material; S sem M
  não ganha essa mão.** Símbolo sagrado apenas `wornVisible` satisfaz M e não cria
  mão. Escudo marcado com `spellFocusKinds: ['holy-symbol']` funciona como foco
  segurado. Nada é largado/guardado automaticamente.

### Duração, expiração e lifecycle por turno (6.6H)

- **Duração é DADO do catálogo/execução** (`SpellDurationDefinition =
  { kind: 'timed', amount, unit: 'round' | 'minute' | 'hour' }`), nunca parser de
  `"Concentration, up to 1 minute"`. Concentração e duração são conceitos
  separados: a duração máxima vale mesmo que a Concentração acabe antes.
- **Relógio de combate = `Combat.round`** (já existia; reutilizado) + a ATIVAÇÃO
  corrente (`turnSequence` segue sendo a identidade do turno). Nada de
  `setTimeout`/`setInterval`/wall clock: pause, lag, refresh e restart não mudam
  a contagem, e fora de combate **não existe** countdown (o projeto ainda não
  tem world-time engine).
- **Conversão**: `durationToCombatRounds` — 1 round = 1, 1 minuto = 10 rounds,
  1 hora = 600. Nunca milissegundos.
- **A duração começa no COMMIT.** O `SpellCast` grava `durationSnapshot`
  (definição, `tracking`, e em combate `combatId`/`anchorCombatantId`/
  `startedRoundNumber`/`startedTurnSequence`/`rounds`/`dueRoundNumber`) e cada
  `EffectInstance` COPIA o snapshot — um Hold Person que nasce depois da
  resolution barrier NÃO ganha 1 minuto novo. Cast antigo nunca é recalculado a
  partir do catálogo atual.
- **Fronteira determinística**: a magia expira ao INÍCIO da ativação do
  `anchorCombatantId` em `dueRoundNumber = startedRoundNumber + rounds`. Se o
  anchor não puder mais receber turno (morto/removido/inelegível), expira na
  primeira ativação real daquele round, para a duração não ficar eterna.
- **Processador central** (`effect-duration.service.ts`) roda no `nextTurn`
  DEPOIS de avançar e ANTES de publicar o novo turno: encerra o GRUPO inteiro
  com `duration-expired` (Effects + Conditions + modifiers pelo lifecycle
  existente), cancela pendências contínuas e, se o grupo ficou vazio, encerra a
  Concentração. É idempotente (guarda `status = 'active'`) e não reescreve o
  histórico: um cast que resolveu `effect` continua `resolved/effect`.
  Exceção: cast ainda `resolving` (barreira inicial) vencido vira
  `resolved`/`no-effect` + `resolutionReason = 'duration-expired'`, com as
  pendências iniciais canceladas — nunca fica `resolving` para sempre.
- **Fora de combate** o snapshot é `tracking: 'manual'` (UI: "1 minuto —
  acompanhamento manual"). O Mestre expira pelo MESMO lifecycle
  (`POST /api/effects/:id/expire`) e dispara o gatilho manual
  (`POST /api/effects/:id/triggers/:triggerKey/fire`, `operationId` = identidade
  da ocorrência, retry devolve a mesma pendência). Fim de combate não encerra a
  magia; o tempo restante passa a ser assistido.
- **Turn triggers são da DEFINIÇÃO do EFEITO**
  (`EffectTurnTriggerDefinition`: `key`, `timing: 'end-of-target-turn'`,
  `kind: 'saving-throw'`, `ability`, `dc: { kind: 'origin-spell-cast' }`,
  `optional`, `repeat`, `onSuccess: 'end-effect'`), snapshotados na instância.
  Bless declara `[]`; Hold Person declara `repeat-save` (Sabedoria, opcional).
  Nenhum `if spellId === ...` no motor.
- **`PendingEffectSave.phase`** distingue `initial` (resolução do cast,
  obrigatória) de `ongoing` (fim de turno de um Effect, pode ser opcional). A
  contínua tem `effectInstanceId`, `triggerKey`, `triggerOccurrenceId`
  determinístico (`combat:<id>:turn:<seq>:effect:<id>:trigger:<key>`),
  `optional` e `declinedAt`, com índice ÚNICO parcial no Postgres. Ela NUNCA
  reabre o `SpellCast` e não cria cast/espaço/Ação.
- **`nextTurn` bloqueia** com 409 `TURN_END_TRIGGER_PENDING` enquanto houver
  pendência contínua `pending` do ator que está saindo; `turnSequence` e
  `round` não avançam e o retry não duplica pendências. Basta o alvo ROLAR ou
  RECUSAR (`decline`, só `ongoing` + `optional`): recusar é `declined`, não é
  falha, e mantém o efeito ativo.
- **Sucesso** encerra SOMENTE aquela instância (`repeat-save-success`) pelo
  lifecycle central — o Paralyzed sai junto, outras fontes permanecem — e o
  grupo vazio encerra a Concentração (idempotente, sem recursão). **Falha**
  mantém o efeito. A CD vem do snapshot do cast de origem; bônus/modificadores
  (inclusive Bless `+1d4` opcional) vêm do estado ATUAL do alvo, sem revalidar
  alcance/visão/tipo e sem auto-fail de Sabedoria por Paralyzed.
- `smoke-spell-duration.ts` cobre regras puras, snapshot no COMMIT, tracking
  manual, bloqueio/recusa/sucesso do fim de turno, grupo vazio, expiração por
  duração e cast `resolving` vencido, além de fim de combate preservando o
  efeito.
- **Hook genérico de bloqueio:** modificador de Effect `spell-component-block`
  com `components: ('verbal'|'somatic'|'material')[]`. A mecânica bloqueia e a
  resposta é SANITIZADA (`SPELL_VERBAL_COMPONENT_UNAVAILABLE`…): o rótulo de um
  efeito privado nunca vaza. Silêncio e War Caster continuam fora desta fase.
- **Pipeline:** VALIDATE resolve o plano (`resolveSpellComponents`) e falha ANTES
  de qualquer custo; o COMMIT REVALIDA e consome o material na MESMA transação,
  com guarda de `version` da ficha (retry não consome de novo, última unidade tem
  um só vencedor, quantidade nunca fica negativa). Consumo é por CONJURAÇÃO, não
  por alvo, e não é devolvido por save bem-sucedido/cancelamento.
- **Snapshot:** `SpellCast.componentsSnapshot` (JSONB nullable, migration
  `20261104120000_add_spell_cast_components`) registra V/S/M, mão usada,
  fornecedor do material e o que foi consumido — sem id interno de item. Casts
  antigos ficam `null`; nada é inventado retroativamente.
- **cast-options** passou a devolver `components` (resumo sanitizado + `castableNow`)
  para a ficha mostrar `V ✓ S ✓ M ✓ — Símbolo Sagrado` e bloquear o envio; o
  `POST /api/spells/cast` continua sendo a autoridade.
- **Limitações declaradas:** inventário de NPC não é modelado por instância (não
  há consumo de material por NPC); duração/save repetido, componentes V/S/M
  “especiais” de magias específicas, itens mágicos que concedem foco e rituais
  seguem para fases próprias.
- `smoke-spell-components.ts` cobre catálogo, bolsa/foco/foco errado, escudo-símbolo,
  símbolo vestido, arma de duas mãos, duas armas, S+M vs S-only, material com custo
  e consumido (definições SINTÉTICAS), consumo com guarda de versão, bloqueio
  privado e a recusa de campos de componente vindos do cliente.

### Modificadores de Effect (6.5B)

- **O pipeline nunca conhece nome de magia/feature.** Ele lê só modificadores
  tipados (`src/modules/effects/effect-modifiers.ts`): união discriminada
  `roll-flat | roll-dice | roll-advantage | roll-disadvantage | ac-flat |
  speed-flat`, com `roll: attack | save | check` e filtro opcional de `ability`.
  Validação Zod com limites (valor −100..100, CA −100..100, speed −1000..1000,
  `count` 1..20, dados 4/6/8/10/12/20/100, máx. 12 por instância). JSON inválido
  na leitura vira lista VAZIA (nunca "ganha" regra por dado corrompido).
- Persistência: coluna `effect_instances.modifiers` (JSONB, default `[]`).
  Migration aditiva — efeitos antigos ficam sem modificador (comportamento
  anterior preservado).
- **Resolvedor central:** `effectModifierSetsFor(entities)` faz UMA consulta em
  lote (sem N+1 na iniciativa/ataque), canonicaliza combatente→FICHA e devolve
  um resumo por entidade. `effectModifierSetFor(entity)` é o atalho de alvo único.
  Só `status = 'active'` conta: efeito encerrado (ou grupo encerrado pela
  Concentração) deixa de valer imediatamente, sem cache.
- **Stacking:** numéricos SOMAM; dados formam pool independente (rolados no
  servidor, com sinal); vantagem/desvantagem são CONJUNTOS de fontes — qualquer
  quantidade vira uma fonte e os dois lados se cancelam (`resolveRollMode`),
  nunca "dupla vantagem". Nada depende da ordem das linhas no banco.
- **Pipelines:** `dice.service` (save/check: bônus fixo + dados + modo, com
  `effectModifiers` no DTO para o breakdown), Concentration Save (Saving Throw
  de Constituição — fontes server-side; `advantage`/`disadvantage` do cliente
  continuam ignorados), `combat.service` (ataque: bônus/dados/modo do atacante;
  CA do alvo) e `effectiveSpeed` (ordem: `(base + efeitos) × multiplicadores →
  zero override`, então Grappled/Exaustão 5 continuam zerando).
- **CA/deslocamento são DERIVADOS:** `computeArmorClass` recebe
  `effectBonuses` e `effectiveSpeed` recebe o bônus de efeito. A ficha e as
  criaturas nunca gravam o valor: encerrar o efeito devolve o anterior. O
  tabuleiro usa o MESMO resumo do combatente (sem segunda conta).
- **Privacidade não é inatividade:** efeito `private` continua modificando o
  alvo; o rótulo é sanitizado (`publicEffectLabel` → `null`) no breakdown e no
  DTO. Modificador só pode ser criado pelo MASTER (payload validado no servidor).
- `publishEffects` também republica as visões derivadas: ficha do dono
  (`sheet:updated`), criatura para os Mestres e `combat:updated`, porque efeito
  não incrementa a versão da ficha/combate.
- **Não implementado aqui:** resistência/imunidade/vulnerabilidade, dano extra,
  PV temporário, rerolls, faixa de crítico, modificador de CD, proficiência por
  efeito, Condition automática, duração, Bless/Hold Person e Spell Engine.

### Concentração (6.4)

- Concentração NÃO é Condition: `mechanicalState.concentration` guarda
  `{ id, label, sourceType, sourceId?, visibility, startedAt, startedBy }`,
  e `pendingConcentrationSaves[]` guarda os testes derivados de dano. Vale
  dentro e fora de combate (personagem lê a ficha; criatura/NPC lê a instância).
- UMA por criatura: `action: 'concentrate'` encerra a anterior (log), zera as
  pendências antigas e cria um `id` novo. `concentrate-end` é do DONO (jogador)
  ou do Mestre, não gasta Ação/Bônus/Reação e pode citar `concentrationId` para
  um pedido antigo nunca encerrar a concentração nova.
- Iniciar manualmente (`label` + `visibility`) só cria o estado: não aplica
  bônus, Conditions, dano, save nem duração. Efeito privado do Mestre não vai
  para o DTO do jogador (o servidor filtra, não o CSS).
- Dano FINAL > 0 gera UM teste por EVENTO, com `dc = max(10, floor(dano / 2))`;
  vários componentes num mesmo ataque viram um único teste (dano total) e hits
  separados viram pendências separadas (a lista nunca é sobrescrita). Dano 0
  (imunidade/resistência total) não pede teste.
- Incapacitado (Inconsciente/Paralisado/Atordoado/Petrificado), 0 PV e morte
  encerram a concentração NA HORA, sem teste; remover a condição não reativa.
  A checagem roda na MESMA transação do dano (ataque e ajuste manual do Mestre).
- O teste é Saving Throw de CONSTITUIÇÃO de verdade: `POST /api/dice/roll` com
  `kind: 'concentration'` + `pendingConcentrationSaveId`. O servidor calcula
  bônus (modificador + proficiência + bônus de save), aplica as regras de
  vantagem/desvantagem existentes e ignora bônus/CD do cliente. Natural 1/20 não
  é auto-falha/sucesso.
- Sucesso mantém a concentração e limpa só a pendência resolvida; falha encerra
  e descarta as pendências restantes da MESMA concentração. Pendência de uma
  concentração substituída responde 409 e não toca na nova.
- Jogador: a bandeja existente mostra “Concentração (Constituição) — CD X”.
  Criatura/NPC: o Mestre escolhe PÚBLICO ou PRIVADO em cada teste; privado é
  `audience: 'masters'` (não chega a jogador) e o registro do combate é privado.
- A etiqueta CONCENTRANDO (`CombatStateId: 'concentrating'`, tooltip com o nome)
  deriva do estado real; o controle de iniciar/encerrar vive em “Estado e
  ajustes” (mesma API `/api/mechanical`), sem segunda bandeja.
- `smoke-concentration.ts` cobre CD, fila, substituição, Incapacitado/0 PV,
  multi-componente, hits separados, proficiência, vantagem/desvantagem e
  público/privado de NPC.

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

> Migrations: **60** (são 60 diretórios em `prisma/migrations`; a 6.6H criou
> `20261104170000_add_spell_duration_lifecycle` com `durationSnapshot`/
> `resolutionReason` no `SpellCast`, `durationSnapshot`/`turnTriggers` no
> `EffectInstance` e `phase`/`effectInstanceId`/`triggerKey`/
> `triggerOccurrenceId`/`optional`/`declinedAt` no `PendingEffectSave`, além do
> único parcial da ocorrência contínua; a 6.6G acrescentou
> `componentsSnapshot` ao `SpellCast`; a 6.5A criou
> `effect_instances` + `effect_operations`, a 6.5B acrescentou `modifiers` e a
> 6.5C, `conditions`).
> Os hashes acima são o estado no momento em que este arquivo
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
