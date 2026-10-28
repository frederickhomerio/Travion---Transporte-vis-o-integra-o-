import { Link, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Icone } from '../components/ui';
import { useApp } from '../data/store';
import { ROTULO_PAPEL } from '../lib/formato';

/** Menu complementar do celular (a barra inferior tem só 4 posições). */
export function Mais() {
  const { api, estado, pode, definirDemo } = useApp();
  const nav = useNavigate();
  const p = estado.sessao!.perfil;
  const admin = (['usuarios.gerenciar', 'permissoes.gerenciar', 'cadastros.gerenciar', 'configuracoes.gerenciar', 'importacao.executar'] as const).some(pode);
  return (
    <Layout titulo="Mais opções">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
        <div className="cartao cartao-corpo">
          <strong>{p.nome || p.email}</strong>
          <div className="suave">{ROTULO_PAPEL[p.papel]} · {p.email}</div>
        </div>
        <div className="cartao">
          <div className="cartao-cab"><h2>Módulos</h2></div>
          <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Link className="btn" to="/analise"><Icone nome="painel" />Análise · Dashboard Embarques</Link>
            {pode('analise.operacional') && <Link className="btn" to="/analise/operacional"><Icone nome="analise" />Análise · Painel Operacional</Link>}
            {pode('compartilhamento.preparar') && <Link className="btn" to="/posicao-cliente"><Icone nome="cliente" />Posição do Cliente</Link>}
            {pode('apoio.pagina') && <Link className="btn" to="/apoio"><Icone nome="lista" />Apoio Operacional</Link>}
            {(pode('cadastro.solicitar') || pode('cadastro.ver')) && <Link className="btn" to="/cadastro"><Icone nome="cadastro" />Cadastro</Link>}
            {(pode('estadia.solicitar') || pode('estadia.ver')) && <Link className="btn" to="/estadia"><Icone nome="relogio" />Estadia</Link>}
            {admin && <Link className="btn" to="/admin"><Icone nome="config" />Administração</Link>}
          </div>
        </div>
        {api.modo === 'supabase' && (
          <div className="cartao cartao-corpo">
            <label className="check">
              <input type="checkbox" checked={estado.demo} onChange={(e) => definirDemo(e.target.checked)} />
              Modo demonstração (dados fictícios, separados da produção)
            </label>
          </div>
        )}
        <button className="btn perigo" onClick={() => { void api.sair(); nav('/login'); }}><Icone nome="sair" />Sair</button>
      </div>
    </Layout>
  );
}
