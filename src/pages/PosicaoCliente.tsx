// Posição do Cliente: consulta da mesa comercial e quadro para o cliente.
// Lê as mesmas posições diárias que os supervisores salvam (nenhuma segunda digitação) e não altera nada.
// O envio é manual: o botão gera o PNG do quadro do cliente e copia para a área de transferência.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AtualizacaoCentros } from '../components/AtualizacaoCentros';
import { Layout } from '../components/Layout';
import { QuadroPosicao } from '../components/QuadroPosicao';
import { AcessoNegado, Alerta, Carregando, Icone, Segmentado } from '../components/ui';
import { mensagemErro } from '../data/api';
import { useApp, useIndices, useLinhas } from '../data/store';
import { nome } from '../lib/cadastros';
import { fmtData, fmtDataAsHora, fmtHora, fmtPct, hojeSP } from '../lib/formato';
import { infoMesa, type LinhaRelatorio, montarQuadro, type QuadroCliente, recorteCliente, relatorioFiliais } from '../lib/posicoes';

const SEM_CARTEIRA = '__sem';
/** Limites seguros de canvas nos navegadores (lado e área). */
const LADO_MAX = 16000;
const AREA_MAX = 100e6;

const nomeArquivo = (cliente: string, data: string) =>
  `posicao-${cliente.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-${data}.png`;

const esperar = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

interface Resultado { url: string; blob: Blob; copiado: boolean; aviso: string | null }

