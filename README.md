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
│   ├── characters/ # ficha do jogador (assistente de criação, Level Up e downgrade)
│   ├── combat/     # combate: iniciativa, turnos, ataques e HP
│   ├── compendium/ # listas de referência da mesa (classes, raças, antecedentes, magias)
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
    │   ├── master/ # painel do mestre: fichas (leitura) e criaturas
    │   └── creation/ # passo dos atributos (rolagem de 4d6 e distribuição)
    ├── creationApi.ts # assistente de criação (passos, rolagem e finalização)
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
- **Personagem com hierarquia:** a **foto do personagem** abre a seção, grande e **sem moldura nem fundo**, com **Nome, Raça, Antecedente e Alinhamento** ao lado, na mesma linha e em destaque. Cada campo tem **dois tooltips**: o **"i"** explica o conceito (o que é classe, subclasse, antecedente e alinhamento, em geral) e o **valor escolhido** abre um popup com o que aquele item é — a descrição da classe e das subclasses do livro (do compêndio), a história do antecedente com as perícias que ele concede e a frase do alinhamento. O bloco de **Conjuração** (tipos por classe e o que define CD e ataque) fica na aba **Magias**.
- **Vida e magia visuais:** barra de HP que muda de cor com a gravidade (em largura total, com os cards de defesa de mesma altura abaixo) e espaços de magia em estrelas clicáveis.
- **Painel do mestre "de comando":** cabeçalho escuro e molduras imponentes dentro do mesmo tema.
- **Combate:** a tela "se transforma" com um **brasão de batalha** ao começar, e o turno atual brilha em dourado pulsante.
- **Modo claro (pergaminho)** como padrão e **modo escuro ("grimório amaldiçoado")** alternável no cabeçalho, com a escolha salva.
- Totalmente **responsivo** (desktop, tablet e celular).

---

## 📋 Funcionalidades da ficha de personagem

- Nome, raça, classe, nível, antecedente, alinhamento, experiência
- **Seis cards de atributo** (Força, Destreza, Constituição, Inteligência, Sabedoria, Carisma): cada card reúne o valor com modificador automático, a salvaguarda e as perícias daquele atributo, na divisão do PHB 2014 — no lugar das antigas seções separadas de "Atributos" e "Perícias e Salvaguardas"
- O **cabeçalho do card de atributo** tem um **"i"** que explica de onde vem o valor (criação + raça + aumentos de nível + bônus de classe); ao clicar no número, rola um **teste puro** do atributo
- HP (atual/máximo/temporário), **Classe de Armadura calculada** (armadura equipada + atributos), Iniciativa, Deslocamento
- **Perícias** com proficiência editável e **salvaguardas** de proficiência fixa (a caixa é desabilitada — quem define é a classe), com cálculo automático de bônus, cada linha com o seu botão de rolagem e os nomes que nunca quebram
- Inventário de itens e equipamentos
- **Moedas** (PL/PO/PE/PP/PC) com conversões do PHB, gasto, troca e transferência entre jogadores; só o mestre dá ou retira
- **Inventário administrado pelo mestre**: a quantidade de um item é dele — o jogador move/equipa e **usa** consumíveis (Poção ou item marcado), sem editar quantidade, adicionar ou remover
- Magias por nível, com espaços de magia (spell slots) controláveis
- Ataques e armas com dano e bônus de acerto
- Características de raça/classe/antecedente, **subseção de Talentos** e anotações livres
- **Assistente de criação** em tela cheia (9 passos), com rolagem de 4d6 e retomada de onde parou
- **Criação finalizada:** depois de encerrar a montagem, o jogador só mexe no estado de jogo — o resto fica para o Level Up e para o mestre

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

### Verificação automática (smoke test)

Não há testes unitários: a verificação é o **smoke test ponta a ponta** (`npm run smoke`), que exige o servidor rodando, cria as próprias contas, exercita API e WebSocket e limpa tudo no fim. Ele cobre 31 seções — cadastro/login, tempo real, regras de D&D 5e, combate, Level Up, compêndio, a **Fase 0 (seções 14 a 21)** e os complementos de ataques/itens/moedas, do ataque derivado, do downgrade de nível, dos vários tipos de dano e do catálogo de ferramentas (seções 22 a 31):

| Seção | O que verifica |
|-------|----------------|
| **14** | **PV e CA automáticos** — PV de d10/d6, recálculo retroativo de CON (subindo e descendo), CA leve/média/pesada, escudo, Defesa sem Armadura de Bárbaro e de Monge, override do mestre. |
| **15** | **Multiclasse** — pré-requisito faltando na classe nova e nas classes atuais (400 + mensagem), proficiências parciais de entrada x lista completa da 1ª classe, salvaguardas só da 1ª classe, perícia de multiclasse obrigatória/válida. |
| **16** | **Magias preparadas** — contador por classe (Clérigo/Druida/Mago, Paladino com metade do nível, zero no 1º) e as classes de magias conhecidas. |
| **17** | **Espaços de magia** — tabela da própria classe x combinada (duas conjuradoras), terço-conjurador e Bruxo de fora (magia de pacto separada). |
| **18** | **Features e escolhas** — Defesa (+1 só com armadura), Pau para Toda Obra, Aura de Proteção, escolhas válidas/inválidas e subclasse no nível certo. |
| **19** | **Subclasses 1 → 20** — Level Up de verdade pelas 10 subclasses novas (features e recursos por nível) e o **crítico em combate** (limiar 18 do Campeão, 1 natural errando e a volta a 20 sem ele). |
| **20** | **Moedas** — ficha nasce zerada, jogador barrado no PATCH (403), 50 moedas = 0,5 kg no peso, dar/retirar do mestre (400 se exceder o saldo), gasto exato sem troco, troca com fração recusada, transferência entre jogadores (e a recusa a si mesmo) e a chave de **moedas extras** (PL/PE). |
| **21** | **Inventário** — o jogador não muda a quantidade nem adiciona/remove itens por PATCH (403, em qualquer fase); movimentar/equipar segue liberado e não altera a quantidade; usar um consumível desconta 1 unidade (a última entrada sai) e devolve a rolagem do efeito (`kind: item`); item não consumível (400) e item inexistente (404). |
| **22** | **Dano estruturado** — expressão textual derivada (`2d6+3`, `1d8-1`, fixo `4`), crítico dobrando os dados e somando o modificador uma só vez, tipo fora dos 13 canônicos (400), ataque legado preservado com a marca e o texto original. |
| **23** | **Cadastro de arma e preço** — o catálogo guarda o preço e a ficha recebe só o **perfil** da arma (tipo, categoria, dado); o preço **não** vaza para o jogador. |
| **24** | **Munição (complemento)** — arma sem `ammunition` não consome nada; o bônus da munição mágica soma ao ataque **e** ao dano; duas requisições simultâneas não gastam a mesma unidade (uma consome, a outra recebe 409). |
| **25** | **Moedas (complemento)** — a transferência publica `sheet:updated` nas duas fichas com os saldos finais; saldo insuficiente e transferência para o mestre recusados (400); alternar `extraCoins` publica `game:config`. |
| **26** | **Inventário (complemento)** — o mestre ajusta quantidade e remove item; os `send` se acumulam; usar consumível entra no log de rolagens do mestre como `kind: item`. |
| **27** | **Ataque derivado da arma equipada** — a arma equipada vira ataque calculado com a habilidade certa (FOR corpo a corpo, DES à distância, a melhor das duas com acuidade), proficiência por **categoria** e por **nome** (plural/acento), dado **versátil** com a outra mão livre, **duas mãos** recusada (400) com a outra mão ocupada, **segunda arma leve** sem o modificador de dano, variante de **arremesso** (`ranged` usando FOR) e **golpe desarmado**; tudo resolvido no combate, inclusive o Ataque Furtivo da arma sutil. |
| **28** | **Downgrade de nível (mestre)** — o Level Up passa a gravar o **histórico** de cada nível (dado/rolagem de PV com o ajuste retroativo de CON, Aumento de Atributo ou Talento, escolhas, subclasse, perícia e proficiências); `POST /api/characters/:id/level-down` desfaz exatamente isso (PV, atributos, escolhas e subclasse voltam), nível 1 caindo para 0 **remove a classe** da ficha (com a perícia e as proficiências de entrada, mas **mantendo** a proficiência que as classes restantes também concedem); a última classe do personagem e o jogador (403) são recusados; níveis anteriores ao histórico voltam com **aviso** e PV estimado pela média. |
| **29** | **Vários tipos de dano por ataque e por arma** — a arma do catálogo, o ataque da ficha e o da criatura carregam `extraDamages` (cada parcela com os seus dados e o seu tipo), o item enviado e o ataque **derivado** da arma equipada levam a lista junto e o combate continua resolvendo **só o dano principal**. |
| **30** | **Proficiências de ferramenta** — o mestre grava `toolProficiencies` com os ids estáveis do catálogo do PHB 2014 (`thieves-tools`, `lute`, `bagpipes`); um id fora do catálogo é recusado (400). |
| **31** | **Raridade e sintonização do item** — o item guarda `rarity` (valores internos `common`…`artifact`) e `requiresAttunement` (booleano manual, independente da raridade); item criado sem raridade nasce com `rarity: null` e `requiresAttunement: false`; raridade fora da lista é recusada (400); a edição atualiza os dois de forma independente; e o inventário do jogador **espelha** ambos (catálogo → ficha). |

