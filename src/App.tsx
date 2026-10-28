import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Carregando, ProvedorToast } from './components/ui';
import type { Api } from './data/api';
import { ProvedorDoc } from './data/documentacao';
import { ProvedorDados, useApp } from './data/store';
import { AguardandoAprovacao, Login, NovaSenha } from './pages/Login';
import { ListaFretes } from './pages/ListaFretes';
import { Mais } from './pages/Mais';

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const PainelOperacional = lazy(() => import('./pages/analise/PainelOperacional').then((m) => ({ default: m.PainelOperacional })));
const PosicoesEmbarque = lazy(() => import('./pages/PosicoesEmbarque').then((m) => ({ default: m.PosicoesEmbarque })));
const PosicaoCliente = lazy(() => import('./pages/PosicaoCliente').then((m) => ({ default: m.PosicaoCliente })));
const Admin = lazy(() => import('./pages/admin/Admin').then((m) => ({ default: m.Admin })));
const ApoioOperacional = lazy(() => import('./pages/ApoioOperacional').then((m) => ({ default: m.ApoioOperacional })));
const AtendimentoDoc = lazy(() => import('./pages/AtendimentoDoc').then((m) => ({ default: m.AtendimentoDoc })));
const Estadia = lazy(() => import('./pages/Estadia').then((m) => ({ default: m.Estadia })));
const Cadastro = lazy(() => import('./pages/Cadastro').then((m) => ({ default: m.Cadastro })));
const ConsultaPublica = lazy(() => import('./pages/ConsultaPublica').then((m) => ({ default: m.ConsultaPublica })));

function Protegido({ children }: { children: ReactNode }) {
  const { estado } = useApp();
  if (!estado.pronto) return <Carregando texto="Verificando acesso…" />;
  if (!estado.sessao) return <Navigate to="/login" replace />;
  if (estado.sessao.perfil.status !== 'ativo') return <AguardandoAprovacao />;
  return <Suspense fallback={<Carregando />}>{children}</Suspense>;
}

function OuvinteRecuperacao() {
  const { api } = useApp();
  const nav = useNavigate();
  useEffect(() => api.aoMudarAutenticacao((ev) => { if (ev === 'PASSWORD_RECOVERY') nav('/nova-senha'); }), [api, nav]);
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
              <Route path="/" element={<Protegido><ListaFretes /></Protegido>} />
              <Route path="/analise" element={<Protegido><Dashboard /></Protegido>} />
              <Route path="/analise/operacional" element={<Protegido><PainelOperacional /></Protegido>} />
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
