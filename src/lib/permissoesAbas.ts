// Em que aba do app cada permissão aparece (filtro "Aba" de Administração → Permissões). Só organiza a tela;
// quem confere o acesso é o servidor. Uma permissão pode valer em mais de uma aba (ex.: Ver financeiro).
import type { Permissao } from '../types';

export const ABAS_APP: Array<{ id: string; rotulo: string; chaves: Permissao[] }> = [
  { id: 'lista', rotulo: 'Lista de Fretes', chaves: [
    'embarques.ver', 'embarques.criar', 'embarques.editar_cadastro', 'embarques.liberar', 'embarques.editar_cadencia', 'embarques.editar_cadencia_proprio',
    'embarques.editar_capacidade', 'embarques.editar_lote', 'embarques.corrigir_lote_pc_tabela', 'embarques.arquivar', 'embarques.encerrar', 'embarques.reativar_encerrado', 'carteira.editar', 'financeiro.ver', 'financeiro.editar',
    'historico.ver', 'posicoes.abrir', 'posicoes.editar_contadores', 'posicoes.editar_obs_operacional', 'posicoes.editar_obs_cliente',
    'documentacao.ver', 'documentacao.solicitar', 'documentacao.devolver', 'documentacao.cancelar'] },
  { id: 'dashboard', rotulo: 'Dashboard Embarques', chaves: ['analise.fila', 'documentacao.ver', 'documentacao.solicitar', 'documentacao.devolver', 'cadastro.ver', 'cadastro.solicitar'] },
  { id: 'painel-embarques', rotulo: 'Gestão → Painel de embarques', chaves: ['embarques.ver', 'financeiro.ver'] },
  { id: 'painel', rotulo: 'Gestão → Painel Operacional', chaves: ['analise.operacional'] },
  { id: 'posicoes', rotulo: 'Posições de Embarque', chaves: ['posicoes.pagina', 'embarques.ver', 'posicoes.abrir', 'posicoes.editar_contadores', 'posicoes.editar_obs_operacional'] },
  { id: 'cliente', rotulo: 'Posição do Cliente', chaves: ['compartilhamento.preparar', 'compartilhamento.links', 'posicoes.editar_obs_cliente'] },
  { id: 'apoio', rotulo: 'Apoio Operacional', chaves: ['apoio.pagina', 'apoio.atender', 'apoio.reassumir', 'documentacao.ver', 'documentacao.cancelar', 'cadastro.cancelar', 'estadia.ver'] },
  { id: 'cadastro', rotulo: 'Cadastro', chaves: ['cadastro.solicitar', 'cadastro.ver', 'cadastro.cancelar_propria', 'cadastro.cancelar'] },
  { id: 'estadia', rotulo: 'Estadia', chaves: ['estadia.solicitar', 'estadia.ver', 'estadia.reabrir'] },
  { id: 'avisos', rotulo: 'Avisos (sino e WhatsApp)', chaves: ['avisos.fila_nova', 'avisos.prazo', 'avisos.embarque_novo', 'avisos.embarque_estado'] },
  { id: 'admin', rotulo: 'Administração', chaves: ['usuarios.gerenciar', 'usuarios.inativar', 'usuarios.excluir', 'permissoes.gerenciar', 'cadastros.gerenciar', 'importacao.executar', 'configuracoes.gerenciar'] },
];

export const abasDaPermissao = (c: Permissao) => ABAS_APP.filter((a) => a.chaves.includes(c)).map((a) => a.rotulo);
