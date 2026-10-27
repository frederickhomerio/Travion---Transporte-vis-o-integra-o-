import { type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { PERFIS_PREVIA } from '../data/localApi';
import { useApp } from '../data/store';
import { ROTULO_PAPEL } from '../lib/formato';
import { Icone, Logo } from './ui';

const ROTULO_CONEXAO = {
  conectando: 'Conectando…',
  conectado: 'Tempo real ativo',
  reconectando: 'Reconectando…',
  offline: 'Sem conexão',
};

export function Layout({ titulo, acoes, children }: { titulo: string; acoes?: ReactNode; children: ReactNode }) {
  const { api, estado, pode, definirDemo } = useApp();
  const nav = useNavigate();
  const s = estado.sessao!;
  const admin = (['usuarios.gerenciar', 'cadastros.gerenciar', 'configuracoes.gerenciar', 'importacao.executar'] as const).some(pode);

  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca"><Logo /><div>Travion<small>Transpanorama</small></div></div>
        <nav className="nav" aria-label="Principal">
          <NavLink to="/" end><Icone nome="lista" />Lista de Fretes</NavLink>
          <NavLink to="/dashboard"><Icone nome="painel" />Dashboard Operacional</NavLink>
          <NavLink to="/posicoes"><Icone nome="cliente" />Posições de Embarque</NavLink>
          <div className="grupo">Em breve</div>
          <span className="em-breve" aria-disabled="true"><span style={{ display: 'flex', gap: 10 }}><Icone nome="analise" />Análise</span><span className="badge info">Em breve</span></span>
          <span className="em-breve" aria-disabled="true"><span style={{ display: 'flex', gap: 10 }}><Icone nome="posicao" />Posição</span><span className="badge info">Em breve</span></span>
          {admin && <><div className="grupo">Gestão</div><NavLink to="/admin"><Icone nome="config" />Administração</NavLink></>}
        </nav>
        <div className="lateral-rodape">
          <div className="nome">{s.perfil.nome || s.perfil.email}</div>
          <div style={{ color: '#9fb4e6' }}>{ROTULO_PAPEL[s.perfil.papel]}</div>
          <button className="btn sutil peq" style={{ color: '#dbe5ff', paddingLeft: 0, marginTop: 6 }} onClick={() => { void api.sair(); nav('/login'); }}>
            <Icone nome="sair" tam={16} />Sair
          </button>
        </div>
      </aside>

      <div className="principal">
        {api.modo === 'local' && <FaixaPrevia />}
        {api.modo === 'supabase' && estado.demo && (
          <div className="faixa-demo" role="status">
            <span>MODO DEMONSTRAÇÃO — dados fictícios, separados da produção.</span>
            <button className="btn peq" onClick={() => definirDemo(false)}>Voltar para produção</button>
          </div>
        )}
        <header className="topo">
          <span className="so-celular"><Logo tam={26} /></span>
          <h1>{titulo}</h1>
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
        <NavLink to="/dashboard"><Icone nome="painel" />Dashboard</NavLink>
        <NavLink to="/posicoes"><Icone nome="cliente" />Posições</NavLink>
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
