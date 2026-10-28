// PRÉVIA LOCAL — sem servidor. Usada apenas quando o app não tem credenciais do Supabase.
// Todos os dados são fictícios ([DEMO]) e ficam só neste navegador (localStorage).
// Reproduz as regras do servidor (permissões, escopo, conflito por campo, histórico) para que as telas
// possam ser avaliadas; a segurança real está no banco (supabase/migrations).

import { cnpjValido, naoCarregar, type Cadastros } from '../lib/cadastros';
import { consultarCnpjBrasilApi } from '../lib/cnpj';
import { hojeSP, somarDias } from '../lib/formato';
import { normalizar } from '../lib/texto';
import type { LinhaImportacao } from '../lib/planilha';
import {
  CONFIG_PADRAO, type CentroCusto, type Cidade, type Cliente, type Comercial, type Configuracoes, type Conflito, type Embarque, type Filial,
  type Financeiro, type Historico, type LinkCliente, type Local, type MetaDiaria, type Papel, type Perfil,
  type Permissao, type Posicao, type PosicaoPublica, type Produto, type Sessao,
} from '../types';
import { criarDocLocal } from './docLocal';
import type { Api, Convite, EventoTempoReal, MatrizPermissoes, RelatorioImportacao, UsuarioAdmin } from './api';

// Dados reais opcionais para testar a prévia (arquivo dados-previa.js publicado só junto da prévia, nunca no repositório).
interface DadosPrevia {
  id: string;
  filiais: string[];
  clientes: Array<{ nome: string; carteira: string | null; restricao: string | null }>;
  linhas: LinhaImportacao[];
  centros?: Record<string, string>;
}
const DADOS_PREVIA = (globalThis as { TRAVION_DADOS_PREVIA?: DadosPrevia }).TRAVION_DADOS_PREVIA ?? null;
const CHAVE = DADOS_PREVIA ? `travion-previa-v7-${DADOS_PREVIA.id}` : 'travion-previa-v7';
const CHAVE_SESSAO = 'travion-previa-sessao';

export const CATALOGO: MatrizPermissoes['catalogo'] = [
  ['embarques.ver', 'Embarques', 'Consultar embarques e posições no escopo autorizado'],
  ['embarques.criar', 'Embarques', 'Cadastrar novos embarques'],
  ['embarques.editar_cadastro', 'Embarques', 'Alterar cliente, rota, produto, filial, locais e observação interna'],
  ['embarques.liberar', 'Embarques', 'Liberar ou suspender embarques e alterar a data de liberação'],
  ['embarques.editar_cadencia', 'Embarques', 'Alterar a meta diária de qualquer embarque'],
  ['embarques.editar_cadencia_proprio', 'Embarques', 'Alterar a meta diária dos embarques que a própria pessoa criou'],
  ['embarques.editar_capacidade', 'Embarques', 'Alterar toneladas médias por veículo'],
  ['embarques.arquivar', 'Embarques', 'Arquivar ou reativar embarques'],
  ['embarques.encerrar', 'Embarques', 'Encerrar embarque definitivamente (sem reativação)'],
  ['carteira.editar', 'Comercial', 'Alterar a carteira (responsável comercial) de clientes e embarques'],
  ['posicoes.pagina', 'Posições', 'Acessar a página Posições de Embarque'],
  ['posicoes.abrir', 'Posições', 'Abrir posição para nova data operacional'],
  ['posicoes.editar_contadores', 'Posições', 'Alterar porta, trânsito e carregados'],
  ['posicoes.editar_obs_operacional', 'Posições', 'Alterar observação operacional interna'],
  ['posicoes.editar_obs_cliente', 'Posições', 'Alterar observação destinada ao cliente'],
  ['financeiro.ver', 'Financeiro', 'Ver fretes, tickets, faturamento e margem'],
  ['financeiro.editar', 'Financeiro', 'Alterar fretes, unidade do frete e metas financeiras'],
  ['historico.ver', 'Histórico', 'Consultar histórico de alterações'],
  ['compartilhamento.preparar', 'Compartilhamento', 'Preparar posição para WhatsApp, e-mail, imagem e PDF'],
  ['compartilhamento.links', 'Compartilhamento', 'Criar e revogar links externos de consulta'],
  ['importacao.executar', 'Administração', 'Importar planilhas e ver dados de referência da origem'],
  ['cadastros.gerenciar', 'Administração', 'Gerenciar clientes, filiais, comerciais, produtos e locais'],
  ['usuarios.gerenciar', 'Administração', 'Gerenciar usuários, convites e matriz de permissões'],
  ['configuracoes.gerenciar', 'Administração', 'Alterar configurações gerais (capacidade padrão, validade de links etc.)'],
  ['documentacao.ver', 'Documentação', 'Consultar a documentação dos embarques (solicitações, pendências e documentos emitidos)'],
  ['documentacao.solicitar', 'Documentação', 'Pedir geração de lote e emissão de documentos e responder pendências do apoio'],
  ['documentacao.cancelar', 'Documentação', 'Cancelar solicitações de documentação (com motivo)'],
  ['apoio.pagina', 'Documentação', 'Acessar a aba Apoio Operacional (fila de demandas)'],
  ['apoio.atender', 'Documentação', 'Assumir e atender demandas: registrar lote, pedir ajuste, anexar e liberar documentos'],
  ['cadastro.solicitar', 'Cadastro', 'Enviar cadastro de motorista e veículos ao apoio e responder pendências'],
  ['cadastro.ver', 'Cadastro', 'Acompanhar os cadastros do seu centro de custo (os próprios sempre aparecem)'],
  ['usuarios.inativar', 'Administração', 'Inativar e reativar usuários'],
  ['usuarios.excluir', 'Administração', 'Excluir usuários que ainda não têm registros no app'],
  ['permissoes.gerenciar', 'Administração', 'Definir as permissões de cada usuário em Administração → Permissões'],
  ['analise.operacional', 'Análise', 'Ver o Painel Operacional (filas, atendimento por colaborador e evolução das demandas do Apoio)'],
  ['analise.fila', 'Análise', 'Ver o tempo de fila do Apoio (Cadastro, Emissão e Estadia) no Dashboard Embarques'],
  ['estadia.solicitar', 'Estadia', 'Abrir a aba Estadia, enviar solicitações de estadia e responder pendências'],
  ['estadia.ver', 'Estadia', 'Consultar as estadias do seu centro de custo, além das próprias'],
  ['estadia.reabrir', 'Estadia', 'Reabrir estadia cancelada, encerrada ou aprovada (com motivo, fica no histórico)'],
].map(([chave, grupo, descricao]) => ({ chave: chave as Permissao, grupo, descricao }));

/** Mesma matriz inicial de supabase/migrations/20261026000200_permissoes.sql */
export const MATRIZ_INICIAL: Record<Exclude<Papel, 'administrador'>, Permissao[]> = {
  gestor: ['embarques.ver', 'embarques.criar', 'embarques.editar_cadastro', 'embarques.liberar', 'embarques.editar_cadencia',
    'embarques.editar_capacidade', 'embarques.arquivar', 'posicoes.abrir', 'posicoes.editar_contadores',
    'posicoes.editar_obs_operacional', 'posicoes.editar_obs_cliente', 'historico.ver', 'compartilhamento.preparar',
    'compartilhamento.links', 'financeiro.ver', 'financeiro.editar', 'embarques.encerrar', 'posicoes.pagina',
    'documentacao.ver', 'documentacao.solicitar', 'documentacao.cancelar', 'apoio.pagina', 'cadastro.solicitar', 'cadastro.ver',
    'permissoes.gerenciar', 'analise.operacional', 'estadia.solicitar', 'estadia.ver', 'estadia.reabrir', 'embarques.editar_cadencia_proprio', 'analise.fila'],
  supervisor: ['embarques.ver', 'embarques.criar', 'embarques.editar_cadastro', 'embarques.liberar', 'embarques.editar_cadencia',
    'embarques.editar_capacidade', 'embarques.arquivar', 'posicoes.abrir', 'posicoes.editar_contadores',
    'posicoes.editar_obs_operacional', 'posicoes.editar_obs_cliente', 'historico.ver', 'compartilhamento.preparar',
    'compartilhamento.links', 'financeiro.ver', 'financeiro.editar', 'posicoes.pagina', 'documentacao.ver', 'documentacao.solicitar',
    'cadastro.solicitar', 'cadastro.ver', 'estadia.solicitar', 'estadia.ver', 'embarques.editar_cadencia_proprio', 'analise.fila'],
  embarcador: ['embarques.ver', 'embarques.criar', 'embarques.liberar', 'posicoes.abrir', 'posicoes.editar_contadores',
    'posicoes.editar_obs_operacional', 'financeiro.ver', 'financeiro.editar', 'documentacao.ver', 'documentacao.solicitar',
    'cadastro.solicitar', 'cadastro.ver', 'estadia.solicitar', 'estadia.ver', 'embarques.editar_cadencia_proprio', 'analise.fila'],
  // Apoio Operacional reúne o antigo papel Operação (contadores e observação) e a fila de documentação.
  apoio: ['embarques.ver', 'posicoes.abrir', 'posicoes.editar_contadores', 'posicoes.editar_obs_operacional',
    'documentacao.ver', 'apoio.pagina', 'apoio.atender', 'documentacao.cancelar', 'cadastro.ver', 'analise.operacional', 'estadia.ver', 'analise.fila'],
  operacao: ['embarques.ver', 'posicoes.abrir', 'posicoes.editar_contadores', 'posicoes.editar_obs_operacional',
    'documentacao.ver', 'apoio.pagina', 'apoio.atender', 'documentacao.cancelar', 'cadastro.ver', 'analise.operacional', 'estadia.ver', 'analise.fila'],
  comercial: ['embarques.ver', 'embarques.criar', 'embarques.liberar', 'financeiro.ver', 'financeiro.editar', 'embarques.editar_cadencia',
    'posicoes.editar_obs_cliente', 'historico.ver', 'compartilhamento.preparar', 'compartilhamento.links',
    'posicoes.pagina', 'posicoes.editar_contadores', 'documentacao.ver', 'documentacao.solicitar',
    'cadastro.solicitar', 'cadastro.ver', 'estadia.solicitar', 'estadia.ver', 'embarques.editar_cadencia_proprio', 'analise.fila'],
  consulta: ['embarques.ver'],
};

interface Banco {
  versao: 1;
  seq: number;
  filiais: Filial[];
  comerciais: Comercial[];
  clientes: Cliente[];
  produtos: Produto[];
  locais: Local[];
  cidades?: Cidade[];
  centros_custo?: CentroCusto[];
  perfis: Perfil[];
  /** Escopo materializado (derivado dos centros de custo, como no servidor). */
  perfilFiliais: Array<{ perfil_id: string; filial_id: string }>;
  perfilCentros?: Array<{ perfil_id: string; centro_custo_id: string }>;
  perfilPermissoes: Array<{ perfil_id: string; chave: Permissao; permitido: boolean }>;
  papelPermissoes: Array<{ papel: Papel; chave: Permissao }>;
  embarques: Embarque[];
  financeiro: Financeiro[];
  posicoes: Posicao[];
  historico: Historico[];
  links: Array<LinkCliente & { token: string; is_demo: boolean }>;
  metas: MetaDiaria[];
  config: Configuracoes;
  convites: Convite[];
  dadosOrigem: Record<string, Record<string, unknown>>;
  importacoes: Array<{ hash: string; data: string }>;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const agora = () => new Date().toISOString();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const lerStorage = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravarStorage = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: fica só em memória */ } };

function erro(msg: string): never {
  throw new Error(msg);
}

