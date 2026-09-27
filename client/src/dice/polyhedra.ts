/**
 * Geometria dos dados de RPG.
 *
 * Cada dado é um poliedro regular de verdade (ou a melhor aproximação do PHB):
 *
 *  - d4  — tetraedro
 *  - d6  — cubo
 *  - d8  — octaedro
 *  - d10 — bipirâmide pentagonal (aproxima o trapezoedro pentagonal)
 *  - d12 — dodecaedro
 *  - d20 — icosaedro
 *  - d100 — bipirâmide pentagonal (o valor sai no selo, pois 10 faces não
 *           representam 100 números)
 *
 * Para cada face calculamos o polígono (clip-path) e a matriz `matrix3d` que a
 * coloca no espaço. Assim o CSS monta um poliedro 3D de verdade; as faces são
 * pintadas dos dois lados, então a casca do dado fica fechada (nenhuma fresta
 * deixa ver o fundo). O dado gira e pousa mostrando a face do resultado para a
 * câmera.
 */

export type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mulS = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: V3): V3 => {
  const l = length(a) || 1;
  return mulS(a, 1 / l);
};
const centroid = (vs: V3[]): V3 =>
  mulS(
    vs.reduce((sum, v) => add(sum, v), [0, 0, 0] as V3),
    1 / vs.length,
  );

/** Normaliza os vértices para a esfera de raio 1 (mantém a forma). */
function onSphere(vertices: V3[]): V3[] {
  const radius = Math.max(...vertices.map(length));
  return vertices.map((v) => mulS(v, 1 / radius));
}

/* ---------------------------------------------------------------------------
 * Matrizes 4x4 (coluna-maior, no formato do CSS `matrix3d`)
 * ------------------------------------------------------------------------- */

type M4 = number[];

const IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: M4, b: M4): M4 {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** Matriz cujas colunas são a base (u, w, n) e a translação t. */
function fromBasis(u: V3, w: V3, n: V3, t: V3): M4 {
  return [u[0], u[1], u[2], 0, w[0], w[1], w[2], 0, n[0], n[1], n[2], 0, t[0], t[1], t[2], 1];
}

function translation(x: number, y: number, z: number): M4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/** Rotação de `angle` radianos em torno de `axis` (Rodrigues). */
function rotationAxis(axis: V3, angle: number): M4 {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;

  const r00 = c + x * x * t;
  const r01 = x * y * t - z * s;
  const r02 = x * z * t + y * s;
  const r10 = y * x * t + z * s;
  const r11 = c + y * y * t;
  const r12 = y * z * t - x * s;
  const r20 = z * x * t - y * s;
  const r21 = z * y * t + x * s;
  const r22 = c + z * z * t;

  return [r00, r10, r20, 0, r01, r11, r21, 0, r02, r12, r22, 0, 0, 0, 0, 1];
}

/** Rotação que leva o vetor `from` a apontar para `to`. */
function rotationBetween(from: V3, to: V3): M4 {
  const a = normalize(from);
  const b = normalize(to);
  const d = Math.max(-1, Math.min(1, dot(a, b)));

  if (d > 0.999999) return IDENTITY;
  if (d < -0.999999) {
    const axis = Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]);
    return rotationAxis(axis, Math.PI);
  }

  return rotationAxis(cross(a, b), Math.acos(d));
}

const toCss = (m: M4): string => `matrix3d(${m.map((v) => Number(v.toFixed(5))).join(',')})`;

/* ---------------------------------------------------------------------------
 * Poliedros (vértices + faces)
 * ------------------------------------------------------------------------- */

interface Polyhedron {
  vertices: V3[];
  faces: number[][];
}

const PHI = (1 + Math.sqrt(5)) / 2;

const TETRA: Polyhedron = {
  vertices: onSphere([
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ]),
  faces: [
    [0, 1, 2],
    [0, 3, 1],
    [0, 2, 3],
    [1, 3, 2],
  ],
};

const OCTA: Polyhedron = {
  vertices: onSphere([
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]),
  faces: [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ],
};