Em produção, rode `npm run build` (e `npm run build:client`) **antes** de reiniciar o serviço — o systemd executa `dist/`. Se rodar o smoke várias vezes seguidas, reinicie o serviço entre as execuções: o rate limiter do login é em memória (e as seções novas **reaproveitam** fichas já criadas para não estourar o limite de 30 contas por 15 min do modo produção).

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

Autenticação HTTP: header `Authorization: Bearer <token>`. Cadastro e login têm *rate limit* de 30 tentativas por 15 minutos por IP. Como o JWT vale até expirar, cada requisição (e cada conexão WebSocket) **confere a conta no banco**: conta excluída pelo mestre perde o acesso na hora, com um JWT antigo ou não.

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
| `character:deleted` | mestres + dono | Personagem excluído junto com a conta do jogador; o dono é desconectado. |
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
| Colunas | `name`, `race`, `className`, `level`, `background`, `alignment`, `experience`, os 6 atributos, `hpCurrent/hpMax/hpTemp`, `armorClass`, `initiativeBonus`, `speed`, `notes`, `version`, `toolProficiencies` (ids de ferramenta) |
| JSONB | `skills` (18 perícias), `saves`, `proficiencies` (armadura/arma/ferramenta), `inventory`, `spells`, `attacks`, `features` |

Quando uma coleção é enviada no PATCH, ela **substitui integralmente** o valor anterior — sem merge profundo, o que torna a edição inline previsível.

Um usuário tem **uma ficha** (`userId` único), o que garante por construção que ele só pode ler e editar a própria.

### Regras de D&D 5e calculadas no servidor

Implementadas em `src/modules/shared/dnd5e.ts` e devolvidas em `derived` (nunca gravadas):

- **Modificador de atributo:** `floor((valor − 10) / 2)`
- **Bônus de proficiência** por nível: +2 (1–4), +3 (5–8), +4 (9–12), +5 (13–16), +6 (17–20)
- **Iniciativa:** modificador de Destreza + bônus avulso
- **Perícias:** modificador do atributo + proficiência (a **Expertise** do Ladino/Bardo dobra o bônus e marca a perícia com o selo de louros)
- **Salvaguardas:** modificador + proficiência
- **Percepção passiva:** `10 + bônus de Percepção`
- **CD de magia:** `8 + proficiência + mod. do atributo de conjuração` (por classe); **ataque mágico:** proficiência + mod.
- **Carga:** Força × 7,5 kg; peso total somado do inventário

**Classe de Armadura (calculada, nunca digitada pelo jogador)** — `src/modules/shared/armor-class.ts`:

- **Sem armadura:** `10 + mod. Destreza`. As **Defesas sem Armadura** das classes concorrem com essa fórmula e vale a que der o **maior** valor — Bárbaro `10 + DES + CON`, Monge `10 + DES + SAB` (só sem escudo), Feiticeiro de Linhagem Dracônica `13 + DES`. Elas **não se acumulam** entre si.
- **Com armadura** (item da categoria *Armadura* equipado no **peitoral**, com `armorType` e `baseArmorClass` cadastrados pelo mestre): leve = `CA base + mod. DES`; média = `CA base + mod. DES` (no máximo +2); pesada = só a `CA base`.
- **Escudo** equipado soma o próprio `armorClassBonus`; os demais itens equipados (anéis, elmos, armadura mágica `+1`) também somam o `armorClassBonus` como bônus mágico.
- **Override do mestre:** o campo *CA* do painel grava `armorClassOverride` e vence o cálculo; deixá-lo igual à automática (ou 0) volta ao automático. O jogador **nunca** grava CA (403).

Nada disso é guardado como valor fixo: modificadores, proficiência, iniciativa, percepção passiva, carga, CD/ataque de magia e CA saem sempre dos **atributos e do equipamento atuais**. Quando os atributos mudam (Level Up com Aumento de Atributo, bônus de feature como Campeão Primitivo) ou o equipamento muda, tudo é recalculado na hora — inclusive a CA que o **combate** usa para decidir se um ataque acerta.

### Sistema métrico

O sistema usa **metros e quilogramas** em tudo: deslocamento de fichas e criaturas em **metros** (5 pés = 1,5 m, então o padrão de 30 pés virou 9 m) e peso de itens em **kg** (1 kg = 2 lb, então 3 lb = 1,5 kg). É a mesma convenção do livro em português, e os bônus de deslocamento das classes (Movimento Rápido, Movimento sem Armadura) também estão em metros.

Os dados anteriores foram convertidos na migração `20260926170000_metric_system` (incluindo o peso das cópias que já estavam nos inventários).

> A mesma migração `20260927120000_creation_finalized_and_armor_class` zerou a coluna `armorClass` das fichas antigas: o valor que estava lá era digitado pelo jogador, não um override do mestre, então todas voltaram ao **cálculo automático** (o mestre pode fixar uma CA manual a qualquer momento).

### Multiclasse (PHB 2014)

A ficha guarda uma **lista de classes** (`{ classKey, subclass, level }`) em vez de uma classe única. O **nível total** do personagem é a soma dos níveis de cada classe — é ele que define o bônus de proficiência, o XP para o próximo nível e o teto de 20. As features de cada classe escalam com o **nível dela** e são somadas: um Bárbaro 3 / Ladino 2 tem, ao mesmo tempo, as features de Bárbaro até o 3 e as de Ladino até o 2 (a Fúria escala pelo nível de Bárbaro, o Ataque Furtivo pelo de Ladino).