function semear(): Banco {
  const hoje = hojeSP();
  const f = (nome: string): Filial => ({ id: uid(), nome, codigo: null, ativo: true, is_demo: true });
  const filiais = [f('[DEMO] Rio Verde'), f('[DEMO] Jataí'), f('[DEMO] Itumbiara'), f('[DEMO] Montividiu')];
  const comerciais: Comercial[] = ['[DEMO] Ana', '[DEMO] Bruno', '[DEMO] Carla'].map((nome) => ({ id: uid(), nome, email: null, ativo: true, is_demo: true }));
  const cli = (nome: string, com: number): Cliente => ({ id: uid(), nome, documento: null, comercial_id: comerciais[com].id, restricao_comercial: null, ativo: true, is_demo: true });
  const clientes = [cli('[DEMO] Cerealista Alfa', 0), cli('[DEMO] Agroindústria Beta', 0), cli('[DEMO] Trading Gama', 1),
    cli('[DEMO] Cooperativa Delta', 1), cli('[DEMO] Usina Épsilon', 2), cli('[DEMO] Fertilizantes Zeta', 2)];
  const produtos: Produto[] = ['[DEMO] Milho em grãos', '[DEMO] Soja em grãos', '[DEMO] Farelo de soja', '[DEMO] Açúcar', '[DEMO] Adubo big bag']
    .map((nome) => ({ id: uid(), nome, ativo: true, is_demo: true }));
  const loc = (nome: string, cidade: string, uf: string, tipo: Local['tipo']): Local => ({ id: uid(), nome, cidade, uf, tipo, ativo: true, is_demo: true });
  const locais = [
    loc('[DEMO] Armazém Norte', 'Rio Verde', 'GO', 'coleta'), loc('[DEMO] Fazenda Boa Vista', 'Jataí', 'GO', 'coleta'),
    loc('[DEMO] Silo Central', 'Itumbiara', 'GO', 'coleta'), { ...loc('[DEMO] Fazenda Serra', 'Montividiu', 'GO', 'coleta'), link_mapa: 'https://maps.app.goo.gl/a4n1Z1LzwwtDoMaZ7' },
    loc('[DEMO] Terminal Porto', 'Santos', 'SP', 'entrega'), loc('[DEMO] Indústria Sul', 'Uberaba', 'MG', 'entrega'),
    loc('[DEMO] Ferrovia Leste', 'Araguari', 'MG', 'entrega'), loc('[DEMO] Usina Oeste', 'Quirinópolis', 'GO', 'entrega'),
    loc('[DEMO] Fazenda Santa Rita', 'Mineiros', 'GO', 'coleta'), loc('[DEMO] Porto Seco', 'Paranaguá', 'PR', 'entrega'),
    loc('[DEMO] Esmagadora Centro', 'Rondonópolis', 'MT', 'entrega'), loc('[DEMO] Armazém Catalão', 'Catalão', 'GO', 'entrega'),
  ];
  const perfis: Perfil[] = [
    ['Administrador (prévia)', 'administrador'], ['Gestor Rio Verde (prévia)', 'gestor'], ['Apoio Operacional (prévia)', 'apoio'],
    ['Coordenador Comercial Ana (prévia)', 'comercial'], ['Consulta interna (prévia)', 'consulta'],
    ['Supervisor Jataí (prévia)', 'supervisor'], ['Embarcador Montividiu (prévia)', 'embarcador'],
  ].map(([nome, papel], i) => ({
    id: `perfil-${i}`, nome, email: `${papel}@previa.local`, papel: papel as Papel, status: 'ativo',
    comercial_id: papel === 'comercial' ? comerciais[0].id : null, criado_em: agora(),
  }));
  const perfilFiliais = [
    { perfil_id: 'perfil-1', filial_id: filiais[0].id }, { perfil_id: 'perfil-1', filial_id: filiais[3].id },
    { perfil_id: 'perfil-4', filial_id: filiais[0].id },
    { perfil_id: 'perfil-4', filial_id: filiais[1].id }, { perfil_id: 'perfil-5', filial_id: filiais[1].id },
    { perfil_id: 'perfil-5', filial_id: filiais[2].id }, { perfil_id: 'perfil-6', filial_id: filiais[3].id },
    ...filiais.map((f) => ({ perfil_id: 'perfil-2', filial_id: f.id })),
  ];
  const papelPermissoes = Object.entries(MATRIZ_INICIAL).flatMap(([papel, ps]) => ps.map((chave) => ({ papel: papel as Papel, chave })));

  // [cliente, filial, produto, origem, coleta, destino, uf, entrega, status, cadência, frete emp, frete mot, porta, trânsito, carregados]
  const lotes: Array<[number, number, number, string, number, string, string, number, Embarque['status_liberacao'], number | null, number, number, number, number, number]> = [
    [0, 0, 0, 'Rio Verde', 0, 'Santos', 'SP', 4, 'liberado', null, 155, 144, 3, 2, 4],
    [0, 0, 0, 'Rio Verde', 0, 'Santos', 'SP', 4, 'liberado', 3, 155, 144, 1, 1, 2],
    [1, 1, 2, 'Jataí', 1, 'Uberaba', 'MG', 5, 'liberado', null, 230, 180, 0, 3, 1],
    [2, 1, 1, 'Jataí', 1, 'Araguari', 'MG', 6, 'suspenso', null, 140, 130, 2, 0, 0],
    [2, 2, 0, 'Itumbiara', 2, 'Santos', 'SP', 4, 'nao_informado', null, 260, 241, 0, 0, 0],
    [3, 2, 1, 'Itumbiara', 2, 'Uberaba', 'MG', 5, 'liberado', 4, 79, 73, 5, 4, 6],
    [4, 3, 0, 'Montividiu', 3, 'Quirinópolis', 'GO', 7, 'liberado', null, 91, 84, 2, 0, 1],
    [4, 3, 0, 'Montividiu', 3, 'Quirinópolis', 'GO', 7, 'liberado', null, 65, 60, 2, 2, 9],
    [5, 0, 4, 'Rio Verde', 0, 'Quirinópolis', 'GO', 7, 'liberado', null, 113, 103, 1, 1, 0],
    [3, 3, 3, 'Montividiu', 3, 'Santos', 'SP', 4, 'suspenso', null, 700, 540, 0, 0, 0],
    [0, 1, 1, 'Mineiros', 8, 'Paranaguá', 'PR', 9, 'liberado', null, 210, 190, 2, 3, 1],
    [0, 1, 1, 'Jataí', 1, 'Rondonópolis', 'MT', 10, 'liberado', null, 120, 108, 1, 2, 0],
    [0, 0, 0, 'Rio Verde', 0, 'Catalão', 'GO', 11, 'liberado', null, 98, 90, 0, 1, 3],
    [0, 0, 0, 'Rio Verde', 0, 'Uberaba', 'MG', 5, 'suspenso', null, 140, 128, 0, 0, 0],
    [1, 1, 2, 'Mineiros', 8, 'Uberaba', 'MG', 5, 'liberado', null, 230, 180, 1, 0, 2],
    [3, 2, 1, 'Itumbiara', 2, 'Araguari', 'MG', 6, 'liberado', null, 85, 79, 0, 2, 1],
  ];
  // Confirmações fictícias de hoje: recente, com mais de 2 horas e nunca confirmada (para o relatório por filial).
  const minutos = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
  const confirmacao = (i: number, d: number) => d > 0
    ? { confirmado_em: `${somarDias(hoje, -d)}T20:30:00.000Z`, confirmado_por_nome: '[DEMO] Carlos Silva' }
    : [{ confirmado_em: minutos(25 + i), confirmado_por_nome: '[DEMO] Carlos Silva' },
      { confirmado_em: minutos(190 + i), confirmado_por_nome: '[DEMO] Marta Lima' },
      { confirmado_em: null, confirmado_por_nome: null }][i % 3];
  const embarques: Embarque[] = [];
  let suspensos = 0;
  const financeiro: Financeiro[] = [];
  const posicoes: Posicao[] = [];
  lotes.forEach((l, i) => {
    const id = uid();
    embarques.push({
      id, codigo: i + 1, cliente_id: clientes[l[0]].id, comercial_id: clientes[l[0]].comercial_id, filial_id: filiais[l[1]].id,
      produto_id: produtos[l[2]].id, origem_cidade: l[3], origem_uf: 'GO', local_coleta_id: locais[l[4]].id,
      destino_cidade: l[5], destino_uf: l[6], local_entrega_id: locais[l[7]].id, status_liberacao: l[8], data_liberacao: null,
      cadencia_valor: l[9], cadencia_unidade: 'veiculos_dia', toneladas_por_veiculo: 40, observacao_interna: i === 6 ? 'Carregamento das 7h às 17h. Levar lona e EPI.' : null,
      situacao: 'ativo', is_demo: true, chave_importacao: null, versao: 1, atualizado_em: agora(), atualizado_por_nome: 'Demonstração',
      suspenso_em: l[8] === 'suspenso' ? new Date(Date.now() - [1, 5, 6][suspensos++ % 3] * 86400e3 - 3600e3).toISOString() : null,
    });
    financeiro.push({ embarque_id: id, frete_empresa: l[10], frete_motorista: l[11], unidade_frete: 'rs_tonelada',
      frete_empresa_original: null, frete_motorista_original: null, versao: 1, atualizado_em: agora() });
    for (const d of [1, 0]) {
      posicoes.push({
        id: uid(), embarque_id: id, data_operacional: somarDias(hoje, -d), porta: Math.max(l[12] - d, 0), transito: l[13],
        carregados: Math.max(l[14] - 2 * d, 0), toneladas_por_veiculo: 40, meta_valor: l[9], meta_unidade: 'veiculos_dia',
        obs_operacional: null,
        obs_cliente: l[8] === 'suspenso' ? 'Aguardando liberação de cota pelo cliente' : i === 0 ? 'Fila de 2 horas na balança da coleta' : null,
        is_demo: true, origem: 'abertura', versao: 1, atualizado_em: agora(), atualizado_por_nome: 'Demonstração', ...confirmacao(i, d),
      });
    }
  });
  return {
    versao: 1, seq: lotes.length, filiais, comerciais, clientes, produtos, locais, perfis, perfilFiliais, perfilPermissoes: [],
    papelPermissoes, embarques, financeiro, posicoes, historico: [], links: [],
    metas: [{ data_operacional: hoje, is_demo: true, meta_faturamento: 120000, meta_margem: 12000, meta_volume_t: 900, observacao: 'Meta fictícia' }],
    config: { ...CONFIG_PADRAO }, convites: [], dadosOrigem: {}, importacoes: [],
  };
}
/** Equipe fictícia da prévia: com os perfis de demonstração, 3 pessoas por função. Filiais pelo nome (com ou sem "[DEMO]"). */
const EQUIPE_PREVIA: Array<{ id: string; nome: string; papel: Papel; filiais: string[] | 'todas'; carteira?: number }> = [
  { id: 'perfil-7', nome: 'Marcos Andrade', papel: 'administrador', filiais: [] },
  { id: 'perfil-8', nome: 'Juliana Prado', papel: 'administrador', filiais: [] },
  { id: 'perfil-9', nome: 'Ricardo Menezes', papel: 'gestor', filiais: ['Jataí', 'Itumbiara'] },
  { id: 'perfil-10', nome: 'Patrícia Lopes', papel: 'gestor', filiais: ['Goiânia', 'Anápolis'] },
  { id: 'perfil-11', nome: 'André Barbosa', papel: 'supervisor', filiais: ['Rio Verde', 'Montividiu'] },
  { id: 'perfil-12', nome: 'Larissa Freitas', papel: 'supervisor', filiais: ['Goiânia', 'Anápolis'] },
  { id: 'perfil-13', nome: 'Thiago Ribeiro', papel: 'embarcador', filiais: ['Rio Verde'] },
  { id: 'perfil-14', nome: 'Gabriela Moreira', papel: 'embarcador', filiais: ['Jataí'] },
  { id: 'perfil-15', nome: 'Camila Rocha', papel: 'apoio', filiais: 'todas' },
  { id: 'perfil-16', nome: 'Diego Martins', papel: 'apoio', filiais: 'todas' },
  { id: 'perfil-17', nome: 'Fernanda Castro', papel: 'comercial', filiais: [], carteira: 1 },
  { id: 'perfil-18', nome: 'Lucas Teixeira', papel: 'comercial', filiais: [], carteira: 2 },
  { id: 'perfil-19', nome: 'Beatriz Nunes', papel: 'consulta', filiais: ['Montividiu'] },
  { id: 'perfil-20', nome: 'Rafael Souza', papel: 'consulta', filiais: ['Goiânia'] },
];
const emailEquipe = (nome: string) => `${normalizar(nome).toLowerCase().replace(/[^a-z]+/g, '.')}@previa.local`;

