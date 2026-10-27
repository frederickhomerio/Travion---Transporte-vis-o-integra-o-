// Imagem de divulgação de frete liberado (modelo "Carregue conosco") e texto para WhatsApp.
// A imagem é desenhada no navegador sobre o fundo em public/anuncio; nada é enviado a ninguém automaticamente.

import { useCallback, useEffect, useRef, useState } from 'react';
import { type DadosAnuncio, textoWhatsApp, textosImagem } from '../lib/anuncio';
import { Alerta, Modal, useAviso } from './ui';

const FUNDO = `${import.meta.env.BASE_URL}anuncio/fundo-frete-liberado.png`;
const LARGURA = 1080;
const AMARELO = '#ffe600';

function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => falha(new Error('Não foi possível carregar o fundo do anúncio.'));
    img.src = src;
  });
}

/** Escreve uma linha centralizada, reduzindo a fonte até caber na largura. */
function linha(ctx: CanvasRenderingContext2D, texto: string, y: number, tam: number, maxLarg: number, cor: string, sublinhar = false) {
  if (!texto) return;
  let t = tam;
  const fonte = (px: number) => `italic 700 ${px}px Sora, 'Arial Black', Arial, sans-serif`;
  ctx.font = fonte(t);
  while (ctx.measureText(texto).width > maxLarg && t > 12) { t -= 2; ctx.font = fonte(t); }
  const x = ctx.canvas.width / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = t * 0.12;
  ctx.shadowOffsetX = t * 0.04;
  ctx.shadowOffsetY = t * 0.05;
  ctx.fillStyle = cor;
  ctx.fillText(texto, x, y);
  if (sublinhar) {
    const w = ctx.measureText(texto).width;
    ctx.fillRect(x - w / 2, y + t * 0.5, w, Math.max(4, t * 0.06));
  }
  ctx.shadowColor = 'transparent';
}

export async function desenharAnuncio(canvas: HTMLCanvasElement, d: DadosAnuncio) {
  const img = await carregarImagem(FUNDO);
  try { await document.fonts.load("italic 700 64px Sora"); } catch { /* usa a fonte reserva */ }
  const W = LARGURA;
  const H = Math.round((img.naturalHeight / img.naturalWidth) * W);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, W, H);
  const t = textosImagem(d);
  const maxL = W * 0.9;
  // Posições proporcionais ao modelo (fundo 9:16).
  linha(ctx, t.origem, H * 0.385, W * 0.11, maxL, '#ffffff');
  linha(ctx, t.coleta, H * 0.458, W * 0.095, maxL, AMARELO);
  linha(ctx, t.destino, H * 0.628, W * 0.11, maxL, '#ffffff');
  linha(ctx, t.entrega, H * 0.71, W * 0.095, maxL, AMARELO);
  linha(ctx, t.valor, H * (t.unidade ? 0.81 : 0.825), W * 0.17, W * 0.86, '#ffffff', true);
  if (t.unidade) linha(ctx, t.unidade, H * 0.875, W * 0.05, maxL, '#ffffff');
}

const nomeArquivo = (d: DadosAnuncio) =>
  `frete-${d.origem_cidade}-${d.destino_cidade}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase() + '.png';

/** Tela de divulgação: prévia da imagem e as ações (enviar no WhatsApp, baixar, copiar imagem, copiar texto). */
export function ModalDivulgacao({ titulo, desenhar, texto, arquivoNome, tipo = 'image/png', aviso, aoFechar }: {
  titulo: string; desenhar: (c: HTMLCanvasElement) => Promise<void>; texto: string; arquivoNome: string;
  tipo?: 'image/png' | 'image/jpeg'; aviso?: string | null; aoFechar: () => void;
}) {
  const avisar = useAviso();
  const ref = useRef<HTMLCanvasElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    if (ref.current) desenhar(ref.current).then(() => setPronto(true)).catch((e: Error) => setErro(e.message));
  }, [desenhar]);

  const arquivo = () => new Promise<File>((ok, falha) => ref.current!.toBlob((b) => (b ? ok(new File([b], arquivoNome, { type: tipo })) : falha(new Error('Falha ao gerar a imagem.'))), tipo, 0.9));

  const baixar = (f: File) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const compartilhar = async () => {
    try {
      const f = await arquivo();
      // Compartilha só a imagem; o texto vai pelo "Copiar texto".
      if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f] }); return; }
      baixar(f);
    } catch (e) { if ((e as Error).name !== 'AbortError') avisar('erro', (e as Error).message); }
  };
  const copiarImagem = async () => {
    try {
      // A área de transferência só aceita PNG.
      const png = await new Promise<Blob>((ok, falha) => ref.current!.toBlob((b) => (b ? ok(b) : falha(new Error())), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      avisar('ok', 'Imagem copiada. Cole (Ctrl+V) na conversa do WhatsApp.');
    } catch { avisar('erro', 'Este navegador não deixa copiar imagem. Use "Baixar imagem".'); }
  };
  const copiarTexto = async () => {
    try { await navigator.clipboard.writeText(texto); avisar('ok', 'Texto copiado. Cole na conversa do WhatsApp.'); }
    catch { avisar('erro', 'O navegador não deixou copiar o texto.'); }
  };

  return (
    <Modal titulo={titulo} aoFechar={aoFechar} rodape={
      <>
        <button className="btn" onClick={aoFechar}>Fechar</button>
        <button className="btn" disabled={!pronto} onClick={async () => baixar(await arquivo())}>Baixar imagem</button>
        <button className="btn esconder-celular" disabled={!pronto} onClick={copiarImagem}>Copiar imagem</button>
        <button className="btn" onClick={copiarTexto}>Copiar texto</button>
        <button className="btn primario" disabled={!pronto} onClick={compartilhar}>Enviar no WhatsApp</button>
      </>
    }>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {aviso && <div style={{ marginBottom: 10 }}><Alerta tipo="aviso">{aviso}</Alerta></div>}
      <canvas ref={ref} className="anuncio-canvas" aria-label="Prévia da imagem de divulgação" />
    </Modal>
  );
}

export function ImagemAnuncio({ dados, aoFechar, titulo = 'Divulgação do frete' }: { dados: DadosAnuncio; aoFechar: () => void; titulo?: string }) {
  const desenhar = useCallback((c: HTMLCanvasElement) => desenharAnuncio(c, dados), [dados]);
  return (
    <ModalDivulgacao titulo={titulo} desenhar={desenhar} texto={textoWhatsApp(dados)} arquivoNome={nomeArquivo(dados)} aoFechar={aoFechar}
      aviso={dados.frete?.frete_motorista ? null : 'Sem frete do motorista cadastrado: a imagem sai com "A COMBINAR".'} />
  );
}

/** Copia o texto do anúncio; devolve false se o navegador bloquear. */
export async function copiarTextoWhatsApp(d: DadosAnuncio): Promise<boolean> {
  try { await navigator.clipboard.writeText(textoWhatsApp(d)); return true; } catch { return false; }
}
