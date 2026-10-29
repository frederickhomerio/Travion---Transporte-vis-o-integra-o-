import { describe, expect, it } from 'vitest';
import { situacaoPrazo,
  type EventoPainel, type FiltrosPainel, type SolPainel, diaHoraSP, evolucao, filaAtual, grupoHistorico, inicioDiaSP, linhaDoTempo,
  linhasDoPainel, mapaCalor, mediana, mesclarPainel, porColaborador, resumo,
} from './painelOperacional';

const H = 3600e3;
const MIN = 60e3;
const T0 = Date.parse('2026-10-26T11:00:00Z'); // segunda, 08:00 em Brasília
const iso = (ms: number) => new Date(ms).toISOString();
const sol = (id: string, p: Partial<SolPainel> = {}): SolPainel => ({
  id, numero: 1, tipo: 'emissao', status: 'enviado', filial_id: 'f1', centro_custo_id: 'c1', solicitante_id: 'com1', solicitante_nome: 'Comercial',
  responsavel_id: null, responsavel_nome: null, enviado_em: iso(T0), ...p,
});
const ev = (s: string, evento: EventoPainel['evento'], ms: number, p: Partial<EventoPainel> = {}): EventoPainel => ({
  s, evento, em: iso(ms), responsavel_id: null, responsavel_nome: null, motivo: null, origem: 'registro', ...p,
});
const ana = { responsavel_id: 'ana', responsavel_nome: 'Ana' };

describe('linha do tempo', () => {
  it('separa fila, atendimento e pendência e reconcilia com o prazo total', () => {
    const s = sol('a', { status: 'documentacao_disponivel', ...ana });
    const l = linhaDoTempo(s, [
      ev('a', 'enviado', T0),
      ev('a', 'assumido', T0 + 10 * MIN, ana),
      ev('a', 'devolvido', T0 + 30 * MIN, { ...ana, motivo: 'documento_ilegivel' }),
      ev('a', 'corrigido', T0 + 90 * MIN, ana),
      ev('a', 'retomado', T0 + 100 * MIN, ana),
      ev('a', 'devolvido', T0 + 110 * MIN, { ...ana, motivo: 'outro' }),
      ev('a', 'corrigido', T0 + 130 * MIN, ana),
      ev('a', 'retomado', T0 + 135 * MIN, ana),
      ev('a', 'concluido', T0 + 160 * MIN, ana),
    ], T0 + 999 * MIN);
    expect(l.completo).toBe(true);
    expect(l.fila_ms).toBe((10 + 10 + 5) * MIN);
    expect(l.atendimento_ms).toBe((20 + 10 + 25) * MIN);
    expect(l.pendencia_ms).toBe((60 + 20) * MIN);
    expect(l.total_ms).toBe(160 * MIN);
    expect(l.fila_ms + l.atendimento_ms + l.pendencia_ms).toBe(l.total_ms);
    // Um chamado com várias devoluções: um chamado, várias ocorrências
    expect(l.devolucoes).toBe(2);
    expect(l.motivos).toEqual(['documento_ilegivel', 'outro']);
    expect(l.concluido_por).toEqual({ id: 'ana', nome: 'Ana' });
  });

  it('retorno após correção abre nova espera a partir da resposta, não do envio', () => {
    const s = sol('b', { status: 'correcao_recebida', ...ana });
    const l = linhaDoTempo(s, [
      ev('b', 'enviado', T0), ev('b', 'assumido', T0 + 5 * MIN, ana),
      ev('b', 'devolvido', T0 + 20 * MIN, { ...ana, motivo: 'documento_ausente' }), ev('b', 'corrigido', T0 + 80 * MIN, ana),
    ], T0 + 100 * MIN);
    expect(l.inicio_fila_atual).toBe(T0 + 80 * MIN);
    const f = filaAtual([l], ['emissao'], T0 + 100 * MIN);
    expect(f).toMatchObject({ quantidade: 1, retorno: 1, media_ms: 20 * MIN, mais_antigo_ms: 20 * MIN, sem_registro: 0 });
  });

  it('sequência sem envio ou fora de ordem fica fora das medianas', () => {
    const s = sol('c', { status: 'documentacao_disponivel', ...ana });
    const l = linhaDoTempo(s, [ev('c', 'assumido', T0, ana), ev('c', 'concluido', T0 + H, ana)], T0 + 2 * H);
    expect(l.completo).toBe(false);
    expect(l.total_ms).toBeNull();
    expect(porColaborador([l])[0]).toMatchObject({ concluidos: 1, amostra: 0, sem_registro: 1, mediana_atendimento_ms: null });
  });

  it('transferência mantém o histórico e o encerramento vai para quem concluiu', () => {
    const bruno = { responsavel_id: 'bruno', responsavel_nome: 'Bruno' };
    const s = sol('d', { status: 'cadastro_concluido', tipo: 'cadastro', ...bruno });
    const l = linhaDoTempo(s, [
      ev('d', 'enviado', T0), ev('d', 'assumido', T0 + 10 * MIN, ana), ev('d', 'transferido', T0 + 40 * MIN, bruno), ev('d', 'concluido', T0 + 70 * MIN, bruno),
    ], T0 + 3 * H);
    expect(l.completo).toBe(true);
    expect([...l.assumiram.keys()]).toEqual(['ana', 'bruno']);
    expect(l.intervalos.filter((i) => i.etapa === 'atendimento').map((i) => [i.responsavel_id, i.ate - i.de])).toEqual([['ana', 30 * MIN], ['bruno', 30 * MIN]]);
    const eq = porColaborador([l]);
    expect(eq.find((x) => x.id === 'ana')).toMatchObject({ assumidos: 1, concluidos: 0 });
    expect(eq.find((x) => x.id === 'bruno')).toMatchObject({ assumidos: 1, concluidos: 1, amostra: 1, mediana_atendimento_ms: 60 * MIN });
  });
});

