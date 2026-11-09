// Leitura direta do XML (NF-e ou CT-e). Pronta para a integração com o ERP: o resultado tem o mesmo formato da
// leitura por IA. Itens com erro de download passam adiante sem documentos.
function bloco(xml, tag) {
  const re = new RegExp('<(?:\\w+:)?' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?' + tag + '>');
  const m = xml.match(re);
  return m ? m[1] : '';
}
function val(xml, tag) {
  const re = new RegExp('<(?:\\w+:)?' + tag + '>([^<]*)</(?:\\w+:)?' + tag + '>');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}
function todos(xml, tag) {
  const re = new RegExp('<(?:\\w+:)?' + tag + '>([^<]*)</(?:\\w+:)?' + tag + '>', 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}
function parte(b) {
  if (!b) return { nome: '', cnpj_cpf: '', ie: '', municipio: '', uf: '' };
  return { nome: val(b, 'xNome'), cnpj_cpf: val(b, 'CNPJ') || val(b, 'CPF'), ie: val(b, 'IE'),
    municipio: val(b, 'xMun'), uf: val(b, 'UF') };
}
const VAZIA = parte('');
function lerNfe(xml) {
  const id = (xml.match(/Id="NFe(\d{44})"/) || [])[1] || '';
  const ide = bloco(xml, 'ide');
  return {
    tipo: 'nfe', chave_acesso: id, numero: val(ide, 'nNF'), serie: val(ide, 'serie'),
    nf_tipo_operacao: val(ide, 'tpNF') === '0' ? 'entrada' : (val(ide, 'tpNF') === '1' ? 'saida' : ''),
    modalidade_frete: val(bloco(xml, 'transp'), 'modFrete'), natureza_operacao: val(ide, 'natOp'),
    emitente: parte(bloco(xml, 'emit')), destinatario: parte(bloco(xml, 'dest')),
    local_retirada: parte(bloco(xml, 'retirada')), local_entrega: parte(bloco(xml, 'entrega')),
    remetente: VAZIA, expedidor: VAZIA, recebedor: VAZIA, tomador: VAZIA, tomador_papel: '',
    municipio_inicio: { municipio: '', uf: '' }, municipio_fim: { municipio: '', uf: '' },
    chaves_nfe_citadas: [], legibilidade: 10, observacao: '',
    // Texto livre da nota (infCpl/infAdFisco): alguns modelos só informam coleta e entrega aqui.
    dados_adicionais: [val(bloco(xml, 'infAdic'), 'infCpl'), val(bloco(xml, 'infAdic'), 'infAdFisco')].filter(Boolean).join(' | ').slice(0, 2000)
  };
}
function lerCte(xml) {
  const id = (xml.match(/Id="CTe(\d{44})"/) || [])[1] || '';
  const ide = bloco(xml, 'ide');
  const papeis = ['remetente', 'expedidor', 'recebedor', 'destinatario'];
  const doc = {
    tipo: 'cte', chave_acesso: id, numero: val(ide, 'nCT'), serie: val(ide, 'serie'),
    nf_tipo_operacao: '', modalidade_frete: '', natureza_operacao: val(ide, 'natOp'),
    emitente: parte(bloco(xml, 'emit')), destinatario: parte(bloco(xml, 'dest')),
    local_retirada: VAZIA, local_entrega: VAZIA,
    remetente: parte(bloco(xml, 'rem')), expedidor: parte(bloco(xml, 'exped')), recebedor: parte(bloco(xml, 'receb')),
    tomador: VAZIA, tomador_papel: '',
    municipio_inicio: { municipio: val(ide, 'xMunIni'), uf: val(ide, 'UFIni') },
    municipio_fim: { municipio: val(ide, 'xMunFim'), uf: val(ide, 'UFFim') },
    chaves_nfe_citadas: todos(bloco(xml, 'infDoc'), 'chave'), dados_adicionais: '', legibilidade: 10, observacao: ''
  };
  const toma4 = bloco(xml, 'toma4');
  if (toma4) {
    doc.tomador_papel = 'outros';
    doc.tomador = parte(toma4);
  } else {
    const t = val(bloco(xml, 'toma3') || bloco(xml, 'toma03'), 'toma');
    const papel = papeis[Number(t)] || '';
    doc.tomador_papel = papel;
    if (papel) doc.tomador = doc[papel];
  }
  return doc;
}
return $input.all().map(item => {
  const j = item.json;
  const base = { auditoria_id: j.auditoria_id, anexo_id: j.anexo_id, papel: j.papel, nome: j.nome, origem: 'xml' };
  if (j.modo !== 'xml') return { json: Object.assign(base, { origem: 'pdf_imagem', documentos: [], erro: j.erro || 'Arquivo não lido' }) };
  const xml = String(j.xml || '');
  const documentos = [];
  // O CT-e também tem <infNFe> (documentos originários): teste o CT-e primeiro.
  if (/<(?:\w+:)?infCte[\s>]/.test(xml)) documentos.push(lerCte(xml));
  else if (/<(?:\w+:)?infNFe[\s>]/.test(xml)) documentos.push(lerNfe(xml));
  return { json: Object.assign(base, { documentos: documentos, erro: documentos.length ? '' : 'XML não reconhecido como NF-e ou CT-e' }) };
});