function buildCube(): Polyhedron {
  return {
    vertices: onSphere([
      [1, 1, 1],
      [1, 1, -1],
      [1, -1, 1],
      [1, -1, -1],
      [-1, 1, 1],
      [-1, 1, -1],
      [-1, -1, 1],
      [-1, -1, -1],
    ]),
    faces: [
      [0, 1, 3, 2],
      [4, 6, 7, 5],
      [0, 4, 5, 1],
      [2, 3, 7, 6],
      [0, 2, 6, 4],
      [1, 5, 7, 3],
    ],
  };
}

/** Bipirâmide de `sides` lados (d10 e d100). */
function buildBipyramid(sides: number, apex = 1.25, radius = 1): Polyhedron {
  const vertices: V3[] = [
    [0, apex, 0],
    [0, -apex, 0],
  ];
  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2;
    vertices.push([Math.cos(angle) * radius, 0, Math.sin(angle) * radius]);
  }

  const faces: number[][] = [];
  for (let i = 0; i < sides; i += 1) {
    const a = 2 + i;
    const b = 2 + ((i + 1) % sides);
    faces.push([0, a, b]);
    faces.push([1, b, a]);
  }

  return { vertices: onSphere(vertices), faces };
}

/** Lista de vizinhos de cada vértice (por aresta = menor distância). */
function adjacency(vertices: V3[]): number[][] {
  let minimum = Infinity;
  for (let i = 0; i < vertices.length; i += 1) {
    for (let j = i + 1; j < vertices.length; j += 1) {
      minimum = Math.min(minimum, length(sub(vertices[i], vertices[j])));
    }
  }
  const epsilon = minimum * 1.05;

  return vertices.map((v, i) =>
    vertices.map((_, j) => j).filter((j) => j !== i && length(sub(v, vertices[j])) < epsilon),
  );
}

/** Ordena os vizinhos de um vértice pelo ângulo em torno da normal. */
function sortAround(vertices: V3[], index: number, neighbours: number[]): number[] {
  const normal = normalize(vertices[index]);
  const reference = normalize(sub(vertices[neighbours[0]], vertices[index]));
  const binormal = cross(normal, reference);

  return [...neighbours].sort((a, b) => {
    const pa = sub(vertices[a], vertices[index]);
    const pb = sub(vertices[b], vertices[index]);
    return Math.atan2(dot(pa, binormal), dot(pa, reference)) -
      Math.atan2(dot(pb, binormal), dot(pb, reference));
  });
}

/** Faces triangulares a partir da vizinhança (tetra/octa/icosa). */
function triangleFaces(vertices: V3[]): number[][] {
  const adj = adjacency(vertices);
  const seen = new Map<string, number[]>();

  vertices.forEach((_, i) => {
    const ordered = sortAround(vertices, i, adj[i]);
    for (let t = 0; t < ordered.length; t += 1) {
      const a = ordered[t];
      const b = ordered[(t + 1) % ordered.length];
      const key = [i, a, b].sort((x, y) => x - y).join('-');
      if (!seen.has(key)) seen.set(key, [i, a, b]);
    }
  });

  return [...seen.values()];
}

function buildIcosahedron(): Polyhedron {
  const vertices = onSphere([
    [0, 1, PHI],
    [0, 1, -PHI],
    [0, -1, PHI],
    [0, -1, -PHI],
    [1, PHI, 0],
    [1, -PHI, 0],
    [-1, PHI, 0],
    [-1, -PHI, 0],
    [PHI, 0, 1],
    [PHI, 0, -1],
    [-PHI, 0, 1],
    [-PHI, 0, -1],
  ]);

  return { vertices, faces: triangleFaces(vertices) };
}

/**
 * Dodecaedro: dual do icosaedro. Os 12 pentágonos nascem dos 12 vértices do
 * icosaedro; cada face reúne os centros das 5 faces do icosaedro em volta dele.
 */
