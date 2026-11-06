// Ferramentas só da demonstração (modo local): roteiro para o supervisor e bloco de anotações de correção.
// As anotações ficam no navegador de quem testa e são enviadas ao Frederick por WhatsApp, cópia ou arquivo .txt.
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Modal } from '../components/ui';
import { useApp } from '../data/store';
import { fmtDataHora } from '../lib/formato';

const CHAVE_NOTAS = 'travion-ind-demo-notas';
const CHAVE_AUTOR = 'travion-ind-demo-autor';
const CHAVE_ROTEIRO = 'travion-ind-demo-roteiro-fechado';

interface Nota { id: string; em: string; tela: string; pedido: string; texto: string }

const ler = <T,>(k: string, padrao: T): T => { try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as T) : padrao; } catch { return padrao; } };
const gravar = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

const TELAS: Record<string, string> = {
  '/industrializado': 'Painel', '/industrializado/viagens': 'Viagens', '/industrializado/controle': 'Controle',
  '/industrializado/emissao': 'Emissão', '/industrializado/ocorrencias': 'Ocorrências', '/industrializado/pos-entrega': 'Pós-entrega',
  '/industrializado/clientes': 'Clientes',
};

function textoNotas(autor: string, notas: Nota[]): string {
  const cab = `Correções da demonstração Industrializado${autor ? ` — ${autor}` : ''} (${notas.length})`;
  return [cab, '', ...notas.map((n, i) => `${i + 1}. [${n.tela}${n.pedido ? ` · ${n.pedido}` : ''}] ${n.texto}`)].join('\n');
}

/** Botão flutuante "Anotar correção", presente em todas as telas do Industrializado na demonstração. */
export function AnotarCorrecao() {
  const { api } = useApp();
  const { pathname } = useLocation();
  const [aberto, setAberto] = useState(false);
  const [notas, setNotas] = useState<Nota[]>(() => ler(CHAVE_NOTAS, []));
  const [autor, setAutor] = useState<string>(() => ler(CHAVE_AUTOR, ''));
  const [texto, setTexto] = useState('');
  const [pedido, setPedido] = useState('');
  const [aviso, setAviso] = useState('');
  useEffect(() => { gravar(CHAVE_NOTAS, notas); }, [notas]);
  useEffect(() => { gravar(CHAVE_AUTOR, autor); }, [autor]);
  if (api.modo !== 'local') return null;
  const tela = TELAS[pathname] ?? pathname;

  const salvar = () => {
    if (!texto.trim()) { setAviso('Escreva a correção antes de salvar.'); return; }
    setNotas([...notas, { id: crypto.randomUUID(), em: new Date().toISOString(), tela, pedido: pedido.trim(), texto: texto.trim() }]);
    setTexto(''); setPedido(''); setAviso('Anotação salva. Pode continuar navegando e anotar mais.');
  };
  const tudo = textoNotas(autor, notas);
  const copiar = async () => { try { await navigator.clipboard.writeText(tudo); setAviso('Copiado. Cole no WhatsApp ou no e-mail.'); } catch { setAviso('Não deu para copiar: use Baixar .txt.'); } };
  const baixar = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([tudo], { type: 'text/plain;charset=utf-8' }));
    a.download = `correcoes-industrializado-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <button className="ind-demo-fab" onClick={() => { setAviso(''); setAberto(true); }} title="Anotar uma correção nesta tela">
        ✎ Anotar correção{notas.length ? <span className="ind-demo-qtd">{notas.length}</span> : null}
      </button>
      {aberto && (
        <Modal titulo="Anotar correção" aoFechar={() => setAberto(false)} rodape={<button className="btn" onClick={() => setAberto(false)}>Fechar</button>}>
          <div className="ind-demo-form">
            <label className="campo"><span>Seu nome</span><input className="entrada" value={autor} onChange={(e) => setAutor(e.target.value)} placeholder="Ex.: Supervisor Goiânia" /></label>
            <div className="suave pequeno">Tela: <strong>{tela}</strong></div>
            <label className="campo"><span>Pedido (opcional)</span><input className="entrada" value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Ex.: PED-5106" /></label>
            <label className="campo"><span>O que corrigir ou melhorar</span><textarea className="entrada" rows={4} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Descreva o que viu e como deveria ser." /></label>
            <button className="btn primario" onClick={salvar}>Salvar anotação</button>
            {aviso && <div className="suave pequeno" role="status">{aviso}</div>}
          </div>
          {notas.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Suas anotações ({notas.length})</h3>
              <ol className="ind-demo-notas">
                {notas.map((n) => (
                  <li key={n.id}>
                    <span className="suave pequeno">{n.tela}{n.pedido ? ` · ${n.pedido}` : ''} · {fmtDataHora(n.em)}</span>
                    <div>{n.texto}</div>
                    <button className="btn sutil peq" onClick={() => setNotas(notas.filter((x) => x.id !== n.id))}>Excluir</button>
                  </li>
                ))}
              </ol>
              <p className="pequeno">Quando terminar, envie tudo para o Frederick:</p>
              <div className="ind-acoes">
                <a className="btn primario" href={`https://wa.me/?text=${encodeURIComponent(tudo)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
                <button className="btn" onClick={() => void copiar()}>Copiar tudo</button>
                <button className="btn" onClick={baixar}>Baixar .txt</button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

