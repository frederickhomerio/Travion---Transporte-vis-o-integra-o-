// Documentação na prévia local: mesmas regras das funções da migração 1610, dados fictícios no navegador.
// Metadados em localStorage (outras abas simulam outros usuários em tempo real) e arquivos em IndexedDB.

import type {
  AnexoDoc, CategoriaAnexo, Embarque, LoteErp, MensagemDoc, NotificacaoApp, Perfil, Permissao, RetratoDoc, SolicitacaoDoc,
} from '../types';
import type { ApiDoc, ArquivoDoc, EventoDoc, ResultadoDoc } from './api';
import { LIMITE_CADASTRO, MAX_MOTORISTA, MAX_VEICULO, TIPOS_CADASTRO, telefoneValido, tipoCadastro } from '../lib/documentacao';

const CHAVE = 'travion-previa-doc-v2';
const TIPOS = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
const LIMITE = 15 * 1024 * 1024;
const PLACA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const SAIDA: CategoriaAnexo[] = ['cte', 'mdfe', 'outro_emitido'];

interface ObjetoArq { caminho: string; dono: string; tipo: string; tamanho: number }
interface BancoDoc {
  seq: number;
  solicitacoes: SolicitacaoDoc[]; lotes: LoteErp[]; mensagens: MensagemDoc[]; anexos: AnexoDoc[];
  notificacoes: Array<NotificacaoApp & { destinatario_id: string; chave: string }>;
  objetos: ObjetoArq[];
}

export interface CtxDocLocal {
  perfil(): Perfil | null;
  tem(p: Permissao): boolean;
  embarques(): Embarque[];
  veEmbarque(e: Embarque): boolean;
  retrato(e: Embarque): Omit<RetratoDoc, 'lote_numero'>;
  noEscopo(filial: string, comercial: string | null): boolean;
  ehAdmin(): boolean;
  /** O usuário tem filiais no perfil (então precisa escolher uma no cadastro). */
  temFiliais(): boolean;
  /** Cliente que o usuário pode ver (null se não existe ou está fora do alcance). */
  cliente(id: string): { id: string; nome: string; comercial_id: string | null; carteira: string | null } | null;
  filial(id: string): { id: string; nome: string; centro_custo_id: string | null; centro_custo: string | null } | null;
}

const uid = () => crypto.randomUUID();
const agora = () => new Date().toISOString();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
function erro(msg: string): never { throw new Error(msg); }

