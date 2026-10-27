import { useMemo, useState } from 'react';
import { Alerta, EstadoVazio, Modal, Segmentado, useAviso } from '../../components/ui';
import { mensagemErro, type TipoCadastro } from '../../data/api';
import { useApp, useIndices } from '../../data/store';
import { nome } from '../../lib/cadastros';
import { contem } from '../../lib/texto';

interface DefCampoCad { campo: string; rotulo: string; tipo?: 'texto' | 'uf' | 'select' | 'comercial' | 'bool'; opcoes?: Array<{ v: string; r: string }>; obrigatorio?: boolean; ajuda?: string }

const DEF: Record<TipoCadastro, { rotulo: string; lista: 'filiais' | 'comerciais' | 'clientes' | 'produtos' | 'locais'; campos: DefCampoCad[] }> = {
  cliente: { rotulo: 'Clientes', lista: 'clientes', campos: [
    { campo: 'nome', rotulo: 'Nome', obrigatorio: true },
    { campo: 'documento', rotulo: 'CNPJ/CPF' },
    { campo: 'comercial_id', rotulo: 'Carteira (comercial)', tipo: 'comercial', ajuda: 'Sugerida ao cadastrar embarques. Alterar exige permissão e fica no histórico.' },
    { campo: 'restricao_comercial', rotulo: 'Restrição comercial', ajuda: 'Ex.: NÃO CARREGAR. Aparece como alerta.' },
    { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
  ] },
  filial: { rotulo: 'Filiais', lista: 'filiais', campos: [
    { campo: 'nome', rotulo: 'Nome', obrigatorio: true }, { campo: 'codigo', rotulo: 'Código' }, { campo: 'ativo', rotulo: 'Ativa', tipo: 'bool' },
  ] },
  comercial: { rotulo: 'Comerciais', lista: 'comerciais', campos: [
    { campo: 'nome', rotulo: 'Nome', obrigatorio: true }, { campo: 'email', rotulo: 'E-mail' }, { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
  ] },
  produto: { rotulo: 'Produtos', lista: 'produtos', campos: [
    { campo: 'nome', rotulo: 'Nome', obrigatorio: true }, { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
  ] },
  local: { rotulo: 'Locais', lista: 'locais', campos: [
    { campo: 'nome', rotulo: 'Nome', obrigatorio: true }, { campo: 'cidade', rotulo: 'Cidade' }, { campo: 'uf', rotulo: 'UF', tipo: 'uf' },
    { campo: 'tipo', rotulo: 'Uso', tipo: 'select', opcoes: [{ v: 'ambos', r: 'Coleta e entrega' }, { v: 'coleta', r: 'Coleta' }, { v: 'entrega', r: 'Entrega' }] },
    { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
  ] },
};

type Registro = Record<string, unknown> & { id: string; nome: string; ativo: boolean };

export function Cadastros() {
  const { estado } = useApp();
  const idx = useIndices();
  const [tipo, setTipo] = useState<TipoCadastro>('cliente');
  const [busca, setBusca] = useState('');
  const [editar, setEditar] = useState<Registro | 'novo' | null>(null);
  const def = DEF[tipo];
  const lista = (estado.cadastros[def.lista] as unknown as Registro[])
    .filter((r) => !busca || contem(r.nome, busca))
    .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, 'pt-BR'));

  const exibir = (r: Registro, c: DefCampoCad) => {
    const v = r[c.campo];
    if (c.tipo === 'bool') return v ? 'Sim' : 'Não';
    if (c.tipo === 'comercial') return nome(idx.comercial, v as string, 'Sem carteira');
    if (c.tipo === 'select') return c.opcoes?.find((o) => o.v === v)?.r ?? '—';
    return (v as string) || '—';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="ferramentas">
        <Segmentado rotulo="Tipo de cadastro" valor={tipo} aoMudar={(t) => { setTipo(t); setBusca(''); }}
          opcoes={(Object.keys(DEF) as TipoCadastro[]).map((t) => ({ valor: t, rotulo: DEF[t].rotulo }))} />
        <input className="entrada" style={{ maxWidth: 280 }} placeholder="Buscar pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button className="btn primario" onClick={() => setEditar('novo')}>Novo</button>
      </div>
      {estado.demo && <Alerta tipo="aviso">Modo demonstração: novos cadastros serão criados como dados demonstrativos.</Alerta>}
      <p className="pequeno suave" style={{ margin: 0 }}>Cadastros não são excluídos (há histórico ligado a eles): desative para tirar das listas de seleção. Novos cadastros aparecem automaticamente nos filtros e no Dashboard.</p>
      {lista.length === 0 ? <EstadoVazio titulo="Nada encontrado" /> : (
        <div className="cartao rolagem-x">
          <table className="tabela">
            <thead><tr>{def.campos.map((c) => <th key={c.campo}>{c.rotulo}</th>)}<th /></tr></thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.id} style={r.ativo ? undefined : { opacity: 0.6 }}>
                  {def.campos.map((c) => <td key={c.campo}>{exibir(r, c)}</td>)}
                  <td className="td-acao"><button className="btn peq" onClick={() => setEditar(r)}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editar && <EditarCadastro tipo={tipo} registro={editar === 'novo' ? null : editar} aoFechar={() => setEditar(null)} />}
    </div>
  );
}

function EditarCadastro({ tipo, registro, aoFechar }: { tipo: TipoCadastro; registro: Registro | null; aoFechar: () => void }) {
  const { api, estado, pode, recarregar } = useApp();
  const avisar = useAviso();
  const def = DEF[tipo];
  const inicial = useMemo(() => Object.fromEntries(def.campos.map((c) => [c.campo,
    registro ? (registro[c.campo] ?? (c.tipo === 'bool' ? false : '')) : c.tipo === 'bool' ? true : c.tipo === 'select' ? c.opcoes![0].v : ''])), [def, registro]);
  const [d, setD] = useState<Record<string, unknown>>(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const dados: Record<string, unknown> = {};
    for (const c of def.campos) {
      let v = d[c.campo];
      if (typeof v === 'string') v = v.trim() === '' ? null : c.tipo === 'uf' ? v.trim().toUpperCase() : v.trim();
      if (c.obrigatorio && !v) { setErro(`${c.rotulo} é obrigatório.`); return; }
      if (c.tipo === 'uf' && v && !/^[A-Z]{2}$/.test(v as string)) { setErro('UF deve ter 2 letras.'); return; }
      if (c.tipo === 'comercial' && !pode('carteira.editar')) continue;
      const antes = registro ? registro[c.campo] ?? null : undefined;
      if (!registro || antes !== v) dados[c.campo] = v;
    }
    if (registro && Object.keys(dados).length === 0) { aoFechar(); return; }
    setSalvando(true);
    setErro(null);
    try {
      await api.salvarCadastro(tipo, registro?.id ?? null, dados, estado.demo);
      await recarregar();
      avisar('ok', 'Cadastro salvo.');
      aoFechar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={`${registro ? 'Editar' : 'Novo'} — ${def.rotulo}`} aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar}>Cancelar</button>
      <button className="btn primario" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>
    </>}>
      <div className="grade-campos">
        {def.campos.map((c) => {
          if (c.tipo === 'bool') return <label key={c.campo} className="check"><input type="checkbox" checked={!!d[c.campo]} onChange={(e) => setD({ ...d, [c.campo]: e.target.checked })} />{c.rotulo}</label>;
          const bloqueado = c.tipo === 'comercial' && !pode('carteira.editar');
          return (
            <label key={c.campo} className="campo"><span>{c.rotulo}{c.obrigatorio && ' *'}</span>
              {c.tipo === 'comercial' || c.tipo === 'select' ? (
                <select className="entrada" disabled={bloqueado} value={String(d[c.campo] ?? '')} onChange={(e) => setD({ ...d, [c.campo]: e.target.value })}>
                  {c.tipo === 'comercial' && <option value="">Sem carteira</option>}
                  {c.tipo === 'comercial'
                    ? estado.cadastros.comerciais.filter((x) => x.ativo || x.id === d[c.campo]).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)
                    : c.opcoes!.map((o) => <option key={o.v} value={o.v}>{o.r}</option>)}
                </select>
              ) : (
                <input className="entrada" maxLength={c.tipo === 'uf' ? 2 : undefined} value={String(d[c.campo] ?? '')} onChange={(e) => setD({ ...d, [c.campo]: e.target.value })} />
              )}
              {c.ajuda && <small>{c.ajuda}</small>}
              {bloqueado && <small>Alterar a carteira exige permissão específica.</small>}
            </label>
          );
        })}
      </div>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}