- **Pré-requisitos:** para entrar numa classe nova é preciso **13** no(s) atributo(s) exigido(s) pela classe **e também por todas as classes que o personagem já tem** (PHB 2014, cap. 6) — o Guerreiro aceita Força **ou** Destreza, o Monge exige Destreza **e** Sabedoria. Sem o atributo, a entrada é recusada com o motivo completo (`multiclassPrerequisiteLabel`), algo como *"Para entrar em Ladino você precisa de Destreza 13; para continuar como Paladino você precisa de Força 13 e Carisma 13"*. A classe que o personagem já possui continua sempre elegível para subir de nível: o pré-requisito só vale para **entrar** numa classe.
- **Proficiências de armadura, arma e ferramenta:** a PRIMEIRA classe concede o conjunto completo do nível 1; entrar numa classe nova concede só o conjunto reduzido da tabela de multiclasse (PHB p.164) — e **nunca salvaguardas** (as fixas são só as da primeira classe). Bardo, Patrulheiro e Ladino ainda dão **uma perícia à escolha** ao entrar (qualquer uma, para o Bardo; da lista da classe, para os outros), pedida no próprio assistente de Level Up. As escolhas abertas do livro ("1 instrumento musical à sua escolha") entram como descrição; o efeito na CA e nos ataques ainda não é automático.
- **Espaços de magia — qual tabela vale:** com **uma** classe conjuradora vale a tabela da **própria classe** (conjurador completo = nível cheio; meio = **metade arredondada para CIMA**: Paladino 3 já tem 3 espaços de 1º, Patrulheiro 5 tem 4 de 1º e 2 de 2º; terço = **um terço para cima**: Trapaceiro Arcano 4 tem 3 de 1º). Paladino e Patrulheiro **não conjuram no nível 1** e o terço-conjurador só a partir do 3º. A tabela **combinada** (conjurador completo + metade do meio + um terço do terço, **arredondando para baixo**) só entra com **duas ou mais** classes conjuradoras; Guerreiro e Ladino sem a subclasse conjuradora não contam como conjuradores (Guerreiro 5 / Paladino 4 usa a tabela do Paladino). O **Bruxo fica de fora** das duas e usa Magia de Pacto separada.
- **Magias preparadas são POR CLASSE**, cada uma com o próprio atributo e o próprio nível: Clérigo (SAB), Druida (SAB) e Mago (INT) preparam `mod + nível da classe` (mínimo 1); o **Paladino (CAR)** prepara `mod + metade do nível de paladino` (mínimo 1) e **zero no nível 1**. Bardo, Patrulheiro, Feiticeiro, Bruxo e os terço-conjuradores usam **magias conhecidas** (a fórmula não se aplica — o valor sai como nulo). Cada classe expõe o seu número em `classes[].spellcasting.preparedCount`; **não há um total somado** na ficha.
- **Aumento de Atributo/Talento é por classe:** Guerreiro em 4/6/8/12/14/16/19, Ladino em 4/8/10/12/16/19 e as demais em 4/8/12/16/19 (do nível daquela classe).

### Escolhas de característica (Estilo de Luta, Inimigo Favorito...)

Algumas características pedem uma escolha: o **Estilo de Luta** (Guerreiro no 1º nível; Paladino e Patrulheiro no 2º), o **Inimigo Favorito** e o **Explorador Nato** do Patrulheiro (um no 1º nível, mais um no 6º e — no caso do terreno — mais dois no 10º, e o último inimigo no 14º), o **Estilo de Luta Adicional** do Campeão (10º), as **Manobras** e o **Estudante da Guerra** do Mestre da Batalha (3º, com mais duas manobras no 7º/10º/15º), as **Proficiências Adicionais** do Colégio do Conhecimento (3 perícias, que entram como proficiência de verdade) e as **quatro escolhas do Caçador** (Presa do Caçador no 3º, Táticas Defensivas no 7º, Multiataque no 11º e Defesa Superior no 15º).

A característica declara quantas opções, quais e **em que nível da classe** a escolha é feita; o valor fica em `classState.choices` (`{ 'fighter-fighting-style': ['defense'] }`) — sem migração nova. Quem **valida** é o servidor, no **Level Up** e no **passo 5 do assistente de criação** (quantidade, opção existente, sem repetir e só no nível certo); o `LevelUpDialog` e o `CreationWizard` mostram o seletor, e a **ficha mostra a escolha** na aba Características — em leitura para o jogador com a criação finalizada (403, campo de construção) e editável pelo mestre.

Quatro efeitos numéricos saem daí para o `derived`: o **Estilo de Luta Defesa** soma **+1 na CA enquanto houver armadura vestida** (escudo sozinho não conta), a **Aura de Proteção** do Paladino (6º nível) soma o **mod. de Carisma — mínimo +1 — em todas as salvaguardas**, o **Pau para Toda Obra** do Bardo (2º nível) soma **metade da proficiência** (arredondada para baixo) em todo teste de habilidade sem proficiência, inclusive a **iniciativa**, e o **Crítico Aprimorado/Superior** do Campeão (3º/15º) baixa o **limiar de crítico** para 19–20 e depois 18–20. Quando dois desses efeitos valem para o mesmo teste, vale o **maior** — nunca a soma (no crítico, vale o **menor limiar**).

A **subclasse escolhida no mesmo nível em que já pede uma escolha** (Caçador e Colégio do Conhecimento, ambos no 3º) funciona: o catálogo de classes do personagem expõe as escolhas de cada subclasse (`classOptions[].subclassChoices`) e o assistente de Level Up mostra o passo assim que a subclasse é selecionada — a subida só fecha com a escolha feita.

As demais escolhas (Arquearia, Duelismo, Proteção...) ficam registradas e descritas; o efeito em combate por ação/reação entra na Fase 5.

### Características de classe cadastradas

As características de **classe** (não de subclasse) das 12 classes estão no registro: cada uma com nível, texto e os efeitos mecânicos que o sistema já sabe aplicar (recursos com contador, toglões, bônus de CA, de salvaguarda, de velocidade, dados de crítico, Defesa sem Armadura, Forma Selvagem...). Os recursos com contador guardam **tipo de descanso** para a Fase 6 (o reset automático por descanso ainda não existe) e o que depende de combate por ação/reação/rolagem está marcado no próprio arquivo da classe com **PENDENTE (Fase 4/5)**.

Exemplos: Bardo (Inspiração de Bardo com usos = mod. de CAR, Canção de Descanso, Especialização), Guerreiro (Estilo de Luta, Retomar o Fôlego, Surto de Ação, Indomável e os Ataques Extras de 5/11/20), Paladino (Sentido Divino, Mãos Consagradas com reserva de 5 × nível, Aura de Proteção, Aura de Coragem, Toque Purificador) e Patrulheiro (Inimigo Favorito, Explorador Nato, Consciência Primitiva, Passo Terrestre, Desaparecer, Matador de Inimigos).

As **subclasses do PHB estão todas cadastradas**, com as escolhas e os efeitos que o sistema já sabe aplicar:

- **Bardo** — Colégio do Conhecimento (3 perícias à escolha que viram proficiência, Palavras de Interrupção) e Colégio da Bravura (concede **armaduras médias, escudos e armas marciais**, Inspiração de Combate);
- **Guerreiro** — **Campeão** (crítico com 19–20 no 3º e 18–20 no 15º, Atleta Extraordinário com metade da proficiência **arredondada para cima** em testes de FOR/DES/CON e na iniciativa), **Mestre da Batalha** (dados de superioridade d8 → d10 no 10º → d12 no 18º, 4 no 3º / 5 no 7º / 6 no 15º de descanso curto, as **16 manobras** do livro e Estudante da Guerra) e **Cavaleiro Arcano** (terço-conjurador de INT, com a tabela de espaços e magias conhecidas própria);
- **Paladino** — os três juramentos (Devoção, Anciões e Vingança) com **Canalizar Divindade** (1 uso, descanso curto ou longo), as **magias de juramento** como texto nos níveis 3/5/9/13/17 (sempre preparadas, fora do limite) e as características de 7/15/20;
- **Patrulheiro** — **Caçador** (as 4 escolhas do arquétipo) e **Senhor das Feras** (companheiro animal como característica informativa — a ficha do companheiro é Fase 5).

O **combate** já usa o limiar de crítico da ficha (Campeão): o ataque critica com d20 **maior ou igual** ao limiar, o crítico sempre acerta e o **1 natural sempre erra**.

> **Lacunas conhecidas:** **Clérigo** e **Bruxo** ainda têm `features: []` (faltam Canalizar Divindade, Destruir Mortos-Vivos, Intervenção Divina, Invocações Místicas, Dádiva do Pacto, Arcanum Místico) e o Ladino não tem a Gíria de Ladrão (texto puro). O **companheiro animal** do Senhor das Feras e as **magias de juramento** do Paladino como magias de verdade ficam para as Fases 4/5.
- O **nível de cada classe não é editável** direto: a lista só ganha classe e sobe de nível pelo Level Up (a edição direta de `level` é recusada com 400 e a lista só aceita trocar a **subclasse** de classes existentes). Para **baixar** um nível existe a ação **reduzir nível** do mestre (`POST /api/characters/:id/level-down`), que reverte o que aquele nível concedeu — ver a seção *Downgrade de nível (mestre)*.