/** Cartão de boas-vindas com o roteiro de teste, no topo do Painel (só na demonstração). */
export function RoteiroDemo() {
  const { api } = useApp();
  const [fechado, setFechado] = useState<boolean>(() => ler(CHAVE_ROTEIRO, false));
  if (api.modo !== 'local') return null;
  if (fechado) return <p className="pequeno"><button className="btn sutil peq" onClick={() => { setFechado(false); gravar(CHAVE_ROTEIRO, false); }}>Mostrar roteiro da demonstração</button></p>;
  return (
    <div className="ind-roteiro">
      <div className="ind-roteiro-cab">
        <strong>Demonstração do Industrializado — roteiro para o supervisor</strong>
        <button className="btn sutil peq" onClick={() => { setFechado(true); gravar(CHAVE_ROTEIRO, true); }}>Esconder</button>
      </div>
      <p className="pequeno">Todos os dados são fictícios e ficam só no seu navegador. Pode clicar em tudo à vontade. Para recomeçar do zero, use "Restaurar dados da prévia" no fim do Painel. Viu algo errado ou faltando? Clique em <strong>✎ Anotar correção</strong> (canto da tela) e, no fim, envie as anotações ao Frederick.</p>
      <ol className="pequeno">
        <li><strong>Disponíveis:</strong> abra uma carga sem veículo, informe placa e motorista e veja o "Contratado por" (dourado) vir preenchido.</li>
        <li><strong>Contratados:</strong> marque as conferências Cadastro, Monitoramento e OC/Vínculo; veja a carga da Cargill que marcou sem conferências (faixa vermelha e sino).</li>
        <li><strong>Veículo carregado:</strong> leve uma carga marcada para Aguardando Emissão.</li>
        <li><strong>Emissão:</strong> confira os valores (frete, pedágio, custo extra, adicional) e a margem; tente emitir a Cargill sem PO.</li>
        <li><strong>Em trânsito:</strong> use o WhatsApp do motorista, combine a chegada no cliente, abra uma ocorrência e clique em "Marcado na descarga".</li>
        <li><strong>Veículos marcados:</strong> clique em Finalizado, com e sem ocorrência; teste a carga com duas entregas.</li>
        <li><strong>Finalizados com ocorrência e Pós-entrega:</strong> canhoto digital/físico, comprovante e encerrar a carga.</li>
        <li><strong>Botão "i"</strong> ao lado do pedido: abra a ficha completa e teste Imprimir/PDF.</li>
        <li>Troque o perfil na faixa do topo (ex.: Equipe de embarque, pós-embarque) para ver o que cada função pode fazer.</li>
      </ol>
    </div>
  );
}
