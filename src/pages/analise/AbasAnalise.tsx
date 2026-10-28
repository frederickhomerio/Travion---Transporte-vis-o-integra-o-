// Navegação interna da aba Análise: Dashboard Embarques (financeiro e volume) e Painel Operacional (Apoio).

import { NavLink } from 'react-router-dom';
import { useApp } from '../../data/store';

export function AbasAnalise() {
  const { pode } = useApp();
  if (!pode('analise.operacional')) return null;
  return (
    <nav className="abas-analise" aria-label="Análise">
      <NavLink to="/analise" end>Dashboard Embarques</NavLink>
      <NavLink to="/analise/operacional">Painel Operacional</NavLink>
    </nav>
  );
}
