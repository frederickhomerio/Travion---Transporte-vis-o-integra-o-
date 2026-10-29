import { type ReactNode, useEffect, useState } from 'react';
import { NavLink, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { PERFIS_PREVIA } from '../data/localApi';
import { useApp } from '../data/store';
import { ROTULO_PAPEL } from '../lib/formato';
import { NovaVersao } from './NovaVersao';
import { Sino } from './doc/Sino';
import { Icone, Logo } from './ui';

const CHAVE_MENU = 'travion-menu-recolhido';

/** Item do menu lateral: com o menu recolhido fica só o ícone, e o nome aparece na dica. */
function Item({ to, end, icone, rotulo, recolhido }: { to: string; end?: boolean; icone: string; rotulo: string; recolhido: boolean }) {
  return (
    <NavLink to={to} end={end} title={recolhido ? rotulo : undefined} aria-label={recolhido ? rotulo : undefined}>
      <Icone nome={icone} /><span className="rotulo">{rotulo}</span>
    </NavLink>
  );
}

interface ItemMenu { to: string; end?: boolean; icone: string; rotulo: string }
interface GrupoMenu { id: string; rotulo: string; icone: string; itens: ItemMenu[] }

/** Módulos em 3 blocos (menu lateral e barra do celular), só com o que a pessoa pode abrir. */
function useGrupos(admin: boolean): GrupoMenu[] {
  const { pode } = useApp();
  const se = (ok: boolean, i: ItemMenu) => (ok ? [i] : []);
  return [
    { id: 'embarques', rotulo: 'Embarques', icone: 'caminhao', itens: [
      { to: '/', end: true, icone: 'lista', rotulo: 'Lista de Fretes' },
      ...se(pode('posicoes.pagina'), { to: '/posicoes', icone: 'caminhao', rotulo: 'Posições de Embarque' }),
      ...se(pode('cadastro.solicitar') || pode('cadastro.ver'), { to: '/cadastro', icone: 'cadastro', rotulo: 'Cadastro' }),
      ...se(pode('estadia.solicitar') || pode('estadia.ver'), { to: '/estadia', icone: 'relogio', rotulo: 'Estadia' }),
      { to: '/analise', end: true, icone: 'painel', rotulo: 'Dashboard Embarques' },
    ] },
    { id: 'apoio', rotulo: 'Apoio Operacional', icone: 'analise', itens: [
      ...se(pode('apoio.pagina'), { to: '/apoio', icone: 'lista', rotulo: 'Apoio Operacional' }),
      ...se(pode('analise.operacional'), { to: '/analise/operacional', icone: 'analise', rotulo: 'Painel Operacional' }),
    ] },
    { id: 'gestao', rotulo: 'Gestão', icone: 'config', itens: [
      ...se(pode('compartilhamento.preparar'), { to: '/posicao-cliente', icone: 'cliente', rotulo: 'Posição do Cliente' }),
      ...se(admin, { to: '/admin', icone: 'config', rotulo: 'Administração' }),
    ] },
  ].filter((g) => g.itens.length);
}

/** Celular: 3 botões; cada um abre para cima os módulos do bloco, no mesmo desenho da barra. */
function BarraCelular({ grupos }: { grupos: GrupoMenu[] }) {
  const { pathname } = useLocation();
  const [aberto, setAberto] = useState<string | null>(null);
  useEffect(() => setAberto(null), [pathname]);
  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aberto]);
  const ativo = (i: ItemMenu) => !!matchPath({ path: i.to, end: i.end ?? false }, pathname);
  // Gestão também leva à conta (dados, modo demonstração e Sair).
  const comConta = grupos.map((g) => (g.id === 'gestao' ? { ...g, itens: [...g.itens, { to: '/mais', icone: 'cliente', rotulo: 'Minha conta' }] } : g));
  if (!comConta.some((g) => g.id === 'gestao')) comConta.push({ id: 'gestao', rotulo: 'Gestão', icone: 'config', itens: [{ to: '/mais', icone: 'cliente', rotulo: 'Minha conta' }] });
  const g = comConta.find((x) => x.id === aberto);
  return (
    <>
      {g && <div className="navinf-fundo" onClick={() => setAberto(null)} aria-hidden="true" />}
      {g && (
        <div className="navinf-folha" role="menu" aria-label={g.rotulo} style={{ ['--n' as string]: Math.min(g.itens.length, 3) }}>
          {g.itens.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} role="menuitem" onClick={() => setAberto(null)}><Icone nome={i.icone} />{i.rotulo}</NavLink>
          ))}
        </div>
      )}
      <nav className="navinf" aria-label="Principal (celular)">
        {comConta.map((x) => (
          <button key={x.id} type="button" aria-expanded={aberto === x.id} aria-haspopup="menu"
            className={[x.itens.some(ativo) ? 'ativo' : '', aberto === x.id ? 'aberto' : ''].join(' ').trim() || undefined}
            onClick={() => setAberto(aberto === x.id ? null : x.id)}>
            <Icone nome={x.icone} />{x.rotulo}
          </button>
        ))}
      </nav>
    </>
  );
}