/** Inclui a equipe fictícia (também em bancos da prévia gravados antes dela), sem mexer no resto. */
function completarEquipe(db: Banco): Banco {
  const nomeSemDemo = (n: string) => normalizar(n.replace('[DEMO]', '').trim());
  for (const x of EQUIPE_PREVIA) {
    if (db.perfis.some((p) => p.id === x.id)) continue;
    const comercial = x.carteira != null ? db.comerciais[x.carteira] ?? db.comerciais[0] : undefined;
    db.perfis.push({ id: x.id, nome: x.nome, email: emailEquipe(x.nome), papel: x.papel, status: 'ativo', comercial_id: comercial?.id ?? null, criado_em: agora() });
    const fs = x.filiais === 'todas' ? db.filiais : x.filiais.map((n) => db.filiais.find((f) => nomeSemDemo(f.nome) === normalizar(n))).filter((f): f is Filial => !!f);
    const escolhidas = fs.length || x.filiais === 'todas' || !x.filiais.length ? fs : db.filiais.slice(0, 1);
    for (const f of escolhidas) db.perfilFiliais.push({ perfil_id: x.id, filial_id: f.id });
  }
  return db;
}

const PAPEIS_GERENCIAL: Papel[] = ['apoio', 'comercial', 'gestor', 'administrador'];

/** Filiais que os centros de custo do usuário liberam (Gerencial: todas). */
function sincronizarEscopo(db: Banco, perfilId: string) {
  const meus = new Set((db.perfilCentros ?? []).filter((x) => x.perfil_id === perfilId).map((x) => x.centro_custo_id));
  const total = (db.centros_custo ?? []).some((c) => c.acesso_total && meus.has(c.id));
  const fs = db.filiais.filter((f) => total || (!!f.centro_custo_id && meus.has(f.centro_custo_id)));
  db.perfilFiliais = db.perfilFiliais.filter((x) => x.perfil_id !== perfilId).concat(fs.map((f) => ({ perfil_id: perfilId, filial_id: f.id })));
}
const sincronizarTodos = (db: Banco) => { for (const p of db.perfis) sincronizarEscopo(db, p.id); };

/** Como a migração 2400: cria o centro Gerencial, liga cada usuário aos centros das filiais que já tinha e tira a carteira do usuário. */
function migrarCentros(db: Banco): Banco {
  if (db.perfilCentros) return db;
  db.centros_custo ??= [];
  let ger = db.centros_custo.find((c) => c.acesso_total);
  if (!ger) { ger = { id: uid(), nome: 'Gerencial', ativo: true, is_demo: true, acesso_total: true }; db.centros_custo.push(ger); }
  db.perfilCentros = [];
  for (const p of db.perfis) {
    const ids = PAPEIS_GERENCIAL.includes(p.papel) ? [ger.id]
      : [...new Set(db.perfilFiliais.filter((x) => x.perfil_id === p.id).map((x) => db.filiais.find((f) => f.id === x.filial_id)?.centro_custo_id).filter((x): x is string => !!x))];
    for (const c of ids) db.perfilCentros.push({ perfil_id: p.id, centro_custo_id: c });
    p.comercial_id = null;
  }
  for (const c of db.convites) c.comercial_id = null;
  sincronizarTodos(db);
  return db;
}

const semearPrevia = (): Banco => completarEquipe(DADOS_PREVIA ? semearDaPlanilha(semear(), DADOS_PREVIA) : semear());

/** Troca os cadastros e embarques fictícios pelos da planilha, mantendo perfis, permissões e configurações da prévia. */
function semearDaPlanilha(base: Banco, d: DadosPrevia): Banco {
  const hoje = hojeSP();
  const porNome = <T extends { nome: string }>(lista: T[], nome: string | null | undefined) => lista.find((x) => normalizar(x.nome) === normalizar(nome ?? ''));
  const centros_custo: CentroCusto[] = [];
  const filiais: Filial[] = [];
  const comerciais: Comercial[] = [];
  const clientes: Cliente[] = [];
  const produtos: Produto[] = [];
  const locais: Local[] = [];
  const filial = (nome: string) => {
    let f = porNome(filiais, nome);
    if (!f) {
      const cc = d.centros?.[Object.keys(d.centros).find((k) => normalizar(k) === normalizar(nome)) ?? ''];
      let c = cc ? porNome(centros_custo, cc) : undefined;
      if (cc && !c) { c = { id: uid(), nome: cc, ativo: true, is_demo: true }; centros_custo.push(c); }
      f = { id: uid(), nome: nome.trim(), codigo: null, centro_custo_id: c?.id ?? null, ativo: true, is_demo: true };
      filiais.push(f);
    }
    return f;
  };
  const comercial = (nome: string | null) => {
    if (!nome?.trim()) return null;
    let c = porNome(comerciais, nome);
    if (!c) { c = { id: uid(), nome: nome.trim(), email: null, ativo: true, is_demo: true }; comerciais.push(c); }
    return c;
  };
  const cliente = (nome: string, carteira: string | null, restricao: string | null) => {
    let c = porNome(clientes, nome);
    if (!c) {
      c = { id: uid(), nome: nome.trim(), documento: null, comercial_id: comercial(carteira)?.id ?? null, restricao_comercial: restricao, ativo: true, is_demo: true };
      clientes.push(c);
    }
    return c;
  };
  const produto = (nome: string | null) => {
    if (!nome?.trim()) return null;
    let p = porNome(produtos, nome);
    if (!p) { p = { id: uid(), nome: nome.trim(), ativo: true, is_demo: true }; produtos.push(p); }
    return p;
  };
  const local = (nome: string | null, cidade: string, uf: string | null, tipo: Local['tipo']) => {
    if (!nome?.trim()) return null;
    let l = locais.find((x) => x.tipo === tipo && normalizar(x.nome) === normalizar(nome) && normalizar(x.cidade ?? '') === normalizar(cidade));
    if (!l) { l = { id: uid(), nome: nome.trim(), cidade, uf, tipo, ativo: true, is_demo: true }; locais.push(l); }
    return l;
  };
  for (const f of d.filiais) filial(f);
  for (const c of d.clientes) cliente(c.nome, c.carteira, c.restricao);
  const embarques: Embarque[] = [];
  const financeiro: Financeiro[] = [];
  const posicoes: Posicao[] = [];
  d.linhas.forEach((l, i) => {
    const id = uid();
    const cli = cliente(l.cliente, l.carteira, null);
    const origemUf = l.origem_uf ?? 'GO';
    embarques.push({
      id, codigo: i + 1, cliente_id: cli.id, comercial_id: comercial(l.carteira)?.id ?? cli.comercial_id, filial_id: filial(l.filial).id,
      produto_id: produto(l.produto)?.id ?? null, origem_cidade: l.origem_cidade, origem_uf: origemUf,
      local_coleta_id: local(l.coleta, l.origem_cidade, origemUf, 'coleta')?.id ?? null,
      destino_cidade: l.destino_cidade, destino_uf: l.destino_uf, local_entrega_id: local(l.entrega, l.destino_cidade, l.destino_uf, 'entrega')?.id ?? null,
      status_liberacao: l.status, data_liberacao: null, cadencia_valor: l.cadencia_valor, cadencia_unidade: 'veiculos_dia',
      toneladas_por_veiculo: base.config.capacidade_padrao_t, observacao_interna: null, situacao: 'ativo', is_demo: true,
      chave_importacao: l.chave, versao: 1, atualizado_em: agora(), atualizado_por_nome: 'Planilha',
      suspenso_em: l.status === 'suspenso' ? new Date(Date.now() - 86400e3).toISOString() : null,
    });
    financeiro.push({ embarque_id: id, frete_empresa: l.frete_empresa, frete_motorista: l.frete_motorista, unidade_frete: 'rs_tonelada',
      frete_empresa_original: l.frete_empresa_original, frete_motorista_original: l.frete_motorista_original, versao: 1, atualizado_em: agora() });
    posicoes.push({
      id: uid(), embarque_id: id, data_operacional: hoje, porta: l.porta, transito: l.transito, carregados: l.carregados,
      toneladas_por_veiculo: base.config.capacidade_padrao_t, meta_valor: l.cadencia_valor, meta_unidade: 'veiculos_dia',
      obs_operacional: l.obs_operacional, obs_cliente: l.obs_cliente, is_demo: true, origem: 'importacao', versao: 1,
      atualizado_em: agora(), atualizado_por_nome: 'Planilha', confirmado_em: null, confirmado_por_nome: null,
    });
  });
  // Mesmo escopo dos perfis da prévia, agora com as filiais reais; o apoio vê todas.
  const ids = (...nomes: string[]) => nomes.map((n) => porNome(filiais, n)?.id).filter((x): x is string => !!x);
  const escopo: Record<string, string[]> = {
    'perfil-1': ids('Rio Verde', 'Montividiu'), 'perfil-2': filiais.map((f) => f.id), 'perfil-4': ids('Rio Verde', 'Jataí'),
    'perfil-5': ids('Jataí', 'Itumbiara'), 'perfil-6': ids('Montividiu'),
  };
  const perfilFiliais = Object.entries(escopo).flatMap(([perfil_id, fs]) => fs.map((filial_id) => ({ perfil_id, filial_id })));
  const carteira = comerciais.find((c) => embarques.some((e) => e.comercial_id === c.id)) ?? comerciais[0];
  const perfis = base.perfis.map((p) => (p.papel === 'comercial' ? { ...p, nome: `Coordenador Comercial ${carteira?.nome ?? ''} (prévia)`.replace('  ', ' '), comercial_id: carteira?.id ?? null } : p));
  return {
    ...base, seq: embarques.length, filiais, comerciais, clientes, produtos, locais, centros_custo, perfis, perfilFiliais,
    embarques, financeiro, posicoes, metas: [], historico: [], links: [], dadosOrigem: Object.fromEntries(d.linhas.map((l, i) => [embarques[i].id, l.extras])),
  };
}

