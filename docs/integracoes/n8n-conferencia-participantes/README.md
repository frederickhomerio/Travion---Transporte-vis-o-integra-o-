# Conferência de participantes NF × CT-e (n8n)

Cópia do código dos nós Code do fluxo do n8n "Travion — Conferência de participantes NF × CT-e".
O fluxo vive no n8n; estes arquivos servem de referência e versionamento.

Caminho: anexar CT-e no Atendimento → gatilho `auditoria_ao_anexar` (migração 20261104003600) →
webhook do n8n (cabeçalho `x-travion-token`) → `auditoria_dados` → baixa os arquivos do bucket `documentacao` →
lê (PDF/imagem pela OpenAI; XML direto, pronto para a integração com o ERP) → compara → `auditoria_registrar`.

- `listar.js`: monta a lista de arquivos (CT-e anexado + notas da solicitação).
- `preparar.js`: separa XML (leitura direta) de PDF/imagem (pedido à OpenAI com JSON estruturado).
- `xml.js`: leitura direta de NF-e/CT-e em XML.
- `converter.js`: converte a resposta da OpenAI no formato comum.
- `comparar.js`: compara remetente, destinatário, local de coleta, local de entrega e cliente pagador.

Nenhuma chave fica aqui: URL e token do webhook ficam no Vault do Supabase; credenciais, no n8n.

## Regras de comparação (05/11/2026)

Regra operacional do Frederick para NF de saída, ajustada pela pesquisa de conciliação NF-e × CT-e:

| Campo | NF | CT-e | Exceções (amarelo ou verde, não vermelho) |
|---|---|---|---|
| Remetente | emitente | remetente | NF de entrada (tpNF=0): o quadro destinatário/remetente é o remetente |
| Destinatário | quadro destinatário/remetente | destinatário | NF de entrada: o emitente é o destinatário |
| Local de coleta | retirada (bloco ou observações), senão emitente | expedidor, senão remetente + início da prestação | NF de entrada: coleta no produtor |
| Local de entrega | entrega (bloco ou observações), senão destinatário | recebedor, senão destinatário + término | término diferente com destinatário certo = trecho até terminal/transbordo (amarelo) |
| Cliente pagador | campo Frete da NF: 0 = emitente paga; 1 = destinatário da NF paga | tomador (CNPJ) | 2 = terceiros, 3/4 = próprio, 9 = sem frete: amarelo (conferência manual) |

Vermelho: CNPJ diferente com os dois dígitos verificadores válidos, CT-e citando outra NF, e CT-e com o mesmo
CNPJ como remetente e destinatário (exceto quando a própria NF tem emitente = destinatário).
CNPJ/CPF e chave com dígito verificador inválido são tratados como leitura ruim (amarelo ou conferência por aproximação).
