// Consulta pública do cliente (link protegido por token). Somente leitura, um único cliente,
// sem dados financeiros, observações internas ou nomes de usuários. O servidor decide o que é exposto.

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CartaoPosicao } from '../components/CartaoPosicao';
import { Alerta, Carregando, Icone, Logo } from '../components/ui';
import { mensagemErro } from '../data/api';
import { useApp } from '../data/store';
import { fmtDataHora } from '../lib/formato';
import type { PosicaoPublica } from '../types';

const MENSAGEM: Record<string, { titulo: string; texto: string }> = {
  invalido: { titulo: 'Link inválido', texto: 'Este endereço não corresponde a nenhuma consulta. Confira se o link foi copiado por completo.' },
  revogado: { titulo: 'Link desativado', texto: 'Este link foi desativado pela Transpanorama. Solicite um novo link ao seu contato comercial.' },
  expirado: { titulo: 'Link expirado', texto: 'O prazo de validade deste link terminou. Solicite um novo link ao seu contato comercial.' },
};

export function ConsultaPublica() {
  const { api } = useApp();
  const { token = '' } = useParams();
  const [dados, setDados] = useState<PosicaoPublica | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  const carregar = useCallback(async () => {
    setAtualizando(true);
    setErro(null);
    try {
      setDados(await api.posicaoPublica(token));
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAtualizando(false);
    }
  }, [api, token]);

  useEffect(() => { document.title = 'Posição de embarque — Transpanorama'; void carregar(); }, [carregar]);

  // Atualiza sozinho a cada 2 minutos enquanto a página estiver aberta e visível.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void carregar(); }, 120_000);
    return () => clearInterval(t);
  }, [carregar]);

  const msg = dados && dados.status !== 'ok' ? MENSAGEM[dados.status] : null;

  return (
    <div className="publica">
      <header className="publica-cab">
        <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo tam={28} />
          <div><div style={{ fontWeight: 800 }}>Transpanorama</div><div className="pequeno" style={{ opacity: 0.85 }}>Consulta de posição de embarque</div></div>
        </div>
      </header>
      <main className="publica-corpo">
        {!dados && !erro && <Carregando texto="Consultando posição…" />}
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
        {msg && (
          <div className="cartao cartao-corpo">
            <h1 style={{ fontSize: '1.2rem' }}>{msg.titulo}</h1>
            <p style={{ margin: 0 }}>{msg.texto}</p>
          </div>
        )}
        {dados?.status === 'ok' && (
          <>
            <Alerta tipo="info">
              Consulta atualizada: esta página mostra os números registrados agora no sistema e é somente leitura.
              Consultado em {fmtDataHora(dados.consultado_em)}. Link válido até {fmtDataHora(dados.link_expira_em)}.
            </Alerta>
            <CartaoPosicao d={{
              cliente: dados.cliente ?? '', data: dados.data_operacional ?? null, atualizado_em: dados.atualizado_em ?? null,
              mostrarCarregados: !!dados.mostrar_carregados, mostrarVolumes: !!dados.mostrar_volumes, demonstrativo: dados.demonstrativo,
              itens: (dados.itens ?? []).map((i) => ({
                origem: i.origem, coleta: i.coleta, destino: i.destino, entrega: i.entrega, produto: i.produto,
                porta: i.porta ?? 0, transito: i.transito ?? 0, carregados: i.carregados ?? 0,
                porta_t: i.volume_porta_t, transito_t: i.volume_transito_t, carregado_t: i.volume_carregado_t,
                observacao: i.observacao,
              })),
            }} />
            {!dados.data_operacional && <p className="suave pequeno" style={{ margin: 0 }}>Ainda não há posição registrada para este cliente.</p>}
            <div><button className="btn" disabled={atualizando} onClick={() => void carregar()}><Icone nome="atualizar" tam={18} />{atualizando ? 'Atualizando…' : 'Atualizar agora'}</button></div>
          </>
        )}
      </main>
    </div>
  );
}
