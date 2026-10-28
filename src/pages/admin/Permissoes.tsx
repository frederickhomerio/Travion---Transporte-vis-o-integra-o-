import { useEffect, useMemo, useState } from 'react';
import { Alerta, Carregando, EstadoVazio, Segmentado, useAviso } from '../../components/ui';
import { type MatrizPermissoes, type UsuarioPermissoes, mensagemErro } from '../../data/api';
import { useApp } from '../../data/store';
import { ROTULO_PAPEL } from '../../lib/formato';
import { normalizar } from '../../lib/texto';
import type { Papel, Permissao } from '../../types';

const PAPEIS: Papel[] = ['gestor', 'supervisor', 'embarcador', 'apoio', 'comercial', 'consulta'];
const SO_ADMIN: Permissao[] = ['usuarios.gerenciar', 'permissoes.gerenciar'];
type Escolha = 'padrao' | 'permitir' | 'negar';

/** Permissões: por usuário (Administrador e Gestor) e o padrão por função (só Administrador altera). O servidor confere tudo. */
export function Permissoes() {
  const { api } = useApp();
  const [m, setM] = useState<MatrizPermissoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<'usuario' | 'funcao'>('usuario');
  useEffect(() => { api.matrizPermissoes().then(setM).catch((e) => setErro(mensagemErro(e))); }, [api]);
  const grupos = useMemo(() => {
    const g = new Map<string, MatrizPermissoes['catalogo']>();
    for (const c of m?.catalogo ?? []) g.set(c.grupo, [...(g.get(c.grupo) ?? []), c]);
    return [...g.entries()];
  }, [m]);

  if (erro) return <Alerta tipo="erro">{erro}</Alerta>;
  if (!m) return <Carregando />;
  return (
    <div className="pu">
      <Segmentado rotulo="Modo" valor={aba} aoMudar={setAba} opcoes={[
        { valor: 'usuario', rotulo: 'Por usuário' },
        { valor: 'funcao', rotulo: 'Padrão por função' },
      ]} />
      {aba === 'usuario' ? <PorUsuario m={m} grupos={grupos} /> : <PorFuncao m={m} setM={setM} grupos={grupos} />}
    </div>
  );
}

type Grupos = Array<[string, MatrizPermissoes['catalogo']]>;

