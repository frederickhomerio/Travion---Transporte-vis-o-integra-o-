// Aba Estadia: o comercial envia a solicitação de estadia (Envio de Estadia) e acompanha o resultado
// (Consultar Estadia). O apoio atende na fila do Apoio Operacional, no atendimento Mesa ampla.
// Sem integração com ERP ou cliente: cálculo, retorno, pagamento e encerramento são registrados por pessoas autorizadas.

import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate, useSearchParams } from 'react-router-dom';
import { type ArquivoLocal, Historico, JanelaAnexos, LinhaInfo, SeletorArquivos, StatusDocPill, enviarArquivos, useArquivo } from '../components/doc/Comum';
import { CancelarDoc } from '../components/doc/DocumentacaoEmbarque';
import { Layout } from '../components/Layout';
import { AcessoNegado, Alerta, Carregando, EstadoVazio, Segmentado, useAviso } from '../components/ui';
import { mensagemErro } from '../data/api';
import { useDetalheDoc, useDoc } from '../data/documentacao';
import { useApp } from '../data/store';
import { ABERTOS, CATEGORIA, FORMATOS_CADASTRO, PLACA_RE, STATUS_DOC, fmtPlaca, fmtTamanho, normalizarPlaca } from '../lib/documentacao';
import {
  FINAIS_ESTADIA, LIMITES_ESTADIA, MODALIDADE_ESTADIA, MOTIVOS_ESTADIA, MOTIVO_ESTADIA, NUMERO_DOC_RE, REF_ESTADIA, RESULTADO_ESTADIA, TIPO_DOC_CURTO, TIPO_DOC_ESTADIA,
  calcularEstadia, documentosEstadia, fmtHoras, fmtReais, fmtTarifa, fmtToneladas, lerDecimal, lerNumeros, localParaIso, periodoEstadia, pesoToneladas,
} from '../lib/estadia';
import { fmtDataAsHora, fmtDataHora, fmtHora, hojeSP } from '../lib/formato';
import type { CategoriaAnexo, DuplicadaEstadia, ModalidadeEstadia, MotivoEstadia, SolicitacaoDoc, TipoDocEstadia } from '../types';

export function Estadia({ aba }: { aba: 'envio' | 'consultar' }) {
  const { pode } = useApp();
  const { estado, sincronizar } = useDoc();
  const [params, setParams] = useSearchParams();
  const aberto = aba === 'consultar' ? params.get('s') : null;
  const s = aberto ? estado.solicitacoes[aberto] : undefined;
  useEffect(() => { if (aberto && estado.carregado && !s) void sincronizar(); }, [aberto, estado.carregado, s, sincronizar]);
  if (!pode('estadia.solicitar') && !pode('estadia.ver')) return <Layout titulo="Estadia"><AcessoNegado motivo="Seu usuário não tem acesso à aba Estadia (Administração → Permissões)." /></Layout>;
  return (
    <Layout titulo="Estadia">
      <nav className="abas-analise" aria-label="Estadia">
        <NavLink to="/estadia" end>Envio de Estadia</NavLink>
        <NavLink to="/estadia/consultar">Consultar Estadia</NavLink>
      </nav>
      <div className="cad est">
        {aba === 'envio' ? (pode('estadia.solicitar') ? <FormEstadia /> : (
          <Alerta tipo="info">Seu perfil consulta estadias, mas não envia. Use Consultar Estadia.</Alerta>
        )) : aberto ? (
          s && s.tipo === 'estadia' ? <EstadiaDetalhe s={s} aoVoltar={() => setParams({})} /> : estado.carregado ? (
            <>
              <button className="btn sutil peq de-voltar" onClick={() => setParams({})}>← Consultar Estadia</button>
              <Alerta tipo="aviso">Estadia não encontrada ou fora do seu escopo.</Alerta>
            </>
          ) : <Carregando texto="Carregando a estadia…" />
        ) : <ConsultarEstadia aoAbrir={(id) => setParams({ s: id })} />}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Envio de Estadia
// ---------------------------------------------------------------------------
const CHAVE_RASCUNHO = 'travion-rascunho-estadia';
const VAZIO = {
  tipoDoc: '' as TipoDocEstadia | '', docs: [] as string[], placa: '', cliente: '', nfs: [] as string[], sindicato: '' as 'sim' | 'nao' | '', sindicatoNome: '',
  inicio: '', saida: '', tarifa: '', peso: '', unidade: '' as 't' | 'kg' | '', motivo: '' as MotivoEstadia | '', motivoOutro: '', modalidade: '' as ModalidadeEstadia | '',
  acordoValor: '', acordoQuem: '', acordoData: '', acordoDescricao: '', obs: '', filial: '',
};
type Rascunho = typeof VAZIO;

/** Números individualizados (CT-e, NFS, NF): Enter, vírgula, espaço ou colar vários de uma vez. */
function CampoNumeros({ rotulo, valor, aoMudar, ajuda, placeholder, max, erro }: {
  rotulo: string; valor: string[]; aoMudar: (v: string[]) => void; ajuda?: string; placeholder: string; max: number; erro?: React.ReactNode;
}) {
  const [texto, setTexto] = useState('');
  const somar = (t: string) => {
    const novos = lerNumeros(t);
    if (!novos.length) return;
    aoMudar([...new Set([...valor, ...novos])].slice(0, max));
    setTexto('');
  };
  return (
    <div className="campo">
      <span>{rotulo} *</span>
      <div className="est-nums">
        {valor.map((n) => (
          <span key={n} className={`est-num${NUMERO_DOC_RE.test(n) ? '' : ' invalido'}`}>{n}
            <button type="button" aria-label={`Remover ${n}`} onClick={() => aoMudar(valor.filter((x) => x !== n))}>×</button>
          </span>
        ))}
        <input className="est-nums-ent" value={texto} placeholder={valor.length ? 'Outro número' : placeholder} aria-label={rotulo}
          onChange={(e) => { const v = e.target.value; if (/[\s,;]$/.test(v)) somar(v); else setTexto(v); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); somar(texto); } if (e.key === 'Backspace' && !texto && valor.length) aoMudar(valor.slice(0, -1)); }}
          onBlur={() => somar(texto)}
          onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/[\s,;]/.test(t.trim())) { e.preventDefault(); somar(`${texto} ${t}`); } }} />
      </div>
      {ajuda && <small>{ajuda}</small>}
      {erro}
    </div>
  );
}