O **Talento** escolhido nesse mesmo assistente fica registrado na ficha como uma característica de origem `feat` e aparece na aba **Características**, na subseção **Talentos** (nome + descrição; sem efeito mecânico automatizado por enquanto).

As regras vivem em `src/modules/shared/classes/index.ts` (pré-requisitos, tabela `CLASS_PROFICIENCIES` de proficiências, ajustes somados, tabelas de espaços, ASI por classe); a ficha grava as classes no JSONB `characters.classes` (migração `20260926180000_multiclass_and_level_up`) e as proficiências no JSONB `characters.proficiencies` (migração `20260928160000_character_proficiencies`, que já preencheu as fichas existentes a partir das classes).

As **proficiências de armadura, arma e ferramenta** aparecem em modo somente leitura na seção **Perícias e Salvaguardas** da ficha. É campo de **construção**: com a criação finalizada o jogador não altera (403) e só o mestre edita (texto separado por vírgula no próprio local).

O catálogo **`src/modules/shared/tools`** reúne as **35 ferramentas do PHB 2014** (17 de artesão, 4 kits, jogo de tabuleiro/cartas, 9 instrumentos musicais, navegação, ladrão e 2 veículos), com id estável em inglês (`thieves-tools`), nome em português/inglês, categoria, sugestão de atributo e uma descrição curta. Serve às funções `getTool`/`toolsByCategory`/`allTools`. O campo **`toolProficiencies`** (coluna `text[]`, nasce vazio) guarda os **ids** das ferramentas em que o personagem tem proficiência simples — é campo de construção, sem concessão automática por classe, raça ou antecedente nesta etapa.

### Controle de Level Up pelo mestre

O mestre libera o Level Up pelo botão **LIBERAR LEVEL UP** na barra de abas do painel. **Cada clique é uma liberação nova**: avança o contador e habilita o botão **Level Up** na ficha de **todos** os jogadores que ainda não subiram de nível naquela liberação. Não existe liga/desliga — depois que um jogador sobe de nível o botão dele fica desabilitado só até o próximo clique do mestre, sem precisar bloquear nada antes.

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `GET` | `/api/game` | autenticado | Configuração da mesa (contador de liberação e nível inicial). |
| `POST` | `/api/game/level-up` | **mestre** | Libera **um** Level Up para a mesa (incrementa o contador). |
| `POST` | `/api/game/starting-level` | **mestre** | `{ level }` define o nível em que a mesa começa (o assistente de criação aplica os níveis até ele). |

| Evento | Destino | Conteúdo |
|--------|---------|----------|
| `game:config` | mesa | Configuração da mesa atualizada (nova liberação, nível inicial...). |

A configuração é uma linha única em `game_config`. Cada personagem guarda `lastLevelUpRelease`; o botão fica habilitado enquanto `lastLevelUpRelease < levelUpRelease`.

### Pilha flutuante do mestre

No **canto inferior esquerdo** o mestre tem três botões empilhados — o único lugar do sistema com essa pilha:

| Posição | Botão | O que faz |
|---------|-------|-----------|
| topo | **Log** (com o contador de rolagens) | Abre o painel flutuante **só com o histórico de rolagens** da sessão. |
| meio | **Dados** | Abre a janela de rolagem (o tabuleiro, com o log dentro dela). |
| base | **Anotações** | Abre as **anotações privadas do mestre** sobre a mesa. |

Os dois painéis são flutuantes (cartões ancorados acima da pilha, com rolagem própria — nada de tela cheia) e abrem **um por vez**: abrir o log fecha as anotações e vice-versa.

### Anotações do mestre

O mestre tem um bloco de notas próprio, com o **mesmo esquema das anotações do jogador** (botão de pena + painel flutuante com salvamento automático ao sair do campo e "salvo às HH:MM"), mas o texto fica na **configuração da mesa** (`GameConfig.masterNotes`) e é **visível só para ele**: não vai para a ficha de ninguém nem para a mesa. Como as demais escritas do domínio, a gravação é por HTTP e o conteúdo não gera evento em tempo real (é privado de um único usuário).

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `GET` | `/api/game/notes` | **mestre** | Anotações privadas do mestre (`{ notes }`). |
| `PATCH` | `/api/game/notes` | **mestre** | `{ notes }` substitui o texto (até 20.000 caracteres). |

> As anotações moram na mesma linha de `game_config`, mas **não** entram no `GET /api/game`: essa rota é acessível ao jogador (a ficha lê o contador de liberações), então o texto só trafega pelas rotas acima, exclusivas de `MASTER`.

### Aba "Mesa"

O **NÍVEL INICIAL** e as listas de referência ficam na aba **Mesa** do painel do mestre (antes o nível inicial aparecia em destaque na barra de abas). Quando o nível inicial é maior que 1, o assistente de criação aplica os níveis 2 até ele ao concluir a montagem — **sem** depender da liberação do mestre e **sem** consumir a liberação do jogador (o nível inicial não é um Level Up de campanha).

A aba também consulta o **compêndio da mesa** (somente leitura por enquanto): todas as classes com seus atributos (dado de vida, salvaguardas, conjuração, a **descrição** de cada uma e as subclasses), todas as linhagens de raça com a história, todos os antecedentes com as perícias e o espaço das **magias** — o formato já existe, mas o catálogo de magias ainda está vazio, para ser preenchido numa etapa seguinte.

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `GET` | `/api/compendium` | autenticado | Listas de referência da mesa (classes, raças, antecedentes e magias). |

O compêndio é montado por `getCompendium()` em `src/modules/compendium/compendium.service.ts`, que hoje lê os catálogos estáticos (`shared/classes` e `shared/creation.ts`). É a única função a trocar de fonte quando o mestre puder criar e editar raças e antecedentes.

### Assistente de Level Up

Com o botão habilitado, ele abre uma janela no tema pergaminho que conduz o jogador por:

1. **Classe** — a janela já assume a **classe principal** do personagem (a primeira da ficha): a linha de resumo mostra "classe principal · nível X → Y" e a lista completa fica escondida. O botão **multiclasse** (à direita do cabeçalho, ao lado do **X**) abre as outras classes — as atuais e as novas — para subir nelas ou entrar numa nova (as classes sem pré-requisito aparecem bloqueadas com o motivo, citando a classe nova e as classes atuais que estão barrando); escolhida uma, a lista volta a fechar. A janela fecha pelo **X** ou pela tecla **Esc**.
2. **Escolhas de característica** — quando o nível novo as libera (Estilo de Luta no 1º do Guerreiro e no 2º do Paladino/Patrulheiro, Inimigo Favorito e Explorador Nato no 1º do Patrulheiro e as melhorias do 6º/10º/14º, as manobras do Mestre da Batalha, as perícias do Colégio do Conhecimento e as do Caçador); o servidor valida quantidade, opções e o nível — inclusive quando a escolha vem junto da subclasse escolhida na mesma subida.
3. **Perícia de multiclasse** — só ao entrar numa classe nova de Bardo (qualquer perícia), Patrulheiro ou Ladino (da lista da classe); a escolha precisa ser uma perícia que o personagem ainda não tenha, é validada no servidor e o passo mostra também as proficiências que aquela entrada concede.
4. **Pontos de vida** — rolar o Dado de Vida (o servidor rola, nunca o cliente) ou usar a média do PHB (d6=4, d8=5, d10=6, d12=7), sempre somando o modificador de Constituição com o **mínimo de 1 PV** por nível.
5. **Subclasse** — pedida quando o novo nível da classe libera a escolha (Clérigo/Bruxo/Feiticeiro no 1, Druida/Mago no 2, as demais no 3).
6. **Aumento de Atributo ou Talento** — só nos níveis de ASI **daquela classe**: +2 em um atributo ou +1 em dois (máximo 20), ou um talento do PHB (a lista com nome e descrição está em `client/src/feats.ts`; por enquanto o talento é registrado como texto na aba Características, sem efeito mecânico automatizado).
7. **Resumo e confirmação** — antes de aplicar, mostra o novo nível, o PV ganho e a progressão escolhida. Ao confirmar, tudo é aplicado de uma vez e a janela **não fecha**: troca o formulário pelo resumo do que foi aplicado — o que foi escolhido (classe, nível total, PV, subclasse, perícia, escolhas e progressão) e **o que você ganhou**, listando as características novas daquele nível com a descrição do livro. O botão Level Up se desabilita para o jogador até o mestre liberar de novo (e o mestre vê a ficha mudar em tempo real).

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `POST` | `/api/characters/me/level-up` | autenticado | Aplica o Level Up (`classKey`, `subclass`, `hp`, `skillChoice`, `choices`, `abilityIncreases`, `feat`) quando a liberação está ativa. |

