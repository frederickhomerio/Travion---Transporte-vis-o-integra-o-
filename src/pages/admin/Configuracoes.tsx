import { useEffect, useState } from 'react';
import { Alerta, Modal, useAviso } from '../../components/ui';
import { mensagemErro } from '../../data/api';
import { useApp } from '../../data/store';
import { fmtData, fmtReais, fmtT, hojeSP } from '../../lib/formato';
import { reduzirImagem } from '../../lib/cnpj';
import { parseNumeroBR } from '../../lib/texto';
import type { Configuracoes as Config, MetaDiaria } from '../../types';

export function Configuracoes() {
  const { api, estado, recarregar } = useApp();
  const avisar = useAviso();
  const c = estado.config;
  const [d, setD] = useState({
    capacidade_padrao_t: String(c.capacidade_padrao_t).replace('.', ','),
    link_validade_padrao_horas: String(c.link_validade_padrao_horas),
    cadencia_unidade_padrao: c.cadencia_unidade_padrao,
    ticket_inclui_frete_zero: c.ticket_inclui_frete_zero,
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro(null);
    const novos: Partial<Config> = {};
    for (const k of ['capacidade_padrao_t', 'link_validade_padrao_horas'] as const) {
      const n = parseNumeroBR(d[k]);
      if (!n || n <= 0) { setErro('Os valores numéricos devem ser maiores que zero.'); return; }
      if (n !== c[k]) novos[k] = n;
    }
    if (d.cadencia_unidade_padrao !== c.cadencia_unidade_padrao) novos.cadencia_unidade_padrao = d.cadencia_unidade_padrao;
    if (d.ticket_inclui_frete_zero !== c.ticket_inclui_frete_zero) novos.ticket_inclui_frete_zero = d.ticket_inclui_frete_zero;
    if (!Object.keys(novos).length) { avisar('info', 'Nenhuma alteração para salvar.'); return; }
    setSalvando(true);
    try {
      for (const [k, v] of Object.entries(novos)) await api.salvarConfiguracao(k as keyof Config, v);
      await recarregar();
      avisar('ok', 'Configurações salvas.');
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <div className="cartao" style={{ maxWidth: 760 }}>
      <div className="cartao-cab"><h3 style={{ margin: 0 }}>Parâmetros de cálculo</h3></div>
      <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="grade-campos">
          <label className="campo"><span>Toneladas médias por veículo (padrão)</span>
            <input className="entrada" inputMode="decimal" value={d.capacidade_padrao_t} onChange={(e) => setD({ ...d, capacidade_padrao_t: e.target.value })} />
            <small>Usado em embarques novos. Cada embarque pode ter o seu valor; posições já registradas guardam o valor da época.</small>
          </label>
          <label className="campo"><span>Unidade padrão da cadência</span>
            <select className="entrada" value={d.cadencia_unidade_padrao} onChange={(e) => setD({ ...d, cadencia_unidade_padrao: e.target.value as Config['cadencia_unidade_padrao'] })}>
              <option value="veiculos_dia">Veículos por dia</option><option value="toneladas_dia">Toneladas por dia</option>
            </select>
          </label>
          <label className="campo"><span>Validade padrão do link do cliente (horas)</span>
            <input className="entrada" inputMode="numeric" value={d.link_validade_padrao_horas} onChange={(e) => setD({ ...d, link_validade_padrao_horas: e.target.value })} />
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={d.ticket_inclui_frete_zero} onChange={(e) => setD({ ...d, ticket_inclui_frete_zero: e.target.checked })} />
          Incluir fretes iguais a zero no ticket médio (a planilha incluía)</label>
        <p className="pequeno suave" style={{ margin: 0 }}>Valores atuais: {fmtT(c.capacidade_padrao_t)} por veículo. A meta diária é obrigatória em cada embarque. Toda alteração fica no histórico.</p>
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        <div><button className="btn primario" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar configurações'}</button></div>
      </div>
    </div>
    <LogoEmpresa />
    </div>
  );
}

/** Logo da TP no quadro de posição enviado ao cliente. Use o arquivo oficial (PNG com fundo transparente, de preferência). */
function LogoEmpresa() {
  const { api, estado, recarregar } = useApp();
  const avisar = useAviso();
  const atual = estado.config.logo_empresa;
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function gravar(valor: string | null) {
    setErro(null);
    setSalvando(true);
    try {
      await api.salvarConfiguracao('logo_empresa', valor);
      await recarregar();
      avisar('ok', valor ? 'Logo da TP salva.' : 'Logo da TP removida.');
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="cartao" style={{ maxWidth: 760 }}>
      <div className="cartao-cab"><h3 style={{ margin: 0 }}>Logo da TP no quadro do cliente</h3></div>
      <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="logo-empresa-previa">
          {atual ? <img src={atual} alt="Logo TP atual" /> : <span className="qp-logo-vazio">Logo TP não cadastrada</span>}
        </div>
        <p className="pequeno suave" style={{ margin: 0 }}>Aparece no lado direito da faixa vinho, na Posição do Cliente e na imagem enviada. Envie o arquivo oficial; a proporção é mantida.</p>
        <div className="grupo-btn">
          <label className={`btn ${salvando ? 'desabilitado' : ''}`}>
            {salvando ? 'Salvando…' : atual ? 'Trocar logo' : 'Enviar logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden disabled={salvando}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try { await gravar(await reduzirImagem(f, 600)); } catch (err) { setErro(mensagemErro(err)); }
              }} />
          </label>
          {atual && <button className="btn sutil" disabled={salvando} onClick={() => void gravar(null)}>Remover logo</button>}
        </div>
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
      </div>
    </div>
  );
}

/** Metas financeiras por data. Não herdam valores e não usam as metas históricas da planilha. */
export function MetasDiarias() {
  const { api, estado } = useApp();
  const avisar = useAviso();
  const [data, setData] = useState(hojeSP());
  const [meta, setMeta] = useState<MetaDiaria | null | undefined>(undefined);
  const [d, setD] = useState({ fat: '', margem: '', vol: '', obs: '' });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setMeta(undefined);
    api.carregarMeta(estado.demo, data).then((m) => {
      setMeta(m);
      const f = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));
      setD({ fat: f(m?.meta_faturamento), margem: f(m?.meta_margem), vol: f(m?.meta_volume_t), obs: m?.observacao ?? '' });
    }).catch((e) => setErro(mensagemErro(e)));
  }, [api, data, estado.demo]);

  async function salvar() {
    const fat = parseNumeroBR(d.fat), margem = parseNumeroBR(d.margem), vol = parseNumeroBR(d.vol);
    if (fat === undefined || margem === undefined || vol === undefined) { setErro('Use números (ex.: 25.000,00). Deixe vazio para “sem meta”.'); return; }
    setSalvando(true);
    setErro(null);
    try {
      await api.salvarMeta({ data_operacional: data, is_demo: estado.demo, meta_faturamento: fat, meta_margem: margem, meta_volume_t: vol, observacao: d.obs.trim() || null });
      avisar('ok', `Metas de ${fmtData(data)} salvas.`);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="cartao" style={{ maxWidth: 760 }}>
      <div className="cartao-cab"><h3 style={{ margin: 0 }}>Metas financeiras do dia</h3></div>
      <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Alerta tipo="info">As metas são definidas por data e não são copiadas de um dia para o outro. Sem meta, o Dashboard mostra “Sem meta definida”. As metas que estavam na planilha não foram adotadas.</Alerta>
        <label className="campo" style={{ maxWidth: 220 }}><span>Data</span><input className="entrada" type="date" value={data} onChange={(e) => e.target.value && setData(e.target.value)} /></label>
        {meta === undefined ? <span className="suave">Carregando…</span> : (
          <>
            {meta === null && <span className="pequeno suave">Nenhuma meta registrada para {fmtData(data)}.</span>}
            <div className="grade-campos">
              <label className="campo"><span>Meta de faturamento (R$)</span><input className="entrada" inputMode="decimal" value={d.fat} onChange={(e) => setD({ ...d, fat: e.target.value })} />{meta?.meta_faturamento != null && <small>Atual: {fmtReais(meta.meta_faturamento)}</small>}</label>
              <label className="campo"><span>Meta de margem (R$)</span><input className="entrada" inputMode="decimal" value={d.margem} onChange={(e) => setD({ ...d, margem: e.target.value })} /></label>
              <label className="campo"><span>Meta de volume (t)</span><input className="entrada" inputMode="decimal" value={d.vol} onChange={(e) => setD({ ...d, vol: e.target.value })} /></label>
            </div>
            <label className="campo"><span>Observação</span><textarea className="entrada" value={d.obs} onChange={(e) => setD({ ...d, obs: e.target.value })} /></label>
            {erro && <Alerta tipo="erro">{erro}</Alerta>}
            <div><button className="btn primario" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Salvar metas'}</button></div>
          </>
        )}
      </div>
    </div>
  );
}

