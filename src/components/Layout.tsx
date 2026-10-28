import { type ReactNode, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
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
          <Item to="/" end icone="lista" rotulo="Lista de Fretes" recolhido={r} />
          {pode('posicoes.pagina') && <Item to="/posicoes" icone="caminhao" rotulo="Posições de Embarque" recolhido={r} />}
          {pode('compartilhamento.preparar') && <Item to="/posicao-cliente" icone="cliente" rotulo="Posição do Cliente" recolhido={r} />}
          {pode('apoio.pagina') && <Item to="/apoio" icone="lista" rotulo="Apoio Operacional" recolhido={r} />}
          {(pode('cadastro.solicitar') || pode('cadastro.ver')) && <Item to="/cadastro" icone="cadastro" rotulo="Cadastro" recolhido={r} />}
          <div className="grupo"><span className="rotulo">Análise</span></div>
          <Item to="/analise" end icone="painel" rotulo="Dashboard Operacional" recolhido={r} />
          {pode('analise.operacional') && <Item to="/analise/operacional" icone="analise" rotulo="Painel Operacional" recolhido={r} />}
          {admin && <><div className="grupo"><span className="rotulo">Gestão</span></div><Item to="/admin" icone="config" rotulo="Administração" recolhido={r} /></>}
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

      <nav className="navinf" aria-label="Principal (celular)">
        <NavLink to="/" end><Icone nome="lista" />Fretes</NavLink>
        <NavLink to="/analise"><Icone nome="analise" />Análise</NavLink>
        {pode('posicoes.pagina') && <NavLink to="/posicoes"><Icone nome="caminhao" />Posições</NavLink>}
        {pode('apoio.pagina') && <NavLink to="/apoio"><Icone nome="lista" />Apoio</NavLink>}
        {(pode('cadastro.solicitar') || pode('cadastro.ver')) && <NavLink to="/cadastro"><Icone nome="cadastro" />Cadastro</NavLink>}
        <NavLink to="/mais"><Icone nome="config" />Mais</NavLink>
      </nav>
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
          {PERFIS_PREVIA.map((p) => <option key={p.email} value={p.email}>{p.rotulo}</option>)}
        </select>
      </label>
    </div>
  );
}
