import { Fragment, useEffect, useMemo, useState } from 'react';
import { mensagemErro } from '../data/api';
import { useApp, useIndices } from '../data/store';
import { type Indices, cidadeUF, codigoEmbarque, nome } from '../lib/cadastros';
import { metaDaPosicao, metaDoEmbarque, volumes } from '../lib/calculos';
import { fmtData, fmtDataAsHora, fmtDataHora, fmtNum, fmtReais, fmtT, ROTULO_CADENCIA, ROTULO_STATUS, ROTULO_UNIDADE_FRETE } from '../lib/formato';
import type { Embarque, Historico } from '../types';
import { AbrirPosicoes } from './AbrirPosicoes';
import { Contador } from './Contador';
import { FormVersionado, type DefCampo } from './FormVersionado';
import { Alerta, BadgeStatus, Carregando, Gaveta } from './ui';

type Aba = 'resumo' | 'posicao' | 'cadastro' | 'financeiro' | 'historico' | 'origem';

export function DetalhesEmbarque({ embarqueId, aoFechar }: { embarqueId: string; aoFechar: () => void }) {
  const { estado, pode } = useApp();
  const idx = useIndices();
  const e = estado.embarques[embarqueId];
  const posicao = useMemo(() => Object.values(estado.posicoes).find((p) => p.embarque_id === embarqueId && p.data_operacional === estado.data) ?? null,
    [estado.posicoes, embarqueId, estado.data]);
  const fin = estado.financeiro[embarqueId] ?? null;
  const [aba, setAba] = useState<Aba>('resumo');
  const [abrir, setAbrir] = useState(false);

  if (!e) return <Gaveta titulo="Embarque" aoFechar={aoFechar}><Alerta tipo="aviso">Embarque não encontrado ou fora do seu escopo.</Alerta></Gaveta>;

  const abas: Array<[Aba, string, boolean]> = [
    ['resumo', 'Resumo', true],
    ['posicao', `Posição ${fmtData(estado.data).slice(0, 5)}`, true],
    ['cadastro', 'Cadastro', true],
    ['financeiro', 'Financeiro', pode('financeiro.ver')],
    ['historico', 'Histórico', pode('historico.ver')],
    ['origem', 'Dados da planilha', pode('importacao.executar') && !!e.chave_importacao],
  ];

  return (
    <Gaveta
      titulo={<>{cidadeUF(e.origem_cidade, e.origem_uf)} → {cidadeUF(e.destino_cidade, e.destino_uf)}</>}
      subtitulo={<>{codigoEmbarque(e.codigo)} · {nome(idx.cliente, e.cliente_id)} · {nome(idx.filial, e.filial_id)} {e.is_demo && <span className="badge demo">DEMO</span>}</>}
      aoFechar={aoFechar}
    >
      {e.status_liberacao === 'suspenso' && !e.encerrado_em && (
        <Alerta tipo="erro"><span><strong>Embarque suspenso.</strong> Fora da Lista de Fretes e das Posições de Embarque; reative em Lista de Fretes → Suspensos. Sem reativação em 7 dias, é encerrado automaticamente.</span></Alerta>
      )}
      {e.encerrado_em ? (
        <Alerta tipo="aviso"><span><strong>Embarque encerrado</strong> em {fmtDataAsHora(e.encerrado_em)} por {e.encerrado_por_nome ?? 'Sistema'}{e.encerrado_motivo ? ` (${e.encerrado_motivo})` : ''}. Somente consulta, sem reativação.</span></Alerta>
      ) : e.situacao === 'arquivado' && <Alerta tipo="aviso">Embarque arquivado: somente consulta. Reative na aba Cadastro para voltar a atualizar.</Alerta>}

      <div className="abas" role="tablist">
        {abas.filter((a) => a[2]).map(([k, r]) => (
          <button key={k} role="tab" aria-selected={aba === k} className={aba === k ? 'ativa' : ''} onClick={() => setAba(k)}>{r}</button>
        ))}
      </div>

      {aba === 'resumo' && <Resumo e={e} idx={idx} />}
      {aba === 'posicao' && (posicao ? <PosicaoDia embarque={e} posicaoId={posicao.id} /> : (
        <div className="cartao cartao-corpo">
          <p>Este embarque não tem posição em {fmtData(estado.data)}.</p>
          {pode('posicoes.abrir') && e.situacao === 'ativo' && <button className="btn primario" onClick={() => setAbrir(true)}>Abrir posição</button>}
        </div>
      ))}
      {aba === 'cadastro' && <Cadastro e={e} idx={idx} />}
      {aba === 'financeiro' && <FinanceiroAba embarqueId={e.id} existe={!!fin} />}
      {aba === 'historico' && <HistoricoAba embarqueId={e.id} idx={idx} />}
      {aba === 'origem' && <OrigemAba embarqueId={e.id} />}
      {abrir && <AbrirPosicoes embarqueIds={[e.id]} aoFechar={() => setAbrir(false)} />}
    </Gaveta>
  );
}

