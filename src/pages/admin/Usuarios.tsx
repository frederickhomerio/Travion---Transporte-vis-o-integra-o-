import { useEffect, useMemo, useState } from 'react';
import { Alerta, Carregando, Modal, useAviso } from '../../components/ui';
import { type Convite, type MatrizPermissoes, mensagemErro, type UsuarioAdmin } from '../../data/api';
import { useApp, useIndices } from '../../data/store';
import { nome } from '../../lib/cadastros';
import { fmtDataHora, ROTULO_PAPEL } from '../../lib/formato';
import type { CentroCusto, Papel, Permissao, StatusUsuario } from '../../types';

const PAPEIS: Papel[] = ['administrador', 'gestor', 'supervisor', 'embarcador', 'apoio', 'comercial', 'consulta'];
/** Papéis que entram no centro de custo Gerencial (acesso a todas as filiais) por padrão. */
const PAPEIS_GERENCIAL: Papel[] = ['apoio', 'comercial', 'gestor', 'administrador'];
const ROTULO_SITUACAO: Record<StatusUsuario, string> = { pendente: 'Aguardando aprovação', ativo: 'Ativo', bloqueado: 'Inativo' };

const textoEnviado = (modo: string, email: string) => (modo === 'supabase'
  ? `Convite enviado para ${email}. O link vale por 24 horas; depois disso, use Enviar por e-mail de novo.`
  : `Prévia: no app publicado, ${email} receberia agora o e-mail com o link para criar a senha.`);

