# 6.6M.9.1 — Auditoria das unidades de movimento

## Diagnóstico

Referência inicial: `ec2ded2`. A fixture original do Golden Path declarava
`speed: 30`, mas essa coluna está em metros. Um trajeto de 10 pés custa 3 m;
portanto, restarem 27 m/90 pés nessa fixture não demonstrava multiplicação
indevida do orçamento. A conversão do projeto é 5 pés = 1,5 m, não a conversão
física exata do SI.

A fixture representativa de 9 m confirmou 30 pés iniciais, custo de 10 pés/3 m
e saldo de 20 pés/6 m. Um trajeto superior ao saldo é recusado sem alterar
versão, posição ou economia. O Golden Path também cobre personagem de 7,5 m,
uso combinado das APIs de economia e movimento espacial e NPC de 9 m.

A fixture de 7,5 m revelou um defeito independente: `effectiveSpeed` aplicava
`Math.floor` mesmo sem redução. Isso projetava 7 m a partir de uma ficha de
7,5 m. A correção preserva frações quando o multiplicador é 1. O arredondamento
legado quando existe redução (Exaustão) foi preservado: sua normalização exige
uma decisão explícita sobre unidade mecânica e arredondamento, fora desta correção.

O teste de ataque usava a CA sanitizada do resultado do jogador (`null` para
NPC); agora compara contra a CA da visão do Mestre. A conferência final de PV
respeita também o resultado 20 natural do Teste Contra a Morte (recupera 1 PV).

## Contratos atuais

| Superfície | Unidade / autoridade |
| --- | --- |
| `Character.speed`, `Creature.speed`, `CustomRace.speed`, catálogo racial | Metros; migrations históricas já converteram o legado para o sistema métrico |
| `effectiveSpeed`, `speed-flat` / `speedBonus` de efeitos | Metros; bônus derivado, não persistido na ficha |
| `TurnEconomy.movementBudget`, `movementUsed`, `movementOverrideBudget` | Metros em JSONB de `Combatant.turnEconomy` |
| `onTurnStart`, `moveDistance`, Dash, levantar, override do Mestre | Mesmo orçamento em metros; levantar custa metade do deslocamento efetivo |
| `/api/combat/action` (`move.distance`) e `/economy/override` (`remaining`) | Metros; entrada validada e consumo autoritativo |
| Posição, dimensão de cena, caminho, alcance e custo espacial | Pés; propriedades `*Feet` em persistência e DTOs |
| `spatial-movement.service.ts` | Converte custo com `feetToMeters` antes de consumir economia; saldo por `remainingMovementFeet` |
| Interrupção/retomada de OA | Reutiliza economia e conversão do serviço espacial; não possui orçamento separado |
| DTO de combate | Economia em metros e campos espaciais em pés; não é um DTO de unidade única |
| React, Hotbar e barra de deslocamento | Economia em metros; grid/Direct Drag enviam caminho em pés ao mesmo endpoint |
| Registro espacial e mensagens | `formatMetersPtBr` converte pés para texto em metros |
| Smokes históricos | Economia usa também fixture `speed: 30` (30 m); movimento espacial usa 9 m. Números sem unidade nos rótulos não redefinem o contrato |

Condições que zeram deslocamento prevalecem sobre bônus. A reconciliação
preserva o gasto; remover uma condição não pode criar movimento. O smoke
espacial cobre terreno difícil, rastejar, levantar, saldo exato, recusa do
excedente, movimento fragmentado e reconciliação com Exaustão. Os smokes de
economia, condições, efeitos e OA complementam Dash, override, modificadores,
impedimentos e interrupção/retomada. Nenhuma nova superfície de escrita foi criada.

## Normalização futura para pés — proposta, não executada

1. Inventariar todos os leitores/escritores acima, incluindo velocidade racial,
   itens/alcances, efeitos, snapshots de operações, movimento pendente e DTOs.
   Declarar a unidade em tipos e contratos; evitar números sem unidade.
2. Definir o arredondamento mecânico em pés (inclusive velocidades ímpares,
   Exaustão, levantar e Tiny) antes de converter. Não preservar inadvertidamente
   o arredondamento atual em metros como regra de PHB.
3. Preferir uma fronteira explícita inicial: manter as velocidades persistidas
   de fichas/criaturas em metros e converter ao entrar na economia mecânica em
   pés. Uma eventual conversão dessas colunas deve ser migration separada,
   incluindo defaults, raças personalizadas, catálogos e APIs de edição.
4. Versionar a unidade da economia persistida. Não inferir unidade pela magnitude
   (9 e 30 são valores válidos nas duas unidades). Migrar orçamento, gasto e
   override juntos, exatamente uma vez, com marcador inequívoco de versão.
5. Planejar janela de manutenção ou compatibilidade explícita para combates
   ativos: congelar escritas durante backfill, converter todos os combatentes,
   revisar intenções de movimento/OA pendentes, incrementar versões e publicar
   snapshots completos. Sem reinicializar turno, restaurar reação ou apagar gasto.
6. Preservar `operationId` e fingerprints históricos. Snapshots antigos devem
   continuar identificáveis pela versão do contrato; retry não pode reinterpretar
   metros como pés nem reaplicar consumo. Testar concorrência durante transição.
7. Atualizar HTTP, DTOs, Socket.io, consumidores React e smokes em conjunto,
   mantendo metros na apresentação. Testar reconexão e clientes com contrato
   antigo; rejeitá-los explicitamente quando incompatíveis.
8. Ensaiar migração e rollback em cópia isolada, com combatentes ativos, economia
   parcialmente gasta e OA pausada. Aprovar o plano antes de alterar produção.

Não houve migration ou conversão de dados nesta microfase. Os WIPs prévios
foram preservados. Nenhum serviço existente precisou ser reiniciado.

## Validação executada

- Original `ec2ded2` reproduzido no schema descartável: única falha GP19.P0,
  custo 10 pés, orçamento persistido 30 m, gasto 3 m e saldo espacial 90 pés.
- Golden Path corrigido: 47 verificações aprovadas, nenhuma falha.
- Smokes espacial, economia, OA, condições e efeitos: 386 verificações aprovadas.
- Typechecks e builds de backend/client, `test:combat-ui` e `test:operation-id`
  aprovados. O build do client emite aviso de tamanho de chunk.
- Guarda recusou `public`, `public_teste`, `campanha` e `playable_gp` com código 2,
  antes de conectar ao banco. Exige prefixo `smoke_` e nome válido.
- 71 migrations aplicadas no schema exclusivo `smoke_units_6691`; servidor de
  teste na porta 3119. Sentinela confirmou identidade Prisma/HTTP. O schema e
  o processo criados foram removidos após cada execução concluída.
- Todas as tabelas de `public`, comparadas por conteúdo antes/depois, permaneceram
  idênticas. Nenhum dado real foi restaurado, normalizado ou removido.
- Sem validação visual: não há navegador neste ambiente. As provas de UI
  executadas são automatizadas; não equivalem a aceite funcional em navegador.

O caso de 9 m não confirmou o P0 de multiplicação; o defeito comprovado foi a
perda de 0,5 m em velocidades fracionárias sem multiplicador. Permanecem dívidas
para uma fase própria: arredondamento sob Exaustão e alinhamento da derivação de
bônus de velocidade entre todas as superfícies (a API de economia não recebe
explicitamente `speedBonus`, enquanto o serviço espacial recebe). Não se afirma
cobertura de Direct Drag por interação real de navegador.