function Resumo({ e, idx }: { e: Embarque; idx: Indices }) {
  const { estado } = useApp();
  const posicao = Object.values(estado.posicoes).find((p) => p.embarque_id === e.id && p.data_operacional === estado.data) ?? null;
  const v = posicao ? volumes(posicao) : null;
  const meta = posicao ? metaDaPosicao(posicao, estado.config) : metaDoEmbarque(e, estado.config);
  const cliente = idx.cliente.get(e.cliente_id);
  return (
    <>
      <div className="cartao cartao-corpo">
        <dl className="dl">
          <dt>Cliente</dt><dd>{cliente?.nome ?? '—'}{cliente?.restricao_comercial && <span className="badge aviso" style={{ marginLeft: 6 }}>{cliente.restricao_comercial}</span>}</dd>
          <dt>Carteira</dt><dd>{nome(idx.comercial, e.comercial_id, 'Sem carteira')}</dd>
          <dt>Filial</dt><dd>{nome(idx.filial, e.filial_id)}</dd>
          <dt>Produto</dt><dd>{nome(idx.produto, e.produto_id, 'Não informado')}</dd>
          <dt>Origem / coleta</dt><dd>{cidadeUF(e.origem_cidade, e.origem_uf)} — {nome(idx.local, e.local_coleta_id, 'não informado')}</dd>
          <dt>Destino / entrega</dt><dd>{cidadeUF(e.destino_cidade, e.destino_uf)} — {nome(idx.local, e.local_entrega_id, 'não informado')}</dd>
          <dt>Liberação</dt><dd><BadgeStatus status={e.status_liberacao} />{e.data_liberacao && <span className="suave"> desde {fmtData(e.data_liberacao)}</span>}</dd>
          <dt>Cadência</dt><dd>{e.cadencia_valor ? `${fmtNum(e.cadencia_valor, 1)} ${ROTULO_CADENCIA[e.cadencia_unidade]}` : `Sem cadência própria (usa meta padrão de ${estado.config.meta_veiculos_lote_padrao} veículos/lote)`}</dd>
          <dt>Toneladas médias por veículo</dt><dd>{fmtT(e.toneladas_por_veiculo)}</dd>
          <dt>Situação cadastral</dt><dd>{e.situacao === 'ativo' ? 'Ativo' : 'Arquivado'}</dd>
          {e.observacao_interna && <><dt>Observação interna</dt><dd>{e.observacao_interna}</dd></>}
          <dt>Última alteração do cadastro</dt><dd>{fmtDataHora(e.atualizado_em)}{e.atualizado_por_nome ? ` · ${e.atualizado_por_nome}` : ''}</dd>
        </dl>
      </div>
      <div className="cartao">
        <div className="cartao-cab"><h3>Volumes calculados em {fmtData(estado.data)}</h3><span className="pequeno suave">calculados, não editáveis</span></div>
        <div className="cartao-corpo">
          {!v ? <p className="suave">Sem posição nesta data.</p> : (
            <dl className="dl">
              <dt>Capacidade usada na data</dt><dd>{fmtT(posicao!.toneladas_por_veiculo)} por veículo</dd>
              <dt>Volume na porta</dt><dd>{v.porta} × {fmtNum(posicao!.toneladas_por_veiculo, 1)} = {fmtT(v.porta_t)}</dd>
              <dt>Volume em trânsito</dt><dd>{v.transito} × {fmtNum(posicao!.toneladas_por_veiculo, 1)} = {fmtT(v.transito_t)}</dd>
              <dt>Volume carregado</dt><dd>{v.carregados} × {fmtNum(posicao!.toneladas_por_veiculo, 1)} = {fmtT(v.carregado_t)}</dd>
              <dt>Total operacional</dt><dd>{v.total_veiculos} veículos <span className="suave pequeno">(soma das posições informadas)</span></dd>
              <dt>Volume projetado</dt><dd>{fmtT(v.projetado_t)} <span className="suave pequeno">(porta + carregado; sem trânsito)</span></dd>
              <dt>Potencial com trânsito</dt><dd>{fmtT(v.potencial_t)}</dd>
              <dt>Meta do lote</dt><dd>{meta.volume_t === null ? 'Sem meta definida' : `${fmtNum(meta.veiculos, 1)} veículos = ${fmtT(meta.volume_t)} (${meta.origem === 'cadencia' ? 'cadência do embarque' : 'meta padrão'})`}</dd>
              {v.nao_informados > 0 && <><dt>Atenção</dt><dd>{v.nao_informados} contador(es) não informado(s)</dd></>}
            </dl>
          )}
        </div>
      </div>
    </>
  );
}

