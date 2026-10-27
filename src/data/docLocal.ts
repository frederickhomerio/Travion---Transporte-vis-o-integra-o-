// Documentação na prévia local: mesmas regras das funções da migração 1610, dados fictícios no navegador.
// Metadados em localStorage (outras abas simulam outros usuários em tempo real) e arquivos em IndexedDB.

import type {
  AnexoDoc, CategoriaAnexo, Embarque, LoteErp, MensagemDoc, NotificacaoApp, Perfil, Permissao, RetratoDoc, SolicitacaoDoc,
} from '../types';
import type { ApiDoc, ArquivoDoc, EventoDoc, ResultadoDoc } from './api';

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
  const carregar = (id: string) => {
    eu();
    const s = db.solicitacoes.find((x) => x.id === id);
    if (!s || !podeVer(s.embarque_id)) erro('Solicitação não encontrada ou fora do seu escopo.');
    return s;
  };
  const tocar = (s: SolicitacaoDoc, mud: Partial<SolicitacaoDoc> = {}) => Object.assign(s, mud, { versao: s.versao + 1, atualizado_em: agora() });
  const evento = (s: SolicitacaoDoc, tipo: MensagemDoc['tipo'], texto: string, referencia: string | null = null, autor?: Perfil) => {
    const m: MensagemDoc = { id: uid(), solicitacao_id: s.id, tipo, texto, referencia, autor_id: autor?.id ?? ctx.perfil()?.id ?? null,
      autor_nome: autor?.nome ?? ctx.perfil()?.nome ?? 'Sistema', criado_em: agora() };
    db.mensagens.push(m);
    return m;
  };
  const notificar = (dest: string | null, tipo: NotificacaoApp['tipo'], titulo: string, texto: string, s: SolicitacaoDoc, destino: 'embarque' | 'apoio', chave: string) => {
    if (!dest || dest === ctx.perfil()?.id || db.notificacoes.some((n) => n.destinatario_id === dest && n.chave === chave)) return;
    db.notificacoes.push({ id: uid(), destinatario_id: dest, chave, tipo, titulo, texto, solicitacao_id: s.id, embarque_id: s.embarque_id, destino, criada_em: agora(), lida_em: null });
  };
  const rotulo = (s: SolicitacaoDoc) => `${s.tipo === 'lote_emissao' ? 'Lote e Emissão' : 'Emissão'} nº ${s.numero} · ${s.placa}`;
  const vincular = (s: SolicitacaoDoc, anexos: ArquivoDoc[], cats: CategoriaAnexo[], mensagem: string | null) => {
    const p = eu();
    let n = 0;
    for (const a of anexos ?? []) {
      if (!cats.includes(a.categoria)) erro('Categoria de anexo não permitida nesta etapa.');
      if (!a.caminho.startsWith(`envios/${p.id}/`)) erro('Arquivo enviado por outro usuário.');
      const o = db.objetos.find((x) => x.caminho === a.caminho && x.dono === p.id);
      if (!o) erro(`Arquivo não encontrado no armazenamento: envie novamente (${a.nome}).`);
      if (o.tamanho <= 0) erro(`Arquivo vazio ou envio incompleto: ${a.nome}.`);
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
    salvar();
  };
  // Dados da prévia recriados (novos embarques): recomeça a documentação fictícia.
  const ids = new Set(ctx.embarques().map((e) => e.id));
  if (!db.solicitacoes.some((s) => ids.has(s.embarque_id)) && typeof document !== 'undefined') {
    db = { seq: 0, solicitacoes: [], lotes: [], mensagens: [], anexos: [], notificacoes: [], objetos: [] };
    pronto = semear().catch(() => undefined);
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
  const visiveis = () => db.solicitacoes.filter((s) => podeVer(s.embarque_id));
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
    async enviarArquivo(arquivo) {
      offline();
      const p = eu();
      if (!ctx.tem('documentacao.solicitar') && !ctx.tem('apoio.atender')) erro('Você não tem permissão para enviar arquivos.');
      if (!TIPOS.includes(arquivo.type)) erro('Tipo de arquivo não aceito (use PDF, PNG, JPG ou WEBP).');
      if (arquivo.size <= 0) erro('Arquivo vazio.');
      if (arquivo.size > LIMITE) erro('Arquivo maior que 15 MB.');
      const ext = arquivo.name.match(/\.[A-Za-z0-9]{1,5}$/)?.[0]?.toLowerCase() ?? '';
      const caminho = `envios/${p.id}/${uid()}${ext}`;
      try { await gravarArq(caminho, arquivo); } catch { erro('Não foi possível guardar o arquivo neste navegador (prévia).'); }
      db.objetos.push({ caminho, dono: p.id, tipo: arquivo.type, tamanho: arquivo.size });
      salvar();
      return { caminho, nome: arquivo.name };
    },
    async baixar(caminho) {
      await pronto;
      const p = eu();
      const a = db.anexos.find((x) => x.caminho === caminho);
      if (!(caminho.startsWith(`envios/${p.id}/`) || (a && db.solicitacoes.some((s) => s.id === a.solicitacao_id && podeVer(s.embarque_id))))) {
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
      if (s.tipo !== 'lote_emissao') erro('Só a solicitação de lote e emissão registra o lote.');
      const n = numero.trim();
      if (!n || n.length > 60) erro('Informe o número do lote gerado no ERP.');
      let l = db.lotes.find((x) => x.embarque_id === s.embarque_id);
      if (l) {
        if (l.solicitacao_id !== s.id) erro(`Este embarque já tem lote registrado (${l.numero}).`);
        if (l.numero === n) return { status: 'sem_alteracao', registro: clone(s), lote: clone(l) };
        evento(s, 'evento', `Número do lote corrigido de ${l.numero} para ${n}`, 'lote');
        Object.assign(l, { numero: n, versao: l.versao + 1, atualizado_em: agora() });
      } else {
        l = { id: uid(), embarque_id: s.embarque_id, numero: n, solicitacao_id: s.id, registrado_por_nome: eu().nome, registrado_em: agora(), versao: 1, atualizado_em: agora() };
        db.lotes.push(l);
        evento(s, 'evento', `Lote ${n} registrado (gerado no ERP). Emissão desta nota segue em atendimento.`, 'lote');
      }
      tocar(s, { lote_id: l.id, retrato: { ...s.retrato, lote_numero: l.numero } });
      emitir({ tabela: 'lotes' });
      return fim(s, { lote: clone(l) });
    },
    async solicitarAjuste(id, texto, referencia) {
      offline();
      const s = carregar(id);
      responsavel(s, ['em_atendimento']);
      if (!texto.trim()) erro('Descreva o que falta ou precisa ser corrigido.');
      const m = evento(s, 'pendencia', texto.trim().slice(0, 4000), referencia);
      tocar(s, { status: 'aguardando_informacao' });
      notificar(s.solicitante_id, 'ajuste_solicitado', 'Ajuste solicitado pelo apoio', `${rotulo(s)}: ${texto.trim().slice(0, 140)}`, s, 'embarque', `ajuste:${m.id}`);
      return fim(s);
    },
    async responder(id, texto, anexos) {
      offline();
      exigir('documentacao.solicitar');
      const s = carregar(id);
      if (s.status !== 'aguardando_informacao') erro('Não há pendência aberta nesta solicitação (ela pode ter sido respondida por outra pessoa).');
      if (!texto.trim()) erro('Escreva a resposta para o apoio.');
      const m = evento(s, 'resposta', texto.trim().slice(0, 4000));
      vincular(s, anexos, ['nf', 'evidencia_frete', 'correcao'], m.id);
      tocar(s, { status: 'em_atendimento' });
      notificar(s.responsavel_id, 'resposta_enviada', 'Resposta do comercial', `${rotulo(s)}: ${texto.trim().slice(0, 140)}`, s, 'apoio', `resposta:${m.id}`);
      return fim(s);
    },
    async anexarEmitidos(id, anexos) {
      offline();
      const s = carregar(id);
      responsavel(s, ['em_atendimento', 'aguardando_informacao']);
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
      if (s.status === 'documentacao_disponivel' || s.status === 'cancelado') erro('Solicitação já concluída ou cancelada.');
      if (!(ctx.tem('documentacao.cancelar') || (s.solicitante_id === p.id && s.status === 'enviado'))) erro('Você não tem permissão para cancelar esta solicitação.');
      if (!motivo.trim()) erro('Informe o motivo do cancelamento.');
      if (db.lotes.some((l) => l.solicitacao_id === s.id)) erro('O lote já foi registrado nesta solicitação: conclua a emissão em vez de cancelar.');
      tocar(s, { status: 'cancelado', cancelado_em: agora(), cancelado_por_nome: p.nome, cancelado_motivo: motivo.trim().slice(0, 1000) });
      evento(s, 'evento', `Solicitação cancelada por ${p.nome}: ${motivo.trim()}`);
      return fim(s);
    },
    async notificacoes() {
      await pronto;
      const p = ctx.perfil();
      if (!p) return [];
      return clone(db.notificacoes.filter((n) => n.destinatario_id === p.id && db.solicitacoes.some((s) => s.id === n.solicitacao_id && podeVer(s.embarque_id)))
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
