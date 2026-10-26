// Análise da planilha "Lista de Fretes" para importação.
// Lemos apenas os VALORES gravados no arquivo (para fórmulas, o último resultado salvo pelo Excel).
// Nenhuma fórmula ou macro é executada. Textos das células são dados, nunca instruções.

import { limpar, normalizar, parseContador, parseNumeroBR, parseStatus, parseUF, sugereSuspensao } from './texto';

export interface Celula {
  v: unknown;
  /** texto da fórmula, quando a célula tinha fórmula (guardado só como referência) */
  f?: string;
}

export interface Aba {
  nome: string;
  oculta?: boolean;
  linhas: Celula[][];
}

export type CampoDestino =
  | 'carteira' | 'filial' | 'cliente' | 'origem_cidade' | 'origem_uf' | 'coleta' | 'destino_cidade' | 'destino_uf'
  | 'entrega' | 'produto' | 'frete_empresa' | 'frete_motorista' | 'status' | 'porta' | 'transito' | 'carregados'
  | 'obs_operacional' | 'obs_cliente' | 'cadencia_valor' | 'extra' | 'ignorar';

export const CAMPOS: Array<{ campo: CampoDestino; rotulo: string; obrigatorio?: boolean; sinonimos: string[] }> = [
  { campo: 'cliente', rotulo: 'Cliente', obrigatorio: true, sinonimos: ['CLIENTE'] },
  { campo: 'filial', rotulo: 'Filial', obrigatorio: true, sinonimos: ['FILIAL'] },
  { campo: 'carteira', rotulo: 'Carteira (comercial)', sinonimos: ['CARTEIRA', 'COMERCIAL'] },
  { campo: 'origem_cidade', rotulo: 'Cidade de origem', obrigatorio: true, sinonimos: ['ORIGEM', 'CIDADE ORIGEM'] },
  { campo: 'origem_uf', rotulo: 'UF de origem', sinonimos: ['UF ORIGEM'] },
  { campo: 'coleta', rotulo: 'Carregamento (local de coleta)', sinonimos: ['CARREGAMENTO', 'COLETA', 'LOCAL DE COLETA'] },
  { campo: 'destino_cidade', rotulo: 'Cidade de destino', obrigatorio: true, sinonimos: ['DESTINO', 'CIDADE DESTINO'] },
  { campo: 'destino_uf', rotulo: 'UF de destino', sinonimos: ['UF', 'UF DESTINO'] },
  { campo: 'entrega', rotulo: 'Descarga (local de entrega)', sinonimos: ['DESCARGA', 'ENTREGA', 'LOCAL DE ENTREGA'] },
  { campo: 'produto', rotulo: 'Produto', sinonimos: ['PRODUTO'] },
  { campo: 'frete_empresa', rotulo: 'Frete empresa', sinonimos: ['FRETE EMP', 'FRETE EMPRESA'] },
  { campo: 'frete_motorista', rotulo: 'Frete motorista', sinonimos: ['FRETE MOT', 'FRETE MOTORISTA'] },
  { campo: 'status', rotulo: 'Status de liberação', sinonimos: ['STATUS', 'STATUS LIBERACAO'] },
  { campo: 'cadencia_valor', rotulo: 'Cadência / meta (veículos/dia)', sinonimos: ['META', 'CADENCIA'] },
  { campo: 'porta', rotulo: 'Porta', sinonimos: ['PORTA'] },
  { campo: 'transito', rotulo: 'Trânsito', sinonimos: ['TRANSITO', 'TRÂNSITO'] },
  { campo: 'carregados', rotulo: 'Carregados', sinonimos: ['CARREGADOS'] },
  { campo: 'obs_operacional', rotulo: 'Observação operacional (interna)', sinonimos: ['OBSERVACAO', 'OBS'] },
  { campo: 'obs_cliente', rotulo: 'Observação para o cliente (pública)', sinonimos: ['OBSERVACAO CLIENTE', 'OBS CLIENTE'] },
];