### Downgrade de nível (mestre)

A ficha do jogador tem um botão **reduzir nível** no painel do mestre (aba **Fichas**, ao lado de *reabrir criação*). Ele abre a janela **Reduzir nível**, que pede a **classe** que perde um nível e mostra, antes de confirmar, **o que aquele nível concedeu** — o PV ganho (com o dado e se foi rolado ou a média), o Aumento de Atributo ou o Talento, a subclasse, as escolhas de característica, a perícia de multiclasse e as proficiências. Ao confirmar, tudo isso é **desfeito na ficha na hora** e o jogador vê a mudança em tempo real.

Para isso, cada nível ganho passa a gravar um **histórico** (`characters.levelHistory`) no próprio Level Up: sem ele não havia como saber quanto de PV aquele nível deu (a rolagem se perde) nem que atributo o jogador subiu.

- **Nível 1 caindo para 0 remove a classe da ficha**, com a subclasse, a perícia e as proficiências que só ela concedia — a proficiência que outra classe restante também dá (ex.: *Armaduras leves* do Ladino) **fica**.
- A **última classe** do personagem não pode sair (400): a ficha ficaria sem classe para definir o PV base e as salvaguardas. Para desmontar o personagem, o mestre usa **reabrir criação**.
- **Níveis anteriores ao histórico** (personagens que já existiam): o PV perdido é estimado pela **média do dado de vida** e a janela avisa que o resto precisa ser informado à mão (PV exato, Aumento de Atributo/Talento a desfazer).
- O que **se recalcula sozinho**: espaços de magia, magia de pacto, Ataque Furtivo, proficiência, CA e ataques derivados — todos saem das classes, como sempre.

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `POST` | `/api/characters/:id/level-down` | **mestre** | Reduz um nível da classe indicada e reverte o que ele concedeu. Corpo: `classKey` e, só para níveis sem histórico, `hpLost`, `abilityDecreases` e `removeFeatId`. Devolve a ficha e o resumo `levelDown` (com `warnings`). |

### Assistente de criação de personagem

A criação é um **assistente em tela cheia** que abre sozinho quando o **jogador** entra e não tem ficha **ou** tem uma ficha com `creationFinalized = false`. Enquanto ele estiver aberto, a ficha não aparece: o assistente toma a tela até o último passo. O mestre nunca é afetado (ele pode estar com a ficha do jogador aberta ao mesmo tempo).

O **rascunho é o próprio registro de `Character`**: o passo 1 cria a ficha (com a criação aberta) e cada passo concluído grava o que lhe pertence nos campos da ficha — nome, raça, antecedente, classe, atributos e perícias passam pelos mesmos caminhos de validação da ficha. O JSONB `characters.creationDraft` guarda o que não é campo da ficha: modo escolhido (novo/existente), passo alcançado, as rolagens de 4d6, os valores-base dos atributos e os `+1` à escolha da raça. Fechar o navegador não perde nada: ao voltar, o assistente reabre no passo em que parou.

| Passo | O que faz |
|-------|-----------|
| 1. Tipo de personagem | **Personagem novo** (rola os atributos) ou **Personagem existente** (digita de 1 a 20). |
| 2. Identidade | Nome, alinhamento e avatar (opcional). |
| 3. Raça | Seleção do **catálogo de raças do PHB 2014** (uma opção por linhagem/sub-raça; o nome mostra os bônus). O **Meio-Elfo** pede dois atributos à escolha para o `+1`. |
| 4. Antecedente | Seleção dos **13 antecedentes do PHB 2014**; cada um mostra (e concede) as suas duas perícias, sem consumir as escolhas da classe. |
| 5. Classe | Classe inicial, do mesmo catálogo de classes da ficha. **Clérigo, Feiticeiro e Bruxo** (subclasse no nível 1) já escolhem aqui o Domínio/Origem/Patrono, e as classes com escolha no nível 1 (Estilo de Luta do **Guerreiro**, Inimigo Favorito e Explorador Nato do **Patrulheiro**) pedem a escolha neste mesmo passo — o servidor recusa sem ela. |
| 6. Atributos | **Personagem novo:** rola 4d6 descartando o menor, seis vezes, e distribui os valores. **Personagem existente:** digita os seis valores. |
| 7. Perícias | Escolha das perícias da classe (quantidade e lista do PHB 2014 em `classes/index.ts`) mais as perícias concedidas pelo antecedente. |
| 8. Nível e progressão | Aplica os níveis 2..N pelo **assistente de Level Up** quando o nível inicial da mesa é maior que 1. |
| 9. Revisão | Resumo de tudo e o botão **Finalizar criação** (`creationFinalized = true`). |

- **Rolagem de atributo:** o dado é sorteado no **servidor**, pelo mesmo mecanismo da janela de dados (`POST /api/characters/me/creation/roll`, 4d6 com o menor descartado), e os quatro valores aparecem na tela com o descartado em destaque. A rolagem **não avisa a mesa** — ela entra apenas no **histórico do mestre**, como `[Jogador]: Criação de personagem: [valor] (d6 6 + d6 4 + d6 2 + d6 2)`.
- **Subclasse no nível 1:** no PHB 2014, Clérigo (Domínio Divino), Feiticeiro (Origem de Feitiçaria) e Bruxo (Patrono Extraplanar) escolhem a subclasse **já na primeira classe**; o passo 5 exige a escolha e ela entra na ficha junto da classe. Nas demais classes a subclasse continua sendo escolhida no nível que a libera, pelo Level Up. As listas vêm de `src/modules/shared/classes/*.ts` (`subclassLevel: 1`).
- **Pré-requisito de classe:** a classe é escolhida no passo 5 e o pré-requisito de atributo do livro (13) é conferido no passo 6, quando os atributos existem — se faltar, o passo dos atributos é recusado explicando o que falta. Trocar a classe inicial ainda no nível 1 é permitido.
- **Perícias do antecedente:** o passo 4 aplica as duas perícias do antecedente escolhido direto na ficha, somadas às escolhidas na classe — e sem gastar as escolhas dela (o `skillPicks` do rascunho guarda só as da classe).
- **Bônus de raça:** cada entrada do catálogo (`src/modules/shared/creation.ts`) traz os bônus de atributo já somados da raça e da sub-raça (ex.: `Anão (Anão da Colina)` = CON +2, SAB +1). Eles são aplicados sobre os valores-BASE do rascunho, então trocar de raça (ou voltar ao passo 3) refaz os atributos sem perder o que foi rolado/digitado. O **Meio-Elfo** tem +2 em Carisma e `abilityChoice: 2`: o jogador escolhe dois atributos (que não tenham bônus fixo) para ganhar +1, e a escolha é validada no servidor.
- **Nada é concedido pelo assistente:** itens são exclusividade do mestre. Todo valor derivado (PV, CA, iniciativa, CD de magia, percepção passiva, carga) é calculado pelo servidor a partir das escolhas.
- **Proficiências da primeira classe:** ao escolher a classe inicial (passo 5 ou seletor da ficha), o servidor grava as proficiências de armadura/arma/ferramenta do PHB para aquele nível 1 (`CLASS_PROFICIENCIES`); trocar a classe inicial enquanto a criação está aberta recalcula as proficiências.
- **Escolhas do nível 1:** o passo 5 pede as escolhas que a classe faz já no nível 1 (Estilo de Luta do Guerreiro, Inimigo Favorito e Explorador Nato do Patrulheiro) e grava em `classState.choices`; trocar a classe descarta as escolhas da anterior (o servidor também valida de novo).
- **Depois de finalizada, o jogador não refaz o assistente.** Só o **mestre** pode reabrir a criação (`POST /api/characters/:id/creation/reopen`): `creationFinalized` volta para `false`, o rascunho é re-semeado com os valores atuais (modo "personagem existente", passo 1) e o jogador reencontra o assistente no próximo acesso.

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `GET` | `/api/characters/me/creation` | autenticado | Estado do assistente: ficha (ou `null`), rascunho, catálogos, nível inicial e o que falta para finalizar. |
| `PATCH` | `/api/characters/me/creation` | autenticado | Salva o **passo concluído** (`step` + só os campos daquele passo). |
| `POST` | `/api/characters/me/creation/roll` | autenticado | Rola 4d6 (descartando o menor) para um atributo; `{ restart: true }` recomeça os seis valores. |
| `POST` | `/api/characters/me/creation/level-up` | autenticado | Aplica um nível durante a criação (mesmo assistente de Level Up, sem depender da liberação do mestre). |
| `POST` | `/api/characters/me/creation/finalize` | autenticado | Último passo: fecha a criação (recusa com a lista do que falta, se algo ficou para trás). |
| `POST` | `/api/characters/:id/creation/reopen` | **mestre** | Devolve a ficha ao assistente (o jogador refaz a montagem no próximo acesso). |

