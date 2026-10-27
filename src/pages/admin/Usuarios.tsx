import { useEffect, useMemo, useState } from 'react';
import { Alerta, Carregando, Modal, useAviso } from '../../components/ui';
import { type Convite, type MatrizPermissoes, mensagemErro, type UsuarioAdmin } from '../../data/api';
import { useApp, useIndices } from '../../data/store';
import { nome } from '../../lib/cadastros';
import { fmtDataHora, ROTULO_PAPEL } from '../../lib/formato';
import type { Papel, Permissao, StatusUsuario } from '../../types';

const PAPEIS: Papel[] = ['administrador', 'gestor', 'supervisor', 'embarcador', 'apoio', 'operacao', 'comercial', 'consulta'];
const ROTULO_SITUACAO: Record<StatusUsuario, string> = { pendente: 'Aguardando aprovação', ativo: 'Ativo', bloqueado: 'Bloqueado' };

export function Usuarios() {
  const { api, estado, atualizarSessao } = useApp();
  const idx = useIndices();
  const avisar = useAviso();
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null);
  const [convites, setConvites] = useState<Convite[]>([]);
  const [matriz, setMatriz] = useState<MatrizPermissoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editar, setEditar] = useState<UsuarioAdmin | null>(null);
  const [convidar, setConvidar] = useState(false);

  const carregar = () => {
    setErro(null);
    Promise.all([api.listarUsuarios(), api.listarConvites(), api.matrizPermissoes()])
      .then(([u, c, m]) => { setUsuarios(u); setConvites(c); setMatriz(m); })
      .catch((e) => setErro(mensagemErro(e)));
  };
  useEffect(carregar, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendentes = usuarios?.filter((u) => u.status === 'pendente') ?? [];
  const filiaisNomes = (ids: string[]) => ids.length ? ids.map((f) => nome(idx.filial, f)).join(', ') : 'Nenhuma';

  if (erro) return <Alerta tipo="erro">{erro}</Alerta>;
  if (!usuarios || !matriz) return <Carregando />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alerta tipo="info">
        Usuários internos entram por convite (o papel é aplicado ao criar a conta com o e-mail convidado) ou pedem acesso e aguardam aprovação.
        Quem pede acesso começa como Consulta, sem filiais.
      </Alerta>
      {pendentes.length > 0 && <Alerta tipo="aviso">{pendentes.length} pessoa(s) aguardando aprovação. Revise o papel e as filiais antes de aprovar.</Alerta>}

      <div className="cartao">
        <div className="cartao-cab"><h3 style={{ margin: 0 }}>Usuários</h3></div>
        <div className="rolagem-x">
          <table className="tabela">
            <thead><tr><th>Nome</th><th>Papel</th><th>Situação</th><th>Filiais</th><th>Carteira</th><th>Ajustes</th><th /></tr></thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.nome}</strong><div className="pequeno suave">{u.email}</div></td>
                  <td>{ROTULO_PAPEL[u.papel]}</td>
                  <td><span className={`badge ${u.status === 'ativo' ? 'liberado' : u.status === 'bloqueado' ? 'suspenso' : 'aviso'}`}>{ROTULO_SITUACAO[u.status]}</span></td>
                  <td className="pequeno">{u.papel === 'administrador' ? 'Todas' : filiaisNomes(u.filiais)}</td>
                  <td className="pequeno">{nome(idx.comercial, u.comercial_id, '—')}</td>
                  <td className="pequeno">{Object.keys(u.permissoes).length ? `${Object.keys(u.permissoes).length} permissão(ões) individual(is)` : '—'}</td>
                  <td className="td-acao"><button className="btn peq" onClick={() => setEditar(u)}>{u.status === 'pendente' ? 'Revisar' : 'Editar'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cartao">
        <div className="cartao-cab"><h3 style={{ margin: 0 }}>Convites</h3><button className="btn primario peq" onClick={() => setConvidar(true)}>Novo convite</button></div>
        {convites.length === 0 ? <div className="cartao-corpo suave">Nenhum convite.</div> : (
          <div className="rolagem-x">
            <table className="tabela">
              <thead><tr><th>E-mail</th><th>Papel</th><th>Filiais</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {convites.map((c) => (
                  <tr key={c.id}>
                    <td>{c.email}{c.nome && <div className="pequeno suave">{c.nome}</div>}</td>
                    <td>{ROTULO_PAPEL[c.papel]}</td>
                    <td className="pequeno">{filiaisNomes(c.filiais)}</td>
                    <td className="pequeno">{c.usado_em ? `Usado em ${fmtDataHora(c.usado_em)}` : c.expira_em < new Date().toISOString() ? 'Expirado' : `Válido até ${fmtDataHora(c.expira_em)}`}</td>
                    <td className="td-acao">{!c.usado_em && <button className="btn peq perigo" onClick={async () => {
                      try { await api.excluirConvite(c.id); avisar('ok', 'Convite excluído.'); carregar(); } catch (e) { avisar('erro', mensagemErro(e)); }
                    }}>Excluir</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="cartao-corpo pequeno suave">
          {api.modo === 'supabase'
            ? 'O convite registra o papel. Envie à pessoa o endereço do app para ela criar a conta com este e-mail (o app não envia e-mails de convite).'
            : 'Na prévia local o convite é só ilustrativo.'}
        </div>
      </div>

      {editar && <EditarUsuario u={editar} matriz={matriz} aoFechar={(salvou) => {
        setEditar(null);
        if (salvou) { carregar(); if (editar.id === estado.sessao?.perfil.id) void atualizarSessao(); }
      }} />}
      {convidar && <NovoConvite aoFechar={(salvou) => { setConvidar(false); if (salvou) carregar(); }} />}
    </div>
  );
}

function SeletorFiliais({ valor, aoMudar }: { valor: string[]; aoMudar: (v: string[]) => void }) {
  const { estado } = useApp();
  return (
    <fieldset className="campo" style={{ border: 0, padding: 0, margin: 0 }}>
      <span>Filiais autorizadas</span>
      <div className="grupo-btn">
        {estado.cadastros.filiais.filter((f) => f.ativo).map((f) => (
          <label key={f.id} className="check"><input type="checkbox" checked={valor.includes(f.id)}
            onChange={(e) => aoMudar(e.target.checked ? [...valor, f.id] : valor.filter((x) => x !== f.id))} />{f.nome}</label>
        ))}
      </div>
    </fieldset>
  );
}

function EditarUsuario({ u, matriz, aoFechar }: { u: UsuarioAdmin; matriz: MatrizPermissoes; aoFechar: (salvou: boolean) => void }) {
  const { api, estado } = useApp();
  const avisar = useAviso();
  const [d, setD] = useState({ nome: u.nome, papel: u.papel, status: u.status === 'pendente' ? 'ativo' as StatusUsuario : u.status, comercial_id: u.comercial_id ?? '', filiais: u.filiais });
  const [perm, setPerm] = useState<Record<string, boolean | null>>({ ...u.permissoes });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const proprio = u.id === estado.sessao?.perfil.id;

  const doPapel = useMemo(() => new Set(matriz.papeis.filter((p) => p.papel === d.papel).map((p) => p.chave)), [matriz, d.papel]);
  const grupos = useMemo(() => {
    const g = new Map<string, MatrizPermissoes['catalogo']>();
    for (const c of matriz.catalogo) g.set(c.grupo, [...(g.get(c.grupo) ?? []), c]);
    return [...g.entries()];
  }, [matriz]);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const mudou: Record<string, boolean | null> = {};
      for (const c of matriz.catalogo) {
        const antes = u.permissoes[c.chave] ?? null;
        const depois = perm[c.chave] ?? null;
        if (antes !== depois) mudou[c.chave] = depois;
      }
      await api.atualizarUsuario(u.id, {
        nome: d.nome.trim(), papel: d.papel, status: d.status, comercial_id: d.comercial_id || null, filiais: d.filiais,
        ...(Object.keys(mudou).length ? { permissoes: mudou } : {}),
      });
      avisar('ok', 'Usuário atualizado.');
      aoFechar(true);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={u.status === 'pendente' ? 'Aprovar acesso' : 'Editar usuário'} aoFechar={() => aoFechar(false)} rodape={<>
      <button className="btn" onClick={() => aoFechar(false)}>Cancelar</button>
      <button className="btn primario" disabled={salvando || !d.nome.trim()} onClick={salvar}>{salvando ? 'Salvando…' : u.status === 'pendente' && d.status === 'ativo' ? 'Aprovar' : 'Salvar'}</button>
    </>}>
      <div className="pequeno suave">{u.email}</div>
      <div className="grade-campos">
        <label className="campo"><span>Nome</span><input className="entrada" value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} /></label>
        <label className="campo"><span>Papel</span>
          <select className="entrada" value={d.papel} onChange={(e) => setD({ ...d, papel: e.target.value as Papel })}>
            {PAPEIS.map((p) => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}
          </select>
        </label>
        <label className="campo"><span>Situação</span>
          <select className="entrada" value={d.status} disabled={proprio} onChange={(e) => setD({ ...d, status: e.target.value as StatusUsuario })}>
            <option value="ativo">Ativo</option><option value="pendente">Aguardando aprovação</option><option value="bloqueado">Bloqueado</option>
          </select>
          {proprio && <small>Você não pode bloquear o próprio acesso.</small>}
        </label>
        <label className="campo"><span>Carteira (comercial vinculado)</span>
          <select className="entrada" value={d.comercial_id} onChange={(e) => setD({ ...d, comercial_id: e.target.value })}>
            <option value="">Nenhuma</option>
            {estado.cadastros.comerciais.filter((c) => c.ativo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <small>O usuário vê os embarques desta carteira, além das filiais marcadas.</small>
        </label>
      </div>
      {d.papel === 'administrador' ? <Alerta tipo="info">Administradores veem todas as filiais e têm todas as permissões.</Alerta> : (
        <>
          <SeletorFiliais valor={d.filiais} aoMudar={(f) => setD({ ...d, filiais: f })} />
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Permissões individuais (exceções ao papel)</summary>
            <p className="pequeno suave">“Padrão do papel” segue a matriz de permissões. Use “Permitir” ou “Negar” só para exceções; elas ficam registradas no histórico.</p>
            {grupos.map(([g, itens]) => (
              <div key={g} style={{ marginBottom: 8 }}>
                <div className="pequeno" style={{ fontWeight: 700, textTransform: 'uppercase', color: 'var(--cinza-600)' }}>{g}</div>
                {itens.map((c) => (
                  <label key={c.chave} className="campo" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--cinza-200)' }}>
                    <span style={{ fontWeight: 400 }}>{c.descricao}</span>
                    <select className="entrada" style={{ width: 'auto', minWidth: 170 }} value={perm[c.chave] === true ? 'sim' : perm[c.chave] === false ? 'nao' : ''}
                      onChange={(e) => setPerm({ ...perm, [c.chave]: e.target.value === 'sim' ? true : e.target.value === 'nao' ? false : null })}>
                      <option value="">Padrão ({doPapel.has(c.chave as Permissao) ? 'sim' : 'não'})</option>
                      <option value="sim">Permitir</option>
                      <option value="nao">Negar</option>
                    </select>
                  </label>
                ))}
              </div>
            ))}
          </details>
        </>
      )}
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}

function NovoConvite({ aoFechar }: { aoFechar: (salvou: boolean) => void }) {
  const { api, estado } = useApp();
  const avisar = useAviso();
  const [d, setD] = useState({ email: '', nome: '', papel: 'operacao' as Papel, comercial_id: '', filiais: [] as string[] });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      await api.criarConvite({ email: d.email.trim(), nome: d.nome.trim() || undefined, papel: d.papel, comercial_id: d.comercial_id || null, filiais: d.filiais });
      avisar('ok', 'Convite registrado.');
      aoFechar(true);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Modal titulo="Novo convite" aoFechar={() => aoFechar(false)} rodape={<>
      <button className="btn" onClick={() => aoFechar(false)}>Cancelar</button>
      <button className="btn primario" disabled={salvando || !d.email.trim()} onClick={salvar}>{salvando ? 'Salvando…' : 'Registrar convite'}</button>
    </>}>
      <div className="grade-campos">
        <label className="campo"><span>E-mail *</span><input className="entrada" type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></label>
        <label className="campo"><span>Nome</span><input className="entrada" value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} /></label>
        <label className="campo"><span>Papel</span>
          <select className="entrada" value={d.papel} onChange={(e) => setD({ ...d, papel: e.target.value as Papel })}>
            {PAPEIS.map((p) => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}
          </select>
        </label>
        <label className="campo"><span>Carteira</span>
          <select className="entrada" value={d.comercial_id} onChange={(e) => setD({ ...d, comercial_id: e.target.value })}>
            <option value="">Nenhuma</option>
            {estado.cadastros.comerciais.filter((c) => c.ativo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
      </div>
      {d.papel !== 'administrador' && <SeletorFiliais valor={d.filiais} aoMudar={(f) => setD({ ...d, filiais: f })} />}
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}
