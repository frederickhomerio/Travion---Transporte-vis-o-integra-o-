import { useEffect, useState } from 'react';

/** Script principal da versão carregada (ex.: ./assets/index-AbC123.js). */
function scriptAtual(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]');
  return s ? new URL(s.src, location.href).pathname : null;
}

/**
 * Avisa quando há uma versão nova publicada. Confere o index.html do servidor a cada 5 minutos
 * e quando o app volta ao primeiro plano (importante no app instalado no celular).
 */
export function NovaVersao() {
  const [nova, setNova] = useState(false);
  useEffect(() => {
    const atual = scriptAtual();
    if (!atual || import.meta.env.DEV) return;
    let parado = false;
    const conferir = async () => {
      if (parado || document.visibilityState !== 'visible') return;
      try {
        const r = await fetch(`./index.html?v=${Date.now()}`, { cache: 'no-store' });
        const html = await r.text();
        const m = html.match(/src="([^"]*assets\/index-[^"]+\.js)"/);
        if (m && new URL(m[1], location.href).pathname !== atual) setNova(true);
      } catch { /* sem conexão: tenta depois */ }
    };
    const id = window.setInterval(conferir, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', conferir);
    void conferir();
    return () => { parado = true; window.clearInterval(id); document.removeEventListener('visibilitychange', conferir); };
  }, []);
  if (!nova) return null;
  return (
    <div className="faixa-versao" role="status">
      <span>Há uma versão nova do Travion.</span>
      <button className="btn peq secundario" onClick={() => location.reload()}>Atualizar agora</button>
    </div>
  );
}
