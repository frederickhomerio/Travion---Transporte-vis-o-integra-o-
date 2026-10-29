import { useMemo, useState } from 'react';
import { mensagemErro } from '../data/api';
import { useApp, useIndices } from '../data/store';
import { nome, separarCidadeUF } from '../lib/cadastros';
import { normalizar } from '../lib/texto';
import { fmtData } from '../lib/formato';
import { parseNumeroBR } from '../lib/texto';
import { Alerta, Modal, useAviso } from './ui';

export function NovoEmbarque({ aoFechar }: { aoFechar: (id?: string) => void }) {
  const { api, estado, pode, aplicarEmbarque, recarregar } = useApp();
  const idx = useIndices();
  const avisar = useAviso();
  const c = estado.cadastros;
  const s = estado.sessao!;
  const filiais = useMemo(() => (s.perfil.papel === 'administrador' ? c.filiais : c.filiais.filter((f) => s.filiais.includes(f.id))).filter((f) => f.ativo), [c.filiais, s]);
  const [d, setD] = useState({
    cliente_id: '', comercial_id: '', filial_id: filiais.length === 1 ? filiais[0].id : '', produto_id: '',
    origem_cidade: '', origem_uf: '', local_coleta: '', destino_cidade: '', destino_uf: '', local_entrega: '',
    status_liberacao: pode('embarques.liberar') ? 'liberado' : 'nao_informado', data_liberacao: '', cadencia_valor: '', cadencia_unidade: estado.config.cadencia_unidade_padrao,
    toneladas_por_veiculo: String(estado.config.capacidade_padrao_t), observacao_interna: '',
    frete_empresa: '', frete_motorista: '', unidade_frete: 'rs_tonelada', abrir: pode('posicoes.abrir'), lote_erp: '',
  });
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const set = (k: keyof typeof d, v: string | boolean) => setD((x) => ({ ...x, [k]: v }));

  const carteiraSugerida = d.cliente_id ? idx.cliente.get(d.cliente_id)?.comercial_id ?? '' : '';
  const cliente = idx.cliente.get(d.cliente_id);

  async function salvar() {
    setErro(null);
    if (!d.cliente_id || !d.filial_id || !d.origem_cidade.trim() || !d.destino_cidade.trim()) {
      setErro('Preencha cliente, filial, cidade de origem e cidade de destino.');
      return;
    }
    const cap = parseNumeroBR(d.toneladas_por_veiculo);
    const cad = parseNumeroBR(d.cadencia_valor);
    if (!cap || cap <= 0) { setErro('Toneladas médias por veículo deve ser maior que zero.'); return; }
    if (!cad || cad <= 0) { setErro(`Informe a meta diária em ${d.cadencia_unidade === 'toneladas_dia' ? 'toneladas' : 'veículos'} por dia (número maior que zero).`); return; }
    if (d.lote_erp.trim().length > 60) { setErro('O número do lote do ERP tem no máximo 60 caracteres.'); return; }
    const dados: Record<string, unknown> = {
      cliente_id: d.cliente_id, filial_id: d.filial_id, origem_cidade: d.origem_cidade.trim(), destino_cidade: d.destino_cidade.trim(),
      status_liberacao: d.status_liberacao, cadencia_unidade: d.cadencia_unidade,
    };
    if (d.produto_id) dados.produto_id = d.produto_id;
    if (d.origem_uf) dados.origem_uf = d.origem_uf.trim().toUpperCase();
    if (d.destino_uf) dados.destino_uf = d.destino_uf.trim().toUpperCase();
    if (d.data_liberacao) dados.data_liberacao = d.data_liberacao;
    dados.cadencia_valor = cad;
    if (d.lote_erp.trim()) dados.lote_erp = d.lote_erp.trim();
    if (cap !== estado.config.capacidade_padrao_t) dados.toneladas_por_veiculo = cap;
    if (d.observacao_interna.trim()) dados.observacao_interna = d.observacao_interna.trim();
    if (pode('carteira.editar') && d.comercial_id !== carteiraSugerida) dados.comercial_id = d.comercial_id || null;
    if (pode('financeiro.editar')) {
      const fe = parseNumeroBR(d.frete_empresa);
      const fm = parseNumeroBR(d.frete_motorista);
      if (fe === undefined || fm === undefined) { setErro('Fretes devem ser números (ex.: 67,50).'); return; }
      const fin: Record<string, unknown> = {};
      if (fe !== null) fin.frete_empresa = fe;
      if (fm !== null) fin.frete_motorista = fm;
      if (fe !== null || fm !== null || d.unidade_frete !== 'rs_tonelada') fin.unidade_frete = d.unidade_frete;
      if (Object.keys(fin).length) dados.financeiro = fin;
    }
    if (d.abrir) dados.abrir_posicao_em = estado.data;
    if ((d.origem_uf && !/^[A-Za-z]{2}$/.test(d.origem_uf)) || (d.destino_uf && !/^[A-Za-z]{2}$/.test(d.destino_uf))) { setErro('UF deve ter 2 letras.'); return; }
    setEnviando(true);
    try {
      // Cidades e locais digitados ficam gravados para aparecerem como sugestão nas próximas vezes.
      const ufO = d.origem_uf.trim().toUpperCase() || null;
      const ufD = d.destino_uf.trim().toUpperCase() || null;
      const [, , coleta, entrega] = await Promise.all([
        api.obterCidade(d.origem_cidade.trim(), ufO, estado.demo),
        api.obterCidade(d.destino_cidade.trim(), ufD, estado.demo),
        d.local_coleta.trim() ? api.obterLocal(d.local_coleta.trim(), d.origem_cidade.trim(), ufO, 'coleta', estado.demo) : null,
        d.local_entrega.trim() ? api.obterLocal(d.local_entrega.trim(), d.destino_cidade.trim(), ufD, 'entrega', estado.demo) : null,
      ]);
      if (coleta) dados.local_coleta_id = coleta;
      if (entrega) dados.local_entrega_id = entrega;
      const e = await api.criarEmbarque(dados, estado.demo);
      aplicarEmbarque(e);
      await recarregar();
      avisar('ok', 'Embarque cadastrado. Anúncio pronto para divulgar.');
      aoFechar(e.id);
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setEnviando(false);
    }
  }

  const sel = (k: keyof typeof d, rot: string, ops: Array<{ id: string; nome: string }>, vazio?: string, desab = false, ajuda?: string) => (
    <label className="campo"><span>{rot}</span>
      <select className="entrada" value={String(d[k])} disabled={desab} onChange={(e) => set(k, e.target.value)}>
        {vazio !== undefined && <option value="">{vazio}</option>}
        {ops.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
      </select>
      {ajuda && <small>{ajuda}</small>}
    </label>
  );
  const txt = (k: keyof typeof d, rot: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, ajuda?: string) => (
    <label className="campo"><span>{rot}</span>
      <input className="entrada" value={String(d[k])} onChange={(e) => set(k, e.target.value)} {...props} />
      {ajuda && <small>{ajuda}</small>}
    </label>
  );

  const cidadesAtivas = c.cidades.filter((x) => x.ativo);
  // Sugestões separadas: cidades cadastradas como origem, como destino ou para os dois usos.
  const cidadesDo = (lado: 'origem' | 'destino') => cidadesAtivas.filter((x) => !x.uso || x.uso === 'ambos' || x.uso === lado);
  // Campo de cidade com sugestões do cadastro; escolher "Rio Verde/GO" preenche a UF.
  const cidade = (lado: 'origem' | 'destino', rot: string) => {
    const kC = `${lado}_cidade` as const;
    const kU = `${lado}_uf` as const;
    return (
      <label className="campo"><span>{rot}</span>
        <input className="entrada" list={`lista-cidades-${lado}`} autoComplete="off" value={d[kC]} placeholder="Digite e escolha"
          onChange={(e) => {
            const v = e.target.value;
            const sug = cidadesAtivas.find((x) => x.uf && `${x.nome}/${x.uf}` === v);
            if (sug) { setD((x) => ({ ...x, [kC]: sug.nome, [kU]: sug.uf ?? '' })); return; }
            const p = separarCidadeUF(v);
            if (p.uf && /\/\s*[A-Za-z]{2}$/.test(v)) setD((x) => ({ ...x, [kC]: p.cidade, [kU]: p.uf ?? '' }));
            else set(kC, v);
          }} />
      </label>
    );
  };
  // Local digitável: sugere os já usados na mesma cidade (ou em qualquer cidade, se a cidade estiver vazia).
  const local = (k: 'local_coleta' | 'local_entrega', rot: string, cidadeAtual: string, excluirTipo: 'coleta' | 'entrega') => {
    const nc = normalizar(cidadeAtual);
    const ops = c.locais.filter((l) => l.ativo && l.tipo !== excluirTipo && (!nc || normalizar(l.cidade) === nc));
    return (
      <label className="campo"><span>{rot}</span>
        <input className="entrada" list={`lista-${k}`} autoComplete="off" value={d[k]} placeholder="Armazém, fazenda ou terminal"
          onChange={(e) => set(k, e.target.value)} />
        <datalist id={`lista-${k}`}>{ops.map((l) => <option key={l.id} value={l.nome}>{l.cidade ? `${l.cidade}${l.uf ? `/${l.uf}` : ''}` : ''}</option>)}</datalist>
        <small>{d[k].trim() && !ops.some((l) => normalizar(l.nome) === normalizar(d[k])) ? 'Novo local: será gravado ao salvar.' : 'Escolha da lista ou digite um novo.'}</small>
      </label>
    );
  };

  return (
    <Modal titulo="Novo embarque" aoFechar={() => aoFechar()} rodape={<>
      <button className="btn" onClick={() => aoFechar()}>Cancelar</button>
      <button className="btn primario" disabled={enviando} onClick={salvar}>{enviando ? 'Salvando…' : 'Cadastrar embarque'}</button>
    </>}>
      {estado.demo && <Alerta tipo="aviso">Modo demonstração: este embarque será criado como dado demonstrativo.</Alerta>}
      {(['origem', 'destino'] as const).map((lado) => (
        <datalist key={lado} id={`lista-cidades-${lado}`}>{cidadesDo(lado).map((x) => <option key={x.id} value={x.uf ? `${x.nome}/${x.uf}` : x.nome} />)}</datalist>
      ))}
      <div className="grade-campos">
        <label className="campo"><span>Cliente *</span>
          <select className="entrada" value={d.cliente_id} onChange={(e) => {
            const cli = idx.cliente.get(e.target.value);
            setD((x) => ({ ...x, cliente_id: e.target.value, comercial_id: cli?.comercial_id ?? '' }));
          }}>
            <option value="">Selecione</option>
            {c.clientes.filter((x) => x.ativo).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
          {cliente?.restricao_comercial && <small style={{ color: 'var(--vermelho-700)' }}>Restrição: {cliente.restricao_comercial}</small>}
        </label>
        {sel('comercial_id', 'Carteira', c.comerciais, 'Sem carteira', !pode('carteira.editar'),
          d.cliente_id ? `Sugerida pelo cadastro do cliente: ${nome(idx.comercial, carteiraSugerida, 'sem carteira')}.${pode('carteira.editar') ? '' : ' Alterar exige permissão.'}` : undefined)}
        {sel('filial_id', 'Filial *', filiais, 'Selecione', false, filiais.length === 0 ? 'Seu centro de custo ainda não tem filiais. Fale com o administrador.' : undefined)}
        {sel('produto_id', 'Produto', c.produtos.filter((x) => x.ativo), 'Não informado')}
        {cidade('origem', 'Cidade de origem *')}
        {txt('origem_uf', 'UF de origem', { maxLength: 2, style: { textTransform: 'uppercase' } })}
        {local('local_coleta', 'Carregamento (coleta)', d.origem_cidade, 'entrega')}
        {cidade('destino', 'Cidade de destino *')}
        {txt('destino_uf', 'UF de destino', { maxLength: 2, style: { textTransform: 'uppercase' } })}
        {local('local_entrega', 'Descarga (entrega)', d.destino_cidade, 'coleta')}
        {pode('embarques.liberar') && sel('status_liberacao', 'Status de liberação', [{ id: 'nao_informado', nome: 'Não informado' }, { id: 'liberado', nome: 'Liberado' }, { id: 'suspenso', nome: 'Suspenso' }])}
        {pode('embarques.liberar') && txt('data_liberacao', 'Data de liberação', { type: 'date' })}
        {sel('cadencia_unidade', 'Meta diária em *', [{ id: 'veiculos_dia', nome: 'Veículos por dia' }, { id: 'toneladas_dia', nome: 'Toneladas por dia' }])}
        {txt('cadencia_valor', `Meta diária (${d.cadencia_unidade === 'toneladas_dia' ? 't/dia' : 'veículos/dia'}) *`, { inputMode: 'decimal', placeholder: d.cadencia_unidade === 'toneladas_dia' ? 'ex.: 120' : 'ex.: 3' },
          'Obrigatória. Base do executado × meta nas Posições e no Dashboard.')}
        {txt('lote_erp', 'Nº do lote no ERP', { maxLength: 60, placeholder: 'ex.: 2026-004512' }, 'Se o lote já existe no ERP. Vazio: o apoio informa no atendimento de Lote e Emissão.')}
        {txt('toneladas_por_veiculo', 'Toneladas médias por veículo', { inputMode: 'decimal', disabled: !pode('embarques.editar_capacidade') }, `Padrão: ${estado.config.capacidade_padrao_t} t.`)}
        {pode('financeiro.editar') && txt('frete_empresa', 'Frete empresa', { inputMode: 'decimal', placeholder: 'ex.: 67,50' })}
        {pode('financeiro.editar') && txt('frete_motorista', 'Frete motorista', { inputMode: 'decimal' }, 'Informado manualmente (sem desconto automático).')}
        {pode('financeiro.editar') && sel('unidade_frete', 'Unidade do frete', [{ id: 'nao_confirmada', nome: 'Não confirmada' }, { id: 'rs_tonelada', nome: 'R$/t' }, { id: 'rs_viagem', nome: 'R$/viagem' }, { id: 'rs_m3', nome: 'R$/m³' }, { id: 'outra', nome: 'Outra' }])}
      </div>
      <label className="campo"><span>Observação interna</span>
        <textarea className="entrada" value={d.observacao_interna} onChange={(e) => set('observacao_interna', e.target.value)} />
      </label>
      {pode('posicoes.abrir') && (
        <label className="check"><input type="checkbox" checked={d.abrir} onChange={(e) => set('abrir', e.target.checked)} />Abrir posição em {fmtData(estado.data)} (contadores começam em 0)</label>
      )}
      <p className="suave pequeno" style={{ margin: 0 }}>Cidades e locais novos são gravados automaticamente. Clientes e produtos novos são cadastrados em Administração → Cadastros.</p>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}
