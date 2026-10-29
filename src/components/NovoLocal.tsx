// Botão "+" ao lado do Carregamento/Descarga: cadastra um local novo (armazém, fazenda ou terminal) sem sair do lote.
import { useState } from 'react';
import { mensagemErro } from '../data/api';
import { useApp } from '../data/store';
import { Alerta, Modal } from './ui';

export function BotaoNovoLocal({ tipo, cidade, uf, aoCriar }: {
  tipo: 'coleta' | 'entrega'; cidade: string; uf: string; aoCriar: (id: string, nome: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const rotulo = tipo === 'coleta' ? 'Novo local de coleta' : 'Novo local de entrega';
  return (
    <>
      <button type="button" className="btn botao-mais" title={rotulo} aria-label={rotulo} onClick={() => setAberto(true)}>+</button>
      {aberto && <NovoLocal tipo={tipo} cidade={cidade} uf={uf} aoFechar={() => setAberto(false)}
        aoCriar={(id, nome) => { setAberto(false); aoCriar(id, nome); }} />}
    </>
  );
}

function NovoLocal({ tipo, cidade: cidade0, uf: uf0, aoFechar, aoCriar }: {
  tipo: 'coleta' | 'entrega'; cidade: string; uf: string; aoFechar: () => void; aoCriar: (id: string, nome: string) => void;
}) {
  const { api, estado, recarregar } = useApp();
  const [nome, setNome] = useState('');
  const [cidade, setCidade] = useState(cidade0);
  const [uf, setUf] = useState(uf0);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const n = nome.trim();
    if (!n) { setErro('Informe o nome do local.'); return; }
    if (uf.trim() && !/^[A-Za-z]{2}$/.test(uf.trim())) { setErro('UF deve ter 2 letras.'); return; }
    setSalvando(true); setErro(null);
    try {
      const id = await api.obterLocal(n, cidade.trim() || null, uf.trim().toUpperCase() || null, tipo, estado.demo);
      if (!id) throw new Error('Não foi possível gravar o local.');
      await recarregar();
      aoCriar(id, n);
    } catch (e) { setErro(mensagemErro(e)); } finally { setSalvando(false); }
  }

  return (
    <Modal titulo={tipo === 'coleta' ? 'Novo carregamento (local de coleta)' : 'Nova descarga (local de entrega)'} aoFechar={aoFechar} rodape={<>
      <button className="btn" onClick={aoFechar}>Cancelar</button>
      <button className="btn primario" disabled={salvando} onClick={salvar}>{salvando ? 'Salvando…' : 'Cadastrar local'}</button>
    </>}>
      <div className="linha-rota">
        <label className="campo"><span>Cidade</span><input className="entrada" value={cidade} onChange={(e) => setCidade(e.target.value)} /></label>
        <label className="campo campo-uf"><span>UF</span>
          <input className="entrada" maxLength={2} style={{ textTransform: 'uppercase' }} value={uf} onChange={(e) => setUf(e.target.value)} /></label>
        <label className="campo"><span>Nome do local *</span>
          <input className="entrada" autoFocus value={nome} placeholder="Armazém, fazenda ou terminal" onChange={(e) => setNome(e.target.value)} /></label>
      </div>
      <p className="pequeno suave" style={{ margin: 0 }}>O link do Google Maps do local pode ser incluído depois em Administração → Cadastros → Locais.</p>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}
