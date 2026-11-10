import { useEffect, useId, useState } from 'react';

/**
 * O dado do Teste contra a Morte.
 *
 * Não é o d20 numérico: a bandeja de morte mostra a PLACA da face sorteada,
 * desenhada aqui em SVG (sem nenhum arquivo de imagem). A leitura é a mesma da
 * mesa:
 *
 *   1       caveira rachada (falha crítica) — a rachadura é o aviso
 *   2..9    caveira com ossos cruzados (falha)
 *   10..19  coração (sucesso)
 *   20      mãos rezando, com faíscas (sucesso crítico)
 *
 * A brasa vermelha e o dourado são classes de CSS (`is-fumble` / `is-crit`),
 * aplicadas só no resultado final — durante o giro a placa troca de face.
 */

const PEDRA_ESCURA = '#8f8678';
const BURACO = '#120c0b';
const LATAO = '#c9a468';
const TRACO = '#2b201b';

interface Tons {
  /** `url(#...)` da pedra clara, com gradiente para parecer entalhada. */
  pedra: string;
  /** `url(#...)` do buraco das órbitas e do nariz. */
  vazio: string;
}

type Face = 'critico-falha' | 'falha' | 'sucesso' | 'critico-sucesso';

function faceDe(value: number): Face {
  if (value <= 1) return 'critico-falha';
  if (value >= 20) return 'critico-sucesso';
  if (value >= 10) return 'sucesso';
  return 'falha';
}

/** Leitura da face para leitores de tela. */
function leitura(value: number): string {
  if (value <= 1) return '1 — caveira rachada: falha crítica';
  if (value >= 20) return '20 — mãos rezando: sucesso crítico';
  if (value >= 10) return `${value} — coração: sucesso`;
  return `${value} — caveira com ossos cruzados: falha`;
}

/** A caveira: crânio, mandíbula, órbitas fundas, nariz e dentes. */
function Caveira({ tons, rachada = false }: { tons: Tons; rachada?: boolean }) {
  return (
    <g stroke={TRACO} strokeWidth="0.7" strokeLinejoin="round">
      <path
        d="M50 33.4C40.4 33.4 33.4 40.4 33.4 50.2c0 5.2 2 9 5.2 11.6l.8 1.2c.5.7 1.4 1.2 2.3 1.2h16.6c.9 0 1.8-.5 2.3-1.2l.8-1.2c3.2-2.6 5.2-6.4 5.2-11.6 0-9.8-7-16.8-16.6-16.8z"
        fill={tons.pedra}
      />
      <path
        d="M42.6 64.2h14.8v4.4c0 2.8-2.3 5-5.1 5h-4.6c-2.8 0-5.1-2.2-5.1-5z"
        fill={tons.pedra}
      />
      {/* Sombra de dentro do crânio, para a pedra não ficar chapada. */}
      <path
        d="M50 33.4C40.4 33.4 33.4 40.4 33.4 50.2c0 5.2 2 9 5.2 11.6l.8 1.2c.5.7 1.4 1.2 2.3 1.2H50z"
        fill="#000000"
        opacity="0.09"
        stroke="none"
      />
      <ellipse cx="43.6" cy="49.4" rx="4.5" ry="5.1" transform="rotate(-9 43.6 49.4)" fill={tons.vazio} />
      <ellipse cx="56.4" cy="49.4" rx="4.5" ry="5.1" transform="rotate(9 56.4 49.4)" fill={tons.vazio} />
      {/* Arcada acima das órbitas. */}
      <path
        d="M37.6 43.6c2.2-2 5.2-3 8.4-2.8M62.4 43.6c-2.2-2-5.2-3-8.4-2.8"
        fill="none"
        stroke="#000000"
        strokeWidth="0.9"
        opacity="0.22"
        strokeLinecap="round"
      />
      <path
        d="M50 54.6c-1.7 0-2.8 1.3-2.8 2.8 0 .7.2 1.3.7 1.9l2.1 2.8 2.1-2.8c.5-.6.7-1.2.7-1.9 0-1.5-1.1-2.8-2.8-2.8z"
        fill={tons.vazio}
      />
      <path d="M43.8 65.2c4.1 1.3 8.3 1.3 12.4 0" fill="none" stroke={BURACO} strokeWidth="1.1" />
      <path
        d="M46 65.8v4M48.7 66.1v4.2M51.3 66.1v4.2M54 65.8v4"
        fill="none"
        stroke={BURACO}
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M36.4 55.4c1.4 2.4 3.4 4 5.6 4.8M63.6 55.4c-1.4 2.4-3.4 4-5.6 4.8"
        fill="none"
        stroke={PEDRA_ESCURA}
        strokeWidth="0.8"
        opacity="0.55"
        strokeLinecap="round"
      />
      {rachada ? (
        <g fill="none" stroke={BURACO} strokeLinecap="round">
          <path d="M52.4 33.8l3.4 7-4 4.2 5.4 3.6-2.8 6 4.4 2.6" strokeWidth="1.7" />
          <path d="M55.8 40.8l6-2.6M51.8 45l-6.2 1.4M54.4 54.6l5.6 1.6" strokeWidth="1.2" />
        </g>
      ) : null}
    </g>
  );
}