function PosicaoDia({ embarque, posicaoId }: { embarque: Embarque; posicaoId: string }) {
  const { api, estado, pode, aplicarPosicao } = useApp();
  const p = estado.posicoes[posicaoId];
  const editar = embarque.situacao === 'ativo';
  return (
    <>
      <div className="cartao cartao-corpo">
        <div className="contadores" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {(['porta', 'transito', 'carregados'] as const).map((c) => (
            <div key={c} style={{ textAlign: 'center' }}>
              <div className="pequeno" style={{ fontWeight: 700, color: 'var(--cinza-600)' }}>{c === 'porta' ? 'PORTA' : c === 'transito' ? 'TRÂNSITO' : 'CARREGADOS'}</div>
              <Contador posicao={p} campo={c} podeEditar={editar && pode('posicoes.editar_contadores')} />
            </div>
          ))}
        </div>
        <p className="suave pequeno" style={{ margin: '10px 0 0' }}>
          Porta e trânsito são saldos atuais; carregados é o acumulado do dia. Os contadores são independentes: alterar um não move quantidades para outro.
        </p>
        <p className="suave pequeno" style={{ margin: '6px 0 0' }}>
          Última atualização: {fmtDataHora(p.atualizado_em)}{p.atualizado_por_nome ? ` · ${p.atualizado_por_nome}` : ''} · versão {p.versao} · origem: {p.origem}
        </p>
      </div>
      <div className="cartao">
        <div className="cartao-cab"><h3>Observações do dia</h3></div>
        <div className="cartao-corpo">
          <FormVersionado
            registro={p}
            campos={[
              { campo: 'obs_operacional', rotulo: 'Observação operacional (interna)', tipo: 'textarea', pode: editar && pode('posicoes.editar_obs_operacional'), ajuda: 'Nunca aparece para o cliente.' },
              { campo: 'obs_cliente', rotulo: 'Observação para o cliente', tipo: 'textarea', pode: editar && pode('posicoes.editar_obs_cliente'), ajuda: 'Aparece na posição enviada ao cliente e no link de consulta.' },
            ]}
            salvar={(alt, base, forcar) => api.atualizarPosicao(p.id, alt, base, forcar)}
            aoSalvo={aplicarPosicao}
            rotuloSalvar="Salvar observações"
          />
        </div>
      </div>
    </>
  );
}

