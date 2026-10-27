// Lista de fretes liberados para divulgar: imagem JPEG (motoristas) e PDF no modelo da planilha antiga.
// Só leva o frete do MOTORISTA; o JPEG não leva cliente.

import { type DadosAnuncio, cidadeAnuncio, semDemo, textoWhatsApp } from './anuncio';

export interface ItemLista {
  grupo: string; cliente: string; origem_cidade: string; origem_uf: string | null; coleta: string | null;
  destino_cidade: string; destino_uf: string | null; entrega: string | null; produto: string | null; frete: string | null;
  /** Dados do anúncio individual (texto do WhatsApp). */
  anuncio: DadosAnuncio;
}

const BANNER = `${import.meta.env.BASE_URL}anuncio/banner-lista.jpg`;
const VINHO = '#580f1b';
const DOURADO = '#c6a044';

function carregar(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, falha) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => falha(new Error('Não foi possível carregar o cabeçalho da lista.'));
    i.src = src;
  });
}

/** Corta o texto com "…" até caber na largura. */
function caber(ctx: CanvasRenderingContext2D, t: string, larg: number) {
  if (ctx.measureText(t).width <= larg) return t;
  let s = t;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > larg) s = s.slice(0, -1);
  return `${s}…`;
}

const dataBR = (iso: string) => iso.split('-').reverse().join('/');

/** Texto para WhatsApp com todos os fretes da lista (só frete motorista). */
export function textoLista(itens: ItemLista[], data: string, comFrete: boolean): string {
  const blocos = itens.map((i) => textoWhatsApp(comFrete ? i.anuncio : { ...i.anuncio, frete: null }));
  return [`🚛 *FRETES LIBERADOS · ${dataBR(data)}*`, ...blocos].join('\n\n');
}

/** Desenha a imagem com vários fretes: origem, destino, produto e frete motorista. */
export async function desenharLista(c: HTMLCanvasElement, itens: ItemLista[], data: string, comFrete: boolean): Promise<void> {
  const banner = await carregar(BANNER);
  try { await document.fonts.load('700 28px Sora'); } catch { /* fonte reserva */ }
  const W = 1080;
  const hBanner = Math.round((banner.naturalHeight / banner.naturalWidth) * W);
  const grupos = new Set(itens.map((i) => i.grupo)).size;
  const temGrupo = itens.some((i) => i.grupo);
  const LINHA = 92;
  const H = hBanner + 96 + 56 + itens.length * LINHA + (temGrupo ? grupos * 52 : 0) + 70;
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(banner, 0, 0, W, hBanner);

  // Faixa do título
  let y = hBanner;
  ctx.fillStyle = VINHO; ctx.fillRect(0, y, W, 96);
  ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = 'italic 700 40px Sora, Arial, sans-serif';
  ctx.fillText('FRETES LIBERADOS', 40, y + 48);
  ctx.textAlign = 'right'; ctx.fillStyle = DOURADO; ctx.font = '700 30px Sora, Arial, sans-serif';
  ctx.fillText(dataBR(data), W - 40, y + 48);
  y += 96;

  // Cabeçalho das colunas
  const col = comFrete ? [40, 350, 660, W - 40] : [40, 470, 860, W - 40];
  ctx.fillStyle = '#f1edea'; ctx.fillRect(0, y, W, 56);
  ctx.fillStyle = '#4a4446'; ctx.font = '700 22px Inter, Arial, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('ORIGEM', col[0], y + 28); ctx.fillText('DESTINO', col[1], y + 28); ctx.fillText('PRODUTO', col[2], y + 28);
  if (comFrete) { ctx.textAlign = 'right'; ctx.fillText('FRETE MOT.', col[3], y + 28); }
  y += 56;

  let grupoAtual: string | null = null;
  itens.forEach((it, n) => {
    if (temGrupo && it.grupo !== grupoAtual) {
      grupoAtual = it.grupo;
      ctx.fillStyle = '#f9f0f1'; ctx.fillRect(0, y, W, 52);
      ctx.fillStyle = VINHO; ctx.font = '700 24px Sora, Arial, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(semDemo(it.grupo).toUpperCase(), 40, y + 26);
      y += 52;
    }
    if (n % 2) { ctx.fillStyle = '#faf8f6'; ctx.fillRect(0, y, W, LINHA); }
    const larg = (i: number) => (comFrete ? [295, 295, 190][i] : [410, 370, 180][i]);
    ctx.textAlign = 'left';
    const ponto = (x: number, i: number, cidade: string, uf: string | null, local: string | null) => {
      ctx.fillStyle = VINHO; ctx.font = 'italic 700 28px Sora, Arial, sans-serif';
      ctx.fillText(caber(ctx, cidadeAnuncio(cidade, uf).toUpperCase(), larg(i)), x, y + 34);
      ctx.fillStyle = '#9e7b24'; ctx.font = 'italic 700 21px Inter, Arial, sans-serif';
      ctx.fillText(caber(ctx, local ? `(${semDemo(local).toUpperCase()})` : '', larg(i)), x, y + 66);
    };
    ponto(col[0], 0, it.origem_cidade, it.origem_uf, it.coleta);
    ponto(col[1], 1, it.destino_cidade, it.destino_uf, it.entrega);
    ctx.fillStyle = '#2d2a2a'; ctx.font = '500 21px Inter, Arial, sans-serif';
    ctx.fillText(caber(ctx, semDemo(it.produto).toUpperCase() || '—', larg(2)), col[2], y + LINHA / 2);
    if (comFrete) {
      ctx.textAlign = 'right'; ctx.fillStyle = '#247d46'; ctx.font = '700 30px Sora, Arial, sans-serif';
      ctx.fillText(it.frete ?? 'A COMBINAR', col[3], y + LINHA / 2);
    }
    ctx.fillStyle = '#e9e4e0'; ctx.fillRect(0, y + LINHA - 1, W, 1);
    y += LINHA;
  });

  // Rodapé
  ctx.fillStyle = VINHO; ctx.fillRect(0, H - 70, W, 70);
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.font = 'italic 700 26px Sora, Arial, sans-serif';
  ctx.fillText('CARREGUE CONOSCO! · TRANSPANORAMA', W / 2, H - 35);
}