> Os catálogos de **raça** (`RACE_CATALOG`) e **antecedente** (`BACKGROUND_CATALOG`), no mesmo arquivo, estão preenchidos com o Livro do Jogador 2014: os passos 3 e 4 são seleções e o que cada opção concede (bônus de atributo/sua escolha no Meio-Elfo e perícias do antecedente) entra sozinho na ficha. Ferramentas, idiomas e a característica própria de cada antecedente ainda não são modelados.

### Endpoints

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `GET` | `/api/characters/me` | autenticado | Própria ficha (ou `null`). |
| `POST` | `/api/characters/me` | autenticado | Cria a própria ficha (409 se já existir). |
| `PATCH` | `/api/characters/me` | autenticado | Edição inline: aceita qualquer subconjunto de campos. Com a criação finalizada, só o estado de jogo (o resto responde 403). |
| `GET` | `/api/characters` | **mestre** | Todas as fichas da mesa (base do painel da Etapa 3). |
| `PATCH` | `/api/characters/:id` | **mestre** | Edita a ficha de um jogador — **qualquer campo, a qualquer momento**. A ficha continua pertencendo a ele. |
| `DELETE` | `/api/characters/:id` | **mestre** | Exclui a ficha **e a conta do jogador** dono dela (irreversível; recusa ficha de mestre). |

O autor vem sempre do token. Não existe rota que receba um `userId` — logo, um jogador não consegue acessar a ficha de outra pessoa, e a única escrita em ficha alheia é o `PATCH /api/characters/:id`, que exige o papel `MASTER`.

### Sincronização em tempo real

A escrita é **HTTP** (`PATCH`), que persiste e então publica `sheet:updated` pelo WebSocket — evitando dois caminhos de gravação divergentes. O evento vai para a sala dos mestres **e** para as sessões do autor (sincroniza abas).

Cada alteração incrementa `version`; o frontend só aceita eventos com versão igual ou maior, o que evita respostas fora de ordem. O payload traz tanto o `changes` enviado quanto a `character` completa já calculada.

### Criação finalizada (trava da ficha)

A ficha nasce com `creationFinalized = false`: enquanto isso o **assistente de criação** conduz a montagem. O último passo do assistente é a revisão, e é o botão **Finalizar criação** dela que grava `creationFinalized = true` (não existe mais o botão provisório dentro da ficha).

A partir daí o jogador **só** altera o **estado de jogo**:

- PV atual e PV temporário;
- gastar/recuperar **espaços de magia** (a lista de magias e o total de cada nível ficam como estão — são construção) e **usos de recursos de classe** (Fúria, Ki...);
- anotações/história, avatar e **movimentação de itens** no inventário/equipamento.

Todo o **resto** responde **403** em `PATCH /api/characters/me`: nome, raça, antecedente, alinhamento, experiência, atributos, proficiências de perícias e salvaguardas, classes/subclasses, PV máximo, CA, iniciativa, deslocamento, inventário, ataques e características. A mensagem de erro diz exatamente quais campos foram recusados.

Dois caminhos continuam mexendo na construção:

1. **Level Up** (`POST /api/characters/me/level-up`) — não passa pelo PATCH, então segue subindo nível, PV, subclasse e atributos normalmente.
2. **O mestre**, por `PATCH /api/characters/:id`, sem travas — e a mudança chega na tela do jogador na hora (`sheet:updated`).

Na interface, os campos travados ficam **somente leitura** (o mesmo modo da visão do mestre) e uma nota no topo da ficha lembra que a montagem só muda pelo Level Up ou pelo mestre.

Quem quiser devolver a ficha à montagem é o **mestre**, pelo botão **Reabrir criação** na ficha do jogador no painel: `creationFinalized` volta para `false` e o assistente reabre no próximo acesso daquele jogador, já com o que existia preenchido.

> `creationFinalized` entrou na migração `20260927120000_creation_finalized_and_armor_class`, que marca **todas as fichas existentes** como finalizadas (elas já foram criadas). O rascunho do assistente (`characters.creationDraft`) e o nível inicial da mesa (`game_config.startingLevel`) entraram na migração `20260928120000_creation_wizard`.

### Edição inline

Nenhum formulário abre em outra tela: clicar no valor transforma o campo em edição; **Enter** ou sair do campo salva, **Esc** cancela. A alteração aparece na hora (otimista) e é confirmada pela resposta do servidor, que é a fonte de verdade dos valores derivados.

Seções da ficha: **Personagem** (o retrato que salta para fora do card, a faixa recortada com Nome/Raça, a linha de Classe/Subclasse/Antecedente/Alinhamento, o nível com o **Level Up** e a inspiração — e, no fim, **Vida** com os seis cards de CA, iniciativa, deslocamento, percepção passiva, dado de vida e bônus de proficiência), seis cards de Atributos (selo hexagonal com o valor nas cores da bandeirola do nome e as perícias e salvaguardas de cada atributo — cada linha traz um resumo do que a perícia serve ao passar o mouse), Inventário, **Magias** (com o bloco de Conjuração), Ataques, Características (com a subseção **Talentos**) e Anotações/História.

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

### Excluir personagem (e a conta do jogador)

Na ficha aberta, o botão vermelho **excluir personagem** abre uma confirmação que diz exatamente o que desaparece: a ficha inteira **e a conta do jogador** que a interpreta — nada de um "tem certeza?" genérico, já que a ação é irreversível. Só o segundo clique (no botão vermelho do diálogo) apaga; Esc ou **cancelar** fecham sem mudar nada.

Ao confirmar, o servidor apaga o **usuário** dono da ficha; a ficha sai em cascata (relação `Character.userId`) e, junto com ela:

- o **avatar** enviado sai do disco;
- o personagem sai de qualquer **combate** em andamento (o combatente é removido, para não ficar uma linha fantasma na ordem de iniciativa);
- as **rolagens** dele saem do log da sessão e a faixa da janela de dados é desfeita;
- o dono recebe `character:deleted` e é **desconectado** — a tela dele volta ao login.

O token JWT continua válido até expirar, então `authenticate` e o handshake do WebSocket **conferem a conta no banco a cada requisição/conexão**: conta excluída recebe `401` na hora e não consegue nem reabrir o WebSocket (nem fazer login de novo, porque o usuário não existe mais). A rota recusa excluir ficha de **mestre** — a conta do mestre é a chave da mesa e não há como recriá-la.

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

