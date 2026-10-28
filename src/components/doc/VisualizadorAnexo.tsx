// Visualizador de anexos (quadro maior do atendimento): PDF com pdf.js (texto selecionável quando o PDF tem
// camada de texto), imagem com zoom e rotação, troca entre arquivos, copiar imagem e baixar.
// Fotos e PDFs digitalizados não têm texto para copiar (sem OCR nesta versão).
// Outros formatos do Cadastro (Word, Excel, PowerPoint, HEIC): só baixar; vídeo e áudio tocam no player do navegador.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useApp } from '../../data/store';
import { CATEGORIA, CATEGORIAS_SAIDA, ehImagem, ehPdf, fmtTamanho } from '../../lib/documentacao';
import { fmtDataHora } from '../../lib/formato';
import type { AnexoDoc } from '../../types';
import { useAviso } from '../ui';

const cacheBlobs = new Map<string, Blob>();
/** Texto do botão que sai da ampliação (o atendimento de Estadia volta à Mesa ampla, não a dois quadros). */
export const RotuloVoltarAmpliado = createContext('Voltar aos dois quadros');

async function carregarPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  }
  return pdfjs;
}

function useBlob(caminho: string | null) {
  const { api } = useApp();
  const [estado, setEstado] = useState<{ blob: Blob | null; erro: string | null; carregando: boolean }>({ blob: null, erro: null, carregando: false });
  useEffect(() => {
    if (!caminho) { setEstado({ blob: null, erro: null, carregando: false }); return; }
    const c = cacheBlobs.get(caminho);
    if (c) { setEstado({ blob: c, erro: null, carregando: false }); return; }
    let vivo = true;
    setEstado({ blob: null, erro: null, carregando: true });
    api.doc.baixar(caminho).then((b) => {
      cacheBlobs.set(caminho, b);
      if (vivo) setEstado({ blob: b, erro: null, carregando: false });
    }, (e) => { if (vivo) setEstado({ blob: null, erro: (e as Error).message, carregando: false }); });
    return () => { vivo = false; };
  }, [api, caminho]);
  return estado;
}

function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function abrirBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
async function copiarCanvas(c: HTMLCanvasElement) {
  if (!('ClipboardItem' in window) || !navigator.clipboard?.write) throw new Error('Este navegador não permite copiar imagem. Use Baixar.');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Promise<Blob>((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('Falha ao gerar a imagem.'))), 'image/png')) })]);
}

