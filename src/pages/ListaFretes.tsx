import { useMemo, useState } from 'react';
import { BarraFiltros } from '../components/Filtros';
import { Contador } from '../components/Contador';
import { Layout } from '../components/Layout';
import { AbrirPosicoes } from '../components/AbrirPosicoes';
import { DetalhesEmbarque } from '../components/DetalhesEmbarque';
import { NovoEmbarque } from '../components/NovoEmbarque';
import { Alerta, BadgeStatus, Carregando, EstadoVazio, Icone, Segmentado } from '../components/ui';
import { useApp, useIndices, useLinhas } from '../data/store';
import { type Indices, cidadeUF, codigoEmbarque, nome } from '../lib/cadastros';
import { resumir } from '../lib/calculos';
import { aplicarFiltros } from '../lib/filtros';
import { fmtData, fmtT } from '../lib/formato';
import type { LinhaFrete } from '../types';

type Agrupar = 'nenhum' | 'cliente' | 'filial';
const CHAVE_AGRUPAR = 'frete-iq-agrupar';

export function ListaFretes() {
  const { estado, pode } = useApp();
  const idx = useIndices();
  const todas = useLinhas();
  const linhas = useMemo(() => aplicarFiltros(todas, estado.filtros, idx), [todas, estado.filtros, idx]);
  const [agrupar, setAgrupar] = useState<Agrupar>(() => { try { return (localStorage.getItem(CHAVE_AGRUPAR) as Agrupar) || 'nenhum'; } catch { return 'nenhum'; } });
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [abrir, setAbrir] = useState(false);
  const [novo, setNovo] = useState(false);

  const semPosicao = todas.filter((l) => !l.posicao && l.embarque.situacao === 'ativo').length;
  const comPosicao = todas.filter((l) => l.posicao).length;
  const r = useMemo(() => resumir(linhas, estado.config, false), [linhas, estado.config]);
  const podeEditar = pode('posicoes.editar_contadores');

  const grupos = useMemo(() => {
    if (agrupar === 'nenhum') return [{ chave: '', titulo: '', linhas }];
    const m = new Map<string, LinhaFrete[]>();
    for (const l of linhas) {
      const k = agrupar === 'cliente' ? l.embarque.cliente_id : l.embarque.filial_id;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(l);
    }
    return [...m.entries()]
      .map(([k, ls]) => ({ chave: k, titulo: agrupar === 'cliente' ? nome(idx.cliente, k) : nome(idx.filial, k), linhas: ls }))
      .sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
  }, [linhas, agrupar, idx]);

  const mudarAgrupar = (a: Agrupar) => { setAgrupar(a); try { localStorage.setItem(CHAVE_AGRUPAR, a); } catch { /* preferência local */ } };

  const acoes = (
    <div className="grupo-btn esconder-celular">
      {pode('posicoes.abrir') && <button className="btn" onClick={() => setAbrir(true)}>Abrir posições</button>}
      {pode('embarques.criar') && <button className="btn primario" onClick={() => setNovo(true)}><Icone nome="mais" tam={18} />Novo embarque</button>}
    </div>
  );

  return (
    <Layout titulo="Lista de Fretes" acoes={acoes}>
      <BarraFiltros linhas={todas} extra={
        <div className="campo"><span>Agrupar por</span>
          <Segmentado rotulo="Agrupar por" valor={agrupar} aoMudar={mudarAgrupar}
            opcoes={[{ valor: 'nenhum', rotulo: 'Nenhum' }, { valor: 'cliente', rotulo: 'Cliente' }, { valor: 'filial', rotulo: 'Filial' }]} />
        </div>
      } />

      <div className="grupo-btn so-celular" style={{ marginBottom: 12 }}>
        {pode('posicoes.abrir') && <button className="btn" onClick={() => setAbrir(true)}>Abrir posições</button>}
        {pode('embarques.criar') && <button className="btn primario" onClick={() => setNovo(true)}><Icone nome="mais" tam={18} />Novo embarque</button>}
        <button className="btn" onClick={() => exportarCSV(linhas, idx, estado.data)}><Icone nome="baixar" tam={18} />CSV</button>
      </div>

      {estado.erro && <Alerta tipo="erro"><span><strong>Erro ao carregar:</strong> {estado.erro}</span></Alerta>}

      {semPosicao > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Alerta tipo={comPosicao === 0 ? 'aviso' : 'info'}>
            <span style={{ flex: 1 }}>
              {comPosicao === 0
                ? <><strong>Nenhuma posição aberta em {fmtData(estado.data)}.</strong> Os contadores não são copiados automaticamente de um dia para o outro.</>
                : <>{semPosicao} embarque(s) ativo(s) sem posição em {fmtData(estado.data)}.</>}
            </span>
            {pode('posicoes.abrir') && <button className="btn peq" onClick={() => setAbrir(true)}>Abrir posições…</button>}
          </Alerta>
        </div>
      )}

      <div className="resumo-linha" aria-live="polite">
        <span><strong>{linhas.length}</strong> embarque(s) listado(s)</span>
        <span>Porta <strong className="num">{r.porta}</strong> · {fmtT(r.porta_t)}</span>
        <span>Trânsito <strong className="num">{r.transito}</strong> · {fmtT(r.transito_t)}</span>
        <span>Carregados <strong className="num">{r.carregados}</strong> · {fmtT(r.carregado_t)}</span>
        <span>Projetado (porta + carregados) <strong>{fmtT(r.projetado_t)}</strong></span>
        <button className="btn sutil peq esconder-celular" onClick={() => exportarCSV(linhas, idx, estado.data)}><Icone nome="baixar" tam={16} />Exportar CSV</button>
      </div>

      {estado.carregando && Object.keys(estado.embarques).length === 0 ? <Carregando /> : linhas.length === 0 ? (
        <div className="cartao"><EstadoVazio titulo={todas.length === 0 ? 'Nenhum embarque cadastrado' : 'Nenhum embarque com estes filtros'}>
          <p>{todas.length === 0 ? (pode('embarques.criar') ? 'Cadastre um embarque ou importe a planilha em Administração.' : 'Ainda não há embarques no seu escopo.') : 'Ajuste ou limpe os filtros.'}</p>
        </EstadoVazio></div>
      ) : (
        <>
          <div className="cartao tabela-fretes-wrap">
            <table className="tabela-fretes">
              <thead>
                <tr><th>Origem</th><th>Destino</th><th className="n">Porta</th><th className="n">Trânsito</th><th className="n">Carregados</th><th className="td-acao"><span className="sr">Ações</span></th></tr>
              </thead>
              <tbody>
                {grupos.map((g) => (
                  <GrupoTabela key={g.chave} g={g} agrupar={agrupar} idx={idx} podeEditar={podeEditar} aoDetalhe={setDetalhe} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="cartoes-fretes">
            {grupos.map((g) => (
              <div key={g.chave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {g.titulo && <TituloGrupo titulo={g.titulo} linhas={g.linhas} idx={idx} agrupar={agrupar} />}
                {g.linhas.map((l) => <CartaoFrete key={l.embarque.id} l={l} idx={idx} podeEditar={podeEditar} aoDetalhe={setDetalhe} />)}
              </div>
            ))}
          </div>
        </>
      )}

      {detalhe && <DetalhesEmbarque embarqueId={detalhe} aoFechar={() => setDetalhe(null)} />}
      {abrir && <AbrirPosicoes aoFechar={() => setAbrir(false)} />}
      {novo && <NovoEmbarque aoFechar={(id) => { setNovo(false); if (id) setDetalhe(id); }} />}
    </Layout>
  );
}

function subtituloGrupo(linhas: LinhaFrete[], idx: Indices, agrupar: Agrupar) {
  const t = linhas.reduce((a, l) => ({ p: a.p + (l.posicao?.porta ?? 0), t: a.t + (l.posicao?.transito ?? 0), c: a.c + (l.posicao?.carregados ?? 0) }), { p: 0, t: 0, c: 0 });
  const carteira = agrupar === 'cliente' ? nome(idx.comercial, linhas[0]?.embarque.comercial_id, 'sem carteira') : null;
  return `${carteira ? `Carteira ${carteira} · ` : ''}${linhas.length} lote(s) · Porta ${t.p} · Trânsito ${t.t} · Carregados ${t.c}`;
}

function TituloGrupo({ titulo, linhas, idx, agrupar }: { titulo: string; linhas: LinhaFrete[]; idx: Indices; agrupar: Agrupar }) {
  return <div className="grupo-titulo"><span>{titulo}</span><span className="pequeno suave" style={{ fontWeight: 500 }}>{subtituloGrupo(linhas, idx, agrupar)}</span></div>;
}

function GrupoTabela({ g, agrupar, idx, podeEditar, aoDetalhe }: {
  g: { chave: string; titulo: string; linhas: LinhaFrete[] }; agrupar: Agrupar; idx: Indices; podeEditar: boolean; aoDetalhe: (id: string) => void;
}) {
  return (
    <>
      {g.titulo && (
        <tr className="grupo-cab"><td colSpan={6}>{g.titulo}<span className="totais">{subtituloGrupo(g.linhas, idx, agrupar)}</span></td></tr>
      )}
      {g.linhas.map((l) => {
        const e = l.embarque;
        return (
          <tr key={e.id} className={`${e.status_liberacao === 'suspenso' ? 'suspenso' : ''} ${l.posicao ? '' : 'sem-posicao'}`}>
            <td>
              <div className="local-cidade">{cidadeUF(e.origem_cidade, e.origem_uf)}</div>
              <div className="local-ponto">{nome(idx.local, e.local_coleta_id, 'Coleta não informada')}</div>
              {(e.status_liberacao === 'suspenso' || e.situacao === 'arquivado') && (
                <div style={{ marginTop: 3, display: 'flex', gap: 4 }}>
                  {e.status_liberacao === 'suspenso' && <BadgeStatus status="suspenso" />}
                  {e.situacao === 'arquivado' && <span className="badge arquivado">Arquivado</span>}
                </div>
              )}
            </td>
            <td>
              <div className="local-cidade">{cidadeUF(e.destino_cidade, e.destino_uf)}</div>
              <div className="local-ponto">{nome(idx.local, e.local_entrega_id, 'Entrega não informada')}</div>
            </td>
            {l.posicao ? (
              <>
                <td><Contador posicao={l.posicao} campo="porta" podeEditar={podeEditar && e.situacao === 'ativo'} /></td>
                <td><Contador posicao={l.posicao} campo="transito" podeEditar={podeEditar && e.situacao === 'ativo'} /></td>
                <td><Contador posicao={l.posicao} campo="carregados" podeEditar={podeEditar && e.situacao === 'ativo'} /></td>
              </>
            ) : (
              <td colSpan={3} className="suave pequeno" style={{ textAlign: 'center' }}>Sem posição nesta data</td>
            )}
            <td className="td-acao">
              <button className="btn peq" onClick={() => aoDetalhe(e.id)} aria-label={`Detalhes de ${codigoEmbarque(e.codigo)}`}>Detalhes</button>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function CartaoFrete({ l, idx, podeEditar, aoDetalhe }: { l: LinhaFrete; idx: Indices; podeEditar: boolean; aoDetalhe: (id: string) => void }) {
  const e = l.embarque;
  const editar = podeEditar && e.situacao === 'ativo';
  return (
    <article className="cartao cartao-frete" style={e.status_liberacao === 'suspenso' ? { borderLeft: '4px solid var(--vermelho-700)' } : undefined}>
      <div className="rota">
        <div>
          <div className="local-cidade">{cidadeUF(e.origem_cidade, e.origem_uf)}</div>
          <div className="local-ponto">{nome(idx.local, e.local_coleta_id, 'Coleta não informada')}</div>
        </div>
        <span className="seta"><Icone nome="seta" tam={18} /></span>
        <div>
          <div className="local-cidade">{cidadeUF(e.destino_cidade, e.destino_uf)}</div>
          <div className="local-ponto">{nome(idx.local, e.local_entrega_id, 'Entrega não informada')}</div>
        </div>
      </div>
      {l.posicao ? (
        <div className="contadores">
          {(['porta', 'transito', 'carregados'] as const).map((c) => (
            <div key={c} className="cont-box">
              <div className="rot">{c === 'porta' ? 'Porta' : c === 'transito' ? 'Trânsito' : 'Carregados'}</div>
              <Contador posicao={l.posicao!} campo={c} podeEditar={editar} />
            </div>
          ))}
        </div>
      ) : (
        <div className="suave pequeno">Sem posição nesta data.</div>
      )}
      <div className="rodape">
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>
          {e.status_liberacao === 'suspenso' && <BadgeStatus status="suspenso" />}
          {e.situacao === 'arquivado' && <span className="badge arquivado">Arquivado</span>}
          <span className="pequeno suave" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nome(idx.cliente, e.cliente_id)}</span>
        </span>
        <button className="btn peq" onClick={() => aoDetalhe(e.id)}>Detalhes</button>
      </div>
    </article>
  );
}

function exportarCSV(linhas: LinhaFrete[], idx: Indices, data: string) {
  // Exporta somente o que o usuário já pode ver (dados recebidos do servidor com RLS); sem valores financeiros.
  const cab = ['Código', 'Data', 'Cliente', 'Carteira', 'Filial', 'Produto', 'Origem', 'UF origem', 'Coleta', 'Destino', 'UF destino', 'Entrega',
    'Status', 'Porta', 'Trânsito', 'Carregados', 'Capacidade (t)', 'Volume porta (t)', 'Volume trânsito (t)', 'Volume carregado (t)', 'Projetado (t)', 'Atualizado em'];
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
  const corpo = linhas.map((l) => {
    const e = l.embarque;
    const p = l.posicao;
    const cap = p?.toneladas_por_veiculo ?? e.toneladas_por_veiculo;
    return [codigoEmbarque(e.codigo), p ? data : '', nome(idx.cliente, e.cliente_id), nome(idx.comercial, e.comercial_id, ''), nome(idx.filial, e.filial_id),
      nome(idx.produto, e.produto_id, ''), e.origem_cidade, e.origem_uf ?? '', nome(idx.local, e.local_coleta_id, ''), e.destino_cidade, e.destino_uf ?? '',
      nome(idx.local, e.local_entrega_id, ''), e.status_liberacao, p?.porta ?? '', p?.transito ?? '', p?.carregados ?? '', num(cap),
      p ? num((p.porta ?? 0) * cap) : '', p ? num((p.transito ?? 0) * cap) : '', p ? num((p.carregados ?? 0) * cap) : '',
      p ? num(((p.porta ?? 0) + (p.carregados ?? 0)) * cap) : '', p?.atualizado_em ?? ''].map(esc).join(';');
  });
  const blob = new Blob(['﻿' + [cab.join(';'), ...corpo].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lista-fretes-${data}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
