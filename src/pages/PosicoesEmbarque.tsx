// Posições de Embarque: resumo por cliente gerado a partir da mesma base da Lista de Fretes.
// Nada é enviado automaticamente: o usuário copia, baixa ou abre o aplicativo de destino.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CartaoPosicao, type DadosCartao, rodapeInstantaneo } from '../components/CartaoPosicao';
import { FormVersionado } from '../components/FormVersionado';
import { Layout } from '../components/Layout';
import { AcessoNegado, Alerta, EstadoVazio, Icone, Modal, useAviso } from '../components/ui';
import { mensagemErro } from '../data/api';
import { useApp, useIndices, useLinhas } from '../data/store';
import { codigoEmbarque, nome } from '../lib/cadastros';
import { assuntoEmail, corpoEmail, type ItemPosicaoCliente, montarPosicaoCliente, type OpcoesExibicao, textoWhatsApp } from '../lib/compartilhamento';
import { fmtData, fmtDataHora, hojeSP } from '../lib/formato';
import type { LinkCliente, Posicao } from '../types';

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

async function copiarComAviso(texto: string, ok: string, avisar: (t: 'ok' | 'erro', m: string) => void) {
  if (await copiar(texto)) avisar('ok', ok);
  else avisar('erro', 'Não foi possível copiar. Selecione o texto e copie manualmente.');
}

