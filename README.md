# 🐉 Codex do Aventureiro — Sistema de Mesa para D&D 5e

Sistema web multiusuário para mesas de RPG de **D&D 5ª Edição**, com fichas de personagem dinâmicas, painel exclusivo do mestre e um sistema de combate com iniciativa automática e sincronização em tempo real entre todos os jogadores.

---

## ✨ Visão geral

Este projeto foi pensado para uma mesa fixa de RPG, onde:

- **Jogadores** criam e gerenciam a própria ficha de personagem, com todos os cálculos de D&D 5e feitos automaticamente.
- O **Mestre** enxerga todas as fichas dos jogadores, cadastra criaturas/NPCs e comanda o combate através de um painel exclusivo.
- Tudo acontece **em tempo real**: qualquer alteração (HP, dano, turno de combate) aparece instantaneamente para quem precisa ver, sem recarregar a página.

O visual do sistema segue um tema de **fantasia medieval / pergaminho antigo**, com o objetivo de parecer um grimório físico e não uma planilha genérica.

---

## 🧩 Papéis de usuário

| Papel        | Permissões |
|--------------|------------|
| **Jogador**  | Cria e edita a própria ficha (atributos, inventário, magias, ataques). Só enxerga a própria ficha. |
| **Mestre**   | Enxerga todas as fichas dos jogadores (somente leitura), cadastra e gerencia criaturas/NPCs, controla o modo de combate e aplica dano/cura manualmente quando necessário. |

---

## ⚔️ Sistema de combate

1. O mestre aciona o botão **"COMBATE"**, iniciando o modo de combate para todos os conectados.
2. Cada jogador rola a própria iniciativa (1d20 + modificador de Destreza, calculado automaticamente).
3. O mestre rola iniciativa para as criaturas/NPCs adicionadas ao combate.
4. O sistema monta a **ordem dos turnos automaticamente**, do maior para o menor resultado.
5. Um indicador visual destaca de quem é o turno atual; o mestre avança os turnos manualmente.
6. Ataques rolados pelos jogadores aplicam **dano automaticamente** no HP do alvo (personagem ou criatura), refletindo em tempo real para todos os envolvidos.
7. O mestre pode ajustar HP manualmente a qualquer momento e encerrar o combate quando quiser.

Efeitos sonoros acompanham as rolagens de dado e o início do turno de cada jogador.

---

## 🛠️ Stack tecnológica

| Camada | Escolha | Por quê |
|--------|---------|---------|
| Runtime | **Node.js 20+** | Stack já definida. |
| Linguagem | **TypeScript** (ESM) | Segurança de tipos em fichas, magias e combate; o Prisma gera os tipos do banco automaticamente. |
| Framework HTTP | **Express 5** | Maior ecossistema e documentação — decisivo para manutenção de longo prazo. A carga (4–6 usuários) não exige Fastify. |
| Banco de dados | **PostgreSQL** | Stack já definida. |
| ORM | **Prisma** | Migrations versionadas e client tipado gerado do schema. |
| Senhas | **bcryptjs** | Hash com custo 12; puro JS, sem build nativo (facilita a hospedagem). |
| Autenticação | **JWT** (`jsonwebtoken`) | Token assinado, enviado no header HTTP e no handshake do WebSocket. |
| Validação | **Zod** | Valida todo payload de entrada (env, cadastro, login, eventos). |
| Tempo real | **Socket.io** | Salas (`rooms`), reconexão automática e entrega garantida de eventos — essenciais para turnos e HP sincronizados. |
| Frontend | **React 19 + Vite + TypeScript** | Edição inline exige interface reativa; Vite dá dev server rápido com proxy para a API. A identidade visual (Etapa 5) é aplicada por cima. |

Camada de tempo real: HTTP e WebSocket compartilham a **mesma porta** (`http.Server` do Express + Socket.io), o que simplifica a hospedagem.

### Estrutura de pastas

```
src/
├── config/         # env validado (Zod) e singleton do PrismaClient
├── http/
│   ├── app.ts      # monta o Express (sem listen)
│   └── routes/     # rotas da API, agregadas sob /api
├── lib/            # utilitários puros (senha/bcrypt, JWT)
├── middlewares/    # tratamento central de erros
├── modules/        # domínio, um diretório por área
│   ├── auth/       # cadastro, login, middlewares de autenticação/autorização
│   ├── characters/ # ficha do jogador
│   ├── combat/     # combate: iniciativa, turnos, ataques e HP
│   ├── creatures/  # criaturas/NPCs cadastrados pelo mestre
│   ├── shared/     # regras de D&D 5e, dados, ataques e utilidades compartilhadas
│   └── users/      # listagem de usuários (mestre)
├── realtime/       # Socket.io: auth, salas, presença e broadcast
├── scripts/        # utilitários (criar mestre, smoke test)
├── types/          # tipos compartilhados (Express e Socket.io)
└── index.ts        # bootstrap + graceful shutdown

prisma/
├── schema.prisma   # models (User, Character) + datasource PostgreSQL
└── migrations/     # migrations versionadas

client/             # app React (Vite + TypeScript)
├── index.html
├── public/fonts/   # fontes auto-hospedadas (Cinzel, EB Garamond, MedievalSharp)
├── vite.config.ts  # proxy de /api e /socket.io para o backend em dev
└── src/
    ├── components/ # InlineField, Section, SheetView, Icon, HpBar, AuthPage e seções
    │   └── master/ # painel do mestre: fichas (leitura) e criaturas
    ├── combat/     # CombatTracker, CombatIntro, CombatStartDialog e estado do combate
    ├── pages/      # SheetPage (jogador) e MasterPanel (mestre)
    ├── api.ts      # cliente HTTP com token
    ├── auth.tsx    # contexto de autenticação
    ├── fonts.css   # @font-face das fontes locais (gerado)
    ├── readonly.tsx# modo somente leitura (visão do mestre)
    ├── socket.ts   # conexão Socket.io
    ├── sound.ts    # efeitos sonoros sintetizados (dados, crítico, turno)
    ├── styles.css  # identidade visual (pergaminho + grimório amaldiçoado)
    ├── theme.ts    # tema claro/escuro, salvo no navegador
    └── useRealtime.ts # hook de eventos em tempo real
```