export function Usuarios() {
  const { api, estado, atualizarSessao, pode } = useApp();
  const idx = useIndices();
  const avisar = useAviso();
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null);
  const [convites, setConvites] = useState<Convite[]>([]);
  const [matriz, setMatriz] = useState<MatrizPermissoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editar, setEditar] = useState<UsuarioAdmin | null>(null);
  const [convidar, setConvidar] = useState(false);
  const [acao, setAcao] = useState<{ u: UsuarioAdmin; tipo: 'inativar' | 'reativar' | 'excluir' } | null>(null);
  const eu = estado.sessao?.perfil.id;

  const carregar = () => {
    setErro(null);
    Promise.all([api.listarUsuarios(), api.listarConvites(), api.matrizPermissoes()])
      .then(([u, c, m]) => { setUsuarios(u); setConvites(c); setMatriz(m); })
      .catch((e) => setErro(mensagemErro(e)));
  };
  useEffect(carregar, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendentes = usuarios?.filter((u) => u.status === 'pendente') ?? [];
  const filiaisNomes = (ids: string[]) => ids.length ? ids.map((f) => nome(idx.filial, f)).join(', ') : 'Nenhuma';
  const centros = estado.cadastros.centros_custo;
  const centrosNomes = (ids: string[] | null) => ids?.length ? ids.map((c) => centros.find((x) => x.id === c)?.nome ?? '—').join(', ') : 'Nenhum';
  const total = (ids: string[]) => ids.some((c) => centros.find((x) => x.id === c)?.acesso_total);
  const contagem = useMemo(() => {
    const lista = [...centros].filter((c) => c.ativo || usuarios?.some((u) => u.centros.includes(c.id)))
      .sort((a, b) => Number(!!b.acesso_total) - Number(!!a.acesso_total) || a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((c) => ({ id: c.id, nome: c.nome, total: !!c.acesso_total, n: usuarios?.filter((u) => u.centros.includes(c.id)).length ?? 0 }));
    const sem = usuarios?.filter((u) => !u.centros.length).length ?? 0;
    return sem ? [...lista, { id: '-', nome: 'Sem centro de custo', total: false, n: sem }] : lista;
  }, [centros, usuarios]);

  if (erro) return <Alerta tipo="erro">{erro}</Alerta>;
  if (!usuarios || !matriz) return <Carregando />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Alerta tipo="info">
        Usuários internos entram por convite (o papel é aplicado ao criar a conta com o e-mail convidado) ou pedem acesso e aguardam aprovação.
        O acesso vale pelo centro de custo: a pessoa vê as filiais dos centros marcados, e o Gerencial dá acesso a todas. Quem pede acesso começa como Consulta, sem centro de custo.
      </Alerta>
      {pendentes.length > 0 && <Alerta tipo="aviso">{pendentes.length} pessoa(s) aguardando aprovação. Revise o papel e o centro de custo antes de aprovar.</Alerta>}

      <div className="cartao">
        <div className="cartao-cab"><h3 style={{ margin: 0 }}>Usuários por centro de custo</h3><span className="pequeno suave">{usuarios.length} usuário(s)</span></div>
        <div className="cc-contagem">
          {contagem.map((c) => (
            <div key={c.id} className={`cc-cont${c.total ? ' gerencial' : ''}${c.id === '-' ? ' sem' : ''}`} title={c.total ? 'Acesso a todas as filiais' : undefined}>
              <span className="cc-n">{c.n}</span><span className="cc-nome">{c.nome}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="cartao">
        <div className="cartao-cab"><h3 style={{ margin: 0 }}>Usuários</h3></div>
        <div className="rolagem-x">
          <table className="tabela">
            <thead><tr><th>Nome</th><th>Papel</th><th>Situação</th><th>Centro de custo</th><th>Ajustes</th><th /></tr></thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.nome}</strong><div className="pequeno suave">{u.email}{u.telefone ? ` · ${u.telefone}` : ''}</div></td>
                  <td>{ROTULO_PAPEL[u.papel]}</td>
                  <td>{u.acesso_pendente
                    ? <span className="badge aviso" title="Recebeu o convite e ainda não criou a senha nem entrou no app">Convite pendente</span>
                    : <span className={`badge ${u.status === 'ativo' ? 'liberado' : u.status === 'bloqueado' ? 'suspenso' : 'aviso'}`}>{ROTULO_SITUACAO[u.status]}</span>}</td>
                  <td>{centrosNomes(u.centros)}<div className="pequeno suave">{total(u.centros) || u.papel === 'administrador' ? 'Todas as filiais' : filiaisNomes(u.filiais)}</div></td>
                  <td className="pequeno">{Object.keys(u.permissoes).length ? `${Object.keys(u.permissoes).length} permissão(ões) individual(is)` : '—'}</td>
                  <td className="td-acao"><span style={{ display: 'inline-flex', gap: 6 }}>
                    <button className="btn peq" onClick={() => setEditar(u)}>{u.status === 'pendente' ? 'Revisar' : 'Editar'}</button>
                    {u.id !== eu && pode('usuarios.inativar') && u.status !== 'pendente' && (u.status === 'bloqueado'
                      ? <button className="btn peq" onClick={() => setAcao({ u, tipo: 'reativar' })}>Reativar</button>
                      : <button className="btn peq" onClick={() => setAcao({ u, tipo: 'inativar' })}>Inativar</button>)}
                    {u.id !== eu && pode('usuarios.excluir') && <button className="btn peq perigo" onClick={() => setAcao({ u, tipo: 'excluir' })}>Excluir</button>}
                  </span></td>
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
              <thead><tr><th>E-mail</th><th>Papel</th><th>Centro de custo</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {convites.map((c) => (
                  <tr key={c.id}>
                    <td>{c.email}{c.nome && <div className="pequeno suave">{c.nome}</div>}</td>
                    <td>{ROTULO_PAPEL[c.papel]}</td>
                    <td className="pequeno">{c.centros?.length ? centrosNomes(c.centros) : c.filiais.length ? `Filiais: ${filiaisNomes(c.filiais)}` : 'Nenhum'}</td>
                    <td className="pequeno">{c.usado_em ? `Usado em ${fmtDataHora(c.usado_em)}` : c.expira_em < new Date().toISOString() ? 'Expirado' : `Válido até ${fmtDataHora(c.expira_em)}`}</td>
                    <td className="td-acao">{!c.usado_em && <span style={{ display: 'inline-flex', gap: 6 }}>
                      {c.expira_em >= new Date().toISOString() && <button className="btn peq" onClick={async () => {
                        try { await api.enviarConviteEmail(c.email); avisar('ok', textoEnviado(api.modo, c.email)); } catch (e) { avisar('erro', mensagemErro(e)); }
                      }}>Enviar por e-mail</button>}
                      <button className="btn peq perigo" onClick={async () => {
                        try { await api.excluirConvite(c.id); avisar('ok', 'Convite excluído.'); carregar(); } catch (e) { avisar('erro', mensagemErro(e)); }
                      }}>Excluir</button>
                    </span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="cartao-corpo pequeno suave">
          {api.modo === 'supabase'
            ? 'O convite guarda a função e o centro de custo. Pelo e-mail, a pessoa recebe um link para criar a própria senha e já entra com esse acesso. Sem e-mail, mande o endereço do app e ela usa "Solicitar acesso" com o mesmo e-mail.'
            : 'Na prévia local nenhum e-mail sai daqui: o envio é só ilustrativo.'}
        </div>
      </div>

      {acao && <AcaoUsuario {...acao} aoFechar={(feito) => { setAcao(null); if (feito) carregar(); }} />}
      {editar && <EditarUsuario u={editar} matriz={matriz} aoFechar={(salvou) => {
        setEditar(null);
        if (salvou) { carregar(); if (editar.id === estado.sessao?.perfil.id) void atualizarSessao(); }
      }} />}
      {convidar && <NovoConvite aoFechar={(salvou) => { setConvidar(false); if (salvou) carregar(); }} />}
    </div>
  );
}

function SeletorCentros({ valor, aoMudar }: { valor: string[]; aoMudar: (v: string[]) => void }) {
  const { estado } = useApp();
  const filiais = estado.cadastros.filiais.filter((f) => f.ativo);
  const centros = estado.cadastros.centros_custo.filter((c) => c.ativo || valor.includes(c.id))
    .sort((a, b) => Number(!!b.acesso_total) - Number(!!a.acesso_total) || a.nome.localeCompare(b.nome, 'pt-BR'));
  return (
    <fieldset className="campo" style={{ border: 0, padding: 0, margin: 0 }}>
      <span>Centro de custo (acesso)</span>
      <div className="cc-escolha">
        {centros.map((c) => {
          const fs = filiais.filter((f) => f.centro_custo_id === c.id).map((f) => f.nome);
          return (
            <label key={c.id} className={`check cc-opcao${c.acesso_total ? ' gerencial' : ''}`}>
              <input type="checkbox" checked={valor.includes(c.id)} onChange={(e) => aoMudar(e.target.checked ? [...valor, c.id] : valor.filter((x) => x !== c.id))} />
              <span><strong>{c.nome}</strong><small>{c.acesso_total ? 'Acesso a todas as filiais' : fs.length ? fs.join(', ') : 'Sem filiais ligadas'}</small></span>
            </label>
          );
        })}
      </div>
      <small>As filiais vêm do centro de custo: ao mudar uma filial de centro em Cadastros, o acesso acompanha.</small>
    </fieldset>
  );
}

/** Ao trocar o papel: Apoio, Coordenador, Gestor e Administrador entram no Gerencial; os demais saem dele. */
function centrosDoPapel(papel: Papel, atuais: string[], centros: CentroCusto[]) {
  const ger = centros.filter((c) => c.acesso_total).map((c) => c.id);
  if (PAPEIS_GERENCIAL.includes(papel)) return ger.length ? ger : atuais;
  return atuais.filter((x) => !ger.includes(x));
}

function EditarUsuario({ u, matriz, aoFechar }: { u: UsuarioAdmin; matriz: MatrizPermissoes; aoFechar: (salvou: boolean) => void }) {
  const { api, estado, pode } = useApp();
  const avisar = useAviso();
  const [d, setD] = useState({ nome: u.nome, telefone: u.telefone ?? '', papel: u.papel, status: u.status === 'pendente' ? 'ativo' as StatusUsuario : u.status, centros: u.centros });
  const [perm, setPerm] = useState<Record<string, boolean | null>>({ ...u.permissoes });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const proprio = u.id === estado.sessao?.perfil.id;
  const [novoEmail, setNovoEmail] = useState<{ valor: string; salvando: boolean } | null>(null);

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
        nome: d.nome.trim(), telefone: d.telefone.trim() || null, papel: d.papel, status: d.status, centros: d.centros,
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
      <button className="btn primario" disabled={salvando || !d.nome.trim() || (!d.centros.length && d.papel !== 'administrador')} onClick={salvar}>{salvando ? 'Salvando…' : u.status === 'pendente' && d.status === 'ativo' ? 'Aprovar' : 'Salvar'}</button>
    </>}>
      <div className="pequeno suave" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{u.email}</span>
        {u.email && !novoEmail && <button type="button" className="btn sutil peq" onClick={() => setNovoEmail({ valor: u.email ?? '', salvando: false })}>Alterar e-mail</button>}
        {u.status !== 'pendente' && u.email && !novoEmail && <button type="button" className="btn sutil peq" onClick={async () => {
          try {
            await api.enviarLinkSenha(u.email!);
            avisar('ok', api.modo === 'supabase' ? `Link de troca de senha enviado para ${u.email}.` : `Prévia: no app publicado, ${u.email} receberia o link de troca de senha.`);
          } catch (e) { avisar('erro', mensagemErro(e)); }
        }}>Enviar link para trocar a senha</button>}
      </div>
      {novoEmail && (
        <div className="cartao" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="campo"><span>Novo e-mail de entrada</span>
            <input className="entrada" type="email" value={novoEmail.valor} autoFocus onChange={(e) => setNovoEmail({ ...novoEmail, valor: e.target.value })} />
          </label>
          <span className="pequeno suave">A senha, a função, o centro de custo e o histórico continuam os mesmos. A pessoa passa a entrar com o e-mail novo.</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn primario peq" disabled={novoEmail.salvando || !novoEmail.valor.trim()} onClick={async () => {
              setNovoEmail({ ...novoEmail, salvando: true });
              try {
                await api.alterarEmailUsuario(u.id, novoEmail.valor);
                avisar('ok', `E-mail alterado. ${u.nome || 'A pessoa'} passa a entrar com ${novoEmail.valor.trim().toLowerCase()}.`);
                aoFechar(true);
              } catch (e) { avisar('erro', mensagemErro(e)); setNovoEmail({ ...novoEmail, salvando: false }); }
            }}>{novoEmail.salvando ? 'Salvando…' : 'Salvar e-mail'}</button>
            <button type="button" className="btn sutil peq" onClick={() => setNovoEmail(null)}>Cancelar</button>
          </div>
        </div>
      )}
      <div className="grade-campos">
        <label className="campo"><span>Nome</span><input className="entrada" value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} /></label>
        <label className="campo"><span>Telefone</span><input className="entrada" type="tel" inputMode="tel" maxLength={40} placeholder="(64) 99999-0000" value={d.telefone} onChange={(e) => setD({ ...d, telefone: e.target.value })} /></label>
        <label className="campo"><span>Papel</span>
          <select className="entrada" value={d.papel} onChange={(e) => { const papel = e.target.value as Papel; setD({ ...d, papel, centros: centrosDoPapel(papel, d.centros, estado.cadastros.centros_custo) }); }}>
            {PAPEIS.map((p) => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}
          </select>
        </label>
        <label className="campo"><span>Situação</span>
          <select className="entrada" value={d.status} disabled={proprio} onChange={(e) => setD({ ...d, status: e.target.value as StatusUsuario })}>
            <option value="ativo">Ativo</option><option value="pendente">Aguardando aprovação</option>
            {(pode('usuarios.inativar') || u.status === 'bloqueado') && <option value="bloqueado">Inativo</option>}
          </select>
          {proprio && <small>Você não pode bloquear o próprio acesso.</small>}
        </label>
      </div>
      <SeletorCentros valor={d.centros} aoMudar={(c) => setD({ ...d, centros: c })} />
      {d.papel === 'administrador' ? <Alerta tipo="info">Administradores veem todas as filiais e têm todas as permissões.</Alerta> : (
        <>
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

/** Confirmação de inativar, reativar ou excluir (sem caixa do navegador). */
function AcaoUsuario({ u, tipo, aoFechar }: { u: UsuarioAdmin; tipo: 'inativar' | 'reativar' | 'excluir'; aoFechar: (feito: boolean) => void }) {
  const { api } = useApp();
  const avisar = useAviso();
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const titulo = { inativar: 'Inativar usuário', reativar: 'Reativar usuário', excluir: 'Excluir usuário' }[tipo];
  async function confirmar() {
    setSalvando(true); setErro(null);
    try {
      if (tipo === 'excluir') await api.excluirUsuario(u.id);
      else await api.atualizarUsuario(u.id, { status: tipo === 'inativar' ? 'bloqueado' : 'ativo' });
      avisar('ok', tipo === 'excluir' ? `${u.nome || u.email} foi excluído.` : tipo === 'inativar' ? `${u.nome || u.email} foi inativado e não entra mais no app.` : `${u.nome || u.email} foi reativado.`);
      aoFechar(true);
    } catch (e) { setErro(mensagemErro(e)); } finally { setSalvando(false); }
  }
  return (
    <Modal titulo={titulo} aoFechar={() => aoFechar(false)} rodape={<>
      <button className="btn" onClick={() => aoFechar(false)}>Cancelar</button>
      <button className={`btn ${tipo === 'reativar' ? 'primario' : 'perigo'}`} disabled={salvando} onClick={confirmar}>{salvando ? 'Salvando…' : titulo.split(' ')[0]}</button>
    </>}>
      <p style={{ margin: 0 }}><strong>{u.nome || u.email}</strong> · {u.email}</p>
      {tipo === 'inativar' && <p className="suave" style={{ margin: 0 }}>A pessoa deixa de entrar no app na hora. Tudo o que ela fez continua no histórico, e você pode reativar depois.</p>}
      {tipo === 'reativar' && <p className="suave" style={{ margin: 0 }}>A pessoa volta a entrar com a mesma função, centro de custo e senha.</p>}
      {tipo === 'excluir' && <p className="suave" style={{ margin: 0 }}>Apaga o usuário de vez, sem volta. Só é possível para quem ainda não registrou nada no app; quem já tem embarques, demandas ou histórico deve ser inativado, para não perder quem fez o quê.</p>}
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}

function NovoConvite({ aoFechar }: { aoFechar: (salvou: boolean) => void }) {
  const { api, estado } = useApp();
  const avisar = useAviso();
  const [d, setD] = useState(() => ({ email: '', nome: '', telefone: '', papel: 'apoio' as Papel, centros: centrosDoPapel('apoio', [], estado.cadastros.centros_custo) }));
  const [enviar, setEnviar] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const email = d.email.trim();
      await api.criarConvite({ email, nome: d.nome.trim() || undefined, telefone: d.telefone.trim() || null, papel: d.papel, centros: d.centros });
      if (enviar) {
        try { await api.enviarConviteEmail(email.toLowerCase()); avisar('ok', textoEnviado(api.modo, email)); }
        catch (e) { avisar('erro', `Convite registrado, mas o e-mail não saiu: ${mensagemErro(e)} Tente de novo em Convites → Enviar por e-mail.`); }
      } else avisar('ok', 'Convite registrado.');
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
      <button className="btn primario" disabled={salvando || !d.email.trim() || (!d.centros.length && d.papel !== 'administrador')} onClick={salvar}>{salvando ? 'Salvando…' : enviar ? 'Registrar e enviar' : 'Registrar convite'}</button>
    </>}>
      <div className="grade-campos">
        <label className="campo"><span>E-mail *</span><input className="entrada" type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></label>
        <label className="campo"><span>Nome</span><input className="entrada" value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} /></label>
        <label className="campo"><span>Telefone</span><input className="entrada" type="tel" inputMode="tel" maxLength={40} placeholder="(64) 99999-0000" value={d.telefone} onChange={(e) => setD({ ...d, telefone: e.target.value })} /></label>
        <label className="campo"><span>Papel</span>
          <select className="entrada" value={d.papel} onChange={(e) => { const papel = e.target.value as Papel; setD({ ...d, papel, centros: centrosDoPapel(papel, d.centros, estado.cadastros.centros_custo) }); }}>
            {PAPEIS.map((p) => <option key={p} value={p}>{ROTULO_PAPEL[p]}</option>)}
          </select>
        </label>
      </div>
      <SeletorCentros valor={d.centros} aoMudar={(c) => setD({ ...d, centros: c })} />
      <label className="check"><input type="checkbox" checked={enviar} onChange={(e) => setEnviar(e.target.checked)} />
        Enviar o convite por e-mail agora (a pessoa recebe o link para criar a senha)</label>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}
