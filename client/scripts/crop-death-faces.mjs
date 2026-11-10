#!/usr/bin/env node
/**
 * Corta as quatro faces do dado do Teste contra a Morte na folha de arte.
 *
 * A folha entregue pela mesa é um atlas de 20 triângulos obsidiana (caveira
 * grande, caveira com ossos cruzados, coração e mãos rezando), em grade de 5
 * colunas por 4 linhas, um número por face, na ordem dos números. O dado usa só
 * quatro arquivos, porque as faces de 2 a 9 e de 10 a 19 são idênticas entre si.
 *
 * Este script existe para o recorte ser reproduzível: sem `sharp`/ImageMagick no
 * projeto, o PNG é decodificado e recodificado aqui mesmo com `node:zlib`.
 *
 * Uso:
 *   node client/scripts/crop-death-faces.mjs caminho/da/folha.png
 * Grava em client/public/death-save/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = TABELA_CRC[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Decodifica um PNG de 8 bits (RGB ou RGBA, sem entrelaçamento) em RGBA. */
function lerPng(caminho) {
  const arquivo = readFileSync(caminho);
  const assinatura = '89504e470d0a1a0a';
  if (arquivo.subarray(0, 8).toString('hex') !== assinatura) {
    throw new Error(`${caminho}: não parece um PNG`);
  }

  let posicao = 8;
  let largura = 0;
  let altura = 0;
  let profundidade = 0;
  let tipoCor = 0;
  let entrelacado = 0;
  const blocos = [];

  while (posicao < arquivo.length) {
    const tamanho = arquivo.readUInt32BE(posicao);
    const tipo = arquivo.toString('ascii', posicao + 4, posicao + 8);
    const dados = arquivo.subarray(posicao + 8, posicao + 8 + tamanho);
    if (tipo === 'IHDR') {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
      profundidade = dados[8];
      tipoCor = dados[9];
      entrelacado = dados[12];
    } else if (tipo === 'IDAT') {
      blocos.push(dados);
    } else if (tipo === 'IEND') {
      break;
    }
    posicao += 12 + tamanho;
  }

  const canais = { 0: 1, 2: 3, 4: 2, 6: 4 }[tipoCor];
  if (profundidade !== 8 || !canais || entrelacado !== 0) {
    throw new Error(`PNG fora do esperado: ${profundidade} bits, cor ${tipoCor}, entrelaçado ${entrelacado}`);
  }

  const cru = inflateSync(Buffer.concat(blocos));
  const passo = largura * canais;
  const linhas = Buffer.alloc(altura * passo);
  const rgba = Buffer.alloc(largura * altura * 4);

  for (let y = 0; y < altura; y += 1) {
    const filtro = cru[y * (passo + 1)];
    const origem = y * (passo + 1) + 1;
    const destino = y * passo;
    for (let x = 0; x < passo; x += 1) {
      const bruto = cru[origem + x];
      const esquerda = x >= canais ? linhas[destino + x - canais] : 0;
      const acima = y > 0 ? linhas[destino - passo + x] : 0;
      const diagonal = y > 0 && x >= canais ? linhas[destino - passo + x - canais] : 0;
      let valor;
      if (filtro === 0) valor = bruto;
      else if (filtro === 1) valor = bruto + esquerda;
      else if (filtro === 2) valor = bruto + acima;
      else if (filtro === 3) valor = bruto + ((esquerda + acima) >> 1);
      else {
        const p = esquerda + acima - diagonal;
        const pa = Math.abs(p - esquerda);
        const pb = Math.abs(p - acima);
        const pc = Math.abs(p - diagonal);
        const preditor = pa <= pb && pa <= pc ? esquerda : pb <= pc ? acima : diagonal;
        valor = bruto + preditor;
      }
      linhas[destino + x] = valor & 0xff;
    }
  }

  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      const s = (y * largura + x) * canais;
      const d = (y * largura + x) * 4;
      rgba[d] = linhas[s];
      rgba[d + 1] = linhas[s + 1];
      rgba[d + 2] = linhas[s + 2];
      rgba[d + 3] = canais === 4 ? linhas[s + 3] : 255;
    }
  }

  return { largura, altura, rgba };
}

function bloco(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const verificacao = Buffer.alloc(4);
  verificacao.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, verificacao]);
}

function escreverPng(caminho, largura, altura, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // RGBA
  const cru = Buffer.alloc((largura * 4 + 1) * altura);
  for (let y = 0; y < altura; y += 1) {
    cru[y * (largura * 4 + 1)] = 0; // filtro "none"
    rgba.copy(cru, y * (largura * 4 + 1) + 1, y * largura * 4, (y + 1) * largura * 4);
  }
  writeFileSync(
    caminho,
    Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      bloco('IHDR', ihdr),
      bloco('IDAT', deflateSync(cru, { level: 9 })),
      bloco('IEND', Buffer.alloc(0)),
    ]),
  );
}

/**
 * Geometria da folha (1448 x 1086): o primeiro triângulo começa em (48, 13), cada
 * célula mede 275 x 255 e o passo é 270,5 x 260,3 — os losangos de latão das
 * pontas encostam nas células vizinhas, daí o recorte puxar 6 px nas laterais.
 */
const GRADE = { colunas: 5, linhas: 4, x0: 48, y0: 13, passoX: 270.5, passoY: 260.3, largura: 275, altura: 255 };
const RECUO_X = 6;
const RECUO_Y = 2;

const FACES = [
  { arquivo: 'face-1.png', coluna: 0, linha: 0, face: 1 },
  { arquivo: 'face-fail.png', coluna: 1, linha: 0, face: 2 },
  { arquivo: 'face-success.png', coluna: 4, linha: 1, face: 10 },
  { arquivo: 'face-20.png', coluna: 4, linha: 3, face: 20 },
];

const entrada = process.argv[2];
if (!entrada) {
  console.error('uso: node client/scripts/crop-death-faces.mjs caminho/da/folha.png');
  process.exit(1);
}

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saida = resolve(raiz, 'public/death-save');
mkdirSync(saida, { recursive: true });

const folha = lerPng(resolve(entrada));
console.log(`folha: ${folha.largura}x${folha.altura}`);

for (const face of FACES) {
  const x = Math.round(GRADE.x0 + face.coluna * GRADE.passoX) + RECUO_X;
  const y = Math.round(GRADE.y0 + face.linha * GRADE.passoY) + RECUO_Y;
  const largura = GRADE.largura - RECUO_X * 2;
  const altura = GRADE.altura - RECUO_Y * 2;
  const recorte = Buffer.alloc(largura * altura * 4);

  for (let linha = 0; linha < altura; linha += 1) {
    const origem = ((y + linha) * folha.largura + x) * 4;
    folha.rgba.copy(recorte, linha * largura * 4, origem, origem + largura * 4);
  }

  const destino = resolve(saida, face.arquivo);
  escreverPng(destino, largura, altura, recorte);
  console.log(`face ${face.face}: ${x},${y} ${largura}x${altura} -> ${face.arquivo}`);
}
