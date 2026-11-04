// Compara os participantes da NF-e com os do CT-e e monta o resultado para o Travion.
// Regras (sempre por CNPJ/CPF e município; o nome só ajuda quando o documento não foi lido):
//  Remetente      NF: emitente (saída) ou bloco destinatário/remetente (entrada)   x  CT-e: remetente
//  Destinatário   NF: destinatário (saída) ou emitente (entrada)                    x  CT-e: destinatário
//  Local coleta   NF: local de retirada, senão remetente                            x  CT-e: expedidor, senão remetente + início da prestação
//  Local entrega  NF: local de entrega, senão destinatário                          x  CT-e: recebedor, senão destinatário + término da prestação
//  Pagador        Travion: cliente do embarque                                      x  CT-e: tomador do serviço
//  NF no CT-e     chave da NF                                                       x  chaves citadas no CT-e
const bruto = $('Buscar dados da conferência').first().json;
const dados = Array.isArray(bruto) ? bruto[0] : bruto;
const leituras = $input.all().map(i => i.json);

const dig = v => String(v || '').replace(/\D/g, '');
const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const SIGLAS = /\b(LTDA|S A|SA|ME|EPP|EIRELI|CIA|COMPANHIA|DE|DA|DO|DOS|DAS|E)\b/g;
const tokens = v => norm(v).replace(SIGLAS, ' ').split(' ').filter(t => t.length > 1);
function parecido(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  const comum = ta.filter(t => tb.includes(t)).length;
  return comum / Math.min(ta.length, tb.length) >= 0.6;
}
const temParte = p => !!(p && (dig(p.cnpj_cpf) || norm(p.nome) || norm(p.municipio)));
const cidade = p => (p && (norm(p.municipio) || norm(p.uf))) ? (p.municipio || '?') + '/' + (p.uf || '?') : '';
function mostrar(p) {
  if (!temParte(p)) return '';
  const d = dig(p.cnpj_cpf);
  const doc = d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
    : (d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d);
  return [p.nome, doc, cidade(p)].filter(Boolean).join(' · ');
}
// Chave de acesso: confere o dígito verificador e devolve o CNPJ/CPF do emitente embutido nela.
function chaveValida(c) {
  c = dig(c);
  if (c.length !== 44) return false;
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(c[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return dv === Number(c[43]);
}
const docDaChave = c => dig(c).slice(6, 20);

const ORDEM = { ok: 0, nao_lido: 1, alerta: 2, divergente: 3 };
const pior = (a, b) => (ORDEM[b] > ORDEM[a] ? b : a);

function compararParte(nf, cte) {
  if (!temParte(nf) || !temParte(cte)) return { resultado: 'nao_lido', observacao: 'Não foi possível ler ' + (!temParte(nf) ? 'na NF' : 'no CT-e') };
  const a = dig(nf.cnpj_cpf), b = dig(cte.cnpj_cpf);
  if (a && b) {
    if (a === b) return { resultado: 'ok', observacao: '' };
    if (a.length === 14 && b.length === 14 && a.slice(0, 8) === b.slice(0, 8)) {
      return { resultado: 'alerta', observacao: 'Mesma empresa, filial (CNPJ) diferente' };
    }
    return { resultado: 'divergente', observacao: 'CNPJ/CPF diferente' };
  }
  if (parecido(nf.nome, cte.nome)) return { resultado: 'alerta', observacao: 'CNPJ/CPF não legível; o nome confere' };
  return { resultado: 'alerta', observacao: 'CNPJ/CPF não legível; conferir manualmente' };
}
function compararCidade(a, b) {
  if (!norm(a && a.municipio) || !norm(b && b.municipio)) return 'nao_lido';
  const ok = norm(a.municipio) === norm(b.municipio) && (!norm(a.uf) || !norm(b.uf) || norm(a.uf) === norm(b.uf));
  return ok ? 'ok' : 'divergente';
}
function compararLocal(nfLocal, cteLocal, cteCidade, nomeCidade) {
  const obs = [];
  let res = 'ok';
  if (dig(nfLocal.cnpj_cpf) && dig(cteLocal.cnpj_cpf)) {
    const p = compararParte(nfLocal, cteLocal);
    res = pior(res, p.resultado);
    if (p.observacao) obs.push(p.observacao);
  }
  const c1 = compararCidade(nfLocal, cteLocal);
  if (c1 === 'divergente') obs.push('Cidade diferente');
  res = pior(res, c1);
  if (norm(cteCidade && cteCidade.municipio)) {
    const c2 = compararCidade(nfLocal, cteCidade);
    if (c2 === 'divergente') obs.push(nomeCidade + ' do CT-e (' + cidade(cteCidade) + ') diferente da NF');
    res = pior(res, c2);
  }
  if (res === 'nao_lido') obs.push('Cidade não lida em um dos documentos');
  return { resultado: res, observacao: obs.join('; ') };
}

// Documentos lidos
const docs = [];
const errosLeitura = [];
for (const l of leituras) {
  if (l.erro) errosLeitura.push((l.papel === 'cte' ? 'CT-e' : 'NF') + ' "' + (l.nome || '') + '": ' + l.erro);
  for (const d of (l.documentos || [])) docs.push(Object.assign({ _papel: l.papel, _arquivo: l.nome }, d));
}
const origem = leituras.length && leituras.every(l => l.origem === 'xml') ? 'xml' : 'pdf_imagem';
// Corrige a leitura do emitente da NF com o CNPJ embutido na chave (quando a chave é válida).
for (const d of docs) {
  d._chave_ok = chaveValida(d.chave_acesso);
  if (d.tipo === 'nfe' && d._chave_ok) {
    const doc = docDaChave(d.chave_acesso);
    const ehCpf = doc.startsWith('000') && !dig(d.emitente && d.emitente.cnpj_cpf).startsWith('000');
    if (!ehCpf && dig(d.emitente && d.emitente.cnpj_cpf) !== doc) {
      d.emitente = Object.assign({}, d.emitente, { cnpj_cpf: doc });
      d._corrigido = true;
    }
  }
}
// Mesma NF fotografada duas vezes conta uma só vez.
const vistas = {};
const nfs = docs.filter(d => d.tipo === 'nfe' && (temParte(d.emitente) || temParte(d.destinatario))).filter(d => {
  const k = dig(d.chave_acesso);
  if (!k) return true;
  if (vistas[k]) return false;
  vistas[k] = true;
  return true;
});
const ctes = docs.filter(d => d.tipo === 'cte' && d._papel === 'cte');

const leitura = {
  arquivos: leituras.map(l => ({ papel: l.papel, nome: l.nome, origem: l.origem, erro: l.erro || '',
    documentos: (l.documentos || []).length, tokens: l.tokens || null })),
  nfs: nfs.map(d => ({ chave: d.chave_acesso, chave_valida: d._chave_ok, numero: d.numero, tipo_operacao: d.nf_tipo_operacao,
    modalidade_frete: d.modalidade_frete, emitente: d.emitente, destinatario: d.destinatario,
    local_retirada: d.local_retirada, local_entrega: d.local_entrega, legibilidade: d.legibilidade, arquivo: d._arquivo })),
  ctes: ctes.map(d => ({ chave: d.chave_acesso, chave_valida: d._chave_ok, numero: d.numero, remetente: d.remetente,
    destinatario: d.destinatario, expedidor: d.expedidor, recebedor: d.recebedor, tomador: d.tomador,
    tomador_papel: d.tomador_papel, inicio: d.municipio_inicio, fim: d.municipio_fim,
    chaves_nfe: d.chaves_nfe_citadas, legibilidade: d.legibilidade, arquivo: d._arquivo }))
};

function registrar(status, mensagem, resultado) {
  return [{ json: { payload: { p_id: dados.auditoria_id, p_status: status, p_origem: origem,
    p_resultado: resultado || [], p_leitura: leitura, p_mensagem: mensagem } } }];
}
if (!ctes.length) return registrar('erro', 'Não consegui ler o CT-e anexado' + (errosLeitura.length ? ' (' + errosLeitura.join('; ') + ')' : ''));
if (!nfs.length) return registrar('erro', 'Não consegui ler a NF da solicitação' + (errosLeitura.length ? ' (' + errosLeitura.join('; ') + ')' : ''));

const MODALIDADE = { '0': 'CIF (por conta do remetente)', '1': 'FOB (por conta do destinatário)', '2': 'Por conta de terceiros',
  '3': 'Próprio, por conta do remetente', '4': 'Próprio, por conta do destinatário', '9': 'Sem frete' };
const linhasTodas = [];
const resumoPorCte = [];
for (const cte of ctes) {
  const citadas = (cte.chaves_nfe_citadas || []).map(dig).filter(Boolean);
  let alvo = nfs.filter(n => citadas.includes(dig(n.chave_acesso)));
  const linhaChave = { campo: 'nf_no_cte', rotulo: 'NF citada no CT-e' };
  if (alvo.length) {
    linhaChave.nf = alvo.map(n => 'NF ' + (n.numero || '') + ' · chave ' + dig(n.chave_acesso)).join('\n');
    linhaChave.cte = citadas.length + ' chave(s) citada(s)';
    linhaChave.resultado = 'ok';
    linhaChave.observacao = '';
  } else {
    alvo = nfs;
    linhaChave.nf = nfs.map(n => 'NF ' + (n.numero || '?') + (dig(n.chave_acesso) ? ' · chave ' + dig(n.chave_acesso) : ' · chave não lida')).join('\n');
    linhaChave.cte = citadas.length ? citadas.join('\n') : 'Nenhuma chave lida';
    const nfSemChave = nfs.some(n => !dig(n.chave_acesso));
    linhaChave.resultado = (!citadas.length || nfSemChave) ? 'nao_lido' : 'divergente';
    linhaChave.observacao = linhaChave.resultado === 'divergente' ? 'O CT-e cita outra NF' : 'Chave não lida em um dos documentos';
  }
  const linhas = [linhaChave];
  const porCampo = {};
  for (const nf of alvo) {
    const entrada = nf.nf_tipo_operacao === 'entrada';
    const rem = entrada ? nf.destinatario : nf.emitente;
    const dest = entrada ? nf.emitente : nf.destinatario;
    const coletaNf = temParte(nf.local_retirada) ? nf.local_retirada : rem;
    const entregaNf = temParte(nf.local_entrega) ? nf.local_entrega : dest;
    const coletaCte = temParte(cte.expedidor) ? cte.expedidor : cte.remetente;
    const entregaCte = temParte(cte.recebedor) ? cte.recebedor : cte.destinatario;
    const itens = [
      ['remetente', 'Remetente', rem, cte.remetente, compararParte(rem, cte.remetente)],
      ['destinatario', 'Destinatário', dest, cte.destinatario, compararParte(dest, cte.destinatario)],
      ['local_coleta', 'Local de coleta', coletaNf, coletaCte,
        compararLocal(coletaNf, coletaCte, cte.municipio_inicio, 'Início da prestação')],
      ['local_entrega', 'Local de entrega', entregaNf, entregaCte,
        compararLocal(entregaNf, entregaCte, cte.municipio_fim, 'Término da prestação')]
    ];
    for (const it of itens) {
      const atual = porCampo[it[0]];
      const textoCte = it[0] === 'local_coleta'
        ? [mostrar(it[3]), norm(cte.municipio_inicio && cte.municipio_inicio.municipio) ? 'Início: ' + cidade(cte.municipio_inicio) : ''].filter(Boolean).join('\n')
        : it[0] === 'local_entrega'
          ? [mostrar(it[3]), norm(cte.municipio_fim && cte.municipio_fim.municipio) ? 'Término: ' + cidade(cte.municipio_fim) : ''].filter(Boolean).join('\n')
          : mostrar(it[3]);
      const textoNf = (it[0] === 'local_coleta' && temParte(nf.local_retirada) ? 'Local de retirada: ' : '')
        + (it[0] === 'local_entrega' && temParte(nf.local_entrega) ? 'Local de entrega: ' : '') + mostrar(it[2]);
      if (!atual) {
        porCampo[it[0]] = { campo: it[0], rotulo: it[1], nf: textoNf, cte: textoCte, resultado: it[4].resultado, observacao: it[4].observacao };
      } else if (ORDEM[it[4].resultado] > ORDEM[atual.resultado]) {
        Object.assign(atual, { nf: textoNf, resultado: it[4].resultado, observacao: it[4].observacao + ' (NF ' + (nf.numero || '') + ')' });
      }
    }
  }
  for (const k of ['remetente', 'destinatario', 'local_coleta', 'local_entrega']) linhas.push(porCampo[k]);

  // Cliente pagador: tomador do CT-e x cliente do embarque no Travion.
  const cli = dados.cliente || {};
  const cliente = { nome: cli.razao_social || cli.nome, cnpj_cpf: cli.documento, ie: '', municipio: cli.municipio, uf: cli.uf };
  const tom = compararParte(cliente, cte.tomador);
  const mods = Array.from(new Set(alvo.map(n => String(n.modalidade_frete || '').trim()).filter(Boolean)));
  const notas = [];
  if (tom.observacao) notas.push(tom.observacao);
  if (cte.tomador_papel) notas.push('Tomador no CT-e: ' + cte.tomador_papel);
  if (mods.length) notas.push('Frete na NF: ' + mods.map(m => MODALIDADE[m] || m).join(', '));
  linhas.push({ campo: 'pagador', rotulo: 'Cliente pagador', nf: 'Cliente do embarque: ' + (mostrar(cliente) || 'sem CNPJ no cadastro'),
    cte: mostrar(cte.tomador), resultado: dig(cliente.cnpj_cpf) ? tom.resultado : 'nao_lido', observacao: notas.join('; ') });

  const prefixo = ctes.length > 1 ? 'CT-e ' + (cte.numero || '') + ' · ' : '';
  for (const l of linhas) linhasTodas.push(Object.assign({}, l, { rotulo: prefixo + l.rotulo, cte_numero: cte.numero || '' }));
  resumoPorCte.push(linhas);
}

const geral = linhasTodas.reduce((acc, l) => pior(acc, l.resultado), 'ok');
const status = geral === 'divergente' ? 'divergente' : (geral === 'ok' ? 'conferido' : 'alerta');
const nomesDiv = linhasTodas.filter(l => l.resultado === 'divergente').map(l => l.rotulo);
const nomesAle = linhasTodas.filter(l => l.resultado === 'alerta' || l.resultado === 'nao_lido').map(l => l.rotulo);
const mensagem = status === 'divergente' ? 'Divergente: ' + nomesDiv.join(', ')
  : status === 'alerta' ? 'Conferir: ' + nomesAle.join(', ') : 'Todos os participantes conferem';
return registrar(status, mensagem + (errosLeitura.length ? ' · ' + errosLeitura.join('; ') : ''), linhasTodas);