function Cadastro({ e, idx }: { e: Embarque; idx: Indices }) {
  const { api, estado, pode: podeApp, aplicarEmbarque, recarregar } = useApp();
  // Encerrado não se altera nem se reativa (o banco também recusa).
  const pode: typeof podeApp = (k) => !e.encerrado_em && podeApp(k);
  const c = estado.cadastros;
  const campos: DefCampo[] = [
    { campo: 'status_liberacao', rotulo: 'Status de liberação', tipo: 'select', pode: pode('embarques.liberar'),
      opcoes: Object.entries(ROTULO_STATUS).map(([valor, rotulo]) => ({ valor, rotulo })) },
    { campo: 'data_liberacao', rotulo: 'Data de liberação', tipo: 'data', pode: pode('embarques.liberar') },
    { campo: 'cadencia_valor', rotulo: 'Cadência (meta)', tipo: 'numero', pode: pode('embarques.editar_cadencia'), ajuda: 'Vazio = usa a meta padrão de veículos por lote.' },
    { campo: 'cadencia_unidade', rotulo: 'Unidade da cadência', tipo: 'select', pode: pode('embarques.editar_cadencia'),
      opcoes: [{ valor: 'veiculos_dia', rotulo: 'Veículos por dia' }, { valor: 'toneladas_dia', rotulo: 'Toneladas por dia' }] },
    { campo: 'toneladas_por_veiculo', rotulo: 'Toneladas médias por veículo', tipo: 'numero', pode: pode('embarques.editar_capacidade'),
      ajuda: 'Vale para hoje em diante. Posições de datas anteriores mantêm a capacidade usada na época.' },
    { campo: 'comercial_id', rotulo: 'Carteira (comercial)', tipo: 'select', pode: pode('carteira.editar'), vazio: 'Sem carteira',
      opcoes: c.comerciais.map((x) => ({ valor: x.id, rotulo: x.nome })), ajuda: 'Alteração restrita e registrada no histórico.' },
    { campo: 'filial_id', rotulo: 'Filial (centro de custo)', tipo: 'select', pode: pode('embarques.editar_cadastro'), opcoes: c.filiais.map((x) => ({ valor: x.id, rotulo: x.nome })) },
    { campo: 'cliente_id', rotulo: 'Cliente', tipo: 'select', pode: pode('embarques.editar_cadastro'), opcoes: c.clientes.map((x) => ({ valor: x.id, rotulo: x.nome })) },
    { campo: 'produto_id', rotulo: 'Produto', tipo: 'select', pode: pode('embarques.editar_cadastro'), vazio: 'Não informado', opcoes: c.produtos.map((x) => ({ valor: x.id, rotulo: x.nome })) },
    { campo: 'origem_cidade', rotulo: 'Cidade de origem', tipo: 'texto', pode: pode('embarques.editar_cadastro') },
    { campo: 'origem_uf', rotulo: 'UF de origem', tipo: 'uf', pode: pode('embarques.editar_cadastro') },
    { campo: 'local_coleta_id', rotulo: 'Carregamento (local de coleta)', tipo: 'select', pode: pode('embarques.editar_cadastro'), vazio: 'Não informado',
      opcoes: c.locais.filter((l) => l.tipo !== 'entrega').map((l) => ({ valor: l.id, rotulo: `${l.nome}${l.cidade ? ` (${l.cidade})` : ''}` })) },
    { campo: 'destino_cidade', rotulo: 'Cidade de destino', tipo: 'texto', pode: pode('embarques.editar_cadastro') },
    { campo: 'destino_uf', rotulo: 'UF de destino', tipo: 'uf', pode: pode('embarques.editar_cadastro') },
    { campo: 'local_entrega_id', rotulo: 'Descarga (local de entrega)', tipo: 'select', pode: pode('embarques.editar_cadastro'), vazio: 'Não informado',
      opcoes: c.locais.filter((l) => l.tipo !== 'coleta').map((l) => ({ valor: l.id, rotulo: `${l.nome}${l.cidade ? ` (${l.cidade})` : ''}` })) },
    { campo: 'observacao_interna', rotulo: 'Observação interna', tipo: 'textarea', pode: pode('embarques.editar_cadastro') },
    { campo: 'situacao', rotulo: 'Situação cadastral', tipo: 'select', pode: pode('embarques.arquivar'),
      opcoes: [{ valor: 'ativo', rotulo: 'Ativo' }, { valor: 'arquivado', rotulo: 'Arquivado' }], ajuda: 'Arquivar é diferente de suspender: arquivado sai da operação.' },
  ];
  const cli = idx.cliente.get(e.cliente_id);
  const sugestao = cli && cli.comercial_id !== e.comercial_id ? nome(idx.comercial, cli.comercial_id, 'sem carteira') : null;
  const exibir = (campo: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return 'vazio';
    const m: Record<string, Map<string, { nome: string }>> = { comercial_id: idx.comercial, filial_id: idx.filial, cliente_id: idx.cliente, produto_id: idx.produto, local_coleta_id: idx.local, local_entrega_id: idx.local };
    if (m[campo]) return m[campo].get(String(v))?.nome ?? String(v);
    if (campo === 'status_liberacao') return ROTULO_STATUS[String(v)];
    return String(v);
  };
  return (
    <div className="cartao cartao-corpo">
      {sugestao && <Alerta tipo="info">A carteira cadastrada para este cliente é <strong>{sugestao}</strong>, diferente da carteira deste embarque.</Alerta>}
      <FormVersionado
        registro={e}
        campos={campos}
        exibirConflitoComo={exibir}
        salvar={async (alt, base, forcar) => {
          const r = await api.atualizarEmbarque(e.id, alt, base, forcar);
          if (r.status === 'ok' && r.posicoes_atualizadas) void recarregar();
          return r;
        }}
        aoSalvo={aplicarEmbarque}
      />
    </div>
  );
}

