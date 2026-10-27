// Suspender, reativar e encerrar embarques a partir da Lista de Fretes.
// Suspenso sai da Lista e das Posições de Embarque e volta pela busca dos suspensos; após 7 dias o banco encerra.
// Encerrado fica só arquivado no banco, sem opção de reativar (gestor e administrador).

import { useMemo, useState } from 'react';
import { useApp, useIndices } from '../data/store';
import { codigoEmbarque, nome } from '../lib/cadastros';
import { cidadeAnuncio, semDemo } from '../lib/anuncio';
import { fmtDataAsHora } from '../lib/formato';
import { DIAS_SUSPENSO, prazoSuspensao, reativavel } from '../lib/suspensao';
import { normalizar } from '../lib/texto';
import type { Embarque } from '../types';
import { Alerta, EstadoVazio, Modal, useAviso } from './ui';

function Rota({ e }: { e: Embarque }) {
  const idx = useIndices();
  return (
    <div className="se-rota">
      <strong>{cidadeAnuncio(e.origem_cidade, e.origem_uf)} ➜ {cidadeAnuncio(e.destino_cidade, e.destino_uf)}</strong>
      <span className="pequeno suave">{codigoEmbarque(e.codigo)} · {semDemo(nome(idx.cliente, e.cliente_id))} · {semDemo(nome(idx.filial, e.filial_id))}</span>
    </div>
  );
}

function useAcoesEmbarque() {
  const { api, aplicarEmbarque } = useApp();
  const avisar = useAviso();
  const [gravando, setGravando] = useState(false);
  const mudarStatus = async (e: Embarque, para: 'suspenso' | 'liberado') => {
    setGravando(true);
    try {
      const r = await api.atualizarEmbarque(e.id, { status_liberacao: para }, { status_liberacao: e.status_liberacao });
      if (r.status === 'conflito') {
        aplicarEmbarque(r.registro);
        avisar('erro', 'Outra pessoa alterou a liberação deste embarque agora há pouco. Confira a situação atual e tente de novo.');
        return false;
      }
      aplicarEmbarque(r.registro);
      avisar('ok', para === 'suspenso' ? 'Embarque suspenso: saiu da Lista de Fretes e das Posições de Embarque.' : 'Embarque reativado: voltou para a Lista de Fretes.');
      return true;
    } catch (x) { avisar('erro', (x as Error).message); return false; } finally { setGravando(false); }
  };
  const encerrar = async (e: Embarque, motivo: string) => {
    setGravando(true);
    try {
      aplicarEmbarque(await api.encerrarEmbarque(e.id, motivo.trim() || null));
      avisar('ok', 'Embarque encerrado e arquivado.');
      return true;
    } catch (x) { avisar('erro', (x as Error).message); return false; } finally { setGravando(false); }
  };
  return { gravando, mudarStatus, encerrar };
}

export function ConfirmarSuspensao({ e, aoFechar }: { e: Embarque; aoFechar: () => void }) {
  const { gravando, mudarStatus } = useAcoesEmbarque();
  return (
    <Modal titulo="Suspender embarque" aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar} disabled={gravando}>Cancelar</button>
      <button className="btn suspender" disabled={gravando} onClick={async () => { if (await mudarStatus(e, 'suspenso')) aoFechar(); }}>
        {gravando ? 'Suspendendo…' : 'Suspender'}
      </button>
    </>}>
      <Rota e={e} />
      <p>O frete sai da Lista de Fretes e das Posições de Embarque. Para voltar, use <strong>Suspensos</strong> e <strong>Reativar</strong>.</p>
      <Alerta tipo="aviso">Se não for reativado em {DIAS_SUSPENSO} dias, o embarque é encerrado automaticamente.</Alerta>
    </Modal>
  );
}