/** PDF no modelo "LISTA DE FRETE": cabeçalho com a foto da frota e tabela com cliente, rota, produto e frete motorista. */
export async function baixarListaPdf(itens: ItemLista[], data: string, comFrete: boolean) {
  const [{ jsPDF }, banner] = await Promise.all([import('jspdf'), carregar(BANNER)]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 10;
  const L = 210 - 2 * M;
  const cols: Array<[string, number, 'left' | 'center' | 'right']> = [
    ['CLIENTE', 40, 'left'], ['ORIGEM', 25, 'left'], ['CARREGAMENTO', 24, 'left'], ['DESTINO', 22, 'left'],
    ['UF', 8, 'center'], ['DESCARGA', 22, 'center'], ['PRODUTO', 24, 'center'], ['FRETE MOT', 25, 'right'],
  ];
  const escala = L / cols.reduce((a, c) => a + c[1], 0);
  const larg = cols.map((c) => c[1] * escala);
  const H = 4.6;
  let y = M;

  const hB = (banner.naturalHeight / banner.naturalWidth) * L;
  const cv = document.createElement('canvas');
  cv.width = banner.naturalWidth; cv.height = banner.naturalHeight;
  cv.getContext('2d')!.drawImage(banner, 0, 0);
  pdf.addImage(cv.toDataURL('image/jpeg', 0.85), 'JPEG', M, y, L, hB);
  y += hB;

  const celula = (txt: string, i: number, x: number, negrito: boolean) => {
    pdf.setFont('helvetica', negrito ? 'bold' : 'normal');
    pdf.setFontSize(negrito ? 6.6 : 6.2);
    pdf.rect(x, y, larg[i], H);
    let t = txt;
    while (t.length > 1 && pdf.getTextWidth(t) > larg[i] - 1.6) t = t.slice(0, -1);
    const al = cols[i][2];
    const tx = al === 'left' ? x + 0.8 : al === 'right' ? x + larg[i] - 0.8 : x + larg[i] / 2;
    pdf.text(t, tx, y + H - 1.35, { align: al });
  };
  const cabecalho = () => {
    pdf.setDrawColor(40); pdf.setLineWidth(0.15);
    let x = M;
    cols.forEach((c, i) => { celula(c[0], i, x, true); x += larg[i]; });
    y += H;
  };
  cabecalho();
  for (const it of itens) {
    if (y + H > 297 - M) { pdf.addPage(); y = M; cabecalho(); }
    const v = [semDemo(it.cliente), semDemo(it.origem_cidade), semDemo(it.coleta), semDemo(it.destino_cidade), it.destino_uf ?? '',
      semDemo(it.entrega), semDemo(it.produto), comFrete ? (it.frete ?? 'A COMBINAR') : '—'].map((s) => s.toUpperCase());
    let x = M;
    v.forEach((s, i) => { celula(s, i, x, false); x += larg[i]; });
    y += H;
  }
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6);
  pdf.text(`Fretes liberados em ${dataBR(data)} · Transpanorama`, M, Math.min(y + 4, 297 - 4));
  pdf.save(`lista-fretes-${data}.pdf`);
}
