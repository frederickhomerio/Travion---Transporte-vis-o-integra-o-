// Importação da planilha operacional: arquivo → abas → mapeamento → data operacional → prévia → confirmação → relatório.
// Só valores são lidos (nenhuma fórmula ou macro é executada). Textos das células são dados, nunca instruções.

import { useMemo, useState } from 'react';
import { Alerta, Carregando, Segmentado, useAviso } from '../../components/ui';
import { mensagemErro, type RelatorioImportacao } from '../../data/api';
import { useApp } from '../../data/store';
import { codigoEmbarque } from '../../lib/cadastros';
import { fmtData, fmtNum, hojeSP } from '../../lib/formato';
import {
  type Aba, analisarClientes, analisarListaFretes, CAMPOS, type CampoDestino, type ClienteImportacao, detectarCabecalho, hashArquivo,
  type LinhaAnalisada, mapearAutomatico, motivoIgnorarColuna, ROTULO_DESTINO, textoCelula,
} from '../../lib/planilha';
import { limpar, normalizar } from '../../lib/texto';

interface Arquivo { nome: string; hash: string; abas: Aba[] }
interface Previa {
  linhas: LinhaAnalisada[];
  clientes: ClienteImportacao[];
  filiais: string[];
  avisosClientes: string[];
  existentes: Map<string, number>;
}

const OPCOES_MAPA: CampoDestino[] = [...CAMPOS.map((c) => c.campo), 'extra', 'ignorar'];

