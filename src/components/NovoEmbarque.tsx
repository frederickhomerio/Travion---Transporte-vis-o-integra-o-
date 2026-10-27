import { useMemo, useState } from 'react';
import { mensagemErro } from '../data/api';
import { useApp, useIndices } from '../data/store';
import { nome } from '../lib/cadastros';
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
    origem_cidade: '', origem_uf: '', local_coleta_id: '', destino_cidade: '', destino_uf: '', local_entrega_id: '',
    status_liberacao: 'nao_informado', data_liberacao: '', cadencia_valor: '', cadencia_unidade: estado.config.cadencia_unidade_padrao,
    toneladas_por_veiculo: String(estado.config.capacidade_padrao_t), observacao_interna: '',
    frete_empresa: '', frete_motorista: '', unidade_frete: 'rs_tonelada', abrir: pode('posicoes.abrir'),
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
    if (cad === undefined || (cad !== null && cad <= 0)) { setErro('Cadência deve ser um número maior que zero (ou vazia).'); return; }
    const dados: Record<string, unknown> = {
      cliente_id: d.cliente_id, filial_id: d.filial_id, origem_cidade: d.origem_cidade.trim(), destino_cidade: d.destino_cidade.trim(),
      status_liberacao: d.status_liberacao, cadencia_unidade: d.cadencia_unidade,
    };
    if (d.produto_id) dados.produto_id = d.produto_id;
    if (d.origem_uf) dados.origem_uf = d.origem_uf;
    if (d.destino_uf) dados.destino_uf = d.destino_uf;
    if (d.local_coleta_id) dados.local_coleta_id = d.local_coleta_id;
    if (d.local_entrega_id) dados.local_entrega_id = d.local_entrega_id;
    if (d.data_liberacao) dados.data_liberacao = d.data_liberacao;
    if (cad) dados.cadencia_valor = cad;
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
    setEnviando(true);
    try {
      const e = await api.criarEmbarque(dados, estado.demo);
      aplicarEmbarque(e);
      await recarregar();
      avisar('ok', 'Embarque cadastrado.');
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

  return (
    <Modal titulo="Novo embarque" aoFechar={() => aoFechar()} rodape={<>
      <button className="btn" onClick={() => aoFechar()}>Cancelar</button>
      <button className="btn primario" disabled={enviando} onClick={salvar}>{enviando ? 'Salvando…' : 'Cadastrar embarque'}</button>
    </>}>
      {estado.demo && <Alerta tipo="aviso">Modo demonstração: este embarque será criado como dado demonstrativo.</Alerta>}
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
        {sel('filial_id', 'Filial *', filiais, 'Selecione', false, filiais.length === 0 ? 'Você não tem filiais autorizadas.' : undefined)}
        {sel('produto_id', 'Produto', c.produtos.filter((x) => x.ativo), 'Não informado')}
        {txt('origem_cidade', 'Cidade de origem *')}
        {txt('origem_uf', 'UF de origem', { maxLength: 2, style: { textTransform: 'uppercase' } })}
        {sel('local_coleta_id', 'Carregamento (coleta)', c.locais.filter((l) => l.ativo && l.tipo !== 'entrega').map((l) => ({ id: l.id, nome: `${l.nome}${l.cidade ? ` (${l.cidade})` : ''}` })), 'Não informado')}
        {txt('destino_cidade', 'Cidade de destino *')}
        {txt('destino_uf', 'UF de destino', { maxLength: 2, style: { textTransform: 'uppercase' } })}
        {sel('local_entrega_id', 'Descarga (entrega)', c.locais.filter((l) => l.ativo && l.tipo !== 'coleta').map((l) => ({ id: l.id, nome: `${l.nome}${l.cidade ? ` (${l.cidade})` : ''}` })), 'Não informado')}
        {pode('embarques.liberar') && sel('status_liberacao', 'Status de liberação', [{ id: 'nao_informado', nome: 'Não informado' }, { id: 'liberado', nome: 'Liberado' }, { id: 'suspenso', nome: 'Suspenso' }])}
        {pode('embarques.liberar') && txt('data_liberacao', 'Data de liberação', { type: 'date' })}
        {pode('embarques.editar_cadencia') && txt('cadencia_valor', 'Cadência (meta)', { inputMode: 'decimal' }, `Vazio = meta padrão (${estado.config.meta_veiculos_lote_padrao} veículos/lote).`)}
        {pode('embarques.editar_cadencia') && sel('cadencia_unidade', 'Unidade da cadência', [{ id: 'veiculos_dia', nome: 'Veículos por dia' }, { id: 'toneladas_dia', nome: 'Toneladas por dia' }])}
        {txt('toneladas_por_veiculo', 'Toneladas médias por veículo', { inputMode: 'decimal', disabled: !pode('embarques.editar_capacidade') }, `Padrão: ${estado.config.capacidade_padrao_t} t.`)}
        {pode('financeiro.editar') && txt('frete_empresa', 'Frete empresa', { inputMode: 'decimal', placeholder: 'ex.: 67,50' })}
        {pode('financeiro.editar') && txt('frete_motorista', 'Frete motorista', { inputMode: 'decimal' }, 'Informado manualmente (sem desconto automático).')}
        {pode('financeiro.editar') && sel('unidade_frete', 'Unidade do frete', [{ id: 'nao_confirmada', nome: 'Não confirmada' }, { id: 'rs_tonelada', nome: 'R$/t' }, { id: 'rs_viagem', nome: 'R$/viagem' }, { id: 'outra', nome: 'Outra' }])}
      </div>
      <label className="campo"><span>Observação interna</span>
        <textarea className="entrada" value={d.observacao_interna} onChange={(e) => set('observacao_interna', e.target.value)} />
      </label>
      {pode('posicoes.abrir') && (
        <label className="check"><input type="checkbox" checked={d.abrir} onChange={(e) => set('abrir', e.target.checked)} />Abrir posição em {fmtData(estado.data)} (contadores começam em 0)</label>
      )}
      <p className="suave pequeno" style={{ margin: 0 }}>Locais, produtos e clientes novos são cadastrados em Administração → Cadastros.</p>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}