---

## 🎨 Identidade visual

O visual é o coração do projeto: a mesa inteira — ficha, painel e combate — foi desenhada para parecer um **grimório físico**, não um formulário.

- **Pergaminho:** fundo com grão de papel, vinheta sépia e texturas em SVG — sem imagens externas.
- **Paleta:** dourado (`#b8912a`), marrom-couro (`#3e2723` / `#5d4037`), vermelho vinho (`#7a1f1f`) e preto entintado.
- **Tipografia:** **Cinzel** nos títulos, **MedievalSharp** na marca e **EB Garamond** no corpo — auto-hospedadas (funcionam offline).
- **Molduras:** bordas douradas, hairlines internas e rosetas nos cantos, como a moldura de um livro.
- **Ícones desenhados à mão** (espada, escudo, coração, poção, pergaminho, estrela, dado, pena...), no traço de tinta, em vez de ícones flat.
- **Ficha em abas** que parecem divisões do grimório, com transição de "virar a página".
- **Vida e magia visuais:** barra de HP que muda de cor com a gravidade e espaços de magia em estrelas clicáveis.
- **Painel do mestre "de comando":** cabeçalho escuro e molduras imponentes dentro do mesmo tema.
- **Combate:** a tela "se transforma" com um **brasão de batalha** ao começar, e o turno atual brilha em dourado pulsante.
- **Modo claro (pergaminho)** como padrão e **modo escuro ("grimório amaldiçoado")** alternável no cabeçalho, com a escolha salva.
- Totalmente **responsivo** (desktop, tablet e celular).

---

## 📋 Funcionalidades da ficha de personagem

- Nome, raça, classe, nível, antecedente, alinhamento, experiência
- Atributos (Força, Destreza, Constituição, Inteligência, Sabedoria, Carisma) com modificadores automáticos
- HP (atual/máximo/temporário), Classe de Armadura, Iniciativa, Deslocamento
- Perícias e salvaguardas com proficiência e cálculo automático de bônus
- Inventário de itens e equipamentos
- Magias por nível, com espaços de magia (spell slots) controláveis
- Ataques e armas com dano e bônus de acerto
- Características de raça/classe/antecedente e anotações livres

---

## 🗺️ Roadmap de construção

O projeto foi planejado em etapas sequenciais:

- [x] **Etapa 0** — Definição de stack e estrutura inicial do projeto
- [x] **Etapa 1** — Autenticação, papéis de usuário e canais de tempo real
- [x] **Etapa 2** — Ficha de personagem completa (jogador)
- [x] **Etapa 3** — Painel do mestre e cadastro de criaturas
- [x] **Etapa 4** — Sistema de combate com iniciativa automática
- [x] **Etapa 5** — Design visual (fantasia medieval / pergaminho)
- [ ] **Etapa 6** — Otimização e performance

---

## 🚀 Como rodar

Requisitos: **Node.js 20+** e um **PostgreSQL** acessível.

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env   # edite DATABASE_URL conforme seu PostgreSQL

# 3. Gerar o client do Prisma
npm run prisma:generate

# 4. Iniciar em modo desenvolvimento (hot reload)
npm run dev
```

O servidor sobe em `http://localhost:3000`. Verifique com:

```bash
curl http://localhost:3000/api/health
```

Retorna `{ "status": "ok", "database": "up" }` quando o banco está acessível.

### Comandos disponíveis

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Servidor em modo desenvolvimento (`tsx watch`). |
| `npm run build` | Compila o TypeScript para `dist/`. |
| `npm start` | Executa a build compilada (produção). |
| `npm run typecheck` | Checagem de tipos sem gerar arquivos. |
| `npm run prisma:migrate` | Cria/aplica migrations em desenvolvimento. |
| `npm run prisma:deploy` | Aplica migrations em produção. |
| `npm run prisma:studio` | Interface visual do banco. |
| `npm run create-master` | Cria/promove a conta de Mestre (CLI). |
| `npm run smoke` | Smoke test ponta a ponta (exige o servidor rodando). |
| `npm run setup` | Instala as dependências do backend e do frontend. |
| `npm run dev:client` | Frontend em modo desenvolvimento (`http://localhost:5173`). |
| `npm run build:client` | Compila o frontend para `client/dist/`. |

### Ambiente local já configurado (esta máquina)

O PostgreSQL 17 foi instalado e configurado localmente, então o projeto roda direto por aqui:

| Item | Valor |
|------|-------|
| Cluster | `17/main` (porta `5432`, habilitado no boot via systemd) |
| Banco | `grimorio` |
| Usuário / senha | `postgres` / `postgres` |
| Servidor | `http://localhost:3000` (`npm run dev`) |

Gerenciando o banco:

```bash
# Ver status do cluster
pg_lsclusters

# Iniciar o PostgreSQL (sobe sozinho no boot, mas se precisar)
sudo pg_ctlcluster 17 main start

# Parar o PostgreSQL
sudo pg_ctlcluster 17 main stop
```

> Em caso de reinício da máquina, o PostgreSQL volta sozinho. Basta rodar `npm run dev` para subir o servidor.

### Hospedagem