const ROTULO_CONEXAO = {
  conectando: 'Conectando…',
  conectado: 'Tempo real ativo',
  reconectando: 'Reconectando…',
  offline: 'Sem conexão',
};

export function Layout({ titulo, aoLadoTitulo, acoes, children }: { titulo: string; aoLadoTitulo?: ReactNode; acoes?: ReactNode; children: ReactNode }) {
  const { api, estado, pode, definirDemo } = useApp();
  const nav = useNavigate();
  const s = estado.sessao!;
  const admin = (['usuarios.gerenciar', 'permissoes.gerenciar', 'cadastros.gerenciar', 'configuracoes.gerenciar', 'importacao.executar'] as const).some(pode);
  const [recolhido, setRecolhido] = useState(() => { try { return localStorage.getItem(CHAVE_MENU) === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem(CHAVE_MENU, recolhido ? '1' : '0'); } catch { /* preferência local */ } }, [recolhido]);
  const r = recolhido;
  const grupos = useGrupos(admin);

  return (
    <div className={`app${r ? ' menu-recolhido' : ''}`}>
      <aside className="lateral">
        <div className="marca"><Logo /><div className="rotulo">TRAVION<small>by Transpanorama</small></div></div>
        <button type="button" className="lateral-alternar" onClick={() => setRecolhido(!r)}
          aria-label={r ? 'Expandir menu' : 'Recolher menu'} title={r ? 'Expandir menu' : 'Recolher menu'} aria-expanded={!r}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={r ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
          </svg>
        </button>
        <nav className="nav" aria-label="Principal">
          {grupos.map((g) => (
            <div key={g.id} className="nav-bloco">
              <div className="grupo"><span className="rotulo">{g.rotulo}</span></div>
              {g.itens.map((i) => <Item key={i.to} to={i.to} end={i.end} icone={i.icone} rotulo={i.rotulo} recolhido={r} />)}
            </div>
          ))}
        </nav>
        <div className="lateral-rodape">
          <div className="rotulo">
            <div className="nome">{s.perfil.nome || s.perfil.email}</div>
            <div style={{ color: 'var(--dourado-claro)' }}>{ROTULO_PAPEL[s.perfil.papel]}</div>
          </div>
          <button className="btn sutil peq lateral-sair" style={{ color: '#f3e6e8', paddingLeft: 0, marginTop: 6 }} title={r ? 'Sair' : undefined}
            aria-label={r ? 'Sair' : undefined} onClick={() => { void api.sair(); nav('/login'); }}>
            <Icone nome="sair" tam={16} /><span className="rotulo">Sair</span>
          </button>
        </div>
      </aside>

      <div className="principal">
        <NovaVersao />
        {api.modo === 'local' && <FaixaPrevia />}
        {api.modo === 'supabase' && estado.demo && (
          <div className="faixa-demo" role="status">
            <span>MODO DEMONSTRAÇÃO — dados fictícios, separados da produção.</span>
            <button className="btn peq" onClick={() => definirDemo(false)}>Voltar para produção</button>
          </div>
        )}
        <header className="topo">
          <span className="so-celular"><Logo tam={26} /></span>
          {aoLadoTitulo ? <div className="topo-titulo"><h1>{titulo}</h1>{aoLadoTitulo}</div> : <h1>{titulo}</h1>}
          <Sino />
          <span className={`conexao ${estado.conexao}`} title="Estado da conexão com o servidor">{ROTULO_CONEXAO[estado.conexao]}</span>
          {acoes}
        </header>
        {estado.conexao === 'offline' && (
          <div className="alerta erro" style={{ borderRadius: 0 }} role="alert">
            <strong>Sem conexão.</strong> Alterações não serão salvas até a conexão voltar. Os valores na tela podem estar desatualizados.
          </div>
        )}
        <main className="conteudo">{children}</main>
      </div>

      <BarraCelular grupos={grupos} />
    </div>
  );
}

function FaixaPrevia() {
  const { api, estado } = useApp();
  return (
    <div className="faixa-demo" role="status">
      <span>PRÉVIA LOCAL — sem servidor. Dados fictícios salvos só neste navegador.</span>
      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        Simular perfil:
        <select value={estado.sessao?.perfil.email ?? ''} onChange={(e) => void api.entrar(e.target.value, '')}>
          {[...new Set(PERFIS_PREVIA.map((p) => p.papel))].map((papel) => (
            <optgroup key={papel} label={ROTULO_PAPEL[papel]}>
              {PERFIS_PREVIA.filter((p) => p.papel === papel).map((p) => <option key={p.email} value={p.email}>{p.rotulo}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  );
}