export function criarLocalApi(): Api {
  let db: Banco = (() => {
    const s = lerStorage(CHAVE);
    if (s) { try { return completarEquipe(JSON.parse(s) as Banco); } catch { /* recria */ } }
    // Grava a semente já: outras abas da prévia passam a ver os mesmos registros (mesmos identificadores).
    const novo = semearPrevia();
    gravarStorage(CHAVE, JSON.stringify(novo));
    return novo;
  })();
  // Bancos da prévia gravados antes do cadastro de cidades: deriva as cidades das rotas existentes.
  if (!db.cidades) {
    const vistas = new Map<string, Cidade>();
    for (const e of db.embarques) {
      for (const [nome, uf] of [[e.origem_cidade, e.origem_uf], [e.destino_cidade, e.destino_uf]] as const) {
        const k = `${normalizar(nome)}|${uf ?? ''}|${e.is_demo}`;
        if (!vistas.has(k)) vistas.set(k, { id: uid(), nome, uf, ativo: true, is_demo: e.is_demo });
      }
    }
    db.cidades = [...vistas.values()];
  }
  if (!db.centros_custo) db.centros_custo = [];
  if (!db.centros_custo.some((c) => c.is_demo)) {
    // Centros de custo fictícios para a prévia do Dashboard (Meta x Projeção por centro de custo)
    const cc = ['[DEMO] Vegetal', '[DEMO] Sul'].map((nome) => ({ id: uid(), nome, ativo: true, is_demo: true }));
    db.centros_custo.push(...cc);
    db.filiais.filter((f) => f.is_demo && !f.centro_custo_id).forEach((f, i) => { f.centro_custo_id = cc[i % 2].id; });
  }
  if (!db.perfilCentros) { migrarCentros(db); gravarStorage(CHAVE, JSON.stringify(db)); }
  // Bancos da prévia gravados antes da aba Cadastro: recebem as permissões novas da matriz inicial (como a migração 1700).
  for (const nova of ['cadastro.solicitar', 'cadastro.ver', 'permissoes.gerenciar', 'analise.operacional', 'estadia.solicitar', 'estadia.ver', 'estadia.reabrir', 'embarques.editar_cadencia_proprio', 'analise.fila'] as Permissao[]) {
    if (db.papelPermissoes.some((x) => x.chave === nova)) continue;
    for (const [papel, ps] of Object.entries(MATRIZ_INICIAL)) if (ps.includes(nova)) db.papelPermissoes.push({ papel: papel as Papel, chave: nova });
  }
  let perfilId: string | null = lerStorage(CHAVE_SESSAO);
  const ouvintesAuth = new Set<(e: string) => void>();
  const ouvintesDados = new Set<(e: EventoTempoReal) => void>();

  const salvar = () => gravarStorage(CHAVE, JSON.stringify(db));
  const perfil = () => db.perfis.find((p) => p.id === perfilId) ?? null;
  const ativo = () => perfil()?.status === 'ativo';
  const tem = (c: Permissao) => {
    const p = perfil();
    if (!p || p.status !== 'ativo') return false;
    if (p.papel === 'administrador') return true;
    const exc = db.perfilPermissoes.find((x) => x.perfil_id === p.id && x.chave === c);
    if (exc) return exc.permitido;
    return db.papelPermissoes.some((x) => x.papel === p.papel && x.chave === c);
  };
  const exigir = (c: Permissao) => {
    if (!ativo()) erro('Seu acesso ainda não foi aprovado ou está bloqueado.');
    if (!tem(c)) erro(`Você não tem permissão para esta ação (${CATALOGO.find((x) => x.chave === c)?.descricao}).`);
  };
  const noEscopo = (filial: string, _comercial: string | null) => {
    const p = perfil();
    if (!p || p.status !== 'ativo') return false;
    if (p.papel === 'administrador') return true;
    return db.perfilFiliais.some((x) => x.perfil_id === p.id && x.filial_id === filial);
  };
  const veEmbarque = (e: Embarque) => tem('embarques.ver') && noEscopo(e.filial_id, e.comercial_id);
  const veCliente = (c: Cliente) => ativo() && (tem('cadastros.gerenciar') || tem('embarques.criar')
    || db.embarques.some((e) => e.cliente_id === c.id && noEscopo(e.filial_id, e.comercial_id)));
  const nomeUsuario = () => perfil()?.nome ?? 'Sistema';
  const registrar = (h: Partial<Historico> & { entidade: string; campo: string }) => {
    db.historico.unshift({
      id: db.historico.length + 1, registro_id: null, embarque_id: null, posicao_id: null, cliente_id: null,
      data_operacional: null, valor_anterior: null, valor_novo: null, sensivel: false, origem: 'app',
      usuario_nome: nomeUsuario(), alterado_em: agora(), ...h,
    });
  };
  const emitir = (e: EventoTempoReal) => { for (const o of ouvintesDados) o(e); };
  const encerrar = (e: Embarque, motivo: string | null, autor: string) => {
    db.historico.unshift({
      id: db.historico.length + 1, entidade: 'embarque', registro_id: e.id, embarque_id: e.id, posicao_id: null, cliente_id: e.cliente_id,
      data_operacional: null, campo: 'encerramento', valor_anterior: e.status_liberacao === 'suspenso' ? 'Suspenso' : 'Ativo',
      valor_novo: `Encerrado${motivo ? `: ${motivo}` : ''}`, sensivel: false, origem: 'app', usuario_nome: autor, alterado_em: agora(),
    });
    Object.assign(e, { situacao: 'arquivado', encerrado_em: agora(), encerrado_por_nome: autor, encerrado_motivo: motivo,
      versao: e.versao + 1, atualizado_em: agora(), atualizado_por_nome: autor });
  };
  // Simula o agendamento de hora em hora (private.encerrar_suspensos_vencidos): suspenso há mais de 7 dias é encerrado.
  const encerrarVencidos = () => {
    const limite = Date.now() - 7 * 86400e3;
    const vencidos = db.embarques.filter((e) => e.status_liberacao === 'suspenso' && !e.encerrado_em && e.suspenso_em && Date.parse(e.suspenso_em) <= limite);
    for (const e of vencidos) encerrar(e, 'Suspenso há mais de 7 dias sem reativação', 'Sistema');
    if (vencidos.length) salvar();
  };
  const txt = (v: unknown) => (v === null || v === undefined ? null : String(v));

  type Regra = { perm: Permissao; tipo: 'contador' | 'texto' | 'texto_obrigatorio' | 'positivo' | 'positivo_obrigatorio' | 'dinheiro' | 'enum' | 'uuid' | 'uf' | 'data'; valores?: string[] };
  function validar(campo: string, r: Regra, v: unknown): unknown {
    if (v === null || v === undefined || v === '') {
      if (r.tipo === 'texto_obrigatorio' || r.tipo === 'enum' || r.tipo === 'positivo_obrigatorio') erro(`${campo} é obrigatório.`);
      return null;
    }
    switch (r.tipo) {
      case 'contador':
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) erro('Use somente números inteiros maiores ou iguais a zero.');
        return v;
      case 'positivo': case 'positivo_obrigatorio':
        if (typeof v !== 'number' || v <= 0) erro('Informe um número maior que zero.');
        return v;
      case 'dinheiro':
        if (typeof v !== 'number' || v < 0) erro('Informe um valor maior ou igual a zero.');
        return Math.round(v * 100) / 100;
      case 'texto': case 'texto_obrigatorio': {
        const s = String(v).trim();
        if (!s && r.tipo === 'texto_obrigatorio') erro(`${campo} é obrigatório.`);
        return s || null;
      }
      case 'uf': {
        const s = String(v).trim().toUpperCase();
        if (s && !/^[A-Z]{2}$/.test(s)) erro('UF deve ter 2 letras.');
        return s || null;
      }
      case 'enum':
        if (!r.valores!.includes(String(v))) erro('Valor inválido.');
        return v;
      default:
        return v;
    }
  }
  function preparar<T extends object>(atual: T, alt: Partial<T>, base: Partial<T>, forcar: boolean, regras: Record<string, Regra>) {
    const novo: Record<string, unknown> = {};
    const conflitos: Conflito[] = [];
    for (const [k, v0] of Object.entries(alt)) {
      const r = regras[k];
      if (!r) erro(`O campo "${k}" não pode ser alterado por esta ação.`);
      if (!tem(r.perm)) erro(`Você não tem permissão para alterar ${k}.`);
      const v = validar(k, r, v0);
      const cur = (atual as Record<string, unknown>)[k] ?? null;
      if (cur === v) continue;
      if (!forcar) {
        if (!(k in base)) erro('Valor de referência ausente.');
        const b = (base as Record<string, unknown>)[k] ?? null;
        if (b !== cur) {
          conflitos.push({ campo: k, rotulo: k, valor_base: b, valor_atual: cur, valor_proposto: v });
          continue;
        }
      }
      novo[k] = v;
    }
    return { novo, conflitos };
  }

  const R_POS: Record<string, Regra> = {
    porta: { perm: 'posicoes.editar_contadores', tipo: 'contador' },
    transito: { perm: 'posicoes.editar_contadores', tipo: 'contador' },
    carregados: { perm: 'posicoes.editar_contadores', tipo: 'contador' },
    obs_operacional: { perm: 'posicoes.editar_obs_operacional', tipo: 'texto' },
    obs_cliente: { perm: 'posicoes.editar_obs_cliente', tipo: 'texto' },
  };
  const R_EMB: Record<string, Regra> = {
    cliente_id: { perm: 'embarques.editar_cadastro', tipo: 'uuid' }, filial_id: { perm: 'embarques.editar_cadastro', tipo: 'uuid' },
    produto_id: { perm: 'embarques.editar_cadastro', tipo: 'uuid' }, origem_cidade: { perm: 'embarques.editar_cadastro', tipo: 'texto_obrigatorio' },
    origem_uf: { perm: 'embarques.editar_cadastro', tipo: 'uf' }, local_coleta_id: { perm: 'embarques.editar_cadastro', tipo: 'uuid' },
    destino_cidade: { perm: 'embarques.editar_cadastro', tipo: 'texto_obrigatorio' }, destino_uf: { perm: 'embarques.editar_cadastro', tipo: 'uf' },
    local_entrega_id: { perm: 'embarques.editar_cadastro', tipo: 'uuid' }, observacao_interna: { perm: 'embarques.editar_cadastro', tipo: 'texto' },
    status_liberacao: { perm: 'embarques.liberar', tipo: 'enum', valores: ['liberado', 'suspenso', 'nao_informado'] },
    data_liberacao: { perm: 'embarques.liberar', tipo: 'data' },
    cadencia_valor: { perm: 'embarques.editar_cadencia', tipo: 'positivo_obrigatorio' },
    cadencia_unidade: { perm: 'embarques.editar_cadencia', tipo: 'enum', valores: ['veiculos_dia', 'toneladas_dia'] },
    toneladas_por_veiculo: { perm: 'embarques.editar_capacidade', tipo: 'positivo' },
    situacao: { perm: 'embarques.arquivar', tipo: 'enum', valores: ['ativo', 'arquivado'] },
    comercial_id: { perm: 'carteira.editar', tipo: 'uuid' },
  };
  const R_FIN: Record<string, Regra> = {
    frete_empresa: { perm: 'financeiro.editar', tipo: 'dinheiro' },
    frete_motorista: { perm: 'financeiro.editar', tipo: 'dinheiro' },
    unidade_frete: { perm: 'financeiro.editar', tipo: 'enum', valores: ['nao_confirmada', 'rs_tonelada', 'rs_viagem', 'outra'] },
  };

  const listaCadastro = (tipo: string) => ({ filial: db.filiais, comercial: db.comerciais, produto: db.produtos, local: db.locais, cidade: db.cidades!, centro_custo: db.centros_custo!, cliente: db.clientes } as Record<string, Array<{ id: string; nome: string; is_demo: boolean }>>)[tipo];

  function abrir(data: string, transportar: boolean, ids: string[] | null) {
    let criadas = 0, ja = 0, semAnt = 0;
    for (const e of db.embarques) {
      if (e.situacao !== 'ativo' || !veEmbarque(e) || (ids && !ids.includes(e.id))) continue;
      if (db.posicoes.some((p) => p.embarque_id === e.id && p.data_operacional === data)) { ja++; continue; }
      const ant = db.posicoes.filter((p) => p.embarque_id === e.id && p.data_operacional < data)
        .sort((a, b) => b.data_operacional.localeCompare(a.data_operacional))[0];
      if (transportar && !ant) semAnt++;
      const p: Posicao = {
        id: uid(), embarque_id: e.id, data_operacional: data,
        porta: transportar && ant ? ant.porta : 0, transito: transportar && ant ? ant.transito : 0, carregados: 0,
        toneladas_por_veiculo: e.toneladas_por_veiculo, meta_valor: e.cadencia_valor, meta_unidade: e.cadencia_unidade,
        obs_operacional: null, obs_cliente: null, is_demo: e.is_demo, origem: 'abertura', versao: 1,
        atualizado_em: agora(), atualizado_por_nome: nomeUsuario(),
      };
      db.posicoes.push(p);
      registrar({ entidade: 'posicao', registro_id: p.id, embarque_id: e.id, posicao_id: p.id, cliente_id: e.cliente_id,
        data_operacional: data, campo: 'abertura',
        valor_novo: transportar && ant ? `Porta ${ant.porta ?? 'não informado'} e trânsito ${ant.transito ?? 'não informado'} transportados de ${ant.data_operacional.split('-').reverse().join('/')}; carregados iniciado em 0` : 'Porta, trânsito e carregados iniciados em 0' });
      criadas++;
    }
    return { criadas, ja_existiam: ja, sem_posicao_anterior: semAnt };
  }

  const doc = criarDocLocal({
    perfil, tem, veEmbarque, noEscopo,
    embarques: () => db.embarques,
    ehAdmin: () => perfil()?.papel === 'administrador',
    temFiliais: () => db.perfilFiliais.some((x) => x.perfil_id === perfilId),
    cliente: (id) => {
      const c = db.clientes.find((x) => x.id === id);
      return c && veCliente(c) ? { id: c.id, nome: c.nome, comercial_id: c.comercial_id, carteira: db.comerciais.find((x) => x.id === c.comercial_id)?.nome ?? null } : null;
    },
    filial: (id) => {
      const f = db.filiais.find((x) => x.id === id);
      return f ? { id: f.id, nome: f.nome, centro_custo_id: f.centro_custo_id ?? null, centro_custo: db.centros_custo?.find((c) => c.id === f.centro_custo_id)?.nome ?? null } : null;
    },
    retrato: (e) => {
      const n = <T extends { id: string; nome: string }>(xs: T[] | undefined, id: string | null | undefined) => (id ? xs?.find((x) => x.id === id)?.nome ?? null : null);
      const filial = db.filiais.find((f) => f.id === e.filial_id);
      return {
        codigo: e.codigo, cliente: n(db.clientes, e.cliente_id), carteira: n(db.comerciais, e.comercial_id), filial: filial?.nome ?? null,
        centro_custo: n(db.centros_custo, filial?.centro_custo_id), origem_cidade: e.origem_cidade, origem_uf: e.origem_uf,
        coleta: n(db.locais, e.local_coleta_id), destino_cidade: e.destino_cidade, destino_uf: e.destino_uf, entrega: n(db.locais, e.local_entrega_id),
        produto: n(db.produtos, e.produto_id), filial_id: e.filial_id, centro_custo_id: filial?.centro_custo_id ?? null, cliente_id: e.cliente_id,
      };
    },
  });

  const api: Api = {
    modo: 'local',
    doc,

    async sessaoAtual() {
      const p = perfil();
      if (!p) return null;
      const permissoes = new Set<Permissao>(CATALOGO.map((c) => c.chave).filter(tem));
      return { perfil: clone(p), permissoes, filiais: db.perfilFiliais.filter((x) => x.perfil_id === p.id).map((x) => x.filial_id) } as Sessao;
    },
    async entrar(email) {
      const p = db.perfis.find((x) => x.email === email) ?? db.perfis.find((x) => x.id === email);
      if (!p) erro('Perfil de prévia não encontrado.');
      perfilId = p.id;
      gravarStorage(CHAVE_SESSAO, p.id);
      for (const o of ouvintesAuth) o('SIGNED_IN');
    },
    async cadastrar() { erro('Na prévia local não há cadastro de contas. Escolha um dos perfis de demonstração.'); },
    async recuperarSenha() { erro('Indisponível na prévia local.'); },
    async definirNovaSenha() { erro('Indisponível na prévia local.'); },
    async sair() {
      perfilId = null;
      try { localStorage.removeItem(CHAVE_SESSAO); } catch { /* ignora */ }
      for (const o of ouvintesAuth) o('SIGNED_OUT');
    },
    aoMudarAutenticacao(cb) { ouvintesAuth.add(cb); return () => ouvintesAuth.delete(cb); },

    async carregarCadastros(demo) {
      if (!ativo()) return { filiais: [], comerciais: [], clientes: [], produtos: [], locais: [], cidades: [], centros_custo: [] };
      const f = <T extends { is_demo: boolean; nome: string }>(xs: T[]) => clone(xs.filter((x) => x.is_demo === demo)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      return { filiais: f(db.filiais), comerciais: f(db.comerciais), clientes: f(db.clientes.filter(veCliente)), produtos: f(db.produtos), locais: f(db.locais), cidades: f(db.cidades!), centros_custo: f(db.centros_custo!) } as Cadastros;
    },
    async carregarConfiguracoes() { return { ...CONFIG_PADRAO, ...clone(db.config) }; },
    async carregarEmbarques(demo) { encerrarVencidos(); return clone(db.embarques.filter((e) => e.is_demo === demo && veEmbarque(e))); },
    async carregarPosicoes(demo, inicio, fim) {
      const vis = new Set(db.embarques.filter(veEmbarque).map((e) => e.id));
      return clone(db.posicoes.filter((p) => p.is_demo === demo && vis.has(p.embarque_id) && p.data_operacional >= inicio && p.data_operacional <= fim));
    },
    async carregarFinanceiro(demo) {
      if (!tem('financeiro.ver')) return [];
      const vis = new Set(db.embarques.filter((e) => e.is_demo === demo && veEmbarque(e)).map((e) => e.id));
      return clone(db.financeiro.filter((f) => vis.has(f.embarque_id)));
    },
    async carregarHistorico(embarqueId) {
      if (!tem('historico.ver')) return [];
      return clone(db.historico.filter((h) => h.embarque_id === embarqueId && (!h.sensivel || tem('financeiro.ver'))));
    },
    async carregarMeta(demo, data) {
      if (!tem('financeiro.ver')) return null;
      return clone(db.metas.find((m) => m.is_demo === demo && m.data_operacional === data) ?? null);
    },
    async ultimaDataComPosicao(demo, antesDe) {
      const ds = db.posicoes.filter((p) => p.is_demo === demo && p.data_operacional < antesDe).map((p) => p.data_operacional).sort();
      return ds[ds.length - 1] ?? null;
    },
    async dadosOrigem(id) { return tem('importacao.executar') ? clone(db.dadosOrigem[id] ?? null) : null; },

    async atualizarPosicao(id, alt, base, forcar = false) {
      if (!ativo()) erro('Seu acesso ainda não foi aprovado ou está bloqueado.');
      const p = db.posicoes.find((x) => x.id === id);
      const e = p && db.embarques.find((x) => x.id === p.embarque_id);
      if (!p || !e || !veEmbarque(e)) erro('Posição não encontrada ou fora do seu escopo.');
      if (e.situacao === 'arquivado') erro('Embarque arquivado: reative o cadastro para atualizar a posição.');
      const { novo, conflitos } = preparar(p, alt, base, forcar, R_POS);
      if (conflitos.length) return { status: 'conflito', conflitos, registro: clone(p) };
      if (!Object.keys(novo).length) return { status: 'sem_alteracao', registro: clone(p) };
      for (const [k, v] of Object.entries(novo)) {
        registrar({ entidade: 'posicao', registro_id: p.id, embarque_id: e.id, posicao_id: p.id, cliente_id: e.cliente_id,
          data_operacional: p.data_operacional, campo: k, valor_anterior: txt((p as never)[k]), valor_novo: txt(v) });
      }
      const contador = ['porta', 'transito', 'carregados'].some((k) => k in novo);
      Object.assign(p, novo, { versao: p.versao + 1, atualizado_em: agora(), atualizado_por_nome: nomeUsuario() },
        contador ? { confirmado_em: agora(), confirmado_por_nome: nomeUsuario() } : {});
      salvar();
      return { status: 'ok', registro: clone(p) };
    },
    async confirmarPosicao(id, valores, base) {
      // Mesmas regras de public.confirmar_posicao (migração 1400). Sem rede, nada é confirmado.
      if (!navigator.onLine) erro('Failed to fetch');
      exigir('posicoes.editar_contadores');
      const p = db.posicoes.find((x) => x.id === id);
      const e = p && db.embarques.find((x) => x.id === p.embarque_id);
      if (!p || !e || !veEmbarque(e)) erro('Posição não encontrada ou fora do seu escopo.');
      if (e.situacao === 'arquivado') erro('Embarque arquivado: reative o cadastro para atualizar a posição.');
      if (p.data_operacional !== hojeSP()) erro('Só é possível confirmar a posição da data operacional de hoje.');
      const rot = { porta: 'na porta', transito: 'em trânsito', carregados: 'carregados hoje' } as const;
      const novo: Partial<Posicao> = {};
      const conflitos: Conflito[] = [];
      for (const k of ['porta', 'transito', 'carregados'] as const) {
        const v = (valores as unknown as Record<string, unknown>)[k];
        if (v === null || v === undefined) erro(`Informe o número de ${rot[k]} (zero é válido).`);
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100000) erro('Use somente números inteiros maiores ou iguais a zero.');
        if (!(k in base)) erro('Valor de referência ausente.');
        if ((base[k] ?? null) !== p[k]) conflitos.push({ campo: k, rotulo: rot[k], valor_base: base[k] ?? null, valor_atual: p[k], valor_proposto: v });
        if (p[k] !== v) novo[k] = v;
      }
      if (conflitos.length) return { status: 'conflito', conflitos, registro: clone(p) };
      for (const [k, v] of Object.entries(novo)) {
        registrar({ entidade: 'posicao', registro_id: p.id, embarque_id: e.id, posicao_id: p.id, cliente_id: e.cliente_id,
          data_operacional: p.data_operacional, campo: k, valor_anterior: txt((p as never)[k]), valor_novo: txt(v) });
      }
      Object.assign(p, novo, { versao: p.versao + 1, atualizado_em: agora(), atualizado_por_nome: nomeUsuario(), confirmado_em: agora(), confirmado_por_nome: nomeUsuario() });
      registrar({ entidade: 'posicao', registro_id: p.id, embarque_id: e.id, posicao_id: p.id, cliente_id: e.cliente_id, data_operacional: p.data_operacional,
        campo: 'confirmacao', valor_novo: `${Object.keys(novo).length ? 'Posição salva' : 'Confirmada sem alteração'}: na porta ${p.porta}, em trânsito ${p.transito}, carregados hoje ${p.carregados}` });
      salvar();
      return { status: 'ok', registro: clone(p) };
    },
    async agoraServidor() { return agora(); },
    async atualizarEmbarque(id, alt, base, forcar = false) {
      if (!ativo()) erro('Seu acesso ainda não foi aprovado ou está bloqueado.');
      const e = db.embarques.find((x) => x.id === id);
      if (!e || !veEmbarque(e)) erro('Embarque não encontrado ou fora do seu escopo.');
      if (e.encerrado_em) erro('Embarque encerrado: não pode ser reativado nem alterado.');
      if (e.situacao === 'arquivado' && !('situacao' in alt)) erro('Embarque arquivado: reative o cadastro antes de alterá-lo.');
      // Quem criou o embarque pode alterar a meta com a permissão "dos embarques que criei" (mesma regra do servidor).
      const regras = e.criado_por === perfil()?.id && !tem('embarques.editar_cadencia') && tem('embarques.editar_cadencia_proprio')
        ? { ...R_EMB, cadencia_valor: { ...R_EMB.cadencia_valor, perm: 'embarques.editar_cadencia_proprio' as Permissao },
          cadencia_unidade: { ...R_EMB.cadencia_unidade, perm: 'embarques.editar_cadencia_proprio' as Permissao } }
        : R_EMB;
      const { novo, conflitos } = preparar(e, alt, base, forcar, regras);
      if (conflitos.length) return { status: 'conflito', conflitos, registro: clone(e) };
      if (!Object.keys(novo).length) return { status: 'sem_alteracao', registro: clone(e) };
      const n = { ...e, ...novo } as Embarque;
      if (!noEscopo(n.filial_id, n.comercial_id)) erro('A filial ou carteira escolhida está fora do seu escopo.');
      for (const [k, v] of Object.entries(novo)) {
        registrar({ entidade: 'embarque', registro_id: e.id, embarque_id: e.id, cliente_id: n.cliente_id, campo: k,
          valor_anterior: txt((e as never)[k]), valor_novo: txt(v) });
      }
      // Mesmo gatilho da migração 1500: marca e limpa a data da suspensão.
      const suspenso_em = n.status_liberacao === 'suspenso' ? (e.status_liberacao === 'suspenso' ? e.suspenso_em ?? agora() : agora()) : null;
      Object.assign(e, novo, { suspenso_em, versao: e.versao + 1, atualizado_em: agora(), atualizado_por_nome: nomeUsuario() });
      let propagadas = 0;
      if ('toneladas_por_veiculo' in novo || 'cadencia_valor' in novo || 'cadencia_unidade' in novo) {
        for (const p of db.posicoes.filter((x) => x.embarque_id === e.id && x.data_operacional >= hojeSP())) {
          if (p.toneladas_por_veiculo !== e.toneladas_por_veiculo) {
            registrar({ entidade: 'posicao', registro_id: p.id, embarque_id: e.id, posicao_id: p.id, data_operacional: p.data_operacional,
              campo: 'toneladas_por_veiculo', valor_anterior: String(p.toneladas_por_veiculo), valor_novo: String(e.toneladas_por_veiculo), origem: 'sistema' });
          }
          Object.assign(p, { toneladas_por_veiculo: e.toneladas_por_veiculo, meta_valor: e.cadencia_valor, meta_unidade: e.cadencia_unidade, versao: p.versao + 1, atualizado_em: agora() });
          propagadas++;
          emitir({ tabela: 'posicoes_diarias', tipo: 'UPDATE', registro: clone(p) });
        }
      }
      salvar();
      return { status: 'ok', registro: clone(e), posicoes_atualizadas: propagadas };
    },
    async encerrarEmbarque(id, motivo) {
      exigir('embarques.encerrar');
      const e = db.embarques.find((x) => x.id === id);
      if (!e || !veEmbarque(e)) erro('Embarque não encontrado ou fora do seu escopo.');
      if (e.encerrado_em) erro('Embarque já encerrado.');
      const m = motivo?.trim() || null;
      if (m && m.length > 500) erro('Motivo muito longo (máximo de 500 caracteres).');
      encerrar(e, m, nomeUsuario());
      salvar();
      return clone(e);
    },
    async atualizarFinanceiro(id, alt, base, forcar = false) {
      exigir('financeiro.ver');
      exigir('financeiro.editar');
      const e = db.embarques.find((x) => x.id === id);
      if (!e || !veEmbarque(e)) erro('Embarque não encontrado ou fora do seu escopo.');
      let f = db.financeiro.find((x) => x.embarque_id === id);
      if (!f) { f = { embarque_id: id, frete_empresa: null, frete_motorista: null, unidade_frete: 'rs_tonelada', frete_empresa_original: null, frete_motorista_original: null, versao: 1, atualizado_em: agora() }; db.financeiro.push(f); }
      const { novo, conflitos } = preparar(f, alt, base, forcar, R_FIN);
      if (conflitos.length) return { status: 'conflito', conflitos, registro: clone(f) };
      if (!Object.keys(novo).length) return { status: 'sem_alteracao', registro: clone(f) };
      for (const [k, v] of Object.entries(novo)) {
        registrar({ entidade: 'financeiro', registro_id: id, embarque_id: id, cliente_id: e.cliente_id, campo: k,
          valor_anterior: txt((f as never)[k]), valor_novo: txt(v), sensivel: true });
      }
      Object.assign(f, novo, { versao: f.versao + 1, atualizado_em: agora() });
      salvar();
      return { status: 'ok', registro: clone(f) };
    },
    async criarEmbarque(d, demo) {
      exigir('embarques.criar');
      const cli = db.clientes.find((c) => c.id === d.cliente_id);
      if (!cli || !d.filial_id || !d.origem_cidade || !d.destino_cidade) erro('Cliente, filial, cidade de origem e cidade de destino são obrigatórios.');
      const comercial = 'comercial_id' in d ? (d.comercial_id as string | null) : cli.comercial_id;
      if (comercial !== cli.comercial_id) exigir('carteira.editar');
      const cap = (d.toneladas_por_veiculo as number) ?? db.config.capacidade_padrao_t;
      if (cap !== db.config.capacidade_padrao_t) exigir('embarques.editar_capacidade');
      if (typeof d.cadencia_valor !== 'number' || !(d.cadencia_valor > 0)) erro('Informe a meta diária do embarque (veículos ou toneladas por dia).');
      if (!tem('embarques.editar_cadencia') && !tem('embarques.editar_cadencia_proprio')) erro('Você não tem permissão para definir a meta diária do embarque.');
      const loteErp = typeof d.lote_erp === 'string' ? d.lote_erp.trim() : '';
      if (loteErp.length > 60) erro('O número do lote do ERP tem no máximo 60 caracteres.');
      if (d.status_liberacao && d.status_liberacao !== 'nao_informado') exigir('embarques.liberar');
      if (!noEscopo(d.filial_id as string, comercial)) erro('A filial ou carteira escolhida está fora do seu escopo.');
      db.seq++;
      const e: Embarque = {
        id: uid(), codigo: db.seq, cliente_id: cli.id, comercial_id: comercial, filial_id: d.filial_id as string,
        produto_id: (d.produto_id as string) ?? null, origem_cidade: String(d.origem_cidade).trim(),
        origem_uf: d.origem_uf ? String(d.origem_uf).toUpperCase() : null, local_coleta_id: (d.local_coleta_id as string) ?? null,
        destino_cidade: String(d.destino_cidade).trim(), destino_uf: d.destino_uf ? String(d.destino_uf).toUpperCase() : null,
        local_entrega_id: (d.local_entrega_id as string) ?? null, status_liberacao: (d.status_liberacao as Embarque['status_liberacao']) ?? 'nao_informado',
        data_liberacao: (d.data_liberacao as string) ?? null, cadencia_valor: (d.cadencia_valor as number) ?? null,
        cadencia_unidade: (d.cadencia_unidade as Embarque['cadencia_unidade']) ?? 'veiculos_dia', toneladas_por_veiculo: cap,
        observacao_interna: (d.observacao_interna as string) ?? null, situacao: 'ativo', is_demo: demo, chave_importacao: null,
        versao: 1, atualizado_em: agora(), atualizado_por_nome: nomeUsuario(), criado_por: perfil()?.id ?? null,
      };
      db.embarques.push(e);
      const fin = (d.financeiro ?? {}) as Partial<Financeiro>;
      if (Object.keys(fin).length) { exigir('financeiro.editar'); }
      db.financeiro.push({ embarque_id: e.id, frete_empresa: fin.frete_empresa ?? null, frete_motorista: fin.frete_motorista ?? null,
        unidade_frete: fin.unidade_frete ?? 'rs_tonelada', frete_empresa_original: null, frete_motorista_original: null, versao: 1, atualizado_em: agora() });
      registrar({ entidade: 'embarque', registro_id: e.id, embarque_id: e.id, cliente_id: e.cliente_id, campo: 'criacao',
        valor_novo: `Embarque EMB-${String(e.codigo).padStart(6, '0')} criado` });
      if (d.abrir_posicao_em) abrir(String(d.abrir_posicao_em), false, [e.id]);
      salvar();
      if (loteErp) {
        doc.registrarLoteInicial(e.id, loteErp, nomeUsuario() ?? 'Usuário');
        registrar({ entidade: 'embarque', registro_id: e.id, embarque_id: e.id, cliente_id: e.cliente_id, campo: 'lote_erp', valor_novo: loteErp });
        salvar();
      }
      return clone(e);
    },
    async abrirPosicoes(data, transportar, ids) {
      exigir('posicoes.abrir');
      if (data > somarDias(hojeSP(), 1)) erro('Só é possível abrir posições até o dia seguinte.');
      const r = abrir(data, transportar, ids);
      salvar();
      return r;
    },
    async obterLocal(nomeL, cidade, uf, tipo, demo) {
      if (!tem('embarques.criar') && !tem('embarques.editar_cadastro') && !tem('cadastros.gerenciar')) exigir('embarques.criar');
      if (!nomeL.trim()) return null;
      const achado = db.locais.find((l) => l.is_demo === demo && normalizar(l.nome) === normalizar(nomeL) && normalizar(l.cidade) === normalizar(cidade));
      if (achado) {
        if (achado.tipo !== tipo && achado.tipo !== 'ambos') { achado.tipo = 'ambos'; salvar(); }
        return achado.id;
      }
      const novo: Local = { id: uid(), nome: nomeL.trim(), cidade: cidade?.trim() || null, uf: uf?.trim().toUpperCase() || null, tipo, ativo: true, is_demo: demo };
      db.locais.push(novo);
      salvar();
      return novo.id;
    },
    async obterCidade(nomeC, uf, demo) {
      if (!tem('embarques.criar') && !tem('embarques.editar_cadastro') && !tem('cadastros.gerenciar')) exigir('embarques.criar');
      if (!nomeC.trim()) return null;
      const u = uf?.trim().toUpperCase() || null;
      const achada = db.cidades!.find((c) => c.is_demo === demo && normalizar(c.nome) === normalizar(nomeC) && c.uf === u);
      if (achada) return achada.id;
      const nova: Cidade = { id: uid(), nome: nomeC.trim(), uf: u, uso: 'ambos', ativo: true, is_demo: demo };
      db.cidades!.push(nova);
      salvar();
      return nova.id;
    },
    consultarCnpj: (cnpj) => consultarCnpjBrasilApi(cnpj),
    async precoCna() { erro('A consulta de preços da CNA funciona só no app oficial (precisa do servidor).'); },
    async buscarLogos() { erro('A busca de logo pelo site funciona só no app oficial (precisa do servidor). Na prévia, envie a imagem.'); },
    async salvarCadastro(tipo, id, dados, demo) {
      exigir('cadastros.gerenciar');
      const lista = listaCadastro(tipo);
      if (!lista) erro('Tipo de cadastro inválido.');
      if (typeof dados.documento === 'string') dados = { ...dados, documento: dados.documento.replace(/\D/g, '') };
      if (typeof dados.uf === 'string') dados = { ...dados, uf: dados.uf.trim().toUpperCase() || null };
      if (tipo === 'cliente') {
        const atual = (id ? lista.find((y) => y.id === id) : {}) as Record<string, unknown>;
        const final = { ...atual, ...dados };
        // Mesmas regras do servidor: na edição só valem para os campos alterados.
        const exige = (k: string) => !id || k in dados;
        if (exige('documento') && !cnpjValido(final.documento as string)) erro('Informe um CNPJ válido.');
        if (exige('telefone_comercial') && !String(final.telefone_comercial ?? '').trim()) erro('Telefone de contato comercial é obrigatório.');
        if ((exige('comercial_id') || exige('restricao_comercial')) && !final.comercial_id && !naoCarregar(final.restricao_comercial as string)) erro('Informe o comercial responsável pelo cliente.');
        if (db.clientes.some((x) => x.id !== id && x.is_demo === demo && x.documento === final.documento)) erro('Já existe um cliente com este CNPJ.');
      }
      if (dados.nome !== undefined) {
        const n = normalizar(dados.nome);
        if (!n) erro('Nome é obrigatório.');
        if (lista.some((x) => x.id !== id && x.is_demo === demo && normalizar(x.nome) === n
          && (tipo !== 'local' || normalizar((x as unknown as Local).cidade) === normalizar(dados.cidade ?? (lista.find((y) => y.id === id) as unknown as Local)?.cidade)))) {
          erro('Já existe um cadastro com este nome.');
        }
      }
      if (id) {
        const x = lista.find((y) => y.id === id) as Record<string, unknown> | undefined;
        if (!x) erro('Cadastro não encontrado.');
        if (tipo === 'cliente' && 'comercial_id' in dados && dados.comercial_id !== x.comercial_id) {
          exigir('carteira.editar');
          registrar({ entidade: 'cliente', registro_id: id, cliente_id: id, campo: 'comercial_id', valor_anterior: txt(x.comercial_id), valor_novo: txt(dados.comercial_id) });
        }
        Object.assign(x, dados);
        if (tipo === 'filial') sincronizarTodos(db);
        salvar();
        return clone(x);
      }
      if (tipo === 'cliente' && dados.comercial_id) exigir('carteira.editar');
      const base: Record<string, unknown> = { filial: { codigo: null, centro_custo_id: null }, comercial: { email: null }, produto: {}, local: { cidade: null, uf: null, tipo: 'ambos' }, cidade: { uf: null, uso: 'ambos' }, centro_custo: {},
        cliente: { documento: null, comercial_id: null, restricao_comercial: null } }[tipo]!;
      const novo = { id: uid(), ativo: true, is_demo: demo, ...base, ...dados };
      (lista as unknown[]).push(novo);
      if (tipo === 'filial') sincronizarTodos(db);
      salvar();
      return clone(novo);
    },
    async salvarConfiguracao(chave, valor) {
      exigir('configuracoes.gerenciar');
      if (chave === 'logo_empresa' && valor !== null && (typeof valor !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(valor) || valor.length > 300000)) {
        erro('Envie a logo como imagem PNG, JPEG ou WebP de até 200 KB.');
      }
      (db.config as unknown as Record<string, unknown>)[chave] = valor;
      registrar({ entidade: 'configuracao', campo: chave, valor_novo: chave === 'logo_empresa' ? (valor ? 'imagem nova' : null) : JSON.stringify(valor) });
      salvar();
    },
    async salvarMeta(m) {
      exigir('financeiro.editar');
      db.metas = db.metas.filter((x) => !(x.data_operacional === m.data_operacional && x.is_demo === m.is_demo));
      db.metas.push(clone(m));
      salvar();
    },

    async listarLinks(clienteId) {
      if (!tem('compartilhamento.links')) return [];
      return clone(db.links.filter((l) => l.cliente_id === clienteId)).map(({ token: _t, ...l }) => { void _t; return l; })
        .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
    },
    async criarLink(clienteId, horas, carregados, volumes, descricao) {
      exigir('compartilhamento.links');
      if (horas < 1 || horas > 720) erro('A validade deve estar entre 1 hora e 30 dias.');
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const l = { id: uid(), cliente_id: clienteId, token, token_prefixo: token.slice(0, 6), descricao, mostrar_carregados: carregados,
        mostrar_volumes: volumes, expira_em: new Date(Date.now() + horas * 3600e3).toISOString(), revogado_em: null,
        ultimo_acesso_em: null, acessos: 0, criado_em: agora(), is_demo: true };
      db.links.push(l);
      salvar();
      return { id: l.id, token, expira_em: l.expira_em };
    },
    async revogarLink(id) {
      exigir('compartilhamento.links');
      const l = db.links.find((x) => x.id === id);
      if (l && !l.revogado_em) { l.revogado_em = agora(); salvar(); }
    },
    async posicaoPublica(token) {
      const l = db.links.find((x) => x.token === token);
      if (!l) return { status: 'invalido' };
      if (l.revogado_em) return { status: 'revogado' };
      if (l.expira_em <= agora()) return { status: 'expirado' };
      l.acessos++; l.ultimo_acesso_em = agora(); salvar();
      const cli = db.clientes.find((c) => c.id === l.cliente_id)!;
      const embs = db.embarques.filter((e) => e.cliente_id === cli.id && e.situacao === 'ativo');
      const ps = db.posicoes.filter((p) => embs.some((e) => e.id === p.embarque_id) && p.data_operacional <= hojeSP());
      const data = ps.map((p) => p.data_operacional).sort().pop() ?? null;
      const grupos = new Map<string, NonNullable<PosicaoPublica['itens']>[number]>();
      let atualizado: string | null = null;
      for (const p of ps.filter((x) => x.data_operacional === data)) {
        const e = embs.find((x) => x.id === p.embarque_id)!;
        const nomeL = (id: string | null) => db.locais.find((x) => x.id === id)?.nome;
        const origem = e.origem_cidade + (e.origem_uf ? `/${e.origem_uf}` : '');
        const destino = e.destino_cidade + (e.destino_uf ? `/${e.destino_uf}` : '');
        const produto = db.produtos.find((x) => x.id === e.produto_id)?.nome;
        const k = [origem, nomeL(e.local_coleta_id), destino, nomeL(e.local_entrega_id), produto].join('|');
        const g = grupos.get(k) ?? { origem, coleta: nomeL(e.local_coleta_id), destino, entrega: nomeL(e.local_entrega_id), produto, porta: 0, transito: 0, embarques: 0 };
        g.porta = (g.porta ?? 0) + (p.porta ?? 0);
        g.transito = (g.transito ?? 0) + (p.transito ?? 0);
        if (l.mostrar_carregados) g.carregados = (g.carregados ?? 0) + (p.carregados ?? 0);
        if (l.mostrar_volumes) {
          g.volume_porta_t = (g.volume_porta_t ?? 0) + (p.porta ?? 0) * p.toneladas_por_veiculo;
          g.volume_transito_t = (g.volume_transito_t ?? 0) + (p.transito ?? 0) * p.toneladas_por_veiculo;
          if (l.mostrar_carregados) g.volume_carregado_t = (g.volume_carregado_t ?? 0) + (p.carregados ?? 0) * p.toneladas_por_veiculo;
        }
        if (p.obs_cliente) g.observacao = g.observacao ? `${g.observacao} | ${p.obs_cliente}` : p.obs_cliente;
        g.embarques++;
        grupos.set(k, g);
        if (!atualizado || p.atualizado_em > atualizado) atualizado = p.atualizado_em;
      }
      return { status: 'ok', cliente: cli.nome, demonstrativo: true, data_operacional: data, atualizado_em: atualizado, consultado_em: agora(),
        link_expira_em: l.expira_em, mostrar_carregados: l.mostrar_carregados, mostrar_volumes: l.mostrar_volumes, itens: [...grupos.values()] };
    },

    async importarPlanilha(payload) {
      exigir('importacao.executar');
      const demo = true;
      const data = String(payload.data_operacional ?? '');
      if (!data) erro('Informe a data operacional dos dados importados.');
      const rel: RelatorioImportacao = { clientes_criados: 0, comerciais_criados: 0, embarques_criados: 0, embarques_vinculados: 0, posicoes_criadas: 0,
        posicoes_atualizadas: 0, posicoes_iguais: 0, posicoes_divergentes: 0, avisos: [], importacao_id: uid(), financeiro_importado: tem('financeiro.editar'),
        arquivo_ja_importado: db.importacoes.some((i) => i.hash === payload.arquivo_hash && i.data === data) };
      const obter = <T extends { id: string; nome: string; is_demo: boolean }>(lista: T[], nomeV: unknown, extra: Partial<T> = {}, cidade?: unknown): string | null => {
        const n = normalizar(nomeV);
        if (!n) return null;
        const achado = lista.find((x) => x.is_demo === demo && normalizar(x.nome) === n && (cidade === undefined || normalizar((x as unknown as Local).cidade) === normalizar(cidade)));
        if (achado) return achado.id;
        const novo = { id: uid(), nome: String(nomeV).trim(), ativo: true, is_demo: demo, ...extra } as unknown as T;
        lista.push(novo);
        return novo.id;
      };
      const nCom = db.comerciais.length, nCli = db.clientes.length;
      for (const f of (payload.filiais as string[]) ?? []) obter(db.filiais, f, { codigo: null } as never);
      for (const c of (payload.clientes as Array<{ nome: string; carteira: string | null; restricao: string | null }>) ?? []) {
        const com = c.carteira ? obter(db.comerciais, c.carteira, { email: null } as never) : null;
        if (!db.clientes.some((x) => x.is_demo === demo && normalizar(x.nome) === normalizar(c.nome))) {
          db.clientes.push({ id: uid(), nome: c.nome.trim(), documento: null, comercial_id: com, restricao_comercial: c.restricao, ativo: true, is_demo: demo });
        }
      }
      for (const l of (payload.linhas as Array<Record<string, unknown>>) ?? []) {
        const com = l.carteira ? obter(db.comerciais, l.carteira, { email: null } as never) : null;
        let cliId = db.clientes.find((x) => x.is_demo === demo && normalizar(x.nome) === normalizar(l.cliente))?.id;
        if (!cliId) { cliId = uid(); db.clientes.push({ id: cliId, nome: String(l.cliente).trim(), documento: null, comercial_id: com, restricao_comercial: null, ativo: true, is_demo: demo }); }
        let e = db.embarques.find((x) => x.is_demo === demo && x.chave_importacao === l.chave);
        if (!e) {
          db.seq++;
          e = {
            id: uid(), codigo: db.seq, cliente_id: cliId, comercial_id: com ?? db.clientes.find((x) => x.id === cliId)!.comercial_id,
            filial_id: obter(db.filiais, l.filial, { codigo: null } as never)!, produto_id: obter(db.produtos, l.produto),
            origem_cidade: String(l.origem_cidade), origem_uf: (l.origem_uf as string) ?? null,
            local_coleta_id: obter(db.locais, l.coleta, { cidade: l.origem_cidade, uf: l.origem_uf ?? null, tipo: 'coleta' } as never, l.origem_cidade),
            destino_cidade: String(l.destino_cidade), destino_uf: (l.destino_uf as string) ?? null,
            local_entrega_id: obter(db.locais, l.entrega, { cidade: l.destino_cidade, uf: l.destino_uf ?? null, tipo: 'entrega' } as never, l.destino_cidade),
            status_liberacao: (l.status as Embarque['status_liberacao']) ?? 'nao_informado', data_liberacao: null,
            cadencia_valor: (l.cadencia_valor as number) ?? null, cadencia_unidade: 'veiculos_dia', toneladas_por_veiculo: db.config.capacidade_padrao_t,
            observacao_interna: null, situacao: 'ativo', is_demo: demo, chave_importacao: String(l.chave), versao: 1, atualizado_em: agora(), atualizado_por_nome: nomeUsuario(),
          };
          db.embarques.push(e);
          db.financeiro.push({ embarque_id: e.id, frete_empresa: tem('financeiro.editar') ? (l.frete_empresa as number) ?? null : null,
            frete_motorista: tem('financeiro.editar') ? (l.frete_motorista as number) ?? null : null, unidade_frete: 'rs_tonelada',
            frete_empresa_original: (l.frete_empresa_original as string) ?? null, frete_motorista_original: (l.frete_motorista_original as string) ?? null, versao: 1, atualizado_em: agora() });
          rel.embarques_criados++;
        } else rel.embarques_vinculados++;
        if (l.extras && Object.keys(l.extras as object).length) db.dadosOrigem[e.id] = { ...(db.dadosOrigem[e.id] ?? {}), ...(l.extras as object) };
        const cont = { porta: (l.porta as number) ?? null, transito: (l.transito as number) ?? null, carregados: (l.carregados as number) ?? null, obs_operacional: (l.obs_operacional as string) ?? null, obs_cliente: (l.obs_cliente as string) ?? null };
        const p = db.posicoes.find((x) => x.embarque_id === e!.id && x.data_operacional === data);
        if (!p) {
          db.posicoes.push({ id: uid(), embarque_id: e.id, data_operacional: data, ...cont, toneladas_por_veiculo: e.toneladas_por_veiculo,
            meta_valor: e.cadencia_valor, meta_unidade: e.cadencia_unidade, is_demo: demo, origem: 'importacao', versao: 1, atualizado_em: agora(), atualizado_por_nome: nomeUsuario() });
          rel.posicoes_criadas++;
        } else {
          const dif = Object.entries(cont).filter(([k, v]) => (p as never)[k] !== v);
          if (!dif.length) rel.posicoes_iguais++;
          else if (!payload.sobrescrever_posicoes) { rel.posicoes_divergentes++; rel.avisos.push(`Linha ${l.linha}: posição já existe com valores diferentes. Mantida a do app.`); }
          else { Object.assign(p, Object.fromEntries(dif), { versao: p.versao + 1, atualizado_em: agora() }); rel.posicoes_atualizadas++; }
        }
      }
      rel.comerciais_criados = db.comerciais.length - nCom;
      rel.clientes_criados = db.clientes.length - nCli;
      db.importacoes.push({ hash: String(payload.arquivo_hash), data });
      salvar();
      return rel;
    },
    async embarquesPorChave(chaves) {
      return db.embarques.filter((e) => e.chave_importacao && chaves.includes(e.chave_importacao)).map(({ id, codigo, chave_importacao }) => ({ id, codigo, chave_importacao }));
    },

    async listarUsuarios(): Promise<UsuarioAdmin[]> {
      exigir('usuarios.gerenciar');
      return db.perfis.map((p) => ({ ...clone(p), centros: (db.perfilCentros ?? []).filter((x) => x.perfil_id === p.id).map((x) => x.centro_custo_id),
        filiais: db.perfilFiliais.filter((x) => x.perfil_id === p.id).map((x) => x.filial_id),
        permissoes: Object.fromEntries(db.perfilPermissoes.filter((x) => x.perfil_id === p.id).map((x) => [x.chave, x.permitido])) }));
    },
    async atualizarUsuario(id, d) {
      exigir('usuarios.gerenciar');
      const p = db.perfis.find((x) => x.id === id);
      if (!p) erro('Usuário não encontrado.');
      const admins = db.perfis.filter((x) => x.papel === 'administrador' && x.status === 'ativo');
      if (p.papel === 'administrador' && admins.length <= 1 && ((d.papel && d.papel !== 'administrador') || (d.status && d.status !== 'ativo'))) erro('Não é possível remover o último administrador ativo.');
      if (d.status && d.status !== p.status && (d.status === 'bloqueado' || p.status === 'bloqueado') && !tem('usuarios.inativar')) erro('Somente o administrador pode inativar ou reativar usuários.');
      if (d.nome !== undefined) p.nome = d.nome;
      if (d.telefone !== undefined) p.telefone = d.telefone?.trim().slice(0, 40) || null;
      if (d.papel) p.papel = d.papel;
      if (d.status) p.status = d.status;
      if (d.centros) {
        if (!d.centros.length && p.papel !== 'administrador') erro('Escolha ao menos um centro de custo.');
        db.perfilCentros = (db.perfilCentros ?? []).filter((x) => x.perfil_id !== id).concat(d.centros.map((c) => ({ perfil_id: id, centro_custo_id: c })));
        sincronizarEscopo(db, id);
      }
      if (d.permissoes) {
        for (const [k, v] of Object.entries(d.permissoes)) {
          db.perfilPermissoes = db.perfilPermissoes.filter((x) => !(x.perfil_id === id && x.chave === k));
          if (v !== null) db.perfilPermissoes.push({ perfil_id: id, chave: k as Permissao, permitido: v });
        }
      }
      registrar({ entidade: 'usuario', registro_id: id, campo: 'acesso', valor_novo: JSON.stringify(d) });
      salvar();
      for (const o of ouvintesAuth) o('USER_UPDATED');
    },
    async listarConvites() { exigir('usuarios.gerenciar'); return clone(db.convites); },
    async criarConvite(d) {
      exigir('usuarios.gerenciar');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) erro('Informe um e-mail válido.');
      if (!d.centros.length && d.papel !== 'administrador') erro('Escolha ao menos um centro de custo.');
      db.convites.push({ id: uid(), email: d.email.toLowerCase(), nome: d.nome ?? null, telefone: d.telefone?.trim() || null, papel: d.papel, comercial_id: null, centros: d.centros,
        filiais: [], permissoes: {}, expira_em: new Date(Date.now() + 14 * 864e5).toISOString(), usado_em: null, criado_em: agora() });
      salvar();
    },
    async excluirConvite(id) { exigir('usuarios.gerenciar'); db.convites = db.convites.filter((c) => c.id !== id); salvar(); },
    async enviarConviteEmail(email) {
      exigir('usuarios.gerenciar');
      if (!db.convites.some((c) => c.email === email.toLowerCase() && !c.usado_em)) erro('Não há convite aberto para este e-mail.');
    },
    async enviarLinkSenha() { exigir('usuarios.gerenciar'); },
    async alterarEmailUsuario(id, email) {
      exigir('usuarios.gerenciar');
      const p = db.perfis.find((x) => x.id === id);
      if (!p) erro('Usuário não encontrado.');
      const novo = email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(novo)) erro('Informe um e-mail válido.');
      if (p!.email?.toLowerCase() === novo) erro('Este já é o e-mail do usuário.');
      if (db.perfis.some((x) => x.id !== id && x.email?.toLowerCase() === novo)) erro('Este e-mail já é usado por outro usuário.');
      if (db.convites.some((c) => c.email === novo && !c.usado_em)) erro('Há um convite aberto para este e-mail. Exclua o convite antes.');
      if (p!.papel === 'administrador' && perfil()?.papel !== 'administrador') erro('Somente administradores podem alterar o e-mail de um administrador.');
      p!.email = novo;
      salvar();
    },
    async excluirUsuario(id) {
      exigir('usuarios.excluir');
      const p = db.perfis.find((x) => x.id === id);
      if (!p) erro('Usuário não encontrado.');
      if (id === perfilId) erro('Você não pode excluir o seu próprio usuário.');
      const admins = db.perfis.filter((x) => x.papel === 'administrador' && x.status === 'ativo');
      if (p!.papel === 'administrador' && p!.status === 'ativo' && admins.length <= 1) erro('Não é possível excluir o último administrador ativo.');
      if (db.historico.some((h) => h.usuario_nome === p!.nome) || db.embarques.some((e) => (e as { criado_por?: string | null }).criado_por === id)) {
        erro('Este usuário já tem registros no app (embarques, posições, demandas ou histórico). Para manter quem fez o quê, use Inativar.');
      }
      registrar({ entidade: 'usuario', registro_id: id, campo: 'excluido', valor_anterior: `${p!.nome} (${p!.email}, ${p!.papel})` });
      db.convites = db.convites.filter((c) => c.email !== p!.email?.toLowerCase());
      db.perfis = db.perfis.filter((x) => x.id !== id);
      db.perfilFiliais = db.perfilFiliais.filter((x) => x.perfil_id !== id);
      db.perfilCentros = (db.perfilCentros ?? []).filter((x) => x.perfil_id !== id);
      db.perfilPermissoes = db.perfilPermissoes.filter((x) => x.perfil_id !== id);
      salvar();
    },
    async confirmarLinkEmail() { return null; },
    async listarPermissoesUsuarios() {
      exigir('permissoes.gerenciar');
      return db.perfis.map((p) => ({ id: p.id, nome: p.nome, email: p.email, papel: p.papel, status: p.status,
        permissoes: Object.fromEntries(db.perfilPermissoes.filter((x) => x.perfil_id === p.id).map((x) => [x.chave, x.permitido])) }))
        .sort((a, b) => (a.nome || a.email || '').localeCompare(b.nome || b.email || '', 'pt-BR'));
    },
    async salvarPermissoesUsuario(id, permissoes) {
      exigir('permissoes.gerenciar');
      const p = db.perfis.find((x) => x.id === id);
      if (!p) erro('Usuário não encontrado.');
      const admin = perfil()?.papel === 'administrador';
      if (p.papel === 'administrador') erro('Administrador já tem todas as permissões.');
      if (p.id === perfilId && !admin) erro('Você não pode alterar as suas próprias permissões.');
      for (const [k, v] of Object.entries(permissoes)) {
        if (!CATALOGO.some((c) => c.chave === k)) erro(`Permissão "${k}" não existe.`);
        if (!admin && v === true) {
          if (k === 'usuarios.gerenciar' || k === 'permissoes.gerenciar') erro('Somente administradores concedem acesso à gestão de usuários e de permissões.');
          if (!tem(k as Permissao)) erro(`Você só pode conceder permissões que você também tem (${k}).`);
        }
      }
      for (const [k, v] of Object.entries(permissoes)) {
        const ant = db.perfilPermissoes.find((x) => x.perfil_id === id && x.chave === k)?.permitido ?? null;
        db.perfilPermissoes = db.perfilPermissoes.filter((x) => !(x.perfil_id === id && x.chave === k));
        if (v !== null && v !== undefined) db.perfilPermissoes.push({ perfil_id: id, chave: k as Permissao, permitido: v });
        if (ant !== (v ?? null)) registrar({ entidade: 'usuario', registro_id: id, campo: `permissao:${k}`, valor_anterior: ant === null ? 'padrão do papel' : String(ant), valor_novo: v == null ? 'padrão do papel' : String(v) });
      }
      salvar();
      for (const o of ouvintesAuth) o('USER_UPDATED');
      return Object.fromEntries(db.perfilPermissoes.filter((x) => x.perfil_id === id).map((x) => [x.chave, x.permitido]));
    },
    async matrizPermissoes() { return { catalogo: CATALOGO, papeis: clone(db.papelPermissoes) }; },
    async salvarPermissaoPapel(papel, chave, permitido) {
      exigir('usuarios.gerenciar');
      if (perfil()?.papel !== 'administrador') erro('Somente administradores alteram a matriz de permissões.');
      db.papelPermissoes = db.papelPermissoes.filter((x) => !(x.papel === papel && x.chave === chave));
      if (permitido) db.papelPermissoes.push({ papel, chave });
      salvar();
      for (const o of ouvintesAuth) o('USER_UPDATED');
    },
    async carregarDadosDemo() {
      const sessao = perfilId;
      db = semearPrevia();
      perfilId = sessao;
      salvar();
      emitir({ tabela: 'recarregar', tipo: 'TUDO' });
    },
    async limparDadosDemo() { erro('Na prévia local todos os dados são demonstrativos. Use "Restaurar dados da prévia".'); },

    assinar(aoEvento, aoEstado) {
      ouvintesDados.add(aoEvento);
      aoEstado(navigator.onLine ? 'conectado' : 'offline');
      // Outras abas do mesmo navegador simulam outros usuários em tempo real.
      const st = (ev: StorageEvent) => {
        if (ev.key !== CHAVE || !ev.newValue) return;
        try { db = JSON.parse(ev.newValue) as Banco; } catch { return; }
        aoEvento({ tabela: 'recarregar', tipo: 'TUDO' });
      };
      const off = () => aoEstado('offline');
      const on = () => aoEstado('conectado');
      window.addEventListener('storage', st);
      window.addEventListener('offline', off);
      window.addEventListener('online', on);
      return () => {
        ouvintesDados.delete(aoEvento);
        window.removeEventListener('storage', st);
        window.removeEventListener('offline', off);
        window.removeEventListener('online', on);
      };
    },
  };
  return api;
}

