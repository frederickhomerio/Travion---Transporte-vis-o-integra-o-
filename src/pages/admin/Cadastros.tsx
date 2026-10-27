import { useMemo, useRef, useState } from 'react';
import { Alerta, EstadoVazio, Modal, Segmentado, useAviso } from '../../components/ui';
import { mensagemErro, type LogoCandidata, type TipoCadastro } from '../../data/api';
import { useApp, useIndices } from '../../data/store';
import { cnpjValido, formatarCnpj, formatarTelefone, mascaraCnpj, nome } from '../../lib/cadastros';
import { dominioDoEmail, reduzirDataUrl, reduzirImagem } from '../../lib/cnpj';
import { fmtData, fmtDataHora, fmtReais, hojeSP } from '../../lib/formato';
import { contem, parseNumeroBR } from '../../lib/texto';
import type { Cliente, DadosCnpj } from '../../types';

type TipoCampo = 'texto' | 'uf' | 'select' | 'bool' | 'telefone' | 'decimal' | 'data';
interface DefCampoCad { campo: string; rotulo: string; tipo?: TipoCampo; opcoes?: Array<{ v: string; r: string }>; obrigatorio?: boolean; ajuda?: string; naTabela?: boolean }
type Lista = 'filiais' | 'comerciais' | 'clientes' | 'produtos' | 'locais' | 'cidades';
type Registro = Record<string, unknown> & { id: string; nome: string; ativo: boolean };

