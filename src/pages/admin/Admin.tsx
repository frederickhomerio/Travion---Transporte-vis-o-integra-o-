// Administração: usuários, permissões, cadastros, configurações, importação e dados demonstrativos.
// Cada aba aparece só para quem tem a permissão correspondente; o servidor confere de novo em cada gravação.

import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { AcessoNegado } from '../../components/ui';
import { useApp } from '../../data/store';
import type { Permissao } from '../../types';
import { Cadastros } from './Cadastros';
import { Configuracoes, DadosDemo } from './Configuracoes';
import { Importacao } from './Importacao';
import { Permissoes } from './Permissoes';
import { Usuarios } from './Usuarios';

const ABAS: Array<{ rota: string; rotulo: string; exige: Permissao; somenteAdmin?: boolean; el: () => JSX.Element }> = [
  { rota: 'usuarios', rotulo: 'Usuários e convites', exige: 'usuarios.gerenciar', el: () => <Usuarios /> },
  { rota: 'permissoes', rotulo: 'Permissões', exige: 'permissoes.gerenciar', el: () => <Permissoes /> },
  { rota: 'cadastros', rotulo: 'Cadastros', exige: 'cadastros.gerenciar', el: () => <Cadastros /> },
  { rota: 'importacao', rotulo: 'Importação', exige: 'importacao.executar', el: () => <Importacao /> },
  { rota: 'configuracoes', rotulo: 'Configurações', exige: 'configuracoes.gerenciar', el: () => <Configuracoes /> },
  { rota: 'demo', rotulo: 'Dados demonstrativos', exige: 'usuarios.gerenciar', somenteAdmin: true, el: () => <DadosDemo /> },
];

export function Admin() {
  const { estado, pode } = useApp();
  const admin = estado.sessao?.perfil.papel === 'administrador';
  const abas = ABAS.filter((a) => pode(a.exige) && (!a.somenteAdmin || admin));
  if (!abas.length) return <Layout titulo="Administração"><AcessoNegado /></Layout>;
  return (
    <Layout titulo="Administração">
      <nav className="abas" aria-label="Seções da administração">
        {abas.map((a) => (
          <NavLink key={a.rota} to={`/admin/${a.rota}`} className={({ isActive }) => (isActive ? 'ativa' : '')}>{a.rotulo}</NavLink>
        ))}
      </nav>
      <div style={{ marginTop: 14 }}>
        <Routes>
          {abas.map((a) => <Route key={a.rota} path={a.rota} element={a.el()} />)}
          <Route path="*" element={<Navigate to={`/admin/${abas[0].rota}`} replace />} />
        </Routes>
      </div>
    </Layout>
  );
}