A aplicação é um único serviço Node que expõe HTTP e WebSocket na mesma porta — basta definir `PORT`, `DATABASE_URL`, `CORS_ORIGIN`, `JWT_SECRET` e `MASTER_INVITE_CODE` no provedor e rodar `npm run prisma:deploy && npm start`. O health check em `/api/health` serve para o monitoramento do provedor.

### Serviço systemd (esta máquina)

Nesta máquina o servidor web roda como um serviço systemd, habilitado no boot. O unit fica versionado em `deploy/grimorio.service` e é copiado para `/etc/systemd/system/`:

```bash
# Instalar/atualizar o serviço
cp deploy/grimorio.service /etc/systemd/system/grimorio.service
systemctl daemon-reload
systemctl enable --now grimorio
```

O serviço executa a build compilada (`node dist/index.js`), então **rode `npm run build` (e `npm run build:client`) antes de reiniciar** depois de alterar o código:

```bash
npm run build && npm run build:client
systemctl restart grimorio
```

Operando o serviço:

```bash
systemctl status grimorio      # estado atual (active/enabled)
systemctl restart grimorio     # aplicar mudanças
systemctl stop grimorio         # parar
systemctl disable grimorio      # remover do boot
journalctl -u grimorio -f       # acompanhar os logs
```

O unit define `NODE_ENV=production` e carrega as variáveis do `.env` via `EnvironmentFile`. **Importante:** neste systemd o `EnvironmentFile` tem precedência sobre `Environment`, então o `.env` **não** deve conter a linha `NODE_ENV` — caso contrário o serviço sobe como `development`. Sem ela, `npm run dev` continua usando `development` (padrão) e o serviço usa `production`.

---

## 🔐 Etapa 1 — Autenticação, papéis e tempo real

### Papéis

| Papel | Como é criado | O que pode fazer |
|-------|---------------|------------------|
| `PLAYER` | Cadastro normal (`POST /api/auth/register`). | Gerencia apenas a própria ficha; recebe eventos da própria ficha. |
| `MASTER` | Cadastro com `masterInviteCode` válido, ou CLI `npm run create-master`. | Lista todos os usuários, enxerga todas as fichas e entra na sala dos mestres. |

O `masterInviteCode` é comparado com `MASTER_INVITE_CODE`. Um código errado devolve **403**; sem informar código, o cadastro vira `PLAYER`.

### Criando o primeiro mestre

```bash
npm run create-master -- --username mestre --password "uma-senha-forte" --name "Seu Nome"
```

(Pode rodar de novo depois: a conta é atualizada, o que também serve para trocar a senha.)

### Endpoints

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `POST` | `/api/auth/register` | público | Cria conta; devolve `{ token, user }`. |
| `POST` | `/api/auth/login` | público | Valida credenciais; devolve `{ token, user }`. |
| `GET` | `/api/auth/me` | autenticado | Dados do usuário do token. |
| `GET` | `/api/users` | **mestre** | Lista todos os usuários da mesa. |
| `GET` | `/api/health` | público | Status do servidor e do banco. |

Autenticação HTTP: header `Authorization: Bearer <token>`. Cadastro e login têm *rate limit* de 30 tentativas por 15 minutos por IP.

### Contrato de tempo real

A conexão WebSocket exige o mesmo token:

```js
import { io } from 'socket.io-client';
const socket = io('http://SEU_IP:3000', { auth: { token } });
```

O servidor coloca cada conexão automaticamente nas salas:

| Sala | Quem entra | Uso |
|------|-----------|-----|
| `table:main` | todos | Eventos gerais da mesa e presença. |
| `user:<userId>` | as sessões do próprio usuário | Eventos das fichas dele (sincroniza abas). |
| `role:masters` | somente `MASTER` | Painel de controle; recebe alterações de todas as fichas. |

**Eventos (servidor → cliente)**

| Evento | Destino | Conteúdo |
|--------|---------|----------|
| `connection:ready` | o próprio socket | `socketId`, `connectedAt`, `user`. |
| `presence:update` | mesa | Lista de quem está online. |
| `sheet:updated` | mestres + autor | Alteração de ficha, com autor carimbado pelo servidor. |
| `app:error` | o socket que errou | Mensagem de payload inválido, etc. |

**Eventos (cliente → servidor)**

| Evento | Payload | Efeito |
|--------|---------|--------|
| `sheet:update` | `{ characterId?, changes }` | Retransmite para os mestres e para as outras abas do autor. |
| `table:join` / `table:leave` | `tableId?` | Entra/sai da sala da mesa. |

> **Segurança:** `userId`/`username` **não** vêm do cliente — são carimbados a partir do socket autenticado, então um jogador não consegue se passar por outro. Na Etapa 2 o `characterId` também será validado contra o dono da ficha.

### Acesso por IP (fora da máquina)

O servidor escuta em todas as interfaces (`0.0.0.0:3000`), então já é acessível pela rede:

```bash
# Descobrir o IP da máquina
hostname -I

# Testar de fora
curl http://SEU_IP:3000/api/health
```

Para acesso pela internet, libere a porta no firewall e, se a máquina estiver atrás de roteador, faça o encaminhamento da porta 3000. Nesse cenário, defina `CORS_ORIGIN` com o endereço do frontend (em vez de `*`) antes de expor o sistema.

---

## 📜 Etapa 2 — Ficha de personagem

### Como rodar (backend + frontend)

Em **dois terminais**:

```bash
# terminal 1 — API + WebSocket (porta 3000)
npm run dev

# terminal 2 — interface (porta 5173, com proxy para a API)
npm run dev:client
```

Abra `http://localhost:5173`. Para publicar numa única porta (acesso por IP), use o build:

```bash
npm run build && npm run build:client && npm start
# agora tudo é servido em http://SEU_IP:3000
```

### Modelagem da ficha

Modelo **híbrido**: campos simples e muito consultados em colunas, coleções maiores em **JSONB** validado por Zod.

| Tipo | Campos |
|------|--------|
| Colunas | `name`, `race`, `className`, `level`, `background`, `alignment`, `experience`, os 6 atributos, `hpCurrent/hpMax/hpTemp`, `armorClass`, `initiativeBonus`, `speed`, `notes`, `version` |
| JSONB | `skills` (18 perícias), `saves`, `inventory`, `spells`, `attacks`, `features` |

Quando uma coleção é enviada no PATCH, ela **substitui integralmente** o valor anterior — sem merge profundo, o que torna a edição inline previsível.

Um usuário tem **uma ficha** (`userId` único), o que garante por construção que ele só pode ler e editar a própria.

### Regras de D&D 5e calculadas no servidor

Implementadas em `src/modules/shared/dnd5e.ts` e devolvidas em `derived` (nunca gravadas):

- **Modificador de atributo:** `floor((valor − 10) / 2)`
- **Bônus de proficiência** por nível: +2 (1–4), +3 (5–8), +4 (9–12), +5 (13–16), +6 (17–20)
- **Iniciativa:** modificador de Destreza + bônus avulso
- **Perícias:** modificador do atributo + proficiência (especialização dobra o bônus)
- **Salvaguardas:** modificador + proficiência
- **Percepção passiva:** `10 + bônus de Percepção`
- **CD de magia:** `8 + proficiência + mod. do atributo de conjuração` (por classe); **ataque mágico:** proficiência + mod.
- **Carga:** Força × 7,5 kg; peso total somado do inventário
- **CA sugerida** sem armadura: `10 + mod. Destreza` (a CA da ficha é manual, pois armaduras ainda não são modeladas)

### Sistema métrico

O sistema usa **metros e quilogramas** em tudo: deslocamento de fichas e criaturas em **metros** (5 pés = 1,5 m, então o padrão de 30 pés virou 9 m) e peso de itens em **kg** (1 kg = 2 lb, então 3 lb = 1,5 kg). É a mesma convenção do livro em português, e os bônus de deslocamento das classes (Movimento Rápido, Movimento sem Armadura) também estão em metros.

Os dados anteriores foram convertidos na migração `20260926170000_metric_system` (incluindo o peso das cópias que já estavam nos inventários).

### Multiclasse (PHB 2014)

A ficha guarda uma **lista de classes** (`{ classKey, subclass, level }`) em vez de uma classe única. O **nível total** do personagem é a soma dos níveis de cada classe — é ele que define o bônus de proficiência, o XP para o próximo nível e o teto de 20. As features de cada classe escalam com o **nível dela** e são somadas: um Bárbaro 3 / Ladino 2 tem, ao mesmo tempo, as features de Bárbaro até o 3 e as de Ladino até o 2 (a Fúria escala pelo nível de Bárbaro, o Ataque Furtivo pelo de Ladino).

- **Pré-requisitos:** para entrar numa classe é preciso **13** no(s) atributo(s) exigido(s) — o Guerreiro aceita Força **ou** Destreza, o Monge exige Destreza **e** Sabedoria. Sem o atributo, a classe é recusada com o motivo (`multiclassMissingLabel`).
- **Magia combinada:** conjurador completo + metade do meio-conjurador + um terço do terço-conjurador (arredondando para baixo) formam o nível de conjurador da tabela de multiclasse. O **Bruxo fica de fora** e usa Magia de Pacto separada; magias conhecidas/preparadas continuam sendo contadas **por classe**.
- **Aumento de Atributo/Talento é por classe:** Guerreiro em 4/6/8/12/14/16/19, Ladino em 4/8/10/12/16/19 e as demais em 4/8/12/16/19 (do nível daquela classe).
- O **nível de cada classe não é editável** direto: a lista só ganha classe e sobe de nível pelo Level Up (a edição direta de `level` é recusada com 400 e a lista só aceita trocar a **subclasse** de classes existentes).

As regras vivem em `src/modules/shared/classes.ts` (pré-requisitos, ajustes somados, tabelas de espaços, ASI por classe); a ficha grava as classes no JSONB `characters.classes` (migração `20260926180000_multiclass_and_level_up`).

### Controle de Level Up pelo mestre

O mestre liga/desliga o Level Up da mesa pelo botão no painel (`LIBERAR/BLOQUEAR LEVEL UP`). Enquanto desligado, nenhum jogador sobe de nível; quando liga, **todos** os jogadores veem o botão **Level Up** habilitado na própria ficha. Cada liberação (desligar → ligar) conta como uma nova, então depois de usar o Level Up o botão fica desabilitado **para aquele jogador** até o mestre liberar de novo.

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `GET` | `/api/game` | autenticado | Configuração da mesa (Level Up liberado e o contador de liberação). |
| `POST` | `/api/game/level-up` | **mestre** | `{ unlocked }` libera/bloqueia o Level Up da mesa. |

| Evento | Destino | Conteúdo |
|--------|---------|----------|
| `game:config` | mesa | Configuração da mesa atualizada (liberação/bloqueio). |

A configuração é uma linha única em `game_config`. Cada personagem guarda `lastLevelUpRelease`; o botão fica habilitado quando `levelUpUnlocked` está ligado e `lastLevelUpRelease < levelUpRelease`.

### Assistente de Level Up

Com o botão habilitado, ele abre uma janela no tema pergaminho que conduz o jogador por:

1. **Classe** — subir na classe atual ou multiclassar numa nova (as classes sem pré-requisito aparecem bloqueadas com o motivo).
2. **Pontos de vida** — rolar o Dado de Vida (o servidor rola, nunca o cliente) ou usar a média do PHB (d6=4, d8=5, d10=6, d12=7), sempre somando o modificador de Constituição com o **mínimo de 1 PV** por nível.
3. **Subclasse** — pedida quando o novo nível da classe libera a escolha (Clérigo/Bruxo/Feiticeiro no 1, Druida/Mago no 2, as demais no 3).
4. **Aumento de Atributo ou Talento** — só nos níveis de ASI **daquela classe**: +2 em um atributo ou +1 em dois (máximo 20), ou um talento do PHB (a lista com nome e descrição está em `client/src/feats.ts`; por enquanto o talento é registrado como texto na aba Características, sem efeito mecânico automatizado).
5. **Resumo e confirmação** — mostra o novo nível, o PV ganho e a progressão escolhida; ao confirmar, tudo é aplicado de uma vez e o botão se desabilita para o jogador até o mestre liberar de novo. O mestre vê a ficha mudar em tempo real.

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `POST` | `/api/characters/me/level-up` | autenticado | Aplica o Level Up (`classKey`, `subclass`, `hp`, `abilityIncreases`, `feat`) quando a liberação está ativa. |

### Endpoints

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `GET` | `/api/characters/me` | autenticado | Própria ficha (ou `null`). |
| `POST` | `/api/characters/me` | autenticado | Cria a própria ficha (409 se já existir). |
| `PATCH` | `/api/characters/me` | autenticado | Edição inline: aceita qualquer subconjunto de campos. |
| `GET` | `/api/characters` | **mestre** | Todas as fichas da mesa (base do painel da Etapa 3). |
| `PATCH` | `/api/characters/:id` | **mestre** | Edita a ficha de um jogador. A ficha continua pertencendo a ele. |

O autor vem sempre do token. Não existe rota que receba um `userId` — logo, um jogador não consegue acessar a ficha de outra pessoa, e a única escrita em ficha alheia é o `PATCH /api/characters/:id`, que exige o papel `MASTER`.

### Sincronização em tempo real

A escrita é **HTTP** (`PATCH`), que persiste e então publica `sheet:updated` pelo WebSocket — evitando dois caminhos de gravação divergentes. O evento vai para a sala dos mestres **e** para as sessões do autor (sincroniza abas).

Cada alteração incrementa `version`; o frontend só aceita eventos com versão igual ou maior, o que evita respostas fora de ordem. O payload traz tanto o `changes` enviado quanto a `character` completa já calculada.

### Edição inline

Nenhum formulário abre em outra tela: clicar no valor transforma o campo em edição; **Enter** ou sair do campo salva, **Esc** cancela. A alteração aparece na hora (otimista) e é confirmada pela resposta do servidor, que é a fonte de verdade dos valores derivados.

Seções da ficha: Identidade, Atributos, Vida e Defesa, Perícias e Salvaguardas, Inventário, Magias, Ataques, Características e Anotações/História.

---

## 🎲 Etapa 3 — Painel do mestre e criaturas

### Qual tela aparece

O papel decide: `PLAYER` entra na própria ficha, `MASTER` entra no painel. A decisão vem do `role` do token, não de uma rota escolhida pelo usuário. Para criar um mestre:

```bash
npm run create-master -- --username mestre --password "uma-senha-forte" --name "Seu Nome"
```

### Fichas dos jogadores

A aba **Fichas dos jogadores** lista todas as fichas e abre cada uma com exatamente a mesma ficha do jogador. Ela abre em **somente leitura** (campos não clicáveis, checkboxes desabilitados, botões de adicionar/remover escondidos) e o botão **editar ficha** troca para o modo de edição, com todos os controles disponíveis. Cada alteração é salva na hora em `PATCH /api/characters/:id`; **concluir edição** (ou selecionar outra ficha) volta ao modo leitura.

A ficha continua sendo do jogador — o mestre só ganha acesso de escrita, e a rota exige o papel `MASTER`. O evento publicado continua sendo `sheet:updated`, indo para os mestres e para as sessões do **dono**, que vê a mudança na tela na hora junto de um aviso de quem editou. Nas edições do próprio jogador esse aviso não aparece.

**Atualização em tempo real:** cada alteração (do jogador ou do mestre) publica `sheet:updated` e o painel substitui a ficha na lista e no detalhe já aberto, sem recarregar. Eventos com `version` menor que a atual são ignorados, evitando respostas fora de ordem.

### Criaturas e NPCs

Cadastro com nome, tipo, Nível de Desafio, os 6 atributos (com modificadores calculados), HP atual/máximo, CA, deslocamento, ataques, resistências, imunidades e descrição livre.

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `GET` | `/api/creatures` | **mestre** | Bestiário completo. |
| `GET` | `/api/creatures/:id` | **mestre** | Uma criatura. |
| `POST` | `/api/creatures` | **mestre** | Cadastra (HP inicial = máximo). |
| `PATCH` | `/api/creatures/:id` | **mestre** | Edição inline. |
| `DELETE` | `/api/creatures/:id` | **mestre** | Remove. |

Resistências e imunidades aceitam apenas os **tipos de dano canônicos** (`Cortante`, `Fogo`, `Veneno`...), selecionados por “chips” clicáveis — assim o combate consegue compará-las. Um tipo desconhecido devolve **400**.

Os eventos `creature:created`, `creature:updated` e `creature:deleted` vão **somente para a sala dos mestres**: os jogadores não enxergam o bestiário antes de as criaturas entrarem no combate (Etapa 4).

### Regiões e localidades