/** Um osso; a cabeça de cada ponta é dupla, como no desenho de caveira. */
function Osso({ tons }: { tons: Tons }) {
  return (
    <g fill={tons.pedra} stroke={TRACO} strokeWidth="0.6">
      <rect x="-16" y="-1.7" width="32" height="3.4" rx="1.7" />
      <circle cx="-16" cy="-1.9" r="2.4" />
      <circle cx="-16" cy="1.9" r="2.4" />
      <circle cx="16" cy="-1.9" r="2.4" />
      <circle cx="16" cy="1.9" r="2.4" />
    </g>
  );
}

/** O coração de pedra do sucesso. */
function Coracao({ tons, recorte }: { tons: Tons; recorte: string }) {
  const coracao =
    'M50 73.5C46.8 70.8 30 58.6 30 45.8 30 38.4 35.6 32.6 42.4 32.6c3.6 0 6.4 1.6 7.6 4 1.2-2.4 4-4 7.6-4C64.4 32.6 70 38.4 70 45.8 70 58.6 53.2 70.8 50 73.5z';
  return (
    <g>
      {/* O sombreado vive dentro do próprio coração, recortado pelo contorno. */}
      <clipPath id={recorte}>
        <path d={coracao} />
      </clipPath>
      <g clipPath={`url(#${recorte})`}>
        <path d={coracao} fill={tons.pedra} />
        <ellipse cx="65" cy="61" rx="19" ry="17" fill="#000000" opacity="0.13" />
        <ellipse cx="41" cy="41" rx="12" ry="9" fill="#fff8ea" opacity="0.25" transform="rotate(-26 41 41)" />
      </g>
      <path d={coracao} fill="none" stroke={TRACO} strokeWidth="0.7" strokeLinejoin="round" />
      <path
        d="M37.4 42.4c1-2.4 3.2-4.2 5.8-4.8"
        fill="none"
        stroke="#fff8ea"
        strokeWidth="1.8"
        opacity="0.45"
        strokeLinecap="round"
      />
    </g>
  );
}

/**
 * Uma mão da reza: dedos em leque (cada um com contorno próprio, para a leitura
 * não virar uma peça só), palma fechada, polegar na frente e manga na base. A
 * outra mão é este desenho espelhado, encostado na linha do meio.
 */
const DEDOS = [
  { x: 43.4, angulo: -12, comprimento: 16.4, largura: 2.4 },
  { x: 45.7, angulo: -7, comprimento: 19.4, largura: 2.4 },
  { x: 48, angulo: -3, comprimento: 20.6, largura: 2.4 },
  { x: 49.6, angulo: 1, comprimento: 19.8, largura: 2.4 },
];
const PALMA = 'M41.4 52.2H50v11.8c0 2.6-2.1 4.7-4.7 4.7h-1.1c-2.6 0-4.8-2.1-4.8-4.8z';
const MANGA = 'M39 66.2H50l-.7 8.6h-8.1c-1.2 0-2.1-1-2.1-2.2z';

function Mao({ tons }: { tons: Tons }) {
  return (
    <g>
      <g fill={tons.pedra} stroke={TRACO} strokeWidth="0.55">
        {DEDOS.map((dedo, i) => (
          <rect
            key={i}
            x={-dedo.largura / 2}
            y={-dedo.comprimento}
            width={dedo.largura}
            height={dedo.comprimento + 6}
            rx={dedo.largura / 2}
            transform={`translate(${dedo.x} 55) rotate(${dedo.angulo})`}
          />
        ))}
        {/* polegar */}
        <rect x="-1.9" y="-2" width="3.8" height="12" rx="1.9" transform="translate(40.6 56) rotate(17)" />
      </g>
      <path d={PALMA} fill={tons.pedra} />
      <path
        d="M41.4 52.2v11.8c0 2.6 2.2 4.7 4.8 4.8h1.1c2.6 0 4.7-2.1 4.7-4.7"
        fill="none"
        stroke={TRACO}
        strokeWidth="0.55"
        strokeLinecap="round"
      />
      <path d={MANGA} fill={PEDRA_ESCURA} stroke={TRACO} strokeWidth="0.55" strokeLinejoin="round" />
    </g>
  );
}

function MaosRezando({ tons }: { tons: Tons }) {
  return (
    <g>
      <Mao tons={tons} />
      <g transform="translate(100 0) scale(-1 1)">
        <Mao tons={tons} />
      </g>
      {/* O encontro das duas palmas. */}
      <path d="M50 34.6V73" stroke={BURACO} strokeWidth="0.6" opacity="0.55" />
    </g>
  );
}

