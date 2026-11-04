// Converte a resposta da OpenAI (Responses API, JSON estruturado) no formato comum de leitura.
const r = $json;
const m = $('Preparar leitura').item.json;
const base = { auditoria_id: m.auditoria_id, anexo_id: m.anexo_id, papel: m.papel, nome: m.nome, origem: 'pdf_imagem' };
if (r.error) {
  const msg = typeof r.error === 'string' ? r.error : (r.error.message || 'erro na leitura');
  return { json: Object.assign(base, { documentos: [], erro: 'Leitura por IA falhou: ' + String(msg).slice(0, 200) }) };
}
let texto = '';
for (const o of (r.output || [])) {
  if (o.type === 'message') for (const c of (o.content || [])) texto += c.text || '';
}
let documentos = [];
try {
  const obj = JSON.parse(texto);
  documentos = Array.isArray(obj.documentos) ? obj.documentos : [];
} catch (e) {
  return { json: Object.assign(base, { documentos: [], erro: 'Resposta da IA fora do formato' }) };
}
const uso = r.usage || {};
return { json: Object.assign(base, { documentos: documentos, erro: '',
  tokens: { entrada: uso.input_tokens || 0, saida: uso.output_tokens || 0 } }) };