O mundo do mestre é organizado em dois níveis: a **região** (reino, floresta, continente) e as **localidades** dentro dela (cidade, masmorra, taverna). As criaturas e NPCs ficam sempre presos a uma **localidade**, nunca soltos na região.

A aba **Regiões** lista as regiões à esquerda; abrindo uma, há duas sub-abas:

- **Visão geral** — nome, descrição, anotações do mestre e imagens (que podem ser ampliadas e mostradas aos jogadores pelo lightbox).
- **Localidades** — a lista das localidades da região, com o editor de cada uma (imagens, descrição e **quem vive ali**), além de criar/remover.

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `GET` | `/api/regions` | **mestre** | Regiões (com a contagem de localidades). |
| `POST` | `/api/regions` | **mestre** | Cadastra uma região. |
| `PATCH` | `/api/regions/:id` | **mestre** | Edição parcial (nome, descrição, anotações, imagens). |
| `DELETE` | `/api/regions/:id` | **mestre** | Remove a região **e as localidades dentro dela** (as imagens saem do disco). |
| `GET` | `/api/localities` | **mestre** | Localidades da mesa (cada uma com `regionId`). |
| `POST` | `/api/localities` | **mestre** | Cadastra dentro de uma região (`regionId` obrigatório). |
| `PATCH` | `/api/localities/:id` | **mestre** | Edição parcial (inclusive **mover de região**). |
| `DELETE` | `/api/localities/:id` | **mestre** | Remove. |

Os eventos `region:created` / `region:updated` / `region:deleted` e `locality:created` / `locality:updated` / `locality:deleted` vão **somente para a sala dos mestres**. Ao criar, apagar ou mover uma localidade, a região dela é republicada com a contagem atualizada.

> A conversão dos dados antigos está na migração `20260926171000_add_regions`: cada localidade que já existia virou uma **região de mesmo nome** com a localidade dentro, então nada se perdeu.

### Inventário espelha o catálogo

O inventário guarda o que é do jogador (**quantidade**, **equipado** e o vínculo `itemId`) e lê do catálogo o resto — nome, descrição, peso, categoria, sprite e atributos. Na ficha, os campos que vêm do catálogo aparecem com o selo *catálogo* e não são editáveis (o servidor aplica o espelho ao montar o DTO, então edição local não sobrescreve o mestre).

Quando o mestre corrige um item na aba **Itens**, o servidor encontra todas as fichas que possuem aquele item e republica cada uma (`sheet:updated`) — o jogador vê o nome/peso novos na hora, sem recarregar. Se o item for removido do catálogo, a cópia antiga permanece na ficha (ninguém perde o que já estava na mochila).

### Prontas para o combate

As criaturas já têm o que a Etapa 4 precisa: `id` estável, atributos (para a iniciativa), HP atual/máximo e ataques no **mesmo formato** usado pelas fichas (`src/modules/shared/attacks.ts`), além de resistências e imunidades tipadas.

---

## ⚔️ Etapa 4 — Combate em tempo real

### O fluxo, passo a passo

1. **O mestre inicia o combate.** O botão **"⚔ COMBATE"** abre um modal com a lista de criaturas cadastradas; as marcadas entram na luta. O sistema adiciona automaticamente **todos os personagens de jogador**, cada criatura escolhida, e avisa a mesa inteira (`combat:started`). Só existe um combate por vez: iniciar outro devolve **409**.
2. **Fase de iniciativa.** Cada jogador recebe um prompt na própria tela para rolar **1d20 + modificador de Destreza** (o modificador vem da ficha, calculado pelo servidor). Cada um rola quando quiser; a ordem só é montada quando **todos** tiverem rolado. O mestre rola pelas criaturas, uma a uma.
3. **A ordem é montada automaticamente.** Quando o último combatente rola, o sistema ordena do maior para o menor resultado (empate desempatado pela Destreza e, depois, pelo nome) e divulga para todos (`combat:updated`).
4. **Indicador de turno.** O combatente da vez fica destacado para toda a mesa; o mestre avança com **"Próximo turno"** (`combat:turn`). Ao passar do último, a ordem volta ao início e a **rodada** incrementa.
5. **Ataques aplicam dano sozinhos.** Durante o combate o jogador escolhe, na própria ficha, um ataque e um alvo (personagem ou criatura). O servidor rola `1d20 + bônus` contra a **CA** do alvo: no acerto aplica o dano; no 20 natural é **crítico** (dobra os dados de dano); no 1 natural erra. O dano cai direto no HP do alvo e reflete na hora para o dono da ficha e para o mestre (`sheet:updated` / `creature:updated`).
6. **Ajuste manual.** O mestre pode aplicar dano ou cura em qualquer combatente pelo painel (com piso em 0 e teto no HP máximo).
7. **Encerrar.** A qualquer momento o mestre encerra o combate (`combat:ended`) e tudo volta ao estado normal.

> **Importante:** o HP **não é duplicado** no combate. O `Combatant` guarda apenas a referência (`characterId`/`creatureId`), e o HP é sempre lido ao vivo da ficha ou da criatura — assim os dois nunca divergem.

### Rolagem de dados

O rolador fica em `src/modules/shared/dice.ts` e usa `crypto.randomInt` (não `Math.random`). Entende notações como `1d8`, `2d6+3` e valores fixos; o crítico dobra apenas os **dados** (não o bônus fixo). Todo resultado é divulgado como `dice:rolled`.

