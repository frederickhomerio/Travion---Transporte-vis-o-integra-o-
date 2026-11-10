// Divulgação das cargas disponíveis do Industrializado (individual e em lista), para motoristas.
// Leva só o que é do motorista: frete motorista por viagem, reembolso de descarga e pedágio. Nunca o frete da empresa nem o cliente.

import { cidadeAnuncio, semDemo } from '../lib/anuncio';
import { ROTULO_CARROCERIA, ROTULO_TIPO_CARGA, type ViagemInd } from './tipos';

export interface DivulgacaoInd {
  pedido: string;
  origem: string; coleta: string | null; destino: string; entrega: string | null;
  entregas: number; veiculo: string; carroceria: string | null; peso: string | null; tipoCarga: string;
  retirada: string; descargaAgenda: string;
  frete: number; descarga: number; pedagio: number;
}

const dm = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
const dia = (ymd: string) => ymd.split('-').reverse().slice(0, 2).join('/');
export const reais = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).replace(/\s/g, ' ');
const reaisCurto = (n: number) => reais(n).replace(',00', '');

export function dadosDivulgacao(v: ViagemInd): DivulgacaoInd {
  const coletas = v.paradas.filter((p) => p.tipo === 'coleta').sort((a, b) => a.ordem - b.ordem);
  const entregas = v.paradas.filter((p) => p.tipo === 'entrega').sort((a, b) => a.ordem - b.ordem);
  const c = coletas[0]; const e = entregas[entregas.length - 1];
  const agEnt = entregas.find((p) => p.agendado_para)?.agendado_para ?? null;
  return {
    pedido: v.pedido ?? 'Sem pedido',
    origem: c ? cidadeAnuncio(c.cidade, c.uf) : '—', coleta: c ? semDemo(c.local) || null : null,
    destino: e ? cidadeAnuncio(e.cidade, e.uf) : '—', entrega: e ? semDemo(e.local) || null : null,
    entregas: entregas.length,
    veiculo: v.tipo_veiculo || 'Veículo a combinar',
    carroceria: v.carroceria ? ROTULO_CARROCERIA[v.carroceria] : null,
    peso: v.peso_t ? `${String(v.peso_t).replace('.', ',')} t` : null,
    tipoCarga: ROTULO_TIPO_CARGA[v.tipo_carga] ?? '',
    retirada: c?.agendado_para ? dm(c.agendado_para) : v.coleta_prevista ? dia(v.coleta_prevista) : 'a combinar',
    descargaAgenda: agEnt ? `agendada ${dm(agEnt)}` : 'sem agendamento',
    frete: v.valores.frete_motorista, descarga: v.valores.descarga, pedagio: v.valores.pedagio_motorista ?? 0,
  };
}

const extra = (n: number) => (n > 0 ? reais(n) : 'não tem');

/** Mensagem do WhatsApp de uma carga. */
export function textoInd(d: DivulgacaoInd): string {
  return [
    `📍 *${d.origem} ➜ ${d.destino}*${d.entregas > 1 ? ` (${d.entregas} entregas)` : ''}`,
    `🏭 Coleta: ${d.coleta ?? 'a informar'} | Entrega: ${d.entrega ?? 'a informar'}`,
    `🚛 ${d.veiculo}${d.carroceria ? ` ${d.carroceria}` : ''}${d.peso ? ` · ${d.peso}` : ''} · ${d.tipoCarga}`,
    `📅 Retirada: ${d.retirada} | Descarga: ${d.descargaAgenda}`,
    `💵 Frete: ${d.frete > 0 ? `${reais(d.frete)} por viagem` : 'a combinar'}`,
    `➕ Reembolso de descarga: ${extra(d.descarga)} | Pedágio: ${extra(d.pedagio)}`,
  ].join('\n');
}

export function textoListaInd(ds: DivulgacaoInd[]): string {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return [`🚛 *CARGAS DISPONÍVEIS · INDUSTRIALIZADO · ${hoje}*`, ...ds.map(textoInd)].join('\n\n');
}

// ---------------------------------------------------------------------------
// Imagens
// ---------------------------------------------------------------------------
const FUNDO = `${import.meta.env.BASE_URL}anuncio/fundo-frete-liberado.png`;
const BANNER = `${import.meta.env.BASE_URL}anuncio/banner-lista.jpg`;
const AMARELO = '#ffe600';
const VINHO = '#580f1b';
const DOURADO = '#c6a044';

