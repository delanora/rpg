import { useEffect, useState } from 'react';

/**
 * O dado do Teste contra a Morte.
 *
 * Aqui não entra o d20 de CSS 3D: a mesa desenhou as 20 faces do dado e a folha
 * entregue (atlas de 5x4) já as traz na ordem dos números —
 *
 *   1       caveira grande
 *   2..9    caveira com ossos cruzados
 *   10..19  coração
 *   20      mãos rezando
 *
 * —, então a face sorteada é o RECORTE da célula certa, sem nada redesenhado em
 * CSS. Só quatro arquivos são necessários, porque 2..9 são a mesma face e 10..19
 * também (`client/scripts/crop-death-faces.mjs` gera os recortes e registra de
 * onde cada um veio). Enquanto o resultado não chega, as faces trocam rápido,
 * como um dado girando.
 */

/** Face exibida para cada resultado do d20. */
function arteDaFace(value: number): string {
  if (value <= 1) return '/death-save/face-1.png';
  if (value >= 20) return '/death-save/face-20.png';
  if (value >= 10) return '/death-save/face-success.png';
  return '/death-save/face-fail.png';
}

/** Leitura da face para leitores de tela. */
function leitura(value: number): string {
  if (value <= 1) return '1 — caveira: falha crítica';
  if (value >= 20) return '20 — mãos rezando: sucesso crítico';
  if (value >= 10) return `${value} — coração: sucesso`;
  return `${value} — caveira com ossos cruzados: falha`;
}

interface DeathDieProps {
  /** Resultado do d20 (1..20) ou `null` enquanto o dado gira. */
  value: number | null;
  /** Dado em movimento: embaralha as faces em vez de mostrar a final. */
  tumbling?: boolean;
}

export function DeathDie({ value, tumbling = false }: DeathDieProps) {
  // Durante a rolagem a face troca na mão; parado, mostra o resultado.
  const [giro, setGiro] = useState(1);

  useEffect(() => {
    if (!tumbling) return;
    let passo = 0;
    const relogio = window.setInterval(() => {
      // Anda de 3 em 3 para o olho não conseguir acompanhar uma sequência.
      passo = (passo + 3) % 20;
      setGiro(passo + 1);
    }, 85);
    return () => window.clearInterval(relogio);
  }, [tumbling]);

  const face = tumbling ? giro : value ?? giro;
  const classe = [
    'ddeath',
    tumbling ? 'is-tumbling' : '',
    !tumbling && value !== null ? 'is-revealed' : '',
    value === 1 ? 'is-fumble' : '',
    value === 20 ? 'is-crit' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={classe}
      role="img"
      aria-label={tumbling || value === null ? 'Dado do Teste contra a Morte girando' : leitura(value)}
      style={{ backgroundImage: `url('${arteDaFace(face)}')` }}
    />
  );
}
