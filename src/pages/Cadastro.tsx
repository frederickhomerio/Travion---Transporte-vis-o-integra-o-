// Aba Cadastro: o comercial pede o cadastro de motorista e veículos; o apoio faz o cadastro à mão no ERP
// (sem integração) e confirma aqui. Formulário em cima, "Acompanhamento dos cadastros" logo abaixo.
// A demanda entra na mesma fila do Apoio Operacional, como tipo Cadastro.

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type ArquivoLocal, Historico, JanelaAnexos, LinhaInfo, SeletorArquivos, StatusDocPill, enviarArquivos, useAgora, useArquivo } from '../components/doc/Comum';
import { CancelarDoc } from '../components/doc/DocumentacaoEmbarque';
import { Layout } from '../components/Layout';
import { AcessoNegado, Alerta, Carregando, EstadoVazio, Segmentado, useAviso } from '../components/ui';
import { mensagemErro } from '../data/api';
import { useDetalheDoc, useDoc } from '../data/documentacao';
import { useApp } from '../data/store';
import { cidadeAnuncio } from '../lib/anuncio';
import { separarCidadeUF } from '../lib/cadastros';
import {
  ABERTOS, CONCLUIDOS, FORMATOS_CADASTRO, MAX_MOTORISTA, MAX_VEICULO, PLACA_RE, REF_CADASTRO, STATUS_DOC,
  fmtPlaca, fmtReais2, lerReais, normalizarPlaca, rotaDoc, telefoneValido, tempoDoc,
} from '../lib/documentacao';
import { fmtDataAsHora, fmtHora } from '../lib/formato';
import { normalizar } from '../lib/texto';
import type { SolicitacaoDoc } from '../types';

type SimNao = 'sim' | 'nao' | '';
const VAZIO = {
  placa: '', telefone: '', mercadoria: '', cliente: '', valor: '', origem: '', origemUf: '', destino: '', destinoUf: '', obs: '', filial: '',
};

export function Cadastro() {
  const { pode } = useApp();
  const { estado, sincronizar } = useDoc();
  const [params, setParams] = useSearchParams();
  const aberto = params.get('s');
  const s = aberto ? estado.solicitacoes[aberto] : undefined;
  useEffect(() => { if (aberto && estado.carregado && !s) void sincronizar(); }, [aberto, estado.carregado, s, sincronizar]);
  if (!pode('cadastro.solicitar') && !pode('cadastro.ver')) return <Layout titulo="Cadastro"><AcessoNegado /></Layout>;

  const voltar = () => setParams({});
  if (aberto) {
    return (
      <Layout titulo="Cadastro">
        {s && s.tipo === 'cadastro' ? <CadastroDetalhe s={s} aoVoltar={voltar} /> : estado.carregado ? (
          <div className="cad">
            <button className="btn sutil peq de-voltar" onClick={voltar}>← Cadastros</button>
            <Alerta tipo="aviso">Cadastro não encontrado ou fora do seu escopo.</Alerta>
          </div>
        ) : <Carregando texto="Carregando o cadastro…" />}
      </Layout>
    );
  }
  return (
    <Layout titulo="Cadastro">
      <div className="cad">
        {pode('cadastro.solicitar') && <FormCadastro aoAbrir={(id) => setParams({ s: id })} />}
        <Acompanhamento aoAbrir={(id) => setParams({ s: id })} />
      </div>
    </Layout>
  );
}