describe('fila atual', () => {
  it('conta só quem aguarda atendimento e não mostra tempo zero sem fila', () => {
    const agora = T0 + 60 * MIN;
    const ls = linhasDoPainel({
      solicitacoes: [
        sol('e1', { tipo: 'emissao' }), sol('e2', { tipo: 'lote_emissao', enviado_em: iso(T0 + 30 * MIN) }),
        sol('e3', { tipo: 'emissao', status: 'em_atendimento', ...ana }), sol('e4', { tipo: 'emissao', status: 'aguardando_informacao', ...ana }),
      ],
      eventos: [
        ev('e1', 'enviado', T0), ev('e2', 'enviado', T0 + 30 * MIN), ev('e3', 'enviado', T0), ev('e3', 'assumido', T0 + MIN, ana),
        ev('e4', 'enviado', T0), ev('e4', 'assumido', T0 + MIN, ana), ev('e4', 'devolvido', T0 + 2 * MIN, { ...ana, motivo: 'outro' }),
      ],
    }, agora);
    expect(filaAtual(ls, ['emissao', 'lote_emissao'], agora)).toMatchObject({ quantidade: 2, em_atendimento: 1, media_ms: 45 * MIN, mais_antigo_ms: 60 * MIN });
    expect(filaAtual(ls, ['cadastro'], agora)).toMatchObject({ quantidade: 0, em_atendimento: 0, media_ms: null, mais_antigo_ms: null });
  });
});

