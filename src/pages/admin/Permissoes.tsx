import { useEffect, useMemo, useState } from 'react';
import { Alerta, Carregando, useAviso } from '../../components/ui';
import { type MatrizPermissoes, mensagemErro } from '../../data/api';
import { useApp } from '../../data/store';
import { ROTULO_PAPEL } from '../../lib/formato';
import type { Papel, Permissao } from '../../types';

const PAPEIS: Papel[] = ['gestor', 'supervisor', 'embarcador', 'operacao', 'comercial', 'consulta'];

/** Matriz papel × permissão. Ver e editar são permissões separadas. Só administradores alteram. */
export function Permissoes() {
  const { api, estado, atualizarSessao } = useApp();
  const avisar = useAviso();
  const [m, setM] = useState<MatrizPermissoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState<string | null>(null);
  const admin = estado.sessao?.perfil.papel === 'administrador';

  useEffect(() => { api.matrizPermissoes().then(setM).catch((e) => setErro(mensagemErro(e))); }, [api]);

  const tem = useMemo(() => new Set(m?.papeis.map((p) => `${p.papel}:${p.chave}`)), [m]);
  const grupos = useMemo(() => {
    const g = new Map<string, MatrizPermissoes['catalogo']>();
    for (const c of m?.catalogo ?? []) g.set(c.grupo, [...(g.get(c.grupo) ?? []), c]);
    return [...g.entries()];
  }, [m]);

  async function alternar(papel: Papel, chave: Permissao, permitido: boolean) {
    const k = `${papel}:${chave}`;
    setGravando(k);
    try {
      await api.salvarPermissaoPapel(papel, chave, permitido);
      setM((x) => x && { ...x, papeis: permitido ? [...x.papeis, { papel, chave }] : x.papeis.filter((p) => !(p.papel === papel && p.chave === chave)) });
      void atualizarSessao();
      avisar('ok', `${ROTULO_PAPEL[papel]}: ${permitido ? 'permitido' : 'removido'}.`);
    } catch (e) {
      avisar('erro', mensagemErro(e));
    } finally {
      setGravando(null);
    }
  }

  if (erro) return <Alerta tipo="erro">{erro}</Alerta>;
  if (!m) return <Carregando />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Alerta tipo="info">
        Administrador tem todas as permissões. Exceções por pessoa ficam em Usuários. As regras são aplicadas também no servidor:
        esconder um botão aqui não é o que protege o dado.
        {!admin && ' Somente administradores alteram esta matriz.'}
      </Alerta>
      <Alerta tipo="aviso">Valores financeiros (frete, ticket, faturamento, margem) só aparecem para quem tem “Ver financeiro”. Por padrão, Gestor não tem.</Alerta>
      <div className="cartao rolagem-x">
        <table className="tabela">
          <thead><tr><th>Permissão</th>{PAPEIS.map((p) => <th key={p} style={{ textAlign: 'center' }}>{ROTULO_PAPEL[p]}</th>)}</tr></thead>
          <tbody>
            {grupos.map(([g, itens]) => [
              <tr key={g}><td colSpan={PAPEIS.length + 1} style={{ background: 'var(--cinza-50)', fontWeight: 700 }}>{g}</td></tr>,
              ...itens.map((c) => (
                <tr key={c.chave}>
                  <td>{c.descricao}<div className="pequeno suave mono">{c.chave}</div></td>
                  {PAPEIS.map((p) => {
                    const k = `${p}:${c.chave}`;
                    return (
                      <td key={p} style={{ textAlign: 'center' }}>
                        <input type="checkbox" style={{ width: 22, height: 22 }} aria-label={`${ROTULO_PAPEL[p]}: ${c.descricao}`}
                          checked={tem.has(k)} disabled={!admin || gravando === k} onChange={(e) => alternar(p, c.chave, e.target.checked)} />
                      </td>
                    );
                  })}
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    </div>
  );
}
