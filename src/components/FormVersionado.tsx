// Formulário que grava apenas os campos alterados e compara com o valor que o usuário viu.
// Se outra pessoa mudou o mesmo campo, mostra o conflito para revisão (nada é sobrescrito em silêncio).

import { useEffect, useMemo, useRef, useState } from 'react';
import { mensagemErro } from '../data/api';
import type { Conflito, ResultadoGravacao } from '../types';
import { Alerta, Modal, useAviso } from './ui';

export interface DefCampo {
  campo: string;
  rotulo: string;
  tipo: 'texto' | 'textarea' | 'numero' | 'inteiro' | 'select' | 'data' | 'uf';
  opcoes?: Array<{ valor: string; rotulo: string }>;
  pode: boolean;
  ajuda?: string;
  vazio?: string;
  largo?: boolean;
  /** Campo fixo nesta tela (a ajuda explica o motivo; não é falta de permissão). */
  travado?: boolean;
}

type Valores = Record<string, unknown>;

const paraTexto = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function converter(d: DefCampo, s: string): unknown {
  const t = s.trim();
  if (t === '') return null;
  if (d.tipo === 'numero' || d.tipo === 'inteiro') {
    const n = Number(t.replace(',', '.'));
    return Number.isFinite(n) ? n : t;
  }
  if (d.tipo === 'uf') return t.toUpperCase();
  return t;
}

