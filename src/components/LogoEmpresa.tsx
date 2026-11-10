import { useRef, useState } from 'react';
import { mensagemErro, type LogoCandidata } from '../data/api';
import { useApp } from '../data/store';
import { reduzirDataUrl, reduzirImagem } from '../lib/cnpj';

/** Logo do cliente inteira (sem corte); sem logo, as iniciais. */
export function LogoCliente({ url, nome: n, tam = 36, larg }: { url?: string | null; nome: string; tam?: number; larg?: number }) {
  const [falhou, setFalhou] = useState(false);
  if (url && !falhou) {
    // Logo inteira, sem corte: caixa retangular com a imagem contida.
    return <img src={url} alt={`Logo ${n}`} width={larg ?? tam * 2} height={tam} onError={() => setFalhou(true)}
      style={{ objectFit: 'contain', borderRadius: 8, background: '#fff', border: '1px solid var(--borda)', padding: 3 }} />;
  }
  const iniciais = n.replace(/\[[^\]]*\]/g, '').split(/\s+/).filter((p) => /^[\p{L}\d]/u.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  return (
    <div aria-hidden style={{ width: tam, height: tam, borderRadius: 8, background: 'var(--vinho-claro, #f3e7e9)', color: 'var(--vinho)',
      display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: tam * 0.36 }}>{iniciais}</div>
  );
}

/**
 * Escolha da logo: busca no site / Wikimedia, Google Imagens (copiar e colar), envio de arquivo.
 * Usada no cadastro de clientes do Travion e no de clientes do Industrializado.
 */
export function EscolherLogo({ valor, aoMudar, nomeEmpresa, site, aoMudarSite, aoErro }: {
  valor: string | null; aoMudar: (v: string | null) => void; nomeEmpresa: string;
  site: string; aoMudarSite: (v: string) => void; aoErro: (msg: string | null) => void;
}) {
  const { api } = useApp();
  const [logos, setLogos] = useState<LogoCandidata[] | null>(null);
  const [buscandoLogo, setBuscandoLogo] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);
  const nome = nomeEmpresa.replace(/\[DEMO\]/gi, '').trim();

  async function enviarLogo(f: File | undefined) {
    if (!f) return;
    try { aoMudar(await reduzirImagem(f)); } catch (e) { aoErro(mensagemErro(e)); }
  }

  async function buscarLogo() {
    const temSite = /^[\w.-]+\.[a-z]{2,}/i.test(site.trim().replace(/^https?:\/\//, ''));
    if (!temSite && nome.length < 2) { aoErro('Informe o site ou o nome da empresa para buscar a logo.'); return; }
    aoErro(null); setLogos(null); setBuscandoLogo(true);
    try { setLogos(await api.buscarLogos(temSite ? site : '', nome)); } catch (e) { aoErro(mensagemErro(e)); } finally { setBuscandoLogo(false); }
  }

  // Imagem copiada (ex.: "Copiar imagem" no Google Imagens) colada com Ctrl+V ou pelo botão "Colar imagem".
  async function colarLogo(e?: React.ClipboardEvent) {
    try {
      if (e) {
        const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
        if (!f) return;
        e.preventDefault();
        aoMudar(await reduzirImagem(f)); setLogos(null); aoErro(null);
        return;
      }
      if (!navigator.clipboard?.read) { aoErro('Este navegador não deixa colar pelo botão. Use Ctrl+V nesta área ou "Enviar imagem".'); return; }
      for (const item of await navigator.clipboard.read()) {
        const tipo = item.types.find((t) => t.startsWith('image/'));
        if (!tipo) continue;
        const blob = await item.getType(tipo);
        aoMudar(await reduzirImagem(new File([blob], 'logo', { type: tipo }))); setLogos(null); aoErro(null);
        return;
      }
      aoErro('Não há imagem copiada. No Google Imagens, abra a imagem, use "Copiar imagem" e tente de novo.');
    } catch (err) { aoErro(mensagemErro(err)); }
  }

  async function escolherLogo(c: LogoCandidata) {
    try { aoMudar(await reduzirDataUrl(c.dataUrl)); setLogos(null); } catch (e) { aoErro(mensagemErro(e)); }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }} onPaste={(e) => void colarLogo(e)}>
        <LogoCliente key={String(valor)} url={valor} nome={nomeEmpresa || '?'} tam={72} larg={180} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 260px' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="entrada" style={{ flex: '1 1 180px' }} placeholder="site da empresa (ex.: empresa.com.br)" value={site} onChange={(e) => aoMudarSite(e.target.value)} />
            <button type="button" className="btn secundario" disabled={buscandoLogo} onClick={buscarLogo}>{buscandoLogo ? 'Procurando…' : 'Buscar logo'}</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a className="btn terciario" target="_blank" rel="noopener noreferrer"
              href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${nome || site} logo png`)}`}
              onClick={(e) => { if (!nome && !site.trim()) { e.preventDefault(); aoErro('Informe o nome ou o site da empresa.'); } }}>Ver no Google Imagens ↗</a>
            <button type="button" className="btn terciario" onClick={() => void colarLogo()}>Colar imagem</button>
            <button type="button" className="btn terciario" onClick={() => arquivo.current?.click()}>Enviar imagem</button>
            {valor ? <button type="button" className="btn sutil" onClick={() => aoMudar(null)}>Remover logo</button> : null}
            <input ref={arquivo} type="file" accept="image/*" hidden onChange={(e) => void enviarLogo(e.target.files?.[0])} />
          </div>
          <small className="suave">"Buscar logo" lê o site da empresa e a logo oficial registrada na Wikimedia; escolha a que estiver completa. Se nenhuma servir, abra o Google Imagens, use "Copiar imagem" e cole aqui (Ctrl+V ou "Colar imagem"), ou envie o arquivo.</small>
        </div>
      </div>
      {logos && (
        <div>
          <p className="pequeno" style={{ margin: '4px 0 8px' }}><strong>Escolha a logo ({logos.length} encontrada{logos.length > 1 ? 's' : ''}):</strong></p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {logos.map((c) => (
              <button key={c.url} type="button" onClick={() => void escolherLogo(c)} title={c.url}
                style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', padding: 8, borderRadius: 10, border: '1px solid var(--borda)', background: '#fff', cursor: 'pointer', minHeight: 44 }}>
                <img src={c.dataUrl} alt="" style={{ width: '100%', height: 70, objectFit: 'contain' }} />
                <span className="pequeno suave">{c.origem}</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn sutil peq" onClick={() => setLogos(null)}>Fechar opções</button>
        </div>
      )}
    </>
  );
}