function buildDodecahedron(): Polyhedron {
  const { vertices: icoVertices, faces: icoFaces } = buildIcosahedron();
  const vertices = icoFaces.map((face) => normalize(centroid(face.map((i) => icoVertices[i]))));

  const faceIndex = new Map<string, number>();
  icoFaces.forEach((face, index) => {
    faceIndex.set([...face].sort((a, b) => a - b).join('-'), index);
  });

  const adj = adjacency(icoVertices);
  const faces: number[][] = [];

  icoVertices.forEach((_, i) => {
    const ordered = sortAround(icoVertices, i, adj[i]);
    const polygon: number[] = [];
    for (let t = 0; t < ordered.length; t += 1) {
      const a = ordered[t];
      const b = ordered[(t + 1) % ordered.length];
      const index = faceIndex.get([i, a, b].sort((x, y) => x - y).join('-'));
      if (index !== undefined) polygon.push(index);
    }
    if (polygon.length === ordered.length) faces.push(polygon);
  });

  return { vertices, faces };
}

const cache = new Map<number, Polyhedron>();

function polyhedronFor(sides: number): Polyhedron {
  const cached = cache.get(sides);
  if (cached) return cached;

  let polyhedron: Polyhedron;
  switch (sides) {
    case 4:
      polyhedron = TETRA;
      break;
    case 6:
      polyhedron = buildCube();
      break;
    case 8:
      polyhedron = OCTA;
      break;
    case 10:
      polyhedron = buildBipyramid(5);
      break;
    case 12:
      polyhedron = buildDodecahedron();
      break;
    case 20:
      polyhedron = buildIcosahedron();
      break;
    default:
      polyhedron = buildBipyramid(5);
      break;
  }

  cache.set(sides, polyhedron);
  return polyhedron;
}

/* ---------------------------------------------------------------------------
 * Faces prontas para o CSS
 * ------------------------------------------------------------------------- */

/** Escala do modelo: raio 1 vira 100 unidades de CSS (depois o `.die` escala). */
const MODEL_SCALE = 100;

export interface DieFace {
  key: number;
  /** Valor pintado na face (1..sides) ou `null` quando a face não leva número. */
  value: number | null;
  clipPath: string;
  transform: string;
  /** Lado do quadrado da face, em px do modelo. */
  size: number;
  /** Centro do polígono dentro da face, em % (onde o número é desenhado). */
  valueX: number;
  valueY: number;
  /**
   * Tamanho do número que cabe na face, em px do modelo (a face é desenhada
   * como um quadrado de `size`; o número escala junto com o poliedro).
   */
  valueSize: number;
  /** Normal para fora, no espaço do modelo. */
  normal: V3;
}

/**
 * Folga das faces: cada face é um pouco maior que o polígono exato (a escala é
 * em torno do centroide da própria face), só o bastante para as arestas
 * vizinhas se sobreporem no antialias. As faces também são pintadas dos dois
 * lados, então uma fresta nunca mostra o fundo do ring.
 */
const FACE_OUTSET = 1.03;

/** Distância da origem (o centroide) ao segmento AB — usada para achar o
 *  círculo inscrito no polígono da face. */
