// Regras de apresentação da Estadia (migração 2000). Funções puras; quem decide é o servidor.
//
// Valor = tarifa (R$/t/h) × peso (t) × horas válidas
// Horas válidas = permanência > limite ? máximo(0, permanência − horas a retroagir) : 0   (no limite exato não cobra)
// Horas são decimais (15h28 = 15,4666… h); o valor é arredondado em centavos só no final.

import type { ModalidadeEstadia, MotivoEstadia, ResultadoEstadia, SolicitacaoDoc, StatusDoc, TipoDocEstadia } from '../types';
import { fmtDataHora } from './formato';

export const TIPO_DOC_ESTADIA: Record<TipoDocEstadia, string> = { cte: 'CT-e', nfs: 'Nota Fiscal de Serviço' };
export const TIPO_DOC_CURTO: Record<TipoDocEstadia, string> = { cte: 'CT-e', nfs: 'NFS' };
export const MOTIVO_ESTADIA: Record<MotivoEstadia, string> = {
  demora_descarga: 'Demora da descarga', redirecionamento: 'Redirecionamento', agendamento_alongado: 'Problemas no agendamento alongado',
  troca_nota: 'Problemas na troca de nota', falta_cota: 'Falta de cota', outro: 'Outro',
};
export const MOTIVOS_ESTADIA = Object.keys(MOTIVO_ESTADIA) as MotivoEstadia[];
export const MODALIDADE_ESTADIA: Record<ModalidadeEstadia, string> = { padrao: 'Cálculo padrão', acordo: 'Acordo com o cliente ou mesa comercial' };
export const RESULTADO_ESTADIA: Record<ResultadoEstadia, string> = { aprovada: 'Aprovada', aprovada_parcial: 'Aprovada parcialmente', rejeitada: 'Rejeitada' };
/** Situações da Estadia que encerram o ciclo (reabrir só com permissão e motivo). */
export const FINAIS_ESTADIA: StatusDoc[] = ['aprovada', 'aprovada_parcial', 'encerrado', 'cancelado'];

export interface CalculoEstadia { permanencia_h: number; horas_validas: number; valor: number }

/** Mesmo cálculo de private.estadia_calcular. null se faltar algum parâmetro (vazio não é zero). */
export function calcularEstadia(p: {
  inicio: string | null | undefined; saida: string | null | undefined; tarifa: number | null | undefined; peso_t: number | null | undefined;
  limite_h: number | null | undefined; retroagir_h: number | null | undefined;
}): CalculoEstadia | null {
  if (!p.inicio || !p.saida || p.tarifa == null || p.peso_t == null || p.limite_h == null || p.retroagir_h == null) return null;
  const ms = Date.parse(p.saida) - Date.parse(p.inicio);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const permanencia_h = ms / 3600e3;
  const horas_validas = permanencia_h > p.limite_h ? Math.max(0, permanencia_h - p.retroagir_h) : 0;
  return { permanencia_h, horas_validas, valor: centavos(p.tarifa * p.peso_t * horas_validas) };
}

/** Arredonda em centavos (meio para cima), corrigindo o erro binário de x,xx5. */
export const centavos = (v: number) => Math.round((v + Math.sign(v) * 1e-9) * 100) / 100;

