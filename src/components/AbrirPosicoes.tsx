import { useEffect, useState } from 'react';
import { mensagemErro } from '../data/api';
import { useApp } from '../data/store';
import { fmtData, hojeSP, somarDias } from '../lib/formato';
import { Alerta, Modal, useAviso } from './ui';

/** Abertura explícita de posições para uma data. Nunca transporta saldos sem escolha do usuário. */
export function AbrirPosicoes({ aoFechar, embarqueIds, dataInicial }: { aoFechar: () => void; embarqueIds?: string[]; dataInicial?: string }) {
  const { api, estado, recarregar, definirData } = useApp();
  const avisar = useAviso();
  const [data, setData] = useState(dataInicial ?? estado.data);
  const [transportar, setTransportar] = useState<'sim' | 'nao' | ''>('');
  const [anterior, setAnterior] = useState<string | null | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setAnterior(undefined);
    api.ultimaDataComPosicao(estado.demo, data).then(setAnterior).catch(() => setAnterior(null));
  }, [api, data, estado.demo]);

  async function confirmar() {
    if (!transportar) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await api.abrirPosicoes(data, transportar === 'sim', embarqueIds ?? null, estado.demo);
      avisar('ok', `${r.criadas} posição(ões) aberta(s) em ${fmtData(data)}.${r.ja_existiam ? ` ${r.ja_existiam} já existia(m) e não foram alteradas.` : ''}${r.sem_posicao_anterior ? ` ${r.sem_posicao_anterior} sem posição anterior começaram em zero.` : ''}`);
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
        <button className="btn primario" disabled={!transportar || enviando} onClick={confirmar}>{enviando ? 'Abrindo…' : 'Abrir posições'}</button>
      </>}>
      <label className="campo"><span>Data operacional</span>
        <input className="entrada" type="date" value={data} max={somarDias(hojeSP(), 1)} onChange={(e) => e.target.value && setData(e.target.value)} />
      </label>
      <p className="suave" style={{ margin: 0 }}>
        {embarqueIds?.length === 1 ? 'Será criada a posição deste embarque' : 'Serão criadas posições para os embarques ativos do seu escopo'} que ainda não têm posição em {fmtData(data)}.
        Posições existentes não são alteradas e as datas anteriores ficam preservadas. <strong>Carregados sempre começa em 0.</strong>
      </p>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <legend className="pequeno" style={{ fontWeight: 700, marginBottom: 4 }}>Porta e trânsito</legend>
        <label className="check">
          <input type="radio" name="transp" checked={transportar === 'sim'} onChange={() => setTransportar('sim')} />
          <span>Transportar os saldos da última posição anterior{anterior ? ` (${fmtData(anterior)})` : anterior === null ? ' (não há posição anterior)' : ''}</span>
        </label>
        <label className="check">
          <input type="radio" name="transp" checked={transportar === 'nao'} onChange={() => setTransportar('nao')} />
          <span>Começar porta e trânsito em 0</span>
        </label>
      </fieldset>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}