function distanceToSegment(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function buildFace(vertices: V3[], indices: number[], value: number | null, key: number): DieFace {
  const points = indices.map((index) => vertices[index]);
  const center = centroid(points);

  let normal = normalize(cross(sub(points[1], points[0]), sub(points[2], points[0])));
  if (dot(normal, center) < 0) normal = mulS(normal, -1);

  const u = normalize(sub(points[0], center));
  const w = cross(normal, u);

  const flat = points.map((point) => {
    const d = sub(point, center);
    return [dot(d, u), dot(d, w)] as [number, number];
  });

  const minX = Math.min(...flat.map((p) => p[0]));
  const maxX = Math.max(...flat.map((p) => p[0]));
  const minY = Math.min(...flat.map((p) => p[1]));
  const maxY = Math.max(...flat.map((p) => p[1]));
  const width = maxX - minX;
  const height = maxY - minY;
  const side = Math.max(width, height);
  const offsetX = (side - width) / 2;
  const offsetY = (side - height) / 2;

  const percentX = (x: number): number => ((x - minX + offsetX) / side) * 100;
  const percentY = (y: number): number => ((y - minY + offsetY) / side) * 100;

  const clipPath = `polygon(${flat
    .map(([x, y]) => `${percentX(x).toFixed(2)}% ${percentY(y).toFixed(2)}%`)
    .join(',')})`;

  // O número vai no centro (centroide) do polígono, não no centro da caixa.
  // Por construção as coordenadas 2D são relativas ao centroide, então ele é a
  // origem (0, 0).
  const valueX = percentX(0);
  const valueY = percentY(0);

  // Maior número que cabe na face: um círculo de raio `edgeDistance` (a menor
  // distância do centro até as arestas) delimita altura e largura do texto.
  // Números de um dígito podem ser maiores que os de dois ("20" é mais largo).
  const edgeDistance = Math.min(
    ...flat.map(([x, y], index) => {
      const [nx, ny] = flat[(index + 1) % flat.length];
      return distanceToSegment(x, y, nx, ny);
    }),
  );
  const valueFit = value !== null && value < 10 ? 1.5 : 1.25;
  const valueSize = edgeDistance * MODEL_SCALE * FACE_OUTSET * valueFit;

  // Pivô da face: a posição do centroide (origem de `flat`) dentro do quadrado
  // da face, em px do modelo. É o MESMO ponto onde o número é desenhado
  // (`valueX`/`valueY`, já que `local = percentual / 100 * size`).
  //
  // Não dá para usar o meio do quadrado (`size / 2`): a caixa do polígono só é
  // simétrica em torno do centroide nas faces com simetria de 180° (o quadrado
  // do d6). Nas faces triangulares e pentagonais o centroide fica fora do meio
  // da caixa, e o pivô errado desliza a face dentro do próprio plano dela — a
  // superfície abre frestas entre faces vizinhas e deixa ver o fundo do ring.
  const centerOffsetX = (-minX + offsetX) * MODEL_SCALE * FACE_OUTSET;
  const centerOffsetY = (-minY + offsetY) * MODEL_SCALE * FACE_OUTSET;

  const transform = toCss(
    multiply(
      translation(center[0] * MODEL_SCALE, center[1] * MODEL_SCALE, center[2] * MODEL_SCALE),
      multiply(
        fromBasis(u, w, normal, [0, 0, 0]),
        translation(-centerOffsetX, -centerOffsetY, 0),
      ),
    ),
  );

  return {
    key,
    value,
    clipPath,
    transform,
    size: side * MODEL_SCALE * FACE_OUTSET,
    valueX,
    valueY,
    valueSize,
    normal,
  };
}

const faceCache = new Map<number, DieFace[]>();

/** Faces do dado (memoizadas por quantidade de lados). */
export function dieFaces(sides: number): DieFace[] {
  const cached = faceCache.get(sides);
  if (cached) return cached;

  const { vertices, faces } = polyhedronFor(sides);
  // Só dá para pintar 1..sides quando o número de faces bate (d4..d20).
  const paint = faces.length === sides;
  const built = faces.map((indices, index) => buildFace(vertices, indices, paint ? index + 1 : null, index));

  faceCache.set(sides, built);
  return built;
}

/** `true` quando o dado mostra o valor pintado na própria face. */
export function paintsValues(sides: number): boolean {
  return polyhedronFor(sides).faces.length === sides;
}

/**
 * Orientação do dado para que a face de `value` fique de frente para a câmera.
 * Sem valor (d100), devolve uma inclinação suave e agradável.
 */
export function settleTransform(sides: number, value: number): string {
  const face = dieFaces(sides).find((item) => item.value === value);
  if (!face) {
    return toCss(multiply(rotationAxis([1, 1, 0.3], 0.35), rotationAxis([0, 1, 0], -0.5)));
  }
  return toCss(rotationBetween(face.normal, [0, 0, 1]));
}
