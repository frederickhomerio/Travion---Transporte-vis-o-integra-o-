// Peças comuns da documentação: status, tipo, tempo, copiar, seleção de arquivos, histórico e visualização em janela.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../../data/store';
import type { ArquivoDoc } from '../../data/api';
import { ACEITA_CADASTRO, CATEGORIA, LIMITE_ARQUIVO, LIMITE_CADASTRO, MOTIVO_DEVOLUCAO, REF_CADASTRO, STATUS_DOC, TIPOS_ARQUIVO, TIPO_DOC, fmtTamanho, tipoCadastro } from '../../lib/documentacao';
import { fmtDataHora } from '../../lib/formato';
import type { AnexoDoc, CategoriaAnexo, MensagemDoc, SolicitacaoDoc, StatusDoc } from '../../types';
import { useAviso } from '../ui';
import { VisualizadorAnexo } from './VisualizadorAnexo';

/** Relógio da tela (tempo de espera), sem depender do servidor. */
export function useAgora(intervalo = 30000) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), intervalo); return () => clearInterval(t); }, [intervalo]);
  return agora;
}

export function StatusDocPill({ status }: { status: StatusDoc }) {
  return <span className={`sd sd-${status}`}>{STATUS_DOC[status]}</span>;
}

/** Tipo em destaque e número menor logo abaixo (coluna Solicitação). */
export function TipoNumero({ s }: { s: SolicitacaoDoc }) {
  return (
    <span className="tn">
      <span className="tn-tipo">{TIPO_DOC[s.tipo]}</span>
      <span className="tn-num">Solicitação nº {s.numero}</span>
    </span>
  );
}

export function Copiar({ texto, rotulo = 'Copiar' }: { texto: string; rotulo?: string }) {
  const avisar = useAviso();
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn-copiar" aria-label={`${rotulo}: ${texto}`} onClick={async () => {
      try { await navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500); } catch { avisar('erro', 'Não foi possível copiar.'); }
    }}>{ok ? 'Copiado' : rotulo}</button>
  );
}

/** Arquivo escolhido no formulário: sobe ao Storage só no envio e guarda o caminho para não repetir em nova tentativa. */
export interface ArquivoLocal { id: string; arquivo: File; categoria: CategoriaAnexo; enviado?: ArquivoDoc; situacao?: 'enviando' | 'falhou' }

/** `cadastro`: formatos do Cadastro (PDF, imagem, Office, vídeo, áudio) até 10 MB; `max`: quantidade máxima nesta lista. */
export function SeletorArquivos({ rotulo, categoria, itens, aoMudar, obrigatorio, ajuda, categorias, cadastro, max, desabilitado }: {
  rotulo: string; categoria: CategoriaAnexo; itens: ArquivoLocal[]; aoMudar: (x: ArquivoLocal[]) => void;
  obrigatorio?: boolean; ajuda?: string; categorias?: CategoriaAnexo[]; cadastro?: boolean; max?: number; desabilitado?: boolean;
}) {
  const avisar = useAviso();
  const input = useRef<HTMLInputElement>(null);
  const meus = itens.filter((i) => (categorias ? categorias.includes(i.categoria) : i.categoria === categoria));
  const outros = itens.filter((i) => !meus.includes(i));
  return (
    <div className="campo sa">
      <span>{rotulo}{obrigatorio && ' *'}</span>
      {ajuda && <small>{ajuda}</small>}
      <ul className="sa-lista">
        {meus.map((i) => (
          <li key={i.id}>
            {categorias && (
              <select className="entrada sa-cat" value={i.categoria} aria-label={`Tipo de ${i.arquivo.name}`}
                onChange={(e) => aoMudar(itens.map((x) => (x.id === i.id ? { ...x, categoria: e.target.value as CategoriaAnexo } : x)))}>
                {categorias.map((c) => <option key={c} value={c}>{CATEGORIA[c]}</option>)}
              </select>
            )}
            <span className="sa-nome">{i.arquivo.name}</span>
            <span className={`pequeno ${i.situacao === 'falhou' ? 'erro-campo' : 'suave'}`}>{fmtTamanho(i.arquivo.size)} · {
              i.enviado ? 'enviado' : i.situacao === 'enviando' ? 'enviando…' : i.situacao === 'falhou' ? 'falhou, tente de novo' : 'pronto para enviar'}</span>
            <button type="button" className="btn sutil peq" disabled={desabilitado} onClick={() => aoMudar(itens.filter((x) => x.id !== i.id))} aria-label={`Remover ${i.arquivo.name}`}>Remover</button>
          </li>
        ))}
      </ul>
      <input ref={input} type="file" multiple accept={cadastro ? ACEITA_CADASTRO : TIPOS_ARQUIVO} hidden onChange={(e) => {
        const novos: ArquivoLocal[] = [];
        for (const f of Array.from(e.target.files ?? [])) {
          if (cadastro ? !tipoCadastro(f.name, f.type) : !TIPOS_ARQUIVO.split(',').includes(f.type)) {
            avisar('erro', cadastro ? `${f.name}: formato não aceito.` : `${f.name}: use PDF, PNG, JPG ou WEBP.`); continue;
          }
          if (f.size <= 0) { avisar('erro', `${f.name}: arquivo vazio.`); continue; }
          if (f.size > (cadastro ? LIMITE_CADASTRO : LIMITE_ARQUIVO)) { avisar('erro', `${f.name}: maior que ${cadastro ? 10 : 15} MB.`); continue; }
          if (max && meus.length + novos.length >= max) { avisar('erro', `${rotulo}: no máximo ${max} arquivo(s).`); break; }
          novos.push({ id: crypto.randomUUID(), arquivo: f, categoria });
        }
        aoMudar([...outros, ...meus, ...novos]);
        e.target.value = '';
      }} />
      <button type="button" className="btn peq sa-add" disabled={desabilitado || (!!max && meus.length >= max)} onClick={() => input.current?.click()}>
        {cadastro ? '+ Anexar arquivo' : '+ Anexar PDF ou imagem'}{max ? ` (${meus.length}/${max})` : ''}
      </button>
    </div>
  );
}