/** Colunas calculadas na planilha: o app recalcula, então não são importadas. */
const DERIVADAS = ['VOL PORTA', 'VOL TRANSITO', 'VOL CARREGADO', 'EMBARQUE', 'PORTA + CARREGADO', 'PORTA+CARREGADO'];

export const ROTULO_DESTINO: Record<CampoDestino, string> = {
  ...Object.fromEntries(CAMPOS.map((c) => [c.campo, c.rotulo])),
  extra: 'Guardar como referência (área restrita)',
  ignorar: 'Ignorar',
} as Record<CampoDestino, string>;

export function textoCelula(c: Celula | undefined): string {
  if (!c || c.v === null || c.v === undefined) return '';
  if (c.v instanceof Date) return c.v.toISOString().slice(0, 10);
  return String(c.v);
}

/** Primeira linha que contém CLIENTE e ORIGEM (ou DESTINO). */
export function detectarCabecalho(aba: Aba): number {
  for (let i = 0; i < Math.min(aba.linhas.length, 30); i++) {
    const nomes = aba.linhas[i].map((c) => normalizar(textoCelula(c)));
    if (nomes.includes('CLIENTE') && (nomes.includes('ORIGEM') || nomes.includes('DESTINO'))) return i;
  }
  return -1;
}

export function mapearAutomatico(cabecalho: string[]): CampoDestino[] {
  const usados = new Set<CampoDestino>();
  return cabecalho.map((h) => {
    const n = normalizar(h);
    if (!n) return 'ignorar';
    if (DERIVADAS.includes(n)) return 'ignorar';
    for (const c of CAMPOS) {
      if (!usados.has(c.campo) && c.sinonimos.some((s) => normalizar(s) === n)) {
        usados.add(c.campo);
        return c.campo;
      }
    }
    return 'extra';
  });
}

export function motivoIgnorarColuna(cabecalho: string): string | null {
  return DERIVADAS.includes(normalizar(cabecalho)) ? 'Calculada na planilha; o app recalcula' : null;
}

export interface LinhaImportacao {
  linha: number;
  chave: string;
  carteira: string | null;
  filial: string;
  cliente: string;
  origem_cidade: string;
  origem_uf: string | null;
  coleta: string | null;
  destino_cidade: string;
  destino_uf: string | null;
  entrega: string | null;
  produto: string | null;
  status: 'liberado' | 'suspenso' | 'nao_informado';
  cadencia_valor: number | null;
  frete_empresa: number | null;
  frete_motorista: number | null;
  frete_empresa_original: string | null;
  frete_motorista_original: string | null;
  porta: number | null;
  transito: number | null;
  carregados: number | null;
  obs_operacional: string | null;
  obs_cliente: string | null;
  extras: Record<string, unknown>;
}

export interface LinhaAnalisada {
  numero: number;
  situacao: 'valida' | 'ignorada' | 'erro';
  motivo?: string;
  avisos: string[];
  dados?: LinhaImportacao;
  sugestaoSuspenso: boolean;
  /** 1 = primeira ocorrência desta rota no arquivo; 2+ = mesma rota em outra linha (outro embarque) */
  ocorrencia: number;
}

