// Uma linha por arquivo: o CT-e anexado e todas as NFs da solicitação.
const bruto = $input.first().json;
const dados = Array.isArray(bruto) ? bruto[0] : bruto;
if (!dados || !dados.auditoria_id) {
  throw new Error('Conferência não encontrada no Travion');
}
const arquivos = [];
if (dados.cte) arquivos.push(Object.assign({ papel: 'cte' }, dados.cte));
for (const nf of (dados.nfs || [])) arquivos.push(Object.assign({ papel: 'nf' }, nf));
return arquivos.map(a => ({ json: Object.assign({ auditoria_id: dados.auditoria_id }, a) }));
