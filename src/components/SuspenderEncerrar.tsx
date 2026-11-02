// Suspender, encerrar e reativar embarques na Lista de Fretes (abas Liberados, Suspensos e Encerrados — 02/11/2026).
// Suspenso sai da Lista e das Posições e volta pela aba Suspensos; após 7 dias suspenso o banco encerra sozinho.
// Encerrado fica na aba Encerrados com data, responsável e motivo. Quem tem embarques.reativar_encerrado pode trazê-lo
// de volta para Liberados (mesmo ID, código e histórico), com motivo; o servidor confere permissão, escopo e versão.

import { useMemo, useState } from 'react';
import { useApp, useIndices } from '../data/store';
import { codigoEmbarque, nome } from '../lib/cadastros';
import { cidadeAnuncio, semDemo } from '../lib/anuncio';
import { fmtDataAsHora } from '../lib/formato';
import { DIAS_SUSPENSO, prazoSuspensao } from '../lib/suspensao';
import { normalizar } from '../lib/texto';
import { LIMITE_MOTIVO, motivoValido } from '../lib/vitrine';
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
  const { api, aplicarEmbarque, recarregarVitrine } = useApp();
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
      void recarregarVitrine();
      avisar('ok', para === 'suspenso' ? 'Embarque suspenso: saiu da Lista de Fretes e das Posições de Embarque.' : 'Embarque reativado: voltou para Liberados.');
      return true;
    } catch (x) { avisar('erro', (x as Error).message); return false; } finally { setGravando(false); }
  };
  const encerrar = async (e: Embarque, motivo: string) => {
    setGravando(true);
    try {
      aplicarEmbarque(await api.encerrarEmbarque(e.id, motivo.trim() || null));
      void recarregarVitrine();
      avisar('ok', 'Embarque encerrado: está na aba Encerrados, com data, responsável e motivo.');
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
      <p>O frete sai da Lista de Fretes e das Posições de Embarque. Para voltar, use a aba <strong>Suspensos</strong> e <strong>Reativar</strong>.</p>
      <Alerta tipo="aviso">Se não for reativado em {DIAS_SUSPENSO} dias, o embarque é encerrado automaticamente.</Alerta>
    </Modal>
  );
}

export function ConfirmarEncerramento({ e, aoFechar }: { e: Embarque; aoFechar: () => void }) {
  const { pode } = useApp();
  const { gravando, encerrar } = useAcoesEmbarque();
  const [motivo, setMotivo] = useState('');
  return (
    <Modal titulo="Encerrar embarque" aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar} disabled={gravando}>Cancelar</button>
      <button className="btn encerrar" disabled={gravando} onClick={async () => { if (await encerrar(e, motivo)) aoFechar(); }}>
        {gravando ? 'Encerrando…' : 'Encerrar'}
      </button>
    </>}>
      <Rota e={e} />
      <Alerta tipo="aviso">
        <span>O embarque sai da Lista de Fretes e das Posições e vai para a aba <strong>Encerrados</strong>. A data, quem encerrou e o motivo
          ficam registrados no histórico. {pode('embarques.reativar_encerrado')
            ? 'Você pode reativá-lo depois pela aba Encerrados, informando o motivo.'
            : 'Só quem tem a permissão "Reativar encerrado" pode trazê-lo de volta, informando o motivo.'}</span>
      </Alerta>
      <label className="campo" style={{ marginTop: 12 }}>
        <span>Motivo (opcional)</span>
        <textarea className="entrada" rows={2} maxLength={LIMITE_MOTIVO} value={motivo} onChange={(ev) => setMotivo(ev.target.value)}
          placeholder="Ex.: contrato finalizado, volume concluído" />
      </label>
    </Modal>
  );
}

