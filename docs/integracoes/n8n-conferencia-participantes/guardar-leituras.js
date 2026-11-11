// Guarda as leituras novas por IA (que fecharam) para o ↻ não gastar crédito de novo.
const linhas = $input.all().map(i => i.json)
  .filter(l => l.salvar && l.anexo_id && Array.isArray(l.documentos) && l.documentos.length)
  .map(l => ({ anexo_id: l.anexo_id, documentos: l.documentos, modelo: l.modelo || '', modo: l.leitura || '', tokens: l.tokens || null }));
return linhas.length ? [{ json: { linhas } }] : [];