export function ConfirmarEncerramento({ e, aoFechar }: { e: Embarque; aoFechar: () => void }) {
  const { gravando, encerrar } = useAcoesEmbarque();
  const [motivo, setMotivo] = useState('');
  return (
    <Modal titulo="Encerrar embarque" aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar} disabled={gravando}>Cancelar</button>
      <button className="btn encerrar" disabled={gravando} onClick={async () => { if (await encerrar(e, motivo)) aoFechar(); }}>
        {gravando ? 'Encerrando…' : 'Encerrar definitivamente'}
      </button>
    </>}>
      <Rota e={e} />
      <Alerta tipo="erro">O embarque será encerrado e apenas arquivado. <strong>Não será possível reativá-lo.</strong></Alerta>
      <label className="campo" style={{ marginTop: 12 }}>
        <span>Motivo (opcional)</span>
        <textarea className="entrada" rows={2} maxLength={500} value={motivo} onChange={(ev) => setMotivo(ev.target.value)}
          placeholder="Ex.: contrato finalizado, volume concluído" />
      </label>
    </Modal>
  );
}

/** Busca dos embarques suspensos, com o prazo até o encerramento automático. */
export function EmbarquesSuspensos({ embarques, aoFechar }: { embarques: Embarque[]; aoFechar: () => void }) {
  const { pode } = useApp();
  const idx = useIndices();
  const { gravando, mudarStatus } = useAcoesEmbarque();
  const [busca, setBusca] = useState('');
  const [encerrando, setEncerrando] = useState<Embarque | null>(null);
  const lista = useMemo(() => {
    const t = normalizar(busca);
    return embarques.filter(reativavel)
      .filter((e) => !t || normalizar([codigoEmbarque(e.codigo), e.origem_cidade, e.destino_cidade, nome(idx.cliente, e.cliente_id),
        nome(idx.filial, e.filial_id), nome(idx.produto, e.produto_id, '')].join(' ')).includes(t))
      .sort((a, b) => (a.suspenso_em ?? '').localeCompare(b.suspenso_em ?? ''));
  }, [embarques, busca, idx]);
  const total = embarques.filter(reativavel).length;
  if (encerrando) return <ConfirmarEncerramento e={encerrando} aoFechar={() => setEncerrando(null)} />;
  return (
    <Modal titulo={`Embarques suspensos (${total})`} aoFechar={aoFechar} rodape={<button className="btn primario" onClick={aoFechar}>Fechar</button>}>
      <input className="entrada" type="search" autoFocus value={busca} onChange={(ev) => setBusca(ev.target.value)}
        placeholder="Buscar por código, cidade, cliente, filial ou produto" aria-label="Buscar embarques suspensos" />
      <p className="pequeno suave" style={{ margin: '8px 0' }}>Embarque suspenso há {DIAS_SUSPENSO} dias sem reativação é encerrado automaticamente.</p>
      {!lista.length ? (
        <EstadoVazio titulo={total ? 'Nenhum suspenso encontrado' : 'Nenhum embarque suspenso'}>
          <p>{total ? 'Tente outro termo de busca.' : 'Os embarques suspensos na Lista de Fretes aparecem aqui.'}</p>
        </EstadoVazio>
      ) : (
        <ul className="se-lista">
          {lista.map((e) => {
            const prazo = prazoSuspensao(e);
            return (
              <li key={e.id}>
                <Rota e={e} />
                <span className="pequeno">
                  {e.suspenso_em ? `Suspenso em ${fmtDataAsHora(e.suspenso_em)}` : 'Suspenso'}
                  {' · '}<span className={prazo.urgente ? 'se-urgente' : ''}>{prazo.texto}</span>
                </span>
                <div className="grupo-btn">
                  {pode('embarques.liberar') && <button className="btn peq primario" disabled={gravando} onClick={() => void mudarStatus(e, 'liberado')}>Reativar</button>}
                  {pode('embarques.encerrar') && <button className="btn peq encerrar" disabled={gravando} onClick={() => setEncerrando(e)}>Encerrar</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
