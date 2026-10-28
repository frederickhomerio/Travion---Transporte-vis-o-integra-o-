import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { mensagemErro } from '../data/api';
import { PERFIS_PREVIA } from '../data/localApi';
import { ROTULO_PAPEL } from '../lib/formato';
import { useApp } from '../data/store';
import { Alerta, Logo } from '../components/ui';

export function Login() {
  const { api, estado } = useApp();
  const nav = useNavigate();
  const [modo, setModo] = useState<'entrar' | 'cadastrar' | 'recuperar'>('entrar');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [msg, setMsg] = useState<{ tipo: 'erro' | 'ok'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (estado.sessao) return <Navigate to="/" replace />;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setEnviando(true);
    try {
      if (modo === 'entrar') {
        await api.entrar(email.trim(), senha);
        nav('/');
      } else if (modo === 'cadastrar') {
        if (senha.length < 8) throw new Error('A senha deve ter pelo menos 8 caracteres.');
        const r = await api.cadastrar(nome.trim(), email.trim(), senha);
        setMsg({ tipo: 'ok', texto: r.confirmarEmail
          ? 'Conta criada. Confirme o e-mail pelo link enviado. Depois, um administrador precisa aprovar seu acesso (a menos que você tenha sido convidado).'
          : 'Conta criada. Aguarde a aprovação de um administrador.' });
      } else {
        await api.recuperarSenha(email.trim());
        setMsg({ tipo: 'ok', texto: 'Se o e-mail estiver cadastrado, você receberá um link para criar nova senha.' });
      }
    } catch (err) {
      setMsg({ tipo: 'erro', texto: mensagemErro(err) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="tela-centro">
      <div className="caixa-login">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Logo tam={40} />
          <div><h1 style={{ letterSpacing: '0.08em', fontWeight: 700 }}>TRAVION</h1><div className="pequeno" style={{ color: 'var(--dourado-escuro)', fontWeight: 600 }}>by Transpanorama</div><div className="suave pequeno">Inteligência que move toda a operação.</div></div>
        </div>

        {api.modo === 'local' ? (
          <>
            <Alerta tipo="aviso">
              <div><strong>Prévia local, sem servidor.</strong> O app ainda não foi ligado ao banco de dados. Os dados são fictícios e
                ficam apenas neste navegador. Escolha um perfil para conhecer as telas e as permissões.</div>
            </Alerta>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[...new Set(PERFIS_PREVIA.map((p) => p.papel))].map((papel) => (
                <div key={papel} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <strong className="pequeno" style={{ color: 'var(--vinho-escuro)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{ROTULO_PAPEL[papel]}</strong>
                  {PERFIS_PREVIA.filter((p) => p.papel === papel).map((p) => (
                    <button key={p.email} className="btn" style={{ justifyContent: 'space-between', height: 'auto', padding: '8px 14px' }}
                      onClick={() => void api.entrar(p.email, '').then(() => nav('/'))}>
                      <span style={{ textAlign: 'left', whiteSpace: 'normal', minWidth: 0 }}><strong>{p.rotulo}</strong><br /><span className="suave pequeno" style={{ fontWeight: 400 }}>{p.descricao}</span></span>
                      <span aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : (
          <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2>{modo === 'entrar' ? 'Entrar' : modo === 'cadastrar' ? 'Solicitar acesso' : 'Recuperar senha'}</h2>
            {modo === 'cadastrar' && (
              <label className="campo"><span>Nome completo</span>
                <input className="entrada" value={nome} onChange={(e) => setNome(e.target.value)} required autoComplete="name" />
              </label>
            )}
            <label className="campo"><span>E-mail</span>
              <input className="entrada" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </label>
            {modo !== 'recuperar' && (
              <label className="campo"><span>Senha</span>
                <input className="entrada" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required minLength={modo === 'cadastrar' ? 8 : undefined}
                  autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} />
              </label>
            )}
            {msg && <Alerta tipo={msg.tipo}>{msg.texto}</Alerta>}
            <button className="btn primario" disabled={enviando}>
              {enviando ? 'Aguarde…' : modo === 'entrar' ? 'Entrar' : modo === 'cadastrar' ? 'Criar conta' : 'Enviar link'}
            </button>
            <div className="grupo-btn" style={{ justifyContent: 'space-between' }}>
              {modo !== 'entrar' && <button type="button" className="btn sutil peq" onClick={() => { setModo('entrar'); setMsg(null); }}>Já tenho conta</button>}
              {modo !== 'cadastrar' && <button type="button" className="btn sutil peq" onClick={() => { setModo('cadastrar'); setMsg(null); }}>Solicitar acesso</button>}
              {modo !== 'recuperar' && <button type="button" className="btn sutil peq" onClick={() => { setModo('recuperar'); setMsg(null); }}>Esqueci a senha</button>}
            </div>
            <p className="suave pequeno" style={{ margin: 0 }}>
              O acesso de usuários internos é liberado por convite ou aprovação de um administrador.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export function NovaSenha() {
  const { api } = useApp();
  const nav = useNavigate();
  const convite = new URLSearchParams(useLocation().search).get('convite') === '1';
  const [senha, setSenha] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="tela-centro">
      <form className="caixa-login" onSubmit={async (e) => {
        e.preventDefault();
        try { await api.definirNovaSenha(senha); nav('/'); } catch (err) { setMsg(mensagemErro(err)); }
      }}>
        <h1>{convite ? 'Crie sua senha' : 'Nova senha'}</h1>
        {convite && <p className="suave">Bem-vindo ao Travion. Seu acesso já está liberado com a função e as filiais do convite; falta só a senha.</p>}
        <label className="campo"><span>Nova senha (mínimo 8 caracteres)</span>
          <input className="entrada" type="password" minLength={8} value={senha} onChange={(e) => setSenha(e.target.value)} required autoComplete="new-password" />
        </label>
        {msg && <Alerta tipo="erro">{msg}</Alerta>}
        <button className="btn primario">Salvar senha</button>
      </form>
    </div>
  );
}

export function AguardandoAprovacao() {
  const { api, estado, atualizarSessao } = useApp();
  const p = estado.sessao!.perfil;
  return (
    <div className="tela-centro">
      <div className="caixa-login">
        <Logo tam={40} />
        <h1>{p.status === 'bloqueado' ? 'Acesso bloqueado' : 'Aguardando aprovação'}</h1>
        <p>
          {p.status === 'bloqueado'
            ? 'Seu acesso foi bloqueado por um administrador.'
            : `Sua conta (${p.email}) foi criada. Um administrador precisa aprovar o acesso e definir seu perfil e suas filiais.`}
        </p>
        <div className="grupo-btn">
          <button className="btn" onClick={() => void atualizarSessao()}>Verificar novamente</button>
          <button className="btn sutil" onClick={() => void api.sair()}>Sair</button>
        </div>
      </div>
    </div>
  );
}