function PorUsuario({ m, grupos }: { m: MatrizPermissoes; grupos: Grupos }) {
  const { api, estado, pode, atualizarSessao } = useApp();
  const avisar = useAviso();
  const eu = estado.sessao!.perfil;
  const admin = eu.papel === 'administrador';
  const [usuarios, setUsuarios] = useState<UsuarioPermissoes[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [papel, setPapel] = useState<Papel | ''>('');
  const [selId, setSelId] = useState<string | null>(null);
  const [mudancas, setMudancas] = useState<Partial<Record<Permissao, boolean | null>>>({});
  const [gravando, setGravando] = useState(false);

  useEffect(() => { api.listarPermissoesUsuarios().then(setUsuarios).catch((e) => setErro(mensagemErro(e))); }, [api]);
  const padrao = useMemo(() => new Set(m.papeis.map((p) => `${p.papel}:${p.chave}`)), [m]);
  const filtrados = useMemo(() => {
    const t = normalizar(busca);
    return (usuarios ?? []).filter((u) => (!papel || u.papel === papel) && (!t || normalizar(`${u.nome ?? ''} ${u.email ?? ''}`).includes(t)));
  }, [usuarios, busca, papel]);
  const sel = usuarios?.find((u) => u.id === selId) ?? null;
  const nMud = Object.keys(mudancas).length;

  const escolher = (id: string) => {
    if (nMud && !window.confirm('Há alterações não salvas para o usuário aberto. Descartar?')) return;
    setMudancas({}); setSelId(id);
  };

  const salvar = async () => {
    if (!sel || !nMud) return;
    setGravando(true);
    try {
      const novas = await api.salvarPermissoesUsuario(sel.id, mudancas);
      setUsuarios((us) => us && us.map((u) => (u.id === sel.id ? { ...u, permissoes: novas } : u)));
      setMudancas({});
      void atualizarSessao();
      avisar('ok', `Permissões de ${sel.nome || sel.email} salvas.`);
    } catch (e) { avisar('erro', mensagemErro(e)); } finally { setGravando(false); }
  };

  if (erro) return <Alerta tipo="erro">{erro}</Alerta>;
  if (!usuarios) return <Carregando texto="Carregando usuários…" />;
  return (
    <div className="pu-grade">
      <section className="cartao pu-lista" aria-label="Usuários">
        <div className="cartao-corpo pu-filtros">
          <input className="entrada" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar usuário por nome ou e-mail" aria-label="Filtrar usuário" autoFocus />
          <select className="entrada" value={papel} onChange={(e) => setPapel(e.target.value as Papel | '')} aria-label="Função">
            <option value="">Todas as funções</option>
            {(['administrador', ...PAPEIS] as Papel[]).map((p) => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}
          </select>
          <span className="pequeno suave">{filtrados.length} de {usuarios.length} usuário(s)</span>
        </div>
        {!filtrados.length ? <EstadoVazio titulo="Nenhum usuário encontrado"><p>Confira o nome ou o e-mail. Usuários novos entram por Usuários e convites.</p></EstadoVazio> : (
          <ul className="pu-usuarios">
            {filtrados.map((u) => {
              const n = Object.keys(u.permissoes).length;
              return (
                <li key={u.id}>
                  <button className={`pu-usuario${u.id === selId ? ' ativo' : ''}`} onClick={() => escolher(u.id)} aria-pressed={u.id === selId}>
                    <strong>{u.nome || u.email}</strong>
                    <span className="pequeno suave">{u.email}</span>
                    <span className="pu-tags">
                      <span className="badge">{ROTULO_PAPEL[u.papel]}</span>
                      {u.status !== 'ativo' && <span className="badge aviso">{u.status === 'pendente' ? 'Pendente' : 'Bloqueado'}</span>}
                      {n > 0 && <span className="badge info">{n} individual(is)</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="cartao pu-painel" aria-label="Permissões do usuário">
        {!sel ? (
          <EstadoVazio titulo="Escolha um usuário"><p>Filtre pelo nome ou e-mail e clique no usuário para definir o que ele pode fazer.</p></EstadoVazio>
        ) : (
          <PainelUsuario u={sel} grupos={grupos} padrao={padrao} admin={admin} euId={eu.id} pode={pode}
            mudancas={mudancas} setMudancas={setMudancas} gravando={gravando} salvar={salvar} />
        )}
      </section>
    </div>
  );
}

function PainelUsuario({ u, grupos, padrao, admin, euId, pode, mudancas, setMudancas, gravando, salvar }: {
  u: UsuarioPermissoes; grupos: Grupos; padrao: Set<string>; admin: boolean; euId: string; pode: (p: Permissao) => boolean;
  mudancas: Partial<Record<Permissao, boolean | null>>; setMudancas: (x: Partial<Record<Permissao, boolean | null>>) => void;
  gravando: boolean; salvar: () => Promise<void>;
}) {
  const ehAdmin = u.papel === 'administrador';
  const proprio = u.id === euId && !admin;
  const travado = ehAdmin || proprio;
  const nMud = Object.keys(mudancas).length;
  const escolhaDe = (c: Permissao): Escolha => {
    const v = c in mudancas ? mudancas[c] : u.permissoes[c];
    return v === true ? 'permitir' : v === false ? 'negar' : 'padrao';
  };
  const mudar = (c: Permissao, e: Escolha) => {
    const v = e === 'permitir' ? true : e === 'negar' ? false : null;
    const orig = u.permissoes[c] ?? null;
    const x = { ...mudancas };
    if (v === orig) delete x[c]; else x[c] = v;
    setMudancas(x);
  };
  return (
    <>
      <div className="cartao-cab pu-cab">
        <div>
          <h2>{u.nome || u.email}</h2>
          <span className="pequeno suave">{u.email} · {ROTULO_PAPEL[u.papel]}</span>
        </div>
        {!travado && (
          <div className="grupo-btn">
            <button className="btn" disabled={!nMud || gravando} onClick={() => setMudancas({})}>Descartar</button>
            <button className="btn primario" disabled={!nMud || gravando} onClick={() => void salvar()}>
              {gravando ? 'Salvando…' : nMud ? `Salvar ${nMud} alteração(ões)` : 'Salvar'}
            </button>
          </div>
        )}
      </div>
      <div className="cartao-corpo pu-corpo">
        {ehAdmin && <Alerta tipo="info">Administrador tem todas as permissões. Para limitar, mude a função dele em Usuários e convites.</Alerta>}
        {proprio && <Alerta tipo="aviso">Você não pode alterar as suas próprias permissões. Peça a um administrador.</Alerta>}
        {!travado && <small className="suave">“Padrão” segue a função ({ROTULO_PAPEL[u.papel]}). “Permitir” e “Negar” valem só para esta pessoa e vencem o padrão.</small>}
        {grupos.map(([g, itens]) => (
          <div key={g} className="pu-grupo">
            <h3>{g}</h3>
            {itens.map((c) => {
              const doPapel = ehAdmin || padrao.has(`${u.papel}:${c.chave}`);
              const e = escolhaDe(c.chave);
              const efetivo = ehAdmin || (e === 'padrao' ? doPapel : e === 'permitir');
              // Quem não é administrador só concede o que também tem; gestão de usuários e de permissões só o administrador concede.
              const semConceder = !admin && (SO_ADMIN.includes(c.chave) || !pode(c.chave));
              return (
                <div key={c.chave} className={`pu-item${c.chave in mudancas ? ' alterado' : ''}`}>
                  <div className="pu-desc">
                    <span>{c.descricao}</span>
                    <span className="pequeno suave">Padrão da função: {doPapel ? 'sim' : 'não'}{e !== 'padrao' ? ' · individual' : ''}</span>
                  </div>
                  <span className={`pu-efetivo ${efetivo ? 'sim' : 'nao'}`}>{efetivo ? '✓ Pode' : '✕ Não pode'}</span>
                  {!travado && (
                    <div className="segmentado pu-escolha" role="group" aria-label={c.descricao}>
                      {(['padrao', 'permitir', 'negar'] as Escolha[]).map((x) => (
                        <button key={x} type="button" className={e === x ? 'ativo' : ''} aria-pressed={e === x}
                          disabled={gravando || (x === 'permitir' && semConceder && e !== 'permitir')}
                          title={x === 'permitir' && semConceder ? 'Só o administrador concede esta permissão' : undefined}
                          onClick={() => mudar(c.chave, x)}>
                          {x === 'padrao' ? 'Padrão' : x === 'permitir' ? 'Permitir' : 'Negar'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

/** Matriz papel × permissão. Só administradores alteram. */
function PorFuncao({ m, setM, grupos }: { m: MatrizPermissoes; setM: (f: (x: MatrizPermissoes | null) => MatrizPermissoes | null) => void; grupos: Grupos }) {
  const { api, estado, atualizarSessao } = useApp();
  const avisar = useAviso();
  const [gravando, setGravando] = useState<string | null>(null);
  const admin = estado.sessao?.perfil.papel === 'administrador';
  const tem = useMemo(() => new Set(m.papeis.map((p) => `${p.papel}:${p.chave}`)), [m]);

  async function alternar(papel: Papel, chave: Permissao, permitido: boolean) {
    const k = `${papel}:${chave}`;
    setGravando(k);
    try {
      await api.salvarPermissaoPapel(papel, chave, permitido);
      setM((x) => x && { ...x, papeis: permitido ? [...x.papeis, { papel, chave }] : x.papeis.filter((p) => !(p.papel === papel && p.chave === chave)) });
      void atualizarSessao();
      avisar('ok', `${ROTULO_PAPEL[papel]}: ${permitido ? 'permitido' : 'removido'}.`);
    } catch (e) {
      avisar('erro', mensagemErro(e));
    } finally {
      setGravando(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Alerta tipo="info">
        Padrão de cada função; o que for definido por usuário vence este padrão. Administrador tem todas as permissões.
        As regras são aplicadas também no servidor.
        {!admin && ' Somente administradores alteram esta matriz.'}
      </Alerta>
      <Alerta tipo="aviso">Valores financeiros (frete, ticket, faturamento, margem) só aparecem para quem tem “Ver financeiro”. Por padrão, Gestor não tem.</Alerta>
      <div className="cartao rolagem-x">
        <table className="tabela">
          <thead><tr><th>Permissão</th>{PAPEIS.map((p) => <th key={p} style={{ textAlign: 'center' }}>{ROTULO_PAPEL[p]}</th>)}</tr></thead>
          <tbody>
            {grupos.map(([g, itens]) => [
              <tr key={g}><td colSpan={PAPEIS.length + 1} style={{ background: 'var(--cinza-50)', fontWeight: 700 }}>{g}</td></tr>,
              ...itens.map((c) => (
                <tr key={c.chave}>
                  <td>{c.descricao}<div className="pequeno suave mono">{c.chave}</div></td>
                  {PAPEIS.map((p) => {
                    const k = `${p}:${c.chave}`;
                    return (
                      <td key={p} style={{ textAlign: 'center' }}>
                        <input type="checkbox" style={{ width: 22, height: 22 }} aria-label={`${ROTULO_PAPEL[p]}: ${c.descricao}`}
                          checked={tem.has(k)} disabled={!admin || gravando === k} onChange={(e) => alternar(p, c.chave, e.target.checked)} />
                      </td>
                    );
                  })}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}