export function DadosDemo() {
  const { api, estado, recarregar, definirDemo } = useApp();
  const avisar = useAviso();
  const [confirmar, setConfirmar] = useState<'carregar' | 'limpar' | null>(null);
  const [executando, setExecutando] = useState(false);
  const local = api.modo === 'local';

  async function executar() {
    const acao = confirmar;
    setConfirmar(null);
    setExecutando(true);
    try {
      if (acao === 'carregar') { await api.carregarDadosDemo(); if (!local) definirDemo(true); }
      else await api.limparDadosDemo();
      await recarregar();
      avisar('ok', acao === 'carregar' ? 'Dados demonstrativos carregados.' : 'Dados demonstrativos removidos.');
    } catch (e) {
      avisar('erro', mensagemErro(e));
    } finally {
      setExecutando(false);
    }
  }

  return (
    <div className="cartao" style={{ maxWidth: 760 }}>
      <div className="cartao-cab"><h3 style={{ margin: 0 }}>Dados demonstrativos</h3></div>
      <div className="cartao-corpo" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {local ? (
          <Alerta tipo="aviso">Esta é a prévia local: todos os dados já são fictícios e ficam só neste navegador. “Restaurar” apaga o que foi alterado aqui e volta ao exemplo inicial.</Alerta>
        ) : (
          <Alerta tipo="info">
            Dados demonstrativos ficam marcados e separados dos dados reais: só aparecem com o “Modo demonstração” ligado, têm o prefixo [DEMO] e nunca entram nos indicadores reais.
            Modo atual: <strong>{estado.demo ? 'demonstração' : 'dados reais'}</strong>.
          </Alerta>
        )}
        <div className="grupo-btn">
          <button className="btn primario" disabled={executando} onClick={() => setConfirmar('carregar')}>{local ? 'Restaurar exemplo inicial' : 'Carregar dados demonstrativos'}</button>
          {!local && <button className="btn perigo" disabled={executando} onClick={() => setConfirmar('limpar')}>Remover dados demonstrativos</button>}
          {!local && <button className="btn" onClick={() => definirDemo(!estado.demo)}>{estado.demo ? 'Voltar aos dados reais' : 'Ligar modo demonstração'}</button>}
        </div>
      </div>
      {confirmar && (
        <Modal titulo="Confirmar" aoFechar={() => setConfirmar(null)} rodape={<>
          <button className="btn" onClick={() => setConfirmar(null)}>Cancelar</button>
          <button className="btn primario" onClick={executar}>Confirmar</button>
        </>}>
          <p style={{ margin: 0 }}>
            {confirmar === 'limpar'
              ? 'Todos os registros marcados como demonstrativos (embarques, posições, cadastros, links e histórico de demonstração) serão apagados. Os dados reais não são afetados.'
              : local ? 'As alterações feitas nesta prévia serão descartadas.' : 'Serão criados registros [DEMO] separados dos dados reais.'}
          </p>
        </Modal>
      )}
    </div>
  );
}