const PERFIS_DEMO = [
  { email: 'administrador@previa.local', papel: 'administrador', rotulo: 'Administrador', descricao: 'Acesso completo' },
  { email: 'gestor@previa.local', papel: 'gestor', rotulo: 'Gestor', descricao: 'Centro Gerencial (todas as filiais): cadastra, suspende e encerra embarques, com financeiro' },
  { email: 'supervisor@previa.local', papel: 'supervisor', rotulo: 'Supervisor', descricao: 'Centros de custo das filiais Jataí e Itumbiara: posições de embarque e cadastro de embarques' },
  { email: 'embarcador@previa.local', papel: 'embarcador', rotulo: 'Embarcador', descricao: 'Centro de custo da filial Montividiu: cadastra embarques, pede lote e emissão, vê frete motorista e margem' },
  { email: 'apoio@previa.local', papel: 'apoio', rotulo: 'Apoio Operacional', descricao: 'Centro Gerencial (todas as filiais): fila de lote e emissão, contadores e observação operacional' },
  { email: 'comercial@previa.local', papel: 'comercial', rotulo: 'Coordenador Comercial', descricao: 'Centro Gerencial (todas as filiais): cadastra embarques e suspende fretes' },
  { email: 'consulta@previa.local', papel: 'consulta', rotulo: 'Consulta interna', descricao: 'Somente leitura nos centros de custo das filiais Rio Verde e Jataí' },
] as const;
const ESCOPO_EQUIPE = (x: (typeof EQUIPE_PREVIA)[number]) =>
  PAPEIS_GERENCIAL.includes(x.papel) ? 'Centro Gerencial (todas as filiais)' : `Centro de custo da filial ${(x.filiais as string[]).join(' e ')}`;
/** Perfis para simular na prévia, agrupados pela função (3 por função). */
export const PERFIS_PREVIA: Array<{ email: string; papel: Papel; rotulo: string; descricao: string }> = PERFIS_DEMO.flatMap((d) => [
  { email: d.email, papel: d.papel as Papel, rotulo: `${d.rotulo} (demonstração)`, descricao: d.descricao },
  ...EQUIPE_PREVIA.filter((x) => x.papel === d.papel).map((x) => ({ email: emailEquipe(x.nome), papel: x.papel, rotulo: x.nome, descricao: ESCOPO_EQUIPE(x) })),
]);