### Endpoints

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `GET` | `/api/combat/active` | autenticado | O combate em andamento (ou `null`). |
| `POST` | `/api/combat` | **mestre** | Inicia o combate (`{ creatureIds }`). |
| `POST` | `/api/combat/initiative` | autenticado | O jogador rola a **própria** iniciativa. |
| `POST` | `/api/combat/initiative/:combatantId` | **mestre** | O mestre rola por um combatente (criatura). |
| `POST` | `/api/combat/next-turn` | **mestre** | Avança o turno. |
| `POST` | `/api/combat/attack` | autenticado | `{ attackerCombatantId?, targetCombatantId, attackId }` — o serviço confere se o ataque pertence ao autor. |
| `POST` | `/api/combat/hp` | **mestre** | Dano/cura manual (`{ combatantId, amount, mode }`). |
| `POST` | `/api/combat/end` | **mestre** | Encerra o combate. |

O atacante vem sempre da **ficha do usuário do token** — um jogador não consegue usar o ataque de outra ficha. A identidade nunca vem do corpo da requisição.

### Eventos de tempo real

| Evento | Destino | Conteúdo |
|--------|---------|----------|
| `combat:started` | mesa (`table:main`) | Combate criado, com todos os combatentes. |
| `combat:updated` | mesa | Nova rolagem de iniciativa ou ordem definida. |
| `combat:turn` | mesa | Turno/rodada atuais. |
| `combat:attack` | mesa | Resultado do ataque (d20, total, CA, acerto, dano). |
| `combat:ended` | mesa | Fim do combate. |
| `dice:rolled` | mesa | Qualquer dado rolado (iniciativa, ataque, dano). |

### Efeitos sonoros e alerta de turno

O áudio é **sintetizado no navegador** (`client/src/sound.ts`, Web Audio API) — sem arquivos para carregar:

- Som de dado ao rolar (iniciativa, ataque, dano).
- Som especial no **crítico**.
- Notificação sonora **e** visual destacada quando chega o **turno do jogador** (aviso piscante na tela).

O botão 🔊/🔇 no cabeçalho liga e desliga o som (a preferência fica salva em `localStorage`). O navegador exige um gesto do usuário antes de liberar o áudio, então o som é destravado no primeiro clique/toque.

### Combate em andamento persistido

`Combat` e `Combatant` ficam no banco, então quem recarrega a página (ou reconecta) **volta direto para o combate em curso** — o frontend carrega o estado ativo no `mount`. As relações usam `onDelete: SetNull` para que apagar uma criatura ou ficha não quebre o combate.

---

## 🎨 Etapa 5 — Identidade visual

### Fontes auto-hospedadas

Para o visual não depender de CDN nem de internet, as fontes são servidas pela própria aplicação (`client/public/fonts`), com `@font-face` gerado em `client/src/fonts.css`:

| Fonte | Uso |
|-------|-----|
| **Cinzel** | Títulos, botões e rótulos (cara de inscrição em pedra) |
| **MedievalSharp** | Marca "Codex do Aventureiro" |
| **EB Garamond** | Corpo do texto (leitura confortável) |

Todas de licença SIL Open Font License.

### Tema claro e escuro

O tema é um atributo `data-theme` no `<html>`; o CSS troca todas as cores por variáveis. O `index.html` aplica o tema salvo **antes da primeira pintura**, evitando o flash claro. O botão de lua/sol no cabeçalho alterna e grava a escolha (`client/src/theme.ts`).

- **Pergaminho (claro):** bege/marfim, dourado e couro.
- **Grimório amaldiçoado (escuro):** couro queimado e dourado mais vivo.

### Anatomia do visual

- **Texturas em SVG embutidas** (grão de papel e rosetas de canto) — sem arquivos de imagem.
- **Ícones autorais** em `client/src/components/Icon.tsx` (traço de tinta, `currentColor`).
- **Ficha em abas** (`SheetView`): Identidade, Atributos, Vida & Defesa, Perícias, Inventário, Magias, Ataques, Características e Anotações.
- **Atributos em forma de escudo** e **barra de vida** com cor por gravidade (`components/HpBar.tsx`).
- **Espaços de magia** como estrelas clicáveis (gastar/recuperar), além dos números.
- **Microanimações:** brilho dourado no hover, tremulação de chama nos ícones e "virar de página" ao trocar de aba.
- **Combate:** brasão de selo ao ativar (`combat/CombatIntro.tsx`) e turno atual com moldura dourada pulsante.
- **Acessibilidade:** `@media (prefers-reduced-motion)` desliga as animações para quem precisa.

### Componentes de estilo

| Arquivo | Papel |
|---------|-------|
| `client/src/styles.css` | Todo o tema (tokens claro/escuro, layout e animações) |
| `client/src/theme.ts` | Estado do tema e persistência |
| `client/src/components/Icon.tsx` | Conjunto de ícones temáticos |
| `client/src/components/HpBar.tsx` | Barra de vida visual |
| `client/src/combat/CombatIntro.tsx` | Brasão de batalha |

---

## 🖼️ Imagens ampliadas e apresentação para a mesa

### Clique para ampliar

Todo ícone/retrato do sistema (criaturas, NPCs, jogadores, itens, componentes de combate) e as imagens das regiões e localidades são **clicáveis**: a imagem abre ampliada no centro da tela, com o fundo escurecido, uma moldura no tema da página e um botão de fechar. Clicar fora da moldura ou pressionar **Esc** também fecha.

O lightbox é único para o app inteiro (`client/src/components/Lightbox.tsx`): o `Portrait` e a galeria (`ImageGallery`, usada por regiões e localidades) apenas chamam `useLightbox().open(...)`. Como o ícone costuma ficar dentro de um cartão clicável, o clique no ícone amplia a imagem em vez de acionar o cartão.

### “Mostrar aos jogadores” (mestre)

