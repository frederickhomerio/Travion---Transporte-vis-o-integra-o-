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
        required: ['tipo', 'chave_acesso', 'numero', 'serie', 'nf_tipo_operacao', 'natureza_operacao', 'modalidade_frete',
          'emitente', 'destinatario', 'local_retirada', 'local_entrega',
          'remetente', 'expedidor', 'recebedor', 'tomador', 'tomador_papel',
          'municipio_inicio', 'municipio_fim', 'chaves_nfe_citadas', 'dados_adicionais', 'legibilidade', 'observacao'],
        properties: {
          tipo: { type: 'string', enum: ['nfe', 'cte', 'outro'] },
          chave_acesso: { type: 'string' }, numero: { type: 'string' }, serie: { type: 'string' },
          nf_tipo_operacao: { type: 'string', enum: ['entrada', 'saida', ''] },
          natureza_operacao: { type: 'string' },
          modalidade_frete: { type: 'string' },
          emitente: PARTE, destinatario: PARTE, local_retirada: PARTE, local_entrega: PARTE,
          remetente: PARTE, expedidor: PARTE, recebedor: PARTE, tomador: PARTE,
          tomador_papel: { type: 'string', enum: ['remetente', 'expedidor', 'recebedor', 'destinatario', 'outros', ''] },
          municipio_inicio: CIDADE, municipio_fim: CIDADE,
          chaves_nfe_citadas: { type: 'array', items: { type: 'string' } },
          dados_adicionais: { type: 'string' },
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
  'chave_acesso: os 44 dígitos da chave de acesso (impressa em grupos de 4 junto ao código de barras), só números; confira que são exatamente 44.',
  'NF-e: emitente = bloco do emitente no topo; destinatario = bloco DESTINATÁRIO/REMETENTE exatamente como impresso;',
  'nf_tipo_operacao = "entrada" se o campo de tipo indicar 0 (Entrada) e "saida" se indicar 1 (Saída);',
  'natureza_operacao = o texto do campo NATUREZA DA OPERAÇÃO, exatamente como impresso (ex.: "OUTRAS ENTRADAS DE MERCADORIAS OU SERVICOS NAO ESPECIFICADAS", "NOTA FISCAL DE TRANSITO", "VENDA DE PRODUCAO DO ESTABELECIMENTO");',
  'modalidade_frete = o código do campo MODALIDADE DO FRETE / FRETE POR CONTA (0, 1, 2, 3, 4 ou 9), só o número (modelos antigos imprimem "0-Emitente" = 0 e "1-Dest/Rem" = 1);',
  'local_retirada e local_entrega: use o bloco "Informações do local de retirada/entrega" quando existir. Muitos modelos de nota trazem esses locais só nas',
  'INFORMAÇÕES COMPLEMENTARES / DADOS ADICIONAIS (ex.: "Local de retirada:", "Coleta em:", "Carregamento:", "Entrega em:", "Descarga:", fazenda, armazém, CNPJ, cidade):',
  'nesse caso preencha local_retirada/local_entrega com o que estiver escrito lá. Se não houver nada, deixe vazios.',
  'dados_adicionais (só NF-e): MESMO QUANDO houver o bloco de retirada/entrega, copie, literalmente, os trechos das Informações Complementares/Dados Adicionais que falam de local de coleta, retirada,',
  'carregamento, entrega ou descarga (endereço, fazenda, armazém, CNPJ, município) ou que digam que a nota é "para efeito de trânsito", no máximo 600 caracteres; vazio se não houver.',
  'CT-e: remetente, destinatario, expedidor, recebedor e tomador = blocos do DACTE com esses nomes, identificados pelo RÓTULO do quadro e não pela posição na página (expedidor e recebedor muitas vezes não existem: deixe vazios);',
  'tomador_papel = quem é o tomador do serviço (remetente, expedidor, recebedor, destinatario ou outros);',
  'municipio_inicio e municipio_fim = INÍCIO e TÉRMINO DA PRESTAÇÃO; chaves_nfe_citadas = chaves de NF-e em DOCUMENTOS ORIGINÁRIOS (44 dígitos).',
  'Em cada participante: nome (razão social), cnpj_cpf (só dígitos, 14 para CNPJ e 11 para CPF, com os zeros à esquerda), ie, municipio, uf (2 letras).',
  'municipio é SEMPRE o campo MUNICÍPIO do bloco; nunca use bairro/distrito (ex.: "ZONA RURAL" é bairro, não município).',
  'Copie os números dígito por dígito; se um dígito estiver ilegível, devolva o campo vazio em vez de adivinhar.',
  'Campos que não se aplicam ao tipo de documento ou estão ilegíveis: string vazia. legibilidade: 0 (ilegível) a 10 (perfeito).',
  'observacao: uma frase curta só se algo dificultou a leitura; senão vazio.'
].join('\n');