function SimNao({ nome, rotulo, valor, aoMudar, erro }: { nome: string; rotulo: string; valor: string; aoMudar: (v: 'sim' | 'nao') => void; erro?: React.ReactNode }) {
  return (
    <fieldset className="campo sn">
      <legend>{rotulo} *</legend>
      <div className="sn-opcoes">
        {(['sim', 'nao'] as const).map((v) => (
          <label key={v} className={`sn-op${valor === v ? ' ativo' : ''}`}>
            <input type="radio" name={nome} checked={valor === v} onChange={() => aoMudar(v)} />{v === 'sim' ? 'Sim' : 'Não'}
          </label>
        ))}
      </div>
      {erro}
    </fieldset>
  );
}

function FormEstadia() {
  const { api, estado: app } = useApp();
  const { aplicar } = useDoc();
  const avisar = useAviso();
  const nav = useNavigate();
  const c = app.cadastros;
  const sessao = app.sessao!;
  const admin = sessao.perfil.papel === 'administrador';
  // Só as filiais do escopo do usuário (o servidor confere de novo); nunca deduzidas da cidade.
  const filiais = useMemo(() => (admin ? c.filiais : c.filiais.filter((f) => sessao.filiais.includes(f.id))).filter((f) => f.ativo), [c.filiais, sessao, admin]);
  const exigeFilial = !admin && sessao.filiais.length > 0;
  const clientes = useMemo(() => c.clientes.filter((x) => x.ativo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [c.clientes]);
  const inicial = (): Rascunho => ({ ...VAZIO, filial: filiais.length === 1 ? filiais[0].id : '' });
  // Rascunho preservado na sessão (falha de rede, troca de aba); arquivos ficam na memória da tela.
  const [d, setD] = useState<Rascunho>(() => { try { const t = sessionStorage.getItem(CHAVE_RASCUNHO); if (t) return { ...inicial(), ...(JSON.parse(t) as Partial<Rascunho>) }; } catch { /* novo */ } return inicial(); });
  useEffect(() => { try { sessionStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(d)); } catch { /* só em memória */ } }, [d]);
  const [arquivos, setArquivos] = useState<ArquivoLocal[]>([]);
  const [chave, setChave] = useState(() => crypto.randomUUID());
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentou, setTentou] = useState(false);
  const [dups, setDups] = useState<DuplicadaEstadia[] | null>(null);
  const [enviada, setEnviada] = useState<SolicitacaoDoc | null>(null);
  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setD((x) => ({ ...x, [k]: v }));

  const pl = normalizarPlaca(d.placa);
  const inicioIso = localParaIso(d.inicio);
  const saidaIso = localParaIso(d.saida);
  const tarifa = lerDecimal(d.tarifa);
  const peso = lerDecimal(d.peso);
  const pesoT = peso && !Number.isNaN(peso) && d.unidade ? pesoToneladas(peso, d.unidade) : null;
  const acordo = d.modalidade === 'acordo';
  const acordoValor = lerDecimal(d.acordoValor);
  const permanencia = inicioIso && saidaIso ? (Date.parse(saidaIso) - Date.parse(inicioIso)) / 3600e3 : null;
  const conta = (cat: CategoriaAnexo) => arquivos.filter((a) => a.categoria === cat).length;
  const max = LIMITES_ESTADIA.max;
  const problemas: Record<string, string | null> = {
    tipoDoc: !d.tipoDoc ? 'Escolha CT-e ou Nota Fiscal de Serviço.' : null,
    docs: !d.docs.length ? 'Informe ao menos um número.' : d.docs.some((n) => !NUMERO_DOC_RE.test(n)) ? 'Use só letras, números, ponto, barra ou hífen.' : null,
    placa: !PLACA_RE.test(pl) ? 'Placa com 7 caracteres: ABC1D23 (Mercosul) ou ABC1234 (antiga).' : null,
    cliente: !d.cliente ? 'Selecione o cliente.' : null,
    nfs: !d.nfs.length ? 'Informe ao menos uma NF da carga.' : d.nfs.some((n) => !NUMERO_DOC_RE.test(n)) ? 'Use só letras, números, ponto, barra ou hífen.' : null,
    sindicato: !d.sindicato ? 'Responda Sim ou Não.' : d.sindicato === 'sim' && !d.sindicatoNome.trim() ? 'Informe qual sindicato.' : null,
    inicio: !inicioIso ? 'Informe data e horário de início.' : null,
    saida: !saidaIso ? 'Informe data e horário de saída.' : permanencia !== null && permanencia <= 0 ? 'A saída precisa ser depois do início.'
      : Date.parse(saidaIso) > Date.now() + 15 * 60e3 ? 'A saída não pode estar no futuro.' : permanencia !== null && permanencia > 60 * 24 ? 'Permanência acima de 60 dias: confira as datas.' : null,
    tarifa: tarifa === null ? 'Informe a tarifa em R$/t/h.' : Number.isNaN(tarifa) || tarifa <= 0 ? 'Tarifa maior que zero, ex.: 0,45.' : null,
    peso: !d.unidade ? 'Escolha a unidade (t ou kg).' : peso === null ? 'Informe o peso do veículo.' : Number.isNaN(peso) || peso <= 0 ? 'Peso maior que zero.'
      : pesoT !== null && pesoT > 100 ? 'Acima de 100 t: confira o valor e a unidade.' : null,
    motivo: !d.motivo ? 'Escolha o motivo.' : d.motivo === 'outro' && !d.motivoOutro.trim() ? 'Descreva o motivo.' : null,
    modalidade: !d.modalidade ? 'Escolha o tipo de estadia.' : null,
    acordoValor: acordo && (acordoValor === null || Number.isNaN(acordoValor) || acordoValor <= 0) ? 'Valor acordado em reais, maior que zero.' : null,
    acordoQuem: acordo && !d.acordoQuem.trim() ? 'Informe quem confirmou.' : null,
    acordoData: acordo && !d.acordoData ? 'Informe a data da confirmação.' : acordo && d.acordoData > hojeSP() ? 'A data não pode estar no futuro.' : null,
    acordoDescricao: acordo && !d.acordoDescricao.trim() ? 'Descreva a tratativa.' : null,
    filial: exigeFilial && !d.filial ? 'Selecione a filial.' : null,
    est_documento: !conta('est_documento') ? 'Anexe o CT-e ou a NFS.' : null,
    est_nf_carga: !conta('est_nf_carga') ? 'Anexe a nota fiscal da carga.' : null,
    est_comprovante: !conta('est_comprovante') ? 'Anexe os comprovantes de início e fim.' : null,
    est_tratativa: acordo && !conta('est_tratativa') ? 'No acordo, anexe a evidência da tratativa.' : null,
  };
  const valido = Object.values(problemas).every((p) => !p);
  const msg = (k: string) => (tentou && problemas[k] ? <small className="erro-campo">{problemas[k]}</small> : null);
  const calcRef = acordo || d.modalidade === 'padrao';

  const limpar = () => {
    setD(inicial()); setArquivos([]); setTentou(false); setErro(null); setDups(null); setChave(crypto.randomUUID());
    try { sessionStorage.removeItem(CHAVE_RASCUNHO); } catch { /* nada */ }
  };

  const enviar = async (confirmar = false) => {
    if (enviando) return;
    setTentou(true); setErro(null); setEnviada(null);
    if (!valido) return;
    try {
      setEnviando('Enviando documentos…');
      const anexos = await enviarArquivos(arquivos, (f) => api.doc.enviarArquivo(f, true), setArquivos);
      setEnviando('Gravando a estadia…');
      const r = await api.doc.criarEstadia({
        tipo_documento: d.tipoDoc as TipoDocEstadia, documentos: d.docs, placa: pl, cliente_id: d.cliente, nfs_carga: d.nfs,
        sindicato: d.sindicato === 'sim', sindicato_nome: d.sindicato === 'sim' ? d.sindicatoNome.trim() : null, inicio: inicioIso, saida: saidaIso,
        tarifa: tarifa!, peso: peso!, peso_unidade: d.unidade as 't' | 'kg', motivo: d.motivo as MotivoEstadia, motivo_outro: d.motivo === 'outro' ? d.motivoOutro.trim() : null,
        modalidade: d.modalidade as ModalidadeEstadia, acordo_valor: acordo ? acordoValor : null, acordo_confirmado_por: acordo ? d.acordoQuem.trim() : null,
        acordo_data: acordo ? d.acordoData : null, acordo_descricao: acordo ? d.acordoDescricao.trim() : null, observacoes: d.obs.trim() || null,
        filial_id: d.filial || null, chave_envio: chave, confirmar_duplicidade: confirmar,
      }, anexos);
      if (r.status === 'possivel_duplicidade') { setDups(r.duplicadas ?? []); return; }
      aplicar(r);
      setEnviada(r.registro);
      avisar('ok', `Estadia ${r.registro.est_codigo} enviada ao apoio.`);
      limpar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(null);
    }
  };

  const arq = (cat: CategoriaAnexo, rotulo: string, obrigatorio: boolean, ajuda: string) => (
    <div>
      <SeletorArquivos rotulo={rotulo} categoria={cat} itens={arquivos} aoMudar={setArquivos} obrigatorio={obrigatorio} cadastro max={max[cat]}
        desabilitado={!!enviando} ajuda={`${ajuda} Até ${max[cat]} arquivo(s).`} />
      {msg(cat)}
    </div>
  );

  return (
    <section className="cartao cad-form" aria-label="Envio de Estadia">
      {enviada && (
        <Alerta tipo="ok"><span><strong>Estadia {enviada.est_codigo} enviada ao apoio</strong> (placa {fmtPlaca(enviada.placa)}). Situação: Enviado, aguardando o apoio assumir.{' '}
          <button className="btn peq" onClick={() => nav(`/estadia/consultar?s=${enviada.id}`)}>Acompanhar {enviada.est_codigo}</button></span></Alerta>
      )}
      <div className="cad-grupo">
        <h2>Identificação</h2>
        <div className="cad-grade">
          <fieldset className="campo sn">
            <legend>Tipo de documento *</legend>
            <div className="sn-opcoes">
              {(['cte', 'nfs'] as const).map((v) => (
                <label key={v} className={`sn-op${d.tipoDoc === v ? ' ativo' : ''}`}>
                  <input type="radio" name="est-tipo-doc" checked={d.tipoDoc === v} onChange={() => set('tipoDoc', v)} />{TIPO_DOC_ESTADIA[v]}
                </label>
              ))}
            </div>
            {msg('tipoDoc')}
          </fieldset>
          <CampoNumeros rotulo={`Número(s) do ${d.tipoDoc ? TIPO_DOC_CURTO[d.tipoDoc] : 'documento'}`} valor={d.docs} aoMudar={(v) => set('docs', v)} max={20}
            placeholder="Ex.: 000184512" ajuda="Um número por vez (Enter ou vírgula). Zeros à esquerda são mantidos." erro={msg('docs')} />
          <label className="campo"><span>Placa do veículo *</span>
            <input className="entrada" value={d.placa} onChange={(e) => set('placa', e.target.value.toUpperCase())} placeholder="ABC1D23" maxLength={9} autoCapitalize="characters" />
            {msg('placa')}
          </label>
          <label className="campo"><span>Cliente *</span>
            <select className="entrada" value={d.cliente} onChange={(e) => set('cliente', e.target.value)}>
              <option value="">Selecione</option>
              {clientes.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
            {!clientes.length && <small>Nenhum cliente autorizado para o seu perfil.</small>}
            {msg('cliente')}
          </label>
          <CampoNumeros rotulo="Número(s) da nota fiscal da carga" valor={d.nfs} aoMudar={(v) => set('nfs', v)} max={50}
            placeholder="Ex.: 0045871" ajuda="Separado do CT-e/NFS." erro={msg('nfs')} />
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
          <SimNao nome="est-sindicato" rotulo="Possui sindicato?" valor={d.sindicato} aoMudar={(v) => set('sindicato', v)} erro={!d.sindicato ? msg('sindicato') : null} />
          {d.sindicato === 'sim' && (
            <label className="campo"><span>Qual sindicato? *</span>
              <input className="entrada" value={d.sindicatoNome} onChange={(e) => set('sindicatoNome', e.target.value)} maxLength={120} />
              {msg('sindicato')}
            </label>
          )}
        </div>
      </div>

      <div className="cad-grupo">
        <h2>Período, tarifa e condição</h2>
        <div className="cad-grade">
          <label className="campo"><span>Início da estadia *</span>
            <input className="entrada" type="datetime-local" value={d.inicio} onChange={(e) => set('inicio', e.target.value)} />
            <small>Horário de Brasília.</small>
            {msg('inicio')}
          </label>
          <label className="campo"><span>Saída *</span>
            <input className="entrada" type="datetime-local" value={d.saida} onChange={(e) => set('saida', e.target.value)} />
            <small>Horário de Brasília.</small>
            {msg('saida')}
          </label>
          <div className="campo"><span>Tempo total de permanência</span>
            <div className="cad-fixo est-perm">{permanencia !== null && permanencia > 0 ? fmtHoras(permanencia) : '—'}</div>
            <small>Calculado pelas datas. Horas decimais: 15h28 = 15,47 h.</small>
          </div>
          <label className="campo"><span>Tarifa da estadia (R$/t/h) *</span>
            <input className="entrada" inputMode="decimal" value={d.tarifa} onChange={(e) => set('tarifa', e.target.value)} placeholder="0,45" />
            <small>Por tonelada por hora. Não é o frete da viagem.</small>
            {msg('tarifa')}
          </label>
          <div className="campo"><span>Peso do veículo *</span>
            <div className="est-peso">
              <input className="entrada" inputMode="decimal" value={d.peso} onChange={(e) => set('peso', e.target.value)} placeholder={d.unidade === 'kg' ? '37.600' : '37,6'} aria-label="Peso do veículo" />
              <select className="entrada" value={d.unidade} onChange={(e) => set('unidade', e.target.value as 't' | 'kg')} aria-label="Unidade do peso">
                <option value="">Unidade</option><option value="t">toneladas (t)</option><option value="kg">quilos (kg)</option>
              </select>
            </div>
            {d.unidade === 'kg' && pesoT !== null && pesoT > 0 && <small>= {fmtToneladas(pesoT)}</small>}
            {d.unidade === 't' && <small>Peso real do veículo, com casas decimais.</small>}
            {msg('peso')}
          </div>
          <label className="campo"><span>Motivo da estadia *</span>
            <select className="entrada" value={d.motivo} onChange={(e) => set('motivo', e.target.value as MotivoEstadia)}>
              <option value="">Selecione</option>
              {MOTIVOS_ESTADIA.map((m) => <option key={m} value={m}>{MOTIVO_ESTADIA[m]}</option>)}
            </select>
            {d.motivo !== 'outro' && msg('motivo')}
          </label>
          {d.motivo === 'outro' && (
            <label className="campo"><span>Qual o motivo? *</span>
              <input className="entrada" value={d.motivoOutro} onChange={(e) => set('motivoOutro', e.target.value)} maxLength={200} />
              {msg('motivo')}
            </label>
          )}
        </div>
        <fieldset className="campo sn">
          <legend>Tipo de estadia *</legend>
          <div className="sn-opcoes">
            {(['padrao', 'acordo'] as const).map((v) => (
              <label key={v} className={`sn-op${d.modalidade === v ? ' ativo' : ''}`}>
                <input type="radio" name="est-modalidade" checked={d.modalidade === v} onChange={() => set('modalidade', v)} />{MODALIDADE_ESTADIA[v]}
              </label>
            ))}
          </div>
          {msg('modalidade')}
        </fieldset>
        {acordo && (
          <div className="est-acordo">
            <small className="suave">O acordo fica registrado como referência negociada. O apoio continua conferindo o cálculo tarifa × toneladas × horas válidas.</small>
            <div className="cad-grade">
              <label className="campo"><span>Valor acordado (R$) *</span>
                <input className="entrada" inputMode="decimal" value={d.acordoValor} onChange={(e) => set('acordoValor', e.target.value)} placeholder="480,00" />
                {msg('acordoValor')}
              </label>
              <label className="campo"><span>Quem confirmou o acordo *</span>
                <input className="entrada" value={d.acordoQuem} onChange={(e) => set('acordoQuem', e.target.value)} maxLength={120} placeholder="Nome e área (cliente ou mesa)" />
                {msg('acordoQuem')}
              </label>
              <label className="campo"><span>Data da confirmação *</span>
                <input className="entrada" type="date" value={d.acordoData} max={hojeSP()} onChange={(e) => set('acordoData', e.target.value)} />
                {msg('acordoData')}
              </label>
            </div>
            <label className="campo"><span>Descrição da tratativa *</span>
              <textarea className="entrada" rows={2} maxLength={2000} value={d.acordoDescricao} onChange={(e) => set('acordoDescricao', e.target.value)} />
              {msg('acordoDescricao')}
            </label>
          </div>
        )}
        <label className="campo"><span>Observações</span>
          <textarea className="entrada" rows={3} maxLength={2000} value={d.obs} onChange={(e) => set('obs', e.target.value)} />
        </label>
        {calcRef && tarifa && pesoT && permanencia !== null && permanencia > 0 && !Number.isNaN(tarifa) && (
          <small className="suave">Para o apoio conferir: {fmtTarifa(tarifa)} × {fmtToneladas(pesoT)} × horas válidas. Limite e horas a retroagir seguem as diretrizes do cliente, informados pelo apoio.</small>
        )}
      </div>

      <div className="cad-grupo">
        <h2>Anexos</h2>
        <small className="suave">Aceitos: {FORMATOS_CADASTRO}. Até {LIMITES_ESTADIA.limite_mb} MB por arquivo. PDF e imagem abrem direto para o apoio; os demais ficam para baixar.</small>
        <div className="cad-grade est-anexos">
          {arq('est_documento', 'CT-e ou Nota Fiscal de Serviço', true, 'O documento da viagem.')}
          {arq('est_nf_carga', 'Nota fiscal da carga', true, 'DANFE da carga.')}
          {arq('est_comprovante', 'Comprovantes de início e fim da estadia', true, 'Pode ser mais de um arquivo (entrada e saída separados).')}
          {arq('est_agendamento', 'Agendamento, se houver', false, 'Opcional.')}
          {arq('est_tratativa', 'Tratativa / evidência com cliente ou mesa', acordo, acordo ? 'Obrigatório no acordo.' : 'Opcional no cálculo padrão.')}
        </div>
      </div>

      {dups && (
        <Alerta tipo="aviso">
          <span><strong>Possível duplicidade. Nada foi gravado ainda.</strong> Confira antes de enviar:
            <ul className="est-dups">
              {dups.map((x) => (
                <li key={x.codigo}>
                  {x.codigo} · placa {fmtPlaca(x.placa)} · {fmtDataHora(x.inicio)} → {fmtDataHora(x.saida)} · {STATUS_DOC[x.status]}
                  {' '}({x.motivo === 'periodo' ? 'mesma placa com período sobreposto' : 'mesmo documento do mesmo cliente'})
                  {x.id ? <> <button className="btn peq" onClick={() => nav(`/estadia/consultar?s=${x.id}`)}>Abrir {x.codigo}</button></> : ' · aberta fora do seu centro de custo'}
                </li>
              ))}
            </ul>
            Se for outra viagem ou outra estadia, envie mesmo assim.{' '}
            <button className="btn peq primario" disabled={!!enviando} onClick={() => void enviar(true)}>Enviar mesmo assim</button>
          </span>
        </Alerta>
      )}
      {tentou && !valido && <Alerta tipo="erro">Confira os campos destacados.</Alerta>}
      {erro && <Alerta tipo="erro"><span><strong>Não enviado.</strong> {erro} Os dados e anexos continuam aqui.</span></Alerta>}
      <div className="cad-rodape">
        <small className="suave">Solicitante: {sessao.perfil.nome}. A estadia só aparece para o apoio depois que o servidor confirmar a gravação dos dados e documentos.</small>
        <div className="grupo-btn">
          <button className="btn" onClick={limpar} disabled={!!enviando}>Limpar</button>
          <button className="btn primario" onClick={() => void enviar(false)} disabled={!!enviando}>{enviando ?? 'Enviar estadia ao apoio'}</button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Consultar Estadia
// ---------------------------------------------------------------------------
type Campo = 'placa' | 'cte';
const CHAVE_BUSCA = 'travion-consulta-estadia';

function ConsultarEstadia({ aoAbrir }: { aoAbrir: (id: string) => void }) {
  const { api, estado: app } = useApp();
  const { estado, store } = useDoc();
  const lido = (() => { try { return JSON.parse(sessionStorage.getItem(CHAVE_BUSCA) ?? 'null') as { campo: Campo; valor: string; ids: string[] } | null; } catch { return null; } })();
  const [campo, setCampo] = useState<Campo>(lido?.campo ?? 'placa');
  const [valor, setValor] = useState(lido?.valor ?? '');
  const [ids, setIds] = useState<string[] | null>(lido?.ids ?? null);
  const [buscado, setBuscado] = useState<{ campo: Campo; valor: string } | null>(lido ? { campo: lido.campo, valor: lido.valor } : null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const buscar = async () => {
    setErro(null);
    const v = campo === 'placa' ? normalizarPlaca(valor) : valor.trim().toUpperCase();
    if (!v) { setErro(campo === 'placa' ? 'Informe a placa do veículo.' : 'Informe o número do CT-e.'); entrada.current?.focus(); return; }
    if (campo === 'placa' && !PLACA_RE.test(v)) { setErro('Placa com 7 caracteres: ABC1D23 ou ABC1234.'); return; }
    setBuscando(true);
    try {
      const r = await api.doc.buscarEstadias(campo, v);
      store.mesclar(r, []);
      const novos = r.map((s) => s.id);
      setIds(novos); setBuscado({ campo, valor: v });
      try { sessionStorage.setItem(CHAVE_BUSCA, JSON.stringify({ campo, valor: v, ids: novos })); } catch { /* só nesta tela */ }
    } catch (e) { setErro(mensagemErro(e)); } finally { setBuscando(false); }
  };

  const resultado = useMemo(() => (ids ?? []).map((id) => estado.solicitacoes[id]).filter((s): s is SolicitacaoDoc => !!s), [ids, estado.solicitacoes]);
  const recentes = useMemo(() => Object.values(estado.solicitacoes).filter((s) => s.tipo === 'estadia')
    .sort((a, b) => b.enviado_em.localeCompare(a.enviado_em)).slice(0, 15), [estado.solicitacoes]);
  const desatualizada = estado.falhaSync || app.conexao === 'offline';

  return (
    <>
      <section className="cartao cartao-corpo est-busca" aria-label="Consultar Estadia">
        <div className="est-busca-linha">
          <div className="campo"><span>Buscar por</span>
            <Segmentado rotulo="Buscar por" valor={campo} aoMudar={(v) => { setCampo(v); setErro(null); }} opcoes={[
              { valor: 'placa', rotulo: 'Placa do veículo' }, { valor: 'cte', rotulo: 'Número do CT-e' },
            ]} />
          </div>
          <label className="campo est-busca-valor"><span>{campo === 'placa' ? 'Placa do veículo *' : 'Número do CT-e *'}</span>
            <input ref={entrada} className="entrada" value={valor} onChange={(e) => setValor(campo === 'placa' ? e.target.value.toUpperCase() : e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }} placeholder={campo === 'placa' ? 'ABC1D23' : '000184512'} maxLength={campo === 'placa' ? 9 : 60} />
          </label>
          <button className="btn primario" disabled={buscando} onClick={() => void buscar()}>{buscando ? 'Buscando…' : 'Buscar'}</button>
        </div>
        <small className="suave">Só uma identificação. Estadias com Nota Fiscal de Serviço aparecem na busca por placa. Você vê só as estadias do seu acesso.</small>
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
      </section>

      {buscado && (
        <ListaEstadias titulo={`Resultado: ${buscado.campo === 'placa' ? `placa ${fmtPlaca(buscado.valor)}` : `CT-e ${buscado.valor}`}`} lista={resultado} aoAbrir={aoAbrir}
          vazio={<p>Nenhuma estadia encontrada com {buscado.campo === 'placa' ? 'esta placa' : 'este número de CT-e'} no seu acesso.</p>} />
      )}
      <ListaEstadias titulo="Estadias recentes" lista={recentes} aoAbrir={aoAbrir}
        sub={desatualizada ? <span className="ao-sync-falha">Sem conexão: a lista pode estar desatualizada.</span>
          : estado.ultimaSync ? `Atualizado às ${fmtHora(new Date(estado.ultimaSync).toISOString())}` : 'Conectando…'}
        vazio={!estado.carregado ? <Carregando /> : <p>As estadias que você enviou, e as do seu centro de custo, aparecem aqui.</p>} />
    </>
  );
}

function ListaEstadias({ titulo, sub, lista, aoAbrir, vazio }: { titulo: string; sub?: React.ReactNode; lista: SolicitacaoDoc[]; aoAbrir: (id: string) => void; vazio: React.ReactNode }) {
  const { pode } = useApp();
  return (
    <section className="cartao cad-ac" aria-label={titulo}>
      <div className="cartao-cab cad-ac-cab"><h2>{titulo}</h2>{sub && <span className="pequeno suave" aria-live="polite">{sub}</span>}</div>
      {!lista.length ? <EstadoVazio titulo="Nada por aqui">{vazio}</EstadoVazio> : (
        <div className="ao-tabela-wrap">
          <table className="ao-tabela">
            <thead><tr><th>Solicitação e placa</th><th>Documento</th><th>Cliente</th><th>Período</th><th>Situação</th><th>Resultado do cliente</th><th><span className="sr">Ação</span></th></tr></thead>
            <tbody>
              {lista.map((s) => {
                const pend = s.status === 'aguardando_informacao';
                return (
                  <tr key={s.id}>
                    <td data-rot="Solicitação e placa"><span className="tn"><span className="tn-tipo">{s.est_codigo}</span><span className="tn-num">Placa {fmtPlaca(s.placa)}</span></span></td>
                    <td data-rot="Documento"><span className="ao-l1">{s.est_tipo_documento ? TIPO_DOC_CURTO[s.est_tipo_documento] : '—'}</span><span className="ao-l2">{(s.est_documentos ?? []).join(', ')}</span></td>
                    <td data-rot="Cliente">{s.retrato.cliente}</td>
                    <td data-rot="Período"><span className="ao-l2">{periodoEstadia(s)}</span></td>
                    <td data-rot="Situação"><StatusDocPill status={s.status} />{pend && <span className="ao-pend">Aguardando sua resposta</span>}</td>
                    <td data-rot="Resultado do cliente">{s.est_resultado ? <ResultadoPill r={s.est_resultado} /> : <span className="suave">Sem retorno registrado</span>}</td>
                    <td className="ao-acao"><button className={`btn peq ${pend && pode('estadia.solicitar') ? 'primario' : ''}`} onClick={() => aoAbrir(s.id)}>{pend && pode('estadia.solicitar') ? 'Responder' : 'Abrir'}</button></td>
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

export function ResultadoPill({ r }: { r: keyof typeof RESULTADO_ESTADIA }) {
  return <span className={`est-res est-res-${r}`}>{RESULTADO_ESTADIA[r]}</span>;
}

// ---------------------------------------------------------------------------
// Detalhe consultado
// ---------------------------------------------------------------------------
function EstadiaDetalhe({ s, aoVoltar }: { s: SolicitacaoDoc; aoVoltar: () => void }) {
  const { api, pode, estado: app } = useApp();
  const { aplicar, carregarDetalhe } = useDoc();
  const { detalhe, carregando } = useDetalheDoc(s.id);
  const avisar = useAviso();
  const arquivo = useArquivo();
  const nav = useNavigate();
  const [ver, setVer] = useState<string | null>(null);
  const [resposta, setResposta] = useState('');
  const [arqs, setArqs] = useState<ArquivoLocal[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [cancelar, setCancelar] = useState(false);
  const anexos = detalhe?.anexos ?? [];
  const pendencia = [...(detalhe?.mensagens ?? [])].reverse().find((m) => m.tipo === 'pendencia');
  const eu = app.sessao?.perfil.id;
  const podeCancelar = ABERTOS.includes(s.status) && (pode('documentacao.cancelar') || (s.solicitante_id === eu && s.status === 'enviado'));
  const r = s.retrato;
  const perm = s.est_inicio && s.est_saida ? calcularEstadia({ inicio: s.est_inicio, saida: s.est_saida, tarifa: 1, peso_t: 1, limite_h: 0, retroagir_h: 0 }) : null;
  const pagamentos = detalhe?.estadia?.pagamentos ?? [];
  const retornos = detalhe?.estadia?.retornos ?? [];
  const ultimoRetorno = retornos[retornos.length - 1];

  const responder = async () => {
    setErro(null);
    if (!resposta.trim()) { setErro('Escreva a resposta para o apoio.'); return; }
    setEnviando(true);
    try {
      const enviados = await enviarArquivos(arqs, (f) => api.doc.enviarArquivo(f, true), setArqs);
      aplicar(await api.doc.responder(s.id, resposta.trim(), enviados));
      await carregarDetalhe(s.id);
      setResposta(''); setArqs([]);
      avisar('ok', 'Resposta enviada ao apoio.');
    } catch (e) { setErro(mensagemErro(e)); } finally { setEnviando(false); }
  };

  const grupos: Array<[string, CategoriaAnexo[]]> = [
    ['CT-e / NFS', ['est_documento']], ['Nota fiscal da carga', ['est_nf_carga']], ['Comprovantes de início e fim', ['est_comprovante']],
    ['Agendamento', ['est_agendamento']], ['Tratativa com cliente ou mesa', ['est_tratativa']], ['Correções', ['correcao']],
    ['Evidências do retorno do cliente', ['est_retorno']], ['Comprovantes de pagamento', ['est_pagamento']],
  ];

  return (
    <div className="de cad est-det">
      <button className="btn sutil peq de-voltar" onClick={aoVoltar}>← Consultar Estadia</button>
      <div className="cartao cartao-corpo">
        <div className="de-item-l1">
          <span className="tn"><span className="tn-tipo">{s.est_codigo} · {fmtPlaca(s.placa)}</span><span className="tn-num">{documentosEstadia(s)}</span></span>
          <StatusDocPill status={s.status} />
        </div>
        <p className="de-rota">{r.cliente} · {periodoEstadia(s)}</p>
        <div className="est-valores">
          <div><span>Valor calculado (conferido)</span><strong>{s.est_valor_calculado != null ? fmtReais(s.est_valor_calculado) : 'Aguardando conferência'}</strong>
            {s.est_conferencia_versao && <small>Conferência v{s.est_conferencia_versao} · {s.est_conferido_por_nome}, {fmtDataAsHora(s.est_conferido_em)}</small>}</div>
          <div><span>Resultado do cliente</span><strong>{s.est_resultado ? <ResultadoPill r={s.est_resultado} /> : 'Sem retorno registrado'}</strong>
            {ultimoRetorno && <small>{ultimoRetorno.justificativa}</small>}</div>
          <div><span>Valor aprovado pelo cliente</span><strong>{s.est_valor_aprovado != null ? fmtReais(s.est_valor_aprovado) : '—'}</strong></div>
          <div><span>Pago com receita pendente</span><strong>{s.est_valor_pago != null ? fmtReais(s.est_valor_pago) : '—'}</strong>
            {s.est_pago_em && <small>Pagamento informado em {s.est_pago_em.split('-').reverse().join('/')}. O app não registra recebimento de receita.</small>}</div>
        </div>
        <div className="de-grade pequeno">
          <LinhaInfo rot="Responsável do apoio" valor={s.responsavel_nome ?? 'Aguardando apoio'} />
          <LinhaInfo rot="Última atualização" valor={fmtDataAsHora(s.atualizado_em)} />
          <LinhaInfo rot="Enviado por" valor={`${s.solicitante_nome} em ${fmtDataAsHora(s.enviado_em)}`} />
          {s.status === 'encerrado' && <LinhaInfo rot="Encerramento" valor={s.est_encerrado_motivo} />}
          {s.status === 'cancelado' && <LinhaInfo rot="Cancelado" valor={`${s.cancelado_por_nome}: ${s.cancelado_motivo}`} />}
        </div>
      </div>

      {s.status === 'enviado' && <Alerta tipo="info">Enviado. O apoio ainda vai assumir e conferir o cálculo; enviado não quer dizer aprovado.</Alerta>}
      {s.status === 'em_atendimento' && <Alerta tipo="info">{s.responsavel_nome} está conferindo a estadia. Você recebe um aviso a cada retorno.</Alerta>}
      {s.status === 'aguardando_cliente' && <Alerta tipo="info">O apoio encaminhou ao cliente (fora do app) e aguarda o retorno. Nada foi aprovado ainda.</Alerta>}
      {s.status === 'pago_pendencia' && <Alerta tipo="aviso">Pago em pendência: o pagamento foi informado e a receita continua pendente até o retorno do cliente.</Alerta>}
      {s.status === 'correcao_recebida' && <Alerta tipo="info">Sua correção foi enviada. {s.responsavel_nome} vai retomar o atendimento.</Alerta>}

      {s.status === 'aguardando_informacao' && (
        <div className="cartao cartao-corpo de-pendencia">
          <strong>O apoio precisa de uma informação</strong>
          <p>{pendencia?.texto ?? '…'}</p>
          {pendencia?.referencia && <span className="pequeno suave">Referente a: {REF_ESTADIA[pendencia.referencia] ?? CATEGORIA[pendencia.referencia as CategoriaAnexo] ?? pendencia.referencia}</span>}
          {pode('estadia.solicitar') ? (
            <>
              <label className="campo"><span>Sua resposta *</span>
                <textarea className="entrada" rows={3} value={resposta} onChange={(e) => setResposta(e.target.value)} maxLength={4000} />
              </label>
              <SeletorArquivos rotulo="Anexar correção (opcional)" categoria="correcao" itens={arqs} aoMudar={setArqs} cadastro max={LIMITES_ESTADIA.max.correcao}
                categorias={['correcao', 'est_documento', 'est_nf_carga', 'est_comprovante', 'est_agendamento', 'est_tratativa']} desabilitado={enviando}
                ajuda={`Até ${LIMITES_ESTADIA.limite_mb} MB cada. Os anteriores continuam guardados; o novo entra como outra versão.`} />
              {erro && <Alerta tipo="erro">{erro}</Alerta>}
              <div><button className="btn primario" disabled={enviando} onClick={() => void responder()}>{enviando ? 'Enviando…' : 'Responder ao apoio'}</button></div>
            </>
          ) : <span className="pequeno suave">Quem enviou a estadia responde por aqui.</span>}
        </div>
      )}

      <div className="cartao cartao-corpo">
        <strong>Dados enviados</strong>
        <div className="de-grade pequeno">
          <LinhaInfo rot="Tipo de documento" valor={s.est_tipo_documento ? TIPO_DOC_ESTADIA[s.est_tipo_documento] : null} />
          <LinhaInfo rot="Número(s)" valor={(s.est_documentos ?? []).join(', ')} />
          <LinhaInfo rot="NF da carga" valor={(s.est_nfs_carga ?? []).join(', ')} />
          <LinhaInfo rot="Cliente" valor={r.cliente} />
          <LinhaInfo rot="Início" valor={fmtDataHora(s.est_inicio)} />
          <LinhaInfo rot="Saída" valor={fmtDataHora(s.est_saida)} />
          <LinhaInfo rot="Permanência" valor={perm ? fmtHoras(perm.permanencia_h) : null} />
          <LinhaInfo rot="Tarifa" valor={s.est_tarifa != null ? fmtTarifa(s.est_tarifa) : null} />
          <LinhaInfo rot="Peso" valor={s.est_peso_t != null ? `${fmtToneladas(s.est_peso_t)}${s.est_peso_unidade === 'kg' ? ` (informado ${s.est_peso_informado?.toLocaleString('pt-BR')} kg)` : ''}` : null} />
          <LinhaInfo rot="Motivo" valor={s.est_motivo ? `${MOTIVO_ESTADIA[s.est_motivo]}${s.est_motivo_outro ? `: ${s.est_motivo_outro}` : ''}` : null} />
          <LinhaInfo rot="Tipo de estadia" valor={s.est_modalidade ? MODALIDADE_ESTADIA[s.est_modalidade] : null} />
          {s.est_modalidade === 'acordo' && <LinhaInfo rot="Acordo" valor={`${fmtReais(s.est_acordo_valor ?? 0)} · ${s.est_acordo_confirmado_por} em ${s.est_acordo_data?.split('-').reverse().join('/')} · ${s.est_acordo_descricao}`} />}
          <LinhaInfo rot="Sindicato" valor={s.est_sindicato ? s.est_sindicato_nome : 'Não'} />
          <LinhaInfo rot="Filial" valor={r.filial ? `${r.filial}${r.centro_custo ? ` · ${r.centro_custo}` : ''}` : 'Sem filial'} />
          {s.observacoes && <LinhaInfo rot="Observações" valor={s.observacoes} />}
        </div>
        {carregando ? <Carregando /> : grupos.map(([rot, cats]) => {
          const as = anexos.filter((a) => cats.includes(a.categoria));
          return as.length > 0 && (
            <div key={rot}>
              <strong className="cad-sub">{rot} ({as.length})</strong>
              <ul className="de-arqs">
                {as.map((a) => (
                  <li key={a.id}>
                    <span>{a.nome} <span className="pequeno suave">· {fmtTamanho(a.tamanho)} · {a.enviado_por_nome}, {fmtDataAsHora(a.enviado_em)}</span></span>
                    <span className="grupo-btn"><button className="btn peq" onClick={() => setVer(a.id)}>Ver</button><button className="btn peq" onClick={() => void arquivo(a, 'baixar')}>Baixar</button></span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {pagamentos.length > 0 && <p className="pequeno">Pagamentos informados: {pagamentos.map((p) => `${fmtReais(p.valor_pago)} em ${p.data_pagamento.split('-').reverse().join('/')}`).join(' · ')}</p>}
      </div>

      <div className="cartao cartao-corpo">
        <strong>Histórico</strong>
        {detalhe ? <Historico mensagens={detalhe.mensagens} anexos={anexos} /> : <Carregando />}
      </div>
      <div className="grupo-btn">
        {pode('apoio.pagina') && <button className="btn peq" onClick={() => nav(`/apoio/${s.id}`)}>Abrir no atendimento do apoio</button>}
        {podeCancelar && <button className="btn perigo peq" onClick={() => setCancelar(true)}>Cancelar estadia</button>}
      </div>
      {FINAIS_ESTADIA.includes(s.status) && pode('estadia.reabrir') && <Reabrir s={s} />}

      {ver && <JanelaAnexos titulo={`Estadia ${s.est_codigo} · ${fmtPlaca(s.placa)}`} anexos={anexos} inicial={ver} aoFechar={() => setVer(null)} />}
      {cancelar && <CancelarDoc s={s} aoFechar={() => setCancelar(false)} />}
    </div>
  );
}

/** Reabertura autorizada (permissão própria), com motivo no histórico. */
export function Reabrir({ s }: { s: SolicitacaoDoc }) {
  const { api } = useApp();
  const { aplicar, carregarDetalhe } = useDoc();
  const avisar = useAviso();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  if (!aberto) return <div><button className="btn peq" onClick={() => setAberto(true)}>Reabrir estadia</button></div>;
  return (
    <div className="cartao cartao-corpo at-bloco">
      <strong>Reabrir estadia {s.est_codigo}</strong>
      <span className="pequeno suave">Volta para {s.responsavel_nome ?? 'a fila do apoio'}. O motivo fica no histórico; retornos, pagamentos e cálculos anteriores continuam registrados.</span>
      <label className="campo"><span>Motivo *</span><textarea className="entrada" rows={2} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></label>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      <div className="grupo-btn">
        <button className="btn" onClick={() => setAberto(false)} disabled={gravando}>Voltar</button>
        <button className="btn primario" disabled={gravando} onClick={async () => {
          setErro(null);
          if (!motivo.trim()) { setErro('Informe o motivo da reabertura.'); return; }
          setGravando(true);
          try { aplicar(await api.doc.reabrirEstadia(s.id, motivo.trim())); await carregarDetalhe(s.id).catch(() => undefined); avisar('ok', 'Estadia reaberta.'); setAberto(false); setMotivo(''); }
          catch (e) { setErro(mensagemErro(e)); } finally { setGravando(false); }
        }}>{gravando ? 'Reabrindo…' : 'Confirmar reabertura'}</button>
      </div>
    </div>
  );
}