function carregar(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, falha) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => falha(new Error('Não foi possível carregar a imagem de fundo.'));
    i.src = src;
  });
}

function linha(ctx: CanvasRenderingContext2D, texto: string, y: number, tam: number, maxL: number, cor: string, sublinhar = false) {
  if (!texto) return;
  let t = tam;
  const f = (px: number) => `italic 700 ${px}px Sora, 'Arial Black', Arial, sans-serif`;
  ctx.font = f(t);
  while (ctx.measureText(texto).width > maxL && t > 12) { t -= 2; ctx.font = f(t); }
  const x = ctx.canvas.width / 2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = t * 0.12; ctx.shadowOffsetX = t * 0.04; ctx.shadowOffsetY = t * 0.05;
  ctx.fillStyle = cor; ctx.fillText(texto, x, y);
  if (sublinhar) { const w = ctx.measureText(texto).width; ctx.fillRect(x - w / 2, y + t * 0.5, w, Math.max(4, t * 0.06)); }
  ctx.shadowColor = 'transparent';
}

/** Faixa escura atrás das linhas de detalhe, para ler bem sobre a foto. */
function faixa(ctx: CanvasRenderingContext2D, y0: number, y1: number) {
  ctx.fillStyle = 'rgba(40, 6, 14, 0.62)';
  ctx.fillRect(ctx.canvas.width * 0.04, y0, ctx.canvas.width * 0.92, y1 - y0);
}

export async function desenharInd(c: HTMLCanvasElement, d: DivulgacaoInd) {
  const img = await carregar(FUNDO);
  try { await document.fonts.load('italic 700 64px Sora'); } catch { /* fonte reserva */ }
  const W = 1080; const H = Math.round((img.naturalHeight / img.naturalWidth) * W);
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, W, H);
  const maxL = W * 0.88;
  linha(ctx, d.origem.toUpperCase(), H * 0.37, W * 0.1, maxL, '#ffffff');
  linha(ctx, d.coleta ? `(${d.coleta.toUpperCase()})` : '', H * 0.418, W * 0.06, maxL, AMARELO);
  faixa(ctx, H * 0.445, H * 0.53);
  linha(ctx, `${d.veiculo}${d.carroceria ? ` ${d.carroceria}` : ''}${d.peso ? ` · ${d.peso}` : ''}`.toUpperCase(), H * 0.47, W * 0.058, maxL * 0.96, '#ffffff');
  linha(ctx, `${d.tipoCarga} · RETIRADA ${d.retirada}`.toUpperCase(), H * 0.51, W * 0.042, maxL * 0.96, AMARELO);
  linha(ctx, d.destino.toUpperCase(), H * 0.625, W * 0.1, maxL, '#ffffff');
  linha(ctx, d.entrega ? `(${d.entrega.toUpperCase()})` : '', H * 0.672, W * 0.06, maxL, AMARELO);
  linha(ctx, `${d.entregas} ${d.entregas > 1 ? 'ENTREGAS' : 'ENTREGA'} · DESCARGA ${d.descargaAgenda.toUpperCase()}`, H * 0.715, W * 0.042, maxL, '#ffffff');
  linha(ctx, d.frete > 0 ? reais(d.frete) : 'A COMBINAR', H * 0.792, W * 0.14, W * 0.84, '#ffffff', true);
  linha(ctx, 'POR VIAGEM', H * 0.851, W * 0.042, maxL, '#ffffff');
  const extras = [d.descarga > 0 ? `+ DESCARGA ${reaisCurto(d.descarga)}` : 'SEM REEMBOLSO DE DESCARGA', d.pedagio > 0 ? `+ PEDÁGIO ${reaisCurto(d.pedagio)}` : 'SEM PEDÁGIO'].join('  ·  ');
  linha(ctx, extras, H * 0.884, W * 0.04, W * 0.8, AMARELO);
}

function caber(ctx: CanvasRenderingContext2D, t: string, larg: number) {
  if (ctx.measureText(t).width <= larg) return t;
  let s = t;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > larg) s = s.slice(0, -1);
  return `${s}…`;
}

