// Para cada arquivo baixado: XML vai para a leitura direta (integração futura com o ERP);
// PDF e imagem vão para a leitura por IA (OpenAI), com resposta em JSON no formato abaixo.
const PARTE = {
  type: 'object', additionalProperties: false,
  required: ['nome', 'cnpj_cpf', 'ie', 'municipio', 'uf'],
  properties: {
    nome: { type: 'string' }, cnpj_cpf: { type: 'string' }, ie: { type: 'string' },
    municipio: { type: 'string' }, uf: { type: 'string' }
  }
};
const CIDADE = {
  type: 'object', additionalProperties: false, required: ['municipio', 'uf'],
  properties: { municipio: { type: 'string' }, uf: { type: 'string' } }
};
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['documentos'],
  properties: {
    documentos: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['tipo', 'chave_acesso', 'numero', 'serie', 'nf_tipo_operacao', 'modalidade_frete',
          'emitente', 'destinatario', 'local_retirada', 'local_entrega',
          'remetente', 'expedidor', 'recebedor', 'tomador', 'tomador_papel',
          'municipio_inicio', 'municipio_fim', 'chaves_nfe_citadas', 'legibilidade', 'observacao'],
        properties: {
          tipo: { type: 'string', enum: ['nfe', 'cte', 'outro'] },
          chave_acesso: { type: 'string' }, numero: { type: 'string' }, serie: { type: 'string' },
          nf_tipo_operacao: { type: 'string', enum: ['entrada', 'saida', ''] },
          modalidade_frete: { type: 'string' },
          emitente: PARTE, destinatario: PARTE, local_retirada: PARTE, local_entrega: PARTE,
          remetente: PARTE, expedidor: PARTE, recebedor: PARTE, tomador: PARTE,
          tomador_papel: { type: 'string', enum: ['remetente', 'expedidor', 'recebedor', 'destinatario', 'outros', ''] },
          municipio_inicio: CIDADE, municipio_fim: CIDADE,
          chaves_nfe_citadas: { type: 'array', items: { type: 'string' } },
          legibilidade: { type: 'integer' },
          observacao: { type: 'string' }
        }
      }
    }
  }
};
const PROMPT = [
  'Você lê documentos fiscais brasileiros de transporte de cargas: DANFE (NF-e) e DACTE (CT-e), em PDF ou foto.',
  'Transcreva exatamente o que está impresso. Não invente, não deduza e não complete dados.',
  'Um arquivo pode ter mais de um documento: devolva um item por documento (páginas de continuação do mesmo documento não viram item novo).',
  'tipo: "nfe" para DANFE, "cte" para DACTE, "outro" para qualquer outra coisa (MDF-e, ticket, canhoto, foto sem documento).',
  'chave_acesso: os 44 dígitos da chave de acesso, só números.',
  'NF-e: emitente = bloco do emitente no topo; destinatario = bloco DESTINATÁRIO/REMETENTE exatamente como impresso;',
  'nf_tipo_operacao = "entrada" se o campo de tipo indicar 0 (Entrada) e "saida" se indicar 1 (Saída);',
  'modalidade_frete = o código do campo MODALIDADE DO FRETE / FRETE POR CONTA (0, 1, 2, 3, 4 ou 9), só o número;',
  'local_retirada e local_entrega só quando houver bloco "Informações do local de retirada/entrega" ou texto explícito em Dados Adicionais; senão deixe vazios.',
  'CT-e: remetente, destinatario, expedidor, recebedor e tomador = blocos do DACTE com esses nomes (vazios se não existirem);',
  'tomador_papel = quem é o tomador do serviço (remetente, expedidor, recebedor, destinatario ou outros);',
  'municipio_inicio e municipio_fim = INÍCIO e TÉRMINO DA PRESTAÇÃO; chaves_nfe_citadas = chaves de NF-e em DOCUMENTOS ORIGINÁRIOS (44 dígitos).',
  'Em cada participante: nome (razão social), cnpj_cpf (só dígitos), ie, municipio, uf (2 letras).',
  'Campos que não se aplicam ao tipo de documento ou estão ilegíveis: string vazia. legibilidade: 0 (ilegível) a 10 (perfeito).',
  'observacao: uma frase curta só se algo dificultou a leitura; senão vazio.'
].join('\n');

const itens = $input.all();
const meta = $('Listar arquivos').all();
const saida = [];
for (let i = 0; i < itens.length; i++) {
  const m = meta[i] ? meta[i].json : {};
  const base = { auditoria_id: m.auditoria_id, anexo_id: m.id, papel: m.papel, nome: m.nome, tipo_mime: m.tipo_mime };
  const bin = itens[i].binary && itens[i].binary.data;
  if (!bin) {
    saida.push({ json: Object.assign({}, base, { modo: 'erro', erro: 'Arquivo não baixado do Travion' }) });
    continue;
  }
  const buf = await this.helpers.getBinaryDataBuffer(i, 'data');
  const mime = m.tipo_mime || bin.mimeType || '';
  if (/xml/i.test(mime) || /\.xml$/i.test(m.nome || '')) {
    saida.push({ json: Object.assign({}, base, { modo: 'xml', xml: buf.toString('utf8') }) });
    continue;
  }
  const b64 = buf.toString('base64');
  const arquivo = mime === 'application/pdf'
    ? { type: 'input_file', filename: m.nome || 'documento.pdf', file_data: 'data:application/pdf;base64,' + b64 }
    : { type: 'input_image', image_url: 'data:' + mime + ';base64,' + b64, detail: 'high' };
  const corpo = {
    model: 'gpt-4.1-mini',
    temperature: 0,
    max_output_tokens: 6000,
    input: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: [
        { type: 'input_text', text: 'Arquivo anexado no Travion como ' + (m.papel === 'cte' ? 'CT-e (DACTE)' : 'Nota Fiscal (DANFE)') + '. Nome: ' + (m.nome || '') },
        arquivo
      ] }
    ],
    text: { format: { type: 'json_schema', name: 'documentos_fiscais', strict: true, schema: SCHEMA } }
  };
  saida.push({ json: Object.assign({}, base, { modo: 'ia', corpo: corpo }) });
}
return saida;