/** Faísca de quatro pontas, para o sucesso crítico. */
const FAISCA = 'M0 -3.4 0.95 -0.95 3.4 0 0.95 0.95 0 3.4 -0.95 0.95 -3.4 0 -0.95 -0.95Z';

interface DeathDieProps {
  /** Resultado do d20 (1..20) ou `null` enquanto o dado gira. */
  value: number | null;
  /** Dado em movimento: troca de face em vez de mostrar o resultado. */
  tumbling?: boolean;
}

export function DeathDie({ value, tumbling = false }: DeathDieProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
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

  const numero = tumbling ? giro : value ?? giro;
  const face = faceDe(numero);
  const tons: Tons = { pedra: `url(#${id}-pedra)`, vazio: `url(#${id}-vazio)` };
  const classe = [
    'ddeath',
    tumbling ? 'is-tumbling' : '',
    !tumbling && value !== null ? 'is-revealed' : '',
    face === 'critico-falha' ? 'is-fumble' : '',
    face === 'critico-sucesso' ? 'is-crit' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={classe}
      role="img"
      aria-label={tumbling || value === null ? 'Dado do Teste contra a Morte girando' : leitura(value)}
    >
      <svg className="ddeath-svg" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-obsidiana`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2a2028" />
            <stop offset="0.55" stopColor="#141110" />
            <stop offset="1" stopColor="#1b1518" />
          </linearGradient>
          <linearGradient id={`${id}-pedra`} x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="#f4ecdc" />
            <stop offset="0.5" stopColor="#ded5c4" />
            <stop offset="1" stopColor="#b3a894" />
          </linearGradient>
          <radialGradient id={`${id}-vazio`}>
            <stop offset="0" stopColor="#241713" />
            <stop offset="1" stopColor="#0b0706" />
          </radialGradient>
          <radialGradient id={`${id}-brasa`}>
            <stop offset="0" stopColor="#ff6a3c" stopOpacity="0.5" />
            <stop offset="0.6" stopColor="#c22f1e" stopOpacity="0.22" />
            <stop offset="1" stopColor="#c22f1e" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-ouro`}>
            <stop offset="0" stopColor="#f4d79a" stopOpacity="0.45" />
            <stop offset="1" stopColor="#f4d79a" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* A placa: triângulo de obsidiana com aro de latão e facetas. */}
        <path d="M50 7.5 96 88H4z" fill={`url(#${id}-obsidiana)`} stroke={LATAO} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M50 15.5 88.5 82.5H11.5z" fill="none" stroke={LATAO} strokeWidth="0.7" opacity="0.5" />
        <path d="M50 15.5v67H11.5z" fill="#ffffff" opacity="0.045" />
        <path d="M50 15.5 88.5 82.5H50z" fill="#000000" opacity="0.16" />
        <path d="M50 9.2l2 2.7-2 2.7-2-2.7z" fill={LATAO} opacity="0.85" />

        {/* Brasa atrás da caveira rachada; dourado atrás das mãos. */}
        {face === 'critico-falha' ? <circle cx="50" cy="52" r="26" fill={`url(#${id}-brasa)`} /> : null}
        {face === 'critico-sucesso' ? <circle cx="50" cy="54" r="28" fill={`url(#${id}-ouro)`} /> : null}

        {face === 'critico-falha' ? <Caveira tons={tons} rachada /> : null}
        {face === 'sucesso' ? <Coracao tons={tons} recorte={`${id}-coracao`} /> : null}
        {face === 'critico-sucesso' ? <MaosRezando tons={tons} /> : null}
        {face === 'falha' ? (
          <g>
            <g transform="translate(50 63) rotate(-26)">
              <Osso tons={tons} />
            </g>
            <g transform="translate(50 63) rotate(26)">
              <Osso tons={tons} />
            </g>
            <g transform="translate(50 39) scale(0.72) translate(-50 -46)">
              <Caveira tons={tons} />
            </g>
          </g>
        ) : null}

        {/* Efeitinhos: brasa subindo na falha crítica, faíscas no sucesso crítico. */}
        {face === 'critico-falha'
          ? [0, 1, 2, 3, 4].map((i) => (
              <circle
                key={i}
                className="ddeath-ember"
                cx={40 + i * 5}
                cy={78}
                r={i % 2 ? 0.9 : 1.2}
                fill="#ff8a5c"
                style={{ animationDelay: `${i * 0.45}s` }}
              />
            ))
          : null}
        {face === 'critico-sucesso'
          ? [
              { x: 31, y: 34, s: 1 },
              { x: 69, y: 34, s: 0.8 },
              { x: 27, y: 56, s: 0.9 },
              { x: 73, y: 57, s: 1.1 },
              { x: 50, y: 26, s: 0.65 },
            ].map((f, i) => (
              <path
                key={i}
                className="ddeath-spark"
                d={FAISCA}
                transform={`translate(${f.x} ${f.y}) scale(${f.s})`}
                fill={LATAO}
                style={{ animationDelay: `${i * 0.32}s` }}
              />
            ))
          : null}
      </svg>
    </span>
  );
}