**Ver o item:** passar o mouse sobre um item abre um painel flutuante de pré-visualização (com quantidade/usar/remover, no caso do mestre) e **clicar** abre a **ficha detalhada** num modal centralizado (`ItemDetailModal`) — nome em destaque, imagem ampliada (que abre o lightbox do app), categoria, raridade, sintonização, peso, quantidade, os **atributos** da categoria (dano, alcance, duração, propriedades...) e a descrição. É **somente leitura** e nunca usa o cadastro do item como fonte paralela: lê o próprio item do inventário. O campo **Valor** não existe nesse fluxo (o preço é exclusivo do mestre e nem chega ao inventário). O modal fecha pelo **X**, pelo clique na área escurecida e pelo **Esc**.

**Armaduras e escudos:** a categoria *Armadura* ganhou **tipo** (`Leve`, `Média`, `Pesada`) e **CA base** (`baseArmorClass`), usados no cálculo automático da CA da ficha; o `armorClassBonus` continua sendo o bônus avulso, que **some ao total** quando o item está equipado (é o que dá o +2 do escudo e o +1 de uma armadura mágica). Itens antigos sem tipo/CA base não viram armadura — o mestre só precisa reabrir o item e preencher.

### Entregar moedas (aba Itens)

No topo da aba **Itens** fica o painel **Entregar moedas**: o mestre escolhe o jogador e digita o valor por denominação — **positivo entrega, negativo retira** — sem abrir (nem editar) a ficha de ninguém. Antes disso, dinheiro só saía pelo bloco de moedas dentro da ficha, em modo de edição.

Antes de aplicar, o painel mostra o saldo **atual → depois da entrega**, então dá para conferir quanto o jogador vai ficar; retirar mais do que existe é recusado com a mensagem das denominações que faltam (o servidor também recusa, com 400). É o mesmo `POST /api/characters/:id/coins` do bloco de moedas, e na confirmação o painel adota a ficha devolvida pelo servidor — o jogador vê o saldo novo na hora (`sheet:updated`). As denominações **PL (pp)** e **PE (ep)** só aparecem com a chave `extraCoins` ligada na aba Mesa (o saldo delas, se existir, aparece sempre).

### Prontas para o combate

As criaturas já têm o que a Etapa 4 precisa: `id` estável, atributos (para a iniciativa), HP atual/máximo e ataques no **mesmo formato** usado pelas fichas (`src/modules/shared/attacks.ts`), além de resistências e imunidades tipadas.

---

## ⚔️ Etapa 4 — Combate em tempo real

### O fluxo, passo a passo

1. **O mestre inicia o combate.** O botão **"⚔ COMBATE"** abre um modal com a lista de criaturas cadastradas; as marcadas entram na luta. O sistema adiciona automaticamente **todos os personagens de jogador**, cada criatura escolhida, e avisa a mesa inteira (`combat:started`). Só existe um combate por vez: iniciar outro devolve **409**.
2. **Fase de iniciativa.** Cada jogador recebe um prompt na própria tela para rolar **1d20 + modificador de Destreza** (o modificador vem da ficha, calculado pelo servidor). Cada um rola quando quiser; a ordem só é montada quando **todos** tiverem rolado. O mestre rola pelas criaturas, uma a uma.
3. **A ordem é montada automaticamente.** Quando o último combatente rola, o sistema ordena do maior para o menor resultado (empate desempatado pela Destreza e, depois, pelo nome) e divulga para todos (`combat:updated`).
4. **Indicador de turno.** O combatente da vez fica destacado para toda a mesa; o mestre avança com **"Próximo turno"** (`combat:turn`). Ao passar do último, a ordem volta ao início e a **rodada** incrementa.
5. **Ataques aplicam dano sozinhos.** Durante o combate o jogador escolhe, na própria ficha, um ataque e um alvo (personagem ou criatura). O servidor rola `1d20 + bônus` contra a **CA** do alvo: no acerto aplica o dano (estruturado, com o tipo); o crítico (limiar 20, ou 19/18 com o Campeão) **dobra os dados** de dano; no 1 natural erra. O dano cai direto no HP do alvo e reflete na hora para o dono da ficha e para o mestre (`sheet:updated` / `creature:updated`).
6. **Ajuste manual.** O mestre pode aplicar dano ou cura em qualquer combatente pelo painel (com piso em 0 e teto no HP máximo).
7. **Encerrar.** A qualquer momento o mestre encerra o combate (`combat:ended`) e tudo volta ao estado normal.

> **Importante:** o HP **não é duplicado** no combate. O `Combatant` guarda apenas a referência (`characterId`/`creatureId`), e o HP é sempre lido ao vivo da ficha ou da criatura — assim os dois nunca divergem.

### Ataques e dano estruturado

O dano de um ataque **não é texto livre**: é estruturado em `{ count, sides, bonus, type }` — quantidade de dados, faces, bônus fixo (que pode ser negativo) e o tipo entre os **13 canônicos** (os mesmos usados nas resistências do bestiário). Ataques de **dano fixo** (ex.: 4) são `count: 0` com o valor em `bonus`, e um ataque pode ficar **sem tipo** (nesse caso não aciona resistência). A expressão textual (`2d6+3`) é **derivada** do dano estruturado só para exibição; a ficha e o editor de criatura têm campos separados (quantidade de dados, dado, bônus e tipo em lista).

No combate o servidor rola esse dano (crítico dobra os **dados** e o bônus entra uma vez, com piso em 0) e usa o **tipo estruturado** para a resistência do alvo. Personagens e criaturas compartilham o mesmo formato (`src/modules/shared/attacks.ts`), e o **limiar de crítico** da ficha (Campeão: 19–20 e depois 18–20) decide o crítico.

No catálogo, os itens **Arma** e **Cajado** guardam o dano estruturado (`damageCount`, `damageDie`, `damageType`) mais o `attackBonus` e o `damageBonus` (bônus mágico somado ao dano). A arma também tem **perfil próprio**: **uso** (corpo a corpo/à distância), **categoria** (simples/marcial), as **propriedades do PHB** (leve, acuidade, pesada, duas mãos, versátil, arremesso, alcance, munição, recarga, especial), o **dado versátil** e os **alcances** normal/longo em metros — exibidos no card do item. O servidor exige coerência: **munição** só em arma à distância, **versátil** exige o dado de duas mãos e não convive com **duas mãos**, e **à distância/arremesso** exigem os dois alcances.

> No editor, escolher **à distância** revela os campos de alcance e a propriedade **Munição**; corpo a corpo usa 1,5 m (3 m com **Alcance**). A arma antiga cadastrada como Arma recebeu `melee`/`simple` (`npm run migrate:item-weapons`) — as que parecem ser à distância pelo nome saem listadas para o mestre corrigir.

### Raridade e sintonização

Todo item do catálogo tem duas propriedades de **item**, não de categoria: **raridade** (`rarity`) e **requer sintonização** (`requiresAttunement`). A raridade é um campo próprio do modelo (`String?`, com índice para permitir filtro futuro) e usa **valores internos estáveis** — `common`, `uncommon`, `rare`, `very_rare`, `legendary`, `artifact` — exibidos em português (**Comum, Incomum, Raro, Muito Raro, Lendário, Artefato**). Um item sem raridade classificada fica com `null` e continua funcionando normalmente (aparece como `—`).

`requiresAttunement` é um **booleano definido manualmente** pelo mestre (`false` por padrão) e é **independente da raridade** — nenhuma regra automática liga as duas. A sintonização antes existia apenas dentro de `details` na categoria **Anel**; ela foi **incorporada** a este campo global (a migração leva os anéis antigos para `requiresAttunement` e limpa a chave do JSONB).

Ambos aparecem no editor/lista do mestre e **descem para o inventário do jogador**: o espelho do catálogo (`CatalogSnapshot`/`syncInventory`) copia `rarity` e `requiresAttunement` para a cópia do inventário, de modo que a ficha mostra a raridade e o aviso **"Requer Sintonização"** no detalhe do item — e uma correção do mestre se propaga na hora para quem já tem o item.

