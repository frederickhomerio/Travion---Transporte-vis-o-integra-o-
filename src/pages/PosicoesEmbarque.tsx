// Posições de Embarque: página interna dos supervisores.
// Mostra as posições de hoje do escopo autorizado (o banco filtra cada leitura e gravação) e deixa
// editar só Na porta, Em trânsito e Carregados hoje. Compartilhamento com o cliente fica na Posição do Cliente.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AbrirPosicoes } from '../components/AbrirPosicoes';
import { CartaoSupervisor, type Rascunho, rascunhoAlterado } from '../components/CartaoSupervisor';
import { atualizadaNaHora } from '../components/AtualizacaoCentros';
import { useAgora } from '../components/doc/Comum';
import { PrintCentros } from '../components/PrintCentros';
import { Layout } from '../components/Layout';
import { AcessoNegado, Alerta, Carregando, Icone } from '../components/ui';
import { useApp, useIndices, useLinhas } from '../data/store';
import { metaDaPosicao, volumes } from '../lib/calculos';
import { cidadeUF, nome, type Indices } from '../lib/cadastros';
import { faixaBarra } from '../lib/dashboard';
import { fmtDataAsHora, fmtData, hojeSP, ROTULO_PAPEL } from '../lib/formato';
import { ajustarFiltros, centroDaLinha, FILTROS_SUPERVISOR_VAZIOS, type FiltrosSupervisor, filtrarSupervisor, type Opcao, opcoesSupervisor, SEM_CENTRO } from '../lib/posicoes';
import type { LinhaFrete } from '../types';

const CHAVE_RASCUNHOS = 'travion-rascunhos-posicoes';

/** Rascunhos ficam na aba do navegador: sobrevivem à troca de cartão, de filtro e de tela, nunca vão ao servidor. */
function lerRascunhos(dono: string): Record<string, Rascunho> {
  try {
    const t = JSON.parse(sessionStorage.getItem(CHAVE_RASCUNHOS) ?? '{}') as { dono?: string; itens?: Record<string, Rascunho> };
    return t.dono === dono ? t.itens ?? {} : {};
  } catch { return {}; }
}
function gravarRascunhos(dono: string, itens: Record<string, Rascunho>) {
  try { sessionStorage.setItem(CHAVE_RASCUNHOS, JSON.stringify({ dono, itens })); } catch { /* fica só em memória */ }
}

