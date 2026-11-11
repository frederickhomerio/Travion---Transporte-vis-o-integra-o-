// Converte a resposta da OpenAI (Responses API, JSON estruturado) no formato comum de leitura.
// 2ª leitura (gpt-4.1), só para o que o mini não leu bem. Soma os tokens das duas leituras.
const FORTE = true;
const r = $json;
const m = $('Preparar leitura').item.json;
const base = { auditoria_id: m.auditoria_id, anexo_id: m.anexo_id, papel: m.papel, nome: m.nome, origem: 'pdf_imagem' };
const anterior = FORTE ? $('Converter leitura da IA').item.json : null;
const somar = (t) => {
  const a = (anterior && anterior.tokens) || {};
  return { entrada: (t.entrada || 0) + (a.entrada || 0), saida: (t.saida || 0) + (a.saida || 0) };
};
const modelo = FORTE ? 'gpt-4.1' : 'gpt-4.1-mini';
const dig = v => String(v || '').replace(/\D/g, '');
function cnpjValido(c) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (b, p) => { const s = b.split('').reduce((a, n, i) => a + Number(n) * p[i], 0) % 11; return s < 2 ? 0 : 11 - s; };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return dv(c.slice(0, 12), p1) === Number(c[12]) && dv(c.slice(0, 13), [6].concat(p1)) === Number(c[13]);
}
function cpfValido(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}
function chaveValida(c) {
  c = dig(c);
  if (c.length !== 44) return false;
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(c[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const resto = soma % 11;
  return (resto < 2 ? 0 : 11 - resto) === Number(c[43]);
}
const docOk = p => { const d = dig(p && p.cnpj_cpf); return !d || cnpjValido(d) || cpfValido(d) || cnpjValido(d.padStart(14, '0')) || cpfValido(d.padStart(11, '0')); };
// A leitura "fecha" quando: há NF/CT-e, a chave confere no dígito verificador, os CNPJ/CPF lidos conferem,
// as partes principais têm documento e município, e (na NF) o emitente é o mesmo CNPJ/CPF que está dentro da chave.
function motivoReler(documentos) {
  const docs = documentos.filter(d => d.tipo === 'nfe' || d.tipo === 'cte');
  if (!docs.length) return 'nenhuma NF/CT-e lida';
  for (const d of docs) {
    if (!chaveValida(d.chave_acesso)) return 'chave inválida';
    const partes = d.tipo === 'nfe' ? ['emitente', 'destinatario', 'local_retirada', 'local_entrega']
      : ['remetente', 'destinatario', 'expedidor', 'recebedor', 'tomador'];
    for (const k of partes) if (!docOk(d[k])) return k + ' com CNPJ/CPF inválido';
    const principais = d.tipo === 'nfe' ? ['emitente', 'destinatario'] : ['remetente', 'destinatario', 'tomador'];
    for (const k of principais) {
      if (!dig(d[k] && d[k].cnpj_cpf)) return k + ' sem CNPJ/CPF';
      if (!String((d[k] && d[k].municipio) || '').trim()) return k + ' sem município';
    }
    if (d.tipo === 'nfe') {
      const k = dig(d.chave_acesso).slice(6, 20), e = dig(d.emitente && d.emitente.cnpj_cpf);
      if (k !== e.padStart(14, '0') && k !== ('000' + e)) return 'emitente diferente do CNPJ da chave';
    }
    if (d.tipo === 'cte' && !String((d.municipio_inicio && d.municipio_inicio.municipio) || '').trim()) return 'início da prestação não lido';
  }
  return '';
}
if (r.error && FORTE && anterior && (anterior.documentos || []).length) {
  // O modelo completo falhou: fica com a leitura do mini (sem guardar, para tentar de novo no ↻).
  return { json: Object.assign(base, { documentos: anterior.documentos, erro: '', tokens: somar({}), modelo: 'gpt-4.1-mini', reler: false, salvar: false }) };
}
if (r.error) {
  const msg = typeof r.error === 'string' ? r.error : (r.error.description || r.error.message || 'erro na leitura');
  const semCredito = /credit|quota|billing/i.test(JSON.stringify(r.error));
  return { json: Object.assign(base, { documentos: [], tokens: somar({}), modelo,
    erro: semCredito ? 'Sem créditos na OpenAI: recarregar em platform.openai.com (Billing)' : 'Leitura por IA falhou: ' + String(msg).slice(0, 200),
    reler: !FORTE && !semCredito }) };
}
let texto = '';
for (const o of (r.output || [])) {
  if (o.type === 'message') for (const c of (o.content || [])) texto += c.text || '';
}
const uso = r.usage || {};
const tokens = somar({ entrada: uso.input_tokens || 0, saida: uso.output_tokens || 0 });
let documentos = [];
try {
  const obj = JSON.parse(texto);
  documentos = Array.isArray(obj.documentos) ? obj.documentos : [];
} catch (e) {
  return { json: Object.assign(base, { documentos: [], erro: 'Resposta da IA fora do formato', tokens, modelo, reler: !FORTE }) };
}
const motivo = motivoReler(documentos);
if (FORTE && !documentos.length && anterior && (anterior.documentos || []).length) {
  // O modelo completo não leu nada: fica com a leitura do mini.
  return { json: Object.assign(base, { documentos: anterior.documentos, erro: '', tokens, modelo: 'gpt-4.1-mini', reler: false, salvar: false }) };
}
return { json: Object.assign(base, { documentos, erro: '', tokens, modelo, leitura: m.leitura || '',
  reler: !FORTE && !!motivo, motivo_reler: motivo,
  // Só guarda para o ↻ a leitura que fechou (ou a do modelo completo, que é a melhor que dá para ter).
  salvar: FORTE ? documentos.length > 0 : !motivo }) };
