// Embarques → Dashboard Embarques (02/11/2026): somente dois quadros, nesta ordem:
//   1. Tempo de fila por operação (mesmo componente e mesma fonte de dados do Painel Operacional, resumido);
//   2. Minhas solicitações (fila única de Cadastro, Emissão e Lote e Emissão, com cronômetro do atendimento).
// Aberto a todo usuário interno ativo; cada quadro respeita a própria permissão e o escopo do servidor.
// Os indicadores de faturamento e volume foram para Gestão → Painel de embarques.

import { FilaApoioDashboard } from '../components/analise/FilasOperacao';
import { MinhasSolicitacoes } from '../components/doc/MinhasSolicitacoes';
import { Layout } from '../components/Layout';
import { EstadoVazio } from '../components/ui';
import { useDoc } from '../data/documentacao';
import { useApp } from '../data/store';

export function DashboardEmbarques() {
  const { pode } = useApp();
  const { estado: doc } = useDoc();
  const fila = pode('analise.fila');
  return (
    <Layout titulo="Dashboard Embarques">
      <div className="dash dash-embarques">
        {fila && <FilaApoioDashboard />}
        <MinhasSolicitacoes />
        {!fila && !doc.ativo && (
          <div className="cartao"><EstadoVazio titulo="Nada para acompanhar">
            <p>Seu usuário não tem acesso ao tempo de fila nem às solicitações do apoio. Fale com um administrador se precisar.</p>
          </EstadoVazio></div>
        )}
      </div>
    </Layout>
  );
}