export function FormVersionado<T extends object>({ campos, registro, salvar, aoSalvo, rotuloSalvar = 'Salvar alterações', exibirConflitoComo }: {
  campos: DefCampo[];
  registro: T;
  salvar: (alt: Valores, base: Valores, forcar: boolean) => Promise<ResultadoGravacao<T>>;
  aoSalvo?: (r: T) => void;
  rotuloSalvar?: string;
  exibirConflitoComo?: (campo: string, v: unknown) => string;
}) {
  const avisar = useAviso();
  const reg = registro as unknown as Valores;
  const [base, setBase] = useState<Valores>(() => Object.fromEntries(campos.map((c) => [c.campo, reg[c.campo] ?? null])));
  const [texto, setTexto] = useState<Record<string, string>>(() => Object.fromEntries(campos.map((c) => [c.campo, paraTexto(reg[c.campo])])));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [conflitos, setConflitos] = useState<{ lista: Conflito[]; atual: Valores; alt: Valores } | null>(null);
  const textoRef = useRef(texto);
  textoRef.current = texto;

  const sujo = (c: DefCampo, t = texto, b = base) => {
    const v = converter(c, t[c.campo] ?? '');
    return paraTexto(v) !== paraTexto(b[c.campo]);
  };

  // Campos não editados acompanham as atualizações em tempo real.
  useEffect(() => {
    const nb: Valores = { ...base };
    const nt = { ...textoRef.current };
    let mudou = false;
    for (const c of campos) {
      const srv = reg[c.campo] ?? null;
      if (paraTexto(srv) !== paraTexto(base[c.campo]) && !sujo(c, textoRef.current, base)) {
        nb[c.campo] = srv;
        nt[c.campo] = paraTexto(srv);
        mudou = true;
      }
    }
    if (mudou) { setBase(nb); setTexto(nt); }
  }, [registro]); // eslint-disable-line react-hooks/exhaustive-deps

  const alterados = useMemo(() => campos.filter((c) => c.pode && sujo(c)), [campos, texto, base]); // eslint-disable-line react-hooks/exhaustive-deps

  async function gravar(alt: Valores, b: Valores, forcar = false) {
    setSalvando(true);
    setErro(null);
    try {
      const r = await salvar(alt, b, forcar);
      if (r.status === 'conflito') {
        setConflitos({ lista: r.conflitos, atual: r.registro as unknown as Valores, alt });
        return;
      }
      const nreg = r.registro as unknown as Valores;
      setBase(Object.fromEntries(campos.map((c) => [c.campo, nreg[c.campo] ?? null])));
      setTexto(Object.fromEntries(campos.map((c) => [c.campo, paraTexto(nreg[c.campo])])));
      aoSalvo?.(r.registro);
      avisar('ok', r.status === 'sem_alteracao' ? 'Nenhuma alteração para salvar.' : 'Alterações salvas.');
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  function enviar() {
    const alt: Valores = {};
    const b: Valores = {};
    for (const c of alterados) {
      alt[c.campo] = converter(c, texto[c.campo]);
      b[c.campo] = base[c.campo] ?? null;
    }
    void gravar(alt, b);
  }

  const fmt = (campo: string, v: unknown) => (exibirConflitoComo ? exibirConflitoComo(campo, v) : v === null || v === undefined || v === '' ? 'vazio' : String(v));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="grade-campos">
        {campos.map((c) => (
          <label key={c.campo} className="campo" style={c.largo || c.tipo === 'textarea' ? { gridColumn: '1 / -1' } : undefined}>
            <span>{c.rotulo}{sujo(c) && <span className="badge aviso" style={{ marginLeft: 6 }}>alterado</span>}</span>
            {c.tipo === 'select' ? (
              <select className="entrada" disabled={!c.pode} value={texto[c.campo]} onChange={(e) => setTexto({ ...texto, [c.campo]: e.target.value })}>
                {c.vazio !== undefined && <option value="">{c.vazio}</option>}
                {c.opcoes!.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
              </select>
            ) : c.tipo === 'textarea' ? (
              <textarea className="entrada" disabled={!c.pode} value={texto[c.campo]} onChange={(e) => setTexto({ ...texto, [c.campo]: e.target.value })} />
            ) : (
              <input className="entrada" disabled={!c.pode} type={c.tipo === 'data' ? 'date' : 'text'}
                inputMode={c.tipo === 'numero' ? 'decimal' : c.tipo === 'inteiro' ? 'numeric' : undefined}
                maxLength={c.tipo === 'uf' ? 2 : undefined}
                value={texto[c.campo]} onChange={(e) => setTexto({ ...texto, [c.campo]: e.target.value })} />
            )}
            {c.ajuda && <small>{c.ajuda}</small>}
            {!c.pode && !c.travado && <small>Somente leitura para o seu perfil.</small>}
          </label>
        ))}
      </div>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {campos.some((c) => c.pode) && (
        <div className="grupo-btn">
          <button className="btn primario" disabled={alterados.length === 0 || salvando} onClick={enviar}>
            {salvando ? 'Salvando…' : alterados.length ? `${rotuloSalvar} (${alterados.length})` : rotuloSalvar}
          </button>
          {alterados.length > 0 && !salvando && (
            <button className="btn sutil" onClick={() => setTexto(Object.fromEntries(campos.map((c) => [c.campo, paraTexto(base[c.campo])])))}>Descartar</button>
          )}
          {alterados.length > 0 && <span className="pequeno" style={{ color: 'var(--ambar-800)' }}>Alterações ainda não salvas.</span>}
        </div>
      )}
      {conflitos && (
        <Modal titulo="Revise as alterações em conflito" aoFechar={() => setConflitos(null)} rodape={<>
          <button className="btn" onClick={() => {
            const nb = { ...base }; const nt = { ...texto };
            for (const c of conflitos.lista) { nb[c.campo] = conflitos.atual[c.campo] ?? null; nt[c.campo] = paraTexto(conflitos.atual[c.campo]); }
            setBase(nb); setTexto(nt); setConflitos(null);
          }}>Manter os valores atuais</button>
          <button className="btn primario" onClick={() => {
            const b: Valores = {};
            for (const k of Object.keys(conflitos.alt)) b[k] = conflitos.atual[k] ?? null;
            setConflitos(null);
            void gravar(conflitos.alt, b);
          }}>Gravar os meus valores</button>
        </>}>
          <p style={{ margin: 0 }}>Outra pessoa alterou estes campos depois que você abriu a tela. Nada foi gravado ainda.</p>
          <table className="tabela">
            <thead><tr><th>Campo</th><th>Quando você abriu</th><th>Valor atual</th><th>Seu valor</th></tr></thead>
            <tbody>
              {conflitos.lista.map((c) => (
                <tr key={c.campo}>
                  <td>{campos.find((x) => x.campo === c.campo)?.rotulo ?? c.rotulo}</td>
                  <td>{fmt(c.campo, c.valor_base)}</td>
                  <td><strong>{fmt(c.campo, c.valor_atual)}</strong></td>
                  <td>{fmt(c.campo, c.valor_proposto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
    </div>
  );
}