describe('filtros e equipe', () => {
  const f: FiltrosPainel = { inicio: '2026-10-26', fim: '2026-10-26', tipos: ['emissao', 'lote_emissao', 'cadastro'], filial: '', centro: '', colaborador: '', solicitante: '' };
  const ls = linhasDoPainel({
    solicitacoes: [
      sol('a', { tipo: 'cadastro' }), sol('b', { tipo: 'emissao', filial_id: 'f2' }), sol('c', { tipo: 'lote_emissao', enviado_em: iso(T0 + 20 * H) }),
    ],
    eventos: [ev('a', 'enviado', T0), ev('b', 'enviado', T0), ev('c', 'enviado', T0 + 20 * H)],
  }, T0 + 30 * H);
  it('período em horário de Brasília, tipos por união e seleção vazia explícita', () => {
    expect(grupoHistorico(ls, f).map((l) => l.s.id)).toEqual(['a', 'b']); // c chega em 27/10 04h (Brasília)
    expect(grupoHistorico(ls, { ...f, tipos: ['cadastro', 'emissao'] }).map((l) => l.s.id)).toEqual(['a', 'b']);
    expect(grupoHistorico(ls, { ...f, tipos: [] })).toEqual([]);
    expect(grupoHistorico(ls, { ...f, filial: 'f2' }).map((l) => l.s.id)).toEqual(['b']);
  });
  it('mediana', () => {
    expect(mediana([])).toBeNull();
    expect(mediana([5, 1, 3])).toBe(3);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('mapa de calor', () => {
  it('cada chamado entra uma vez, pelo envio original, no horário de Brasília', () => {
    expect(diaHoraSP(T0)).toEqual({ dia: 0, hora: 8 });
    const s = sol('a', { status: 'correcao_recebida', ...ana });
    const l = linhaDoTempo(s, [ev('a', 'enviado', T0), ev('a', 'assumido', T0 + MIN, ana),
      ev('a', 'devolvido', T0 + 2 * MIN, { ...ana, motivo: 'outro' }), ev('a', 'corrigido', T0 + 5 * H, ana)], T0 + 6 * H);
    const m = mapaCalor([l], 2);
    expect(m.total).toBe(1);
    expect(m.matriz[0][4]).toBe(1); // segunda, 08h–10h
    expect(m.matriz.flat().reduce((a, b) => a + b, 0)).toBe(1);
    expect(mapaCalor([l], 1).matriz[0].length).toBe(24);
  });
});

describe('evolução das demandas', () => {
  const base = inicioDiaSP('2026-10-28'); // quarta
  it('dia: compara com o dia anterior só até a hora observada e não preenche o futuro', () => {
    const envios = [base - 20 * H, base - 20 * H + MIN, base - 10 * H, base + 4 * H, base + 9 * H];
    const r = evolucao(envios, 'dia', '2026-10-28', base + 9.5 * H, base - 30 * DIA());
    expect(r.atual.slice(0, 10)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(r.atual[10]).toBeNull();
    expect(r.anterior[4]).toBe(2);
    expect(r.comparavel).toMatchObject({ atual: 2, anterior: 2, variacao_pct: 0, situacao: 'ok' });
  });
  it('base anterior zero não vira infinito', () => {
    const r = evolucao([base + H], 'dia', '2026-10-28', base + 5 * H, base - 30 * DIA());
    expect(r.comparavel).toMatchObject({ atual: 1, anterior: 0, variacao_pct: null, situacao: 'sem_base' });
  });
  it('sem dados antes do início do registro', () => {
    const r = evolucao([base + H], 'semana', '2026-10-28', base + 5 * H, base - H);
    expect(r.comparavel.situacao).toBe('sem_dados_anteriores');
    expect(r.anterior.every((v) => v === null)).toBe(true);
    expect(r.rotulos).toEqual(['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
  });
  it('mês: dias sem equivalente no mês anterior ficam fora do percentual', () => {
    const mar = inicioDiaSP('2026-03-01');
    const envios = [mar + 27 * DIA(), mar + 30 * DIA() + H, inicioDiaSP('2026-02-28')];
    const r = evolucao(envios, 'mes', '2026-03-31', mar + 30 * DIA() + 5 * H, inicioDiaSP('2026-01-01'));
    expect(r.rotulos.length).toBe(31);
    expect(r.anterior[30]).toBeNull();
    expect(r.atual[30]).toBe(1);
    expect(r.comparavel.dias_sem_equivalente).toEqual([29, 30, 31]);
    expect(r.comparavel).toMatchObject({ atual: 1, anterior: 1, situacao: 'ok' });
  });
});

describe('resumo e consulta incremental', () => {
  it('três devoluções = um chamado com pendência e três ocorrências', () => {
    const evs = [ev('a', 'enviado', T0), ev('a', 'assumido', T0 + MIN, ana)];
    for (let i = 0; i < 3; i++) {
      evs.push(ev('a', 'devolvido', T0 + (10 + i * 10) * MIN, { ...ana, motivo: 'documento_ausente' }));
      evs.push(ev('a', 'corrigido', T0 + (15 + i * 10) * MIN, ana), ev('a', 'retomado', T0 + (16 + i * 10) * MIN, ana));
    }
    const l = linhaDoTempo(sol('a', { status: 'em_atendimento', ...ana }), evs, T0 + H);
    const r = resumo([l]);
    expect(r).toMatchObject({ recebidos: 1, em_atendimento: 1, com_devolucao: 1, devolucoes: 3, devolvidos_mais_de_uma_vez: 1, tempo_pendencia_ms: 15 * MIN });
    expect(r.motivos).toEqual({ documento_ausente: 3 });
  });
  it('mescla sem duplicar eventos', () => {
    const d1 = { agora: iso(T0), inicio_registro: null, inicio_dados: null, solicitacoes: [sol('a'), sol('b')], eventos: [ev('a', 'enviado', T0), ev('b', 'enviado', T0)] };
    const d2 = { ...d1, agora: iso(T0 + MIN), solicitacoes: [sol('a', { status: 'em_atendimento', ...ana })], eventos: [ev('a', 'enviado', T0), ev('a', 'assumido', T0 + MIN, ana)] };
    const m = mesclarPainel(d1, d2);
    expect(m.solicitacoes.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(m.eventos.length).toBe(3);
    expect(mesclarPainel(m, { ...d2, solicitacoes: [], eventos: [] }).eventos.length).toBe(3);
  });
});

function DIA() { return 86400e3; }

describe('situacaoPrazo', () => {
  const min = 60000;
  it('verde até o prazo, amarelo até 5 min de atraso, vermelho acima', () => {
    expect(situacaoPrazo(30 * min, 30)).toBe('no_prazo');
    expect(situacaoPrazo(30 * min + 1, 30)).toBe('atencao');
    expect(situacaoPrazo(35 * min, 30)).toBe('atencao');
    expect(situacaoPrazo(35 * min + 1, 30)).toBe('atrasado');
    expect(situacaoPrazo(19 * min, 20)).toBe('no_prazo');
    expect(situacaoPrazo(null, 20)).toBeNull();
    expect(situacaoPrazo(10 * min, undefined)).toBeNull();
  });
});

describe('estadia no painel', () => {
  it('espera pelo cliente fica fora do atendimento ativo, inclusive pago em pendência', () => {
    const s = sol('e1', { tipo: 'estadia', status: 'aprovada', ...ana });
    const l = linhaDoTempo(s, [
      ev('e1', 'enviado', T0), ev('e1', 'assumido', T0 + 2 * H, ana), ev('e1', 'enviado_cliente', T0 + 3 * H, ana),
      ev('e1', 'pago_pendencia', T0 + 10 * H, ana), ev('e1', 'concluido', T0 + 30 * H, ana),
    ], T0 + 40 * H);
    expect(l.completo).toBe(true);
    expect(l.fila_ms).toBe(2 * H);
    expect(l.atendimento_ms).toBe(1 * H);
    expect(l.cliente_ms).toBe(27 * H);
    expect(l.total_ms).toBe(30 * H);
  });
  it('rejeitada volta ao atendimento e o encerramento conclui', () => {
    const s = sol('e2', { tipo: 'estadia', status: 'encerrado', ...ana });
    const l = linhaDoTempo(s, [
      ev('e2', 'enviado', T0), ev('e2', 'assumido', T0 + H, ana), ev('e2', 'enviado_cliente', T0 + 2 * H, ana),
      ev('e2', 'retorno_cliente', T0 + 6 * H, ana), ev('e2', 'concluido', T0 + 6.5 * H, ana),
    ], T0 + 8 * H);
    expect(l.completo).toBe(true);
    expect(l.atendimento_ms).toBe(1.5 * H);
    expect(l.cliente_ms).toBe(4 * H);
  });
  it('aguardando cliente agora conta na espera do cliente, não na fila nem no atendimento', () => {
    const s = sol('e3', { tipo: 'estadia', status: 'aguardando_cliente', ...ana });
    const l = linhaDoTempo(s, [ev('e3', 'enviado', T0), ev('e3', 'assumido', T0 + H, ana), ev('e3', 'enviado_cliente', T0 + 2 * H, ana)], T0 + 5 * H);
    expect(l.completo).toBe(true);
    expect(l.cliente_ms).toBe(3 * H);
    expect(filaAtual([l], ['estadia'], T0 + 5 * H).quantidade).toBe(0);
    expect(resumo([l]).aguardando_cliente).toBe(1);
  });
  it('reaberta com responsável volta ao atendimento', () => {
    const s = sol('e4', { tipo: 'estadia', status: 'em_atendimento', ...ana });
    const l = linhaDoTempo(s, [ev('e4', 'enviado', T0), ev('e4', 'assumido', T0 + H, ana), ev('e4', 'concluido', T0 + 2 * H, ana),
      ev('e4', 'reaberto', T0 + 3 * H, ana)], T0 + 4 * H);
    expect(l.completo).toBe(true);
    expect(l.atendimento_ms).toBe(2 * H);
  });
});
