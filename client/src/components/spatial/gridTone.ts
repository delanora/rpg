/**
 * 6.6M.4.1.2 — CONTRASTE DA GRADE (SÓ APRESENTAÇÃO).
 *
 * A cor da linha adapta-se à imagem de fundo da cena: mapa escuro → linha clara
 * e quente; mapa claro → linha escura e quente. Nada aqui é regra: nenhum
 * módulo mecânico (gridMath, câmera, movimento, paredes) importa este arquivo,
 * e o resultado nunca vai para o servidor.
 *
 * As funções são PURAS de propósito — a escolha de tom é testável sem DOM e a
 * mesma decisão vale no preview do editor e no grid de combate.
 */

/** Esquema da LINHA da grade (não do fundo). */
export type GridTone = 'light' | 'dark';

/**
 * Paleta Obsyrium: marfim/latão claro sobre arte escura, marrom profundo sobre
 * arte clara. Sem azul/verde/vermelho e sem branco/preto puros — a grade é
 * referência discreta, não elemento gráfico.
 */
export const GRID_LINE_COLOR: Record<GridTone, string> = {
  light: 'rgba(236, 214, 160, 0.42)',
  dark: 'rgba(56, 38, 22, 0.55)',
};

/** Luminância média (0..255) a partir da qual o fundo conta como CLARO. */
export const GRID_TONE_THRESHOLD = 128;

/** Cor de traço do tom escolhido. */
export function gridLineColor(tone: GridTone): string {
  return GRID_LINE_COLOR[tone];
}

/** Luminância perceptual (Rec. 601) de um pixel opaco. */
export function luminanceOfRgb(r: number, g: number, b: number): number {
  const clamp = (value: number): number => (Number.isFinite(value) ? Math.min(255, Math.max(0, value)) : 0);
  return 0.299 * clamp(r) + 0.587 * clamp(g) + 0.114 * clamp(b);
}

/**
 * Média de luminância de um buffer RGBA (o retorno de `ImageData.data`).
 *
 * Pixels transparentes não pesam na média (área vazia de PNG não deve escurecer
 * a leitura) e alpha parcial entra ponderado. `null` quando não há amostra
 * utilizável — quem chama cai no fallback, nunca em regra.
 */
export function averageLuminanceOfSamples(pixels: ArrayLike<number>): number | null {
  let total = 0;
  let weight = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = Number(pixels[index + 3] ?? 0);
    if (!Number.isFinite(alpha) || alpha < 16) continue;
    const luminance = luminanceOfRgb(
      Number(pixels[index] ?? 0),
      Number(pixels[index + 1] ?? 0),
      Number(pixels[index + 2] ?? 0),
    );
    total += luminance * (alpha / 255);
    weight += alpha / 255;
  }
  if (weight <= 0) return null;
  return total / weight;
}

/**
 * Fundo escuro → grade CLARA; fundo claro → grade ESCURA.
 *
 * Sem amostra (imagem falhou, canvas tainted, navegador sem suporte) o fallback
 * é a grade clara sobre a superfície escura padrão do Obsyrium — nunca uma
 * exceção e nunca uma cena quebrada.
 */
export function gridToneForLuminance(luminance: number | null): GridTone {
  if (luminance === null || !Number.isFinite(luminance)) return 'light';
  return luminance < GRID_TONE_THRESHOLD ? 'light' : 'dark';
}