**Sistema visual de cores.** Cada raridade tem uma cor própria (Comum cinza `#BDBDBD`, Incomum verde `#4CAF50`, Raro azul `#2196F3`, Muito Raro roxo `#9C27B0`, Lendário laranja `#FF9800`, Artefato vermelho `#D32F2F`), usada no **texto** e como **detalhe discreto** (anel da célula na mochila, borda esquerda do card e do modal). A configuração fica **num único lugar**: `ITEM_RARITY_COLORS` em `client/src/dnd.ts` — mudar ali reflete em todo o app. Os helpers `rarityColor`/`rarityTint`/`rarityLabel` normalizam o valor (aceitam `common`, "Comum", "COMUM" etc.) e devolvem o estilo **neutro** quando o item não tem raridade (nunca uma cor aleatória). A cor é só um reforço: o **nome da raridade continua escrito** por acessibilidade.

> Ataques antigos cuja expressão o parser não conseguiu interpretar foram convertidos com o **texto original preservado** e a marca **legado** (`npm run migrate:attack-damage`); o mestre revisa pela própria ficha.

### Munição (arma à distância)

Uma arma à distância pode declarar, no catálogo, que **exige munição**: a propriedade **Munição** marca isso e o tipo (**Flecha**, **Virote**, **Bala de funda**, **Agulha de zarabatana**) fica no próprio item. **Munição** também é uma **categoria de item**, com o tipo e os bônus da munição mágica (**+1/+2/+3** ao ataque e/ou ao dano).

Na ficha, um ataque pode ser **vinculado a uma arma do inventário**. A arma precisa estar **equipada numa das mãos** do set: enquanto não estiver, o ataque **nem aparece** na aba Ataques. Se a arma equipada exige munição, cada ataque **gasta 1 unidade** do tipo correspondente — sem munição o ataque **não é rolado** (409). A pilha gasta é escolhida automaticamente (**sem bônus mágico primeiro**, depois a de menor bônus) ou pelo **seletor** na ficha/combate; a pilha que chega a **0** sai do inventário. Os bônus da munição usada somam ao ataque e ao dano **apenas na resolução**. **Criaturas nunca consomem munição.**

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
- **Ficha em abas** (`SheetView`): Personagem (cabeçalho novo, com Vida e Defesa no fim), Atributos (com perícias e salvaguardas), Inventário, Magias, Ataques, Características e Anotações.
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

O evento `dice:active` é emitido para toda a mesa quando alguém abre ou fecha a janela e quando mexe no pool. A fase de queda (`phase: 'tumbling'`) também vai por aí, mas **anunciada pelo servidor no início da rolagem** — não pelo cliente em um pedido paralelo. Com um pedido só, a ordem queda → resultado fica garantida e nenhum espectador recebe o total antes de o tabuleiro entrar em queda (nem perde o total por causa de um anúncio atrasado).

O tabuleiro anunciado guarda também a **última rolagem** (`lastRoll`), e o `at` diz desde quando o estado mudou: quem conecta no meio da queda assiste só o restante dela e quem conecta depois vê o mesmo resultado de quem rolou — nunca fica o dado parado na tela sem total. Mexer no pool descarta esse resultado guardado, igual à janela do autor. Todo esse estado é efêmero: vive só na memória do servidor.

Os dados são **poliedros 3D de verdade**, montados com `matrix3d` a partir da geometria de cada sólido (tetraedro, cubo, octaedro, dodecaedro, icosaedro e bipirâmides). Eles giram em vários eixos dentro do ring e **pousam com a face do resultado voltada para a câmera** — o número é desenhado no centro de cada face (d100 sai no selo, porque 10 faces não representam 100 números).

- **Rolagem livre:** pool vazio; clique nos dados (d4, d6, d8, d10, d12, d20, d100) para empilhar; clique de novo num dado da bandeja para removê-lo.
- **Rolagem de perícia/salvaguarda:** cada linha da seção "Perícias e Salvaguardas" tem um botão de dado que abre a janela com **1d20 fixo** e o bônus já aplicado; ainda dá para somar dados extras (Orientação, Inspiração de Bardo...).
- **Vantagem/Desvantagem:** checkboxes exclusivos — rolam **2d20** e mantêm o maior (vantagem) ou o menor (desvantagem); os demais dados do pool rolam uma vez só. Os **dois d20 aparecem rolando juntos** no ring e o descartado fica **cinza** no resultado.
- **Mesa acompanha a rolagem:** ao abrir a janela, quem está rolando avisa a mesa. Os demais veem uma **faixa no topo do tabuleiro** com a foto do personagem e "*nome* está realizando um teste" (com o nome da perícia, quando é o caso). **Clicando na faixa**, quem assiste abre o **tabuleiro daquela pessoa em modo somente leitura** — os mesmos dados, caindo no mesmo instante, e o mesmo resultado, sem picker nem botões (o anúncio carrega o pool, a vantagem/desvantagem e a fase da rolagem). A rolagem do mestre **já nasce privada** — a faixa só aparece para a mesa se ele **desmarcar "Privada"** ("a rolagem é avisada se ele desejar"). Fechar a janela (ou o navegador) tira a faixa.
- **Animação:** os dados giram e quicam dentro do ring até assentarem; o total (com bônus) e o valor de cada dado aparecem em destaque.
- **Visibilidade:** rolagem de jogador é **sempre pública**; a do mestre é **Privada por padrão** (só ele vê o resultado e nenhum aviso sai). Desmarcando **Privada** o mestre compartilha a rolagem como um jogador: a mesa recebe o aviso e pode assistir ao tabuleiro. Rolagem pública dispara um aviso para toda a mesa ("[Personagem] está fazendo um teste de [Perícia]") que some sozinho em **3 segundos** e também pode ser dispensado na hora.
- **Histórico (duas portas):** o mestre tem o **log dentro da bandeja** (logo abaixo dos dados, na janela de rolagem) **e** um **botão flutuante "Log"** na tela, logo **acima** do botão "Dados", que abre um **painel flutuante só com o histórico** — um cartão ancorado acima dos botões, com rolagem própria e botão de fechar, **sem ocupar a tela** (o tabuleiro não precisa estar aberto). Nos dois lugares o log vai do mais recente ao mais antigo e pode ser **limpo**. Cada linha é `[Jogador]: [Perícia]: [total]` seguida da **depuração entre parênteses** — cada dado com o tipo, a origem do bônus e o que foi descartado: `Umbrae: Percepção: 10 (d20 6 + 4 perícia)`, `Umbrae: Rolagem livre: 17 (d20 14 + 3 bônus)`, `Umbrae: Percepção: 10 (d20 6, descartado d20 2 + 4 perícia)`. O bônus é rotulado como *perícia*, *salvaguarda* ou *bônus* conforme o tipo da rolagem (o `total` do log é sempre o mesmo que a mesa viu). As rolagens do **assistente de criação** (`kind: 'creation'`) também entram aí, como `[Jogador]: Criação de personagem: [valor] (d6 6 + d6 4 + d6 2 + d6 2)`, sem descartar dado nenhum no log (o menor descartado da criação é escolha do assistente, não da rolagem) — elas **não** avisam a mesa e não acendem a faixa de rolagem.

### Endpoints

| Método | Rota | Acesso | Descrição |
|--------|------|--------|-----------|
| `POST` | `/api/dice/roll` | autenticado | Rola o pool (`{ dice, advantage?, disadvantage?, bonus?, label?, kind?, private?, clientId? }`). |
| `GET` | `/api/dice/history` | **mestre** | Rolagens da sessão (memória do servidor). |
| `DELETE` | `/api/dice/history` | **mestre** | Zera o log. |
| `POST` | `/api/dice/active` | autenticado | Avisa a mesa que a janela abriu/fechou e manda o tabuleiro (`{ active, label?, kind?, private?, pool?, advantage?, disadvantage?, bonus? }`). |
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
