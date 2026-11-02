import { useState } from 'react';
import { mensagemErro } from '../data/api';
import { useApp } from '../data/store';
import { fmtData, hojeSP, somarDias } from '../lib/formato';
import { Alerta, Modal, useAviso } from './ui';

/** Abertura explícita de posições para uma data. Toda posição nova nasce zerada (porta, trânsito e carregados em 0);
 *  não há pergunta sobre transportar saldos (decisão de 02/11/2026). O servidor também ignora o pedido legado. */
export function AbrirPosicoes({ aoFechar, embarqueIds, dataInicial }: { aoFechar: () => void; embarqueIds?: string[]; dataInicial?: string }) {
  const { api, estado, recarregar, definirData } = useApp();
  const avisar = useAviso();
  const [data, setData] = useState(dataInicial ?? estado.data);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.abrirPosicoes(data, embarqueIds ?? null, estado.demo);
      avisar('ok', `${r.criadas} posição(ões) aberta(s) em ${fmtData(data)}, com porta, trânsito e carregados em 0.${r.ja_existiam ? ` ${r.ja_existiam} já existia(m) e não foram alteradas.` : ''}`);
      definirData(data);
      await recarregar();
      aoFechar();
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={embarqueIds?.length === 1 ? 'Abrir posição do embarque' : 'Abrir posições para uma data'} aoFechar={aoFechar}
      rodape={<>
        <button className="btn" onClick={aoFechar}>Cancelar</button>
        <button className="btn primario" disabled={enviando} onClick={confirmar}>{enviando ? 'Abrindo…' : 'Abrir posições'}</button>
      </>}>
      <label className="campo"><span>Data operacional</span>
        <input className="entrada" type="date" value={data} max={somarDias(hojeSP(), 1)} onChange={(e) => e.target.value && setData(e.target.value)} />
      </label>
      <p className="suave" style={{ margin: 0 }}>
        {embarqueIds?.length === 1 ? 'Será criada a posição deste embarque' : 'Serão criadas posições para os embarques ativos do seu escopo'} que ainda não têm posição em {fmtData(data)}.
      </p>
      <Alerta tipo="info">
        <span>Toda posição nova começa com <strong>Na porta 0</strong>, <strong>Em trânsito 0</strong> e <strong>Carregados 0</strong>.
          Posições que já existem nesta data não são alteradas e as datas anteriores ficam preservadas.</span>
      </Alerta>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}