export function PosicoesEmbarque() {
  const { api, estado, pode, garantirPeriodo, recarregar } = useApp();
  const idx = useIndices();
  const hoje = hojeSP();
  const s = estado.sessao!;
  const todas = useLinhas(hoje);
  const [f, setF] = useState<FiltrosSupervisor>(FILTROS_SUPERVISOR_VAZIOS);
  const [atualId, setAtualId] = useState<string | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>(() => lerRascunhos(s.perfil.id));
  const [abrir, setAbrir] = useState(false);
  const [print, setPrint] = useState(false);
  const ultimoIndice = useRef(0);
  const toque = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { void garantirPeriodo(hoje, hoje); }, [garantirPeriodo, hoje]);
  useEffect(() => gravarRascunhos(s.perfil.id, rascunhos), [rascunhos, s.perfil.id]);

  // Ao voltar para a aba, recarrega: uma concessão revogada tira as posições da tela.
  useEffect(() => {
    const ver = () => { if (document.visibilityState === 'visible') void recarregar(); };
    document.addEventListener('visibilitychange', ver);
    return () => document.removeEventListener('visibilitychange', ver);
  }, [recarregar]);


  // Suspensos saem da página até serem reativados na Lista de Fretes.
  const operando = useMemo(() => todas.filter((l) => l.embarque.situacao === 'ativo' && l.embarque.status_liberacao !== 'suspenso'), [todas]);
  const comPosicao = useMemo(() => operando.filter((l) => l.posicao), [operando]);
  const semPosicao = operando.filter((l) => !l.posicao).length;
  // Só contam rascunhos de posições de hoje ainda visíveis para o usuário.
  const pendentes = comPosicao.filter((l) => rascunhoAlterado(rascunhos[l.posicao!.id])).map((l) => l.posicao!.id);

  // Aviso ao sair com alterações não salvas (fechar a aba ou trocar de tela pelo menu).
  useEffect(() => {
    if (!pendentes.length) return;
    const antes = (ev: BeforeUnloadEvent) => { ev.preventDefault(); ev.returnValue = ''; };
    const clique = (ev: MouseEvent) => {
      const a = (ev.target as HTMLElement).closest('a[href^="#"]');
      if (a && a.getAttribute('href') !== '#/posicoes'
        && !window.confirm(`Há ${pendentes.length} posição(ões) com alterações ainda não salvas. Sair mesmo assim? Os valores digitados ficam guardados nesta aba.`)) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', antes);
    document.addEventListener('click', clique, true);
    return () => { window.removeEventListener('beforeunload', antes); document.removeEventListener('click', clique, true); };
  }, [pendentes.length]);

  // Seleções que deixaram de existir (filtro anterior mudou ou posição saiu do escopo) voltam para "Todos".
  const fValido = useMemo(() => ajustarFiltros(comPosicao, f, idx), [comPosicao, f, idx]);
  useEffect(() => { if (JSON.stringify(fValido) !== JSON.stringify(f)) setF(fValido); }, [fValido, f]);
  const ops = useMemo(() => opcoesSupervisor(comPosicao, fValido, idx), [comPosicao, fValido, idx]);
  const lista = useMemo(() => filtrarSupervisor(comPosicao, fValido, idx), [comPosicao, fValido, idx]);

  // Mantém o embarque em exibição quando chegam atualizações; se ele sair do resultado, fica a mesma posição da fila.
  let i = lista.findIndex((l) => l.embarque.id === atualId);
  if (i < 0) i = Math.min(ultimoIndice.current, Math.max(lista.length - 1, 0));
  const atual = lista[i];
  useEffect(() => {
    if (atual && atual.embarque.id !== atualId) setAtualId(atual.embarque.id);
    ultimoIndice.current = i;
  }, [atual, atualId, i]);

  const ultimaConfirmacao = comPosicao.reduce<string | null>((m, l) => {
    const c = l.posicao!.confirmado_em;
    return c && (!m || c > m) ? c : m;
  }, null);

  if (!pode('embarques.ver') || !pode('posicoes.pagina')) return <Layout titulo="Posições de Embarque"><AcessoNegado /></Layout>;

  const papel = ROTULO_PAPEL[s.perfil.papel];
  const ir = (d: number) => { const n = lista[i + d]; if (n) setAtualId(n.embarque.id); };
  const filtrando = !!(fValido.centro || fValido.filial || fValido.cidade);
  const carregando = estado.carregando && !comPosicao.length;

  return (
    <Layout titulo="Posições de Embarque" aoLadoTitulo={<span className="chip-supervisor">{papel}: {s.perfil.nome || s.perfil.email}</span>}>
      <div className="pe">
        <p className="pe-atualizacao">
          {ultimaConfirmacao ? <>Última atualização: <strong>{fmtDataAsHora(ultimaConfirmacao)}</strong></> : `Nenhuma posição confirmada hoje (${fmtData(hoje)}).`}
        </p>

        {api.modo === 'local' && (
          <Alerta tipo="aviso">Prévia: a restrição de acesso por supervisor é ilustrativa. No app oficial, o banco confere a concessão em cada leitura, gravação e atualização em tempo real.</Alerta>
        )}
        {semPosicao > 0 && (
          <Alerta tipo="info">
            <span style={{ flex: 1 }}>{semPosicao} embarque(s) ativo(s) do seu escopo ainda não têm posição aberta em {fmtData(hoje)}.</span>
            {pode('posicoes.abrir') && <button className="btn peq" onClick={() => setAbrir(true)}>Abrir posições de hoje</button>}
          </Alerta>
        )}

        <div className="pe-filtros" role="group" aria-label="Filtros">
          <FiltroBotao rotulo="Centro de Custo" todos="Todos" valor={fValido.centro} opcoes={ops.centros} aoMudar={(v) => setF({ ...fValido, centro: v })} />
          <FiltroBotao rotulo="Filial" todos="Todas" valor={fValido.filial} opcoes={ops.filiais} aoMudar={(v) => setF({ ...fValido, filial: v })} />
          <FiltroBotao rotulo="Cidade" todos="Todas" valor={fValido.cidade} opcoes={ops.cidades} aoMudar={(v) => setF({ ...fValido, cidade: v })} />
        </div>
        <p className="pe-contagem" aria-live="polite">
          {lista.length} {lista.length === 1 ? 'posição' : 'posições'} {filtrando ? (lista.length === 1 ? 'encontrada' : 'encontradas') : (lista.length === 1 ? 'autorizada' : 'autorizadas')}
          {pendentes.length > 0 && <span className="pe-pendentes"> · {pendentes.length} com alterações não salvas</span>}
        </p>

        {carregando ? <Carregando texto="Carregando posições…" /> : estado.erro && !comPosicao.length ? (
          <Alerta tipo="erro">{estado.erro}</Alerta>
        ) : !lista.length ? (
          <div className="pe-vazio">{comPosicao.length ? 'Nenhuma posição encontrada para os filtros selecionados' : 'Nenhuma posição autorizada para você hoje.'}</div>
        ) : (
          <div className="pe-mesa">
          <div className="pe-principal">
            <div className="pe-carrossel"
              onTouchStart={(ev) => {
                const alvo = ev.target as HTMLElement;
                toque.current = alvo.closest('input, button, select, textarea, a') ? null : { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
              }}
              onTouchEnd={(ev) => {
                const t0 = toque.current;
                toque.current = null;
                if (!t0) return;
                const dx = ev.changedTouches[0].clientX - t0.x;
                const dy = ev.changedTouches[0].clientY - t0.y;
                if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) ir(dx < 0 ? 1 : -1);
              }}>
              <CartaoSupervisor key={atual.posicao!.id} linha={atual} idx={idx}
                rascunho={rascunhos[atual.posicao!.id]}
                aoRascunho={(r) => setRascunhos((x) => { const n = { ...x }; if (r) n[atual.posicao!.id] = r; else delete n[atual.posicao!.id]; return n; })}
                podeEditar={pode('posicoes.editar_contadores') && atual.embarque.situacao === 'ativo'}
                aoPerderAcesso={() => void recarregar()} />
            </div>
            <nav className="pe-nav" aria-label="Navegar entre embarques">
              <button className="btn" disabled={i <= 0} onClick={() => ir(-1)}><span aria-hidden="true">←</span> Anterior</button>
              <span className="pe-indice" aria-live="polite">{i + 1} de {lista.length}</span>
              <button className="btn" disabled={i >= lista.length - 1} onClick={() => ir(1)}>Próximo <span aria-hidden="true">→</span></button>
            </nav>
            {rascunhoAlterado(rascunhos[atual.posicao!.id]) && <p className="pe-dica"><Icone nome="atualizar" tam={14} /> Rascunho deste embarque guardado nesta aba, ainda não salvo.</p>}
          </div>
          <MiniBlocos lista={lista} atualId={atual.embarque.id} idx={idx} pendentes={pendentes}
            aoEscolher={(id) => { setAtualId(id); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
          </div>
        )}

        <div className="pe-rodape">
          {pode('posicoes.abrir') && <button className="btn" onClick={() => setAbrir(true)}>Abrir posições</button>}
          <button className="btn primario" disabled={!lista.length} onClick={() => setPrint(true)}><Icone nome="baixar" tam={18} />Imagem por centro de custo</button>
        </div>
      </div>
      {print && <PrintCentros linhas={lista} idx={idx} data={hoje} aoFechar={() => setPrint(false)} />}
      {abrir && <AbrirPosicoes dataInicial={hoje} aoFechar={() => setAbrir(false)} />}
    </Layout>
  );
}

function FiltroBotao({ rotulo, todos, valor, opcoes, aoMudar }: { rotulo: string; todos: string; valor: string; opcoes: Opcao[]; aoMudar: (v: string) => void }) {
  return (
    <label className="filtro-botao">
      <span>{rotulo}</span>
      <select value={valor} onChange={(e) => aoMudar(e.target.value)}>
        <option value="">{todos}</option>
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
    </label>
  );
}

/** Computador: miniatura de todos os blocos do filtro, ao lado do cartão. Clicar abre o bloco para preencher. */
function MiniBlocos({ lista, atualId, idx, pendentes, aoEscolher }: {
  lista: LinhaFrete[]; atualId: string; idx: Indices; pendentes: string[]; aoEscolher: (embarqueId: string) => void;
}) {
  // Borda verde: posição atualizada na última hora; vermelha: sem atualização há mais de 1 h (pedido de 29/10).
  const agora = useAgora(60000);
  const recente = (p: NonNullable<LinhaFrete['posicao']>) => atualizadaNaHora(p, agora);
  return (
    <aside className="pe-minis" aria-label="Todos os blocos do filtro">
      <div className="pe-minis-cab">
        <strong>Blocos do filtro ({lista.length})</strong>
        <span>Clique num bloco para preencher a posição.</span>
        <div className="legenda">
          <span><i className="faixa-vermelho" />Carregado até 60% da meta</span><span><i className="faixa-amarelo" />60,1% a 80%</span>
          <span><i className="faixa-verde" />Acima de 80%</span><span><i className="sem-meta" />Sem meta</span>
        </div>
        <div className="legenda">
          <span><i className="borda-recente" />Borda verde: atualizada na última hora</span><span><i className="borda-atrasada" />Borda vermelha: mais de 1 h sem atualizar</span>
        </div>
      </div>
      <div className="pe-minis-grade">
        {lista.map((l) => {
          const e = l.embarque;
          const p = l.posicao!;
          const v = volumes(p);
          const meta = metaDaPosicao(p).volume_t;
          const faixa = faixaBarra(meta && meta > 0 ? (v.carregado_t / meta) * 100 : null);
          const cc = centroDaLinha(l, idx);
          const ativo = e.id === atualId;
          return (
            <button key={e.id} type="button" className={`pe-mini ${faixa ? `faixa-${faixa}` : 'sem-meta'} ${recente(p) ? 'recente' : 'atrasada'}${ativo ? ' ativo' : ''}`} aria-current={ativo || undefined}
              onClick={() => aoEscolher(e.id)} title={`Preencher a posição de ${nome(idx.cliente, e.cliente_id)}`}>
              <span className="pe-mini-cli">{nome(idx.cliente, e.cliente_id)}</span>
              <span className="pe-mini-rota">{cidadeUF(e.origem_cidade, e.origem_uf)} → {cidadeUF(e.destino_cidade, e.destino_uf)}</span>
              <span className="pe-mini-cc">{cc === SEM_CENTRO ? 'Sem centro de custo' : nome(idx.centroCusto, cc)} · {nome(idx.filial, e.filial_id)}</span>
              <span className="pe-mini-cont"><span>Porta <b>{p.porta ?? '—'}</b></span><span>Trânsito <b>{p.transito ?? '—'}</b></span><span>Carreg. <b>{p.carregados ?? '—'}</b></span></span>
              {pendentes.includes(p.id) && <span className="pe-mini-rasc">Rascunho não salvo</span>}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