async function sha256(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashArquivo(dados: ArrayBuffer): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', dados);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Chave de importação estável: identidade da rota/cliente/filial/produto + número da ocorrência no arquivo.
 * Frete, contadores e observações não entram (mudam de um dia para o outro).
 */
export async function chaveImportacao(d: Pick<LinhaImportacao,
  'cliente' | 'filial' | 'origem_cidade' | 'origem_uf' | 'coleta' | 'destino_cidade' | 'destino_uf' | 'entrega' | 'produto'>,
  ocorrencia: number): Promise<string> {
  const base = [d.cliente, d.filial, d.origem_cidade, d.origem_uf, d.coleta, d.destino_cidade, d.destino_uf, d.entrega, d.produto]
    .map((x) => normalizar(x ?? ''))
    .join('|');
  return `pl1:${(await sha256(base)).slice(0, 24)}#${ocorrencia}`;
}

export async function analisarListaFretes(aba: Aba, linhaCabecalho: number, mapa: CampoDestino[]): Promise<LinhaAnalisada[]> {
  const cab = aba.linhas[linhaCabecalho].map((c) => limpar(textoCelula(c)));
  const col = (campo: CampoDestino) => mapa.indexOf(campo);
  const ocorrencias = new Map<string, number>();
  const res: LinhaAnalisada[] = [];

  for (let i = linhaCabecalho + 1; i < aba.linhas.length; i++) {
    const row = aba.linhas[i];
    const numero = i + 1;
    const get = (campo: CampoDestino): Celula | undefined => (col(campo) >= 0 ? row[col(campo)] : undefined);
    const txt = (campo: CampoDestino) => limpar(textoCelula(get(campo))) || null;

    const valores = row.map((c) => limpar(textoCelula(c))).filter(Boolean);
    if (valores.length === 0) continue; // linha vazia
    if (valores.some((v) => /^TOTA(L|IS)\b/.test(normalizar(v))) || /^TOTA(L|IS)\b/.test(normalizar(txt('cliente')))) {
      res.push({ numero, situacao: 'ignorada', motivo: 'Linha de total', avisos: [], sugestaoSuspenso: false, ocorrencia: 0 });
      continue;
    }
    const cliente = txt('cliente');
    const origem = txt('origem_cidade');
    const destino = txt('destino_cidade');
    if (!cliente || !origem || !destino) {
      res.push({
        numero, situacao: 'ignorada', motivo: 'Sem embarque válido (falta cliente, origem ou destino)',
        avisos: [], sugestaoSuspenso: false, ocorrencia: 0,
      });
      continue;
    }
    const filial = txt('filial');
    const avisos: string[] = [];

    const ufDest = parseUF(textoCelula(get('destino_uf')));
    if (ufDest === undefined) avisos.push(`UF de destino inválida: "${textoCelula(get('destino_uf'))}"`);
    const ufOri = parseUF(textoCelula(get('origem_uf')));
    if (ufOri === undefined) avisos.push(`UF de origem inválida: "${textoCelula(get('origem_uf'))}"`);

    const status = parseStatus(textoCelula(get('status')));
    if (status === undefined) avisos.push(`Status não reconhecido: "${textoCelula(get('status'))}" (ficará Não informado)`);

    const numero_ = (campo: CampoDestino, rot: string) => {
      const c = get(campo);
      const n = parseNumeroBR(c?.v instanceof Date ? undefined : c?.v);
      if (n === undefined) {
        avisos.push(`${rot} não numérico: "${textoCelula(c)}" (não importado)`);
        return null;
      }
      if (n !== null && n < 0) {
        avisos.push(`${rot} negativo: ${n} (não importado)`);
        return null;
      }
      return n;
    };
    const contador = (campo: CampoDestino, rot: string) => {
      const c = get(campo);
      const n = parseContador(c?.v);
      if (n === undefined) {
        avisos.push(`${rot} inválido: "${textoCelula(c)}" (aceita só inteiro ≥ 0; não importado)`);
        return null;
      }
      if (n === null) avisos.push(`${rot} vazio: ficará "não informado" (não vira zero)`);
      return n;
    };

    const freteEmp = numero_('frete_empresa', 'Frete empresa');
    const freteMot = numero_('frete_motorista', 'Frete motorista');
    if (freteEmp === 0) avisos.push('Frete empresa igual a zero');
    const cel = (campo: CampoDestino) => get(campo);
    const original = (c: Celula | undefined) => {
      if (!c) return null;
      if (c.f) return `=${c.f.replace(/^=/, '')} → ${textoCelula(c)}`;
      return typeof c.v === 'string' ? c.v : null;
    };
    const cadencia = numero_('cadencia_valor', 'Cadência/meta');

    const extras: Record<string, unknown> = {};
    mapa.forEach((m, j) => {
      if (m === 'extra' && cab[j]) {
        const c = row[j];
        const t = textoCelula(c);
        if (t !== '') extras[cab[j]] = c?.f ? { valor: c.v, formula: `=${c.f.replace(/^=/, '')}` } : c?.v;
      }
    });

    const obsOper = txt('obs_operacional');
    const parcial = {
      cliente,
      filial: filial ?? '',
      origem_cidade: origem,
      origem_uf: ufOri ?? null,
      coleta: txt('coleta'),
      destino_cidade: destino,
      destino_uf: ufDest ?? null,
      entrega: txt('entrega'),
      produto: txt('produto'),
    };
    const assinatura = Object.values(parcial).map((x) => normalizar(x ?? '')).join('|');
    const oc = (ocorrencias.get(assinatura) ?? 0) + 1;
    ocorrencias.set(assinatura, oc);

    const dados: LinhaImportacao = {
      linha: numero,
      chave: await chaveImportacao(parcial, oc),
      carteira: txt('carteira'),
      ...parcial,
      status: status ?? 'nao_informado',
      cadencia_valor: cadencia !== null && cadencia > 0 ? cadencia : null,
      frete_empresa: freteEmp,
      frete_motorista: freteMot,
      frete_empresa_original: original(cel('frete_empresa')),
      frete_motorista_original: original(cel('frete_motorista')),
      porta: contador('porta', 'Porta'),
      transito: contador('transito', 'Trânsito'),
      carregados: contador('carregados', 'Carregados'),
      obs_operacional: obsOper,
      obs_cliente: txt('obs_cliente'),
      extras,
    };

    const sugestao = status !== 'suspenso' && (sugereSuspensao(obsOper) || sugereSuspensao(dados.obs_cliente));
    if (!filial) {
      res.push({ numero, situacao: 'erro', motivo: 'Filial ausente: obrigatória para o embarque', avisos, dados, sugestaoSuspenso: sugestao, ocorrencia: oc });
      continue;
    }
    res.push({ numero, situacao: 'valida', avisos, dados, sugestaoSuspenso: sugestao, ocorrencia: oc });
  }
  return res;
}

export interface ClienteImportacao {
  nome: string;
  carteira: string | null;
  restricao: string | null;
}

/** Aba Clientes: CLIENTE + CARTEIRA. "NÃO CARREGAR" é restrição, não nome de comercial. Coluna "Filiais" opcional. */
export function analisarClientes(aba: Aba): { clientes: ClienteImportacao[]; filiais: string[]; avisos: string[] } {
  const avisos: string[] = [];
  let cab = -1;
  for (let i = 0; i < Math.min(aba.linhas.length, 20); i++) {
    const nomes = aba.linhas[i].map((c) => normalizar(textoCelula(c)));
    if (nomes.includes('CLIENTE') && nomes.includes('CARTEIRA')) { cab = i; break; }
  }
  if (cab < 0) return { clientes: [], filiais: [], avisos: ['Aba Clientes sem colunas CLIENTE e CARTEIRA'] };
  const nomes = aba.linhas[cab].map((c) => normalizar(textoCelula(c)));
  const iCli = nomes.indexOf('CLIENTE');
  const iCart = nomes.indexOf('CARTEIRA');
  const iFil = nomes.indexOf('FILIAIS');
  const vistos = new Set<string>();
  const clientes: ClienteImportacao[] = [];
  const filiais = new Map<string, string>();
  for (let i = cab + 1; i < aba.linhas.length; i++) {
    const r = aba.linhas[i];
    const nome = limpar(textoCelula(r[iCli]));
    if (iFil >= 0) {
      const f = limpar(textoCelula(r[iFil]));
      if (f && !filiais.has(normalizar(f))) filiais.set(normalizar(f), f);
    }
    if (!nome) continue;
    const n = normalizar(nome);
    if (vistos.has(n)) { avisos.push(`Cliente repetido na aba Clientes: ${nome} (linha ${i + 1})`); continue; }
    vistos.add(n);
    const cart = limpar(textoCelula(r[iCart]));
    const restricao = /^NAO CARREGAR$/.test(normalizar(cart)) ? cart : null;
    clientes.push({ nome, carteira: restricao ? null : cart || null, restricao });
  }
  return { clientes, filiais: [...filiais.values()], avisos };
}