export function PosicaoCliente() {
  const { api, estado, pode, definirData } = useApp();
  const idx = useIndices();
  const linhas = useLinhas();
  const data = estado.data;
  const hoje = hojeSP();
  const [carteira, setCarteira] = useState('');
  const [clienteId, setClienteId] = useState('');
  // Filiais desmarcadas no recorte do cliente (todas vêm marcadas).
  const [desmarcadas, setDesmarcadas] = useState<Set<string>>(() => new Set());
  const [visao, setVisao] = useState<'mesa' | 'cliente'>('mesa');
  const [distribuir, setDistribuir] = useState(true);
  const [desvio, setDesvio] = useState<number | null>(null);
  const [, setTique] = useState(0);
  const [captura, setCaptura] = useState<QuadroCliente | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const capturaRef = useRef<HTMLDivElement>(null);
  const prontoRef = useRef<((el: HTMLDivElement) => void) | null>(null);

  // Relógio do servidor (janela de duas horas) e atualização da janela a cada 30 s.
  useEffect(() => {
    const t0 = Date.now();
    api.agoraServidor().then((s) => setDesvio(Date.parse(s) - (t0 + Date.now()) / 2)).catch(() => setDesvio(null));
    const t = setInterval(() => setTique((x) => x + 1), 30e3);
    return () => clearInterval(t);
  }, [api]);
  const agoraMs = Date.now() + (desvio ?? 0);

  useEffect(() => { if (captura && capturaRef.current) prontoRef.current?.(capturaRef.current); }, [captura]);
  useEffect(() => () => { if (resultado) URL.revokeObjectURL(resultado.url); }, [resultado]);

  // Filtros em cascata, só com o que o servidor liberou para este usuário.
  const base = useMemo(() => linhas.filter((l) => l.embarque.situacao === 'ativo' || l.posicao), [linhas]);
  const daCarteira = useMemo(() => base.filter((l) => !carteira || (l.embarque.comercial_id ?? SEM_CARTEIRA) === carteira), [base, carteira]);
  const opCarteiras = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of base) { const c = l.embarque.comercial_id ?? SEM_CARTEIRA; m.set(c, c === SEM_CARTEIRA ? 'Sem carteira' : nome(idx.comercial, c)); }
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [base, idx]);
  const opClientes = useMemo(() => {
    const m = new Map<string, { nome: string; tem: boolean }>();
    for (const l of daCarteira) {
      const c = m.get(l.embarque.cliente_id) ?? { nome: nome(idx.cliente, l.embarque.cliente_id), tem: false };
      c.tem ||= !!l.posicao;
      m.set(l.embarque.cliente_id, c);
    }
    return [...m].sort((a, b) => a[1].nome.localeCompare(b[1].nome, 'pt-BR'));
  }, [daCarteira, idx]);
  const opFiliais = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of base) if (l.embarque.cliente_id === clienteId) m.set(l.embarque.filial_id, nome(idx.filial, l.embarque.filial_id));
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [base, clienteId, idx]);

  useEffect(() => { if (carteira && !opCarteiras.some(([v]) => v === carteira)) setCarteira(''); }, [carteira, opCarteiras]);
  useEffect(() => { if (clienteId && !opClientes.some(([v]) => v === clienteId)) setClienteId(''); }, [clienteId, opClientes]);
  useEffect(() => { setDesmarcadas(new Set()); }, [clienteId]);

  // Cliente escolhido: todas as posições dele (a carteira só filtra a lista de clientes), menos as filiais desmarcadas.
  const naFilial = (filialId: string) => !desmarcadas.has(filialId);
  const recorte = useMemo(() => (clienteId ? recorteCliente(base, clienteId, '', idx).filter((l) => !desmarcadas.has(l.embarque.filial_id)) : []), [base, clienteId, desmarcadas, idx]);
  const filiaisMarcadas = opFiliais.filter(([v]) => naFilial(v)).map(([, r]) => r);
  const rotuloFiliais = filiaisMarcadas.length === opFiliais.length ? null : filiaisMarcadas.join(', ') || 'nenhuma filial';
  function alternarFilial(id: string) {
    setDesmarcadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  const quadro = useMemo(() => (clienteId ? montarQuadro(recorte, clienteId, data, idx, estado.config.logo_empresa) : null), [recorte, clienteId, data, idx, estado.config.logo_empresa]);
  const mesa = useMemo(() => infoMesa(recorte, data, agoraMs), [recorte, data, agoraMs]);
  const relatorio = useMemo(() => relatorioFiliais(recorte, data, agoraMs, idx), [recorte, data, agoraMs, idx]);

  if (!pode('compartilhamento.preparar')) {
    return <Layout titulo="Posição do Cliente"><AcessoNegado motivo="Seu perfil não pode preparar posições para clientes." /></Layout>;
  }

  async function gerarPng(q: QuadroCliente): Promise<Blob> {
    // Versão dedicada do quadro do cliente, congelada no clique, em largura de computador e altura completa.
    const el = await new Promise<HTMLDivElement>((ok) => { prontoRef.current = ok; setCaptura(q); });
    await esperar();
    await document.fonts?.ready;
    await Promise.all([...el.querySelectorAll('img')].map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))));
    const w = el.scrollWidth;
    const h = el.scrollHeight;
    const escala = Math.min(2, LADO_MAX / w, LADO_MAX / h, Math.sqrt(AREA_MAX / (w * h)));
    if (escala < 1) throw new Error(`O quadro tem ${q.linhas.length} embarques e passou do tamanho que o navegador consegue gerar. Desmarque filiais para dividir o envio.`);
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(el, { scale: escala, backgroundColor: '#ffffff', logging: false, useCORS: true, width: w, height: h, windowWidth: 1280 });
    const blob = await new Promise<Blob | null>((r) => {
      try { canvas.toBlob(r, 'image/png'); } catch { r(null); }
    });
    if (!blob) throw new Error('Não foi possível gerar a imagem (uma logo de site externo pode ter bloqueado a captura). Envie a logo como arquivo no cadastro.');
    return blob;
  }

  async function prepararEnvio() {
    if (!quadro || preparando) return;
    setPreparando(true);
    setErro(null);
    setAviso(null);
    setResultado(null);
    const congelado = JSON.parse(JSON.stringify(quadro)) as QuadroCliente;
    const promessa = gerarPng(congelado);
    let copiado = false;
    let avisoCopia: string | null = null;
    try {
      // A cópia é pedida ainda dentro do clique, com a imagem chegando depois (exigência do Safari).
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('sem suporte');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': promessa })]);
      copiado = true;
    } catch {
      avisoCopia = 'O navegador não deixou copiar a imagem automaticamente. Use “Copiar imagem” abaixo ou baixe o PNG e anexe no WhatsApp ou e-mail.';
    }
    try {
      const blob = await promessa;
      setResultado({ url: URL.createObjectURL(blob), blob, copiado, aviso: avisoCopia });
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setCaptura(null);
      setPreparando(false);
    }
  }

  async function copiarDeNovo() {
    if (!resultado) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': resultado.blob })]);
      setResultado({ ...resultado, copiado: true, aviso: null });
    } catch {
      setAviso('Este navegador não permite copiar imagens. Use “Baixar PNG” e anexe o arquivo.');
    }
  }

  function baixar() {
    if (!resultado || !quadro) return;
    const a = document.createElement('a');
    a.href = resultado.url;
    a.download = nomeArquivo(quadro.cliente, data);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const suspensos = recorte.filter((l) => l.embarque.status_liberacao === 'suspenso').length;
  const semPosicao = clienteId ? base.filter((l) => l.embarque.cliente_id === clienteId && naFilial(l.embarque.filial_id) && !l.posicao && l.embarque.situacao === 'ativo').length : 0;

  return (
    <Layout titulo="Posição do Cliente">
      <div className="pc">
        <div className="pc-controles">
          <label className="campo pc-data"><span>Data operacional</span>
            <input className="entrada" type="date" value={data} max={hoje} onChange={(e) => e.target.value && definirData(e.target.value)} />
          </label>
          {data !== hoje && <button className="btn sutil" onClick={() => definirData(hoje)}>Ir para hoje</button>}
          {data === hoje && <AtualizacaoCentros linhas={linhas} idx={idx} />}
          <Segmentado rotulo="Apresentação" valor={visao} aoMudar={setVisao}
            opcoes={[{ valor: 'mesa', rotulo: 'Mesa comercial' }, { valor: 'cliente', rotulo: 'Visão do cliente' }]} />
        </div>

        <div className="pe-filtros" role="group" aria-label="Filtros">
          <label className="filtro-botao"><span>Carteira</span>
            <select value={carteira} onChange={(e) => setCarteira(e.target.value)}>
              <option value="">Todas</option>
              {opCarteiras.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </label>
          <label className="filtro-botao"><span>Cliente</span>
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              <option value="">Selecione o cliente</option>
              {opClientes.map(([v, c]) => <option key={v} value={v}>{c.nome}{c.tem ? '' : ' (sem posição na data)'}</option>)}
            </select>
          </label>
        </div>
        {clienteId && opFiliais.length > 0 && (
          <fieldset className="pc-filiais">
            <legend>Filiais</legend>
            {opFiliais.map(([v, r]) => (
              <label key={v} className="check"><input type="checkbox" checked={naFilial(v)} onChange={() => alternarFilial(v)} />{r}</label>
            ))}
          </fieldset>
        )}
        <label className="check pc-distribuir">
          <input type="checkbox" checked={distribuir} onChange={(e) => setDistribuir(e.target.checked)} />
          Distribuir destinos lado a lado quando houver mais de 4 destinos
        </label>

        {estado.carregando && !base.length ? <Carregando texto="Carregando posições…" /> : estado.erro && !base.length ? (
          <Alerta tipo="erro">{estado.erro}</Alerta>
        ) : !opClientes.length ? (
          <div className="pe-vazio">Nenhum cliente no seu escopo para esta carteira.</div>
        ) : !quadro ? (
          <div className="pe-vazio">Selecione um cliente para montar o quadro.</div>
        ) : (
          <>
            {estado.demo && <Alerta tipo="aviso">Dados demonstrativos (fictícios). Não envie este quadro a clientes.</Alerta>}
            {visao === 'mesa' && suspensos > 0 && <Alerta tipo="aviso">{suspensos} embarque(s) suspenso(s) no recorte. O status não aparece para o cliente; revise antes de enviar.</Alerta>}
            {visao === 'mesa' && semPosicao > 0 && <Alerta tipo="info">{semPosicao} embarque(s) deste cliente sem posição aberta em {fmtData(data)} não entram no quadro.</Alerta>}
            {visao === 'mesa' && (!quadro.logoCliente || !quadro.logoEmpresa) && (
              <Alerta tipo="info">
                {!quadro.logoCliente && 'O cliente não tem logo cadastrada (Administração → Cadastros → Clientes). '}
                {!quadro.logoEmpresa && 'A logo da TP ainda não foi enviada (Administração → Configurações). '}
                A imagem sai sem a logo que faltar.
              </Alerta>
            )}

            <div className="pc-quadro">
              <QuadroPosicao q={quadro} mesa={visao === 'mesa' ? mesa : undefined} distribuir={distribuir} />
            </div>

            <div className="pc-envio">
              <button className="btn primario" disabled={preparando || !quadro.linhas.length} onClick={() => void prepararEnvio()}>
                <Icone nome="copiar" tam={18} />{preparando ? 'Preparando imagem…' : 'Preparar envio ao cliente'}
              </button>
              {!quadro.linhas.length && <span className="suave pequeno">Sem posições no recorte: não há quadro para enviar.</span>}
              {erro && <Alerta tipo="erro">{erro}</Alerta>}
              {resultado && (
                <div className="pc-resultado">
                  {resultado.copiado ? (
                    <Alerta tipo="ok">Imagem copiada. Cole com Ctrl + V no WhatsApp ou e-mail.</Alerta>
                  ) : (
                    <Alerta tipo="aviso">{resultado.aviso}</Alerta>
                  )}
                  {aviso && <Alerta tipo="erro">{aviso}</Alerta>}
                  <div className="grupo-btn">
                    {!resultado.copiado && <button className="btn" onClick={() => void copiarDeNovo()}><Icone nome="copiar" tam={18} />Copiar imagem</button>}
                    <button className="btn" onClick={baixar}><Icone nome="baixar" tam={18} />Baixar PNG</button>
                    <button className="btn sutil" onClick={() => setResultado(null)}>Fechar prévia</button>
                  </div>
                  <figure className="pc-previa">
                    <img src={resultado.url} alt={`Imagem gerada da posição de ${quadro.cliente}`} />
                    <figcaption className="suave pequeno">Prévia da imagem gerada ({fmtDataAsHora(new Date().toISOString())}).</figcaption>
                  </figure>
                </div>
              )}
            </div>

            {visao === 'mesa' && <RelatorioFiliais linhas={relatorio} data={data} agoraMs={agoraMs} filial={rotuloFiliais} cliente={quadro.cliente} relogioServidor={desvio !== null} />}
          </>
        )}
      </div>

      {captura && (
        <div className="pc-captura" aria-hidden="true">
          <QuadroPosicao ref={capturaRef} q={captura} distribuir={distribuir} captura />
        </div>
      )}
    </Layout>
  );
}

function RelatorioFiliais({ linhas, data, agoraMs, filial, cliente, relogioServidor }: {
  linhas: LinhaRelatorio[]; data: string; agoraMs: number; filial: string | null; cliente: string; relogioServidor: boolean;
}) {
  const inicio = new Date(agoraMs - 2 * 3600e3).toISOString();
  return (
    <section className="cartao pc-relatorio">
      <div className="cartao-cab">
        <div>
          <h2>Atualização das posições por filial</h2>
          <div className="suave pequeno">
            {cliente} · {fmtData(data)} · {filial ?? 'todas as filiais autorizadas'} · confirmações entre {fmtHora(inicio)} e {fmtHora(new Date(agoraMs).toISOString())} (últimas 2 horas)
            {!relogioServidor && ' · horário deste aparelho (servidor indisponível)'}
          </div>
        </div>
      </div>
      <div className="rolagem-x">
        <table className="tabela pc-rel">
          <thead><tr><th>Filial</th><th>Quem atualizou</th><th className="n">Embarques</th><th className="n">Atualizados (2 h)</th><th className="n">Pendentes</th><th className="n">Cobertura</th></tr></thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.filialId}>
                <td><strong>{l.filial}</strong></td>
                <td>
                  {l.responsaveis.length ? l.responsaveis.join(', ') : <span className="suave">Nenhuma confirmação nesta data</span>}
                  {l.ultima && <div className="pequeno suave">Última: {fmtHora(l.ultima)}</div>}
                </td>
                <td className="n">{l.total}</td>
                <td className="n">{l.atualizados}</td>
                <td className="n">{l.pendentes}{l.nuncaConfirmadas > 0 && <div className="pequeno suave">{l.nuncaConfirmadas} nunca confirmada(s)</div>}</td>
                <td className="n">{l.cobertura === null ? '—' : fmtPct(l.cobertura, 0)}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={6} className="suave">Sem embarques no recorte.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