/** Lista de cargas disponíveis: rota, veículo/carroceria/peso, agenda e frete motorista com descarga e pedágio. */
export async function desenharListaInd(c: HTMLCanvasElement, ds: DivulgacaoInd[]) {
  const banner = await carregar(BANNER);
  try { await document.fonts.load('700 28px Sora'); } catch { /* fonte reserva */ }
  const W = 1080;
  const hB = Math.round((banner.naturalHeight / banner.naturalWidth) * W);
  const L = 150;
  const H = hB + 96 + 52 + Math.max(1, ds.length) * L + 70;
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(banner, 0, 0, W, hB);
  let y = hB;
  ctx.fillStyle = VINHO; ctx.fillRect(0, y, W, 96);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff';
  ctx.font = 'italic 700 38px Sora, Arial, sans-serif';
  ctx.fillText('CARGAS DISPONÍVEIS', 40, y + 48);
  ctx.textAlign = 'right'; ctx.fillStyle = DOURADO; ctx.font = '700 28px Sora, Arial, sans-serif';
  ctx.fillText(`INDUSTRIALIZADO · ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, W - 40, y + 48);
  y += 96;
  const col = [40, 470, W - 40];
  ctx.fillStyle = '#f1edea'; ctx.fillRect(0, y, W, 52);
  ctx.fillStyle = '#4a4446'; ctx.font = '700 21px Inter, Arial, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('ROTA', col[0], y + 26); ctx.fillText('VEÍCULO · CARGA · AGENDA', col[1], y + 26);
  ctx.textAlign = 'right'; ctx.fillText('FRETE MOTORISTA', col[2], y + 26);
  y += 52;
  ds.forEach((d, n) => {
    if (n % 2) { ctx.fillStyle = '#faf8f6'; ctx.fillRect(0, y, W, L); }
    ctx.textAlign = 'left';
    ctx.fillStyle = VINHO; ctx.font = 'italic 700 25px Sora, Arial, sans-serif';
    ctx.fillText(caber(ctx, d.origem.toUpperCase(), 400), col[0], y + 30);
    ctx.fillText(caber(ctx, `➜ ${d.destino.toUpperCase()}`, 400), col[0], y + 66);
    ctx.fillStyle = '#9e7b24'; ctx.font = 'italic 700 20px Inter, Arial, sans-serif';
    ctx.fillText(caber(ctx, `${d.entregas} ${d.entregas > 1 ? 'ENTREGAS' : 'ENTREGA'}`, 400), col[0], y + 100);
    ctx.fillStyle = '#2d2a2a'; ctx.font = '700 22px Inter, Arial, sans-serif';
    ctx.fillText(caber(ctx, `${d.veiculo}${d.carroceria ? ` ${d.carroceria}` : ''}${d.peso ? ` · ${d.peso}` : ''}`.toUpperCase(), 330), col[1], y + 30);
    ctx.font = '500 20px Inter, Arial, sans-serif';
    ctx.fillText(caber(ctx, d.tipoCarga.toUpperCase(), 330), col[1], y + 62);
    ctx.fillText(caber(ctx, `RETIRADA ${d.retirada}`, 330), col[1], y + 92);
    ctx.fillText(caber(ctx, `DESCARGA ${d.descargaAgenda.replace('agendada ', '').replace('sem agendamento', 'sem agenda').toUpperCase()}`, 360), col[1], y + 122);
    ctx.textAlign = 'right'; ctx.fillStyle = '#247d46'; ctx.font = '700 30px Sora, Arial, sans-serif';
    ctx.fillText(d.frete > 0 ? reais(d.frete) : 'A COMBINAR', col[2], y + 36);
    ctx.fillStyle = '#4a4446'; ctx.font = '500 19px Inter, Arial, sans-serif';
    ctx.fillText('por viagem', col[2], y + 66);
    ctx.fillText(d.descarga > 0 ? `+ descarga ${reaisCurto(d.descarga)}` : 'sem reembolso de descarga', col[2], y + 94);
    ctx.fillText(d.pedagio > 0 ? `+ pedágio ${reaisCurto(d.pedagio)}` : 'sem pedágio', col[2], y + 120);
    ctx.fillStyle = '#e9e4e0'; ctx.fillRect(0, y + L - 1, W, 1);
    y += L;
  });
  ctx.fillStyle = VINHO; ctx.fillRect(0, H - 70, W, 70);
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.font = 'italic 700 26px Sora, Arial, sans-serif';
  ctx.fillText('CARREGUE CONOSCO! · TRANSPANORAMA', W / 2, H - 35);
}

export const arquivoInd = (d: DivulgacaoInd) =>
  `frete-${d.origem}-${d.destino}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase() + '.png';
