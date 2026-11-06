import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Carregando, ProvedorToast, useAviso } from './components/ui';
import type { Api } from './data/api';
import { ProvedorDoc } from './data/documentacao';
import { ProvedorDados, useApp } from './data/store';
import { AguardandoAprovacao, Login, NovaSenha } from './pages/Login';
import { ListaFretes } from './pages/ListaFretes';
import { Mais } from './pages/Mais';

const DashboardEmbarques = lazy(() => import('./pages/DashboardEmbarques').then((m) => ({ default: m.DashboardEmbarques })));
const PainelEmbarques = lazy(() => import('./pages/gestao/PainelEmbarques').then((m) => ({ default: m.PainelEmbarques })));
const PainelOperacional = lazy(() => import('./pages/analise/PainelOperacional').then((m) => ({ default: m.PainelOperacional })));
const PosicoesEmbarque = lazy(() => import('./pages/PosicoesEmbarque').then((m) => ({ default: m.PosicoesEmbarque })));
const PosicaoCliente = lazy(() => import('./pages/PosicaoCliente').then((m) => ({ default: m.PosicaoCliente })));
const Admin = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.Admin })));
const ApoioOperacional = lazy(() => import('./pages/ApoioOperacional').then((m) => ({ default: m.ApoioOperacional })));
const AtendimentoDoc = lazy(() => import('./pages/AtendimentoDoc').then((m) => ({ default: m.AtendimentoDoc })));
const Estadia = lazy(() => import('./pages/Estadia').then((m) => ({ default: m.Estadia })));
const Cadastro = lazy(() => import('./pages/Cadastro').then((m) => ({ default: m.Cadastro })));
const Ind = {
  Painel: lazy(() => import('./industrializado/paginas').then((m) => ({ default: m.PainelInd }))),
  Viagens: lazy(() => import('./industrializado/paginas').then((m) => ({ default: m.ViagensInd }))),
  Controle: lazy(() => import('./industrializado/paginas').then((m) => ({ default: m.ControleInd }))),
  Emissao: lazy(() => import('./industrializado/paginas').then((m) => ({ default: m.EmissaoInd }))),
  Ocorrencias: lazy(() => import('./industrializado/paginas').then((m) => ({ default: m.OcorrenciasInd }))),
  PosEntrega: lazy(() => import('./industrializado/paginas').then((m) => ({ default: m.PosEntregaInd }))),
  Clientes: lazy(() => import('./industrializado/paginas').then((m) => ({ default: m.ClientesInd }))),
};
const ConsultaPublica = lazy(() => import('./pages/ConsultaPublica').then((m) => ({ default: m.ConsultaPublica })));

function Protegido({ children }: { children: ReactNode }) {
  const { estado } = useApp();
  if (!estado.pronto) return <Carregando texto="Verificando acesso…" />;
  if (!estado.sessao) return <Navigate to="/login" replace />;
  if (estado.sessao.perfil.status !== 'ativo') return <AguardandoAprovacao />;
  return <Suspense fallback={<Carregando />}>{children}</Suspense>;
}

/** Quem só tem o Industrializado (sem acesso aos embarques) abre direto no módulo. */
function Inicio() {
  const { pode } = useApp();
  if (!pode('embarques.ver') && pode('ind.pagina')) return <Navigate to="/industrializado" replace />;
  return <ListaFretes />;
}

function OuvinteRecuperacao() {
  const { api } = useApp();
  const nav = useNavigate();
  const avisar = useAviso();
  useEffect(() => api.aoMudarAutenticacao((ev) => { if (ev === 'PASSWORD_RECOVERY') nav('/nova-senha'); }), [api, nav]);
  // Link do e-mail de convite: abre a sessão e leva a pessoa a criar a senha.
  useEffect(() => {
    api.confirmarLinkEmail().then((r) => { if (r === 'convite') nav('/nova-senha?convite=1'); })
      .catch((e: Error) => { avisar('erro', e.message); nav('/login'); });
  }, [api, nav]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function App({ api }: { api: Api }) {
  return (
    <ProvedorToast>
      <ProvedorDados api={api}>
        <ProvedorDoc>
          <HashRouter>
            <OuvinteRecuperacao />
            <Routes>
              <Route path="/consulta/:token" element={<Suspense fallback={<Carregando />}><ConsultaPublica /></Suspense>} />
              <Route path="/login" element={<Login />} />
              <Route path="/nova-senha" element={<NovaSenha />} />
              <Route path="/" element={<Protegido><Inicio /></Protegido>} />
              <Route path="/industrializado" element={<Protegido><Ind.Painel /></Protegido>} />
              <Route path="/industrializado/viagens" element={<Protegido><Ind.Viagens /></Protegido>} />
              <Route path="/industrializado/controle" element={<Protegido><Ind.Controle /></Protegido>} />
              <Route path="/industrializado/emissao" element={<Protegido><Ind.Emissao /></Protegido>} />
              <Route path="/industrializado/ocorrencias" element={<Protegido><Ind.Ocorrencias /></Protegido>} />
              <Route path="/industrializado/pos-entrega" element={<Protegido><Ind.PosEntrega /></Protegido>} />
              <Route path="/industrializado/clientes" element={<Protegido><Ind.Clientes /></Protegido>} />
              <Route path="/analise" element={<Protegido><DashboardEmbarques /></Protegido>} />
              <Route path="/gestao/painel-embarques" element={<Protegido><PainelEmbarques /></Protegido>} />
              <Route path="/gestao/painel-operacional" element={<Protegido><PainelOperacional /></Protegido>} />
              {/* Endereço antigo do Painel Operacional: leva ao novo lugar em Gestão (a tela confere a permissão). */}
              <Route path="/analise/operacional" element={<Navigate to="/gestao/painel-operacional" replace />} />
              <Route path="/dashboard" element={<Navigate to="/analise" replace />} />
              <Route path="/posicoes" element={<Protegido><PosicoesEmbarque /></Protegido>} />
              <Route path="/posicao-cliente" element={<Protegido><PosicaoCliente /></Protegido>} />
              <Route path="/apoio" element={<Protegido><ApoioOperacional /></Protegido>} />
              <Route path="/apoio/:id" element={<Protegido><AtendimentoDoc /></Protegido>} />
              <Route path="/cadastro" element={<Protegido><Cadastro /></Protegido>} />
              <Route path="/estadia" element={<Protegido><Estadia aba="envio" /></Protegido>} />
              <Route path="/estadia/consultar" element={<Protegido><Estadia aba="consultar" /></Protegido>} />
              <Route path="/admin/*" element={<Protegido><Admin /></Protegido>} />
              <Route path="/mais" element={<Protegido><Mais /></Protegido>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </HashRouter>
        </ProvedorDoc>
      </ProvedorDados>
    </ProvedorToast>
  );
}
