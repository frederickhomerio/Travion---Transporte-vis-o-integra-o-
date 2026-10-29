// Quadro da posição de embarque de um cliente: faixa com logos, indicadores, volume previsto por destino
// e uma única tabela vertical de embarques. Na visão do cliente recebe só o QuadroCliente (campos públicos);
// status e horários internos chegam à parte, em `mesa`, e só na mesa comercial.

import { forwardRef } from 'react';
import { fmtData, fmtHora, fmtNum, fmtT, ROTULO_STATUS } from '../lib/formato';
import { blocosDestinos, type InfoMesa, type QuadroCliente, TONELADAS_VEICULO_QUADRO } from '../lib/posicoes';

const n = (v: number | null) => (v === null ? '—' : fmtNum(v));

function LogoQuadro({ src, alt, vazio, captura }: { src: string | null; alt: string; vazio: string; captura?: boolean }) {
  // Tamanho por max-width/max-height (sem object-fit, que a captura não respeita): proporção preservada.
  if (src) return <img className="qp-logo" src={src} alt={alt} crossOrigin={src.startsWith('http') ? 'anonymous' : undefined} />;
  if (captura) return null;
  return <span className="qp-logo-vazio" title="Cadastre a imagem para que ela saia no quadro">{vazio}</span>;
}

export const QuadroPosicao = forwardRef<HTMLDivElement, {
  q: QuadroCliente; mesa?: Record<string, InfoMesa>; distribuir: boolean; captura?: boolean;
}>(function QuadroPosicao({ q, mesa, distribuir, captura }, ref) {
  const blocos = blocosDestinos(q.destinos, distribuir);
  return (
    <div ref={ref} className={`qp${captura ? ' qp-captura' : ''}`}>
      <div className="qp-faixa">
        <div className="qp-faixa-cliente">
          <LogoQuadro src={q.logoCliente} alt={`Logo ${q.cliente}`} vazio="Logo do cliente não cadastrada" captura={captura} />
          <div className="qp-faixa-txt">
            <span className="qp-sobre">Posição de embarque</span>
            <strong className="qp-nome">{q.cliente}</strong>
            <span className="qp-data">{fmtData(q.data)}</span>
          </div>
        </div>
        <div className="qp-faixa-tp">
          <LogoQuadro src={q.logoEmpresa} alt="Logo TP" vazio="Logo TP não cadastrada" captura={captura} />
        </div>
      </div>

      <div className="qp-resumo">
        <table className="qp-indicadores">
          <tbody>
            <tr><th scope="row">Embarques</th><td>{fmtNum(q.totais.embarques)}</td></tr>
            <tr><th scope="row">Veiculos Porta</th><td>{fmtNum(q.totais.porta)}</td></tr>
            <tr><th scope="row">Veiculos Transito</th><td>{fmtNum(q.totais.transito)}</td></tr>
            <tr><th scope="row">Veiculos Carregados</th><td>{fmtNum(q.totais.carregados)}</td></tr>
          </tbody>
        </table>
        <div className="qp-volume">
          <div className="qp-volume-titulo">Volume previsto por destino</div>
          <div className={`qp-destinos${blocos.length > 1 ? ' lado' : ''}`}>
            {blocos.map((b, i) => (
              <dl key={i} className="qp-bloco">
                {b.map((d) => (
                  <div key={d.chave} className="qp-destino"><dt>{d.rotulo}</dt><dd>{fmtT(d.toneladas)}</dd></div>
                ))}
              </dl>
            ))}
            {!q.destinos.length && <span className="suave">—</span>}
          </div>
          <div className="qp-total"><span>Volume total previsto</span><strong>{fmtT(q.volumeTotal)}</strong></div>
          <div className="qp-nota">Na porta + em trânsito + carregados hoje · {TONELADAS_VEICULO_QUADRO} t/veículo</div>
        </div>
      </div>

      <div className="qp-tabela-wrap">
        <table className="qp-tabela">
          <thead>
            <tr>
              <th>Origem / Coleta</th><th>Destino / Entrega</th>
              <th className="c">Na porta</th><th className="c">Em trânsito</th><th className="c">Carregados hoje</th>
              <th>{mesa ? 'Observação / status' : 'Observação'}</th>
            </tr>
          </thead>
          <tbody>
            {q.linhas.map((l) => {
              const m = mesa?.[l.chave];
              return (
                <tr key={l.chave}>
                  <td data-rot="Origem / Coleta"><span className="qp-cidade">{l.origem}</span>{l.coleta && <span className="qp-local">{l.coleta}</span>}</td>
                  <td data-rot="Destino / Entrega"><span className="qp-cidade">{l.destino}</span>{l.entrega && <span className="qp-local">{l.entrega}</span>}</td>
                  <td className="c" data-rot="Na porta">{n(l.porta)}</td>
                  <td className="c" data-rot="Em trânsito">{n(l.transito)}</td>
                  <td className="c" data-rot="Carregados hoje">{n(l.carregados)}</td>
                  <td className="qp-obs" data-rot={mesa ? 'Observação / status' : 'Observação'}>
                    {(l.observacao || !m) && <span>{l.observacao ?? '—'}</span>}
                    {m && (
                      <span className="qp-status">
                        <span className={`qp-st ${m.status}`}>{ROTULO_STATUS[m.status]}</span>
                        {' · '}{m.confirmado_em ? `Atualizado às ${fmtHora(m.confirmado_em)}` : 'Nunca confirmada'}
                        {m.desatualizada && <span className="badge aviso qp-desatualizada">Desatualizada</span>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!q.linhas.length && <tr><td colSpan={6} className="qp-sem">Nenhuma posição registrada nesta data para o recorte selecionado.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2} scope="row" data-rot="">Total · {fmtNum(q.totais.embarques)} {q.totais.embarques === 1 ? 'embarque' : 'embarques'}</th>
              <td className="c" data-rot="Na porta">{fmtNum(q.totais.porta)}</td>
              <td className="c" data-rot="Em trânsito">{fmtNum(q.totais.transito)}</td>
              <td className="c" data-rot="Carregados hoje">{fmtNum(q.totais.carregados)}</td>
              <td className="qp-obs-vazia" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
});
