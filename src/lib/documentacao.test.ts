import { describe, expect, it } from 'vitest';
import type { SolicitacaoDoc } from '../types';
import { acaoDocumentacao, avisosDuplicidade, docsDoEscopo, docsParaBaixar, duracao, minhasSolicitacoes, FILTROS_FILA, filtrarAcompanhamento, filtrarFila, fmtHMS, lerReais, normalizarPlaca, solicitacoesAcompanhamento, telefoneValido, tempoAtendimento, tempoDoc, tipoCadastro } from './documentacao';

const base = Date.parse('2026-10-27T12:00:00Z');
const sol = (o: Partial<SolicitacaoDoc>): SolicitacaoDoc => ({
  id: 's1', numero: 1, embarque_id: 'e1', tipo: 'emissao', status: 'enviado', placa: 'ABC1D23', placas_reboque: [],
  enviado_em: new Date(base - 30 * 60000).toISOString(), atualizado_em: new Date(base).toISOString(),
  retrato: { cliente: 'Cargill', filial_id: 'f1', lote_numero: null }, solicitante_nome: 'Ana', nomes_nf: [],
  ...o,
} as SolicitacaoDoc);

describe('documentação', () => {
  it('formata a duração', () => {
    expect(duracao(-5)).toBe('0 min');
    expect(duracao(59 * 60000)).toBe('59 min');
    expect(duracao(125 * 60000)).toBe('2 h 05 min');
    expect(duracao(26 * 3600e3)).toBe('1 d 2 h');
  });

  it('mostra o tempo conforme o status', () => {
    expect(tempoDoc(sol({}), base)).toEqual({ rotulo: 'Aguardando há', texto: '30 min' });
    expect(tempoDoc(sol({ status: 'em_atendimento' }), base).rotulo).toBe('Aberta há');
    expect(tempoDoc(sol({ status: 'documentacao_disponivel', concluido_em: new Date(base).toISOString() }), base + 9e6))
      .toEqual({ rotulo: 'Total', texto: '30 min' });
  });

  it('escolhe o botão da documentação', () => {
    expect(acaoDocumentacao(undefined, []).tipo).toBe('gerar');
    expect(acaoDocumentacao(undefined, [sol({ tipo: 'lote_emissao', status: 'cancelado' })]).tipo).toBe('gerar');
    expect(acaoDocumentacao(undefined, [sol({ tipo: 'lote_emissao' })]).tipo).toBe('acompanhar');
    expect(acaoDocumentacao({ numero: 'L-1' } as never, [sol({ tipo: 'lote_emissao' })]).tipo).toBe('emitir');
  });

  it('avisa placa e NF repetidas', () => {
    const outra = sol({ numero: 7, nomes_nf: ['NF 123.pdf'] });
    const avisos = avisosDuplicidade('abc-1d23', ['nf 123.PDF'], [outra], base);
    expect(avisos).toHaveLength(2);
    expect(avisos[0]).toContain('ABC-1D23');
    expect(avisosDuplicidade('XYZ9A99', ['outra.pdf'], [outra], base)).toEqual([]);
    expect(avisosDuplicidade('ABC1D23', [], [outra], base + 49 * 3600e3)).toEqual([]);
  });

  it('filtra a fila por atalho, responsável e busca', () => {
    const ss = [
      sol({ id: 'a', numero: 1 }),
      sol({ id: 'b', numero: 2, status: 'em_atendimento', responsavel_id: 'eu', placa: 'QWE4R56' }),
      sol({ id: 'c', numero: 3, status: 'aguardando_informacao', responsavel_id: 'outro', retrato: { cliente: 'Amaggi', filial_id: 'f2', lote_numero: 'L-24817' } as never }),
      sol({ id: 'd', numero: 4, status: 'documentacao_disponivel', concluido_em: new Date(base).toISOString() }),
    ];
    const ids = (f: Partial<typeof FILTROS_FILA>) => filtrarFila(ss, { ...FILTROS_FILA, ...f }, 'eu').map((s) => s.id);
    expect(ids({})).toEqual(['a', 'b', 'c']);
    expect(ids({ atalho: 'minhas' })).toEqual(['b']);
    expect(ids({ atalho: 'concluidas' })).toEqual(['d']);
    expect(ids({ responsavel: '-' })).toEqual(['a']);
    expect(ids({ filial: 'f2' })).toEqual(['c']);
    expect(ids({ busca: 'qwe-4r' })).toEqual(['b']);
    expect(ids({ busca: '24817' })).toEqual(['c']);
    expect(ids({ busca: 'amaggi' })).toEqual(['c']);
    expect(normalizarPlaca('abc-1d23')).toBe('ABC1D23');
  });
});

