// Compara os participantes da NF-e com os do CT-e e monta o resultado para o Travion.
// Regras (sempre por CNPJ/CPF e município; o nome só ajuda quando o documento não foi lido):
//  Remetente      NF: emitente                                                      x  CT-e: remetente
//  Destinatário   NF: bloco destinatário/remetente                                  x  CT-e: destinatário
//  (regra do Frederick, 05/11/2026, para NF de saída. NF de entrada: dest/rem da NF = remetente e emitente = destinatário;
//   remetente = destinatário no CT-e é erro)
//  Entrega com término diferente mas destinatário certo = atenção (trecho até terminal/transbordo)
//  Modalidade do frete x tomador incoerente = atenção (não é rejeição da SEFAZ)
//  Local coleta   NF: local de retirada (bloco ou observações), senão remetente x  CT-e: expedidor, senão remetente + início da prestação
//  Local entrega  NF: local de entrega (bloco ou observações), senão destinatário x  CT-e: recebedor, senão destinatário + término da prestação
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
// CNPJ/CPF lidos por IA: completa zero à esquerda perdido e confere os dígitos verificadores.
function cnpjValido(c) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (base, pesos) => { const s = base.split('').reduce((a, n, i) => a + Number(n) * pesos[i], 0) % 11; return s < 2 ? 0 : 11 - s; };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], p2 = [6].concat(p1);
  return dv(c.slice(0, 12), p1) === Number(c[12]) && dv(c.slice(0, 13), p2) === Number(c[13]);
}
function cpfValido(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}
function docNormal(v) {
  let d = dig(v);
  if (d.length === 13 && cnpjValido('0' + d)) d = '0' + d;
  if (d.length === 10 && cpfValido('0' + d)) d = '0' + d;
  return d;
}
const docValido = d => cnpjValido(d) || cpfValido(d);
function distancia(a, b) {
  const m = a.length, n = b.length, t = [];
  for (let i = 0; i <= m; i++) { t[i] = [i]; }
  for (let j = 1; j <= n; j++) t[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    t[i][j] = Math.min(t[i - 1][j] + 1, t[i][j - 1] + 1, t[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return t[m][n];
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
  const a = docNormal(nf.cnpj_cpf), b = docNormal(cte.cnpj_cpf);
  if (a && b) {
    if (a === b) return { resultado: 'ok', observacao: '' };
    const va = docValido(a), vb = docValido(b);
    // Leitura imperfeita (dígito verificador não fecha) de um lado: confere por aproximação + nome.
    if (!(va && vb)) {
      const perto = distancia(a, b) <= 3;
      if (perto && parecido(nf.nome, cte.nome)) return { resultado: 'ok', observacao: 'CNPJ/CPF mal lido (' + (va ? 'CT-e' : 'NF') + '), mas confere pelo nome e pelos números' };
      return { resultado: 'alerta', observacao: 'CNPJ/CPF ilegível ' + (va ? 'no CT-e' : 'na NF') + ' (NF ' + a + ', CT-e ' + b + '): conferir no documento' };
    }
    if (a.length === 14 && b.length === 14 && a.slice(0, 8) === b.slice(0, 8)) {
      return { resultado: 'alerta', observacao: 'Mesma empresa, filial diferente: NF ' + a + ', CT-e ' + b };
    }
    return { resultado: 'divergente', observacao: 'CNPJ/CPF diferente: NF ' + a + ', CT-e ' + b };
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
  if (docNormal(nfLocal.cnpj_cpf) && docNormal(cteLocal.cnpj_cpf)) {
    const p = compararParte(nfLocal, cteLocal);
    res = pior(res, p.resultado);
    if (p.observacao) obs.push(p.observacao);
  }
  const c1 = compararCidade(nfLocal, cteLocal);
  if (c1 === 'divergente') obs.push('Cidade diferente: NF ' + cidade(nfLocal) + ', CT-e ' + cidade(cteLocal));
  res = pior(res, c1);
  if (norm(cteCidade && cteCidade.municipio)) {
    const c2 = compararCidade(nfLocal, cteCidade);
    if (c2 === 'divergente') obs.push(nomeCidade + ' do CT-e (' + cidade(cteCidade) + ') diferente da NF');
    res = pior(res, c2);
  }
  if (res === 'nao_lido') obs.push('Cidade não lida em um dos documentos');
  return { resultado: res, observacao: obs.join('; ') };
}

// Alguns modelos de NF só trazem coleta/entrega nas observações (Dados Adicionais): se o local do CT-e
// (CNPJ/CPF ou município) aparecer escrito lá, confere.
function nasObservacoes(texto, cteLocal, cteCidade) {
  const t = norm(texto), d = dig(texto);
  if (!t) return '';
  const doc = docNormal(cteLocal && cteLocal.cnpj_cpf);
  if (doc.length >= 11 && d.includes(doc)) return 'CNPJ/CPF';
  const mun = norm(cteLocal && cteLocal.municipio) || norm(cteCidade && cteCidade.municipio);
  if (mun && (' ' + t + ' ').includes(' ' + mun + ' ')) return 'município';
  return '';
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
    // Na chave vem o CNPJ (14) ou, para produtor, '000' + CPF (11). Só corrige com um documento válido.
    const k = docDaChave(d.chave_acesso);
    const doc = cnpjValido(k) ? k : (k.startsWith('000') && cpfValido(k.slice(3)) ? k.slice(3) : '');
    if (doc && docNormal(d.emitente && d.emitente.cnpj_cpf) !== doc) {
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
    local_retirada: d.local_retirada, local_entrega: d.local_entrega, dados_adicionais: d.dados_adicionais || '', legibilidade: d.legibilidade, arquivo: d._arquivo })),
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
  // Chave da NF mal lida (dígito verificador não fecha): procura a chave citada no CT-e com o mesmo número de NF
  // e o mesmo CNPJ/CPF do emitente (os dois estão dentro da chave).
  let porAproximacao = false;
  if (!alvo.length) {
    alvo = nfs.filter(n => !n._chave_ok && citadas.some(c => {
      const num = String(Number(c.slice(25, 34)));
      const numNf = String(Number(dig(n.numero) || '0'));
      const emit = docNormal(n.emitente && n.emitente.cnpj_cpf);
      const doc = c.slice(6, 20);
      return chaveValida(c) && numNf !== '0' && num === numNf && (!emit || doc.endsWith(emit) || distancia(doc, emit.padStart(14, '0')) <= 2);
    }));
    porAproximacao = alvo.length > 0;
  }
  const linhaChave = { campo: 'nf_no_cte', rotulo: 'NF citada no CT-e' };
  if (alvo.length) {
    linhaChave.nf = alvo.map(n => 'NF ' + (n.numero || '') + ' · chave ' + dig(n.chave_acesso)).join('\n');
    linhaChave.cte = citadas.length + ' chave(s) citada(s)';
    linhaChave.resultado = 'ok';
    linhaChave.observacao = porAproximacao ? 'Chave da NF mal lida; confere pelo número da NF e pelo CNPJ do emitente na chave do CT-e' : '';
  } else {
    alvo = nfs;
    linhaChave.nf = nfs.map(n => 'NF ' + (n.numero || '?') + (dig(n.chave_acesso) ? ' · chave ' + dig(n.chave_acesso) : ' · chave não lida')).join('\n');
    linhaChave.cte = citadas.length ? citadas.join('\n') : 'Nenhuma chave lida';
    const nfSemChave = nfs.some(n => !n._chave_ok);
    linhaChave.resultado = (!citadas.length || nfSemChave) ? 'nao_lido' : 'divergente';
    linhaChave.observacao = linhaChave.resultado === 'divergente' ? 'O CT-e cita outra NF' : 'Chave da NF ilegível na imagem: conferir o número da NF no CT-e';
  }
  const linhas = [linhaChave];
  const porCampo = {};
  for (const nf of alvo) {
    const rem = nf.emitente;
    const dest = nf.destinatario;
    const coletaNf = temParte(nf.local_retirada) ? nf.local_retirada : rem;
    const entregaNf = temParte(nf.local_entrega) ? nf.local_entrega : dest;
    const coletaCte = temParte(cte.expedidor) ? cte.expedidor : cte.remetente;
    const entregaCte = temParte(cte.recebedor) ? cte.recebedor : cte.destinatario;
    const obsNf = String(nf.dados_adicionais || '');
    const viaObs = (r, temBloco, cteLocal, cteCidade) => {
      if (r.resultado === 'ok' || temBloco || !obsNf) return r;
      const achou = nasObservacoes(obsNf, cteLocal, cteCidade);
      return achou ? { resultado: 'ok', observacao: 'Confere com as observações da NF (' + achou + ')', _obs: true } : r;
    };
    let cRem = compararParte(rem, cte.remetente), cDest = compararParte(dest, cte.destinatario);
    // NF de entrada (tpNF=0, ex.: usina emitindo nota do produtor): o quadro destinatário/remetente da NF é o REMETENTE
    // (quem promove a saída da carga) e o emitente é o destinatário. Em NF de saída, a ordem invertida é atenção.
    if (cRem.resultado === 'divergente' || cDest.resultado === 'divergente') {
      const iRem = compararParte(dest, cte.remetente), iDest = compararParte(rem, cte.destinatario);
      if (iRem.resultado === 'ok' && iDest.resultado === 'ok') {
        if (nf.nf_tipo_operacao === 'entrada') {
          cRem = { resultado: 'ok', observacao: 'NF de entrada: remetente = quadro destinatário/remetente da NF (produtor/fornecedor)' };
          cDest = { resultado: 'ok', observacao: 'NF de entrada: destinatário = emitente da NF' };
        } else {
          const txt = 'Remetente e destinatário invertidos em relação à NF (emitente = remetente). Só é correto em NF de entrada: confirmar o tipo da NF.';
          cRem = { resultado: 'alerta', observacao: txt }; cDest = { resultado: 'alerta', observacao: txt };
        }
      }
    }
    // NF de entrada com só um dos lados lido na ordem da entrada.
    if (nf.nf_tipo_operacao === 'entrada' && cDest.resultado === 'divergente' && compararParte(rem, cte.destinatario).resultado === 'ok') {
      cDest = { resultado: 'ok', observacao: 'NF de entrada: destinatário = emitente da NF' };
    }
    if (nf.nf_tipo_operacao === 'entrada' && cRem.resultado === 'divergente' && compararParte(dest, cte.remetente).resultado === 'ok') {
      cRem = { resultado: 'ok', observacao: 'NF de entrada: remetente = quadro destinatário/remetente da NF (produtor/fornecedor)' };
    }
    // Remetente e destinatário do CT-e com o mesmo CNPJ/CPF: a carga não "sai" de ninguém. A lei define remetente como
    // quem promove a saída inicial; isso é erro de emissão, mesmo em NF de entrada (aí o produtor deveria ser o remetente).
    const docRemCte = docNormal(cte.remetente && cte.remetente.cnpj_cpf);
    // Exceção: a própria NF tem o mesmo CNPJ como emitente e destinatário (ex.: trading remetendo para formação de lote).
    const nfMesmaParte = docNormal(rem && rem.cnpj_cpf) && docNormal(rem && rem.cnpj_cpf) === docNormal(dest && dest.cnpj_cpf);
    if (docRemCte && !nfMesmaParte && docRemCte === docNormal(cte.destinatario && cte.destinatario.cnpj_cpf)) {
      const txt = 'O CT-e tem o mesmo CNPJ/CPF como remetente e destinatário (' + mostrar(cte.remetente).split(' · ')[0] + '). '
        + (nf.nf_tipo_operacao === 'entrada' ? 'Na NF de entrada o remetente deve ser o produtor/fornecedor (quadro destinatário/remetente da NF).' : 'O remetente deve ser o emitente da NF.');
      if (cRem.resultado !== 'divergente') cRem = { resultado: 'divergente', observacao: txt };
      if (nf.nf_tipo_operacao === 'entrada' && compararParte(rem, cte.destinatario).resultado === 'ok') cDest = { resultado: 'ok', observacao: 'NF de entrada: destinatário = emitente da NF' };
    }
    // Trecho intermediário (transbordo, terminal, armazém): término do CT-e diferente do destino da NF é atenção, não erro,
    // quando o destinatário confere e não há CNPJ de recebedor contrariando.
    const trecho = (r) => {
      if (r.resultado !== 'divergente' || cDest.resultado === 'divergente') return r;
      if (/CNPJ\/CPF diferente/.test(r.observacao || '')) return r;
      return { resultado: 'alerta', observacao: (r.observacao ? r.observacao + '. ' : '') + 'Pode ser trecho até terminal, armazém ou transbordo: confirmar com a programação.' };
    };
    // NF de entrada sem bloco de retirada/entrega: a carga sai de quem está no quadro destinatário/remetente
    // (produtor) e chega ao emitente. Se a regra padrão não fechar, tenta essa leitura.
    const entrada = nf.nf_tipo_operacao === 'entrada';
    const local = (tipo, padrao, alternativo, cteLocal, cteCidade, nomeCidade, temBloco) => {
      const r = viaObs(compararLocal(padrao, cteLocal, cteCidade, nomeCidade), temBloco, cteLocal, cteCidade);
      if (r.resultado === 'ok' || temBloco || !entrada || !temParte(alternativo)) return { r, parte: padrao };
      const r2 = compararLocal(alternativo, cteLocal, cteCidade, nomeCidade);
      if (r2.resultado !== 'ok') return { r, parte: padrao };
      return { r: { resultado: 'ok', observacao: 'NF de entrada: ' + tipo + ' em ' + mostrar(alternativo).split(' · ')[0] }, parte: alternativo };
    };
    const lc = local('coleta', coletaNf, dest, coletaCte, cte.municipio_inicio, 'Início da prestação', temParte(nf.local_retirada));
    const le = local('entrega', entregaNf, rem, entregaCte, cte.municipio_fim, 'Término da prestação', temParte(nf.local_entrega));
    const itens = [
      ['remetente', 'Remetente', rem, cte.remetente, cRem],
      ['destinatario', 'Destinatário', dest, cte.destinatario, cDest],
      ['local_coleta', 'Local de coleta', lc.parte, coletaCte, lc.r],
      ['local_entrega', 'Local de entrega', le.parte, entregaCte, trecho(le.r)]
    ];
    for (const it of itens) {
      const atual = porCampo[it[0]];
      const textoCte = it[0] === 'local_coleta'
        ? [mostrar(it[3]), norm(cte.municipio_inicio && cte.municipio_inicio.municipio) ? 'Início: ' + cidade(cte.municipio_inicio) : ''].filter(Boolean).join('\n')
        : it[0] === 'local_entrega'
          ? [mostrar(it[3]), norm(cte.municipio_fim && cte.municipio_fim.municipio) ? 'Término: ' + cidade(cte.municipio_fim) : ''].filter(Boolean).join('\n')
          : mostrar(it[3]);
      const ehLocal = it[0] === 'local_coleta' || it[0] === 'local_entrega';
      const textoNf = it[4]._obs ? 'Obs. da NF: "' + obsNf.slice(0, 300) + '"'
        : (it[0] === 'local_coleta' && temParte(nf.local_retirada) ? 'Local de retirada: ' : '')
          + (it[0] === 'local_entrega' && temParte(nf.local_entrega) ? 'Local de entrega: ' : '') + mostrar(it[2])
          + (ehLocal && !temParte(it[0] === 'local_coleta' ? nf.local_retirada : nf.local_entrega) && obsNf ? '\nObs. da NF: "' + obsNf.slice(0, 200) + '"' : '');
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
  if (tom.observacao && dig(cliente.cnpj_cpf)) notas.push(tom.observacao);
  if (cte.tomador_papel) notas.push('Tomador no CT-e: ' + cte.tomador_papel);
  if (mods.length) notas.push('Frete na NF: ' + mods.map(m => MODALIDADE[m] || m).join(', '));
  // Modalidade x tomador: não é rejeição da SEFAZ, é coerência comercial (CIF paga o remetente, FOB o destinatário).
  // Compara pelo CNPJ de quem deveria pagar: CIF = quem envia a carga, FOB = quem recebe. Na NF de entrada quem envia
  // é o quadro destinatário/remetente (produtor) e quem recebe é o emitente.
  let modAlerta = '';
  const nf0 = alvo[0] || {};
  if (mods.length === 1) {
    // Só usa a orientação de entrada se o CT-e não seguir a NF diretamente (o tipo da NF às vezes é mal lido).
    const ent = nf0.nf_tipo_operacao === 'entrada' && compararParte(nf0.destinatario, cte.destinatario).resultado !== 'ok';
    const envia = ent ? nf0.destinatario : nf0.emitente, recebe = ent ? nf0.emitente : nf0.destinatario;
    const esperado = mods[0] === '0' ? envia : (mods[0] === '1' ? recebe : null);
    const dt = docNormal(cte.tomador && cte.tomador.cnpj_cpf), de = docNormal(esperado && esperado.cnpj_cpf);
    if (esperado && dt && de && docValido(dt) && docValido(de) && dt !== de && dt.slice(0, 8) !== de.slice(0, 8)) {
      modAlerta = 'NF é ' + (mods[0] === '0' ? 'CIF (frete de quem envia: ' : 'FOB (frete de quem recebe: ') + mostrar(esperado).split(' · ')[0]
        + '), mas o tomador do CT-e é ' + mostrar(cte.tomador).split(' · ')[0];
    }
    if (mods[0] === '9') modAlerta = 'NF diz "sem frete", mas há CT-e emitido';
  }
  if (modAlerta) notas.unshift(modAlerta + ': confirmar quem paga');
  linhas.push({ campo: 'pagador', rotulo: 'Cliente pagador', nf: 'Cliente do embarque: ' + (mostrar(cliente) || 'sem CNPJ no cadastro'),
    cte: mostrar(cte.tomador), resultado: pior(dig(cliente.cnpj_cpf) ? tom.resultado
      : (parecido(cliente.nome, cte.tomador && cte.tomador.nome) ? 'ok' : 'alerta'), modAlerta ? 'alerta' : 'ok'),
    observacao: (dig(cliente.cnpj_cpf) ? '' : 'Cadastro do cliente sem CNPJ no Travion: conferido pelo nome. ') + notas.join('; ') });

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