function FinanceiroAba({ embarqueId, existe }: { embarqueId: string; existe: boolean }) {
  const { api, estado, pode, aplicarFinanceiro } = useApp();
  const f = estado.financeiro[embarqueId];
  if (!existe || !f) return <Alerta tipo="info">Sem dados financeiros para este embarque.</Alerta>;
  const editar = pode('financeiro.editar');
  return (
    <div className="cartao cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {f.unidade_frete !== 'rs_tonelada' && (
        <Alerta tipo="aviso">Unidade do frete: <strong>{ROTULO_UNIDADE_FRETE[f.unidade_frete]}</strong>. As projeções financeiras multiplicam o frete por toneladas e só são válidas com frete em R$/t confirmado.</Alerta>
      )}
      <FormVersionado
        registro={f}
        campos={[
          { campo: 'frete_empresa', rotulo: 'Frete empresa', tipo: 'numero', pode: editar },
          { campo: 'frete_motorista', rotulo: 'Frete motorista', tipo: 'numero', pode: editar, ajuda: 'Valor informado; nenhum desconto automático é aplicado.' },
          { campo: 'unidade_frete', rotulo: 'Unidade do frete', tipo: 'select', pode: editar, opcoes: Object.entries(ROTULO_UNIDADE_FRETE).map(([valor, rotulo]) => ({ valor, rotulo })) },
        ]}
        salvar={(alt, base, forcar) => api.atualizarFinanceiro(embarqueId, alt, base, forcar)}
        aoSalvo={aplicarFinanceiro}
      />
      <dl className="dl pequeno">
        <dt>Frete empresa</dt><dd>{fmtReais(f.frete_empresa)}</dd>
        <dt>Frete motorista</dt><dd>{fmtReais(f.frete_motorista)}</dd>
        {f.frete_empresa_original && <><dt>Valor original (planilha)</dt><dd className="mono">{f.frete_empresa_original}</dd></>}
        {f.frete_motorista_original && <><dt>Motorista original (planilha)</dt><dd className="mono">{f.frete_motorista_original}</dd></>}
      </dl>
    </div>
  );
}

