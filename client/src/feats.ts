/**
 * Talentos do Livro do Jogador (PHB 2014).
 *
 * Por enquanto são apenas nome + descrição (registro textual na aba
 * "Características"): nenhum efeito mecânico é aplicado automaticamente. A
 * automação dos talentos virá em uma etapa futura, talento por talento.
 */
export interface FeatDefinition {
  name: string;
  description: string;
}

export const FEATS: readonly FeatDefinition[] = [
  { name: 'Ator', description: 'Aumente Carisma em 1 (máx. 20). Você tem vantagem em testes de Enganação e Atuação ao se passar por outra pessoa, e pode imitar a fala de alguém ou os sons de outras criaturas.' },
  { name: 'Alerta', description: 'Você ganha +5 na iniciativa, não pode ser surpreendido enquanto estiver consciente e criaturas ocultas não têm vantagem nos ataques contra você.' },
  { name: 'Atleta', description: 'Aumente Força ou Destreza em 1 (máx. 20). Ficar de pé custa apenas 1,5 m de deslocamento, subir exige metade do movimento e você salta com corrida de apenas 1,5 m.' },
  { name: 'Investida', description: 'Quando usa a ação Disparada, pode fazer um ataque corpo a corpo com arma como ação bônus; se tiver se movido pelo menos 3 m em linha reta, causa +5 de dano ou empurra o alvo 3 m.' },
  { name: 'Especialista em Bestas', description: 'Você ignora a recarga de bestas e não sofre desvantagem por atirar a até 1,5 m do alvo; atacar com besta de uma mão permite um ataque com arma de uma mão como ação bônus.' },
  { name: 'Duelista Defensivo', description: 'Quando empunha uma arma de acuidade e outra criatura o acerta, pode usar a reação para somar o bônus de proficiência à CA contra aquele ataque.' },
  { name: 'Usar Duas Armas', description: 'Você ganha +1 na CA quando empunha duas armas, pode usar armas que não sejam leves e pode sacar/guardar duas armas no mesmo turno.' },
  { name: 'Explorador de Masmorras', description: 'Você tem vantagem em Percepção e Investigação para achar portas secretas, resiste a armadilhas, viaja em ritmo normal procurando armadilhas e detecta magias sem vê-las.' },
  { name: 'Robusto', description: 'Aumente Constituição em 1 (máx. 20). Ao rolar um Dado de Vida para recuperar PV, o valor mínimo por dado é dobrado o modificador de Constituição.' },
  { name: 'Adepto Elemental', description: 'Escolha um tipo de dano (ácido, frio, fogo, elétrico ou trovejante): suas magias ignoram resistência a ele e tratam imunidade como resistência.' },
  { name: 'Lutador', description: 'Aumente Força ou Destreza em 1 (máx. 20). Você tem vantagem em ataques contra criaturas agarradas e pode usar a ação de agarrar sem ter uma mão livre.' },
  { name: 'Mestre de Armas Grandes', description: 'Ao acertar com arma pesada, pode sofrer -5 no ataque para +10 de dano. Ao derrubar ou matar com crítico, ganha um ataque corpo a corpo como ação bônus.' },
  { name: 'Curandeiro', description: 'Usar um kit de curandeiro estabiliza e cura 1d6+4 PV. Uma criatura só pode se beneficiar desse descanso uma vez entre descansos longos.' },
  { name: 'Armadura Pesada', description: 'Aumente Força em 1 (máx. 20). Você ganha proficiência com armaduras pesadas.' },
  { name: 'Mestre de Armadura Pesada', description: 'Aumente Força em 1 (máx. 20). Enquanto usa armadura pesada, dano contundente, cortante e perfurante é reduzido em 3.' },
  { name: 'Líder Inspirador', description: 'Gaste 10 minutos inspirando aliados para conceder PV temporários iguais ao seu nível + modificador de Carisma (mínimo 1), uma vez por descanso.' },
  { name: 'Mente Aguçada', description: 'Aumente Inteligência em 1 (máx. 20). Você sempre sabe a direção do norte, quantas horas faltam para o próximo amanhecer e pode lembrar de qualquer coisa vista ou ouvida no último mês.' },
  { name: 'Armadura Leve', description: 'Aumente Força ou Destreza em 1 (máx. 20). Você ganha proficiência com armaduras leves.' },
  { name: 'Linguista', description: 'Aumente Inteligência em 1 (máx. 20). Você aprende três idiomas e pode criar cifras escritas que só quem você ensinar consegue decifrar.' },
  { name: 'Sortudo', description: 'Você tem 3 pontos de sorte. Pode gastar 1 para rolar um dado adicional em um ataque, teste ou salvaguarda seu, ou para forçar a rerrolagem de um ataque contra você.' },
  { name: 'Matador de Magos', description: 'Criaturas a até 1,5 m têm desvantagem em conjurar; você pode usar a reação para atacar quem conjura e tem vantagem em salvaguardas contra magias de criaturas adjacentes.' },
  { name: 'Iniciação em Magia', description: 'Escolha uma classe: você aprende dois truques e uma magia de 1º nível dela, usando o atributo de conjuração dessa classe.' },
  { name: 'Adepto Marcial', description: 'Você aprende duas manobras de Mestre de Batalha e ganha um dado de superioridade d6 (recuperado em descanso).' },
  { name: 'Mestre de Armadura Média', description: 'Aumente Destreza em 1 (máx. 20). Armaduras médias não impõem desvantagem em Furtividade e permitem somar até +3 de Destreza à CA.' },
  { name: 'Móvel', description: 'Seu deslocamento aumenta em 3 m; terreno difícil não custa movimento extra ao Disparar e você não provoca ataques de oportunidade ao se mover depois de atacar.' },
  { name: 'Armadura Moderada', description: 'Aumente Força ou Destreza em 1 (máx. 20). Você ganha proficiência com armaduras médias e escudos.' },
  { name: 'Combatente Montado', description: 'Você tem vantagem em ataques contra criaturas menores que a sua montaria, pode redirecionar ataques contra ela para você e provoca apenas metade dos ataques de oportunidade.' },
  { name: 'Observador', description: 'Aumente Inteligência ou Sabedoria em 1 (máx. 20). Você lê lábios e ganha +5 em Percepção e Investigação passivas.' },
  { name: 'Mestre de Haste', description: 'Ao atacar com arma de haste, pode atacar com a extremidade oposta como ação bônus. Criaturas que entram no seu alcance provocam ataque de oportunidade.' },
  { name: 'Resiliente', description: 'Escolha um atributo; aumente-o em 1 (máx. 20) e ganhe proficiência nas salvaguardas desse atributo.' },
  { name: 'Conjurador Ritual', description: 'Você aprende duas magias ritualísticas de 1º nível de uma classe escolhida e pode copiar outras magias ritualísticas que encontrar.' },
  { name: 'Atacante Selvagem', description: 'Uma vez por turno, ao rolar o dano de uma arma corpo a corpo, você pode rerrolar os dados e usar o resultado que preferir.' },
  { name: 'Sentinela', description: 'Quando acerta um ataque de oportunidade, o deslocamento do alvo vira 0. Criaturas que se afastam provocam ataque mesmo desengajando, e você pode atacar quem ataca um aliado adjacente.' },
  { name: 'Atirador de Elite', description: 'Você atira a longa distância sem desvantagem, ignora cobertura parcial e três quartos, e pode sofrer -5 no ataque por +10 de dano à distância.' },
  { name: 'Mestre de Escudo', description: 'Se acertar um ataque no seu turno, pode usar a ação bônus para empurrar o alvo com o escudo; pode somar o bônus do escudo em salvaguardas de Destreza contra efeitos de área.' },
  { name: 'Habilidoso', description: 'Você ganha proficiência em quaisquer três perícias ou ferramentas.' },
  { name: 'Furtivo', description: 'Aumente Destreza em 1 (máx. 20). Você pode se esconder mesmo com pouca cobertura, não é percebido por visão no escuro a longa distância e erra o alvo sem revelar a posição.' },
  { name: 'Atirador de Magias', description: 'Suas magias de ataque dobram o alcance e ignoram cobertura parcial e três quartos. Aprender uma magia que exige ataque não precisa ser de perto.' },
  { name: 'Brutamontes de Taverna', description: 'Aumente Força ou Constituição em 1 (máx. 20). Você é proficiente em ataques desarmados e armas improvisadas, e pode agarrar como ação bônus após acertar.' },
  { name: 'Vigoroso', description: 'Aumente Constituição em 1 (máx. 20). Seus pontos de vida máximos aumentam em 2 por nível.' },
  { name: 'Conjurador de Guerra', description: 'Você tem vantagem em salvaguardas de Constituição para manter concentração, pode conjurar com as mãos ocupadas e pode fazer gestos somáticos mesmo com armas e escudo.' },
  { name: 'Mestre de Armas', description: 'Aumente Força ou Destreza em 1 (máx. 20). Você ganha proficiência com quatro armas simples ou marciais à sua escolha.' },
];