function FormCadastro({ aoAbrir }: { aoAbrir: (id: string) => void }) {
  const { api, estado: app } = useApp();
  const { estado, aplicar } = useDoc();
  const avisar = useAviso();
  const c = app.cadastros;
  const sessao = app.sessao!;
  const admin = sessao.perfil.papel === 'administrador';
  // Só as filiais do escopo do usuário (o servidor confere de novo).
  const filiais = useMemo(() => (admin ? c.filiais : c.filiais.filter((f) => sessao.filiais.includes(f.id))).filter((f) => f.ativo), [c.filiais, sessao, admin]);
  const exigeFilial = !admin && sessao.filiais.length > 0;
  const clientes = useMemo(() => c.clientes.filter((x) => x.ativo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [c.clientes]);
  const [d, setD] = useState(() => ({ ...VAZIO, filial: filiais.length === 1 ? filiais[0].id : '' }));
  const [primeiro, setPrimeiro] = useState<SimNao>('');
  const [arquivos, setArquivos] = useState<ArquivoLocal[]>([]);
  const [chave, setChave] = useState(() => crypto.randomUUID());
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentou, setTentou] = useState(false);
  const [aberto, setAberto] = useState<{ numero: number; situacao: string; id: string | null } | null>(null);
  const set = (k: keyof typeof VAZIO, v: string) => setD((x) => ({ ...x, [k]: v }));

  const pl = normalizarPlaca(d.placa);
  const valor = lerReais(d.valor);
  const mot = arquivos.filter((a) => a.categoria === 'motorista');
  const vei = arquivos.filter((a) => a.categoria === 'veiculo');
  const problemas: Record<string, string | null> = {
    placa: !PLACA_RE.test(pl) ? 'Placa com 7 caracteres: ABC1D23 (Mercosul) ou ABC1234 (antiga).' : null,
    telefone: !telefoneValido(d.telefone) ? 'Telefone com DDD, ex.: (64) 99999-1234.' : null,
    mercadoria: !d.mercadoria.trim() ? 'Informe a mercadoria.' : null,
    cliente: !d.cliente ? 'Selecione o cliente.' : null,
    valor: valor === null ? 'Informe o valor da carga.' : Number.isNaN(valor) || valor <= 0 ? 'Valor em reais maior que zero, ex.: 85.000,00.' : null,
    origem: !d.origem.trim() || !/^[A-Za-z]{2}$/.test(d.origemUf.trim()) ? 'Cidade e UF de origem.' : null,
    destino: !d.destino.trim() || !/^[A-Za-z]{2}$/.test(d.destinoUf.trim()) ? 'Cidade e UF de destino.' : null,
    filial: exigeFilial && !d.filial ? 'Selecione a filial.' : null,
    mot: !mot.length ? 'Anexe ao menos um documento do motorista.' : mot.length > MAX_MOTORISTA ? `No máximo ${MAX_MOTORISTA} arquivos.` : null,
    vei: !vei.length ? 'Anexe ao menos um documento dos veículos.' : vei.length > MAX_VEICULO ? `No máximo ${MAX_VEICULO} arquivos.` : null,
    primeiro: !primeiro ? 'Responda Sim ou Não.' : null,
  };
  const valido = Object.values(problemas).every((p) => !p);
  const msg = (k: string) => (tentou && problemas[k] ? <small className="erro-campo">{problemas[k]}</small> : null);
  // Aviso imediato quando a placa já tem cadastro em aberto que o usuário enxerga (o servidor confere todos).
  const emAberto = PLACA_RE.test(pl) ? Object.values(estado.solicitacoes).find((s) => s.tipo === 'cadastro' && s.placa === pl && ABERTOS.includes(s.status)) : undefined;

  const cidadesAtivas = c.cidades.filter((x) => x.ativo);
  const cidade = (lado: 'origem' | 'destino', rot: string) => {
    const kU = lado === 'origem' ? 'origemUf' : 'destinoUf';
    return (
      <div className="campo"><span>{rot} *</span>
        <div className="cad-cidade">
          <input className="entrada" list={`cad-cidades-${lado}`} autoComplete="off" value={d[lado]} placeholder="Cidade" aria-label={`Cidade de ${lado}`}
            onChange={(e) => {
              const v = e.target.value;
              const sug = cidadesAtivas.find((x) => x.uf && `${x.nome}/${x.uf}` === v);
              if (sug) { setD((x) => ({ ...x, [lado]: sug.nome, [kU]: sug.uf ?? '' })); return; }
              const p = separarCidadeUF(v);
              if (p.uf && /\/\s*[A-Za-z]{2}$/.test(v)) setD((x) => ({ ...x, [lado]: p.cidade, [kU]: p.uf ?? '' }));
              else set(lado, v);
            }} />
          <input className="entrada" value={d[kU]} onChange={(e) => set(kU, e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2))}
            placeholder="UF" aria-label={`UF de ${lado}`} maxLength={2} autoCapitalize="characters" />
        </div>
        {msg(lado)}
      </div>
    );
  };

  const limpar = () => {
    setD({ ...VAZIO, filial: filiais.length === 1 ? filiais[0].id : '' });
    setPrimeiro(''); setArquivos([]); setTentou(false); setErro(null); setAberto(null); setChave(crypto.randomUUID());
  };

  const enviar = async () => {
    if (enviando) return;
    setTentou(true); setErro(null); setAberto(null);
    if (!valido || emAberto) return;
    try {
      setEnviando('Enviando documentos…');
      const anexos = await enviarArquivos(arquivos, (f) => api.doc.enviarArquivo(f, true), setArquivos);
      setEnviando('Gravando o cadastro…');
      const r = await api.doc.criarCadastro({
        placa: pl, telefone_motorista: d.telefone.trim(), mercadoria: d.mercadoria.trim(), cliente_id: d.cliente, valor_carga: valor!,
        origem_cidade: d.origem.trim(), origem_uf: d.origemUf.trim().toUpperCase(), destino_cidade: d.destino.trim(), destino_uf: d.destinoUf.trim().toUpperCase(),
        observacoes: d.obs.trim() || null, primeiro_embarque: primeiro === 'sim', filial_id: d.filial || null, chave_envio: chave,
      }, anexos);
      if (r.status === 'cadastro_aberto') {
        if (r.registro) aplicar(r);
        setAberto({ numero: r.numero ?? 0, situacao: r.situacao ? STATUS_DOC[r.situacao] : 'em aberto', id: r.registro?.id ?? null });
        return;
      }
      aplicar(r);
      avisar('ok', `Cadastro nº ${r.registro.numero} da placa ${fmtPlaca(r.registro.placa)} enviado ao apoio.`);
      limpar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(null);
    }
  };

  return (
    <section className="cartao cad-form" aria-label="Solicitação de cadastro">
      <datalist id="cad-mercadorias">{c.produtos.filter((p) => p.ativo).map((p) => <option key={p.id} value={p.nome} />)}</datalist>
      {(['origem', 'destino'] as const).map((lado) => (
        <datalist key={lado} id={`cad-cidades-${lado}`}>
          {cidadesAtivas.filter((x) => !x.uso || x.uso === 'ambos' || x.uso === lado).map((x) => <option key={x.id} value={x.uf ? `${x.nome}/${x.uf}` : x.nome} />)}
        </datalist>
      ))}
      <div className="cad-grupo">
        <h2>Dados da solicitação</h2>
        <div className="cad-grade">
          <label className="campo"><span>Placa do cavalo *</span>
            <input className="entrada" value={d.placa} onChange={(e) => set('placa', e.target.value.toUpperCase())} placeholder="ABC1D23" maxLength={9} autoCapitalize="characters" />
            {msg('placa')}
          </label>
          <label className="campo"><span>Telefone do motorista *</span>
            <input className="entrada" type="tel" inputMode="tel" value={d.telefone} onChange={(e) => set('telefone', e.target.value)} placeholder="(64) 99999-1234" maxLength={40} />
            {msg('telefone')}
          </label>
          <label className="campo"><span>Mercadoria *</span>
            <input className="entrada" list="cad-mercadorias" autoComplete="off" value={d.mercadoria} onChange={(e) => set('mercadoria', e.target.value)} placeholder="Ex.: Soja em grãos" maxLength={200} />
            {msg('mercadoria')}
          </label>
          <label className="campo"><span>Cliente *</span>
            <select className="entrada" value={d.cliente} onChange={(e) => set('cliente', e.target.value)}>
              <option value="">Selecione</option>
              {clientes.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
            {!clientes.length && <small>Nenhum cliente autorizado para o seu perfil.</small>}
            {msg('cliente')}
          </label>
          <label className="campo"><span>Valor da carga (R$) *</span>
            <input className="entrada" inputMode="decimal" value={d.valor} onChange={(e) => set('valor', e.target.value)} placeholder="85.000,00"
              onBlur={() => { if (valor && !Number.isNaN(valor) && valor > 0) set('valor', valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }} />
            {msg('valor')}
          </label>
          {(filiais.length > 1 || exigeFilial) ? (
            <label className="campo"><span>Filial{exigeFilial ? ' *' : ''}</span>
              <select className="entrada" value={d.filial} onChange={(e) => set('filial', e.target.value)}>
                <option value="">{exigeFilial ? 'Selecione' : 'Sem filial (pela carteira do cliente)'}</option>
                {filiais.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
              <small>Só as filiais do seu acesso. O centro de custo vem do cadastro da filial.</small>
              {msg('filial')}
            </label>
          ) : filiais.length === 1 ? (
            <div className="campo"><span>Filial</span><div className="cad-fixo">{filiais[0].nome}</div></div>
          ) : <div />}
          {cidade('origem', 'Origem')}
          {cidade('destino', 'Destino')}
        </div>
        <fieldset className="campo sn">
          <legend>Motorista de primeiro embarque? *</legend>
          <div className="sn-opcoes">
            {(['sim', 'nao'] as const).map((v) => (
              <label key={v} className={`sn-op${primeiro === v ? ' ativo' : ''}`}>
                <input type="radio" name="cad-primeiro" checked={primeiro === v} onChange={() => setPrimeiro(v)} />{v === 'sim' ? 'Sim' : 'Não'}
              </label>
            ))}
          </div>
          {msg('primeiro')}
        </fieldset>
        <label className="campo"><span>Observações / informações gerais</span>
          <textarea className="entrada" rows={3} maxLength={2000} value={d.obs} onChange={(e) => set('obs', e.target.value)} />
        </label>
      </div>

      <div className="cad-grupo">
        <h2>Documentação</h2>
        <small className="suave">Aceitos: {FORMATOS_CADASTRO}. Até 10 MB por arquivo. PDF e imagem abrem direto para o apoio; os demais ficam para baixar.</small>
        <div className="cad-grade">
          <div>
            <SeletorArquivos rotulo="Documentos do motorista" categoria="motorista" itens={arquivos} aoMudar={setArquivos} obrigatorio cadastro max={MAX_MOTORISTA}
              desabilitado={!!enviando} ajuda={`De 1 a ${MAX_MOTORISTA} arquivos (CNH, comprovantes etc.).`} />
            {msg('mot')}
          </div>
          <div>
            <SeletorArquivos rotulo="Documentos dos veículos" categoria="veiculo" itens={arquivos} aoMudar={setArquivos} obrigatorio cadastro max={MAX_VEICULO}
              desabilitado={!!enviando} ajuda={`De 1 a ${MAX_VEICULO} arquivos (CRLV do cavalo e das carretas etc.).`} />
            {msg('vei')}
          </div>
        </div>
      </div>

      {emAberto && (
        <Alerta tipo="aviso"><span><strong>Já existe o cadastro nº {emAberto.numero} em aberto para a placa {fmtPlaca(pl)}</strong> ({STATUS_DOC[emAberto.status]}). Acompanhe ou responda por ele; nada novo será criado.{' '}
          <button className="btn peq" onClick={() => aoAbrir(emAberto.id)}>Acompanhar cadastro nº {emAberto.numero}</button></span></Alerta>
      )}
      {aberto && (
        <Alerta tipo="aviso"><span><strong>Já existe o cadastro nº {aberto.numero} em aberto para esta placa</strong> ({aberto.situacao}). Nada novo foi criado.{' '}
          {aberto.id ? <button className="btn peq" onClick={() => aoAbrir(aberto.id!)}>Acompanhar cadastro nº {aberto.numero}</button> : 'Ele foi aberto fora do seu centro de custo: fale com o apoio.'}</span></Alerta>
      )}
      {tentou && !valido && <Alerta tipo="erro">Confira os campos destacados.</Alerta>}
      {erro && <Alerta tipo="erro"><span><strong>Não enviado.</strong> {erro} Os dados e anexos continuam aqui.</span></Alerta>}
      <div className="cad-rodape">
        <small className="suave">Solicitante: {sessao.perfil.nome}. O cadastro só aparece para o apoio depois que o servidor confirmar a gravação.</small>
        <div className="grupo-btn">
          <button className="btn" onClick={limpar} disabled={!!enviando}>Limpar</button>
          <button className="btn primario" onClick={() => void enviar()} disabled={!!enviando || !!emAberto}>{enviando ?? 'Enviar cadastro ao apoio'}</button>
        </div>
      </div>
    </section>
  );
}

type FiltroAc = 'abertos' | 'concluidos' | 'todos';

function Acompanhamento({ aoAbrir }: { aoAbrir: (id: string) => void }) {
  const { pode, estado: app } = useApp();
  const { estado } = useDoc();
  const agora = useAgora(15000);
  const [filtro, setFiltro] = useState<FiltroAc>('abertos');
  const [busca, setBusca] = useState('');
  const todos = useMemo(() => Object.values(estado.solicitacoes).filter((s) => s.tipo === 'cadastro'), [estado.solicitacoes]);
  // A busca vale para a lista e para os números de cada situação.
  const buscados = useMemo(() => {
    const t = normalizar(busca);
    const tp = normalizarPlaca(busca);
    return todos.filter((s) => !t || (tp && s.placa.includes(tp)) || normalizar(s.retrato.cliente ?? '').includes(t) || String(s.numero) === busca.trim());
  }, [todos, busca]);
  const lista = useMemo(() => buscados
    .filter((s) => filtro === 'todos' || (filtro === 'abertos' ? ABERTOS.includes(s.status) : !ABERTOS.includes(s.status)))
    .sort((a, b) => b.enviado_em.localeCompare(a.enviado_em)), [buscados, filtro]);
  const n = (f: FiltroAc) => buscados.filter((s) => f === 'todos' || (f === 'abertos' ? ABERTOS.includes(s.status) : !ABERTOS.includes(s.status))).length;
  const desatualizada = estado.falhaSync || app.conexao === 'offline';

  return (
    <section className="cartao cad-ac" aria-label="Acompanhamento dos cadastros">
      <div className="cartao-cab cad-ac-cab">
        <h2>Acompanhamento dos cadastros</h2>
        <span className="pequeno suave" aria-live="polite">
          {desatualizada ? <span className="ao-sync-falha">Sem conexão: a lista pode estar desatualizada.</span>
            : estado.ultimaSync ? `Atualizado às ${fmtHora(new Date(estado.ultimaSync).toISOString())}` : 'Conectando…'}
        </span>
      </div>
      <div className="cartao-corpo cad-ac-filtros">
        <Segmentado rotulo="Situação" valor={filtro} aoMudar={setFiltro} opcoes={[
          { valor: 'abertos', rotulo: `Em aberto (${n('abertos')})` },
          { valor: 'concluidos', rotulo: `Concluídos e cancelados (${n('concluidos')})` },
          { valor: 'todos', rotulo: `Todos (${n('todos')})` },
        ]} />
        <input className="entrada" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar placa, cliente ou nº" aria-label="Buscar cadastro" />
      </div>
      {!estado.carregado && !estado.erro ? <Carregando texto="Carregando cadastros…" /> : estado.erro && !estado.carregado ? (
        <div className="cartao-corpo"><Alerta tipo="erro">{estado.erro}</Alerta></div>
      ) : !lista.length ? (
        <EstadoVazio titulo={todos.length ? 'Nenhum cadastro com este filtro' : 'Nenhum cadastro ainda'}>
          <p>{todos.length ? 'Troque o filtro ou a busca.' : pode('cadastro.solicitar') ? 'Envie o primeiro pelo formulário acima. Ele aparece aqui e na fila do apoio.' : 'Os cadastros do seu centro de custo aparecem aqui.'}</p>
        </EstadoVazio>
      ) : (
        <div className="ao-tabela-wrap">
          <table className="ao-tabela">
            <thead><tr><th>Placa</th><th>Cliente e rota</th><th>Status</th><th>Apoio</th><th>Tempo</th><th>Pendência</th><th><span className="sr">Ação</span></th></tr></thead>
            <tbody>
              {lista.map((s) => {
                const t = tempoDoc(s, agora);
                const pend = s.status === 'aguardando_informacao';
                return (
                  <tr key={s.id}>
                    <td data-rot="Placa"><span className="cad-placa">{fmtPlaca(s.placa)}</span><span className="tn-num">Cadastro nº {s.numero}</span></td>
                    <td data-rot="Cliente e rota"><span className="ao-l1">{s.retrato.cliente}</span><span className="ao-l2">{rotaDoc(s)}</span></td>
                    <td data-rot="Status"><StatusDocPill status={s.status} /></td>
                    <td data-rot="Apoio">{s.responsavel_nome ?? <span className="suave">{s.status === 'enviado' ? 'Aguardando apoio' : '—'}</span>}</td>
                    <td data-rot="Tempo"><span className="ao-l2">{t.rotulo}</span><span className="ao-l1">{t.texto}</span></td>
                    <td data-rot="Pendência">{pend ? <span className="ao-pend">Aguardando sua resposta</span> : <span className="suave">—</span>}</td>
                    <td className="ao-acao">
                      <button className={`btn peq ${pend && pode('cadastro.solicitar') ? 'primario' : ''}`} onClick={() => aoAbrir(s.id)}>
                        {pend && pode('cadastro.solicitar') ? 'Responder pendência' : 'Acompanhar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CadastroDetalhe({ s, aoVoltar }: { s: SolicitacaoDoc; aoVoltar: () => void }) {
  const { api, pode, estado: app } = useApp();
  const { aplicar, carregarDetalhe } = useDoc();
  const { detalhe, carregando } = useDetalheDoc(s.id);
  const avisar = useAviso();
  const arquivo = useArquivo();
  const agora = useAgora();
  const [ver, setVer] = useState<string | null>(null);
  const [resposta, setResposta] = useState('');
  const [arqs, setArqs] = useState<ArquivoLocal[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cancelar, setCancelar] = useState(false);
  const t = tempoDoc(s, agora);
  const anexos = detalhe?.anexos ?? [];
  const pendencia = [...(detalhe?.mensagens ?? [])].reverse().find((m) => m.tipo === 'pendencia');
  const eu = app.sessao?.perfil.id;
  const podeCancelar = ABERTOS.includes(s.status) && (pode('documentacao.cancelar') || (s.solicitante_id === eu && s.status === 'enviado'));
  const r = s.retrato;

  const responder = async () => {
    setErro(null);
    if (!resposta.trim()) { setErro('Escreva a resposta para o apoio.'); return; }
    setEnviando(true);
    try {
      const enviados = await enviarArquivos(arqs, (f) => api.doc.enviarArquivo(f, true), setArqs);
      const res = await api.doc.responder(s.id, resposta.trim(), enviados);
      aplicar(res);
      await carregarDetalhe(s.id);
      setResposta(''); setArqs([]);
      avisar('ok', 'Resposta enviada ao apoio.');
    } catch (e) { setErro(mensagemErro(e)); } finally { setEnviando(false); }
  };

  const grupo = (rot: string, cats: string[]) => {
    const as = anexos.filter((a) => cats.includes(a.categoria));
    return as.length > 0 && (
      <>
        <strong className="cad-sub">{rot} ({as.length})</strong>
        <ul className="de-arqs">
          {as.map((a) => (
            <li key={a.id}>
              <span>{a.nome} <span className="pequeno suave">· {a.enviado_por_nome}, {fmtDataAsHora(a.enviado_em)}</span></span>
              <span className="grupo-btn"><button className="btn peq" onClick={() => setVer(a.id)}>Ver</button><button className="btn peq" onClick={() => void arquivo(a, 'baixar')}>Baixar</button></span>
            </li>
          ))}
        </ul>
      </>
    );
  };

  return (
    <div className="de cad">
      <button className="btn sutil peq de-voltar" onClick={aoVoltar}>← Cadastros</button>
      <div className="cartao cartao-corpo">
        <div className="de-item-l1">
          <span className="tn"><span className="tn-tipo">Placa {fmtPlaca(s.placa)}</span><span className="tn-num">Cadastro nº {s.numero}</span></span>
          <StatusDocPill status={s.status} />
        </div>
        <p className="de-rota">{r.cliente} · {rotaDoc(s)}</p>
        <div className="de-grade pequeno">
          <LinhaInfo rot="Responsável do apoio" valor={s.responsavel_nome ?? 'Aguardando apoio'} />
          <LinhaInfo rot={t.rotulo} valor={t.texto} />
          <LinhaInfo rot="Enviado por" valor={`${s.solicitante_nome} em ${fmtDataAsHora(s.enviado_em)}`} />
          {s.status === 'cancelado' && <LinhaInfo rot="Cancelado" valor={`${s.cancelado_por_nome}: ${s.cancelado_motivo}`} />}
        </div>
      </div>

      {s.status === 'enviado' && <Alerta tipo="info">Enviado. O apoio ainda vai assumir e fazer o cadastro no ERP; enviado ainda não quer dizer cadastrado.</Alerta>}
      {s.status === 'em_atendimento' && <Alerta tipo="info">{s.responsavel_nome} está fazendo o cadastro no ERP. Você recebe um aviso quando terminar.</Alerta>}
      {s.status === 'correcao_recebida' && <Alerta tipo="info">Sua correção foi enviada. {s.responsavel_nome} vai retomar o cadastro.</Alerta>}
      {CONCLUIDOS.includes(s.status) && (
        <div className="cartao cartao-corpo cad-retorno">
          <strong>Cadastro concluído no ERP</strong>
          <span>Confirmado por {s.concluido_por_nome} em {fmtDataAsHora(s.concluido_em)} · tempo total {t.texto}.</span>
          {s.erp_referencia && <span>Referência no ERP: <strong>{s.erp_referencia}</strong></span>}
          <span>{s.retorno_solicitante ? <>Retorno do apoio: {s.retorno_solicitante}</> : <span className="suave">Sem mensagem de retorno.</span>}</span>
        </div>
      )}

      {s.status === 'aguardando_informacao' && (
        <div className="cartao cartao-corpo de-pendencia">
          <strong>O apoio precisa de uma informação</strong>
          <p>{pendencia?.texto ?? '…'}</p>
          {pendencia?.referencia && <span className="pequeno suave">Referente a: {REF_CADASTRO[pendencia.referencia] ?? pendencia.referencia}</span>}
          {pode('cadastro.solicitar') ? (
            <>
              <label className="campo"><span>Sua resposta *</span>
                <textarea className="entrada" rows={3} value={resposta} onChange={(e) => setResposta(e.target.value)} maxLength={4000} />
              </label>
              <SeletorArquivos rotulo="Anexar correção (opcional)" categoria="correcao" categorias={['correcao', 'motorista', 'veiculo']} itens={arqs} aoMudar={setArqs}
                cadastro desabilitado={enviando} ajuda={`Até ${MAX_MOTORISTA} do motorista e ${MAX_VEICULO} dos veículos nesta resposta, 10 MB cada. Os anteriores continuam guardados; o novo entra como outra versão.`} />
              {erro && <Alerta tipo="erro">{erro}</Alerta>}
              <div><button className="btn primario" disabled={enviando} onClick={() => void responder()}>{enviando ? 'Enviando…' : 'Responder ao apoio'}</button></div>
            </>
          ) : <span className="pequeno suave">Quem enviou o cadastro responde por aqui.</span>}
        </div>
      )}

      <div className="cartao cartao-corpo">
        <strong>Dados enviados</strong>
        <div className="de-grade pequeno">
          <LinhaInfo rot="Placa do cavalo" valor={fmtPlaca(s.placa)} />
          <LinhaInfo rot="Telefone do motorista" valor={s.telefone_motorista} />
          <LinhaInfo rot="Mercadoria" valor={s.mercadoria} />
          <LinhaInfo rot="Cliente" valor={r.cliente} />
          <LinhaInfo rot="Valor da carga" valor={s.valor_carga != null ? fmtReais2(s.valor_carga) : null} />
          <LinhaInfo rot="Origem" valor={cidadeAnuncio(r.origem_cidade, r.origem_uf)} />
          <LinhaInfo rot="Destino" valor={cidadeAnuncio(r.destino_cidade, r.destino_uf)} />
          <LinhaInfo rot="Primeiro embarque" valor={s.primeiro_embarque ? 'Sim' : 'Não'} />
          <LinhaInfo rot="Filial" valor={r.filial ? `${r.filial}${r.centro_custo ? ` · ${r.centro_custo}` : ''}` : 'Sem filial'} />
          {s.observacoes && <LinhaInfo rot="Observações" valor={s.observacoes} />}
        </div>
        {carregando ? <Carregando /> : <>
          {grupo('Documentos do motorista', ['motorista'])}
          {grupo('Documentos dos veículos', ['veiculo'])}
          {grupo('Correções', ['correcao'])}
        </>}
      </div>

      <div className="cartao cartao-corpo">
        <strong>Histórico</strong>
        {detalhe ? <Historico mensagens={detalhe.mensagens} anexos={anexos} /> : <Carregando />}
      </div>
      {podeCancelar && <div><button className="btn perigo peq" onClick={() => setCancelar(true)}>Cancelar cadastro</button></div>}

      {ver && <JanelaAnexos titulo={`Cadastro nº ${s.numero} · ${fmtPlaca(s.placa)}`} anexos={anexos} inicial={ver} aoFechar={() => setVer(null)} />}
      {cancelar && <CancelarDoc s={s} aoFechar={() => setCancelar(false)} />}
    </div>
  );
}