export function Importacao() {
  const { api, estado, pode, recarregar, definirData } = useApp();
  const avisar = useAviso();
  const [arquivo, setArquivo] = useState<Arquivo | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [abaLista, setAbaLista] = useState('');
  const [abaClientes, setAbaClientes] = useState('');
  const [linhaCab, setLinhaCab] = useState(0);
  const [mapa, setMapa] = useState<CampoDestino[]>([]);
  const [data, setData] = useState('');
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [aplicarSuspenso, setAplicarSuspenso] = useState<Set<number>>(new Set());
  const [sobrescrever, setSobrescrever] = useState(false);
  const [filtro, setFiltro] = useState<'todas' | 'avisos' | 'erros' | 'ignoradas'>('todas');
  const [importando, setImportando] = useState(false);
  const [relatorio, setRelatorio] = useState<RelatorioImportacao | null>(null);
  const demo = api.modo === 'local' ? true : estado.demo;

  const aba = arquivo?.abas.find((a) => a.nome === abaLista);
  const cabecalho = useMemo(() => (aba && aba.linhas[linhaCab] ? aba.linhas[linhaCab].map((c) => limpar(textoCelula(c))) : []), [aba, linhaCab]);

  function escolherAba(nome: string, abas = arquivo?.abas ?? []) {
    setAbaLista(nome);
    setPrevia(null);
    const a = abas.find((x) => x.nome === nome);
    if (!a) return;
    const cab = Math.max(0, detectarCabecalho(a));
    setLinhaCab(cab);
    setMapa(mapearAutomatico((a.linhas[cab] ?? []).map((c) => limpar(textoCelula(c)))));
  }

  async function lerArquivo(f: File) {
    setErro(null); setArquivo(null); setPrevia(null); setRelatorio(null); setData(''); setAplicarSuspenso(new Set());
    if (!/\.xlsx$/i.test(f.name)) { setErro('Envie um arquivo .xlsx (Excel). Arquivos .xlsm/.xls não são aceitos: macros nunca são executadas.'); return; }
    setLendo(true);
    try {
      const buf = await f.arrayBuffer();
      const { lerPlanilha } = await import('../../lib/leitorExcel');
      const [abas, hash] = await Promise.all([lerPlanilha(buf), hashArquivo(buf)]);
      setArquivo({ nome: f.name, hash, abas });
      const lista = abas.find((a) => /LISTA/.test(normalizar(a.nome)) && detectarCabecalho(a) >= 0) ?? abas.find((a) => detectarCabecalho(a) >= 0);
      const cli = abas.find((a) => normalizar(a.nome) === 'CLIENTES');
      setAbaClientes(cli?.nome ?? '');
      if (lista) escolherAba(lista.nome, abas); else setAbaLista('');
    } catch (e) {
      setErro(`Não foi possível ler o arquivo: ${mensagemErro(e)}`);
    } finally {
      setLendo(false);
    }
  }

  const obrigatoriosFaltando = CAMPOS.filter((c) => c.obrigatorio && !mapa.includes(c.campo)).map((c) => c.rotulo);
  const duplicados = [...new Set(mapa.filter((m, i) => m !== 'extra' && m !== 'ignorar' && mapa.indexOf(m) !== i))].map((m) => ROTULO_DESTINO[m]);
  const obsPublica = mapa.includes('obs_cliente');

  async function analisar() {
    if (!aba) return;
    setAnalisando(true); setErro(null); setPrevia(null); setRelatorio(null);
    try {
      const linhas = await analisarListaFretes(aba, linhaCab, mapa);
      const cliAba = arquivo!.abas.find((a) => a.nome === abaClientes);
      const cli = cliAba ? analisarClientes(cliAba) : { clientes: [], filiais: [], avisos: [] };
      const chaves = linhas.filter((l) => l.dados).map((l) => l.dados!.chave);
      const ex = chaves.length ? await api.embarquesPorChave(chaves, demo) : [];
      setPrevia({ linhas, clientes: cli.clientes, filiais: cli.filiais, avisosClientes: cli.avisos, existentes: new Map(ex.map((e) => [e.chave_importacao!, e.codigo])) });
      setAplicarSuspenso(new Set());
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAnalisando(false);
    }
  }

  const cont = useMemo(() => {
    const l = previa?.linhas ?? [];
    const validas = l.filter((x) => x.situacao === 'valida');
    return {
      validas: validas.length,
      erros: l.filter((x) => x.situacao === 'erro').length,
      ignoradas: l.filter((x) => x.situacao === 'ignorada').length,
      comAvisos: l.filter((x) => x.avisos.length).length,
      novos: validas.filter((x) => !previa!.existentes.has(x.dados!.chave)).length,
      vinculados: validas.filter((x) => previa!.existentes.has(x.dados!.chave)).length,
      mesmaRota: validas.filter((x) => x.ocorrencia > 1).length,
      sugestoes: validas.filter((x) => x.sugestaoSuspenso).length,
    };
  }, [previa]);

  const visiveis = (previa?.linhas ?? []).filter((l) =>
    filtro === 'todas' ? true : filtro === 'avisos' ? l.avisos.length > 0 : filtro === 'erros' ? l.situacao === 'erro' : l.situacao === 'ignorada');

  async function importar() {
    if (!previa || !arquivo || !data) return;
    setImportando(true); setErro(null);
    try {
      const linhas = previa.linhas.filter((l) => l.situacao === 'valida').map((l) => ({
        ...l.dados!, status: aplicarSuspenso.has(l.numero) ? 'suspenso' : l.dados!.status,
      }));
      const r = await api.importarPlanilha({
        arquivo_nome: arquivo.nome, arquivo_hash: arquivo.hash, aba: abaLista, data_operacional: data, is_demo: demo,
        sobrescrever_posicoes: sobrescrever,
        filiais: previa.filiais,
        clientes: previa.clientes.map((c) => ({ nome: c.nome, carteira: c.carteira, restricao: c.restricao })),
        linhas,
        mapeamento: Object.fromEntries(cabecalho.map((h, i) => [h || `Coluna ${i + 1}`, mapa[i]])),
        inconsistencias: previa.linhas.filter((l) => l.situacao !== 'valida' || l.avisos.length)
          .map((l) => ({ linha: l.numero, situacao: l.situacao, motivo: l.motivo ?? null, avisos: l.avisos })),
      });
      setRelatorio(r);
      definirData(data);
      await recarregar();
      avisar('ok', 'Importação concluída.');
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setImportando(false);
    }
  }

  if (!pode('importacao.executar')) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Alerta tipo="info">
        A aba Lista de Fretes é a fonte dos embarques e das posições do dia. As abas de Dashboard e Posição de Embarques são visões calculadas e não são importadas
        (o app recalcula tudo). A aba Clientes alimenta o cadastro de clientes e carteiras. Fórmulas e macros nunca são executadas; usamos o último valor salvo no arquivo.
      </Alerta>
      <Alerta tipo={demo ? 'aviso' : 'info'}>{api.modo === 'local' ? 'Prévia local: a importação fica só neste navegador, como dado de teste.' : demo ? 'Modo demonstração ligado: os dados serão importados como DEMONSTRATIVOS.' : 'Os dados serão importados como dados REAIS.'}</Alerta>

      <section className="cartao">
        <div className="cartao-cab"><h3 style={{ margin: 0 }}>1. Arquivo</h3></div>
        <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const f = e.target.files?.[0]; if (f) void lerArquivo(f); e.target.value = ''; }} />
          {lendo && <Carregando texto="Lendo planilha…" />}
          {arquivo && (
            <>
              <div className="pequeno"><strong>{arquivo.nome}</strong> · {arquivo.abas.length} aba(s) · impressão digital <span className="mono">{arquivo.hash.slice(0, 12)}</span></div>
              <div className="grade-campos">
                <label className="campo"><span>Aba da Lista de Fretes *</span>
                  <select className="entrada" value={abaLista} onChange={(e) => escolherAba(e.target.value)}>
                    <option value="">Selecione</option>
                    {arquivo.abas.map((a) => <option key={a.nome} value={a.nome}>{a.nome}{a.oculta ? ' (oculta)' : ''}</option>)}
                  </select>
                </label>
                <label className="campo"><span>Aba de Clientes (opcional)</span>
                  <select className="entrada" value={abaClientes} onChange={(e) => { setAbaClientes(e.target.value); setPrevia(null); }}>
                    <option value="">Não usar</option>
                    {arquivo.abas.map((a) => <option key={a.nome} value={a.nome}>{a.nome}</option>)}
                  </select>
                </label>
                {aba && (
                  <label className="campo"><span>Linha do cabeçalho</span>
                    <input className="entrada" type="number" min={1} max={aba.linhas.length} value={linhaCab + 1} onChange={(e) => {
                      const n = Math.max(0, Math.min(aba.linhas.length - 1, Number(e.target.value) - 1));
                      setLinhaCab(n); setPrevia(null);
                      setMapa(mapearAutomatico((aba.linhas[n] ?? []).map((c) => limpar(textoCelula(c)))));
                    }} />
                  </label>
                )}
              </div>
              {arquivo.abas.filter((a) => a.nome !== abaLista && a.nome !== abaClientes).length > 0 && (
                <p className="pequeno suave" style={{ margin: 0 }}>Não importadas: {arquivo.abas.filter((a) => a.nome !== abaLista && a.nome !== abaClientes).map((a) => a.nome).join(', ')}.</p>
              )}
            </>
          )}
        </div>
      </section>

      {aba && (
        <section className="cartao">
          <div className="cartao-cab"><h3 style={{ margin: 0 }}>2. Mapeamento de colunas</h3></div>
          <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="rolagem-x">
              <table className="tabela">
                <thead><tr><th>Coluna na planilha</th><th>Exemplo</th><th>Destino no app</th></tr></thead>
                <tbody>
                  {cabecalho.map((h, i) => {
                    const ex = aba.linhas.slice(linhaCab + 1).map((r) => limpar(textoCelula(r[i]))).find(Boolean) ?? '';
                    const motivo = motivoIgnorarColuna(h);
                    if (!h && !ex) return null;
                    return (
                      <tr key={i}>
                        <td><strong>{h || `(sem título, coluna ${i + 1})`}</strong>{motivo && <div className="pequeno suave">{motivo}</div>}</td>
                        <td className="pequeno" style={{ maxWidth: 220, overflowWrap: 'anywhere' }}>{ex.slice(0, 60)}</td>
                        <td>
                          <select className="entrada" value={mapa[i] ?? 'ignorar'} onChange={(e) => { const m = [...mapa]; m[i] = e.target.value as CampoDestino; setMapa(m); setPrevia(null); }}>
                            {OPCOES_MAPA.map((o) => <option key={o} value={o}>{ROTULO_DESTINO[o]}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {obrigatoriosFaltando.length > 0 && <Alerta tipo="erro">Mapeie as colunas obrigatórias: {obrigatoriosFaltando.join(', ')}.</Alerta>}
            {duplicados.length > 0 && <Alerta tipo="erro">Destino usado em mais de uma coluna: {duplicados.join(', ')}.</Alerta>}
            <Alerta tipo={obsPublica ? 'aviso' : 'info'}>
              {obsPublica
                ? 'Uma coluna foi mapeada como “Observação para o cliente”: o texto dela aparecerá no resumo e no link do cliente. Confira se não há informação interna.'
                : 'A coluna OBSERVAÇÃO vai como observação interna (não aparece para o cliente). Para torná-la pública, mapeie como “Observação para o cliente”.'}
            </Alerta>
            <p className="pequeno suave" style={{ margin: 0 }}>“Guardar como referência” preserva o valor original numa área restrita do embarque (aba “Dados da planilha”), sem usá-lo em cálculos.</p>
          </div>
        </section>
      )}

      {aba && (
        <section className="cartao">
          <div className="cartao-cab"><h3 style={{ margin: 0 }}>3. Data operacional</h3></div>
          <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label className="campo" style={{ maxWidth: 240 }}><span>A que dia se referem os números de porta, trânsito e carregados? *</span>
              <input className="entrada" type="date" value={data} max={hojeSP()} onChange={(e) => { setData(e.target.value); setRelatorio(null); }} />
            </label>
            <p className="pequeno suave" style={{ margin: 0 }}>Obrigatório e sem valor sugerido: o nome ou a data do arquivo não comprovam a data dos números.</p>
            <div><button className="btn primario" disabled={!data || analisando || obrigatoriosFaltando.length > 0 || duplicados.length > 0} onClick={analisar}>{analisando ? 'Analisando…' : 'Gerar prévia'}</button></div>
          </div>
        </section>
      )}

      {previa && (
        <section className="cartao">
          <div className="cartao-cab"><h3 style={{ margin: 0 }}>4. Prévia e inconsistências</h3><span className="pequeno suave">Nada foi gravado ainda.</span></div>
          <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="kpis" style={{ marginBottom: 0 }}>
              <div className="cartao kpi"><div className="rot">Linhas válidas</div><div className="val medio">{fmtNum(cont.validas)}</div><div className="det">{cont.novos} embarque(s) novo(s) · {cont.vinculados} já vinculado(s)</div></div>
              <div className="cartao kpi"><div className="rot">Com avisos</div><div className="val medio">{fmtNum(cont.comAvisos)}</div><div className="det">Importadas; campo com problema fica vazio</div></div>
              <div className="cartao kpi"><div className="rot">Com erro</div><div className="val medio">{fmtNum(cont.erros)}</div><div className="det">Não serão importadas</div></div>
              <div className="cartao kpi"><div className="rot">Ignoradas</div><div className="val medio">{fmtNum(cont.ignoradas)}</div><div className="det">Vazias, totais ou sem rota</div></div>
            </div>
            {cont.mesmaRota > 0 && <Alerta tipo="info">{cont.mesmaRota} linha(s) repetem a rota de outra linha do arquivo. Elas são tratadas como embarques diferentes (não são somadas nem mescladas).</Alerta>}
            {cont.sugestoes > 0 && <Alerta tipo="aviso">{cont.sugestoes} linha(s) têm observação mencionando “suspenso”, mas o status não é Suspenso. O status só muda se você marcar a linha abaixo.</Alerta>}
            {previa.avisosClientes.map((a) => <Alerta key={a} tipo="aviso">{a}</Alerta>)}
            {previa.clientes.length > 0 && <p className="pequeno" style={{ margin: 0 }}>Aba Clientes: {previa.clientes.length} cliente(s){previa.clientes.some((c) => c.restricao) ? `, ${previa.clientes.filter((c) => c.restricao).length} com restrição comercial` : ''}. Carteira diferente da cadastrada não é trocada automaticamente: vira aviso no relatório.</p>}
            {!pode('financeiro.editar') && <Alerta tipo="info">Seu perfil não grava valores de frete: as colunas de frete serão ignoradas nesta importação.</Alerta>}

            <Segmentado rotulo="Filtrar linhas" valor={filtro} aoMudar={setFiltro} opcoes={[
              { valor: 'todas', rotulo: `Todas (${previa.linhas.length})` }, { valor: 'avisos', rotulo: `Com avisos (${cont.comAvisos})` },
              { valor: 'erros', rotulo: `Erros (${cont.erros})` }, { valor: 'ignoradas', rotulo: `Ignoradas (${cont.ignoradas})` },
            ]} />
            <div className="rolagem-x" style={{ maxHeight: 480, overflowY: 'auto' }}>
              <table className="tabela">
                <thead><tr><th>Linha</th><th>Situação</th><th>Cliente / filial</th><th>Rota</th><th className="n">Porta</th><th className="n">Trânsito</th><th className="n">Carreg.</th><th>Avisos</th></tr></thead>
                <tbody>
                  {visiveis.map((l) => {
                    const d = l.dados;
                    const cod = d ? previa.existentes.get(d.chave) : undefined;
                    return (
                      <tr key={l.numero} style={l.situacao === 'ignorada' ? { opacity: 0.6 } : undefined}>
                        <td className="mono">{l.numero}</td>
                        <td>
                          {l.situacao === 'valida' ? <span className="badge liberado">{cod ? codigoEmbarque(cod) : 'Novo'}</span>
                            : l.situacao === 'erro' ? <span className="badge suspenso">Erro</span> : <span className="badge nao_informado">Ignorada</span>}
                          {l.ocorrencia > 1 && <div className="pequeno suave">mesma rota, {l.ocorrencia}ª ocorrência</div>}
                        </td>
                        <td>{d ? <><strong>{d.cliente}</strong><div className="pequeno suave">{d.filial || 'sem filial'}{d.carteira ? ` · ${d.carteira}` : ''}</div></> : '—'}</td>
                        <td className="pequeno">{d ? <>{d.origem_cidade}{d.coleta && ` (${d.coleta})`} → {d.destino_cidade}{d.destino_uf && `/${d.destino_uf}`}{d.entrega && ` (${d.entrega})`}</> : '—'}</td>
                        <td className="n">{d?.porta ?? '—'}</td>
                        <td className="n">{d?.transito ?? '—'}</td>
                        <td className="n">{d?.carregados ?? '—'}</td>
                        <td className="pequeno" style={{ minWidth: 220 }}>
                          {l.motivo && <div style={{ color: 'var(--vermelho-700)' }}>{l.motivo}</div>}
                          {l.avisos.map((a, i) => <div key={i}>{a}</div>)}
                          {l.sugestaoSuspenso && l.situacao === 'valida' && (
                            <label className="check"><input type="checkbox" checked={aplicarSuspenso.has(l.numero)} onChange={(e) => {
                              const s = new Set(aplicarSuspenso); if (e.target.checked) s.add(l.numero); else s.delete(l.numero); setAplicarSuspenso(s);
                            }} />Marcar como Suspenso</label>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <label className="check"><input type="checkbox" checked={sobrescrever} onChange={(e) => setSobrescrever(e.target.checked)} />
              Se já existir posição em {fmtData(data)} com números diferentes, substituir pelos da planilha</label>
            <p className="pequeno suave" style={{ margin: 0 }}>Desmarcado (recomendado): posições já existentes são mantidas e as diferenças aparecem no relatório. Valores vazios nunca viram zero.</p>
            {erro && <Alerta tipo="erro">{erro}</Alerta>}
            <div><button className="btn primario" disabled={importando || cont.validas === 0} onClick={importar}>{importando ? 'Importando…' : `Importar ${cont.validas} linha(s) para ${fmtData(data)}`}</button></div>
          </div>
        </section>
      )}

      {!previa && erro && <Alerta tipo="erro">{erro}</Alerta>}

      {relatorio && (
        <section className="cartao">
          <div className="cartao-cab"><h3 style={{ margin: 0 }}>Relatório da importação</h3></div>
          <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {relatorio.arquivo_ja_importado && <Alerta tipo="info">Este arquivo já tinha sido importado para esta data. Nenhum embarque foi duplicado.</Alerta>}
            <dl className="dl">
              <dt>Embarques novos</dt><dd>{relatorio.embarques_criados}</dd>
              <dt>Embarques já existentes (vinculados)</dt><dd>{relatorio.embarques_vinculados}</dd>
              <dt>Clientes criados</dt><dd>{relatorio.clientes_criados}</dd>
              <dt>Comerciais criados</dt><dd>{relatorio.comerciais_criados}</dd>
              <dt>Posições criadas</dt><dd>{relatorio.posicoes_criadas}</dd>
              <dt>Posições atualizadas</dt><dd>{relatorio.posicoes_atualizadas}</dd>
              <dt>Posições iguais (sem mudança)</dt><dd>{relatorio.posicoes_iguais}</dd>
              <dt>Posições divergentes mantidas</dt><dd>{relatorio.posicoes_divergentes}</dd>
              <dt>Valores de frete</dt><dd>{relatorio.financeiro_importado ? 'Importados (unidade do frete a confirmar)' : 'Não importados (sem permissão)'}</dd>
            </dl>
            {relatorio.avisos.length > 0 && (
              <details open={relatorio.avisos.length <= 10}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{relatorio.avisos.length} aviso(s)</summary>
                <ul className="pequeno">{relatorio.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </details>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