/** "27h28" (horas e minutos de relógio; os minutos são arredondados). */
export function fmtHorasRelogio(h: number): string {
  const min = Math.round(h * 60);
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}
/** "15,47 h" (horas decimais, para a fórmula). */
export const fmtHorasDec = (h: number, casas = 2) => `${h.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })} h`;
/** "15h28 = 15,47 h" */
export const fmtHoras = (h: number) => `${fmtHorasRelogio(h)} = ${fmtHorasDec(h)}`;
export const fmtTarifa = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}/t/h`;
export const fmtToneladas = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} t`;
export const fmtReais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtNumeroH = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} h`;

/**
 * Número no padrão brasileiro: "0,45" → 0.45; "37,6" → 37.6; "37.600" → 37600; "1.234,5" → 1234.5.
 * Ponto com três casas e sem vírgula é milhar (como no Brasil). Vazio → null; inválido → NaN.
 */
export function lerDecimal(t: string): number | null {
  const s = t.trim().replace(/\s/g, '');
  if (!s) return null;
  let n: number;
  if (s.includes(',')) n = /^\d{1,3}(\.\d{3})*,\d+$|^\d+,\d+$|^\d{1,3}(\.\d{3})*,?$|^\d+,?$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : NaN;
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = Number(s.replace(/\./g, ''));
  else n = /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

/** Peso em toneladas a partir do informado (nunca deduz a unidade pelo tamanho do número). */
export const pesoToneladas = (valor: number, unidade: 't' | 'kg') => Math.round((unidade === 'kg' ? valor / 1000 : valor) * 1000) / 1000;

/** Números de documento como texto: separa por espaço, vírgula, ponto e vírgula ou quebra de linha; mantém zeros; sem repetidos. */
export function lerNumeros(t: string): string[] {
  return [...new Set(t.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
}
export const NUMERO_DOC_RE = /^[A-Z0-9./-]{1,60}$/;

/** Valor de <input type="datetime-local"> (horário de Brasília) → ISO com fuso. */
export const localParaIso = (v: string) => (v ? new Date(`${v.length === 16 ? `${v}:00` : v}-03:00`).toISOString() : '');
/** ISO → valor de <input type="datetime-local"> em horário de Brasília. */
export function isoParaLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(Date.parse(iso) - 3 * 3600e3);
  return d.toISOString().slice(0, 16);
}

export const periodoEstadia = (s: Pick<SolicitacaoDoc, 'est_inicio' | 'est_saida'>) =>
  s.est_inicio && s.est_saida ? `${fmtDataHora(s.est_inicio)} → ${fmtDataHora(s.est_saida)}` : '—';
export const documentosEstadia = (s: Pick<SolicitacaoDoc, 'est_tipo_documento' | 'est_documentos'>) =>
  `${s.est_tipo_documento ? TIPO_DOC_CURTO[s.est_tipo_documento] : 'Doc.'} ${(s.est_documentos ?? []).join(', ')}`;

/** Situação do cálculo exibida a quem consulta. */
export function textoValorEstadia(s: SolicitacaoDoc): string {
  return s.est_valor_calculado != null ? fmtReais(s.est_valor_calculado) : 'Aguardando conferência';
}

/** Texto para colar no ERP ou numa conversa. */
export function resumoEstadia(s: SolicitacaoDoc): string {
  const r = s.retrato;
  const perm = s.est_inicio && s.est_saida ? (Date.parse(s.est_saida) - Date.parse(s.est_inicio)) / 3600e3 : null;
  return [
    `Estadia ${s.est_codigo ?? ''} · placa ${s.placa.length === 7 ? `${s.placa.slice(0, 3)}-${s.placa.slice(3)}` : s.placa}`,
    `Cliente: ${r.cliente ?? '—'}`,
    `${s.est_tipo_documento ? TIPO_DOC_ESTADIA[s.est_tipo_documento] : 'Documento'}: ${(s.est_documentos ?? []).join(', ')}`,
    `NF da carga: ${(s.est_nfs_carga ?? []).join(', ')}`,
    `Início: ${s.est_inicio ? fmtDataHora(s.est_inicio) : '—'} · Saída: ${s.est_saida ? fmtDataHora(s.est_saida) : '—'}`,
    perm !== null ? `Permanência: ${fmtHoras(perm)}` : null,
    s.est_tarifa != null ? `Tarifa: ${fmtTarifa(s.est_tarifa)}` : null,
    s.est_peso_t != null ? `Peso: ${fmtToneladas(s.est_peso_t)}${s.est_peso_unidade === 'kg' && s.est_peso_informado != null ? ` (informado ${s.est_peso_informado.toLocaleString('pt-BR')} kg)` : ''}` : null,
    `Motivo: ${s.est_motivo ? MOTIVO_ESTADIA[s.est_motivo] : '—'}${s.est_motivo === 'outro' && s.est_motivo_outro ? ` (${s.est_motivo_outro})` : ''}`,
    `Tipo: ${s.est_modalidade ? MODALIDADE_ESTADIA[s.est_modalidade] : '—'}`,
    s.est_modalidade === 'acordo' && s.est_acordo_valor != null
      ? `Acordo: ${fmtReais(s.est_acordo_valor)}, confirmado por ${s.est_acordo_confirmado_por ?? '—'} em ${s.est_acordo_data ? s.est_acordo_data.split('-').reverse().join('/') : '—'}` : null,
    `Sindicato: ${s.est_sindicato ? s.est_sindicato_nome ?? 'Sim' : 'Não'}`,
    s.est_valor_calculado != null && s.est_horas_validas != null
      ? `Cálculo (v${s.est_conferencia_versao}): limite ${fmtNumeroH(s.est_limite_h ?? 0)}, retroagir ${fmtNumeroH(s.est_retroagir_h ?? 0)}, horas válidas ${fmtHoras(s.est_horas_validas)} → ${fmtReais(s.est_valor_calculado)}`
      : 'Cálculo: aguardando conferência',
    r.filial ? `Filial: ${r.filial}${r.centro_custo ? ` · Centro de custo: ${r.centro_custo}` : ''}` : null,
    s.observacoes ? `Observações: ${s.observacoes}` : null,
    `Solicitante: ${s.solicitante_nome}`,
  ].filter(Boolean).join('\n');
}

/** Arquivos por categoria e tamanho por arquivo (mesmo padrão de configuracoes.estadia_anexos no servidor, que é quem decide). */
export const LIMITES_ESTADIA = {
  limite_mb: 10,
  max: { est_documento: 10, est_nf_carga: 20, est_comprovante: 10, est_agendamento: 5, est_tratativa: 10, est_retorno: 10, est_pagamento: 5, correcao: 10 } as Record<string, number>,
};

/** Referências da pendência na Estadia (o que o apoio pede para corrigir). */
export const REF_ESTADIA: Record<string, string> = {
  '': 'Geral', est_documento: 'CT-e ou NFS', est_nf_carga: 'Nota fiscal da carga', est_comprovante: 'Comprovantes de início e fim',
  est_agendamento: 'Agendamento', periodo: 'Início e saída', tarifa: 'Tarifa', peso: 'Peso', est_tratativa: 'Acordo / tratativa', placa: 'Placa',
};