// Economia de crédito (pedido do Frederick, 10/11/2026):
//  1) leitura já guardada para o anexo (tabela auditoria_leituras) -> reaproveita, sem IA;
//  2) lê primeiro com o gpt-4.1-mini; o gpt-4.1 só entra se a leitura não fechar (ver "Leitura confere?");
//  3) PDF digital (com texto embutido) vai como TEXTO para o mini; foto/PDF escaneado vai como arquivo.
const salvas = {};
try {
  for (const it of $('Buscar leituras salvas').all()) {
    const j = it.json || {};
    if (j.anexo_id && Array.isArray(j.documentos) && j.documentos.length) salvas[j.anexo_id] = j;
  }
} catch (e) { /* sem cache: segue lendo */ }
const itens = $input.all();
const saida = [];
for (let i = 0; i < itens.length; i++) {
  let m = {};
  try { m = $('Listar arquivos').itemMatching(i).json; } catch (e) { m = {}; }
  const base = { auditoria_id: m.auditoria_id, anexo_id: m.id, papel: m.papel, nome: m.nome, tipo_mime: m.tipo_mime };
  const salva = salvas[m.id];
  if (salva) {
    saida.push({ json: Object.assign({}, base, { modo: 'cache', documentos: salva.documentos, modelo: salva.modelo || '' }) });
    continue;
  }
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
  // Texto embutido no PDF (nó "Extrair texto do PDF"): só vale se parecer um DANFE/DACTE de verdade.
  const texto = String((itens[i].json && itens[i].json.text) || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const digitos = texto.replace(/\D/g, '');
  const temTexto = texto.length >= 400 && /CNPJ|CPF/i.test(texto) && digitos.length >= 44;
  const rotulo = 'Arquivo anexado no Travion como ' + (m.papel === 'cte' ? 'CT-e (DACTE)' : 'Nota Fiscal (DANFE)') + '. Nome: ' + (m.nome || '');
  const corpo = (modelo, conteudo) => ({
    model: modelo,
    temperature: 0,
    max_output_tokens: 6000,
    input: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: [{ type: 'input_text', text: rotulo }].concat(conteudo) }
    ],
    text: { format: { type: 'json_schema', name: 'documentos_fiscais', strict: true, schema: SCHEMA } }
  });
  const conteudoBarato = temTexto
    ? [{ type: 'input_text', text: 'Texto extraído do PDF (a ordem das linhas pode estar embaralhada; use os rótulos dos quadros):\n' + texto.slice(0, 16000) }]
    : [arquivo];
  saida.push({ json: Object.assign({}, base, {
    modo: 'ia', leitura: temTexto ? 'texto' : 'arquivo',
    corpo: corpo('gpt-4.1-mini', conteudoBarato),
    // Releitura com o modelo completo, sempre com o arquivo (foto/scan/texto confuso).
    corpo_forte: corpo('gpt-4.1', [arquivo])
  }) });
}
return saida;