function baixar(blob: Blob, arquivo: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = arquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const nomeArquivo = (cliente: string, data: string) =>
  `posicao-${cliente.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-${data}`;

export const urlConsulta = (token: string) => `${location.origin}${location.pathname}#/consulta/${token}`;

export function PosicoesEmbarque() {
  const { estado, pode, definirData, aplicarPosicao } = useApp();
  const idx = useIndices();
  const avisar = useAviso();
  const linhas = useLinhas();
  const [clienteId, setClienteId] = useState('');
  const [op, setOp] = useState<OpcoesExibicao>({ carregados: false, volumes: false });
  const [gerando, setGerando] = useState<'' | 'imagem' | 'pdf'>('');
  const [instantaneo, setInstantaneo] = useState<string | null>(null);
  const [linkRecente, setLinkRecente] = useState<Record<string, string>>({});
  const cartaoRef = useRef<HTMLDivElement>(null);

  // Clientes com posição na data aparecem primeiro; os demais ficam disponíveis (resumo vazio).
  const clientes = useMemo(() => {
    const comPosicao = new Set(linhas.filter((l) => l.posicao).map((l) => l.embarque.cliente_id));
    const ids = new Set(linhas.map((l) => l.embarque.cliente_id));
    return [...ids].map((id) => ({ id, nome: nome(idx.cliente, id), tem: comPosicao.has(id) }))
      .sort((a, b) => Number(b.tem) - Number(a.tem) || a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [linhas, idx]);

  useEffect(() => {
    if (!clienteId || !clientes.some((c) => c.id === clienteId)) setClienteId(clientes.find((c) => c.tem)?.id ?? clientes[0]?.id ?? '');
  }, [clientes, clienteId]);

  const doCliente = useMemo(() => linhas.filter((l) => l.embarque.cliente_id === clienteId), [linhas, clienteId]);
  const pos = useMemo(() => montarPosicaoCliente(nome(idx.cliente, clienteId), estado.data, doCliente, idx), [doCliente, idx, clienteId, estado.data]);
  const texto = useMemo(() => textoWhatsApp(pos, op), [pos, op]);
  const semPosicao = doCliente.filter((l) => !l.posicao && l.embarque.situacao === 'ativo').length;
  const suspensos = pos.itens.reduce((s, i) => s + i.suspensos, 0);

  const cartao: DadosCartao = {
    cliente: pos.cliente, data: pos.data, atualizado_em: pos.atualizado_em,
    mostrarCarregados: op.carregados, mostrarVolumes: op.volumes, demonstrativo: estado.demo,
    itens: pos.itens.map((i) => ({
      origem: i.origem, coleta: i.coleta, destino: i.destino, entrega: i.entrega, produto: i.produto,
      porta: i.porta, transito: i.transito, carregados: i.carregados,
      porta_t: i.porta_t, transito_t: i.transito_t, carregado_t: i.carregado_t,
      observacao: i.observacoes.join(' | ') || null,
    })),
  };

  if (!pode('compartilhamento.preparar')) {
    return <Layout titulo="Posições de Embarque"><AcessoNegado motivo="Seu perfil não pode preparar posições para clientes." /></Layout>;
  }

  async function capturar(): Promise<HTMLCanvasElement> {
    const agora = new Date().toISOString();
    setInstantaneo(agora);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const { default: html2canvas } = await import('html2canvas');
    try {
      return await html2canvas(cartaoRef.current!, { scale: 2, backgroundColor: '#ffffff', logging: false });
    } finally {
      setInstantaneo(null);
    }
  }

  async function gerarImagem() {
    setGerando('imagem');
    try {
      const canvas = await capturar();
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('Não foi possível gerar a imagem.');
      const arquivo = `${nomeArquivo(pos.cliente, pos.data)}.png`;
      const file = new File([blob], arquivo, { type: 'image/png' });
      // No celular, abre o menu de compartilhar do aparelho (o usuário escolhe o destino); senão, baixa o arquivo.
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: assuntoEmail(pos) }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
      }
      baixar(blob, arquivo);
      avisar('ok', 'Imagem gerada.');
    } catch (e) {
      avisar('erro', mensagemErro(e));
    } finally {
      setGerando('');
    }
  }

  async function gerarPdf() {
    setGerando('pdf');
    try {
      const canvas = await capturar();
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const margem = 12;
      const largura = 210 - margem * 2;
      const alturaPagina = 297 - margem * 2;
      const pxPorMm = canvas.width / largura;
      const fatiaPx = Math.floor(alturaPagina * pxPorMm);
      for (let y = 0, pagina = 0; y < canvas.height; y += fatiaPx, pagina++) {
        const h = Math.min(fatiaPx, canvas.height - y);
        const parte = document.createElement('canvas');
        parte.width = canvas.width;
        parte.height = h;
        parte.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        if (pagina > 0) pdf.addPage();
        pdf.addImage(parte.toDataURL('image/png'), 'PNG', margem, margem, largura, h / pxPorMm);
      }
      pdf.setProperties({ title: assuntoEmail(pos) });
      baixar(pdf.output('blob'), `${nomeArquivo(pos.cliente, pos.data)}.pdf`);
      avisar('ok', 'PDF gerado.');
    } catch (e) {
      avisar('erro', mensagemErro(e));
    } finally {
      setGerando('');
    }
  }

  const link = linkRecente[clienteId];
  const assunto = assuntoEmail(pos);
  const corpo = corpoEmail(pos, op, link);

  return (
    <Layout titulo="Posições de Embarque">
      <div className="ferramentas" style={{ marginBottom: 12 }}>
        <label className="campo"><span>Data</span>
          <input className="entrada" type="date" value={estado.data} max={hojeSP()} onChange={(e) => e.target.value && definirData(e.target.value)} />
        </label>
        {estado.data !== hojeSP() && <button className="btn peq" style={{ alignSelf: 'flex-end' }} onClick={() => definirData(hojeSP())}>Ir para hoje</button>}
        <label className="campo" style={{ minWidth: 220, flex: 1 }}><span>Cliente</span>
          <select className="entrada" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            {clientes.length === 0 && <option value="">Nenhum cliente no seu escopo</option>}
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.tem ? '' : ' (sem posição na data)'}</option>)}
          </select>
        </label>
        <fieldset className="campo" style={{ border: 0, padding: 0, margin: 0 }}>
          <span>Exibir também</span>
          <div className="grupo-btn">
            <label className="check"><input type="checkbox" checked={op.carregados} onChange={(e) => setOp({ ...op, carregados: e.target.checked })} />Carregados</label>
            <label className="check"><input type="checkbox" checked={op.volumes} onChange={(e) => setOp({ ...op, volumes: e.target.checked })} />Volumes (t)</label>
          </div>
        </fieldset>
      </div>

      {!clienteId ? (
        <EstadoVazio titulo="Nenhum cliente encontrado">Não há embarques no seu escopo para montar uma posição.</EstadoVazio>
      ) : (
        <>
          {semPosicao > 0 && <Alerta tipo="info">{semPosicao} embarque(s) ativo(s) deste cliente não têm posição em {fmtData(estado.data)} e não aparecem no resumo. Abra as posições na Lista de Fretes.</Alerta>}
          {suspensos > 0 && <Alerta tipo="aviso">{suspensos} embarque(s) suspenso(s) com posição estão incluídos. O status não aparece para o cliente; revise antes de enviar.</Alerta>}
          {estado.demo && <Alerta tipo="aviso">Modo demonstração: os números são fictícios.</Alerta>}

          <div className="colunas-2" style={{ marginTop: 12 }}>
            <section>
              <h2 className="pequeno" style={{ textTransform: 'uppercase', color: 'var(--cinza-600)' }}>Prévia</h2>
              <CartaoPosicao ref={cartaoRef} d={cartao} rodape={instantaneo ? rodapeInstantaneo(instantaneo) : undefined} />
            </section>
            <section style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              <div className="cartao">
                <div className="cartao-cab"><h3 style={{ margin: 0 }}>Texto para WhatsApp</h3></div>
                <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <pre className="texto-whats">{texto}</pre>
                  <div className="grupo-btn">
                    <button className="btn primario" onClick={() => copiarComAviso(texto, 'Texto copiado.', avisar)}><Icone nome="copiar" tam={18} />Copiar texto</button>
                    <a className="btn" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer"><Icone nome="whats" tam={18} />Abrir no WhatsApp</a>
                  </div>
                  <small className="suave">“Abrir no WhatsApp” só prepara a mensagem; você escolhe o contato e envia.</small>
                </div>
              </div>

              <div className="cartao">
                <div className="cartao-cab"><h3 style={{ margin: 0 }}>Imagem e PDF</h3></div>
                <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="grupo-btn">
                    <button className="btn" disabled={!!gerando} onClick={gerarImagem}><Icone nome="baixar" tam={18} />{gerando === 'imagem' ? 'Gerando…' : 'Imagem (PNG)'}</button>
                    <button className="btn" disabled={!!gerando} onClick={gerarPdf}><Icone nome="baixar" tam={18} />{gerando === 'pdf' ? 'Gerando…' : 'PDF'}</button>
                  </div>
                  <small className="suave">Imagem e PDF são um retrato do momento em que foram gerados (o horário fica impresso). Para números sempre atualizados, use o link de consulta.</small>
                </div>
              </div>

              <div className="cartao">
                <div className="cartao-cab"><h3 style={{ margin: 0 }}>E-mail</h3></div>
                <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <label className="campo"><span>Assunto</span><input className="entrada" readOnly value={assunto} /></label>
                  <div className="grupo-btn">
                    <button className="btn" onClick={() => copiarComAviso(assunto, 'Assunto copiado.', avisar)}>Copiar assunto</button>
                    <button className="btn" onClick={() => copiarComAviso(corpo, 'Corpo copiado.', avisar)}>Copiar corpo</button>
                    <a className="btn" href={`mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`}><Icone nome="email" tam={18} />Abrir no e-mail</a>
                  </div>
                  <small className="suave">{link ? 'O corpo inclui o link de consulta criado agora.' : 'Crie um link de consulta abaixo para incluí-lo no corpo do e-mail.'}</small>
                </div>
              </div>

              {pode('compartilhamento.links') && (
                <LinksCliente clienteId={clienteId} op={op} aoCriar={(url) => setLinkRecente({ ...linkRecente, [clienteId]: url })} />
              )}
            </section>
          </div>

          <h2 className="secao-titulo">Detalhe por rota e embarque</h2>
          <DetalheRotas itens={pos.itens} podeEditarObs={pode('posicoes.editar_obs_cliente')} aplicar={aplicarPosicao} />
        </>
      )}
    </Layout>
  );
}