export function VisualizadorAnexo({ anexos, selecionado, aoSelecionar, ampliado, aoAmpliar }: {
  anexos: AnexoDoc[]; selecionado: string | null; aoSelecionar: (id: string) => void; ampliado: boolean; aoAmpliar: (v: boolean) => void;
}) {
  const atual = anexos.find((a) => a.id === selecionado) ?? anexos[0] ?? null;
  const { blob, erro, carregando } = useBlob(atual?.caminho ?? null);
  const cadastro = anexos.some((a) => a.categoria === 'motorista' || a.categoria === 'veiculo');
  const estadia = anexos.some((a) => a.categoria.startsWith('est_'));
  const grupos: Array<[string, AnexoDoc[]]> = estadia ? ([
    'est_documento', 'est_nf_carga', 'est_comprovante', 'est_agendamento', 'est_tratativa', 'correcao', 'est_retorno', 'est_pagamento',
  ] as const).map((c) => [CATEGORIA[c], anexos.filter((a) => a.categoria === c)] as [string, AnexoDoc[]]) : cadastro ? [
    ['Motorista', anexos.filter((a) => a.categoria === 'motorista')],
    ['Veículos', anexos.filter((a) => a.categoria === 'veiculo')],
    ['Correções', anexos.filter((a) => a.categoria === 'correcao')],
  ] : [
    ['Entrada', anexos.filter((a) => !CATEGORIAS_SAIDA.includes(a.categoria))],
    ['Emitidos', anexos.filter((a) => CATEGORIAS_SAIDA.includes(a.categoria))],
  ];
  return (
    <div className="va">
      <div className="va-arquivos" role="tablist" aria-label="Anexos">
        {grupos.map(([g, as]) => as.length > 0 && (
          <div key={g} className="va-grupo">
            <span className="va-grupo-rot">{g}</span>
            {as.map((a) => (
              <button key={a.id} role="tab" aria-selected={a.id === atual?.id} className={`va-arq${a.id === atual?.id ? ' ativo' : ''}`}
                onClick={() => aoSelecionar(a.id)} title={`${a.nome} · ${fmtTamanho(a.tamanho)} · ${a.enviado_por_nome}, ${fmtDataHora(a.enviado_em)}`}>
                <span className="va-cat">{CATEGORIA[a.categoria]}</span><span className="va-nome">{a.nome}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      {!atual ? <div className="va-vazio">Nenhum anexo nesta solicitação.</div>
        : carregando ? <div className="va-vazio">Carregando {atual.nome}…</div>
        : erro || !blob ? <div className="va-vazio"><p>{erro ?? 'Arquivo indisponível.'}</p></div>
        : ehImagem(atual.tipo_mime) ? <VerImagem key={atual.id} blob={blob} anexo={atual} ampliado={ampliado} aoAmpliar={aoAmpliar} />
        : ehPdf(atual.tipo_mime) ? <VerPdf key={atual.id} blob={blob} anexo={atual} ampliado={ampliado} aoAmpliar={aoAmpliar} />
        : <VerOutro key={atual.id} blob={blob} anexo={atual} ampliado={ampliado} aoAmpliar={aoAmpliar} />}
    </div>
  );
}

function BarraComum({ blob, anexo, ampliado, aoAmpliar, copiar }: {
  blob: Blob; anexo: AnexoDoc; ampliado: boolean; aoAmpliar: (v: boolean) => void; copiar?: () => Promise<void>;
}) {
  const avisar = useAviso();
  const voltar = useContext(RotuloVoltarAmpliado);
  return (
    <>
      {copiar && <button className="btn peq" onClick={() => copiar().then(() => avisar('ok', 'Imagem copiada.'), (e) => avisar('erro', (e as Error).message))}>Copiar imagem</button>}
      <button className="btn peq" onClick={() => abrirBlob(blob)} title="Abrir no visualizador do navegador">Abrir</button>
      <button className="btn peq" onClick={() => baixarBlob(blob, anexo.nome)}>Baixar</button>
      <button className="btn peq" onClick={() => aoAmpliar(!ampliado)} aria-pressed={ampliado}>{ampliado ? voltar : 'Ampliar'}</button>
    </>
  );
}

function VerPdf({ blob, anexo, ampliado, aoAmpliar }: { blob: Blob; anexo: AnexoDoc; ampliado: boolean; aoAmpliar: (v: boolean) => void }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [zoom, setZoom] = useState<number | 'largura'>('largura');
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const texto = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);

  useEffect(() => {
    let vivo = true;
    let d: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const pdfjs = await carregarPdfjs();
        d = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
        if (vivo) setDoc(d); else void d.destroy();
      } catch (e) { if (vivo) setFalha((e as Error).message); }
    })();
    return () => { vivo = false; void d?.destroy(); };
  }, [blob]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLargura(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  useEffect(() => {
    if (!doc || !canvas.current || !texto.current || !largura) return;
    let cancelado = false;
    let tarefa: { cancel: () => void } | null = null;
    (async () => {
      const pdfjs = await carregarPdfjs();
      const page = await doc.getPage(pagina);
      const base = page.getViewport({ scale: 1 });
      const escala = zoom === 'largura' ? Math.max(0.3, (largura - 32) / base.width) : zoom;
      const vp = page.getViewport({ scale: escala });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const c = canvas.current!;
      c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      c.style.width = `${Math.floor(vp.width)}px`; c.style.height = `${Math.floor(vp.height)}px`;
      const ctx = c.getContext('2d')!;
      const r = page.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      tarefa = r;
      await r.promise;
      if (cancelado) return;
      const t = texto.current!;
      t.replaceChildren();
      t.style.setProperty('--scale-factor', String(vp.scale));
      await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: t, viewport: vp }).render();
    })().catch((e) => { if (!cancelado && !/cancel/i.test(String(e))) setFalha((e as Error).message); });
    return () => { cancelado = true; tarefa?.cancel(); };
  }, [doc, pagina, zoom, largura]);

  const atualZoom = typeof zoom === 'number' ? zoom : null;
  const mudarZoom = (f: number) => setZoom((z) => Math.min(4, Math.max(0.4, (typeof z === 'number' ? z : 1.2) * f)));

  if (falha) {
    return (
      <div className="va-vazio">
        <p>Este navegador não conseguiu exibir o PDF aqui ({falha}).</p>
        <div className="grupo-btn"><button className="btn" onClick={() => abrirBlob(blob)}>Abrir em outra aba</button><button className="btn primario" onClick={() => baixarBlob(blob, anexo.nome)}>Baixar</button></div>
      </div>
    );
  }
  return (
    <div className="va-corpo">
      <div className="va-barra">
        <button className="btn peq" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior">←</button>
        <span className="va-pag">{doc ? `${pagina} / ${doc.numPages}` : '…'}</span>
        <button className="btn peq" disabled={!doc || pagina >= doc.numPages} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página">→</button>
        <span className="va-sep" />
        <button className="btn peq" onClick={() => mudarZoom(1 / 1.2)} aria-label="Diminuir zoom">−</button>
        <span className="va-pag">{atualZoom ? `${Math.round(atualZoom * 100)}%` : 'Largura'}</span>
        <button className="btn peq" onClick={() => mudarZoom(1.2)} aria-label="Aumentar zoom">+</button>
        <button className="btn peq" onClick={() => setZoom('largura')} aria-pressed={zoom === 'largura'}>Ajustar à largura</button>
        <span className="va-sep" />
        <BarraComum blob={blob} anexo={anexo} ampliado={ampliado} aoAmpliar={aoAmpliar} copiar={() => copiarCanvas(canvas.current!)} />
      </div>
      <div className="va-area" ref={area}>
        {!doc && <div className="va-vazio">Abrindo PDF…</div>}
        <div className="va-pagina">
          <canvas ref={canvas} />
          <div ref={texto} className="textLayer" />
        </div>
      </div>
    </div>
  );
}

function VerImagem({ blob, anexo, ampliado, aoAmpliar }: { blob: Blob; anexo: AnexoDoc; ampliado: boolean; aoAmpliar: (v: boolean) => void }) {
  const [url, setUrl] = useState('');
  const [zoom, setZoom] = useState<number | 'largura'>('largura');
  const [giro, setGiro] = useState(0);
  const img = useRef<HTMLImageElement>(null);
  useEffect(() => { const u = URL.createObjectURL(blob); setUrl(u); return () => URL.revokeObjectURL(u); }, [blob]);
  const copiar = useCallback(async () => {
    const i = img.current!;
    const c = document.createElement('canvas');
    const lado = giro % 180 !== 0;
    c.width = lado ? i.naturalHeight : i.naturalWidth; c.height = lado ? i.naturalWidth : i.naturalHeight;
    const g = c.getContext('2d')!;
    g.translate(c.width / 2, c.height / 2); g.rotate((giro * Math.PI) / 180);
    g.drawImage(i, -i.naturalWidth / 2, -i.naturalHeight / 2);
    await copiarCanvas(c);
  }, [giro]);
  const mudarZoom = (f: number) => setZoom((z) => Math.min(5, Math.max(0.2, (typeof z === 'number' ? z : 1) * f)));
  const estilo = zoom === 'largura'
    ? { maxWidth: giro % 180 ? 'none' : '100%', maxHeight: giro % 180 ? 'calc(100% - 8px)' : 'none', transform: `rotate(${giro}deg)` }
    : { width: `${(img.current?.naturalWidth ?? 800) * zoom}px`, maxWidth: 'none', transform: `rotate(${giro}deg)` };
  return (
    <div className="va-corpo">
      <div className="va-barra">
        <button className="btn peq" onClick={() => mudarZoom(1 / 1.2)} aria-label="Diminuir zoom">−</button>
        <span className="va-pag">{typeof zoom === 'number' ? `${Math.round(zoom * 100)}%` : 'Largura'}</span>
        <button className="btn peq" onClick={() => mudarZoom(1.2)} aria-label="Aumentar zoom">+</button>
        <button className="btn peq" onClick={() => setZoom('largura')} aria-pressed={zoom === 'largura'}>Ajustar à largura</button>
        <button className="btn peq" onClick={() => setGiro((g) => (g + 90) % 360)}>Girar 90°</button>
        <span className="va-sep" />
        <BarraComum blob={blob} anexo={anexo} ampliado={ampliado} aoAmpliar={aoAmpliar} copiar={copiar} />
      </div>
      <div className="va-area va-area-img">
        {url && <img ref={img} src={url} alt={anexo.nome} style={estilo} />}
      </div>
    </div>
  );
}

/** Formatos sem visualização embutida: download claro (vídeo e áudio também tocam aqui). Nada do arquivo é executado. */
function VerOutro({ blob, anexo, ampliado, aoAmpliar }: { blob: Blob; anexo: AnexoDoc; ampliado: boolean; aoAmpliar: (v: boolean) => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const u = URL.createObjectURL(blob); setUrl(u); return () => URL.revokeObjectURL(u); }, [blob]);
  const midia = anexo.tipo_mime.startsWith('video/') ? 'video' : anexo.tipo_mime.startsWith('audio/') ? 'audio' : null;
  return (
    <div className="va-corpo">
      <div className="va-barra"><BarraComum blob={blob} anexo={anexo} ampliado={ampliado} aoAmpliar={aoAmpliar} /></div>
      <div className="va-area va-outro">
        {midia === 'video' && url && <video src={url} controls preload="metadata" className="va-midia" />}
        {midia === 'audio' && url && <audio src={url} controls preload="metadata" />}
        <div className="va-outro-info">
          <strong>{anexo.nome}</strong>
          <span className="pequeno suave">{CATEGORIA[anexo.categoria]} · {fmtTamanho(anexo.tamanho)} · enviado por {anexo.enviado_por_nome} em {fmtDataHora(anexo.enviado_em)}</span>
          <p className="pequeno">{midia ? 'Se o player não tocar este formato neste navegador, baixe o arquivo.' : 'Este formato não tem visualização aqui. Baixe para abrir no programa do seu computador.'}</p>
          <div><button className="btn primario" onClick={() => baixarBlob(blob, anexo.nome)}>Baixar {anexo.nome}</button></div>
        </div>
      </div>
    </div>
  );
}