describe('Cadastro', () => {
  it('telefone com DDD, +55 e zero de operadora', () => {
    expect(telefoneValido('(64) 99999-1234')).toBe(true);
    expect(telefoneValido('64 3611-2233')).toBe(true);
    expect(telefoneValido('+55 64 99999-1234')).toBe(true);
    expect(telefoneValido('0 64 99999-1234')).toBe(true);
    expect(telefoneValido('99999-1234')).toBe(false);
    expect(telefoneValido('(00) 99999-1234')).toBe(false);
    expect(telefoneValido('(64) 9999-12')).toBe(false);
    expect(telefoneValido('')).toBe(false);
  });
  it('valor da carga no padrão brasileiro', () => {
    expect(lerReais('85.000,00')).toBe(85000);
    expect(lerReais('R$ 85.000,50')).toBe(85000.5);
    expect(lerReais('85.000')).toBe(85000);
    expect(lerReais('85000')).toBe(85000);
    expect(lerReais('1250,5')).toBe(1250.5);
    expect(lerReais('')).toBeNull();
    expect(Number.isNaN(lerReais('85,000.00') as number)).toBe(true);
    expect(Number.isNaN(lerReais('abc') as number)).toBe(true);
    expect(Number.isNaN(lerReais('-10') as number)).toBe(true);
  });
  it('tipo do arquivo pelo navegador ou pela extensão', () => {
    expect(tipoCadastro('cnh.pdf', 'application/pdf')).toBe('application/pdf');
    expect(tipoCadastro('audio.opus', '')).toBe('audio/ogg');
    expect(tipoCadastro('foto.heic', 'application/octet-stream')).toBe('image/heic');
    expect(tipoCadastro('planilha.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBeTruthy();
    expect(tipoCadastro('script.exe', 'application/x-msdownload')).toBeNull();
    expect(tipoCadastro('macro.html', 'text/html')).toBeNull();
  });
  it('filtro por tipo e Concluídas com Cadastro concluído', () => {
    const ss = [
      sol({ id: '1', tipo: 'cadastro', status: 'cadastro_concluido', embarque_id: null }),
      sol({ id: '2', tipo: 'emissao', status: 'documentacao_disponivel' }),
      sol({ id: '3', tipo: 'cadastro', status: 'enviado', embarque_id: null }),
    ];
    expect(filtrarFila(ss, { ...FILTROS_FILA, atalho: 'concluidas' }, 'eu').map((s) => s.id).sort()).toEqual(['1', '2']);
    expect(filtrarFila(ss, { ...FILTROS_FILA, tipo: 'cadastro' }, 'eu').map((s) => s.id)).toEqual(['3']);
  });
});

describe('Minhas Solicitações', () => {
  it('traz só emissões e cadastros do usuário, em aberto primeiro', () => {
    const t = (min: number) => new Date(base - min * 60000).toISOString();
    const todas = [
      sol({ id: 'a', solicitante_id: 'eu', status: 'documentacao_disponivel', enviado_em: t(90), concluido_em: t(10) }),
      sol({ id: 'b', solicitante_id: 'eu', status: 'enviado', enviado_em: t(20) }),
      sol({ id: 'c', solicitante_id: 'eu', tipo: 'cadastro', status: 'em_atendimento', enviado_em: t(40) }),
      sol({ id: 'd', solicitante_id: 'outro', status: 'enviado' }),
      sol({ id: 'e', solicitante_id: 'eu', tipo: 'estadia', status: 'enviado' }),
      sol({ id: 'f', solicitante_id: 'eu', status: 'cancelado', enviado_em: t(200), atualizado_em: t(5) }),
    ];
    expect(minhasSolicitacoes(todas, 'eu').map((s) => s.id)).toEqual(['c', 'b', 'f', 'a']);
  });
  it('baixar documentos só na emissão com documentação disponível', () => {
    expect(docsParaBaixar(sol({ status: 'documentacao_disponivel' }))).toBe(true);
    expect(docsParaBaixar(sol({ tipo: 'lote_emissao', status: 'documentacao_disponivel' }))).toBe(true);
    expect(docsParaBaixar(sol({ status: 'em_atendimento' }))).toBe(false);
    expect(docsParaBaixar(sol({ tipo: 'cadastro', status: 'cadastro_concluido' }))).toBe(false);
  });
});

describe('Baixar documentos do escopo', () => {
  it('traz as emissões liberadas de todos do centro, mais recentes primeiro, com busca', () => {
    const t = (min: number) => new Date(base - min * 60000).toISOString();
    const todas = [
      sol({ id: 'a', solicitante_id: 'renato', solicitante_nome: 'Renato', status: 'documentacao_disponivel', concluido_em: t(30), placa: 'RVD2A41' }),
      sol({ id: 'b', solicitante_id: 'thiago', solicitante_nome: 'Thiago', tipo: 'lote_emissao', status: 'documentacao_disponivel', concluido_em: t(5), placa: 'QWE4F21' }),
      sol({ id: 'c', solicitante_id: 'renato', status: 'em_atendimento' }),
    ];
    expect(docsDoEscopo(todas).map((s) => s.id)).toEqual(['b', 'a']);
    expect(docsDoEscopo(todas, 'rvd-2a').map((s) => s.id)).toEqual(['a']);
    expect(docsDoEscopo(todas, 'thia').map((s) => s.id)).toEqual(['b']);
  });
});

describe('Minhas solicitações: fila única, filtros e cronômetro (02/11/2026)', () => {
  const ini = '2026-11-02T10:00:00Z';
  const t0 = Date.parse(ini);
  it('antes de assumir não há contagem', () => {
    expect(tempoAtendimento({ status: 'enviado', assumido_em: null, concluido_em: null, cancelado_em: null }, t0)).toEqual({ tipo: 'aguardando' });
  });
  it('conta do Assumir, sem usar o envio, e não reinicia em pendência', () => {
    const s = { status: 'aguardando_informacao' as const, assumido_em: ini, concluido_em: null, cancelado_em: null };
    expect(tempoAtendimento(s, t0 + 443000)).toEqual({ tipo: 'correndo', ms: 443000 });
    expect(tempoAtendimento({ ...s, status: 'correcao_recebida' }, t0 + 1929000)).toEqual({ tipo: 'correndo', ms: 1929000 });
  });
  it('congela na finalização, inclusive cadastro concluído', () => {
    const fim = new Date(t0 + 3723000).toISOString();
    expect(tempoAtendimento({ status: 'documentacao_disponivel', assumido_em: ini, concluido_em: fim, cancelado_em: null }, t0 + 9e9)).toEqual({ tipo: 'finalizado', ms: 3723000 });
    expect(tempoAtendimento({ status: 'cadastro_concluido', assumido_em: ini, concluido_em: fim, cancelado_em: null }, t0 + 9e9)).toEqual({ tipo: 'finalizado', ms: 3723000 });
  });
  it('legado sem início confiável: indisponível (nunca o horário do envio)', () => {
    expect(tempoAtendimento({ status: 'em_atendimento', assumido_em: null, concluido_em: null, cancelado_em: null }, t0)).toEqual({ tipo: 'indisponivel' });
    expect(tempoAtendimento({ status: 'documentacao_disponivel', assumido_em: ini, concluido_em: null, cancelado_em: null }, t0)).toEqual({ tipo: 'indisponivel' });
  });
  it('HH:MM:SS com horas totais', () => {
    expect(fmtHMS(0)).toBe('00:00:00');
    expect(fmtHMS(443000)).toBe('00:07:23');
    expect(fmtHMS((27 * 3600 + 5 * 60 + 9) * 1000)).toBe('27:05:09');
  });
  it('fila única sem Estadia e três filtros combinados', () => {
    const lista = solicitacoesAcompanhamento([
      sol({ id: 'a', tipo: 'cadastro', placa: 'EFU2G04', solicitante_id: 'u1', retrato: { filial_id: 'f1' } as never }),
      sol({ id: 'b', tipo: 'emissao', placa: 'RTP7A21', solicitante_id: 'u2', retrato: { filial_id: 'f2' } as never }),
      sol({ id: 'c', tipo: 'lote_emissao', placa: 'QWE3D89', placas_reboque: ['ABC1234'], solicitante_id: 'u1', retrato: { filial_id: 'f2' } as never }),
      sol({ id: 'd', tipo: 'estadia', placa: 'EFU2G04', solicitante_id: 'u1' }),
    ]);
    expect(lista.map((s) => s.id).sort()).toEqual(['a', 'b', 'c']);
    expect(filtrarAcompanhamento(lista, { placa: 'efu-2g 04', filialId: '', enviadoPor: '' }).map((s) => s.id)).toEqual(['a']);
    expect(filtrarAcompanhamento(lista, { placa: 'abc1234', filialId: '', enviadoPor: '' }).map((s) => s.id)).toEqual(['c']);
    expect(filtrarAcompanhamento(lista, { placa: '', filialId: 'f2', enviadoPor: '' }).map((s) => s.id).sort()).toEqual(['b', 'c']);
    expect(filtrarAcompanhamento(lista, { placa: '', filialId: 'f2', enviadoPor: 'u1' }).map((s) => s.id)).toEqual(['c']);
    expect(filtrarAcompanhamento(lista, { placa: 'RTP', filialId: 'f2', enviadoPor: 'u1' })).toEqual([]);
  });
});