function DetalheRotas({ itens, podeEditarObs, aplicar }: { itens: ItemPosicaoCliente[]; podeEditarObs: boolean; aplicar: (p: Posicao) => void }) {
  const { api } = useApp();
  const [editando, setEditando] = useState<string | null>(null);
  if (!itens.length) return <EstadoVazio titulo="Sem posições nesta data" />;
  return (
    <div className="cartao rolagem-x">
      <table className="tabela">
        <thead><tr><th>Rota</th><th>Embarque</th><th className="n">Porta</th><th className="n">Trânsito</th><th className="n">Carregados</th><th>Observação para o cliente</th><th /></tr></thead>
        <tbody>
          {itens.map((i) => i.linhas.map((l, n) => (
            <tr key={l.embarque.id}>
              {n === 0 && <td rowSpan={i.linhas.length}><strong>{i.origem}</strong>{i.coleta && <div className="pequeno suave">{i.coleta}</div>}<div>→ <strong>{i.destino}</strong></div>{i.entrega && <div className="pequeno suave">{i.entrega}</div>}{i.produto && <div className="pequeno">{i.produto}</div>}</td>}
              <td className="mono">{codigoEmbarque(l.embarque.codigo)}{l.embarque.status_liberacao === 'suspenso' && <div><span className="badge suspenso">■ Suspenso</span></div>}</td>
              <td className="n">{l.posicao!.porta ?? '—'}</td>
              <td className="n">{l.posicao!.transito ?? '—'}</td>
              <td className="n">{l.posicao!.carregados ?? '—'}</td>
              <td style={{ minWidth: 220 }}>
                {editando === l.posicao!.id ? (
                  <FormVersionado registro={l.posicao!} rotuloSalvar="Salvar observação"
                    campos={[{ campo: 'obs_cliente', rotulo: 'Observação pública', tipo: 'textarea', pode: true, ajuda: 'Aparece para o cliente. Não escreva informações internas.' }]}
                    salvar={(alt, base, forcar) => api.atualizarPosicao(l.posicao!.id, alt, base, forcar)}
                    aoSalvo={(p) => { aplicar(p); setEditando(null); }} />
                ) : (l.posicao!.obs_cliente || <span className="suave">—</span>)}
              </td>
              <td className="td-acao">
                {podeEditarObs && editando !== l.posicao!.id && <button className="btn peq sutil" onClick={() => setEditando(l.posicao!.id)}>Editar</button>}
                {editando === l.posicao!.id && <button className="btn peq sutil" onClick={() => setEditando(null)}>Fechar</button>}
              </td>
            </tr>
          )))}
        </tbody>
      </table>
        </div>
  );
}

