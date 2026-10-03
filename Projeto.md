# Projeto.md — Codex do Aventureiro (Grimório Digital)

Documento de referência **completo** do sistema: o que ele faz e **como** faz.
Descreve o produto como ele **é no código**, não como deveria ser. Onde há
lacuna conhecida, ela está marcada como **LACUNA**.

- Repositório: `github.com:delanora/rpg.git` — branch `main`
- Diretório de produção: `/var/www/rpg`
- Idioma do produto e do código: **português (pt-BR)**. Identificadores de
  código em inglês; interface, comentários e mensagens de erro em português.
- Documentos irmãos: `README.md` (visão funcional/operacional),
  `ARQUITETURA-DO-SISTEMA.txt` (documento técnico detalhado) e
  `REVISAO-CODIGO.md`.

---

## Sumário

1. [O que é o sistema](#1-o-que-é-o-sistema)
2. [Papéis de usuário](#2-papéis-de-usuário)
3. [Stack, versões e tipagem](#3-stack-versões-e-tipagem)
4. [Como rodar e operar](#4-como-rodar-e-operar)
5. [Arquitetura geral](#5-arquitetura-geral)
6. [Estrutura de diretórios](#6-estrutura-de-diretórios)
7. [Variáveis de ambiente](#7-variáveis-de-ambiente)
8. [Modelo de dados (PostgreSQL / Prisma)](#8-modelo-de-dados-postgresql--prisma)
9. [Camada HTTP](#9-camada-http)
10. [Autenticação, autorização e identidade do ator](#10-autenticação-autorização-e-identidade-do-ator)
11. [Contrato HTTP completo](#11-contrato-http-completo)
12. [Camada de tempo real (Socket.io)](#12-camada-de-tempo-real-socketio)
13. [Motor de regras D&D 5e](#13-motor-de-regras-dd-5e)
14. [Semântica da ficha](#14-semântica-da-ficha)
15. [Level Up e downgrade de nível](#15-level-up-e-downgrade-de-nível)
16. [Assistente de criação (9 passos)](#16-assistente-de-criação-9-passos)
17. [Combate](#17-combate)
18. [Janela de dados e apresentação de imagens](#18-janela-de-dados-e-apresentação-de-imagens)
19. [Armazém de conteúdo do mestre](#19-armazém-de-conteúdo-do-mestre)
20. [Cliente React](#20-cliente-react)
21. [Testes e verificação](#21-testes-e-verificação)
22. [Invariantes que não podem ser quebradas](#22-invariantes-que-não-podem-ser-quebradas)
23. [Lacunas conhecidas e pontos de extensão](#23-lacunas-conhecidas-e-pontos-de-extensão)

---

## 1. O que é o sistema

O **Codex do Aventureiro** é uma aplicação web **multiusuário de mesa única**
para **D&D 5ª Edição (PHB 2014)**. Um único processo Node.js serve, **na mesma
porta**:

- a **API REST** em `/api/*`;
- o **canal WebSocket** (Socket.io) em `/socket.io`;
- o **build estático do frontend React** (`client/dist`) na raiz `/`, com
  fallback SPA;
- os **arquivos enviados** em `/uploads/*`;
- o **health check** em `/api/health`.

O objetivo declarado é parecer um **grimório físico**, não um formulário: tema
pergaminho (claro) e "grimório amaldiçoado" (escuro), fontes serifadas
medievais e ícones desenhados à mão.

**Persistência:** PostgreSQL via Prisma, com modelagem **híbrida** — colunas
para campos escalares muito consultados e **JSONB** para coleções grandes,
validadas por Zod na aplicação.

**Regra arquitetural central:** **toda escrita de domínio acontece por HTTP**.
O WebSocket é canal **exclusivo de notificação** (servidor → cliente); os
handlers cliente→servidor existem apenas para entrar/sair de salas. Isso
elimina dois caminhos de gravação divergentes.

Consequência prática: cada escrita HTTP persiste, recalcula os valores
derivados e então publica um evento em tempo real pelo `broadcaster`. Falha na
publicação **nunca** derruba a requisição já persistida (todo `publish*` está em
`try/catch`).

---

## 2. Papéis de usuário

| Papel | Pode |
|-------|------|
| **PLAYER** | Ter **uma única ficha** (a própria). Cria, monta e opera o personagem; rola dados; participa do combate; move/usa itens; gasta/troca/transfere moedas. **Não enxerga** a ficha de ninguém, nem bestiário, regiões, itens do catálogo (como editor), compêndio ou painéis de mestre. |
| **MASTER** | Enxerga **todas** as fichas; edita qualquer campo de qualquer ficha; gerencia bestiário (criaturas/NPCs), regiões/localidades, catálogo de itens, combate, apresentação de imagens, anotações, configuração da mesa e compêndio; libera Level Up; exclui personagens. A conta de MASTER **não tem ficha**. |

O cadastro vira MASTER somente com o `MASTER_INVITE_CODE` correto (ou pela CLI
`create-master`).

---

## 3. Stack, versões e tipagem

**Runtime / servidor**

- Node.js **>= 20** (`engines`).
- Módulos **ESM** (`"type": "module"`; imports com sufixo `.js`).
- TypeScript **5.6**, target ES2022, `module`/`moduleResolution` NodeNext,
  `strict: true`, `noImplicitOverride: true`, sourceMap, `rootDir src` →
  `outDir dist`.
- O build **não usa bundler** no servidor: `tsc` transpila 1:1 preservando a
  árvore de arquivos.

**Dependências de produção**

| Pacote | Uso |
|--------|-----|
| `express ^5.0.0` | HTTP |
| `socket.io ^4.8.0` | WebSocket (mesma porta do HTTP) |
| `@prisma/client ^6.0.0` | ORM |
| `zod ^3.23.8` | Validação de todo corpo de requisição e de JSONB |
| `jsonwebtoken ^9.0.3` | JWT (HS256) |
| `bcryptjs ^3.0.3` | Hash de senha, `SALT_ROUNDS = 12` |
| `helmet ^8.3.0` | Cabeçalhos de segurança |
| `cors ^2.8.5` | CORS |
| `express-rate-limit ^8.7.0` | Rate limit do login/registro |
| `dotenv ^16.4.5` | `.env` |

**Desenvolvimento:** `prisma ^6`, `tsx ^4.19` (executa TS sem build),
`typescript ^5.6`, `socket.io-client ^4.8.4` (usado pelo smoke), `@types/*`.

**Cliente (`client/`)**

- React **^19.3.0** + react-dom, `jsx: react-jsx`.
- Vite **^8.3.1** + `@vitejs/plugin-react ^6.1.1`.
- TypeScript **^7.0.2** com `verbatimModuleSyntax`, `noUnusedLocals` e
  `noUnusedParameters` (rigoroso).
- **Sem framework de UI e sem biblioteca de estado**: React puro + CSS próprio.
- Estilo: `client/src/styles.css` (≈ **7.990 linhas**), tema pergaminho (claro)
  e "grimório amaldiçoado" (escuro) via `data-theme` no `<html>`.
- Fontes **auto-hospedadas** (`client/public/fonts`): **Cinzel** (títulos),
  **MedievalSharp** (marca) e **EB Garamond** (corpo) — nada externo em runtime.
- **Tokens de design** para tipografia e ritmo: `--text-page/section/subsection/
  label/value/value-lg/name/aux/micro` (um tamanho por papel) e `--gap-icon`,
  `--gap-label`, `--card-pad-x/y`, `--control-h` (respiro único por componente).

**Banco:** PostgreSQL. `datasource db { provider = "postgresql" }` +
`DATABASE_URL`. **19 migrations** versionadas em `prisma/migrations/`.

**Convenções de tipagem:** os DTOs do servidor **são** o contrato.
`client/src/types.ts` (≈ **1.590 linhas**) espelha os DTOs manualmente;
`client/src/events.ts` e `client/src/socket.ts` espelham
`src/realtime/events.ts` e `src/types/socket.ts`. Não há geração automática de
tipos entre as camadas — a sincronia é manual e verificada pelo typecheck
independente de cada lado.

---

## 4. Como rodar e operar

### Comandos (`package.json`)

| Comando | O que faz |
|---------|-----------|
| `npm run dev` | `tsx watch src/index.ts` |
| `npm run build` | `tsc -p tsconfig.json` (emite `dist/`) |
| `npm start` | `node dist/index.js` |
| `npm run typecheck` | `tsc --noEmit` (servidor) |
| `npm --prefix client run typecheck` | typecheck do cliente |
| `npm --prefix client run build` | `vite build` (`client/dist`) |
| `npm run prisma:generate` / `prisma:migrate` / `prisma:deploy` / `prisma:studio` | Prisma |
| `npm run db:push` | `prisma db push` |
| `npm run create-master` | cria/atualiza conta MASTER por CLI |
| `npm run migrate:attack-damage` | converte o dano textual dos ataques em estruturado |
| `npm run migrate:item-weapons` | completa o perfil de arma dos itens |
| `npm run smoke` | smoke test ponta a ponta |
| `npm run setup` | instala dependências do servidor e do cliente |
| `npm run dev:client` | Vite em `:5173` com proxy para `:3000` |

> **Produção:** o serviço systemd executa **`dist/`**. Alterar `src/` sem
> `npm run build` **não tem efeito nenhum**.

### Desenvolvimento

```bash
npm run setup
npm run prisma:migrate
npm run create-master -- --username mestre --password "senha-forte" --name "Mestre"
npm run dev            # servidor em :3000 (tsx watch)
npm run dev:client     # Vite em :5173 (proxy de /api e /socket.io)
```

### Produção (este servidor)

```bash
npm run typecheck && npm --prefix client run typecheck
npm run build && npm --prefix client run build
npm run prisma:deploy            # SÓ quando há migration nova
sudo systemctl restart grimorio
node -e "fetch('http://localhost:3000/').then(r=>console.log('http',r.status))"
npm run smoke                    # reinicie o serviço antes, para limpar o rate limit
```

### Diagnóstico

- `GET /api/health` → `200 { status:'ok' }` | `503 { status:'degraded' }`.
- `journalctl -u grimorio -f` (logs `[socket]`, `[erro]`, `[characters]`...).
- `npm run prisma:studio`.

### Unit systemd (`deploy/grimorio.service`, resumo)

```
After=network-online.target postgresql.service
Requires=postgresql.service
WorkingDirectory=/var/www/rpg
EnvironmentFile=/var/www/rpg/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
KillSignal=SIGTERM   TimeoutStopSec=15
Restart=on-failure   RestartSec=3
```

> **Atenção de implantação:** o `.env` **não** deve definir `NODE_ENV`, porque
> em systemd o `EnvironmentFile` tem precedência sobre a diretiva
> `Environment=`. O unit define `NODE_ENV=production` e o `.env` define
> `DATABASE_URL/PORT/JWT_SECRET/MASTER_INVITE_CODE/CORS_ORIGIN`.

---

## 5. Arquitetura geral

### 5.1 Bootstrap e ciclo de vida (`src/index.ts`)

1. `createApp()` monta o Express (sem `listen`).
2. `createServer(app)` cria o `http.Server`.
3. `createRealtimeServer(httpServer)` cria o Socket.io sobre o **mesmo**
   `http.Server` (HTTP e WebSocket na mesma porta) e registra o broadcaster no
   hub.
4. `httpServer.listen(env.PORT)`.
5. Loga `"🐉 Codex do Aventureiro — <NODE_ENV>"` e as URLs.

**Encerramento gracioso** (SIGINT/SIGTERM — o systemd envia SIGTERM):
temporizador de segurança de 10 s (`unref`) que força `process.exit(1)`;
`io.close()` → `httpServer.close()` (aguardado) → `prisma.$disconnect()` →
`process.exit(0)`.

**Carga inicial:** `dotenv/config` é importado no topo de `src/config/env.ts`,
então o `.env` é lido antes de qualquer variável. Se a validação Zod falhar, o
processo imprime o mapa de erros e sai com código 1 (nunca sobe parcialmente).

### 5.2 Princípios técnicos

1. **Uma só porta** para HTTP, WebSocket e estáticos.
2. **Escrita só por HTTP**; WebSocket só notifica.
3. **Valores derivados nunca são gravados**: são recalculados em toda leitura
   pelo motor puro (`src/modules/shared`).
4. **Validação em duas fronteiras**: Zod no corpo das requisições e Zod na
   leitura/escrita dos JSONB.
5. **Concorrência otimista** com a coluna `version` (e `lastLevelUpRelease`
   para o Level Up): `updateMany` com o valor lido no `where`; se ninguém casa,
   `409`.
6. **Estado efêmero em memória** (presença, apresentação, janela de dados e
   histórico de rolagens) para poder **reenviar** o estado a quem conectar no
   meio; some no restart.

---

## 6. Estrutura de diretórios

### Raiz

```
package.json            scripts + dependências do servidor
tsconfig.json           build do servidor (src/ → dist/)
README.md               documentação funcional e operacional
ARQUITETURA-DO-SISTEMA.txt  documento técnico detalhado
Projeto.md              este documento
REVISAO-CODIGO.md       notas de revisão
prisma/
  schema.prisma         9 modelos, 4 enums
  migrations/           19 migrations SQL versionadas
uploads/                imagens em disco: characters/ creatures/ items/ localities/
deploy/grimorio.service unit do systemd
dist/                   saída do build do servidor (o que o systemd executa)
client/                 app React/Vite (build próprio em client/dist)
```

### Servidor (`src/`)

```
index.ts                bootstrap: app + http.Server + Socket.io + shutdown
config/
  env.ts                validação do ambiente com Zod (falha ⇒ exit 1)
  prisma.ts             singleton de PrismaClient (guardado em globalThis fora de produção)
http/
  app.ts                montagem do Express (middlewares, /uploads, /api, SPA fallback)
  routes/index.ts       roteador raiz da API (monta todos os sub-roteadores)
  routes/health.ts      GET /api/health
lib/
  jwt.ts                signToken / verifyToken / tryVerifyToken / extractBearerToken
  password.ts           hashPassword / verifyPassword (bcryptjs, custo 12)
  uploads.ts            gravação/remoção de imagens em disco (data URL → arquivo)
  http-error.ts         HttpError { status, message }
middlewares/errorHandler.ts  notFoundHandler (404) + errorHandler (central)
modules/                (um diretório por domínio; .dto/.schema/.service/.routes)
  auth/                 registro, login, authenticate/requireRole
  users/                listagem de usuários (somente mestre)
  characters/           ficha do jogador + assistente de criação + inventário + moedas
  combat/               combate: iniciativa, turnos, ataques, HP
  creatures/            bestiário (criaturas e NPCs)
  regions/              regiões do mundo
  localities/           localidades dentro de regiões + upload de imagens
  items/                catálogo central de itens + envio ao jogador
  dice/                 janela de dados (rolagens) e histórico da sessão
  presentation/         "mostrar imagem para a mesa"
  game-config/          configuração da mesa (Level Up, nível inicial, notas, moedas extras)
  compendium/           listas de referência (classes, raças, antecedentes, magias)
  shared/               REGRAS PURAS de D&D 5e (sem banco, sem HTTP)
    dnd5e.ts            atributos, perícias, proficiência, XP, derived
    armor-class.ts      cálculo de CA (armadura/escudo/defesa sem armadura/override)
    dice.ts             randomInt, parser de expressão "2d6+3", crítico
    attacks.ts          schema de ataque compartilhado (dano estruturado)
    ammo.ts             regras de munição
    item-details.ts     categorias/atributos/preço de item + perfil de arma
    coins.ts            sistema de moedas do PHB
    images.ts           { url, name }
    json.ts             parseJson(schema, valor, fallback)
    creation.ts         catálogos de RAÇA (14) e ANTECEDENTE (13) + rascunho
    classes.ts          fachada que reexporta classes/index.ts
    classes/            tipos (types.ts) + as 12 classes + tabelas de conjuração/ASI
    level-history.ts    o que cada nível concedeu (base do downgrade)
    weapon-attacks.ts   ataque derivado da arma equipada
  realtime/
    index.ts            cria o Socket.io, autentica, entra em salas, presença
    auth.ts             middleware de handshake (JWT + confere a conta no banco)
    rooms.ts            helpers de nome de sala
    presence.ts         presença em memória (userId → Set<socketId>)
    broadcast.ts        broadcaster (toUser/toMasters/toTable/toPlayers/disconnectUser)
    hub.ts              ponto único de acesso ao broadcaster
    events.ts           CONTRATO de eventos e payloads (fonte de verdade)
scripts/
  create-master.ts      cria/atualiza MASTER por CLI
  migrate-attack-damage.ts  converte o dano textual dos ataques para o estruturado
  migrate-item-weapons.ts   completa o perfil de arma dos itens
  smoke-realtime.ts     smoke test ponta a ponta (~8.340 linhas)
```

### Cliente (`client/src/`)

```
main.tsx                initTheme() + unlockAudioOnFirstGesture() + <App/>
App.tsx                 AuthProvider → LightboxProvider → Shell (MASTER? painel : ficha)
api.ts                  fetch tipado, token em localStorage ('grimorio.token'), ApiError
auth.tsx                contexto de sessão (user, loading, login, register, logout)
socket.ts               cria o socket (mesma origem; auth por token)
useRealtime.ts          assina todos os eventos e entrega aos handlers (ref estável)
types.ts                espelho dos DTOs do servidor
events.ts               payloads de conexão/presença
dnd.ts                  apenas LABELS/constantes de exibição (nenhuma regra)
races.ts                raça no catálogo + bônus racial com os `+1` à escolha
theme.ts · sound.ts · utils.ts · readonly.tsx
gameApi.ts creationApi.ts levelUpApi.ts inventoryApi.ts presentationApi.ts coinsApi.ts
combat/combatApi.ts · dice/diceApi.ts
pages/
  SheetPage.tsx         ficha do jogador (ou o wizard de criação)
  MasterPanel.tsx       painel do mestre (abas + combate + pilha flutuante)
components/             AuthPage, AppHeader, Icon, Portrait, HpBar, Lightbox, Section,
                        InlineField, SheetView, InventoryDock, ItemDetailModal,
                        AttacksTable, PresentationOverlay, CreationWizard, LevelUpDialog,
                        FieldInfo
  creation/             AbilityStep (palco de rolagem de atributos)
  sections/             Identity, Vitals, AbilityCards, Attacks, Features, Spells,
                        Inventory, BagList, Notes, CoinsPanel
  master/               SheetsTab, CreaturesTab, CreatureEditor, RegionsTab, RegionEditor,
                        LocalityEditor, ItemsTab, ItemEditor, DeleteCharacterDialog,
                        LevelDownDialog, ConfigTab, RollLogPanel, MasterNotes,
                        ImageGallery, CoinsGrantPanel
combat/                 CombatTracker, CombatStartDialog, CombatIntro, useCombatState
dice/                   DiceDock, Die3D, polyhedra, RemoteRollBoard, useDiceRoller,
                        RollLogList, format
styles.css              identidade visual completa
fonts.css               @font-face das fontes locais (gerado)
```

---

## 7. Variáveis de ambiente

Validadas por Zod em `src/config/env.ts`:

| Variável | Obrigatória | Regra / padrão |
|----------|-------------|-----------------|
| `NODE_ENV` | não | `development` \| `test` \| `production` (padrão `development`) |
| `PORT` | não | inteiro positivo (padrão `3000`) |
| `DATABASE_URL` | **sim** | string não vazia |
| `CORS_ORIGIN` | não | padrão `*`; senão lista separada por vírgula |
| `JWT_SECRET` | **sim** | mínimo 16 caracteres |
| `JWT_EXPIRES_IN` | não | padrão `7d` |
| `MASTER_INVITE_CODE` | não | mínimo 4 caracteres; sem ela é impossível cadastrar MASTER pela API |

Derivado: `corsOrigins` = `*` ou array de origens, usado no Express e no
Socket.io sempre com `credentials: true`.

---

## 8. Modelo de dados (PostgreSQL / Prisma)

**Filosofia:** modelagem **híbrida**. Campos escalares muito consultados em
colunas; coleções grandes em **JSONB** validado por Zod na aplicação (sem
dezenas de tabelas auxiliares). Toda tabela usa `@@map` para nome snake_case;
todo id é `cuid()`, exceto `GameConfig` (chave fixa `"main"`).

**9 modelos, 4 enums.**

### 8.1 GameConfig → `game_config` (linha única, `id = "main"`)

| Campo | Tipo | Papel |
|-------|------|-------|
| `levelUpRelease` | Int (0) | contador de liberações de Level Up (incrementa a cada clique) |
| `startingLevel` | Int (1) | nível em que a mesa começa (1..20) |
| `masterNotes` | String ("") | anotações **privadas** do mestre (≤ 20.000) |
| `extraCoins` | Boolean (false) | exibe PL (pp) e PE (ep) no bloco de moedas |
| `updatedAt` | DateTime | — |

**Invariante:** `masterNotes` **não** entra no `GameConfigDto` (o `GET /api/game`
é acessível ao jogador); as anotações trafegam só por `/api/game/notes`.

### 8.2 User → `users`

`id` · `username` @unique · `displayName` · `passwordHash` · `role Role`
(default PLAYER) · `createdAt` · `updatedAt` · `character Character?`
(relação 1:1). `@@index([role])`.
**Invariante:** uma ficha por usuário; a conta do MASTER não tem ficha.

### 8.3 Character → `characters`

- `id`, `userId` @unique → User (`onDelete: Cascade`).
- `creationFinalized Boolean` — trava a construção.
- `creationDraft Json` — rascunho do assistente.
- Identidade: `name` ("Novo Personagem"), `race`, `background`, `alignment`,
  `experience`, `avatarUrl`.
- `classes Json` — `[{ classKey, subclass, level }]` (multiclasse).
- `lastLevelUpRelease Int` — liberação já usada por esta ficha.
- `levelHistory Json` — o que **cada** nível concedeu.
- Atributos: 6 colunas Int (default 10), faixa 1..30.
- Vitais: `hpCurrent` (1), `hpMax` (1), `hpTemp` (0), `armorClass` (0 = override
  do mestre; automático quando 0), `initiativeBonus` (0), `speed` (9 m).
- Coleções JSONB: `skills`, `saves`, `proficiencies`, `inventory`, `spells`,
  `attacks`, `features`, `classState`, `coins`.
- `notes`, `version` (incrementa a cada alteração), `createdAt`, `updatedAt`,
  `combatants Combatant[]`.

**Não existe coluna `level`:** o nível do personagem é **derivado** da soma dos
níveis de `classes[]`.

### 8.4 Region → `regions`

`id` · `name` · `description` · `notes` · `images Json` (`[{url,name}]`) ·
`version` · timestamps · `localities Locality[]`. `@@index([name])`.

### 8.5 Locality → `localities`

`id` · `name` · `description` · `images Json` · `version` · timestamps ·
`regionId → Region (Cascade)` · `creatures Creature[]` · `combats Combat[]`.
`@@index([name])`, `@@index([regionId])`.
**Cascata:** apagar a região apaga as localidades.

### 8.6 Creature → `creatures`

`id` · `name` · `kind CreatureKind (CREATURE|NPC)` · `type` ·
`challengeRating` · 6 atributos · `hpCurrent`/`hpMax` · `armorClass` (10) ·
`speed` (9) · `attacks Json` · `resistances Json` · `immunities Json` ·
`description` · `imageUrl` · `localities Locality[]` (N:N implícito) ·
`version` · timestamps. `@@index([name])`, `@@index([kind])`.

### 8.7 Item → `items`

`id` · `name` · `description` · `weight Float` (kg) · `category` ·
`rarity String?` (common|uncommon|rare|very_rare|legendary|artifact; `null` =
sem raridade) · `requiresAttunement Boolean` (manual, independente da raridade) ·
`imageUrl` · `details Json` · `priceGold/Silver/Copper Int` · `version` ·
timestamps. `@@index([name])`, `@@index([category])`, `@@index([rarity])`.

### 8.8 Combat → `combats` / Combatant → `combatants`

**Combat:** `id` · `status CombatStatus` (PENDING_INITIATIVE/ACTIVE/ENDED) ·
`round` (1) · `currentIndex` (0) · `localityId? → Locality (SetNull)` ·
timestamps · `endedAt?` · `combatants`. `@@index([status])`.
**Invariante:** no máximo **um** combate em PENDING_INITIATIVE|ACTIVE.

**Combatant:** `id` · `combatId → Combat (Cascade)` · `kind` ·
`characterId?`/`creatureId?` (**SetNull** de propósito: se a ficha/criatura
sumir no meio do combate, o combatente continua existindo com id nulo, e o DTO
marca `missing: true`) · `name` (congelado; cópias viram "Goblin 1", "Goblin
2") · `ownerUserId?` · `dexterityMod` (fixado na entrada) ·
`hpCurrent/hpMax/armorClass Int?` (**snapshot**, só por CRIATURA) ·
`initiative?`/`initiativeRoll?` · `createdAt`.
`@@index([combatId])`, `@@index([ownerUserId])`.
**Regra:** o HP de **personagem** nunca é duplicado aqui — é lido ao vivo da
ficha.

### 8.9 Enums

`Role` = PLAYER, MASTER · `CreatureKind` = CREATURE, NPC ·
`CombatStatus` = PENDING_INITIATIVE, ACTIVE, ENDED ·
`CombatantKind` = CHARACTER, CREATURE.

### 8.10 Migrations (19, ordem cronológica)

```
20260926021500_add_user_and_role
20260926023402_add_character_sheet
20260926030427_add_creatures
20260926032912_add_combat
20260926061351_localidades_npcs_e_vida_por_combatente
20260926100000_add_class_and_subclass
20260926120000_add_class_state
20260926141113_add_items_and_images
20260926144651_item_details_and_price
20260926170000_metric_system
20260926171000_add_regions
20260926180000_multiclass_and_level_up
20260927120000_creation_finalized_and_armor_class
20260928120000_creation_wizard
20260928150000_release_level_up_per_click
20260928160000_character_proficiencies
20260928170000_game_config_master_notes
20260929120000_character_coins
20260929140000_character_level_history
```

---

## 9. Camada HTTP

### 9.1 Montagem (`src/http/app.ts`) — a ordem é semântica

1. `app.disable('x-powered-by')`.
2. `helmet({ crossOriginResourcePolicy: 'cross-origin', contentSecurityPolicy: {
   defaultSrc 'self'; scriptSrc 'self'; styleSrc 'self' + 'unsafe-inline';
   imgSrc 'self' + data: + blob:; connectSrc 'self' + ws: + wss:;
   upgradeInsecureRequests: null } })` — o upgrade é desativado de propósito
   (o sistema é acessado por IP em HTTP simples).
3. `cors({ origin: corsOrigins === '*' ? true : corsOrigins, credentials: true })`.
4. `express.json({ limit: '8mb' })` — o limite alto existe para upload de
   imagem como **data URL** (base64) dentro do JSON.
5. `express.static(UPLOADS_DIR, { maxAge: '7d', immutable: true })` em `/uploads`.
6. `app.use('/api', apiRouter)`.
7. Se `client/dist` existir: `express.static(clientDist)` + fallback SPA (todo
   GET que **não** comece com `/api` nem `/socket.io` devolve
   `client/dist/index.html`).
8. `notFoundHandler` → `404 { error: 'NOT_FOUND', message }`.
9. `errorHandler` → status do `HttpError` (ou 500).

`UPLOADS_DIR` e `clientDist` são resolvidos a partir de `import.meta.url`
(valem tanto em `src/lib` quanto em `dist/lib`).

### 9.2 Formato padrão de erro

```json
{ "error": "CODIGO", "message": "texto em pt-BR", "issues": { "campo": ["msg"] } }
```

Códigos: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `INTERNAL_ERROR` (500), `TOO_MANY_REQUESTS` (429).
Erros de negócio usam `HttpError(status, mensagem)` e caem como
`REQUEST_ERROR` com a mensagem literal (ex.: `409 "Você já usou esta liberação
de Level Up."`). Em `development`, o 500 inclui `stack`.

### 9.3 Roteadores montados em `/api` (ordem)

```
/health /auth /users /characters /creatures /regions /localities /items
/game /compendium /dice /uploads /presentation /combat
```

---

## 10. Autenticação, autorização e identidade do ator

### Registro — `POST /api/auth/register` (rate-limited)

Corpo `{ username, displayName, password, masterInviteCode? }`. Papel default
PLAYER. Se `masterInviteCode` vier: precisa ser **igual** a
`env.MASTER_INVITE_CODE` (senão `403 "Código de mestre inválido."`); batendo,
vira MASTER. Username duplicado ⇒ 409. Senha hasheada com bcrypt (custo 12).
Resposta `201 { token, user }`.

### Login — `POST /api/auth/login` (rate-limited)

Usuário inexistente e senha errada devolvem **a mesma** mensagem
(`401 "Usuário ou senha inválidos."`) para não revelar a existência de contas.
Resposta `200 { token, user }`.

### Rate limit (`auth.routes.ts`, `authLimiter`)

Aplicado **só** a `/register` e `/login`: janela 15 min; limite **30 em
produção** e **100 fora de produção**; `standardHeaders: true`. Estado **em
memória** do processo ⇒ um restart do serviço zera o contador.

### Token (`src/lib/jwt.ts`)

HS256, payload `TokenPayload = { sub: userId, username, displayName, role }`,
validade `JWT_EXPIRES_IN` (default `7d`).

### `authenticate` (auth.middleware.ts)

Lê `Authorization: Bearer <token>`, verifica a assinatura **e confere a conta
no banco** a cada requisição (`prisma.user.findUnique`). O `req.user` é montado
a partir do **banco**, não do token. Efeitos deliberados:

- conta excluída perde o acesso **na hora** (o JWT continuaria válido até
  expirar);
- mudança de papel vale sem novo login.

`401` sem token/assinatura inválida; `401` se a conta não existe mais.

### `requireRole(...roles)`

Usado **depois** de `authenticate`. `401` sem `req.user`; `403` se o papel não
está na lista.

### Regra transversal — o ator nunca vem do corpo

`actorFrom(req)` sempre monta `{ userId: req.user.sub, ... }` do token. O
servidor carimba identidade em: autor da rolagem, `editedBy` da ficha, nome de
quem apresenta a imagem, `ownerUserId` do combatente. **Não há como
personificar outro usuário** enviando ids no payload.

Os únicos canais **públicos** (sem `authenticate`) são `POST /api/auth/register`
e `POST /api/auth/login`. Todo o resto é autenticado; `creatures`, `regions` e
`localities` aplicam `requireRole('MASTER')` **no próprio roteador**
(`router.use(authenticate, requireRole('MASTER'))`), e os demais por rota.

---

## 11. Contrato HTTP completo

Legenda: **[pub]** sem token · **[auth]** qualquer autenticado · **[mestre]**
MASTER. Todos os corpos passam por Zod; corpo inválido ⇒ `400` com `issues`.

### 11.1 Saúde

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| GET | `/api/health` | [pub] | `SELECT 1` no banco. `200 { status:'ok', database:'up', timestamp }` ou `503 { status:'degraded', database:'down' }`. |

### 11.2 Autenticação

| Método | Rota | Acesso | Corpo / resposta |
|--------|------|--------|------------------|
| POST | `/api/auth/register` | [pub, rate-limited] | `{ username, displayName, password, masterInviteCode? }` → `201 { token, user }` |
| POST | `/api/auth/login` | [pub, rate-limited] | `{ username, password }` → `200 { token, user }` |
| GET | `/api/auth/me` | [auth] | → `{ user: { sub, username, displayName, role } }` |

### 11.3 Usuários

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| GET | `/api/users` | [mestre] | `{ users: PublicUser[] }` — `{ id, username, displayName, role, createdAt }` (nunca o hash); ordenado por papel e depois username. |

### 11.4 Ficha do jogador (a própria)

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| GET | `/api/characters/me` | [auth] | `{ character | null }` |
| POST | `/api/characters/me` | [auth] | `201 { character }`; `409` se já existe. Nasce **sem classe** (`classes: []`), com 18 perícias e 6 salvaguardas normalizadas e `level = 0`. |
| PATCH | `/api/characters/me` | [auth] | edição parcial; ver §14 |
| POST | `/api/characters/me/level-up` | [auth] | Level Up pelo assistente; §15 |
| POST | `/api/characters/me/inventory/move` | [auth] | `{ itemInventoryId, targetSlot?, targetBackpackX?, targetBackpackY? }` — equipa/troca ou move na mochila. **Único** caminho do jogador que mexe na **posição**; nunca na quantidade. |
| POST | `/api/characters/me/inventory/use` | [auth] | `{ itemInventoryId }` → `{ character, roll }`. Consome 1 unidade de Poção ou item com `details.consumable`; com `effectRoll`, rola e registra (`kind: 'item'`). Em **Poção de Cura com `healingDice`**, rola `count×dado + bonus` e aplica `hpCurrent = min(hpMax, hpCurrent + total)` na mesma escrita (log `kind: 'item'`, `Cura (<nome>)`). Fora desse caso, nenhum efeito automático. |
| POST | `/api/characters/me/coins/spend` | [auth] | `{ amount }` — gasto **exato** por denominação (sem troco); saldo insuficiente `400`. |
| POST | `/api/characters/me/coins/exchange` | [auth] | troca entre denominações com as conversões do PHB; troca que exigiria fração ⇒ `400`. |
| POST | `/api/characters/me/coins/transfer` | [auth] | `{ targetCharacterId, amount }` — debita o doador e credita o destino na **mesma transação**; não vale para si nem para o mestre; as **duas** fichas recebem `sheet:updated`. |
| GET | `/api/characters/players` | [auth] | destinos possíveis de transferência (só fichas de OUTROS jogadores). |

### 11.5 Assistente de criação

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| GET | `/api/characters/me/creation` | [auth] | `{ character, creation }` (rascunho, catálogos, nível inicial e o que falta) |
| PATCH | `/api/characters/me/creation` | [auth] | `{ step (1..9), mode?, name?, alignment?, avatarUrl?, race?, abilityChoices?, background?, classKey?, subclass?, baseAbilities?, skills? }` — só os campos do passo concluído |
| POST | `/api/characters/me/creation/roll` | [auth] | `{ restart? }` → `201 { character, creation, roll }`; rola 4d6 descartando o menor, no **servidor** |
| POST | `/api/characters/me/creation/level-up` | [auth] | passo 8: aplica **um** nível pelo mesmo assistente, **sem** exigir/consumir a liberação do mestre |
| POST | `/api/characters/me/creation/finalize` | [auth] | `400` listando o que falta; senão `creationFinalized = true` |

### 11.6 Gestão de fichas (mestre)

| Método | Rota | Corpo | Descrição |
|--------|------|-------|-----------|
| GET | `/api/characters` | — | lista todas (nome; inclui `ownerUsername`; inventário sincronizado em uma consulta) |
| PATCH | `/api/characters/:id` | qualquer campo | o mestre edita tudo, em qualquer momento (inclusive `armorClassOverride` e com a criação finalizada). O dono recebe `sheet:updated` com `editedBy`. |
| POST | `/api/characters/:id/coins` | `{ delta }` | `delta` positivo dá, negativo retira; retirar mais do que existe ⇒ `400`. |
| POST | `/api/characters/:id/level-down` | `{ classKey, hpLost?, abilityDecreases?, removeFeatId? }` | reduz UM nível revertendo o que ele concedeu; §15 |
| POST | `/api/characters/:id/creation/reopen` | — | único caminho de volta: `creationFinalized = false`, rascunho re-semeado com modo `existing`, valores atuais e passo 1 |
| DELETE | `/api/characters/:id` | — | `204`; apaga a ficha **e a conta do jogador**; `403` se a conta alvo for MASTER. Irreversível. |

### 11.7 Bestiário (roteador é inteiro [mestre])

`GET /api/creatures` · `GET /api/creatures/:id` · `POST /api/creatures`
(exige ≥1 localidade) · `PATCH /api/creatures/:id` · `DELETE /api/creatures/:id`
(204). Todo CRUD publica o evento correspondente para a sala dos mestres.

### 11.8 Regiões e localidades (roteadores inteiros [mestre])

`GET/POST /api/regions` · `GET/PATCH/DELETE /api/regions/:id` (204, cascata) ·
`GET/POST /api/localities` · `GET/PATCH/DELETE /api/localities/:id` (204).
Localidade exige `regionId` válido (`400`).

### 11.9 Uploads

| Método | Rota | Acesso | Corpo |
|--------|------|--------|-------|
| POST | `/api/uploads/image` | [mestre] | `{ dataUrl, name?, folder? }`; `folder ∈ { localities, creatures, characters, items }` (default `localities`) → `201 { image: { url, name } }` |
| POST | `/api/uploads/avatar` | [auth] | `{ dataUrl, name? }` — grava sempre em `characters` |

Aceita só PNG/JPEG/WEBP/GIF em data URL base64, **máx. 5 MB decodificados**.

### 11.10 Catálogo de itens

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| GET | `/api/items` · `/api/items/:id` | [auth] | jogador recebe **sem preço** |
| POST | `/api/items` | [mestre] | `201 { item }`; aceita `rarity` (enum ou `null`) e `requiresAttunement` (bool) |
| PATCH | `/api/items/:id` | [mestre] | troca de categoria re-normaliza `details`; dispara `republishSheetsWithCatalogItem` |
| DELETE | `/api/items/:id` | [mestre] | `204` (apaga o sprite do disco) |
| POST | `/api/items/:id/send` | [mestre] | `{ characterId, quantity? }` → `201`; se já houver o mesmo `itemId`, **soma**. Nunca envia o preço. Evento só para mestre e dono. |

### 11.11 Configuração da mesa

| Método | Rota | Acesso | Corpo |
|--------|------|--------|-------|
| GET | `/api/game` | [auth] | → `{ config: { levelUpRelease, startingLevel, extraCoins, updatedAt } }` |
| POST | `/api/game/level-up` | [mestre] | **sem corpo**; incrementa `levelUpRelease` (`{ increment: 1 }`) |
| POST | `/api/game/starting-level` | [mestre] | `{ level: 1..20 }`; vale para as **próximas** criações |
| POST | `/api/game/extra-coins` | [mestre] | `{ enabled: boolean }`; só afeta a **exibição** de PL/PE |
| GET | `/api/game/notes` | [mestre] | → `{ notes }` |
| PATCH | `/api/game/notes` | [mestre] | `{ notes }` (≤ 20.000); substitui o texto todo; **sem** publicação em tempo real |

### 11.12 Compêndio (aba "Mesa")

`GET /api/compendium` [auth] → `{ compendium }` =
`{ classes[12], races[14], backgrounds[13], spells[] }` — **somente leitura**.
Fonte única: `getCompendium()` (lê os catálogos estáticos). **LACUNA:** o
catálogo de magias tem estrutura definida mas lista vazia.

### 11.13 Janela de dados

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| GET | `/api/dice/active` | [auth] | `{ activeRoll | null }` |
| GET | `/api/dice/history` | [mestre] | `{ rolls }` (log da sessão, memória) |
| DELETE | `/api/dice/history` | [mestre] | `204` |
| POST | `/api/dice/active` | [auth] | anuncia/retira a faixa "está rolando" |
| POST | `/api/dice/roll` | [auth] | `{ dice[{sides}], advantage?, disadvantage?, bonus?, label?, kind?, private?, clientId? }` → `201 { roll }`; quem rola é o **servidor** |

### 11.14 Apresentação de imagens

`GET /api/presentation` [auth] → `{ presentation | null }` ·
`POST /api/presentation` [mestre] `{ imageUrl, alt? }` (o `presentedBy` vem do
token) · `POST /api/presentation/close` [mestre] (idempotente).

### 11.15 Combate

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| GET | `/api/combat/active` | [auth] | `{ combat | null }` |
| POST | `/api/combat` | [mestre] | `{ localityId?, entries[{creatureId,quantity}] }` → `201`; `409` se já há combate; nasce PENDING_INITIATIVE |
| POST | `/api/combat/initiative` | [auth] | rola a iniciativa do próprio personagem |
| POST | `/api/combat/initiative/:combatantId` | [mestre] | rola por qualquer combatente |
| POST | `/api/combat/next-turn` | [mestre] | avança o turno |
| POST | `/api/combat/attack` | [auth] | `{ targetCombatantId, attackId, attackerCombatantId? }` → `{ combat, result }` |
| POST | `/api/combat/hp` | [mestre] | `{ combatantId, amount, mode: 'damage'|'heal' }` |
| POST | `/api/combat/end` | [mestre] | encerra (`204`/`{ combatId }`) |

---

## 12. Camada de tempo real (Socket.io)

### Criação

Sobre o **mesmo** `http.Server`, `transports: ['websocket','polling']`, CORS
idêntico ao do Express.

### Handshake (`socketAuth` via `io.use`)

Token aceito de `socket.handshake.auth.token` (frontend) **ou** `?token=` na
query string (CLI). Além de verificar a assinatura, **consulta a conta no
banco**: token de conta excluída não abre socket. Em sucesso popula
`socket.data = { userId, username, displayName, role }`. Falha ⇒
`next(new Error('UNAUTHORIZED'))`.

### Salas (`rooms.ts`) — um socket entra em

- `table:main` (`TABLE_ROOM`) — todos os conectados;
- `user:${userId}` (`userRoom`) — todas as sessões/abas do mesmo usuário;
- `role:masters` (`MASTERS_ROOM`) — só se `role === 'MASTER'`.

Cliente→servidor: `table:join`/`table:leave` com `tableId?` opcional (gancho
para mesa múltipla futura). **LACUNA/HIGIENE:** `combatRoom` está exportado mas
**não** é usado — os eventos de combate vão para a mesa toda com filtragem de
**visibilidade no payload**, não por sala.

### Ao conectar, o servidor

1. entra nas salas;
2. `registerConnection` (presença em memória: `userId → Set<socketId>`); a
   presença só é publicada na **primeira** conexão do usuário;
3. emite `connection:ready { socketId, connectedAt, user }`;
4. se houver **apresentação** ativa, emite `presentation:shown` para o socket
   novo;
5. se houver **janela de dados** ativa, emite `dice:active`.

### Ao desconectar

`unregisterConnection`; se foi a última aba: `clearActiveRollFrom(userId)`
(tira a faixa) e republica a presença.

### Broadcaster (`broadcast.ts`)

| Método | Destino |
|--------|---------|
| `toUser(userId, evento, payload)` | sala `user:<id>` |
| `toMasters(evento, payload)` | sala `role:masters` |
| `toTable(evento, payload)` | sala `table:main` |
| `toPlayers(evento, payload)` | `table:main` **exceto** `role:masters` |
| `disconnectUser(userId)` | `io.in(userRoom).disconnectSockets(true)` |
| `presence()` | emite `presence:update { online }` |

Acesso pelo singleton `getBroadcaster()` (`hub.ts`).

### Estado efêmero em memória (não vai ao banco, some no restart)

- presença (`presence.ts`);
- apresentação de imagem atual (`presentation.service.ts`);
- janela de dados ativa + histórico de até 100 rolagens (`dice.service.ts`).

Motivo: mesa única em um processo; guardar em memória permite **reenviar** o
estado a quem conectar no meio.

### Catálogo de eventos servidor → cliente (`ServerEvents`, `events.ts`)

| Evento | Destino | Payload / efeito |
|--------|---------|------------------|
| `connection:ready` | socket novo | `{ socketId, connectedAt, user }` |
| `app:error` | socket | `{ message }` |
| `presence:update` | mesa | `{ online: OnlineUser[] }` |
| `sheet:updated` | mestres + **dono** | ver §14.4 |
| `character:deleted` | mestres + dono | `{ characterId, userId, name, username }` |
| `creature:created/updated/deleted` | mestres | `{ creature }` / `{ creatureId }` |
| `region:created/updated/deleted` | mestres | `{ region }` / `{ regionId }` |
| `locality:created/updated/deleted` | mestres | `{ locality }` / `{ localityId }` |
| `item:created/updated/deleted` | mesa | `{ item, changes? }` / `{ itemId }` (jogador recebe **sem preço**) |
| `presentation:shown/closed` | mesa | `{ presentation }` / `{ presentationId }` |
| `game:config` | mesa | `{ config }` |
| `combat:started/updated` | mestres + jogadores | payload **filtrado** |
| `combat:turn` | mesa | `{ combatId, combatantId, combatantName, ownerUserId, round, index }` |
| `combat:ended` | mesa | `{ combatId }` |
| `dice:rolled` | mesa | `{ kind, actorName, expression, rolls, sides, modifier, total, crit, at }` |
| `dice:roll` | mesa (pública) / autor (privada) / mestres (creation) | — |
| `dice:active` | mesa | `TableRollActivePayload` |
| `combat:attack` | mestres + jogadores | payload **filtrado** |

Os payloads de combate são **diferenciados por papel**, não por sala:
`emitCombat` envia ao mestre o DTO completo e aos jogadores
`hideCreatureStats(dto)` (hp/CA das **criaturas** viram `null` com
`statsHidden = true`; os **personagens** seguem totalmente visíveis).

---

## 13. Motor de regras D&D 5e

`src/modules/shared/` — **nada aqui acessa banco ou HTTP**: são funções puras,
reutilizadas pela ficha, pelo DTO e pelo combate, garantindo **uma única fonte
para cada conta**.

### 13.1 Atributos e geral (`dnd5e.ts`)

- `ABILITY_KEYS` = strength, dexterity, constitution, intelligence, wisdom,
  charisma.
- Limites: atributo **1..30**; nível **1..20**.
- Modificador: `floor((score − 10) / 2)`.
- Bônus de proficiência: `2 + floor((nível − 1) / 4)`, nível limitado a 1..20
  → +2 (1–4), +3 (5–8), +4 (9–12), +5 (13–16), +6 (17–20).
- XP para o próximo nível: tabela fixa do PHB (300, 900, 2.700, 6.500, 14.000,
  23.000, 34.000, 48.000, 64.000, 85.000, 100.000, 120.000, 140.000, 165.000,
  195.000, 225.000, 265.000, 305.000, 355.000); `null` no nível 20.
- Capacidade de carga: Força × 7,5 kg (variante métrica, 2 lb = 1 kg).
- Iniciativa: mod. de Destreza + `initiativeBonus`.
- Deslocamento padrão: 9 m.
- Percepção passiva: `10 + total de Percepção`.
- CD de magia: `8 + proficiência + mod. do atributo de conjuração`.
- Bônus de ataque mágico: `proficiência + mod. do atributo de conjuração`.
- Magias **preparadas**, POR CLASSE (`preparedSpellCountFor`):
  - completo/preparado (Clérigo SAB, Druida SAB, Mago INT): `max(1, mod + nível)`;
  - meio-conjurador preparado (Paladino CAR): `max(1, mod + floor(nível/2))` e
    **zero** antes do 2º nível;
  - conjuradores **conhecidos** (Bardo, Feiticeiro, Bruxo, Patrulheiro e os
    terço-conjuradores): `null` (usam a tabela de conhecidas).
  Exposto em `CharacterDto.classes[].spellcasting.preparedCount`. Não há total
  único no DTO — em multiclasse cada classe prepara as suas.

### 13.2 Perícias (18) e salvaguardas

`normalizeSkills` garante as 18 chaves com `{ proficient, expertise }`
booleanos; `normalizeSaves` garante os 6 atributos booleanos.
Total de uma perícia = `mod + (proficiente ? prof × (expertise ? 2 : 1) : 0)`.
Expertise só conta com proficiência. A Expertise em si é escolhida no Level
Up/criação (Ladino 1º/6º, Bardo 3º/10º) dentre o que o personagem JÁ domina,
gravada em `classState.choices` e espelhada em `skills[].expertise`; o DTO expõe
`expertiseSkills` (chaves de perícia e/ou `tool:<rótulo>` de ferramenta).

### 13.3 Classe de Armadura (`armor-class.ts`)

`armorClass` no banco é apenas o **override** do mestre (0/ausente =
automático). Peças lidas do **inventário equipado** (slot ≠ null):

- **Armadura:** categoria `Armadura` no slot `chest` com `armorType` e
  `baseArmorClass`. Leve: base + mod. DES inteiro; Média: base +
  `min(mod. DES, 2)`; Pesada: só a base.
- **Escudo:** qualquer item da categoria `Escudo` equipado soma
  `armorClassBonus`.
- **Bônus mágicos:** `armorClassBonus` dos demais itens equipados.

Sem armadura, vale a **maior** entre `10 + mod. DES` e as fórmulas de Defesa
sem Armadura das classes (não se acumulam): Bárbaro `10 + DES + CON` · Monge
`10 + DES + SAB` (exige nenhum escudo) · Feiticeiro (Linhagem Dracônica)
`13 + DES`. Depois somam-se escudo + bônus mágicos. Override substitui o
automático (`value = override ?? automatic`). O DTO expõe `armorClass`
(efetiva), `armorClassOverride` (null = automático) e `derived.armorClass`
com o detalhamento.

### 13.4 Pontos de vida

- Nível 1 (primeira classe): `max(1, dado de vida + mod. CON)`.
- Level Up: `ganho = max(1, dado rolado|média + mod. CON já atualizado pelo ASI
  do mesmo nível)`. Média = `floor(dado/2) + 1` (d6→4, d8→5, d10→6, d12→7).
- **Recálculo retroativo de CON:** sempre que o mod. de CON muda,
  `delta = (mod novo − mod antigo) × nível total ANTERIOR` entra no `hpMax` e no
  `hpCurrent` (ao reduzir, nunca negativo).
- O dado de vida é rolado **no servidor** (`crypto.randomInt`); o cliente só
  escolhe `roll` ou `average`.

### 13.5 Registro de classes (`classes/`)

12 classes: barbarian, bard, cleric, druid, fighter, monk, paladin, ranger,
rogue, sorcerer, warlock, wizard.

`ClassDefinition = { key, name, hitDie, savingThrows[2], subclassLevel,
spellcasting{type,ability,learning}, features[], subclasses[] }`;
`SpellcastingType` = none|full|half|third|pact; `SpellLearning` =
known|prepared|none.

**Nível de escolha de subclasse:** cleric 1 · sorcerer 1 · warlock 1 · druid 2 ·
wizard 2 · todas as outras 3.

**Subclasses cadastradas: TODAS as do PHB** — cleric (7 domínios), warlock (3
patronos), barbarian (2), bard (2), druid (2), fighter (3: Campeão, Mestre da
Batalha, Cavaleiro Arcano), monk (3), paladin (3), ranger (2), rogue (3),
sorcerer (2), wizard (8 escolas). Mestre da Batalha expõe as 16 manobras; o
Caçador declara as 4 escolhas do arquétipo (3/7/11/15); o Colégio da Bravura
concede `proficiencies`; o Cavaleiro Arcano declara conjuração de **terço**.

**Features:** `{ id, name, level, description, effect? | effects?, choice? }`.
Efeitos suportados (`ClassFeatureEffect.type`): `bonus`, `resource`, `save`,
`expertise`, `sneakAttack`, `toggle`, `resistance`, `speed`, `damageBonus`,
`critDice`, `unarmoredDefense`, `martialArts`, `wildShape`, `hpBonus`,
`abilityBonus`, `armorClass`, `saveBonus`, `halfProficiency`, `critThreshold`,
`other`. Recursos com contador aceitam: `max` fixo, `maxByLevel[]`, `perLevel`
(com multiplicador), soma do modificador de um atributo (`abilityMod`) e piso
(`min`).

**Escolhas de característica (`choice`):** `{ count, options[{key,name,
description,effect?}], level?, prompt?, allowRepeat?, apply? }`. O valor vive em
`classState.choices[featureId] = [chaves]` (JSONB, sem migração). Quem valida é
`resolveFeatureChoices` (quantidade, opção existente, sem repetir, só no nível
certo) — usada no Level Up e no passo 5 do assistente. `apply: 'skill'` faz as
chaves virarem proficiência (Colégio do Conhecimento: 3 perícias).

Features com escolha: Estilo de Luta (fighter nv 1, paladin/ranger nv 2),
Inimigo Favorito (ranger 1, +1 no 6 e 14), Explorador Nato (ranger 1, +1 no 6,
+2 no 10), Estilo de Luta Adicional (Campeão 10), Manobras (Mestre da Batalha 3,
+2 em 7/10/15), Estudante da Guerra, Proficiências Adicionais (Conhecimento 3) e
as 4 do Caçador. Só a opção Defesa tem efeito automático (+1 CA com armadura).

**Efeitos numéricos no derived:** `armorClass.classBonus` (só com armadura,
escudo não conta, nunca duas vezes entre classes) · `saveBonus` (somado a todas
as salvaguardas) · `halfProficiency` (metade da proficiência em testes sem
proficiência; `round` decide o arredondamento; dois efeitos no mesmo teste não
somam — vale o maior) · `critThreshold` (menor limiar prevalece).

**Perícias de classe (`CLASS_SKILL_CHOICES`):** barbarian 2, bard 3 (lista
vazia = qualquer uma das 18), cleric 2, druid 2, fighter 2, monk 2, paladin 2,
ranger 3, rogue 4, sorcerer 2, warlock 2, wizard 2.
`creationSkillChoice` soma as quantidades do multiclasse e faz a **união** das
listas.

**LACUNA:** `cleric` e `warlock` têm `features: []` (faltam Canalizar
Divindade/Destruir Mortos-Vivos/Intervenção Divina e Invocações Místicas/Dádiva
do Pacto/Arcanum Místico/Mestre Místico); o ladino não tem a Gíria de Ladrão.

### 13.6 Multiclasse (PHB cap. 6)

A ficha guarda `classes: [{ classKey, subclass, level }]`, no máximo **4**
entradas. O nível total é a soma.

**Pré-requisitos para ENTRAR numa classe (`MULTICLASS_MINIMUM = 13`):**
barbarian FOR · bard CAR · cleric SAB · druid SAB · fighter FOR **ou** DES ·
monk DES e SAB · paladin FOR e CAR · ranger DES e SAB · rogue DES · sorcerer CAR ·
warlock CAR · wizard INT.
`multiclassPrerequisiteLabel` devolve o texto citando **cada** classe que barra
(a regra exige 13 na classe nova **e** em todas as classes atuais). Classes que
o personagem já possui ficam sempre elegíveis.

**Proficiências:** `CLASS_PROFICIENCIES` tem `first` (conjunto completo do nível
1) e `multiclass` (conjunto reduzido, PHB p.164). **Multiclasse nunca concede
salvaguardas** — `lockedSaves` usa só a primeira classe (as de features tipo
`save` continuam valendo).

**Perícia de multiclasse:** entrar em Bardo (qualquer perícia), Patrulheiro ou
Ladino (da lista) concede **uma** perícia; o corpo do Level Up leva
`skillChoice`, validada no servidor.

**Features:** `getMulticlassFeatures` avalia **cada** classe no próprio nível e
concatena.

**Ajustes:** `computeMulticlassAdjustments` soma/combina por classe — toggles e
recursos deduplicados por id; meleeDamageBonus, speedBonus e hpBonus somam;
resistências unificam; critDice e martialArtsDie pegam o maior; Defesa sem
Armadura vira lista (maior valor); abilityBonuses somam; abilityCaps usam o teto
de menor valor; armorClassBonus/saveBonus pegam o **maior** (não somam entre
classes); halfProficiencyTargets unificam. Ataque Furtivo escala com o nível de
**ladino**: `max(1, ceil(level/2))` d6.

**Tabela de espaços (`spellSlotsForClasses`):**

- nenhuma classe conjuradora (ou só Bruxo) ⇒ sem espaços;
- **uma** classe conjuradora ⇒ a tabela da própria classe (`ownCasterLevel`):
  completo = nível cheio · meio = `CEIL(nível/2)` · terço = `CEIL(nível/3)`, e
  zero enquanto o meio-conjurador não chega ao 2º nível ou o terço ao 3º. Ex.:
  Paladino 3 = 3 de 1º; Patrulheiro 5 = 4 de 1º + 2 de 2º; Trapaceiro Arcano 4 =
  3 de 1º;
- **duas ou mais** conjuradoras ⇒ a tabela **combinada**
  (`multiclassCasterLevel`): full = nível cheio · half = `floor(nível/2)` ·
  third = `floor(nível/3)`; cap 20 (arredondamento para **baixo** é exclusivo
  desta tabela). Bruxo fica de fora: usa Magia de Pacto própria (1→1 de 1º;
  2→2 de 1º; 3–4→2 de 2º; 5–6→2 de 3º; 7–8→2 de 4º; 9–10→2 de 5º; 11–16→3 de
  5º; 17–20→4 de 5º).

**ASI/Talento (`asiLevelsFor`) — POR CLASSE:** fighter `[4,6,8,12,14,16,19]` ·
rogue `[4,8,10,12,16,19]` · demais `[4,8,12,16,19]`.
**Truque de subclasse:** a subclasse pode sobrescrever a conjuração da classe
(`effectiveSpellcasting`) — Trapaceiro/Cavaleiro Arcano são terço-conjuradores
mesmo sendo marciais.

### 13.7 Dados (`shared/dice.ts`)

- Sorteio com `crypto.randomInt` (**nunca** `Math.random`).
- Parser de expressão aceita `1d8`, `2d6+3`, `1d10 - 1` e valor fixo `4`.
  Limites: `1 ≤ quantidade ≤ 50`, `2 ≤ faces ≤ 1000`.
- **Crítico:** os dados são rolados **duas vezes** e o modificador entra **uma
  vez só**.
- Dano nunca é negativo (mínimo 0).

### 13.8 Estado de classe e ajustes derivados

`classState` = `{ active: string[], used: { [id]: number } }` — toggles ligados
e usos gastos. `ClassAdjustments` (calculado, nunca gravado): toggles,
resources, activeToggleIds, meleeDamageBonus, resistances, speedBonus,
critExtraDice, unarmoredDefense, martialArtsDie, hpBonus, wildShapeCr,
wildShapeFlying, abilityBonuses, abilityCaps.
`effectiveAbilitiesOf` aplica os `abilityBonuses` respeitando os caps — é o
valor usado em **todos** os cálculos derivados (CA, iniciativa, CD de magia); a
pontuação gravada continua sendo a base.

### 13.9 DTO derivado (`deriveStats` → `DerivedStats`)

`proficiencyBonus`, `modifiers` (6), `hitDie`, `lockedSaves[]`, `sneakAttack`,
`expertiseSlots`, `initiative`, `passivePerception`, `armorClass` (detalhado),
`carryingCapacity`, `totalWeight`, `saves[6]`, `skills[18]`,
`spellcasting{saveDC, attackBonus}`, `spellSlots[]`, `pactSlots`,
`xpForNextLevel`.
**Regra:** nada disso é gravado no banco; é recalculado em toda leitura.

### 13.10 Vários tipos de dano por ataque e por arma

Um ataque (da ficha ou de criatura) e uma arma do catálogo podem dar **mais de
um tipo** de dano, cada um com os seus dados — é o que permitirá, no futuro,
resolver cada parcela contra a resistência/imunidade do alvo.

Formato (o mesmo nos três lugares, `shared/attacks.ts`):

- `damage` = dano **principal** — inalterado, e o que o combate rola hoje;
- `extraDamages` = lista dos **adicionais**, cada um um `Damage` completo
  (`{ count, sides, bonus, type }`), teto `MAX_EXTRA_DAMAGES` (10).

Helpers: `attackDamages`, `damageIsEmpty`, `damagesExpression`,
`damageExpression` (só exibição).

**Regras atuais (deliberadamente parciais):**

- o combate resolve **apenas** `damage`; `extraDamages` **não** é somado nem
  resistido ainda;
- o ataque **derivado** da arma equipada copia os `extraDamages` da arma;
- nenhum tipo é proibido: repetir o mesmo tipo em dois danos é válido.

---

## 14. Semântica da ficha

### 14.1 Atomicidade e concorrência

Level Up roda dentro de `prisma.$transaction` com `updateMany` cujo `where`
inclui o `lastLevelUpRelease` **lido**. Se outra requisição já aplicou, nenhuma
linha casa (`count === 0`) ⇒ `409`. Todas as mutações incrementam `version`
(`{ increment: 1 }`), critério de ordenação de eventos no cliente.

### 14.2 PATCH da ficha — campos e validações

Escalares copiados direto (`SCALAR_KEYS`): `name`, `race`, `background`,
`alignment`, `experience`, 6 atributos, `hpCurrent`, `hpMax`, `hpTemp`,
`initiativeBonus`, `speed`, `avatarUrl`, `notes`.

Tratamento especial:

- **`level`** → sempre recusado (`400 "O nível do personagem só muda pelo Level
  Up."`);
- **`classes`** → §14.3;
- **`saves`** → as salvaguardas da **primeira** classe são forçadas a `true`;
- **`skills`** → substituição integral, normalizada para as 18 perícias;
- **`proficiencies`** → substituição integral normalizada
  (`{ armor, weapons, tools }`, só texto, sem repetição); **construção** — o
  jogador com a criação finalizada não altera (403);
- **`inventory`/`attacks`/`features`/`classState`** → substituição integral;
- **`spells`** → se vem do jogador e a criação está finalizada, aplica
  `mergeSpellUsage`: só `used` de cada nível é aceito (entre 0 e `max`); a
  **lista** e o **max** são preservados;
- **`armorClassOverride`** → grava `armorClass` (null ⇒ 0 = automático).

Regras embutidas: a primeira classe (ou troca dela no assistente no nível 1)
define o PV inicial pelo dado de vida máximo + mod. CON (salvo se o patch já
mandou `hpMax`) e grava as proficiências iniciais; mudança de CON dispara o
recálculo retroativo de PV; se `classes` esvaziar, `classState` zera.
Regra geral das coleções: o cliente envia o **estado completo** da seção (não há
merge profundo).

### 14.3 Resolução do patch de classes (`resolveClassPatch`)

- **Ficha sem classe:** aceita exatamente **uma** classe (entra no nível 1) e
  **exige** o pré-requisito de atributo — exceto no assistente
  (`skipPrerequisite`). Clérigo/Feiticeiro/Bruxo podem (e devem, no assistente)
  trazer subclasse no mesmo passo.
- **Ficha com classe:** a lista só pode **trocar a subclasse** de classes
  existentes, respeitando o nível de escolha; adicionar, remover ou mudar nível
  ⇒ `400` ("Para adicionar uma classe nova use o Level Up (multiclasse).").
- Substituição total só é permitida ao assistente (`allowReplace`), e apenas
  quando há **uma** classe no nível 1.

### 14.4 Evento `sheet:updated` — o mecanismo central do produto

Payload: `{ userId (dono), username, characterId, version, changes,
character (DTO COMPLETO já calculado), editedBy?, at }`. Destino:
`toMasters` + `toUser(dono)`.
`editedBy` **só** é preenchido quando quem editou **não** é o dono (o mestre).
O DTO completo é enviado para o painel apenas substituir o estado — o cliente
**não recalcula nada**.

### 14.5 Exclusão de personagem

`DELETE /api/characters/:id` verifica que a conta alvo **não** é MASTER (403).
Em transação: (1) `combatant.deleteMany` por `ownerUserId` **ou** `characterId`;
(2) `user.delete` (a ficha sai em cascata). Depois: apaga o avatar do disco,
limpa o estado de sessão (`clearActiveRollFrom`, `forgetRollsFrom`), publica
`character:deleted` para mestres e dono e, após 250 ms (`unref`),
`disconnectUser` derruba as conexões. Como `authenticate` confere a conta no
banco, o token remanescente passa a dar 401.

### 14.6 Inventário espelhado (`inventory-sync.ts`)

O inventário guarda **só** o que é do jogador: `itemId`, `quantity`, `slot`,
`backpackX/Y`, `id` local. Nome, descrição, peso, categoria, sprite e `details`
são **lidos do catálogo** ao montar o DTO (`syncInventory`). Efeito: corrigir um
item no catálogo atualiza **todas** as fichas que o possuem
(`republishSheetsWithCatalogItem`). Se o item saiu do catálogo, a cópia do
inventário é mantida.

**Slots (estilo Tibia, 9 posições):** `helmet, necklace, chest, ring1, ring2,
hand1, hand2, legs, boots`. `slot: null` = mochila. Limite de 300 itens.

### 14.7 Travas do jogador (`assertPlayerCanPatch`) — não valem para o mestre

- CA manual é **sempre 403** para o jogador (a CA dele é calculada).
- O **inventário** é **sempre 403** para o jogador, em **qualquer** fase: só
  muda por movimentação, uso de consumível e itens que o mestre envia. Remover
  item e mudar **quantidade** são do mestre.
- Com `creationFinalized = true`, o jogador só altera `PLAYER_STATE_KEYS`:
  `hpCurrent, hpTemp, notes, avatarUrl, classState, spells`. Qualquer outro
  campo ⇒ `403` com a lista legível dos campos bloqueados.
- As **moedas** também são do mestre por PATCH; o jogador gasta/troca/transfere
  pelos endpoints próprios.

### 14.8 DTO final (`toCharacterDto` / `toSheetDto`)

Inclui: identidade; `classes[]` (com hitDie, subclassLevel, subclassEligible,
subclassNames, asiLevels e `spellcasting` POR CLASSE); `classOptions[]` (12
classes com `eligible`, `missing`, `firstProficiencies`,
`multiclassProficiencies` e `multiclassSkillChoice`); `className`
("Bárbaro 3 / Ladino 2"); `activeFeatures[]`; `classState`; `levelHistory[]`;
`classAdjustments`; `creationFinalized`; `creationDraft`; `level`;
`lastLevelUpRelease`; atributos; vitais; `armorClass` + `armorClassOverride`;
coleções (incluindo `proficiencies`); `version`; timestamps; `derived`.

---

## 15. Level Up e downgrade de nível

### 15.1 Fluxo normal — `POST /api/characters/me/level-up`

Entrada (`levelUpSchema`): `{ classKey, subclass? (''), hp: 'roll'|'average',
skillChoice? (''), abilityIncreases?: [{ ability, amount }] (máx. 2),
feat?: { name, description } | null }`.

**Pré-condições:** (1) nível total < 20; (2) classe conhecida; (3) não está no
nível máximo; (4) se for classe NOVA, o pré-requisito deve passar nela **e** em
todas as classes atuais; (5) **a liberação da mesa**:
`character.lastLevelUpRelease < GameConfig.levelUpRelease` — senão `409 "Você
já usou esta liberação de Level Up."`.

**Aplicação (uma transação):**

- `newClassLevel` = nível atual + 1 (ou 1 se nova);
- PV do dado: `roll` → `crypto.randomInt(1, dado+1)`; `average` → média;
- subclasse: se a classe ainda não tem e `newClassLevel >= subclassLevel`,
  exige `subclass` (400 se faltar; 400 se não existir);
- proficiências: só ao **entrar** numa classe nova — merge do grant
  (multiclasse ou conjunto completo quando a ficha não tinha classe);
- perícia de multiclasse: se a classe nova concede perícia, `skillChoice` é
  **obrigatória** (400 vazia/fora da lista/já proficiente); mandá-la em outro
  caso ⇒ 400;
- ASI/Talento: se `isAsiLevel(classKey, newClassLevel)` — com `feat` empurra uma
  característica `{ id: 'feat-<uuid>', name, source: 'feat', description }`; sem
  `feat`, as `abilityIncreases` precisam somar **exatamente** 2 e nenhum
  atributo passa de 20 (400). Se **não** é nível de ASI e vier
  feat/abilityIncreases ⇒ 400;
- `hpGained = max(1, dado + mod. CON já atualizado)`; delta retroativo de CON
  sobre o nível total anterior; grava `hpMax` e `hpCurrent`;
- grava `lastLevelUpRelease = config.levelUpRelease` (consome a liberação);
- incrementa `version`; `updateMany` condicional.

Publica `sheet:updated`.

### 15.2 Liberação de Level Up

`POST /api/game/level-up` (mestre, **sem corpo**) → `levelUpRelease += 1`
**sempre** (incremento atômico).

- Cada clique é **uma** liberação nova: habilita o botão para todos que ainda
  não subiram naquela liberação.
- **Não existe** estado "bloqueado" e não é preciso bloquear antes de liberar de
  novo.
- Cada jogador sobe **um** nível por liberação.
- O DTO **não** tem mais `levelUpUnlocked`.

Cliente: `levelUpAvailable = lastLevelUpRelease < levelUpRelease`, com dica
textual conforme o caso.

### 15.3 Nível inicial da mesa (`startingLevel`)

`POST /api/game/starting-level { level: 1..20 }` (clamp no servidor). Vale para
as **próximas** criações: o passo 8 aplica os níveis 2..N. Não afeta fichas já
finalizadas e **não** consome a liberação do jogador (`consumeRelease: false`).

### 15.4 Level Up "de criação" (`levelUpDraft`)

Mesmo núcleo (`applyLevelUp`), com `consumeRelease: false`, exigindo
`creationFinalized === false` e nível total < `startingLevel`.

### 15.5 Histórico do nível

Todo nível ganho (normal ou de criação) grava **um** registro em
`characters.levelHistory`, no **mesmo** `updateMany`:

```
{ classKey, classLevel, totalLevel,
  hp: { rolled, die, gained, conDelta, total },
  abilityIncreases: [{ ability, amount }],
  feat: { id, name } | null,
  choices: { [featureId]: [opções] },
  subclass, skills: string[],
  proficiencies: { armor, weapons, tools } | null, at }
```

`hp.total` = dado (rolado/média) + mod. CON do momento + o delta **retroativo**
de CON que este nível provocou nos anteriores — exatamente o que foi somado em
`hpMax`/`hpCurrent`. Motivo: a rolagem de PV, o ASI/Talento e as escolhas não
existem em nenhum outro lugar da ficha; sem o registro não há como **reverter**
um nível. Lido com `normalizeLevelHistory` (tolerante; teto de 40 registros).

### 15.6 Downgrade — `POST /api/characters/:id/level-down` (mestre)

Entrada: `{ classKey, hpLost?, abilityDecreases?, removeFeatId? }`. O inverso do
Level Up.

**Pré-condições:** (1) a ficha existe (404) e **tem** a classe (400); (2) a
ficha **não pode ficar sem classe** — remover a última classe é 400 (para
desmontar, o mestre usa "reabrir criação").

**Reversão por classe:**

- `classes`: nível − 1; no nível 1 a entrada sai (com a subclasse);
- PV: subtrai o `hp.total` (piso 1 em hpMax, 0 em hpCurrent);
- ASI: subtrai os `abilityIncreases` (piso 1 por atributo); o talento sai de
  `features` pelo id `feat-<uuid>`;
- escolhas do nível saem de `classState.choices`; a subclasse escolhida naquele
  nível volta para `''`;
- perícias concedidas naquele nível voltam a `proficient: false`;
- proficiências: tira as do registro, mas **mantém** as que as classes restantes
  ainda concedem (`subtractProficiencies` com `classProficiencyGrant(next)`);
- salvaguardas: as da **primeira** classe; se a primeira sair, as antigas voltam
  a `false` e as da nova primeira são travadas;
- estado de runtime: sair a classe inteira limpa `active`/`used` dos ids dela;
- o registro do nível perdido sai do histórico.

**Níveis anteriores ao histórico:** sem registro, o PV é **estimado** pela média
e a resposta traz `warnings`; o mestre pode corrigir pelo corpo (`hpLost`,
`abilityDecreases`, `removeFeatId`).

Concorrência: `updateMany` com `version` no `where` — dois cliques não tiram
dois níveis.

Resposta: `{ character, levelDown }`; `levelDown` = `{ classKey, className,
previousClassLevel, classLevel (0 = removida), totalLevel, classRemoved,
hpLost, reverted: { abilities, feats, choices, subclass, skills,
proficiencies }, warnings[] }`. Publica `sheet:updated` com `editedBy`.
O que se recalcula sozinho (nada a reverter): espaços de magia, magia de pacto,
Ataque Furtivo, proficiência, CA, ataques derivados e as features por nível.

---

## 16. Assistente de criação (9 passos)

**Modelo de estado:** o rascunho **é** a própria linha de `Character` com
`creationFinalized = false`. O JSONB `creationDraft` guarda `{ mode, step,
rolls[], baseAbilities{}, skillPicks[], abilityChoices[] }`. Os campos da ficha
são gravados pelos mesmos caminhos da ficha comum. `step` guarda o passo
**alcançado** (o maior já visto) — a retomada nunca volta sozinha. Cada passo
concluído é persistido: fechar o navegador não perde nada.

| Passo | O que faz |
|-------|-----------|
| **1 — Tipo** | `mode` = `new` \| `existing` |
| **2 — Identidade** | `name` (mín. 2 caracteres), `alignment?`, `avatarUrl?` |
| **3 — Raça** | seleção do catálogo (14 linhagens); persiste `race` e os bônus. Raças com `abilityChoice` (Meio-Elfo: 2) são validadas contra `raceChoicePool`. Atributos sempre recalculados como base + bônus racial |
| **4 — Antecedente** | seleção (13 do PHB); aplica as perícias concedidas via `skillsPatch`, somadas às da classe sem consumir as escolhas dela |
| **5 — Classe** | `classKey` (+ `subclass` quando `subclassLevel <= 1`). Se a ficha já tem níveis, trocar de classe aqui é 400; o pré-requisito é conferido aqui se os atributos existirem e **sempre** no passo 6 |
| **6 — Atributos** | `new`: só distribuir **exatamente** os seis valores rolados. `existing`: 1..20 por atributo (fichas reabertas podem manter valores acima de 20 se forem os atuais). Confere o pré-requisito da primeira classe |
| **7 — Perícias** | valida contra `creationSkillChoice` (quantidade exata e pertencimento à lista) |
| **8 — Nível inicial** | sem campo próprio; aplica níveis via `POST /me/creation/level-up` até `nível total >= startingLevel` |
| **9 — Revisão** | `POST /me/creation/finalize` confere `missingForFinalize` e grava `creationFinalized = true` |

**Reabertura (mestre):** `reopenCreation` volta `creationFinalized` a `false` e
re-semeia o rascunho com modo `existing`, valores atuais e passo 1.
> A obrigatoriedade da subclasse no nível 1 vale **só no assistente**
> (`options.allowReplace`): o seletor legado de "primeira classe" da ficha
> permite preenchê-la depois, no campo da classe.

### Rolagem de atributo — `POST /me/creation/roll`

Rola **4d6 e descarta o menor** (`lowestIndex`), com o **mesmo** mecanismo da
janela de dados (`rollTableDice` com `kind: 'creation'`):

- **não** anuncia para a mesa (não publica `dice:active` nem `dice:roll` para a
  mesa);
- entra no histórico do mestre como `"[Personagem]: Criação de personagem:
  [valor] (d6 6 + d6 4 + d6 2 + d6 2)"`;
- fica guardada no rascunho (máximo 6; a 7ª ⇒ 409);
- `restart: true` recomeça a lista dos seis.

### Catálogos (`shared/creation.ts`)

**RACE_CATALOG — DERIVADO (Prompt 2.10)** do catálogo ESTRUTURADO (`shared/races/`):
**18 entradas** (9 raças + 9 sub-raças), com `raceId`/`subraceId`/`customRaceId` e as
`choices` que cada raça exige. O serviço acrescenta as **raças personalizadas** do
mestre (tabela `CustomRace`) à mesma lista. O passo 3 aplica bônus de atributo,
deslocamento, visão no escuro, resistências, idiomas e as proficiências de perícia/
ferramenta resolvidas pelas escolhas; os traços vão para a aba Características.

**Catálogo estruturado (`shared/races/`):** `types.ts` + `index.ts` + um arquivo por raça
(`dragonborn.ts`, `dwarf.ts`, `elf.ts`…) no padrão de `shared/classes/`. **Nove raças
cadastradas** (`RACES = [dragonborn, elf, dwarf, human, halfling, gnome, halfElf, halfOrc, tiefling]`): **Draconato** — For+2/Car+1, `speed` 9 m,
`size` Medium, `languages` [Comum, Dracônico] (informativo), 3 traços (`draconic-ancestry`
descritivo, `breath-weapon` como recurso 1 uso/recarga curta, `damage-resistance` via
`resistanceFromChoice` → `choiceId` 'draconic-ancestry') e `hasChoices` `draconic-ancestry`
com 10 opções (`{ id, label, damageType }`), sem sub-raças; **Elfo** — Des+2, `speed` 9 m,
`darkvision` 18 m, `languages` [Comum, Élfico], 3 traços (`keen-senses` via `skillProficiency`,
`fey-ancestry` como `other`, `trance` textual) e 3 sub-raças (Alto Elfo Int+1; Elfo da
Floresta Sab+1 com `speed` 10,5; Drow Car+1 com `darkvision` 36 e `drow-magic` descritivo);
**Anão** — Con+2, `speed` 7,5 m, `darkvision` 18 m, `description` (nota de que armadura pesada
não reduz o deslocamento), 4 traços (`dwarven-resilience` com `mechanicalEffects` = resistance
Veneno + `other`; `dwarven-combat-training`/`stonecunning` textuais; escolha
`dwarven-tool-proficiency`), `hasChoices` `dwarf-tool-proficiency` (smith/brewer/mason) e 2
sub-raças (Anão da Colina Sab+1 com `dwarven-toughness` = `hpBonus` +1/nível; Anão da Montanha
For+2 com treino de armadura textual); **Humano** — +1 em todos os seis atributos (`strength`…
`charisma`), `speed` 9 m, `languages` [Comum] com `bonusLanguageChoices` 1, `traits: []` e semsub-raças (Humano Variante NÃO cadastrado — depende de talentos mecânicos); **Halfling** — Des+2,
`speed` 7,5 m, `size` Small, sem visão no escuro, traços `lucky` (`luckyReroll`), `brave` (`other`)
e `halfling-nimbleness`, com as sub-raças Pés-Leves (Car+1) e Robusto (Con+1, `stout-resilience`
igual à Resiliência Anã). O `ClassFeatureEffect` ganhou os tipos `resistanceFromChoice`
(+ `choiceId`), `skillProficiency` (+ `target`) e `luckyReroll`, ainda **não processados** por
nenhum motor — **EXCETO** dois efeitos aplicados de verdade: a Robustez Anã (`hpBonus`; o mestre
grava `raceId`/`subraceId` pelo PATCH e o serviço aplica/REVERTE o +1×nível via
`raceHpBonus`/`raceHpBonusDelta`) e o Sortudo do Halfling (`luckyReroll`; a rolagem do pool marca
`lucky` no 1 natural — `hasLuckyReroll` resolve por `raceId` ou pelo texto `race`). O combate fica
de fora do Sortudo por ora. **Gnomo** (Int+2, Small, `gnome-cunning` via `saveAdvantage` — novo tipo
com `abilities`+`condition` —; sub-raças Gnomo da Floresta Des+1 e Gnomo das Rochas Con+1 com
`tinker` via novo `toolProficiency`), **Meio-Elfo** (Car+2; `fey-ancestry` REUSADO do Elfo; escolha
dupla como DUAS `RaceChoiceDefinition` para atributo e para perícia), **Meio-Orc** (For+2/Con+1;
`savage-attacks`/`relentless-endurance` como `other`+TODO; combate intocado) e **Tiefling**
(Car+2/Int+1; resistência a Fogo; legado descritivo). As magias raciais (truques do Alto Elfo/Gnomo
da Floresta/Tiefling, Magia Drow) ficam descritivas até o catálogo de magias existir.
`Race` (`abilityScoreIncrease[{ ability, amount }]` com `AbilityKey`, `speed` em METROS,
`size`/`darkvision` só preparação, `damageResistances` com os 13 tipos canônicos,
`languages`/`bonusLanguageChoices` informativos — não há campo de idioma na ficha,
`traits`, `subraces`, `hasChoices`), `RaceTrait` (`mechanicalEffect?` para um efeito e `mechanicalEffects?` para vários, ambos
reusando o MESMO `ClassFeatureEffect`) e `Subrace`. `Race` ganhou `description?`. Funções:
`getRace`, `getSubrace`, `allRaces`, `raceHpBonus`, `raceHpBonusDelta`, `hasLuckyReroll` e os
resolvedores do motor de raça (Prompt 2.10): `raceAbilityBonuses`, `raceSpeed`,
`raceDarkvision`, `raceDamageResistances`, `raceSkillProficiencies`, `raceToolProficiencies`,
`raceLanguages`, `raceTraits`, `raceChoiceDefinitions`. **Integração (2.10):** o wizard e o
compêndio leem o catálogo estruturado + as raças personalizadas do mestre (CRUD em
`/api/custom-races`); o passo 3 grava `raceId`/`subraceId`/`customRaceId`/`raceChoices` e
aplica os efeitos. A ficha ganhou, na migração `20261003025613_custom_races`,
`languages String[]`, `darkvision Int`, `raceResistances String[]` e a FK `customRaceId`
(ON DELETE SET NULL); `characters.speed` virou Float (7,5 m / 10,5 m). A coluna `race` de
texto livre foi abandonada — as fichas antigas com raça em texto livre foram apagadas.

**BACKGROUND_CATALOG — DERIVADO** do catálogo estruturado `src/modules/shared/backgrounds/`
(mesmo padrão de `shared/races/`: `types.ts` + `index.ts` + um arquivo por antecedente).
Os **13 do PHB 2014**, cada um com 2 perícias (acolyte, charlatan, criminal,
entertainer, folk-hero, guild-artisan, hermit, noble, outlander, sage, sailor,
soldier, urchin), ferramentas FIXAS e/ou **à escolha por categoria** (opções
resolvidas de `toolsByCategory`: instrumento musical, ferramenta de artesão, jogo),
idiomas à escolha e a característica narrativa. O passo 4 valida as escolhas e aplica:
ferramentas somam em `characters.toolProficiencies` (junto das da raça — derivado,
recalculado a cada passo), idiomas em `characters.languages` e a característica em
`characters.features` (`source: 'background'`). O equipamento inicial é só
`suggestedEquipment` (texto) — nunca entra no inventário. Sem migração nova: as
escolhas vivem no rascunho (`creationDraft`) e o resultado cai nos campos existentes.

---

## 17. Combate

**Invariante:** no máximo **um** combate ativo (PENDING_INITIATIVE ou ACTIVE).

### Início — `POST /api/combat` (mestre)

Corpo `{ localityId?, entries: [{ creatureId, quantity }] }` (até 100 entradas;
`quantity` 1..30; 0 é descartada).

- Entram **automaticamente** todos os personagens de jogador existentes (mesa
  única).
- As criaturas precisam ser `kind = 'CREATURE'` — NPCs são narrativos e **não**
  entram.
- Cada unidade gera um **combatente próprio**; com `quantity > 1` os nomes
  ganham sufixo ("Goblin 1", "Goblin 2") e cada cópia recebe um **snapshot** de
  `hpCurrent/hpMax/armorClass`.
- Personagens entram **sem** snapshot: a vida é lida ao vivo da ficha.
- `dexterityMod` é **fixado** na entrada.
- Status inicial PENDING_INITIATIVE; publica `combat:started` (mestre completo,
  jogadores com as estatísticas de criatura ocultadas).

### Iniciativa

`1d20 + dexterityMod`, sorteado no servidor. Sem `combatantId`, rola o
personagem do solicitante; com `combatantId`, só o mestre. Jogador só pode rolar
a própria (403). Rolar duas vezes ⇒ 409. Cada rolagem publica `dice:rolled`
(kind `initiative`). Quando **todos** têm iniciativa, o combate vira ACTIVE com
`currentIndex 0` e `round 1`, e o servidor emite `combat:updated` +
`combat:turn`.

### Ordem de turnos (`orderCombatants`)

`iniciativa DESC` → `dexterityMod DESC` → nome (A→Z). **Antes** de ACTIVE a
lista fica na ordem de criação. O turno atual é
`combatants[currentIndex]` do DTO já ordenado.

### Avançar turno — `POST /api/combat/next-turn` (mestre)

`currentIndex + 1`; passando do último, volta a 0 e `round += 1`. Publica
`combat:updated` + `combat:turn`.

### Ataque — `POST /api/combat/attack`

Só em combate ACTIVE. Atacante = `attackerCombatantId` (só mestre) ou o
personagem do solicitante. Jogador só ataca com o próprio combatente (403).
Alvo ≠ atacante. O ataque precisa existir na ficha/criatura
(`combatantAttacks`).

**Resolução (dados do servidor):**

1. CA do alvo: personagem → `characterArmorClass(...).value` (calculada!);
   criatura → snapshot `armorClass` (fallback `creature.armorClass`, senão 10).
2. `attackRoll = 1d20`; `attackTotal = attackRoll + attackBonus`;
   `critical = attackRoll >= LIMIAR` (20 por padrão, 19/18 com o Crítico
   Aprimorado/Superior do Campeão); `hit = critical OU (attackRoll ≠ 1 E
   attackTotal ≥ CA)`.
3. Publica `dice:rolled` (kind `attack`).
4. Se acertou, rola o **dano estruturado** (`attack.damage` =
   `{ count, sides, bonus, type }`). Dados dobrados no crítico, modificador uma
   vez, mínimo 0. Soma quando aplicável:
   - **dados extras de crítico** (`critExtraDice`, ex.: Crítico Brutal) — só
     corpo a corpo;
   - **bônus de dano corpo a corpo** enquanto o toggle exigido está ativo
     (ex.: Fúria) — não vale para arma à distância (`ranged`);
   - **Ataque Furtivo** — exige o atacante ser personagem com a feature (pelo
     nível de ladino) **e** a arma ser `finesse` ou `ranged`. As condições
     **táticas** (vantagem/aliado adjacente) **não** são rastreadas: o jogador
     decide quando rolar. Cada parcela extra publica seu próprio `dice:rolled`.
5. **Resistência** do alvo (personagem com o tipo estruturado
   `attack.damage.type` em `resistances`) ⇒ dano `/ 2` (`floor`). `type: null`
   **não** aciona resistência.
6. **Munição** (só personagens): quando o ataque tem `inventoryItemId`, a arma
   precisa estar **equipada** numa das mãos (senão 409). Se declara a
   propriedade `ammunition`, 1 unidade do `ammoType` é gasta de uma pilha da
   categoria `Munição` **antes** de rolar (sem munição ⇒ 409 e nada é rolado).
   O `attackBonus`/`damageBonus` da munição somam ao ataque e ao dano; a pilha
   que chega a 0 sai do inventário. A escolha da pilha prefere a sem bônus
   mágico e depois a de menor bônus. O gasto usa `updateMany` condicionado à
   `version` (com releitura e nova tentativa) e publica `sheet:updated` para o
   dono e os mestres. Criaturas nunca consomem.
7. `changeHp(alvo, −total)` e publica `combat:updated`.

**Dano estruturado x legado:** quando a migração não converteu a expressão
antiga com segurança, o ataque guarda `legacy: true` + `damageText` (o mestre
revisa pela ficha).

**Resultado (`AttackResolvedPayload`) diferenciado por papel:** mestre vê CA,
hp do alvo, tudo; jogadores, quando o alvo é **criatura**, recebem
`targetArmorClass`/`targetHpCurrent`/`targetHpMax = null` com
`targetStatsHidden: true`.

### Dano e cura (`changeHp`) — caminho único

- **Personagem:** dano consome **primeiro** os PV temporários; só o excedente
  chega ao `hpCurrent`. Cura não mexe nos temporários. `hpCurrent` limitado
  entre 0 e `hpMax`; incrementa `version`. Publica `sheet:updated`.
- **Criatura:** mexe só no snapshot do combatente (o bestiário não é alterado).
- Retorna `null` se a origem desapareceu.

`POST /api/combat/hp` (mestre) = ajuste manual. `POST /api/combat/end` (mestre) =
status ENDED + `endedAt`; publica `combat:ended`.

### Visibilidade (`hideCreatureStats`)

Só as **criaturas** têm hp/CA ocultos; personagens de jogador são visíveis para
toda a mesa.

---

## 18. Janela de dados e apresentação de imagens

### Janela de dados (`dice`)

Um único `activeRoll` em memória (quem está rolando) e histórico de até **100**
rolagens. O tabuleiro anunciado (`RollBoardDto`) = `{ pool[{sides,locked}],
advantage, disadvantage, bonus, phase }`.

- O cliente **nunca** rola: manda a composição do pool e o **servidor** sorteia.
- Vantagem/desvantagem valem **só para d20**: dois d20 são rolados e o que não
  vale é marcado `dropped`. Se vierem as duas, o servidor ignora as duas.
- **Anúncio de queda:** `rollTableDice` marca `phase: 'tumbling'` **antes** de
  sortear e publica `dice:active`; com uma requisição só, a ordem (queda →
  resultado) fica garantida.
- `lastRoll` fica no tabuleiro anunciado — quem recarrega no meio vê o **mesmo**
  total.
- Roteamento da publicação: privada (só mestre) ⇒ `toUser(autor)`;
  `kind: 'creation'` ⇒ só `toMasters`; qualquer outra ⇒ `toTable`.
- Uso de item (`rollItemEffect`, `kind: 'item'`): rola o `effectRoll` sem aviso
  de queda.
- **Privacidade:** `isPrivate = Boolean(private) && role === 'MASTER'` —
  rolagem de jogador é sempre pública.
- O nome de quem rolou vem da **ficha** (fallback `displayName`).
- Ao desconectar a última aba, a faixa é removida da mesa.
- **Histórico do mestre (cliente):** cada linha é `"[Personagem]: [Perícia]:
  [total]"` seguida da depuração entre parênteses, montada no **cliente** a
  partir do próprio `DiceRollDto`.
  Ex.: `Umbrae: Percepção: 10 (d20 6 + 4 perícia)`.
- **Duas portas para o mesmo log:** (a) dentro da bandeja, abaixo dos dados;
  (b) painel flutuante `RollLogPanel`, aberto pelo botão `Log` **acima** do
  botão `Dados`. A lista é a mesma (`RollLogList` + `historyLine`/`rollDebug`).
- **Pilha flutuante** (canto inferior esquerdo), de baixo para cima:
  base `Inventário` (`InventoryDock`) · `Dados` · `Anotações` (mestre) · `Log`
  (mestre). O passo é fixo; os painéis abrem **um por vez**. O `Inventário`
  está sempre presente (jogador e mestre): painel `.inv-panel` à esquerda com o
  set de equipamento; a mochila só entra pelo ícone dela no set, logo abaixo do
  grid, e as moedas ficam dentro da mochila (ícone colorido por denominação).

### Apresentação de imagens (`presentation`)

Estado único em memória `current`. O mestre mostra uma imagem para a mesa
inteira (`presentation:shown`), fecha para todos (`presentation:closed`,
idempotente), e quem conectar no meio recebe a apresentação ativa no handshake.
`presentedBy` vem do token.

---

## 19. Armazém de conteúdo do mestre

### Criaturas e NPCs (`creatures`)

Mesmos campos; separados por `kind` (CREATURE | NPC). Toda criatura exige ao
menos **uma** localidade. `derived.modifiers` traz os 6 modificadores. Ataques,
resistências e imunidades são JSONB validados (resistências/imunidades restritas
aos 13 tipos canônicos: Cortante, Perfurante, Concussão, Ácido, Frio, Fogo,
Elétrico, Necrótico, Veneno, Psíquico, Radiante, Trovão, Força). Todo CRUD
publica o evento correspondente. **O bestiário é invisível para jogadores**
(403 em todo o roteador).

### Regiões e localidades

Hierarquia Região → Localidade (Localidade tem `regionId` obrigatório; apagar a
região apaga as localidades em cascata). As duas têm descrição, imagens próprias
(`[{ url, name }]` em `/uploads`) e a região tem `notes`. Ambas são invisíveis
para jogadores. A localidade liga criaturas (N:N) e combate (localidade
opcional).

### Catálogo de itens

**Categorias:** Arma, Armadura, Escudo, Poção, Anel, Cajado, Item Geral,
Tesouro, Outro, **Munição**.

`sanitizeItemDetails(category, details)` mantém **só** os campos que a categoria
usa:

- **Arma** (damageCount, damageDie, damageType, extraDamages, attackBonus,
  damageBonus, weaponType, weaponCategory, properties, versatileDie,
  rangeNormal, rangeLong);
- **Cajado** (idem + spellcastingFocus);
- **Armadura** (armorType, baseArmorClass, armorClassBonus);
- **Escudo** (armorClassBonus);
- **Poção** (effectRoll, duration, potionCategory, healingDice);
- **Anel** (effectRoll);
- demais: nenhum.

**Perfil de arma (Arma/Cajado):** `WEAPON_TYPES` melee|ranged (padrão melee);
`WEAPON_CATEGORIES` simple|martial (padrão simple); `WEAPON_PROPERTIES` (light,
finesse, heavy, two-handed, versatile, thrown, reach, ammunition, loading,
special); `versatileDie`; `rangeNormal/rangeLong` em **metros** (corpo a corpo
1,5 m; 3 m com reach).

**Coerência (superRefine + sanitize):** `ammunition` só em ranged e exige
`ammoType`; `versatile` exige `versatileDie` e não combina com `two-handed`;
`thrown` e `ranged` exigem os dois alcances. Dado incoerente ⇒ 400 (ou `{}` no
sanitize, sem gravar pela metade).

**Raridade e sintonização (propriedade do ITEM, não da categoria):**
`ITEM_RARITIES` = common | uncommon | rare | very_rare | legendary | artifact
(valores internos; rótulos PT — Comum, Incomum, Raro, Muito Raro, Lendário,
Artefato — no cliente). `rarity` fica `null` quando o item não é classificado.
`requiresAttunement` é um booleano **manual** (sem regra automática ligando
raridade e sintonização). Ambos são gravados no item e **espelhados** no
inventário do jogador (`CatalogSnapshot`/`syncInventory` → `InventoryItemDto`).
A antiga chave `details.attunement` (só Anel) foi incorporada a este campo.

**Categoria da Poção:** só a categoria **Poção** tem `potionCategory`, um
`select` de **uma** finalidade (opcional e sempre manual) dentro de "Atributos
— Poção". `POTION_CATEGORIES` = healing | enhancement | protection | mobility |
stealth | exploration | poison | longevity (rótulos PT em `POTION_CATEGORY_LABELS`
no cliente: Cura, Atributos e aprimoramento, Resistência e proteção, Mobilidade,
Furtividade e percepção, Sobrevivência e exploração, Veneno, Longevidade). Vive
no JSONB `details` (sem coluna/migração); poção antiga sem categoria segue
válida e o `sanitizeItemDetails` descarta o campo em qualquer outra categoria.
Exibida no modal de detalhes junto de efeito, duração, raridade e sintonização.

**Cura estruturada (Poção de Cura):** a poção com `potionCategory === 'healing'`
troca a rolagem de texto livre por `details.healingDice` = `{ count 1..10,
 sides 4|6|8|10|12, bonus 0..20 }` (fora disso, 400). O `sanitizeItemDetails`
 descarta `healingDice` quando a finalidade não é Cura; no editor, Cura oculta
 *Rolagem do efeito* e mostra **Dado/Quantidade/Bônus** (as demais finalidades
 seguem com `effectRoll`/`duration`). No uso (`POST /me/inventory/use`), uma
 Poção de Cura com `healingDice` rola `count×dado + bonus` com o rolador do
 servidor e aplica `hpCurrent = min(hpMax, hpCurrent + total)` na **mesma**
 escrita que desconta a unidade, publica `sheet:updated` e registra no log como
 `kind: 'item'` (label `Cura (<nome>)`, detalhe dado a dado). Poção não de Cura
 (ou de Cura sem `healingDice`) mantém o comportamento antigo. Ver §Fase 5 para
 o custo de Ação (ainda não implementado).

**Munição:** `AMMO_TYPES` Flecha | Virote | Bala de funda | Agulha de
zarabatana; a categoria `Munição` usa `ammoType`, `attackBonus` e `damageBonus`
(munição mágica +1/+2/+3).

**ARMOR_TYPES:** Leve | Média | Pesada (usado no cálculo de CA).

**Preço** é informação **exclusiva do mestre**: o DTO de jogador sai sem ele; o
item entregue nunca leva o preço. O catálogo é legível por qualquer
autenticado; criar/editar/remover/enviar é do mestre.

### Compêndio (somente leitura)

`GET /api/compendium` alimenta a aba "Mesa" junto do nível inicial. Fonte única:
`getCompendium()`.
- `classes`: key, name, hitDie, savingThrows[2], subclassLevel,
  spellcasting{type,ability,learning}, features[], subclasses[];
- `races`: key, name, baseRace, description, abilityBonuses, abilityChoice;
- `backgrounds`: key, name, description, skills[2];
- `spells`: estrutura definida, **lista vazia** (LACUNA).

### Uploads / armazenamento de arquivos

Imagens chegam como **data URL** (base64) dentro do JSON. Formatos: PNG, JPEG,
WEBP, GIF. Máximo **5 MB já decodificados**. Nome = UUID com a extensão do mime.
Pastas: `localities`, `creatures`, `characters`, `items` (desconhecido ⇒
localities). URL pública `/uploads/<pasta>/<uuid>.<ext>` (maxAge 7d, immutable).
Remoção é best-effort e **nunca** sai da pasta de uploads (proteção contra `..`).
No **cliente**, antes de enviar, a imagem é redimensionada para no máximo
**1600 px** no maior lado (canvas) e recomprimida (JPEG 0.85; PNG/GIF mantêm
transparência).

---

## 20. Cliente React

### 20.1 Composição

`main.tsx` → `initTheme()` (aplica `data-theme` antes do primeiro render;
`index.html` evita o flash) → `unlockAudioOnFirstGesture()` → `<App/>`.
`App.tsx`: `<AuthProvider>{loading ? splash : user ? (role === 'MASTER' ?
<MasterPanel/> : <SheetPage/>) : <AuthPage/>}</AuthProvider>` embrulhado por
`<LightboxProvider>`.

**Não há roteador de URL:** a "navegação" é por papel do usuário e por estado
interno (abas do painel, passos do wizard, modais).

### 20.2 Sessão e transporte

- `api.ts`: wrapper de `fetch` com `Content-Type: application/json` e
  `Authorization: Bearer <token>` (token em `localStorage`, chave
  `'grimorio.token'`). Erros viram `ApiError` com `status`; `describeError`
  traduz `message`/`issues` (Zod) em texto legível.
- `auth.tsx`: ao abrir, se há token, chama `GET /api/auth/me`; falha ⇒ descarta
  o token.
- `socket.ts`: `io({ auth: { token }, transports: ['websocket','polling'] })`
  **sem URL** — em dev o Vite faz proxy de `/api` e `/socket.io` para
  `127.0.0.1:3000`; em produção tudo é mesma origem.
- `useRealtime.ts`: cria o socket uma vez e assina **todos** os eventos; os
  handlers vivem numa ref, então trocar de handler **não** reconecta. Devolve
  `{ connection, online, lastEventAt }`.

### 20.3 Páginas

**`SheetPage` (jogador)**

- Carrega a própria ficha, a configuração da mesa e os itens; assina o tempo
  real.
- `needsWizard = !loading && (!character || !character.creationFinalized)` ⇒
  renderiza o cabeçalho do app + `CreationWizard` em `.creation-shell` (a
  criação **não** esconde o cabeçalho: tema, som e presença continuam
  acessíveis).
- Com a ficha pronta, exibe `SheetView`.
- Level Up: `levelUpAvailable = lastLevelUpRelease < levelUpRelease`, com dica
  conforme o caso; o `LevelUpDialog` **abre na classe principal** (a lista com as
  classes atuais e as novas só aparece pelo botão **"multiclasse"** do cabeçalho,
  à direita, ao lado do **X** que fecha — **Esc** fecha também) e conduz
  subclasse quando liberada, PV (rolar/média) e ASI ou Talento. Confirmado, a
  janela **não** fecha: troca o formulário pelo **resumo** do que foi escolhido e
  das características (com a descrição do livro) e PV que o nível trouxe.

**`MasterPanel` (mestre)**

- Abas: **Fichas · Criaturas · NPCs · Regiões · Itens · Mesa**. Em modo de
  combate o painel dá lugar ao `CombatTracker`.
- Na barra de abas: botão **"LIBERAR LEVEL UP"** (com contador) e **"COMBATE"**.
- Aba "Mesa" = nível inicial + compêndio (somente leitura).
- Aba "Itens" tem, **acima** da lista, o painel **"Entregar moedas"**
  (`CoinsGrantPanel`): escolhe o jogador, aceita valor por denominação (positivo
  dá, negativo retira), mostra o saldo atual → depois e usa
  `POST /api/characters/:id/coins`.
- Carga inicial em um `Promise.all`: characters, creatures, regions, localities,
  items, combate ativo, configuração.
- Mutações são **otimistas** (a tela muda na hora; em erro, recarrega).
- Mantém `characters` sincronizado por `sheet:updated` (aceita a versão mais
  nova por `version`); `character:deleted` remove da lista e refresca o combate.

### 20.4 Seções da ficha (`components/sections`)

Personagem (Identity), AbilityCards, Attacks, Features, Spells, Inventory,
Notes, BagList. A ficha é uma **pilha** de seções de ponta a ponta: Personagem
(que já traz Classes e Vida e Defesa), os seis atributos, o inventário e as
abas.

- **Identidade (IdentitySection) — cabeçalho novo:** o card do Personagem perde
  o próprio cabeçalho e o **retrato** (`.identity-section .hero-avatar`) é
  **absoluto em relação ao card** e **foto crua** — sem fundo, borda, canto
  arredondado, padding, sombra ou `filter` (o aro ornamentado já vem no arquivo) —,
  com o **centro no canto superior esquerdo do card** (meia foto para fora em cima
  e à esquerda; o quanto sai à esquerda para na borda da tela, sem desalinhar o
  card). O cabeçalho é uma **grade de áreas** (`photo`/`ribbon`/`level`/
  `fields`/`inspiration`). À direita: a **bandeirola** do nome/raça
  (`.identity-ribbon` > `.identity-ribbon-inner`) **nasce de trás do retrato**
  (ponta esquerda escondida sob a foto, `z-index` menor), com fio dourado de 1px
  e a **ponta direita recortada em V** (`clip-path`); a largura acompanha o
  tamanho do **nome** (`width: max-content`) e o centro dela fica na mesma altura
  do centro da foto. **Nome** em caixa alta dourado e **Raça** abaixo, à
  esquerda. Sob ela, a **linha de campos de papel**
  (`.identity-line-fields`, quatro colunas) com **Classe**, **Subclasse**,
  **Antecedente** e **Alinhamento** — valor centralizado em cima, linha fina e
  rótulo em caixa alta embaixo (com o "(i)" do `FieldInfo`). Cada campo tem DOIS
  tooltips: o "(i)" explica o conceito, em geral, e o **valor** abre um popup
  (mesmo visual do "(i)") com o que **aquele** item escolhido é — a descrição da
  classe/subclasse vinda do compêndio (`fetchCompendium`), a do antecedente com
  as perícias que ele concede e a frase do alinhamento. Com multiclasse, o campo
  Classe mostra "Multiclasse" (o popup lista cada classe) e o campo Subclasse
  mostra "Multiclasse" quando duas ou mais já foram escolhidas — e o popup
  explica cada subclasse; o detalhe do nível continua no hover do nível. O **Nível** fica na MESMA linha da
  grade que os campos: a **borda esquerda do círculo encosta na borda direita do
  retrato** e o **centro dele cai sobre a linha** que divide valor e rótulo (com
  um ajuste fino, `--level-line-nudge`). O círculo **é o botão de Level Up**:
  discreto por padrão e dourado quando o mestre libera; a fita "NÍVEL" sai de
  trás dele, na lateral direita. A **Inspiração** (estrela vazia/preenchida; só o visual — a mecânica
  virá do mestre). O bloco de **Conjuração** vive na seção Magias.
- **Vida e Defesa embutida:** `VitalsSection` aceita `embedded`; nesse modo
  perde a moldura de card e o cabeçalho some (o rótulo "Vida" vive no próprio
  bloco). A vida é uma faixa baixa (ícone + "Vida" + `27 / 27` grande + barra
  verde em largura total) e abaixo vem **uma linha com seis cards iguais**: CA,
  iniciativa, deslocamento, percepção passiva, **dado de vida** e **bônus de
  proficiência** (a carga saiu daqui — vive no inventário; o PV temporário segue
  na mecânica, sem campo próprio).
- **Atributos em cards (AbilityCardsSection):** uma fileira de seis cards na
  ordem do PHB (FOR, DES, CON, INT, SAB, CAR). Cada card: faixa com a sigla e o
  "i" **ao lado dela**; selo hexagonal com o valor e o modificador, nas **mesmas
  cores da bandeirola do nome** (vinho escuro + fio dourado); linha da
  salvaguarda (caixa de proficiência + bônus + rolagem); as perícias daquele
  atributo (FOR 1, DES 3, CON 0, INT 5, SAB 5, CAR 4). Salvaguarda e perícias
  usam a **mesma grade fixa** `[caixa 1rem] [bônus 1.7rem] [nome 1fr] [dado
  1.35rem]` e abrem um **resumo no hover** (o que a perícia/salvaguarda serve,
  de `SKILLS[].description` e `SAVE_DESCRIPTIONS`). O nome nunca quebra
  (container query + ellipsis). A caixa de proficiência da salvaguarda segue a
  **mesma lógica da perícia**: desabilitada só para o player, o mestre a marca à
  mão (o servidor reaplica as fixas da classe). A caixa é o **checkbox quadrado
  padrão** da ficha e a **Expertise** (Ladino 1º/6º, Bardo 3º/10º) é escolhida
  no Level Up/criação entre o que o personagem JÁ domina (perícias ou
  ferramentas), marcada por uma **coroa de louros** ao lado do NOME da perícia
  (tooltip de fundo sólido) e com a proficiência travada. Clicar no número rola
  um teste puro do atributo; o modificador também rola.
- **`readonly.tsx`:** modo somente leitura usado quando o mestre visualiza a
  ficha de um jogador.
- Layout de perícias/salvaguardas e inventário espelha exatamente os DTOs do
  servidor: **o cliente não recalcula nenhuma regra** — exibe `derived`.

### 20.5 Dados visuais / som

- `Icon.tsx`: ícones SVG desenhados à mão, todos com `currentColor` (sword,
  shield, heart, flask, scroll, star, book, quill, die, crown, sun, moon,
  volume, mute, users, eye, bolt, wind, weight, plus, x, sparkle, flame, dragon,
  bag, helmet, necklace, armor, ring, legs, boots, ammo, trash, info, gear,
  table).
- `theme.ts`: alterna/persiste o tema claro/escuro.
- `sound.ts`: efeitos sintetizados (dados, crítico, turno).
- `dice/`: `DiceDock` (janela de dados), `Die3D` + `polyhedra` (geometria 3D),
  `RemoteRollBoard` (tabuleiro que a mesa assiste), `useDiceRoller` (estado e
  chamadas).

---

## 21. Testes e verificação

### Smoke test (`src/scripts/smoke-realtime.ts` — ~8.340 linhas)

Executa contra um servidor **rodando** (`npm run smoke`; base configurável por
`SMOKE_BASE_URL`). Cria contas com sufixo único, exercita a API e o WebSocket de
ponta a ponta e **limpa tudo** no final (`cleanup()`), saindo com código 0 ou 1
(`failures === 0`). Usa `prisma` direto para preparar cenários que a API não
permite (ex.: `setCharacterClasses`, porque o nível de classe só muda pelo Level
Up).

Cobertura (seções 1 a 29, com as subseções 8.5, 11.5–11.11):

1. Cadastro e papéis · 2. Login e autorização · 3. WebSocket autenticado ·
4. Ficha e regras D&D 5e · 5. Permissões das fichas · 6. **Crítico: tempo
real** · 7. Criaturas/NPCs · 8. Combate · 8.5. Multiclasse · 9. Itens, ícones e
avatar · 10. Apresentação de imagens · 11. Mestre edita a ficha · 11.5. Level Up
liberado · 11.5b. Anotações do mestre · 11.6. Compêndio · 11.7. Level Up
(assistente) · 11.8. Fim da criação/CA/talentos · 11.9. Rolagem de dados ·
11.10. Faixa de rolagem · 11.11. Assistente de criação · 12. Presença ao
desconectar · 13. Exclusão de personagem.

Depois, a "FASE 0" (regressão das regras base):

14. PV e CA automáticos · 15. Multiclasse · 16. Magias preparadas · 17. Espaços
de magia · 18. Features e escolhas · 19. Subclasses 1 → 20 · 20. Moedas ·
21. Inventário · 22. Dano estruturado · 23. Cadastro de arma/preço ·
24. Munição · 25. Moedas (complemento) · 26. Inventário (complemento) ·
27. Ataque derivado da arma · 28. Downgrade de nível · 29. Vários tipos de dano.

**Limite operacional:** o smoke cria ~14 contas e faz ~27 chamadas a
`/api/auth/*` por execução. Em produção o limiter do login é 30/15 min, então as
seções novas **reaproveitam** fichas já criadas. **Armadilha:** o rate limiter é
em memória — duas execuções seguidas podem devolver 429; reiniciar o serviço
zera o contador.

### Verificação padrão (ordem usada no projeto)

1. `npm run typecheck` (servidor)
2. `npm --prefix client run typecheck`
3. `npm run build` (**obrigatório** antes de reiniciar em produção)
4. `npm --prefix client run build`
5. `sudo systemctl restart grimorio && sleep 3 && node -e "fetch('http://localhost:3000/').then(r=>console.log('http',r.status))"`
6. `npm run smoke` (espera `"✅ Todos os testes passaram."`)

**Não há testes unitários** no repositório: a suíte é o smoke ponta a ponta.
**LACUNA:** não há validação visual automatizada (exige navegador).

---

## 22. Invariantes que não podem ser quebradas

1. Toda escrita de domínio é HTTP; o WebSocket só notifica.
2. Toda escrita de ficha incrementa `version`.
3. O nível do personagem **nunca** é editável por PATCH: é soma de
   `classes[].level` e só sobe pelo Level Up (ou pelo assistente, passo 8).
4. `armorClass` no banco é só o override do mestre (0 = automático). O jogador
   nunca grava CA (403).
5. As salvaguardas das classes são **fixas** e forçadas a `true` em toda leitura
   — **só as da primeira classe**: multiclasse nunca concede salvaguardas.
5b. `proficiencies` é construção: entra com a primeira classe e na entrada por
   multiclasse; o jogador com a criação finalizada recebe 403. Nada da CA/ataque
   é derivado dela ainda.
5c. Entrar numa classe nova exige 13 nos atributos exigidos por ela **e** por
   todas as classes atuais; a classe que já se possui não exige nada.
6. O ator/identidade nunca vem do corpo da requisição, sempre do token.
7. `authenticate` confere a conta no banco em toda requisição.
8. No máximo um combate em PENDING_INITIATIVE ou ACTIVE.
9. O HP de personagem nunca é duplicado no combatente (lido ao vivo); o de
   criatura é snapshot do combatente.
10. Os dados (atributos, iniciativa, PV, dano, ataques) são sorteados no
    **servidor** com `crypto.randomInt`.
11. Crítico: dados dobrados, modificador uma vez.
12. Numa liberação de Level Up, cada jogador sobe no máximo **um** nível.
13. Com `creationFinalized = true`, o jogador só altera `PLAYER_STATE_KEYS`
    (`hpCurrent, hpTemp, notes, avatarUrl, classState, spells`). O mestre altera
    tudo.
14. Excluir um personagem exclui a **conta** do jogador; a conta de MASTER nunca.
15. O inventário espelha o catálogo; o preço é exclusivo do mestre.
16. CA/HP de criaturas nunca vão para o payload de jogador; CA/HP de personagens
    são visíveis para a mesa.

---

## 23. Lacunas conhecidas e pontos de extensão

- **[LACUNA] Características de clérigo e bruxo:** ambos têm `features: []` (só
  as subclasses). Faltam Canalizar Divindade, Destruir Mortos-Vivos, Intervenção
  Divina (clérigo) e Invocações Místicas, Dádiva do Pacto, Arcanum Místico e
  Mestre Místico (bruxo). O ladino não tem a Gíria de Ladrão (texto puro).
- **[LACUNA/Fase 5] Companheiro Animal do Senhor das Feras:** as quatro
  características estão cadastradas como texto, mas a ficha do companheiro (PV,
  CA, ataques e PV gastos saindo dos seus) fica para depois.
- **[LACUNA/Fase 4 e 5] Magias de Juramento do Paladino:** os nomes entram como
  texto na característica do nível (3/5/9/13/17), sempre preparadas e fora do
  limite — o catálogo de magias é quem vai vinculá-las.
- **[LACUNA/Fase 5] Efeito em combate das escolhas/features novas:** Estilos de
  Luta (exceto Defesa), gasto de Surto de Ação/Retomar o Fôlego/Indomável,
  Destruição Divina, Canção de Descanso, Contra-encanto, Segredos Mágicos, as
  auras nos aliados, as manobras do Mestre da Batalha e o dado das inspirações
  são texto. O contador de usos funciona; o efeito na mesa ainda não. O **reset
  por descanso** dos recursos ainda não existe (cada recurso só guarda o tipo).
- **[LACUNA] Catálogo de magias:** `CompendiumSpellDto` está definido e a aba
  "Mesa" tem a seção, mas `SPELL_CATALOG` é `[]`. Magias hoje são apenas estado
  por ficha (`spells = { list, slots }`), sem catálogo central.
- **[LACUNA] Raças e antecedentes:** o Prompt 2.10 fechou a raça pelo assistente
  (atributos, deslocamento, visão no escuro, resistências, idiomas e proficiências
  de perícia/ferramenta por escolha), mas seguem sem tratamento: proficiência de
  arma/armadura por raça, magias raciais (catálogo de magias inexistente),
  escalonamento por nível de personagem, vantagem em salvaguarda (`saveAdvantage`),
  resistências condicionais e os efeitos `other` (Ataques Selvagens, Resistência
  Implacável, Sensibilidade à Luz Solar). Do ANTECEDENTE, só as 2 perícias entram.
  O **idioma à escolha** das raças (Humano e Meio-Elfo) já funciona: catálogo em
  `shared/languages.ts`, escolhido no passo 3 e exibido na ficha.
- **[LACUNA/Fase 2] Proficiências de armadura:** registradas e usadas no bônus
  de ataque das armas, mas o efeito nas **armaduras** ainda não é calculado (a
  CA não exige proficiência e não há penalidade de armadura sem proficiência).
  Escolhas abertas do livro ("1 instrumento à sua escolha") entram como
  descrição.
- **[LACUNA] Expertise sem edição na ficha:** a Expertise já é escolhida no
  Level Up/criação (coroa de louros no card) e o servidor recusa tirar a
  proficiência de uma perícia dobrada; não há, porém, uma tela para o mestre
  trocar as escolhas fora do Level Up (ele ainda pode mexer em
  `classState.choices` pelo PATCH).
- **[LACUNA] O compêndio é somente leitura.** O plano é o mestre poder
  criar/editar raças/antecedentes — a arquitetura está preparada (`getCompendium`
  como fonte trocável), mas não há CRUD nem tabelas.
- **[LACUNA] Ataque Furtivo** não verifica condições táticas (vantagem / aliado
  adjacente).
- **[LACUNA] Sem testes unitários**; a verificação é o smoke.
- **[LACUNA] Estado em memória:** presença, apresentação, janela de dados e
  histórico de rolagens não sobrevivem a restart nem escalam horizontalmente.
- **[LACUNA] Salas de combate** (`combatRoom`) estão definidas mas não são
  usadas — a filtragem é por payload.
- **[NOTA] Anotações do mestre** não publicam evento (texto privado). Com o
  painel aberto em duas abas, a segunda só vê o texto ao recarregar.
- **[HIGIENE] Rate limit** só em `register`/`login`; as demais rotas não têm.
- **[NOTA] Documentação:** `README.md`, `ARQUITETURA-DO-SISTEMA.txt`,
  `Projeto.md` e `REVISAO-CODIGO.md` devem ser mantidos em dia ao alterar
  comportamento.

---

*Fim do documento.*
