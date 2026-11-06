import { useEffect, useState } from 'react';
import { averageLuminanceOfSamples, gridToneForLuminance, type GridTone } from './gridTone';

/**
 * 6.6M.4.1.2 — TOM DA GRADE A PARTIR DA IMAGEM (ANÁLISE LOCAL).
 *
 * Só apresentação: decodifica a imagem, reduz para 32 × 32 e tira a luminância
 * MÉDIA. Nada é persistido, enviado ao servidor nem lido por Movement/paredes/
 * cobertura. Tratar a imagem em resolução original seria desperdício — 32 × 32
 * já dá a leitura visual que interessa.
 *
 * Falha nunca quebra a cena: canvas tainted (CORS), imagem quebrada, navegador
 * sem canvas ou qualquer exceção caem no fallback `light` (linha clara sobre a
 * superfície escura padrão).
 */

/** Lado da amostragem reduzida (32 × 32 é suficiente para a média). */
const SAMPLE_SIZE = 32;

/** Luminância média da imagem (`null` = sem amostra utilizável). */
export async function measureImageLuminance(url: string): Promise<number | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  try {
    const image = new Image();
    // Origem externa só funciona com CORS; em `/uploads/...` do próprio app
    // (caso real) nada é necessário e canvas não fica tainted.
    if (/^https?:/i.test(url) && typeof window !== 'undefined' && !url.startsWith(window.location.origin)) {
      image.crossOrigin = 'anonymous';
    }
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('imagem não carregou'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return averageLuminanceOfSamples(data);
  } catch {
    return null;
  }
}

/** Tom da grade para a imagem atual; recomeça em `light` a cada troca. */
export function useSceneGridTone(url: string | null | undefined): GridTone {
  const [tone, setTone] = useState<GridTone>('light');
  useEffect(() => {
    let cancelled = false;
    // Sem imagem não há análise: a superfície escura padrão pede linha clara.
    setTone('light');
    if (!url) return undefined;
    void measureImageLuminance(url).then((luminance) => {
      if (cancelled) return;
      setTone(gridToneForLuminance(luminance));
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return tone;
}