function LinksCliente({ clienteId, op, aoCriar }: { clienteId: string; op: OpcoesExibicao; aoCriar: (url: string) => void }) {
  const { api, estado } = useApp();
  const avisar = useAviso();
  const [links, setLinks] = useState<LinkCliente[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [novo, setNovo] = useState<{ url: string; expira: string } | null>(null);
  const [revogar, setRevogar] = useState<LinkCliente | null>(null);
  const [horas, setHoras] = useState(String(estado.config.link_validade_padrao_horas));
  const [descricao, setDescricao] = useState('');

  const carregar = () => {
    setErro(null);
    api.listarLinks(clienteId).then(setLinks).catch((e) => setErro(mensagemErro(e)));
  };
  useEffect(() => { setLinks(null); setNovo(null); carregar(); }, [clienteId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function criar() {
    const h = Number(horas);
    if (!Number.isInteger(h) || h < 1 || h > 720) { setErro('Validade deve ser de 1 a 720 horas.'); return; }
    setCriando(true);
    setErro(null);
    try {
      const r = await api.criarLink(clienteId, h, op.carregados, op.volumes, descricao.trim() || null);
      const url = urlConsulta(r.token);
      setNovo({ url, expira: r.expira_em });
      aoCriar(url);
      setDescricao('');
      carregar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setCriando(false);
    }
  }

  const agora = new Date().toISOString();
  const situacao = (l: LinkCliente) => l.revogado_em ? 'Revogado' : l.expira_em < agora ? 'Expirado' : 'Ativo';

  return (
    <div className="cartao">
      <div className="cartao-cab"><h3 style={{ margin: 0 }}>Link de consulta do cliente</h3></div>
      <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p className="pequeno suave" style={{ margin: 0 }}>
          Somente leitura e só deste cliente. Mostra a posição mais recente até hoje, sem valores financeiros, observações internas ou nomes de usuários.
          As opções “Carregados” e “Volumes” marcadas acima valem para o link.
        </p>
        <div className="grade-campos">
          <label className="campo"><span>Validade (horas)</span><input className="entrada" inputMode="numeric" value={horas} onChange={(e) => setHoras(e.target.value)} /></label>
          <label className="campo"><span>Descrição interna (opcional)</span><input className="entrada" value={descricao} maxLength={120} placeholder="ex.: contato da logística" onChange={(e) => setDescricao(e.target.value)} /></label>
        </div>
        <div><button className="btn primario" disabled={criando} onClick={criar}><Icone nome="link" tam={18} />{criando ? 'Criando…' : 'Criar link de consulta'}</button></div>
        {novo && (
          <Alerta tipo="ok">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <strong>Link criado. Copie agora: por segurança ele não será exibido de novo.</strong>
              <code style={{ overflowWrap: 'anywhere' }}>{novo.url}</code>
              <span className="pequeno">Expira em {fmtDataHora(novo.expira)}.</span>
              <div><button className="btn peq" onClick={() => copiarComAviso(novo.url, 'Link copiado.', avisar)}><Icone nome="copiar" tam={16} />Copiar link</button></div>
            </div>
          </Alerta>
        )}
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {links === null && !erro && <span className="suave pequeno">Carregando links…</span>}
        {links && links.length > 0 && (
          <div className="rolagem-x">
            <table className="tabela">
              <thead><tr><th>Link</th><th>Situação</th><th>Expira</th><th className="n">Acessos</th><th /></tr></thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.id}>
                    <td><span className="mono">{l.token_prefixo}…</span>{l.descricao && <div className="pequeno suave">{l.descricao}</div>}</td>
                    <td><span className={`badge ${situacao(l) === 'Ativo' ? 'liberado' : 'nao_informado'}`}>{situacao(l)}</span></td>
                    <td className="pequeno">{fmtDataHora(l.expira_em)}</td>
                    <td className="n">{l.acessos}</td>
                    <td className="td-acao">{situacao(l) === 'Ativo' && <button className="btn peq perigo" onClick={() => setRevogar(l)}>Revogar</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {links && links.length === 0 && <span className="suave pequeno">Nenhum link criado para este cliente.</span>}
      </div>
      {revogar && (
        <Modal titulo="Revogar link" aoFechar={() => setRevogar(null)} rodape={<>
          <button className="btn" onClick={() => setRevogar(null)}>Cancelar</button>
          <button className="btn primario" onClick={async () => {
            try { await api.revogarLink(revogar.id); avisar('ok', 'Link revogado.'); carregar(); } catch (e) { avisar('erro', mensagemErro(e)); }
            setRevogar(null);
          }}>Revogar</button>
        </>}>
          <p style={{ margin: 0 }}>O link <span className="mono">{revogar.token_prefixo}…</span> deixará de funcionar imediatamente para quem o tiver. Esta ação não pode ser desfeita; se precisar, crie um novo link.</p>
        </Modal>
      )}
    </div>
  );
}