Quando quem abre a imagem é o **mestre**, aparece o botão **mostrar aos jogadores**: a mesma imagem surge na tela de **todos** os participantes, no centro, e só sai quando o mestre clicar em **fechar imagem** — ou seja, fica no ar pelo tempo que ele quiser. Para o jogador o overlay não tem botão de fechar (nem Esc); é o mestre quem encerra.

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `GET` | `/api/presentation` | autenticado | Apresentação em andamento (ou `null`). |
| `POST` | `/api/presentation` | **mestre** | Mostra `{ imageUrl, alt }` na tela da mesa. |
| `POST` | `/api/presentation/close` | **mestre** | Fecha a imagem na tela de todos. |

| Evento | Destino | Conteúdo |
|--------|---------|----------|
| `presentation:shown` | mesa | Imagem que o mestre está mostrando. |
| `presentation:closed` | mesa | Fim da apresentação. |

A apresentação é **efêmera** (não vai para o banco): vive na memória do servidor enquanto o mestre quiser e é reenviada a quem conectar no meio dela. Quem apresentou e quando vem do **token**, nunca do corpo da requisição, e só aceitamos `/uploads/...`, `data:image/` ou `http(s)` como endereço de imagem.

---

## 🎲 Janela de dados

Um botão flutuante **Dados** (canto inferior esquerdo, espelhando o de Anotações) fica disponível em **qualquer tela** — ficha, combate e painel do mestre. Ao clicar, o fundo escurece (como no lightbox das imagens) e um **ring circular** surge no centro da tela.

O evento `dice:active` é emitido para toda a mesa quando alguém abre ou fecha a janela, quando mexe no pool e quando os dados começam a rolar (`phase: 'tumbling'`) — é ele que mantém o tabuleiro assistido sincronizado. Quem conecta no meio de uma rolagem recebe o estado na hora (é efêmero, vive só na memória do servidor).

Os dados são **poliedros 3D de verdade**, montados com `matrix3d` a partir da geometria de cada sólido (tetraedro, cubo, octaedro, dodecaedro, icosaedro e bipirâmides). Eles giram em vários eixos dentro do ring e **pousam com a face do resultado voltada para a câmera** — o número é desenhado no centro de cada face (d100 sai no selo, porque 10 faces não representam 100 números).

- **Rolagem livre:** pool vazio; clique nos dados (d4, d6, d8, d10, d12, d20, d100) para empilhar; clique de novo num dado da bandeja para removê-lo.
- **Rolagem de perícia/salvaguarda:** cada linha da seção "Perícias e Salvaguardas" tem um botão de dado que abre a janela com **1d20 fixo** e o bônus já aplicado; ainda dá para somar dados extras (Orientação, Inspiração de Bardo...).
- **Vantagem/Desvantagem:** checkboxes exclusivos — rolam **2d20** e mantêm o maior (vantagem) ou o menor (desvantagem); os demais dados do pool rolam uma vez só. Os **dois d20 aparecem rolando juntos** no ring e o descartado fica **cinza** no resultado.
- **Mesa acompanha a rolagem:** ao abrir a janela, quem está rolando avisa a mesa. Os demais veem uma **faixa no topo do tabuleiro** com a foto do personagem e "*nome* está realizando um teste" (com o nome da perícia, quando é o caso). **Clicando na faixa**, quem assiste abre o **tabuleiro daquela pessoa em modo somente leitura** — os mesmos dados, caindo no mesmo instante, e o mesmo resultado, sem picker nem botões (o anúncio carrega o pool, a vantagem/desvantagem e a fase da rolagem). Rolagem marcada como privada pelo mestre não é divulgada, e fechar a janela (ou o navegador) tira a faixa.
- **Animação:** os dados giram e quicam dentro do ring até assentarem; o total (com bônus) e o valor de cada dado aparecem em destaque.
- **Visibilidade:** rolagem de jogador é **sempre pública**; o mestre pode marcar **Privada**, que não gera aviso para mais ninguém. Rolagem pública dispara um aviso para toda a mesa ("[Personagem] está fazendo um teste de [Perícia]") que some sozinho em **3 segundos** e também pode ser dispensado na hora.
- **Histórico:** o mestre tem um **log** logo abaixo dos dados com todas as rolagens da sessão, do mais recente ao mais antigo, e pode **limpar** o log.

### Endpoints

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `POST` | `/api/dice/roll` | autenticado | Rola o pool (`{ dice, advantage?, disadvantage?, bonus?, label?, kind?, private?, clientId? }`). |
| `GET` | `/api/dice/history` | **mestre** | Rolagens da sessão (memória do servidor). |
| `DELETE` | `/api/dice/history` | **mestre** | Zera o log. |
| `POST` | `/api/dice/active` | autenticado | Avisa a mesa que a janela abriu/fechou e manda o tabuleiro (`{ active, label?, kind?, private?, pool?, advantage?, disadvantage?, bonus?, phase? }`). |
| `GET` | `/api/dice/active` | autenticado | Quem está com a janela aberta agora (`{ activeRoll }`). |

| Evento | Destino | Conteúdo |
|--------|---------|----------|
| `dice:roll` | mesa (pública) / autor (privada) | Resultado da rolagem da janela de dados. |

Quem rolou é carimbado pelo servidor a partir do token e da ficha do usuário — nunca vem do corpo da requisição. O `clientId` enviado pelo cliente volta no resultado para o autor reconhecer a própria rolagem e não repetir o aviso.

---

## 📌 Escopo

- Sistema pensado para **uma única mesa fixa** (sem suporte a múltiplas campanhas/salas por enquanto)
- Sem chat integrado (uso de Discord ou similar à parte)
- Sistema de regras: **D&D 5ª Edição**

---

## 📄 Licença

Definir conforme a necessidade do projeto (uso pessoal/privado por padrão).