/** Reativar encerrado: motivo obrigatório (até 500 caracteres) e a versão que a tela mostrava. */
export function ReativarEncerrado({ e, aoFechar }: { e: Embarque; aoFechar: () => void }) {
  const { api, estado, aplicarEmbarque, recarregarVitrine } = useApp();
  const avisar = useAviso();
  const atual = estado.embarques[e.id] ?? e;
  const [motivo, setMotivo] = useState('');
  const [gravando, setGravando] = useState(false);
  const [conflito, setConflito] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const aindaEncerrado = !!atual.encerrado_em && atual.situacao === 'arquivado';
  const enviar = async () => {
    if (!motivoValido(motivo)) { setErro(`Informe o motivo da reativação (até ${LIMITE_MOTIVO} caracteres).`); return; }
    setGravando(true); setErro(null);
    try {
      const r = await api.reativarEncerrado(atual.id, motivo.trim(), atual.versao);
      aplicarEmbarque(r.registro);
      if (r.status === 'conflito') { setConflito(true); return; }
      void recarregarVitrine();
      avisar('ok', `Embarque ${codigoEmbarque(atual.codigo)} reativado: voltou para Liberados com o mesmo código e histórico.`);
      aoFechar();
    } catch (x) { setErro((x as Error).message); } finally { setGravando(false); }
  };
  return (
    <Modal titulo="Reativar embarque encerrado" aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar} disabled={gravando}>Cancelar</button>
      {aindaEncerrado && <button className="btn primario" disabled={gravando || !motivoValido(motivo)} onClick={() => void enviar()}>
        {gravando ? 'Reativando…' : conflito ? 'Conferi, reativar' : 'Reativar'}
      </button>}
    </>}>
      <Rota e={atual} />
      {conflito && (aindaEncerrado
        ? <Alerta tipo="aviso">Este embarque foi alterado por outra pessoa enquanto a janela estava aberta. Os dados acima foram recarregados: confira e envie de novo.</Alerta>
        : <Alerta tipo="info">Este embarque não está mais encerrado (outra pessoa já o reativou). Nada foi gravado.</Alerta>)}
      {aindaEncerrado && <>
        <p className="pequeno" style={{ margin: '0 0 8px' }}>
          Encerrado em {fmtDataAsHora(atual.encerrado_em)} por {atual.encerrado_por_nome ?? 'Sistema'}{atual.encerrado_motivo ? ` · motivo: ${atual.encerrado_motivo}` : ''}.
        </p>
        <p className="pequeno suave" style={{ margin: '0 0 8px' }}>
          Volta para <strong>Liberados</strong> com o mesmo código, vínculos e histórico. O encerramento anterior e este motivo ficam no histórico.
          Posições de dias anteriores não são reabertas.
        </p>
        <label className="campo">
          <span>Motivo da reativação *</span>
          <textarea className="entrada" rows={3} maxLength={LIMITE_MOTIVO} value={motivo} autoFocus
            onChange={(ev) => setMotivo(ev.target.value)} placeholder="Ex.: cliente retomou o contrato" />
          <small>{motivo.trim().length}/{LIMITE_MOTIVO}</small>
        </label>
      </>}
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}

const filtrarBusca = (lista: Embarque[], busca: string, txt: (e: Embarque) => string) => {
  const t = normalizar(busca);
  return t ? lista.filter((e) => normalizar(txt(e)).includes(t)) : lista;
};