/** Sobe ao Storage o que ainda não subiu; em erro, o que já subiu fica guardado para a nova tentativa. */
export async function enviarArquivos(itens: ArquivoLocal[], enviar: (f: File) => Promise<{ caminho: string; nome: string }>,
  aoAtualizar: (x: ArquivoLocal[]) => void): Promise<ArquivoDoc[]> {
  const atual = [...itens];
  for (const [n, i] of atual.entries()) {
    if (i.enviado) { atual[n] = { ...i, enviado: { ...i.enviado, categoria: i.categoria } }; continue; }
    atual[n] = { ...i, situacao: 'enviando' };
    aoAtualizar([...atual]);
    try {
      const r = await enviar(i.arquivo);
      atual[n] = { ...i, situacao: undefined, enviado: { ...r, categoria: i.categoria } };
    } catch (e) {
      atual[n] = { ...i, situacao: 'falhou' };
      aoAtualizar([...atual]);
      throw e;
    }
    aoAtualizar([...atual]);
  }
  aoAtualizar(atual);
  return atual.map((i) => i.enviado!);
}

export function Historico({ mensagens, anexos }: { mensagens: MensagemDoc[]; anexos: AnexoDoc[] }) {
  return (
    <ol className="hd">
      {mensagens.map((m) => {
        const arqs = anexos.filter((a) => a.mensagem_id === m.id);
        return (
          <li key={m.id} className={`hd-item hd-${m.tipo}`}>
            <div className="hd-cab">
              <strong>{m.tipo === 'pendencia' ? 'Pendência' : m.tipo === 'resposta' ? 'Resposta' : 'Evento'}</strong>
              <span className="suave pequeno">{m.autor_nome} · {fmtDataHora(m.criado_em)}</span>
            </div>
            <p>{m.texto}</p>
            {m.tipo === 'pendencia' && m.motivo && m.motivo !== 'sem_registro' && (
              <span className="pequeno"><strong>Motivo:</strong> {MOTIVO_DEVOLUCAO[m.motivo]}{m.motivo === 'outro' && m.motivo_outro ? ` (${m.motivo_outro})` : ''}</span>
            )}
            {m.referencia && m.tipo === 'pendencia' && <span className="pequeno suave">Referente a: {CATEGORIA[m.referencia as CategoriaAnexo] ?? REF_CADASTRO[m.referencia] ?? m.referencia}</span>}
            {arqs.length > 0 && <span className="pequeno">Anexos: {arqs.map((a) => a.nome).join(', ')}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Visualizador em janela (para o comercial, nos detalhes do embarque). */
export function JanelaAnexos({ titulo, anexos, inicial, aoFechar }: { titulo: string; anexos: AnexoDoc[]; inicial: string; aoFechar: () => void }) {
  const [sel, setSel] = useState(inicial);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aoFechar]);
  return (
    <div className="fundo-modal ja" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="ja-caixa">
        <div className="ja-cab"><strong>{titulo}</strong><button className="btn peq" onClick={aoFechar}>Fechar</button></div>
        <VisualizadorAnexo anexos={anexos} selecionado={sel} aoSelecionar={setSel} ampliado={false} aoAmpliar={() => undefined} />
      </div>
    </div>
  );
}

export function LinhaInfo({ rot, valor, copiar, children }: { rot: string; valor?: string | null; copiar?: boolean; children?: ReactNode }) {
  return (
    <div className="li">
      <span className="li-rot">{rot}</span>
      <span className="li-val">{children ?? (valor || '—')}</span>
      {copiar && valor ? <Copiar texto={valor} /> : <span />}
    </div>
  );
}

/** Abre/baixa um arquivo pela API autenticada. */
export function useArquivo() {
  const { api } = useApp();
  const avisar = useAviso();
  return async (a: AnexoDoc, modo: 'abrir' | 'baixar') => {
    try {
      const b = await api.doc.baixar(a.caminho);
      const url = URL.createObjectURL(b);
      if (modo === 'abrir') window.open(url, '_blank', 'noopener');
      else { const l = document.createElement('a'); l.href = url; l.download = a.nome; document.body.appendChild(l); l.click(); l.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { avisar('erro', (e as Error).message); }
  };
}
