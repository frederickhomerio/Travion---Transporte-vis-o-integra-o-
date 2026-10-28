// Gráficos do Painel Operacional em SVG/HTML, sem biblioteca: linha comparativa e mapa de calor.
// Os dois recalculam o tamanho pelo próprio contêiner (expandir, Modo TV e tela inteira).

import { useEffect, useRef, useState } from 'react';

function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setTam({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, tam] as const;
}

/** Marcas do eixo Y em números inteiros "redondos". */
function marcas(max: number): number[] {
  if (max <= 0) return [0, 1];
  const bruto = max / 4;
  const p = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 5, 10].map((m) => m * p).find((x) => x >= bruto) ?? bruto;
  const inteiro = Math.max(1, Math.ceil(passo));
  const out: number[] = [];
  for (let v = 0; v <= max + inteiro / 2; v += inteiro) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + inteiro);
  return out;
}

export interface PontoDetalhe { titulo: string; atual: number | null; anterior: number | null; rotuloAnterior: string }

export function GraficoLinha({ rotulos, atual, anterior, detalhe, altura = 240, unidade = 'solicitações' }: {
  rotulos: string[]; atual: Array<number | null>; anterior: Array<number | null>;
  detalhe: (i: number) => PontoDetalhe; altura?: number | 'auto'; unidade?: string;
}) {
  const [ref, tam] = useLargura<HTMLDivElement>();
  const [sel, setSel] = useState<number | null>(null);
  const w = Math.max(tam.w, 260);
  const h = altura === 'auto' ? Math.max(tam.h, 200) : altura;
  const m = { t: 12, r: 12, b: 26, l: 34 };
  const n = rotulos.length;
  const max = Math.max(1, ...atual.map((v) => v ?? 0), ...anterior.map((v) => v ?? 0));
  const ys = marcas(max);
  const topo = ys[ys.length - 1];
  const x = (i: number) => m.l + (n <= 1 ? 0 : (i * (w - m.l - m.r)) / (n - 1));
  const y = (v: number) => m.t + (h - m.t - m.b) * (1 - v / topo);
  const caminho = (vs: Array<number | null>) => {
    let d = '';
    let abre = true;
    vs.forEach((v, i) => {
      if (v === null) { abre = true; return; }
      d += `${abre ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      abre = false;
    });
    return d;
  };
  // Rótulos do eixo X sem sobreposição.
  const cabe = Math.max(1, Math.floor((w - m.l - m.r) / 34));
  const salto = Math.ceil(n / cabe);
  const escolher = (clientX: number, el: SVGSVGElement) => {
    const b = el.getBoundingClientRect();
    const px = ((clientX - b.left) / b.width) * w;
    setSel(Math.min(n - 1, Math.max(0, Math.round(((px - m.l) / (w - m.l - m.r)) * (n - 1)))));
  };
  const d = sel !== null ? detalhe(sel) : null;
  return (
    <div className="gl" ref={ref} style={altura === 'auto' ? { height: '100%' } : undefined}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Linha: ${unidade} por intervalo, período atual e anterior`}
        onPointerMove={(e) => escolher(e.clientX, e.currentTarget)} onPointerDown={(e) => escolher(e.clientX, e.currentTarget)}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setSel(null); }}>
        {ys.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} className="gl-grade" />
            <text x={m.l - 6} y={y(v) + 4} textAnchor="end" className="gl-eixo">{v}</text>
          </g>
        ))}
        {rotulos.map((r, i) => (i % salto === 0 || i === n - 1) && (
          <text key={i} x={x(i)} y={h - 8} textAnchor="middle" className="gl-eixo">{r}</text>
        ))}
        <path d={caminho(anterior)} className="gl-anterior" />
        <path d={caminho(atual)} className="gl-atual" />
        {atual.map((v, i) => v !== null && (atual[i - 1] ?? null) === null && (atual[i + 1] ?? null) === null && (
          <circle key={i} cx={x(i)} cy={y(v)} r={3} className="gl-ponto" />
        ))}
        {sel !== null && (
          <g>
            <line x1={x(sel)} x2={x(sel)} y1={m.t} y2={h - m.b} className="gl-cruz" />
            {anterior[sel] !== null && <circle cx={x(sel)} cy={y(anterior[sel]!)} r={4} className="gl-ponto-ant" />}
            {atual[sel] !== null && <circle cx={x(sel)} cy={y(atual[sel]!)} r={4.5} className="gl-ponto" />}
          </g>
        )}
      </svg>
      {d && (
        <div className="gl-dica" style={{ left: Math.min(Math.max(x(sel!) - 90, 0), w - 190) }} role="status">
          <strong>{d.titulo}</strong>
          <span><i className="gl-leg-atual" />Período: {d.atual === null ? 'sem dados' : `${d.atual} ${unidade}`}</span>
          <span><i className="gl-leg-ant" />{d.rotuloAnterior}: {d.anterior === null ? 'sem dados' : `${d.anterior} ${unidade}`}</span>
        </div>
      )}
    </div>
  );
}

/** Cor do mapa: do claro (menos chegadas) ao vinho (mais). */
function corCalor(v: number, max: number): { fundo: string; texto: string } {
  if (max <= 0 || v <= 0) return { fundo: '#f6f1ec', texto: 'var(--cinza-600)' };
  const t = v / max;
  const a = [246, 233, 226];
  const b = [89, 13, 32];
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * (0.15 + 0.85 * t)));
  return { fundo: `rgb(${c.join(',')})`, texto: t > 0.45 ? '#fff' : 'var(--vinho-escuro)' };
}

export function MapaCalorGrade({ matriz, max, passo, dias, aoEscolher, escolhida }: {
  matriz: number[][]; max: number; passo: 1 | 2; dias: string[];
  aoEscolher: (dia: number, faixa: number) => void; escolhida: [number, number] | null;
}) {
  const colunas = matriz[0]?.length ?? 0;
  return (
    <div className="mc-rolagem">
      <div className="mc" style={{ gridTemplateColumns: `minmax(34px, auto) repeat(${colunas}, minmax(22px, 1fr))` }} role="grid" aria-label="Mapa de calor das chegadas">
        <span />
        {Array.from({ length: colunas }, (_, c) => <span key={c} className="mc-hora">{String(c * passo).padStart(2, '0')}h</span>)}
        {matriz.map((linha, d) => (
          <div key={d} className="mc-linha" role="row">
            <span className="mc-dia">{dias[d]}</span>
            {linha.map((v, c) => {
              const cor = corCalor(v, max);
              const ativo = escolhida?.[0] === d && escolhida?.[1] === c;
              return (
                <button key={c} type="button" role="gridcell" className={`mc-cel${ativo ? ' ativo' : ''}`} style={{ background: cor.fundo, color: cor.texto }}
                  aria-label={`${dias[d]}, ${String(c * passo).padStart(2, '0')}h às ${String((c + 1) * passo).padStart(2, '0')}h: ${v} chamado${v === 1 ? '' : 's'}`}
                  onClick={() => aoEscolher(d, c)}>{v}</button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mc-legenda" aria-hidden="true">
        <span>menos</span>
        <span className="mc-escala" />
        <span>mais ({max} no maior intervalo)</span>
      </div>
    </div>
  );
}
