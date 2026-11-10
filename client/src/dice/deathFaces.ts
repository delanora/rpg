import type { DieFace } from './polyhedra';

/**
 * Texturas do dado do Teste contra a Morte.
 *
 * Os vinte PNGs (`client/public/death-save/faces/face_01.png` … `face_20.png`)
 * têm 320 x 320 e trazem a placa triangular de arte com a ponta para cima. O
 * triângulo da placa, medido no canal alfa dos arquivos (ignorando o fio dos
 * ornamentos), vai da ponta em (160, 40) até a base em y 282, de x 24 a 296 —
 * quase equilátero, como a face do icosaedro.
 *
 * Cada face do d20 é um triângulo com orientação própria dentro do quadrado da
 * face (a base vem de `u`/`w`, não do "para cima" da tela). Por isso a textura é
 * colada por transformação AFIM dos três vértices da placa nos três vértices da
 * face: os três cantos coincidem, a arte gira junto com o dado e a distorção fica
 * em ~3% (as duas formas são quase equiláteras). Nada de espelhar: a ordem dos
 * vértices segue o sentido da face, e a ponta da arte é levada ao vértice que a
 * `settleTransform` deixa para cima quando a face assenta — o símbolo nunca
 * aparece de cabeça para baixo.
 */

/** Tamanho dos PNGs entregues. */
const LARGURA = 320;
const ALTURA = 320;

/** Vértices da placa dentro do PNG: ponta, canto esquerdo, canto direito. */
const PLACA: Array<[number, number]> = [
  [160, 40],
  [24, 282],
  [296, 282],
];

/**
 * A face é 3% maior que o triângulo real (`FACE_OUTSET`, para as arestas não
 * abrirem fresta). A arte encosta em 99% do triângulo real: sobra um fio de
 * obsidiana nas bordas, que é justamente o que esconde a diferença de recorte
 * entre a arte e a geometria — sem cortar o latão.
 */
const ENCAIXE = 0.99;

/** Área com sinal de um triângulo (para manter o sentido, sem espelhar). */
function areaComSinal([[x0, y0], [x1, y1], [x2, y2]]: Array<[number, number]>): number {
  return (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
}

/** Matriz CSS que leva três pontos nos três pontos pedidos. */
function afim(de: Array<[number, number]>, para: Array<[number, number]>): string {
  const [[x0, y0], [x1, y1], [x2, y2]] = de;
  const [[X0, Y0], [X1, Y1], [X2, Y2]] = para;
  const u = x1 - x0;
  const v = y1 - y0;
  const w = x2 - x0;
  const z = y2 - y0;
  const det = u * z - w * v || 1;
  const dX1 = X1 - X0;
  const dY1 = Y1 - Y0;
  const dX2 = X2 - X0;
  const dY2 = Y2 - Y0;

  // x' = ax·x + bx·y + cx   /   y' = ay·x + by·y + cy
  const ax = (dX1 * z - dX2 * v) / det;
  const bx = (dX2 * u - dX1 * w) / det;
  const cx = X0 - ax * x0 - bx * y0;
  const ay = (dY1 * z - dY2 * v) / det;
  const by = (dY2 * u - dY1 * w) / det;
  const cy = Y0 - ay * x0 - by * y0;

  return `matrix(${[ax, ay, bx, by, cx, cy].map((valor) => Number(valor.toFixed(6))).join(',')})`;
}

export interface TexturaFace {
  src: string;
  transform: string;
  largura: number;
  altura: number;
}

/**
 * Textura da face para o valor pintado nela, ou `null` em face sem número (o d10
 * e o d100 não têm 1:1 entre faces e resultados).
 */
export function texturaDaFace(face: DieFace): TexturaFace | null {
  if (face.value === null || face.polygon.length !== 3) return null;

  const [centroX, centroY] = face.center;
  // Direção que fica "para cima" na tela quando esta face assenta.
  const cima: [number, number] = [Math.sin(face.upAngle), -Math.cos(face.upAngle)];

  const encolher = ([x, y]: [number, number]): [number, number] => [
    centroX + (x - centroX) * ENCAIXE,
    centroY + (y - centroY) * ENCAIXE,
  ];
  const alvos = face.polygon.map(encolher);

  // A ponta da arte vai para o vértice mais alinhado com o "para cima".
  const direcao = ([x, y]: [number, number]): number => {
    const dx = x - centroX;
    const dy = y - centroY;
    const comprimento = Math.hypot(dx, dy) || 1;
    return (dx * cima[0] + dy * cima[1]) / comprimento;
  };
  const indices = [0, 1, 2].sort((a, b) => direcao(alvos[b]) - direcao(alvos[a]));
  const ponta = indices[0];
  const [restoA, restoB] = [indices[1], indices[2]];

  // A ordem dos outros dois mantém o sentido da placa (senão a arte espelha).
  const ordem: Array<[number, number]> =
    Math.sign(areaComSinal(PLACA)) === Math.sign(areaComSinal([alvos[ponta], alvos[restoA], alvos[restoB]]))
      ? [alvos[ponta], alvos[restoA], alvos[restoB]]
      : [alvos[ponta], alvos[restoB], alvos[restoA]];

  return {
    src: `/death-save/faces/face_${String(face.value).padStart(2, '0')}.png`,
    transform: afim(PLACA, ordem),
    largura: LARGURA,
    altura: ALTURA,
  };
}