// ---------------------------------------------------------------------------
// Arquivos (IndexedDB)
// ---------------------------------------------------------------------------
function abrirIdb(): Promise<IDBDatabase> {
  return new Promise((ok, falha) => {
    const r = indexedDB.open('travion-previa-arquivos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('arquivos');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}
async function gravarArq(caminho: string, blob: Blob) {
  const db = await abrirIdb();
  await new Promise<void>((ok, falha) => {
    const tx = db.transaction('arquivos', 'readwrite');
    tx.objectStore('arquivos').put(blob, caminho);
    tx.oncomplete = () => ok();
    tx.onerror = () => falha(tx.error);
  });
}
async function lerArq(caminho: string): Promise<Blob | null> {
  const db = await abrirIdb();
  return new Promise((ok, falha) => {
    const r = db.transaction('arquivos').objectStore('arquivos').get(caminho);
    r.onsuccess = () => ok((r.result as Blob) ?? null);
    r.onerror = () => falha(r.error);
  });
}

/** PDF de uma página só com texto (para os anexos fictícios da prévia). */
export function pdfDemo(titulo: string, linhas: string[]): Blob {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const corpo = [
    '0.35 0.05 0.13 RG 2 w 36 36 523 770 re S 0.35 0.05 0.13 rg 36 760 523 46 re f',
    `BT 1 1 1 rg /F2 18 Tf 52 776 Td (${esc(titulo)}) Tj ET`,
    'BT 0.1 0.1 0.2 rg /F1 12 Tf 52 730 Td 20 TL',
    ...linhas.map((l) => `(${esc(l)}) Tj T*`),
    'ET',
  ].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${corpo.length} >>\nstream\n${corpo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let s = '%PDF-1.4\n';
  const pos: number[] = [];
  objs.forEach((o, i) => { pos.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: 'application/pdf' });
}

/** Imagem fictícia (print de conversa com o valor combinado). */
async function imagemDemo(linhas: string[]): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 720; c.height = 960;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9e1d6'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#075e54'; g.fillRect(0, 0, c.width, 90);
  g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.fillText('Conversa (demonstração)', 30, 58);
  let y = 150;
  for (const [i, l] of linhas.entries()) {
    const dir = i % 2 === 1;
    g.fillStyle = dir ? '#dcf8c6' : '#fff';
    g.fillRect(dir ? 200 : 30, y - 40, 490, 64);
    g.fillStyle = '#222'; g.font = '26px sans-serif';
    g.fillText(l, dir ? 220 : 50, y);
    y += 100;
  }
  return new Promise((ok) => c.toBlob((b) => ok(b!), 'image/png'));
}

// ---------------------------------------------------------------------------
export function criarDocLocal(ctx: CtxDocLocal): ApiDoc {
  let db: BancoDoc = (() => {
    try { const s = localStorage.getItem(CHAVE); if (s) return JSON.parse(s) as BancoDoc; } catch { /* recria */ }
    return { seq: 0, solicitacoes: [], lotes: [], mensagens: [], anexos: [], notificacoes: [], objetos: [] };
  })();
  const ouvintes = new Set<(e: EventoDoc) => void>();
  const salvar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(db)); } catch { /* só em memória */ } };
  const emitir = (e: EventoDoc) => { for (const o of ouvintes) setTimeout(() => o(e), 0); };

  const eu = () => {
    const p = ctx.perfil();
    if (!p || p.status !== 'ativo') erro('Seu acesso ainda não foi aprovado ou está bloqueado.');
    return p;
  };
  const exigir = (c: Permissao) => { eu(); if (!ctx.tem(c)) erro('Você não tem permissão para esta ação.'); };
  const embarque = (id: string) => ctx.embarques().find((e) => e.id === id);
  const podeVer = (embarqueId: string) => {
    const e = embarque(embarqueId);
    return !!e && (ctx.tem('documentacao.ver') || ctx.tem('apoio.pagina')) && ctx.veEmbarque(e);
  };
  // Cadastro: o solicitante sempre vê; quem tem cadastro.ver (ou a fila) vê os da sua filial ou carteira.
  const podeVerReg = (s: SolicitacaoDoc) => {
    if (s.tipo !== 'cadastro') return !!s.embarque_id && podeVer(s.embarque_id);
    const p = ctx.perfil();
    if (!p || p.status !== 'ativo') return false;
    return s.solicitante_id === p.id || ((ctx.tem('cadastro.ver') || ctx.tem('apoio.pagina'))
      && (ctx.ehAdmin() || (!!s.filial_id && ctx.noEscopo(s.filial_id, null)) || (!!s.comercial_id && ctx.noEscopo('', s.comercial_id))));
  };
  const carregar = (id: string) => {
    eu();
    const s = db.solicitacoes.find((x) => x.id === id);
    if (!s || !podeVerReg(s)) erro('Solicitação não encontrada ou fora do seu escopo.');
    return s;
  };
  const tocar = (s: SolicitacaoDoc, mud: Partial<SolicitacaoDoc> = {}) => Object.assign(s, mud, { versao: s.versao + 1, atualizado_em: agora() });
  const evento = (s: SolicitacaoDoc, tipo: MensagemDoc['tipo'], texto: string, referencia: string | null = null, autor?: Perfil) => {
    const m: MensagemDoc = { id: uid(), solicitacao_id: s.id, tipo, texto, referencia, autor_id: autor?.id ?? ctx.perfil()?.id ?? null,
      autor_nome: autor?.nome ?? ctx.perfil()?.nome ?? 'Sistema', criado_em: agora() };
    db.mensagens.push(m);
    return m;
  };
  const notificar = (dest: string | null, tipo: NotificacaoApp['tipo'], titulo: string, texto: string, s: SolicitacaoDoc, destino: NotificacaoApp['destino'], chave: string) => {
    if (!dest || dest === ctx.perfil()?.id || db.notificacoes.some((n) => n.destinatario_id === dest && n.chave === chave)) return;
    db.notificacoes.push({ id: uid(), destinatario_id: dest, chave, tipo, titulo, texto, solicitacao_id: s.id, embarque_id: s.embarque_id, destino, criada_em: agora(), lida_em: null });
  };
  const rotulo = (s: SolicitacaoDoc) => `${s.tipo === 'lote_emissao' ? 'Lote e Emissão' : s.tipo === 'emissao' ? 'Emissão' : 'Cadastro'} nº ${s.numero} · ${s.placa}`;
  const vincular = (s: SolicitacaoDoc, anexos: ArquivoDoc[], cats: CategoriaAnexo[], mensagem: string | null) => {
    const p = eu();
    let n = 0;
    for (const a of anexos ?? []) {
      if (!cats.includes(a.categoria)) erro('Categoria de anexo não permitida nesta etapa.');
      if (!a.caminho.startsWith(`envios/${p.id}/`)) erro('Arquivo enviado por outro usuário.');
      const o = db.objetos.find((x) => x.caminho === a.caminho && x.dono === p.id);
      if (!o) erro(`Arquivo não encontrado no armazenamento: envie novamente (${a.nome}).`);
      if (o.tamanho <= 0) erro(`Arquivo vazio ou envio incompleto: ${a.nome}.`);
      if (s.tipo === 'cadastro' ? !TIPOS_CADASTRO[o.tipo] || o.tamanho > LIMITE_CADASTRO : !TIPOS.includes(o.tipo) || o.tamanho > LIMITE) {
        erro(s.tipo === 'cadastro' ? `Arquivo não aceito no cadastro (tipo ou tamanho acima de 10 MB): ${a.nome}.` : `Arquivo não aceito (use PDF ou imagem até 15 MB): ${a.nome}.`);
      }
      if (!db.anexos.some((x) => x.caminho === a.caminho)) {
        db.anexos.push({ id: uid(), solicitacao_id: s.id, categoria: a.categoria, caminho: a.caminho, nome: a.nome.slice(0, 200) || 'arquivo',
          tipo_mime: o.tipo, tamanho: o.tamanho, mensagem_id: mensagem, enviado_por_nome: p.nome, enviado_em: agora() });
      }
      n++;
    }
    return n;
  };
  const responsavel = (s: SolicitacaoDoc, status: SolicitacaoDoc['status'][]) => {
    exigir('apoio.atender');
    if (s.responsavel_id !== ctx.perfil()?.id) erro(`Somente o responsável pelo atendimento (${s.responsavel_nome ?? 'ninguém'}) pode fazer isso.`);
    if (!status.includes(s.status)) erro('A solicitação não está numa etapa que permite esta ação.');
  };
  const fim = (s: SolicitacaoDoc, extra: Partial<ResultadoDoc> = {}): ResultadoDoc => {
    salvar();
    emitir({ tabela: 'solicitacoes', id: s.id });
    emitir({ tabela: 'notificacoes' });
    return { status: 'ok', registro: clone(s), ...extra } as ResultadoDoc;
  };

  // Sementes: algumas demandas em cada etapa, com arquivos fictícios.
  let pronto: Promise<void> = Promise.resolve();
  const semear = async () => {
    const es = ctx.embarques().filter((e) => e.is_demo);
    if (es.length < 6) return;
    const perfil = (id: string, nome: string) => ({ id, nome, email: null, papel: 'apoio', status: 'ativo', comercial_id: null, criado_em: agora() } as Perfil);
    const gestor = perfil('perfil-1', 'Gestor Rio Verde (prévia)');
    const sup = perfil('perfil-5', 'Supervisor Jataí (prévia)');
    const lucia = perfil('perfil-2', 'Apoio Operacional (prévia)');
    const paulo = lucia;
    const min = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
    const arquivo = async (dono: string, nome: string, blob: Blob) => {
      const caminho = `envios/${dono}/${uid()}${nome.slice(nome.lastIndexOf('.'))}`;
      await gravarArq(caminho, blob);
      db.objetos.push({ caminho, dono, tipo: blob.type, tamanho: blob.size });
      return caminho;
    };
    const nf = (n: string, e: Embarque, placa: string) => pdfDemo(`DANFE (demonstração) · NF-e ${n}`, [
      `Destinatário: ${ctx.retrato(e).cliente ?? ''}`, `Origem: ${e.origem_cidade}/${e.origem_uf ?? ''}`,
      `Destino: ${e.destino_cidade}/${e.destino_uf ?? ''}`, `Produto: ${ctx.retrato(e).produto ?? ''}`, `Peso líquido: 37.420 kg`,
      `Placa: ${placa}`, `Chave de acesso: 5226 1012 3456 7800 0190 5500 1000 0${n} 1000 0${n}`, '', 'Documento fictício para a prévia do Travion.']);
    const sols: Array<[number, SolicitacaoDoc['tipo'], SolicitacaoDoc['status'], Perfil, Perfil | null, string, number]> = [
      [0, 'lote_emissao', 'documentacao_disponivel', gestor, paulo, 'RVD2A41', 600],
      [0, 'emissao', 'em_atendimento', gestor, paulo, 'QWE4F21', 95],
      [2, 'lote_emissao', 'enviado', sup, null, 'JTA1B22', 18],
      [5, 'lote_emissao', 'aguardando_informacao', sup, lucia, 'ITB7C30', 140],
      [0, 'emissao', 'enviado', gestor, null, 'GOX3H55', 6],
    ];
    let lote: LoteErp | null = null;
    for (const [i, [ei, tipo, status, sol, resp, placa, idade]] of sols.entries()) {
      const e = es[ei];
      const id = uid();
      const s: SolicitacaoDoc = {
        id, numero: ++db.seq, embarque_id: e.id, lote_id: tipo === 'emissao' ? lote?.id ?? null : null, tipo, status, placa, placas_reboque: i === 0 ? ['RVD2A42'] : [],
        frete_empresa: [155, 155, 230, 79, 155][i], frete_empresa_unidade: 'rs_tonelada', frete_motorista: [144, 142, 180, 73, 144][i], frete_motorista_unidade: 'rs_tonelada',
        tipo_operacao: ['mi_tributado', 'mi_tributado', 'exportacao', 'mi_isento', 'mi_tributado'][i] as SolicitacaoDoc['tipo_operacao'],
        forma_pagamento: i % 2 ? 'cheque' : 'pagbem', pedagio: (['sem_parar', 'veloe', 'nao_ha', 'move_mais', 'sem_parar'] as const)[i],
        exige_obs_cte: i === 0 || i === 2, obs_cte: i === 0 || i === 2 ? 'Informar pedido de compra 4500123987 no CT-e' : null, cte_por_nf: i === 3,
        observacoes: i === 2 ? 'Cliente pediu prioridade: carreta já carregada aguardando documentos.' : null,
        retrato: { ...ctx.retrato(e), lote_numero: tipo === 'emissao' ? lote?.numero ?? null : null },
        solicitante_id: sol.id, solicitante_nome: sol.nome, responsavel_id: resp?.id ?? null, responsavel_nome: resp?.nome ?? null,
        enviado_em: min(idade), assumido_em: resp ? min(idade - 4) : null,
        concluido_em: status === 'documentacao_disponivel' ? min(idade - 75) : null, concluido_por_nome: status === 'documentacao_disponivel' ? resp?.nome ?? null : null,
        cancelado_em: null, cancelado_por_nome: null, cancelado_motivo: null, versao: 3, atualizado_em: min(Math.max(idade - 75, 1)),
      };
      db.solicitacoes.push(s);
      const m = (tipo: MensagemDoc['tipo'], texto: string, autor: Perfil, quando: number, referencia: string | null = null) =>
        db.mensagens.push({ id: uid(), solicitacao_id: id, tipo, texto, referencia, autor_id: autor.id, autor_nome: autor.nome, criado_em: min(quando) });
      const anexo = async (cat: CategoriaAnexo, nome: string, blob: Blob, por: Perfil, quando: number) => {
        db.anexos.push({ id: uid(), solicitacao_id: id, categoria: cat, caminho: await arquivo(por.id, nome, blob), nome, tipo_mime: blob.type,
          tamanho: blob.size, mensagem_id: null, enviado_por_nome: por.nome, enviado_em: min(quando) });
      };
      m('evento', tipo === 'lote_emissao' ? 'Solicitação de lote e emissão enviada ao apoio' : `Solicitação de emissão enviada ao apoio (lote ${lote?.numero})`, sol, idade);
      await anexo('nf', `NF-${41230 + i}.pdf`, nf(String(41230 + i), e, placa), sol, idade);
      if (tipo === 'lote_emissao') await anexo('evidencia_frete', `evidencia-frete-${i + 1}.png`, await imagemDemo(['Fechado frete empresa?', `R$ ${s.frete_empresa},00/t ok`, 'Motorista sai hoje', `R$ ${s.frete_motorista},00/t`]), sol, idade);
      if (resp) m('evento', `Atendimento assumido por ${resp.nome}`, resp, idade - 4);
      if (i === 0) {
        lote = { id: uid(), embarque_id: e.id, numero: 'L-24817', solicitacao_id: id, registrado_por_nome: paulo.nome, registrado_em: min(idade - 30), versao: 1, atualizado_em: min(idade - 30) };
        db.lotes.push(lote);
        s.lote_id = lote.id; s.retrato.lote_numero = lote.numero;
        m('evento', 'Lote L-24817 registrado (gerado no ERP). Emissão desta nota segue em atendimento.', paulo, idade - 30, 'lote');
        await anexo('cte', 'CTe-118204.pdf', pdfDemo('DACTE (demonstração) · CT-e 118204', ['Lote L-24817', `Placa ${placa}`, 'Documento fictício.']), paulo, idade - 70);
        await anexo('mdfe', 'MDFe-55102.pdf', pdfDemo('DAMDFE (demonstração) · MDF-e 55102', ['Lote L-24817', `Placa ${placa}`, 'Documento fictício.']), paulo, idade - 70);
        m('evento', `Documentação disponível, conferida e liberada por ${paulo.nome}`, paulo, idade - 75);
      }
      if (status === 'aguardando_informacao') {
        m('pendencia', 'A evidência do frete não mostra o valor do frete motorista. Envie o print com os dois valores, por favor.', lucia, idade - 20, 'evidencia_frete');
        db.notificacoes.push({ id: uid(), destinatario_id: sol.id, chave: `ajuste:${id}`, tipo: 'ajuste_solicitado', titulo: 'Ajuste solicitado pelo apoio',
          texto: `${rotulo(s)}: A evidência do frete não mostra o valor do frete motorista.`, solicitacao_id: id, embarque_id: e.id, destino: 'embarque', criada_em: min(idade - 20), lida_em: null });
      }
      if (status === 'documentacao_disponivel') {
        db.notificacoes.push({ id: uid(), destinatario_id: sol.id, chave: `disponivel:${id}`, tipo: 'documentacao_disponivel', titulo: 'Documentação disponível',
          texto: rotulo(s), solicitacao_id: id, embarque_id: e.id, destino: 'embarque', criada_em: min(idade - 75), lida_em: null });
      }
    }
    await semearCadastros();
  };
  // Cadastros fictícios (motorista e veículos de demonstração; nenhum documento real).
  const semearCadastros = async () => {
    const es = ctx.embarques().filter((e) => e.is_demo);
    if (es.length < 6 || db.solicitacoes.some((s) => s.tipo === 'cadastro')) { salvar(); return; }
    const perfil = (id: string, nome: string) => ({ id, nome } as Perfil);
    const gestor = perfil('perfil-1', 'Gestor Rio Verde (prévia)');
    const sup = perfil('perfil-5', 'Supervisor Jataí (prévia)');
    const apoio = perfil('perfil-2', 'Apoio Operacional (prévia)');
    const min = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
    const itens: Array<[number, SolicitacaoDoc['status'], Perfil, Perfil | null, string, string, number, boolean, number]> = [
      [1, 'enviado', gestor, null, 'RTV5E81', '(64) 99812-3344', 58000, true, 12],
      [3, 'em_atendimento', sup, apoio, 'JTX2A90', '(64) 98144-7720', 92500.5, false, 70],
      [0, 'cadastro_concluido', gestor, apoio, 'MTV8C14', '(64) 99677-0102', 85000, true, 400],
    ];
    for (const [ei, status, sol, resp, placa, tel, valor, primeiro, idade] of itens) {
      const e = es[ei];
      const r0 = ctx.retrato(e);
      const id = uid();
      const s: SolicitacaoDoc = {
        id, numero: ++db.seq, embarque_id: null, lote_id: null, tipo: 'cadastro', status, placa, placas_reboque: [],
        frete_empresa: 0, frete_empresa_unidade: 'rs_tonelada', frete_motorista: 0, frete_motorista_unidade: 'rs_tonelada', tipo_operacao: null,
        forma_pagamento: 'pagbem', pedagio: 'nao_ha', exige_obs_cte: false, obs_cte: null, cte_por_nf: false,
        observacoes: ei === 3 ? 'Motorista chega amanhã cedo para carregar; cadastro com prioridade.' : null,
        retrato: { ...r0, codigo: null, coleta: null, entrega: null, lote_numero: null },
        filial_id: e.filial_id, comercial_id: e.comercial_id, cliente_id: e.cliente_id, telefone_motorista: tel, mercadoria: r0.produto ?? 'Soja',
        valor_carga: valor, origem_cidade: e.origem_cidade, origem_uf: e.origem_uf, destino_cidade: e.destino_cidade, destino_uf: e.destino_uf,
        primeiro_embarque: primeiro, erp_referencia: status === 'cadastro_concluido' ? 'MOT-20931' : null,
        retorno_solicitante: status === 'cadastro_concluido' ? 'Motorista e cavalo cadastrados; carreta já existia no ERP.' : null,
        solicitante_id: sol.id, solicitante_nome: sol.nome, responsavel_id: resp?.id ?? null, responsavel_nome: resp?.nome ?? null,
        enviado_em: min(idade), assumido_em: resp ? min(idade - 5) : null,
        concluido_em: status === 'cadastro_concluido' ? min(idade - 40) : null, concluido_por_nome: status === 'cadastro_concluido' ? apoio.nome : null,
        cancelado_em: null, cancelado_por_nome: null, cancelado_motivo: null, versao: 2, atualizado_em: min(status === 'cadastro_concluido' ? idade - 40 : idade - 5),
      };
      db.solicitacoes.push(s);
      const m = (texto: string, autor: Perfil, quando: number, referencia: string | null = null) =>
        db.mensagens.push({ id: uid(), solicitacao_id: id, tipo: 'evento', texto, referencia, autor_id: autor.id, autor_nome: autor.nome, criado_em: min(quando) });
      const docs: Array<[CategoriaAnexo, string, string[]]> = [
        ['motorista', 'CNH-motorista.pdf', ['CNH (demonstração)', 'Nome: Motorista Fictício da Silva', 'Categoria: E', 'Validade: 12/2029']],
        ['motorista', 'comprovante-endereco.pdf', ['Comprovante de endereço (demonstração)', 'Rua Fictícia, 100 · Rio Verde/GO']],
        ['veiculo', `CRLV-${placa}.pdf`, [`CRLV (demonstração) · cavalo ${placa}`, 'Ano 2019 · Scania R450']],
        ['veiculo', 'CRLV-carreta.pdf', ['CRLV (demonstração) · carreta', 'Graneleira 3 eixos']],
      ];
      for (const [cat, nome, linhas] of docs) {
        const blob = pdfDemo(linhas[0], [...linhas.slice(1), '', 'Documento fictício para a prévia do Travion.']);
        const caminho = `envios/${sol.id}/${uid()}.pdf`;
        await gravarArq(caminho, blob);
        db.objetos.push({ caminho, dono: sol.id, tipo: blob.type, tamanho: blob.size });
        db.anexos.push({ id: uid(), solicitacao_id: id, categoria: cat, caminho, nome, tipo_mime: blob.type, tamanho: blob.size,
          mensagem_id: null, enviado_por_nome: sol.nome, enviado_em: min(idade) });
      }
      m('Cadastro enviado ao apoio', sol, idade);
      if (resp) m(`Atendimento assumido por ${resp.nome}`, resp, idade - 5);
      if (status === 'cadastro_concluido') {
        m(`Cadastro concluído no ERP, confirmado por ${apoio.nome} · referência MOT-20931`, apoio, idade - 40, 'conclusao');
        db.notificacoes.push({ id: uid(), destinatario_id: sol.id, chave: `cadastro_concluido:${id}`, tipo: 'cadastro_concluido',
          titulo: `Cadastro da placa ${placa.slice(0, 3)}-${placa.slice(3)} concluído`, texto: `Cadastro nº ${s.numero} · ${s.retrato.cliente ?? ''}`,
          solicitacao_id: id, embarque_id: null, destino: 'cadastro', criada_em: min(idade - 40), lida_em: null });
      }
    }
    salvar();
  };
  // Dados da prévia recriados (novos embarques): recomeça a documentação fictícia.
  const ids = new Set(ctx.embarques().map((e) => e.id));
  if (!db.solicitacoes.some((s) => s.embarque_id && ids.has(s.embarque_id)) && typeof document !== 'undefined') {
    db = { seq: 0, solicitacoes: [], lotes: [], mensagens: [], anexos: [], notificacoes: [], objetos: [] };
    pronto = semear().catch(() => undefined);
  } else if (!db.solicitacoes.some((s) => s.tipo === 'cadastro') && typeof document !== 'undefined') {
    pronto = semearCadastros().catch(() => undefined);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (ev) => {
      if (ev.key !== CHAVE || !ev.newValue) return;
      try { db = JSON.parse(ev.newValue) as BancoDoc; } catch { return; }
      emitir({ tabela: 'solicitacoes' }); emitir({ tabela: 'notificacoes' }); emitir({ tabela: 'lotes' });
    });
  }

  // Abas da prévia simulam usuários diferentes: a trava entre abas + releitura imita o "assumir" atômico do servidor.
  const comTrava = <T,>(fn: () => Promise<T>): Promise<T> => {
    const reler = () => { try { const t = localStorage.getItem(CHAVE); if (t) db = JSON.parse(t) as BancoDoc; } catch { /* segue com a memória */ } };
    if (typeof navigator === 'undefined' || !navigator.locks) { reler(); return fn(); }
    return navigator.locks.request(CHAVE, () => { reler(); return fn(); }) as Promise<T>;
  };

  const comNomes = (s: SolicitacaoDoc): SolicitacaoDoc => ({ ...s, nomes_nf: db.anexos.filter((a) => a.solicitacao_id === s.id && (a.categoria === 'nf' || a.categoria === 'correcao')).map((a) => a.nome) });
  const visiveis = () => db.solicitacoes.filter(podeVerReg);
  const offline = () => { if (!navigator.onLine) erro('Failed to fetch'); };

  return {
    async listar(desde) {
      await pronto;
      eu();
      const ss = visiveis().filter((s) => !desde || s.atualizado_em >= desde).map(comNomes);
      const ls = db.lotes.filter((l) => podeVer(l.embarque_id) && (!desde || l.atualizado_em >= desde));
      return clone({ solicitacoes: ss, lotes: ls });
    },
    async listarDoEmbarque(embarqueId) {
      await pronto;
      if (!podeVer(embarqueId)) return { solicitacoes: [], lotes: [] };
      return clone({ solicitacoes: db.solicitacoes.filter((s) => s.embarque_id === embarqueId).map(comNomes), lotes: db.lotes.filter((l) => l.embarque_id === embarqueId) });
    },
    async detalhe(id) {
      await pronto;
      const s = carregar(id);
      const origem = s.tipo === 'emissao' ? db.lotes.find((l) => l.id === s.lote_id)?.solicitacao_id : null;
      return clone({
        mensagens: db.mensagens.filter((m) => m.solicitacao_id === id).sort((a, b) => a.criado_em.localeCompare(b.criado_em)),
        anexos: [...db.anexos.filter((a) => a.solicitacao_id === id),
          ...db.anexos.filter((a) => origem && a.solicitacao_id === origem && a.categoria === 'evidencia_frete')],
      });
    },
    async enviarArquivo(arquivo, cadastro) {
      offline();
      const p = eu();
      if (!ctx.tem('documentacao.solicitar') && !ctx.tem('apoio.atender') && !ctx.tem('cadastro.solicitar')) erro('Você não tem permissão para enviar arquivos.');
      const tipo = cadastro ? tipoCadastro(arquivo.name, arquivo.type) : TIPOS.includes(arquivo.type) ? arquivo.type : null;
      if (!tipo) erro(cadastro ? 'Tipo de arquivo não aceito no cadastro.' : 'Tipo de arquivo não aceito (use PDF, PNG, JPG ou WEBP).');
      if (arquivo.size <= 0) erro('Arquivo vazio.');
      if (arquivo.size > (cadastro ? LIMITE_CADASTRO : LIMITE)) erro(cadastro ? 'Arquivo maior que 10 MB.' : 'Arquivo maior que 15 MB.');
      const ext = arquivo.name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0]?.toLowerCase() ?? '';
      const caminho = `envios/${p.id}/${uid()}${ext}`;
      try { await gravarArq(caminho, arquivo); } catch { erro('Não foi possível guardar o arquivo neste navegador (prévia).'); }
      db.objetos.push({ caminho, dono: p.id, tipo, tamanho: arquivo.size });
      salvar();
      return { caminho, nome: arquivo.name };
    },
    async baixar(caminho) {
      await pronto;
      const p = eu();
      const a = db.anexos.find((x) => x.caminho === caminho);
      if (!(caminho.startsWith(`envios/${p.id}/`) || (a && db.solicitacoes.some((s) => s.id === a.solicitacao_id && podeVerReg(s))))) {
        erro('Não foi possível abrir o arquivo (sem acesso ou indisponível).');
      }
      const b = await lerArq(caminho);
      if (!b) erro('Arquivo não está neste navegador (a prévia guarda os arquivos só localmente).');
      return b;
    },
    async criar(embarqueId, d, anexos) {
      offline();
      await pronto;
      exigir('documentacao.solicitar');
      const p = eu();
      const rep = db.solicitacoes.find((s) => s.solicitante_id === p.id && (s as SolicitacaoDoc & { chave_envio?: string }).chave_envio === d.chave_envio);
      if (rep) return { status: 'ok', registro: clone(rep), repetido: true };
      const e = embarque(embarqueId);
      if (!e || !podeVer(e.id)) erro('Embarque não encontrado ou fora do seu escopo.');
      if (e.situacao !== 'ativo' || e.encerrado_em) erro('Embarque arquivado ou encerrado: não aceita novas solicitações.');
      const lote = db.lotes.find((l) => l.embarque_id === e.id);
      let tipoOp = d.tipo_operacao;
      if (lote) {
        tipoOp = db.solicitacoes.find((s) => s.id === lote.solicitacao_id)?.tipo_operacao ?? tipoOp;
      } else {
        const aberta = db.solicitacoes.find((s) => s.embarque_id === e.id && s.tipo === 'lote_emissao' && s.status !== 'cancelado');
        if (aberta) return { status: 'inicial_aberta', registro: clone(aberta) };
        if (!tipoOp) erro('Informe o tipo de operação.');
      }
      const placa = d.placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!PLACA.test(placa)) erro('Placa inválida: use o formato ABC1D23 ou ABC1234.');
      const reboques = (d.placas_reboque ?? []).map((x) => x.toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean);
      if (reboques.some((x) => !PLACA.test(x))) erro('Placa de carreta inválida: use o formato ABC1D23 ou ABC1234.');
      if (!(d.frete_empresa > 0) || !(d.frete_motorista > 0)) erro('Confira fretes (valores maiores que zero, unidade R$/t ou R$/viagem), pagamento e pedágio.');
      if (d.exige_obs_cte && !d.obs_cte?.trim()) erro('Informe qual observação o cliente exige no CT-e.');
      const cats: CategoriaAnexo[] = lote ? ['nf'] : ['nf', 'evidencia_frete'];
      if (!anexos.some((a) => a.categoria === 'nf')) erro('Anexe ao menos uma NF.');
      if (!lote && !anexos.some((a) => a.categoria === 'evidencia_frete')) erro('Anexe a evidência do frete.');
      const s: SolicitacaoDoc & { chave_envio: string } = {
        id: uid(), numero: ++db.seq, embarque_id: e.id, lote_id: lote?.id ?? null, tipo: lote ? 'emissao' : 'lote_emissao', status: 'enviado',
        placa, placas_reboque: reboques, frete_empresa: d.frete_empresa, frete_empresa_unidade: d.frete_empresa_unidade,
        frete_motorista: d.frete_motorista, frete_motorista_unidade: d.frete_motorista_unidade, tipo_operacao: tipoOp,
        forma_pagamento: d.forma_pagamento, pedagio: d.pedagio, exige_obs_cte: d.exige_obs_cte, obs_cte: d.exige_obs_cte ? d.obs_cte!.trim() : null,
        cte_por_nf: d.cte_por_nf, observacoes: d.observacoes?.trim() || null, retrato: { ...ctx.retrato(e), lote_numero: lote?.numero ?? null },
        solicitante_id: p.id, solicitante_nome: p.nome, responsavel_id: null, responsavel_nome: null, enviado_em: agora(), assumido_em: null,
        concluido_em: null, concluido_por_nome: null, cancelado_em: null, cancelado_por_nome: null, cancelado_motivo: null,
        versao: 1, atualizado_em: agora(), chave_envio: d.chave_envio,
      };
      db.solicitacoes.push(s);
      try { vincular(s, anexos, cats, null); } catch (x) { db.solicitacoes.pop(); db.seq--; throw x; }
      evento(s, 'evento', lote ? `Solicitação de emissão enviada ao apoio (lote ${lote.numero})` : 'Solicitação de lote e emissão enviada ao apoio');
      return fim(s);
    },
    assumir: (id) => comTrava(async () => {
      offline();
      exigir('apoio.atender');
      const s = carregar(id);
      const p = eu();
      if (s.responsavel_id) return { status: s.responsavel_id === p.id ? 'ok' : 'ja_assumida', registro: clone(s) };
      if (s.status !== 'enviado') return { status: 'indisponivel', registro: clone(s) };
      tocar(s, { responsavel_id: p.id, responsavel_nome: p.nome, status: 'em_atendimento', assumido_em: agora() });
      evento(s, 'evento', `Atendimento assumido por ${p.nome}`);
      return fim(s);
    }),
    async registrarLote(id, numero) {
      offline();
      const s = carregar(id);
      responsavel(s, ['em_atendimento', 'aguardando_informacao']);
      if (s.tipo !== 'lote_emissao' || !s.embarque_id) erro('Só a solicitação de lote e emissão registra o lote.');
      const embarqueId = s.embarque_id;
      const n = numero.trim();
      if (!n || n.length > 60) erro('Informe o número do lote gerado no ERP.');
      let l = db.lotes.find((x) => x.embarque_id === embarqueId);
      if (l) {
        if (l.solicitacao_id !== s.id) erro(`Este embarque já tem lote registrado (${l.numero}).`);
        if (l.numero === n) return { status: 'sem_alteracao', registro: clone(s), lote: clone(l) };
        evento(s, 'evento', `Número do lote corrigido de ${l.numero} para ${n}`, 'lote');
        Object.assign(l, { numero: n, versao: l.versao + 1, atualizado_em: agora() });
      } else {
        l = { id: uid(), embarque_id: embarqueId, numero: n, solicitacao_id: s.id, registrado_por_nome: eu().nome, registrado_em: agora(), versao: 1, atualizado_em: agora() };
        db.lotes.push(l);
        evento(s, 'evento', `Lote ${n} registrado (gerado no ERP). Emissão desta nota segue em atendimento.`, 'lote');
      }
      const lote = l;
      tocar(s, { lote_id: lote.id, retrato: { ...s.retrato, lote_numero: lote.numero } });
      emitir({ tabela: 'lotes' });
      return fim(s, { lote: clone(lote) });
    },
    async solicitarAjuste(id, texto, referencia) {
      offline();
      const s = carregar(id);
      responsavel(s, ['em_atendimento']);
      if (!texto.trim()) erro('Descreva o que falta ou precisa ser corrigido.');
      const m = evento(s, 'pendencia', texto.trim().slice(0, 4000), referencia);
      tocar(s, { status: 'aguardando_informacao' });
      notificar(s.solicitante_id, 'ajuste_solicitado', 'Ajuste solicitado pelo apoio', `${rotulo(s)}: ${texto.trim().slice(0, 140)}`, s, s.tipo === 'cadastro' ? 'cadastro' : 'embarque', `ajuste:${m.id}`);
      return fim(s);
    },
    async responder(id, texto, anexos) {
      offline();
      const s = carregar(id);
      exigir(s.tipo === 'cadastro' ? 'cadastro.solicitar' : 'documentacao.solicitar');
      if (s.status !== 'aguardando_informacao') erro('Não há pendência aberta nesta solicitação (ela pode ter sido respondida por outra pessoa).');
      if (!texto.trim()) erro('Escreva a resposta para o apoio.');
      const m = evento(s, 'resposta', texto.trim().slice(0, 4000));
      if (s.tipo === 'cadastro') {
        // Correções entram como nova versão: os anteriores ficam; o limite vale para os arquivos desta resposta.
        const conta = (c: CategoriaAnexo) => (anexos ?? []).filter((a) => a.categoria === c).length;
        if (conta('motorista') > MAX_MOTORISTA || conta('veiculo') > MAX_VEICULO) { db.mensagens.pop(); erro('Na resposta: até 4 documentos do motorista e 10 dos veículos.'); }
      }
      try { vincular(s, anexos, s.tipo === 'cadastro' ? ['motorista', 'veiculo', 'correcao'] : ['nf', 'evidencia_frete', 'correcao'], m.id); } catch (x) { db.mensagens.pop(); throw x; }
      tocar(s, { status: 'em_atendimento' });
      notificar(s.responsavel_id, 'resposta_enviada', 'Resposta do comercial', `${rotulo(s)}: ${texto.trim().slice(0, 140)}`, s, 'apoio', `resposta:${m.id}`);
      return fim(s);
    },
    async anexarEmitidos(id, anexos) {
      offline();
      const s = carregar(id);
      responsavel(s, ['em_atendimento', 'aguardando_informacao']);
      if (s.tipo === 'cadastro') erro('Cadastro não recebe documentos emitidos: confirme a conclusão do cadastro.');
      const n = vincular(s, anexos, SAIDA, null);
      if (!n) erro('Nenhum arquivo para anexar.');
      evento(s, 'evento', `${n} documento(s) emitido(s) anexado(s), em conferência`, 'documentos');
      tocar(s);
      return fim(s);
    },
    async concluir(id) {
      offline();
      const s = carregar(id);
      responsavel(s, ['em_atendimento']);
      if (s.tipo === 'cadastro') erro('Use "Confirmar cadastro concluído" para cadastros.');
      if (!db.anexos.some((a) => a.solicitacao_id === s.id && SAIDA.includes(a.categoria))) erro('Anexe ao menos um documento emitido (CT-e, MDF-e ou outro) antes de liberar.');
      if (s.tipo === 'lote_emissao' && !s.lote_id) erro('Registre o número do lote gerado no ERP antes de liberar a documentação.');
      tocar(s, { status: 'documentacao_disponivel', concluido_em: agora(), concluido_por_nome: eu().nome });
      evento(s, 'evento', `Documentação disponível, conferida e liberada por ${eu().nome}`);
      notificar(s.solicitante_id, 'documentacao_disponivel', 'Documentação disponível', `${rotulo(s)} · ${s.retrato.cliente ?? ''}`, s, 'embarque', `disponivel:${s.id}`);
      return fim(s);
    },
    async cancelar(id, motivo) {
      offline();
      const s = carregar(id);
      const p = eu();
      if (s.status === 'documentacao_disponivel' || s.status === 'cadastro_concluido' || s.status === 'cancelado') erro('Solicitação já concluída ou cancelada.');
      if (!(ctx.tem('documentacao.cancelar') || (s.solicitante_id === p.id && s.status === 'enviado'))) erro('Você não tem permissão para cancelar esta solicitação.');
      if (!motivo.trim()) erro('Informe o motivo do cancelamento.');
      if (db.lotes.some((l) => l.solicitacao_id === s.id)) erro('O lote já foi registrado nesta solicitação: conclua a emissão em vez de cancelar.');
      tocar(s, { status: 'cancelado', cancelado_em: agora(), cancelado_por_nome: p.nome, cancelado_motivo: motivo.trim().slice(0, 1000) });
      evento(s, 'evento', `Solicitação cancelada por ${p.nome}: ${motivo.trim()}`);
      return fim(s);
    },
    async criarCadastro(d, anexos) {
      offline();
      await pronto;
      exigir('cadastro.solicitar');
      const p = eu();
      const rep = db.solicitacoes.find((s) => s.solicitante_id === p.id && (s as SolicitacaoDoc & { chave_envio?: string }).chave_envio === d.chave_envio);
      if (rep) return { status: 'ok', registro: clone(rep), repetido: true };
      const placa = d.placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!PLACA.test(placa)) erro('Placa do cavalo inválida: use o formato ABC1D23 ou ABC1234.');
      if (!telefoneValido(d.telefone_motorista ?? '')) erro('Telefone do motorista inválido: informe DDD + número.');
      if (!(Number(d.valor_carga) > 0)) erro('Informe o valor da carga (maior que zero).');
      if (!d.mercadoria?.trim()) erro('Informe a mercadoria.');
      const ouf = (d.origem_uf ?? '').trim().toUpperCase();
      const duf = (d.destino_uf ?? '').trim().toUpperCase();
      if (!d.origem_cidade?.trim() || !/^[A-Z]{2}$/.test(ouf)) erro('Informe a origem (cidade e UF).');
      if (!d.destino_cidade?.trim() || !/^[A-Z]{2}$/.test(duf)) erro('Informe o destino (cidade e UF).');
      if (typeof d.primeiro_embarque !== 'boolean') erro('Responda se é o primeiro embarque do motorista.');
      const c = ctx.cliente(d.cliente_id);
      if (!c) erro('Selecione um cliente autorizado.');
      if (d.filial_id && !ctx.noEscopo(d.filial_id, null)) erro('Filial fora do seu escopo.');
      if (!d.filial_id && !ctx.ehAdmin() && ctx.temFiliais()) erro('Selecione a filial.');
      const aberta = db.solicitacoes.find((s) => s.tipo === 'cadastro' && s.placa === placa && ['enviado', 'em_atendimento', 'aguardando_informacao'].includes(s.status));
      if (aberta) return { status: 'cadastro_aberto', numero: aberta.numero, situacao: aberta.status, registro: podeVerReg(aberta) ? clone(aberta) : null } as unknown as ResultadoDoc;
      const conta = (cat: CategoriaAnexo) => (anexos ?? []).filter((a) => a.categoria === cat).length;
      if (!conta('motorista')) erro('Anexe ao menos um documento do motorista.');
      if (!conta('veiculo')) erro('Anexe ao menos um documento dos veículos.');
      if (conta('motorista') > MAX_MOTORISTA) erro('Documentos do motorista: no máximo 4 arquivos.');
      if (conta('veiculo') > MAX_VEICULO) erro('Documentos dos veículos: no máximo 10 arquivos.');
      const f = d.filial_id ? ctx.filial(d.filial_id) : null;
      const s: SolicitacaoDoc & { chave_envio: string } = {
        id: uid(), numero: ++db.seq, embarque_id: null, lote_id: null, tipo: 'cadastro', status: 'enviado', placa, placas_reboque: [],
        frete_empresa: 0, frete_empresa_unidade: 'rs_tonelada', frete_motorista: 0, frete_motorista_unidade: 'rs_tonelada', tipo_operacao: null,
        forma_pagamento: 'pagbem', pedagio: 'nao_ha', exige_obs_cte: false, obs_cte: null, cte_por_nf: false,
        observacoes: d.observacoes?.trim().slice(0, 2000) || null,
        retrato: { codigo: null, cliente: c.nome, cliente_id: c.id, carteira: c.carteira, filial: f?.nome ?? null, filial_id: f?.id ?? null,
          centro_custo: f?.centro_custo ?? null, centro_custo_id: f?.centro_custo_id ?? null, origem_cidade: d.origem_cidade.trim(), origem_uf: ouf,
          coleta: null, destino_cidade: d.destino_cidade.trim(), destino_uf: duf, entrega: null, produto: d.mercadoria.trim(), lote_numero: null },
        filial_id: f?.id ?? null, comercial_id: c.comercial_id, cliente_id: c.id, telefone_motorista: d.telefone_motorista.trim().slice(0, 40),
        mercadoria: d.mercadoria.trim().slice(0, 200), valor_carga: Math.round(Number(d.valor_carga) * 100) / 100,
        origem_cidade: d.origem_cidade.trim(), origem_uf: ouf, destino_cidade: d.destino_cidade.trim(), destino_uf: duf,
        primeiro_embarque: d.primeiro_embarque, erp_referencia: null, retorno_solicitante: null,
        solicitante_id: p.id, solicitante_nome: p.nome, responsavel_id: null, responsavel_nome: null, enviado_em: agora(), assumido_em: null,
        concluido_em: null, concluido_por_nome: null, cancelado_em: null, cancelado_por_nome: null, cancelado_motivo: null,
        versao: 1, atualizado_em: agora(), chave_envio: d.chave_envio,
      };
      db.solicitacoes.push(s);
      const antes = db.anexos.length;
      try { vincular(s, anexos, ['motorista', 'veiculo'], null); } catch (x) { db.solicitacoes.pop(); db.anexos.length = antes; db.seq--; throw x; }
      evento(s, 'evento', 'Cadastro enviado ao apoio');
      return fim(s);
    },
    async concluirCadastro(id, referencia, retorno) {
      offline();
      const s = carregar(id);
      if (s.tipo !== 'cadastro') erro('Esta solicitação não é de cadastro.');
      if (s.status === 'aguardando_informacao') erro('Há pendência aguardando resposta do comercial: resolva antes de concluir.');
      responsavel(s, ['em_atendimento']);
      const ref = referencia?.trim().slice(0, 120) || null;
      tocar(s, { status: 'cadastro_concluido', concluido_em: agora(), concluido_por_nome: eu().nome, erp_referencia: ref,
        retorno_solicitante: retorno?.trim().slice(0, 2000) || null });
      evento(s, 'evento', `Cadastro concluído no ERP, confirmado por ${eu().nome}${ref ? ` · referência ${ref}` : ''}`, 'conclusao');
      notificar(s.solicitante_id, 'cadastro_concluido', `Cadastro da placa ${s.placa.slice(0, 3)}-${s.placa.slice(3)} concluído`,
        `Cadastro nº ${s.numero} · ${s.retrato.cliente ?? ''}${s.retorno_solicitante ? ` · ${s.retorno_solicitante.slice(0, 120)}` : ''}`, s, 'cadastro', `cadastro_concluido:${s.id}`);
      return fim(s);
    },
    async notificacoes() {
      await pronto;
      const p = ctx.perfil();
      if (!p) return [];
      return clone(db.notificacoes.filter((n) => n.destinatario_id === p.id && db.solicitacoes.some((s) => s.id === n.solicitacao_id && podeVerReg(s)))
        .sort((a, b) => b.criada_em.localeCompare(a.criada_em)));
    },
    async marcarLidas(ids) {
      const p = eu();
      for (const n of db.notificacoes) if (n.destinatario_id === p.id && !n.lida_em && (!ids || ids.includes(n.id))) n.lida_em = agora();
      salvar();
      emitir({ tabela: 'notificacoes' });
    },
    assinar(aoEvento, aoEstado) {
      ouvintes.add(aoEvento);
      const t = setTimeout(() => aoEstado(navigator.onLine), 80);
      const on = () => aoEstado(true);
      const off = () => aoEstado(false);
      window.addEventListener('online', on);
      window.addEventListener('offline', off);
      return () => { clearTimeout(t); ouvintes.delete(aoEvento); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
    },
  };
}