const ROTULO_CAMPO_HIST: Record<string, string> = {
  porta: 'Porta', transito: 'Trânsito', carregados: 'Carregados', obs_operacional: 'Observação operacional', obs_cliente: 'Observação para o cliente',
  abertura: 'Abertura da posição', importacao: 'Importação', criacao: 'Criação', status_liberacao: 'Status de liberação', data_liberacao: 'Data de liberação',
  cadencia_valor: 'Cadência', cadencia_unidade: 'Unidade da cadência', toneladas_por_veiculo: 'Toneladas por veículo', comercial_id: 'Carteira',
  filial_id: 'Filial', cliente_id: 'Cliente', produto_id: 'Produto', local_coleta_id: 'Local de coleta', local_entrega_id: 'Local de entrega',
  origem_cidade: 'Cidade de origem', origem_uf: 'UF de origem', destino_cidade: 'Cidade de destino', destino_uf: 'UF de destino',
  observacao_interna: 'Observação interna', situacao: 'Situação', frete_empresa: 'Frete empresa', frete_motorista: 'Frete motorista',
  unidade_frete: 'Unidade do frete', meta_valor: 'Meta da posição',
};

function HistoricoAba({ embarqueId, idx }: { embarqueId: string; idx: Indices }) {
  const { api, estado } = useApp();
  const [lista, setLista] = useState<Historico[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const versao = estado.embarques[embarqueId]?.versao;
  const posVersoes = Object.values(estado.posicoes).filter((p) => p.embarque_id === embarqueId).map((p) => p.versao).join(',');
  useEffect(() => {
    api.carregarHistorico(embarqueId).then(setLista).catch((e) => setErro(mensagemErro(e)));
  }, [api, embarqueId, versao, posVersoes]);
  if (erro) return <Alerta tipo="erro">{erro}</Alerta>;
  if (!lista) return <Carregando />;
  if (!lista.length) return <p className="suave">Sem alterações registradas.</p>;
  const val = (campo: string, v: string | null) => {
    if (v === null || v === '') return '—';
    const m: Record<string, Map<string, { nome: string }>> = { comercial_id: idx.comercial, filial_id: idx.filial, cliente_id: idx.cliente, produto_id: idx.produto, local_coleta_id: idx.local, local_entrega_id: idx.local };
    if (m[campo]) return m[campo].get(v)?.nome ?? v;
    if (campo === 'status_liberacao') return ROTULO_STATUS[v] ?? v;
    return v;
  };
  return (
    <div className="cartao rolagem-x">
      <table className="tabela">
        <thead><tr><th>Quando</th><th>Campo</th><th>Antes</th><th>Depois</th><th>Usuário</th></tr></thead>
        <tbody>
          {lista.map((h) => (
            <tr key={h.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtDataHora(h.alterado_em)}{h.data_operacional && <div className="suave pequeno">posição {fmtData(h.data_operacional)}</div>}</td>
              <td>{ROTULO_CAMPO_HIST[h.campo] ?? h.campo}{h.origem !== 'app' && <div className="suave pequeno">{h.origem}</div>}</td>
              <td>{val(h.campo, h.valor_anterior)}</td>
              <td><strong>{val(h.campo, h.valor_novo)}</strong></td>
              <td>{h.usuario_nome ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrigemAba({ embarqueId }: { embarqueId: string }) {
  const { api } = useApp();
  const [dados, setDados] = useState<Record<string, unknown> | null | undefined>(undefined);
  useEffect(() => { api.dadosOrigem(embarqueId).then(setDados).catch(() => setDados(null)); }, [api, embarqueId]);
  if (dados === undefined) return <Carregando />;
  if (!dados || !Object.keys(dados).length) return <p className="suave">Nenhum campo adicional guardado da planilha.</p>;
  return (
    <div className="cartao cartao-corpo">
      <p className="suave pequeno" style={{ marginTop: 0 }}>Campos da planilha de origem ainda sem uso definido. Área restrita, apenas para referência.</p>
      <dl className="dl">{Object.entries(dados).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="mono">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></Fragment>)}</dl>
    </div>
  );
}