const DEF: Record<TipoCadastro, { rotulo: string; lista: Lista; campos: DefCampoCad[]; nota?: string }> = {
  cliente: { rotulo: 'Clientes', lista: 'clientes', campos: [] },
  filial: { rotulo: 'Filiais', lista: 'filiais', campos: [
    { campo: 'nome', rotulo: 'Nome', obrigatorio: true }, { campo: 'codigo', rotulo: 'Código' },
    { campo: 'supervisor', rotulo: 'Supervisor responsável' }, { campo: 'ativo', rotulo: 'Ativa', tipo: 'bool' },
  ] },
  comercial: { rotulo: 'Comerciais', lista: 'comerciais', campos: [
    { campo: 'nome', rotulo: 'Nome', obrigatorio: true }, { campo: 'telefone', rotulo: 'Telefone', tipo: 'telefone' },
    { campo: 'email', rotulo: 'E-mail' }, { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
  ] },
  produto: { rotulo: 'Produtos', lista: 'produtos', campos: [
    { campo: 'nome', rotulo: 'Nome', obrigatorio: true },
    { campo: 'valor_pauta_kg', rotulo: 'Valor aproximado de pauta (R$/kg)', tipo: 'decimal', ajuda: 'Ex.: 1,35. Use o botão abaixo para consultar o mercado.' },
    { campo: 'valor_pauta_data', rotulo: 'Data do valor', tipo: 'data' },
    { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
  ] },
  cidade: { rotulo: 'Cidades', lista: 'cidades', nota: 'Cidades de origem e destino. Também são gravadas automaticamente quando digitadas em um novo embarque.', campos: [
    { campo: 'nome', rotulo: 'Cidade', obrigatorio: true }, { campo: 'uf', rotulo: 'UF', tipo: 'uf' }, { campo: 'ativo', rotulo: 'Ativa', tipo: 'bool' },
  ] },
  local: { rotulo: 'Locais de coleta/entrega', lista: 'locais', nota: 'Armazéns, fazendas e terminais. São criados ao digitar no novo embarque; aqui você corrige nomes ou desativa.', campos: [
    { campo: 'nome', rotulo: 'Nome', obrigatorio: true }, { campo: 'cidade', rotulo: 'Cidade' }, { campo: 'uf', rotulo: 'UF', tipo: 'uf' },
    { campo: 'tipo', rotulo: 'Uso', tipo: 'select', opcoes: [{ v: 'ambos', r: 'Coleta e entrega' }, { v: 'coleta', r: 'Coleta' }, { v: 'entrega', r: 'Entrega' }] },
    { campo: 'ativo', rotulo: 'Ativo', tipo: 'bool' },
  ] },
};
const ORDEM: TipoCadastro[] = ['cliente', 'filial', 'comercial', 'produto', 'cidade', 'local'];

export function Cadastros() {
  const { estado } = useApp();
  const idx = useIndices();
  const [tipo, setTipo] = useState<TipoCadastro>('cliente');
  const [busca, setBusca] = useState('');
  const [editar, setEditar] = useState<Registro | 'novo' | null>(null);
  const def = DEF[tipo];
  const lista = ((estado.cadastros[def.lista] ?? []) as unknown as Registro[])
    .filter((r) => !busca || contem(r.nome, busca) || (tipo === 'cliente' && String(r.documento ?? '').includes(busca.replace(/\D/g, '') || '§')))
    .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, 'pt-BR'));

  const exibir = (r: Registro, c: DefCampoCad) => {
    const v = r[c.campo];
    if (c.tipo === 'bool') return v ? 'Sim' : 'Não';
    if (c.tipo === 'select') return c.opcoes?.find((o) => o.v === v)?.r ?? '—';
    if (c.tipo === 'decimal') return v === null || v === undefined ? '—' : `${fmtReais(Number(v), 4)}/kg`;
    if (c.tipo === 'data') return fmtData(v as string);
    return (v as string) || '—';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="ferramentas">
        <Segmentado rotulo="Tipo de cadastro" valor={tipo} aoMudar={(t) => { setTipo(t); setBusca(''); }}
          opcoes={ORDEM.map((t) => ({ valor: t, rotulo: DEF[t].rotulo }))} />
        <input className="entrada" style={{ maxWidth: 280 }} placeholder={tipo === 'cliente' ? 'Buscar por nome ou CNPJ' : 'Buscar pelo nome'} value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button className="btn primario" onClick={() => setEditar('novo')}>Novo</button>
      </div>
      {estado.demo && <Alerta tipo="aviso">Modo demonstração: novos cadastros serão criados como dados demonstrativos.</Alerta>}
      <p className="pequeno suave" style={{ margin: 0 }}>
        {def.nota ?? 'Cadastros não são excluídos (há histórico ligado a eles): desative para tirar das listas de seleção.'}
      </p>
      {lista.length === 0 ? <EstadoVazio titulo="Nada encontrado" /> : (
        <div className="cartao rolagem-x">
          <table className="tabela">
            {tipo === 'cliente' ? (
              <>
                <thead><tr><th /><th>Nome</th><th>CNPJ</th><th>Comercial</th><th>Tel. comercial</th><th>Cidade</th><th>Ativo</th><th /></tr></thead>
                <tbody>
                  {(lista as unknown as Cliente[]).map((r) => (
                    <tr key={r.id} style={r.ativo ? undefined : { opacity: 0.6 }}>
                      <td style={{ width: 84 }}><LogoCliente url={r.logo_url} nome={r.nome} /></td>
                      <td><strong>{r.nome}</strong>{r.razao_social && r.razao_social !== r.nome && <div className="pequeno suave">{r.razao_social}</div>}</td>
                      <td className="num">{r.documento ? formatarCnpj(r.documento) : <span className="suave">Pendente</span>}</td>
                      <td>{nome(idx.comercial, r.comercial_id, 'Sem comercial')}</td>
                      <td className="num">{r.telefone_comercial || <span className="suave">Pendente</span>}</td>
                      <td>{r.municipio ? `${r.municipio}${r.uf ? `/${r.uf}` : ''}` : '—'}</td>
                      <td>{r.ativo ? 'Sim' : 'Não'}</td>
                      <td className="td-acao"><button className="btn peq" onClick={() => setEditar(r as unknown as Registro)}>Editar</button></td>
                    </tr>
                  ))}
                </tbody>
              </>
            ) : (
              <>
                <thead><tr>{def.campos.map((c) => <th key={c.campo}>{c.rotulo}</th>)}<th /></tr></thead>
                <tbody>
                  {lista.map((r) => (
                    <tr key={r.id} style={r.ativo ? undefined : { opacity: 0.6 }}>
                      {def.campos.map((c) => <td key={c.campo}>{exibir(r, c)}</td>)}
                      <td className="td-acao"><button className="btn peq" onClick={() => setEditar(r)}>Editar</button></td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
        </div>
      )}
      {editar && (tipo === 'cliente'
        ? <EditarCliente registro={editar === 'novo' ? null : (editar as unknown as Cliente)} aoFechar={() => setEditar(null)} />
        : <EditarCadastro tipo={tipo} registro={editar === 'novo' ? null : editar} aoFechar={() => setEditar(null)} />)}
    </div>
  );
}

function LogoCliente({ url, nome: n, tam = 36, larg }: { url?: string | null; nome: string; tam?: number; larg?: number }) {
  const [falhou, setFalhou] = useState(false);
  if (url && !falhou) {
    // Logo inteira, sem corte: caixa retangular com a imagem contida.
    return <img src={url} alt={`Logo ${n}`} width={larg ?? tam * 2} height={tam} onError={() => setFalhou(true)}
      style={{ objectFit: 'contain', borderRadius: 8, background: '#fff', border: '1px solid var(--borda)', padding: 3 }} />;
  }
  const iniciais = n.replace(/\[[^\]]*\]/g, '').split(/\s+/).filter((p) => /^[\p{L}\d]/u.test(p)).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  return (
    <div aria-hidden style={{ width: tam, height: tam, borderRadius: 8, background: 'var(--vinho-claro, #f3e7e9)', color: 'var(--vinho)',
      display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: tam * 0.36 }}>{iniciais}</div>
  );
}

function EditarCadastro({ tipo, registro, aoFechar }: { tipo: TipoCadastro; registro: Registro | null; aoFechar: () => void }) {
  const { api, estado, recarregar } = useApp();
  const avisar = useAviso();
  const def = DEF[tipo];
  const inicial = useMemo(() => Object.fromEntries(def.campos.map((c) => {
    const v = registro ? registro[c.campo] : undefined;
    if (c.tipo === 'bool') return [c.campo, registro ? !!v : true];
    if (c.tipo === 'select') return [c.campo, (v as string) ?? c.opcoes![0].v];
    if (c.tipo === 'decimal') return [c.campo, v === null || v === undefined ? '' : String(v).replace('.', ',')];
    return [c.campo, (v as string) ?? ''];
  })), [def, registro]);
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
      if (c.tipo === 'decimal' && v !== null) {
        const n = parseNumeroBR(String(v));
        if (n === undefined || n === null || n < 0) { setErro(`${c.rotulo}: informe um número (ex.: 1,35).`); return; }
        v = n;
      }
      const antes = registro ? registro[c.campo] ?? null : undefined;
      if (!registro || antes !== v) dados[c.campo] = v;
    }
    if (tipo === 'produto' && 'valor_pauta_kg' in dados && dados.valor_pauta_kg !== null && !('valor_pauta_data' in dados)) {
      dados.valor_pauta_data = hojeSP();
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

  const valorKg = tipo === 'produto' ? parseNumeroBR(String(d.valor_pauta_kg ?? '')) : null;

  return (
    <Modal titulo={`${registro ? 'Editar' : 'Novo'} — ${def.rotulo}`} aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar}>Cancelar</button>
      <button className="btn primario" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar'}</button>
    </>}>
      <div className="grade-campos">
        {def.campos.map((c) => <Campo key={c.campo} c={c} valor={d[c.campo]} aoMudar={(v) => setD((x) => ({ ...x, [c.campo]: v }))} />)}
      </div>
      {tipo === 'produto' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <a className="btn secundario" target="_blank" rel="noopener noreferrer"
            href={`https://www.google.com/search?q=${encodeURIComponent(`preço ${String(d.nome || 'produto')} por kg hoje cotação`)}`}>
            Pesquisar preço de mercado ↗
          </a>
          {valorKg ? <span className="pequeno suave">≈ {fmtReais(valorKg * 1000)} por tonelada</span> : null}
        </div>
      )}
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}

function Campo({ c, valor, aoMudar, desabilitado }: { c: DefCampoCad; valor: unknown; aoMudar: (v: unknown) => void; desabilitado?: boolean }) {
  if (c.tipo === 'bool') {
    return <label className="check"><input type="checkbox" checked={!!valor} disabled={desabilitado} onChange={(e) => aoMudar(e.target.checked)} />{c.rotulo}</label>;
  }
  return (
    <label className="campo"><span>{c.rotulo}{c.obrigatorio && ' *'}</span>
      {c.tipo === 'select' ? (
        <select className="entrada" disabled={desabilitado} value={String(valor ?? '')} onChange={(e) => aoMudar(e.target.value)}>
          {c.opcoes!.map((o) => <option key={o.v} value={o.v}>{o.r}</option>)}
        </select>
      ) : (
        <input className="entrada" disabled={desabilitado}
          type={c.tipo === 'data' ? 'date' : c.tipo === 'telefone' ? 'tel' : 'text'}
          inputMode={c.tipo === 'decimal' ? 'decimal' : c.tipo === 'telefone' ? 'tel' : undefined}
          maxLength={c.tipo === 'uf' ? 2 : undefined}
          style={c.tipo === 'uf' ? { textTransform: 'uppercase' } : undefined}
          value={String(valor ?? '')}
          onChange={(e) => aoMudar(c.tipo === 'telefone' ? formatarTelefone(e.target.value) : e.target.value)} />
      )}
      {c.ajuda && <small>{c.ajuda}</small>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Cliente: CNPJ com consulta automática, dados da empresa, contatos, comercial e logo
// ---------------------------------------------------------------------------
const CAMPOS_RECEITA: Array<{ campo: keyof Cliente; rotulo: string; largo?: boolean }> = [
  { campo: 'razao_social', rotulo: 'Razão social', largo: true },
  { campo: 'inscricao_estadual', rotulo: 'Inscrição estadual' },
  { campo: 'situacao_cadastral', rotulo: 'Situação cadastral' },
  { campo: 'atividade_principal', rotulo: 'Atividade principal', largo: true },
  { campo: 'logradouro', rotulo: 'Endereço', largo: true },
  { campo: 'numero', rotulo: 'Número' },
  { campo: 'complemento', rotulo: 'Complemento' },
  { campo: 'bairro', rotulo: 'Bairro' },
  { campo: 'municipio', rotulo: 'Município' },
  { campo: 'uf', rotulo: 'UF' },
  { campo: 'cep', rotulo: 'CEP' },
  { campo: 'email', rotulo: 'E-mail (Receita)' },
  { campo: 'telefone_cadastro', rotulo: 'Telefone (Receita)' },
];
const CAMPOS_CLIENTE: Array<keyof Cliente> = ['nome', 'documento', 'comercial_id', 'restricao_comercial', 'ativo', 'telefone_comercial',
  'telefone_financeiro', 'logo_url', ...CAMPOS_RECEITA.map((c) => c.campo)];

function EditarCliente({ registro, aoFechar }: { registro: Cliente | null; aoFechar: () => void }) {
  const { api, estado, pode, recarregar } = useApp();
  const avisar = useAviso();
  const [d, setD] = useState<Record<string, unknown>>(() => {
    const base: Record<string, unknown> = Object.fromEntries(CAMPOS_CLIENTE.map((k) => [k, registro?.[k] ?? '']));
    base.ativo = registro ? registro.ativo : true;
    base.documento = registro?.documento ? formatarCnpj(registro.documento) : '';
    return base;
  });
  const [consulta, setConsulta] = useState<{ fonte: string; em: string; ies: DadosCnpj['inscricoes_estaduais'] } | null>(null);
  const [dadosReceita, setDadosReceita] = useState<DadosCnpj | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [site, setSite] = useState(() => dominioDoEmail(registro?.email) ?? '');
  const [logos, setLogos] = useState<LogoCandidata[] | null>(null);
  const [buscandoLogo, setBuscandoLogo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);
  const set = (k: string, v: unknown) => setD((x) => ({ ...x, [k]: v }));
  const podeCarteira = pode('carteira.editar');
  const cnpj = String(d.documento ?? '');
  const cnpjOk = cnpjValido(cnpj);

  async function buscarCnpj() {
    setErro(null); setAviso(null);
    if (!cnpjOk) { setErro('CNPJ inválido. Confira os 14 dígitos.'); return; }
    setBuscando(true);
    try {
      const r = await api.consultarCnpj(cnpj);
      setDadosReceita(r);
      setD((x) => ({
        ...x,
        nome: String(x.nome || '').trim() ? x.nome : (r.nome_fantasia || r.razao_social || ''),
        razao_social: r.razao_social ?? '', inscricao_estadual: r.inscricao_estadual ?? '', situacao_cadastral: r.situacao_cadastral ?? '',
        atividade_principal: r.atividade_principal ?? '', logradouro: r.logradouro ?? '', numero: r.numero ?? '', complemento: r.complemento ?? '',
        bairro: r.bairro ?? '', municipio: r.municipio ?? '', uf: r.uf ?? '', cep: r.cep ?? '', email: r.email ?? '', telefone_cadastro: r.telefone ?? '',
        telefone_comercial: String(x.telefone_comercial || '').trim() ? x.telefone_comercial : (r.telefone ? formatarTelefone(r.telefone) : ''),
      }));
      setConsulta({ fonte: r.fonte, em: new Date().toISOString(), ies: r.inscricoes_estaduais });
      const dom = dominioDoEmail(r.email);
      if (dom && !site) setSite(dom);
      if (r.situacao_cadastral && !/ativa/i.test(r.situacao_cadastral)) {
        setAviso(`Atenção: situação cadastral na Receita é "${r.situacao_cadastral}". Confirme antes de carregar para este cliente.`);
      }
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setBuscando(false);
    }
  }

  async function enviarLogo(f: File | undefined) {
    if (!f) return;
    try { set('logo_url', await reduzirImagem(f)); } catch (e) { setErro(mensagemErro(e)); }
  }

  const nomeEmpresa = String(d.nome || d.razao_social || '').replace(/\[DEMO\]/gi, '').trim();

  async function buscarLogo() {
    const temSite = /^[\w.-]+\.[a-z]{2,}/i.test(site.trim().replace(/^https?:\/\//, ''));
    if (!temSite && nomeEmpresa.length < 2) { setErro('Informe o site ou o nome da empresa para buscar a logo.'); return; }
    setErro(null); setLogos(null); setBuscandoLogo(true);
    try { setLogos(await api.buscarLogos(temSite ? site : '', nomeEmpresa)); } catch (e) { setErro(mensagemErro(e)); } finally { setBuscandoLogo(false); }
  }

  // Imagem copiada (ex.: "Copiar imagem" no Google Imagens) colada com Ctrl+V ou pelo botão "Colar imagem".
  async function colarLogo(e?: React.ClipboardEvent) {
    try {
      if (e) {
        const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
        if (!f) return;
        e.preventDefault();
        set('logo_url', await reduzirImagem(f)); setLogos(null); setErro(null);
        return;
      }
      if (!navigator.clipboard?.read) { setErro('Este navegador não deixa colar pelo botão. Use Ctrl+V nesta área ou "Enviar imagem".'); return; }
      for (const item of await navigator.clipboard.read()) {
        const tipo = item.types.find((t) => t.startsWith('image/'));
        if (!tipo) continue;
        const blob = await item.getType(tipo);
        set('logo_url', await reduzirImagem(new File([blob], 'logo', { type: tipo }))); setLogos(null); setErro(null);
        return;
      }
      setErro('Não há imagem copiada. No Google Imagens, abra a imagem, use "Copiar imagem" e tente de novo.');
    } catch (err) { setErro(mensagemErro(err)); }
  }

  async function escolherLogo(c: LogoCandidata) {
    try { set('logo_url', await reduzirDataUrl(c.dataUrl)); setLogos(null); } catch (e) { setErro(mensagemErro(e)); }
  }

  async function salvar() {
    setErro(null);
    if (!cnpjOk) { setErro('Informe um CNPJ válido.'); return; }
    if (!String(d.nome ?? '').trim()) { setErro('Informe o nome do cliente (como vai aparecer no app).'); return; }
    if (String(d.telefone_comercial ?? '').replace(/\D/g, '').length < 10) { setErro('Telefone de contato comercial é obrigatório (com DDD).'); return; }
    if (!d.comercial_id) { setErro('Selecione o comercial responsável pelo cliente.'); return; }
    if (d.uf && !/^[A-Za-z]{2}$/.test(String(d.uf).trim())) { setErro('UF deve ter 2 letras.'); return; }
    const dados: Record<string, unknown> = {};
    for (const k of CAMPOS_CLIENTE) {
      let v = d[k];
      if (typeof v === 'string') v = v.trim() === '' ? null : v.trim();
      if (k === 'documento') v = cnpj.replace(/\D/g, '');
      if (k === 'uf' && v) v = String(v).toUpperCase();
      if (k === 'comercial_id' && !podeCarteira && registro) continue;
      const antes = registro ? registro[k] ?? null : undefined;
      if (!registro || antes !== v) dados[k] = v;
    }
    if (dadosReceita) {
      dados.dados_receita = dadosReceita;
      dados.dados_consultados_em = consulta?.em ?? new Date().toISOString();
    }
    if (registro && Object.keys(dados).length === 0) { aoFechar(); return; }
    setSalvando(true);
    try {
      await api.salvarCadastro('cliente', registro?.id ?? null, dados, estado.demo);
      await recarregar();
      avisar('ok', 'Cliente salvo.');
      aoFechar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const txt = (k: string, rot: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="campo" key={k}><span>{rot}</span>
      <input className="entrada" value={String(d[k] ?? '')} onChange={(e) => set(k, e.target.value)} {...props} />
    </label>
  );

  return (
    <Modal titulo={registro ? `Editar cliente — ${registro.nome}` : 'Novo cliente'} aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar}>Cancelar</button>
      <button className="btn primario" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar cliente'}</button>
    </>}>
      {!registro && !podeCarteira && <Alerta tipo="aviso">Para cadastrar cliente é preciso definir o comercial responsável, e isso exige a permissão “Alterar a carteira”. Peça a um administrador.</Alerta>}

      <h3 className="titulo-secao-form">1. CNPJ</h3>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="campo" style={{ flex: '1 1 220px' }}><span>CNPJ *</span>
          <input className="entrada num" inputMode="numeric" placeholder="00.000.000/0000-00" value={cnpj}
            onChange={(e) => set('documento', mascaraCnpj(e.target.value))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void buscarCnpj(); } }} />
          {cnpj.replace(/\D/g, '').length === 14 && !cnpjOk && <small style={{ color: 'var(--erro, #c52c36)' }}>CNPJ inválido (dígito verificador não confere).</small>}
        </label>
        <button type="button" className="btn secundario" disabled={!cnpjOk || buscando} onClick={buscarCnpj}>
          {buscando ? 'Consultando…' : 'Buscar dados na Receita'}
        </button>
      </div>
      {consulta && <p className="pequeno suave" style={{ margin: 0 }}>Dados preenchidos por {consulta.fonte} em {fmtDataHora(consulta.em)}. Confira e ajuste se necessário.</p>}
      {!consulta && registro?.dados_consultados_em && <p className="pequeno suave" style={{ margin: 0 }}>Última consulta à Receita: {fmtDataHora(registro.dados_consultados_em)}.</p>}
      {consulta && consulta.ies.length > 1 && (
        <p className="pequeno suave" style={{ margin: 0 }}>Inscrições estaduais encontradas: {consulta.ies.map((i) => `${i.ie} (${i.uf ?? '?'}${i.ativa ? '' : ', inativa'})`).join(' · ')}</p>
      )}
      {consulta && !d.inscricao_estadual && <p className="pequeno suave" style={{ margin: 0 }}>Inscrição estadual não informada pela base pública. Preencha manualmente se houver.</p>}
      {aviso && <Alerta tipo="aviso">{aviso}</Alerta>}

      <h3 className="titulo-secao-form">2. Dados da empresa</h3>
      <div className="grade-campos">
        <label className="campo"><span>Nome no app *</span>
          <input className="entrada" value={String(d.nome ?? '')} onChange={(e) => set('nome', e.target.value)} />
          <small>Como o cliente aparece nas listas (ex.: nome fantasia).</small>
        </label>
        {CAMPOS_RECEITA.map((c) => txt(c.campo, c.rotulo, c.campo === 'uf' ? { maxLength: 2, style: { textTransform: 'uppercase' } } : {}))}
      </div>

      <h3 className="titulo-secao-form">3. Contatos e carteira</h3>
      <div className="grade-campos">
        {txt('telefone_comercial', 'Telefone de contato comercial *', { type: 'tel', inputMode: 'tel', placeholder: '(64) 99999-0000', onChange: (e) => set('telefone_comercial', formatarTelefone(e.target.value)) })}
        {txt('telefone_financeiro', 'Telefone de contato financeiro', { type: 'tel', inputMode: 'tel', placeholder: '(64) 3600-0000', onChange: (e) => set('telefone_financeiro', formatarTelefone(e.target.value)) })}
        <label className="campo"><span>Comercial responsável *</span>
          <select className="entrada" disabled={!podeCarteira} value={String(d.comercial_id ?? '')} onChange={(e) => set('comercial_id', e.target.value)}>
            <option value="">Selecione</option>
            {estado.cadastros.comerciais.filter((x) => x.ativo || x.id === d.comercial_id).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </select>
          {estado.cadastros.comerciais.length === 0 && <small>Cadastre primeiro os comerciais.</small>}
          {!podeCarteira && <small>Alterar o comercial exige permissão específica.</small>}
        </label>
        {txt('restricao_comercial', 'Restrição comercial')}
        <label className="check"><input type="checkbox" checked={!!d.ativo} onChange={(e) => set('ativo', e.target.checked)} />Cliente ativo</label>
      </div>

      <h3 className="titulo-secao-form">4. Logo</h3>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }} onPaste={(e) => void colarLogo(e)}>
        <LogoCliente key={String(d.logo_url)} url={d.logo_url as string} nome={String(d.nome || '?')} tam={72} larg={180} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 260px' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="entrada" style={{ flex: '1 1 180px' }} placeholder="site da empresa (ex.: empresa.com.br)" value={site} onChange={(e) => setSite(e.target.value)} />
            <button type="button" className="btn secundario" disabled={buscandoLogo} onClick={buscarLogo}>{buscandoLogo ? 'Procurando…' : 'Buscar logo'}</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a className="btn terciario" target="_blank" rel="noopener noreferrer"
              href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${nomeEmpresa || site} logo png`)}`}
              onClick={(e) => { if (!nomeEmpresa && !site.trim()) { e.preventDefault(); setErro('Informe o nome ou o site da empresa.'); } }}>Ver no Google Imagens ↗</a>
            <button type="button" className="btn terciario" onClick={() => void colarLogo()}>Colar imagem</button>
            <button type="button" className="btn terciario" onClick={() => arquivo.current?.click()}>Enviar imagem</button>
            {d.logo_url ? <button type="button" className="btn sutil" onClick={() => set('logo_url', '')}>Remover logo</button> : null}
            <input ref={arquivo} type="file" accept="image/*" hidden onChange={(e) => void enviarLogo(e.target.files?.[0])} />
          </div>
          <small className="suave">"Buscar logo" lê o site da empresa e a logo oficial registrada na Wikimedia; escolha a que estiver completa. Se nenhuma servir, abra o Google Imagens, use "Copiar imagem" e cole aqui (Ctrl+V ou "Colar imagem"), ou envie o arquivo.</small>
        </div>
      </div>
      {logos && (
        <div>
          <p className="pequeno" style={{ margin: '4px 0 8px' }}><strong>Escolha a logo ({logos.length} encontrada{logos.length > 1 ? 's' : ''}):</strong></p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {logos.map((c) => (
              <button key={c.url} type="button" onClick={() => void escolherLogo(c)} title={c.url}
                style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', padding: 8, borderRadius: 10, border: '1px solid var(--borda)', background: '#fff', cursor: 'pointer', minHeight: 44 }}>
                <img src={c.dataUrl} alt="" style={{ width: '100%', height: 70, objectFit: 'contain' }} />
                <span className="pequeno suave">{c.origem}</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn sutil peq" onClick={() => setLogos(null)}>Fechar opções</button>
        </div>
      )}

      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}
