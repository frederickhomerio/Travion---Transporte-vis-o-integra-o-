import { useState } from 'react';
import { useApp, useIndices } from '../data/store';
import { cidades, FILTROS_VAZIOS, filtrosAtivos } from '../lib/filtros';
import { hojeSP } from '../lib/formato';
import type { LinhaFrete } from '../types';
import { Icone } from './ui';

/** Data operacional + busca + filtros. O mesmo estado é usado na Lista de Fretes e no Dashboard. */
export function BarraFiltros({ linhas, semBusca = false, extra }: { linhas: LinhaFrete[]; semBusca?: boolean; extra?: React.ReactNode }) {
  const { estado, definirData, definirFiltros } = useApp();
  const idx = useIndices();
  const f = estado.filtros;
  const [aberto, setAberto] = useState(false);
  const n = filtrosAtivos(f);
  const hoje = hojeSP();
  const c = estado.cadastros;

  return (
    <>
      <div className="ferramentas">
        <label className="campo" style={{ width: 170 }}>
          <span>Data operacional</span>
          <input className="entrada" type="date" value={estado.data} max={hoje} onChange={(e) => e.target.value && definirData(e.target.value)} />
        </label>
        {estado.data !== hoje && (
          <button className="btn sutil" onClick={() => definirData(hoje)}>Ir para hoje</button>
        )}
        {!semBusca && (
          <label className="campo busca">
            <span>Busca</span>
            <input className="entrada" type="search" placeholder="Cliente, cidade, local, produto, código…" value={f.busca}
              onChange={(e) => definirFiltros({ busca: e.target.value })} />
          </label>
        )}
        <button className="btn" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
          <Icone nome="filtro" tam={18} />Filtros{n > 0 && <span className="badge info">{n}</span>}
        </button>
        {n > 0 && <button className="btn sutil" onClick={() => definirFiltros({ ...FILTROS_VAZIOS })}>Limpar filtros</button>}
        {extra}
      </div>
      {aberto && (
        <div className="cartao painel-filtros">
          <Sel rot="Cliente" v={f.cliente_id} on={(v) => definirFiltros({ cliente_id: v })} ops={c.clientes.filter((x) => linhas.some((l) => l.embarque.cliente_id === x.id)).map((x) => [x.id, x.nome])} />
          <Sel rot="Filial" v={f.filial_id} on={(v) => definirFiltros({ filial_id: v })} ops={c.filiais.map((x) => [x.id, x.nome])} />
          <Sel rot="Carteira" v={f.comercial_id} on={(v) => definirFiltros({ comercial_id: v })} ops={[...c.comerciais.map((x) => [x.id, x.nome] as [string, string]), ['__sem', 'Sem carteira']]} />
          <Sel rot="Produto" v={f.produto_id} on={(v) => definirFiltros({ produto_id: v })} ops={c.produtos.map((x) => [x.id, x.nome])} />
          <Sel rot="Origem" v={f.origem} on={(v) => definirFiltros({ origem: v })} ops={cidades(linhas, 'origem_cidade').map((x) => [x.valor, x.rotulo])} />
          <Sel rot="Destino" v={f.destino} on={(v) => definirFiltros({ destino: v })} ops={cidades(linhas, 'destino_cidade').map((x) => [x.valor, x.rotulo])} />
          <Sel rot="Status de liberação" v={f.status} on={(v) => definirFiltros({ status: v as never })}
            ops={[['liberado', 'Liberado'], ['suspenso', 'Suspenso'], ['nao_informado', 'Não informado']]} />
          <div className="campo" style={{ justifyContent: 'flex-end' }}>
            <label className="check"><input type="checkbox" checked={f.soMovimentacao} onChange={(e) => definirFiltros({ soMovimentacao: e.target.checked })} />Apenas com movimentação</label>
          </div>
          <div className="campo" style={{ justifyContent: 'flex-end' }}>
            <label className="check"><input type="checkbox" checked={f.incluirSemPosicao} onChange={(e) => definirFiltros({ incluirSemPosicao: e.target.checked })} />Mostrar embarques sem posição na data</label>
          </div>
          <div className="campo" style={{ justifyContent: 'flex-end' }}>
            <label className="check"><input type="checkbox" checked={f.incluirArquivados} onChange={(e) => definirFiltros({ incluirArquivados: e.target.checked })} />Incluir arquivados</label>
          </div>
          {idx.filial.size === 0 && <p className="suave pequeno">Nenhuma filial cadastrada.</p>}
        </div>
      )}
    </>
  );
}

function Sel({ rot, v, on, ops }: { rot: string; v: string; on: (v: string) => void; ops: Array<[string, string]> }) {
  return (
    <label className="campo">
      <span>{rot}</span>
      <select className="entrada" value={v} onChange={(e) => on(e.target.value)}>
        <option value="">Todos</option>
        {ops.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
      </select>
    </label>
  );
}