/** Aba Suspensos: suspensos do escopo, com o prazo até o encerramento automático. */
export function PainelSuspensos({ embarques, aoDetalhes }: { embarques: Embarque[]; aoDetalhes: (id: string) => void }) {
  const { pode } = useApp();
  const idx = useIndices();
  const { gravando, mudarStatus } = useAcoesEmbarque();
  const [busca, setBusca] = useState('');
  const [encerrando, setEncerrando] = useState<Embarque | null>(null);
  const lista = useMemo(() => filtrarBusca(embarques, busca, (e) => [codigoEmbarque(e.codigo), e.origem_cidade, e.destino_cidade,
    nome(idx.cliente, e.cliente_id), nome(idx.filial, e.filial_id), nome(idx.produto, e.produto_id, '')].join(' '))
    .sort((a, b) => (a.suspenso_em ?? '').localeCompare(b.suspenso_em ?? '')), [embarques, busca, idx]);
  return (
    <div className="cartao cartao-corpo se-painel">
      <input className="entrada" type="search" value={busca} onChange={(ev) => setBusca(ev.target.value)}
        placeholder="Buscar por código, cidade, cliente, filial ou produto" aria-label="Buscar embarques suspensos" />
      <p className="pequeno suave" style={{ margin: '8px 0' }}>Embarque suspenso há {DIAS_SUSPENSO} dias sem reativação é encerrado automaticamente.</p>
      {!lista.length ? (
        <EstadoVazio titulo={embarques.length ? 'Nenhum suspenso encontrado' : 'Nenhum embarque suspenso'}>
          <p>{embarques.length ? 'Tente outro termo de busca.' : 'Os embarques suspensos do seu centro de custo aparecem aqui.'}</p>
        </EstadoVazio>
      ) : (
        <ul className="se-lista">
          {lista.map((e) => {
            const prazo = prazoSuspensao(e);
            return (
              <li key={e.id}>
                <Rota e={e} />
                <span className="pequeno">
                  <span className="badge suspenso"><span aria-hidden="true">■</span>Suspenso</span>{' '}
                  {e.suspenso_em ? `em ${fmtDataAsHora(e.suspenso_em)}` : ''}
                  {' · '}<span className={prazo.urgente ? 'se-urgente' : ''}>{prazo.texto}</span>
                </span>
                <div className="grupo-btn">
                  <button className="btn peq" onClick={() => aoDetalhes(e.id)}>Detalhes</button>
                  {pode('embarques.liberar') && <button className="btn peq primario" disabled={gravando} onClick={() => void mudarStatus(e, 'liberado')}>Reativar</button>}
                  {pode('embarques.encerrar') && <button className="btn peq encerrar" disabled={gravando} onClick={() => setEncerrando(e)}>Encerrar</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {encerrando && <ConfirmarEncerramento e={encerrando} aoFechar={() => setEncerrando(null)} />}
    </div>
  );
}

/** Aba Encerrados: data, responsável e motivo; histórico conforme permissão; Reativar só com embarques.reativar_encerrado. */
export function PainelEncerrados({ embarques, aoDetalhes }: { embarques: Embarque[]; aoDetalhes: (id: string) => void }) {
  const { pode } = useApp();
  const idx = useIndices();
  const [busca, setBusca] = useState('');
  const [reativando, setReativando] = useState<Embarque | null>(null);
  const lista = useMemo(() => filtrarBusca(embarques, busca, (e) => [codigoEmbarque(e.codigo), e.origem_cidade, e.destino_cidade,
    nome(idx.cliente, e.cliente_id), nome(idx.filial, e.filial_id), nome(idx.produto, e.produto_id, ''), e.encerrado_por_nome ?? '', e.encerrado_motivo ?? ''].join(' '))
    .sort((a, b) => (b.encerrado_em ?? '').localeCompare(a.encerrado_em ?? '')), [embarques, busca, idx]);
  return (
    <div className="cartao cartao-corpo se-painel">
      <input className="entrada" type="search" value={busca} onChange={(ev) => setBusca(ev.target.value)}
        placeholder="Buscar por código, cidade, cliente, filial, responsável ou motivo" aria-label="Buscar embarques encerrados" />
      {!lista.length ? (
        <EstadoVazio titulo={embarques.length ? 'Nenhum encerrado encontrado' : 'Nenhum embarque encerrado'}>
          <p>{embarques.length ? 'Tente outro termo de busca.' : 'Os embarques encerrados do seu centro de custo aparecem aqui.'}</p>
        </EstadoVazio>
      ) : (
        <ul className="se-lista" style={{ marginTop: 10 }}>
          {lista.map((e) => (
            <li key={e.id}>
              <Rota e={e} />
              <dl className="se-encerramento">
                <div><dt>Encerrado em</dt><dd>{fmtDataAsHora(e.encerrado_em)}</dd></div>
                <div><dt>Responsável</dt><dd>{e.encerrado_por_nome ?? 'Sistema'}</dd></div>
                <div className="se-motivo"><dt>Motivo</dt><dd>{e.encerrado_motivo || <span className="suave">Não informado</span>}</dd></div>
              </dl>
              <div className="grupo-btn">
                <button className="btn peq" onClick={() => aoDetalhes(e.id)}>{pode('historico.ver') ? 'Detalhes e histórico' : 'Detalhes'}</button>
                {pode('embarques.reativar_encerrado') && <button className="btn peq primario" onClick={() => setReativando(e)}>Reativar</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {reativando && <ReativarEncerrado e={reativando} aoFechar={() => setReativando(null)} />}
    </div>
  );
}
