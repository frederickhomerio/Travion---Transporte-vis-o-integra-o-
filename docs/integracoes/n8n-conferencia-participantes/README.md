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

**NF de trânsito (regra do Frederick, 05/11/2026):** quando a natureza da operação contém "OUTRAS ENTRADAS" ou
"TRÂNSITO", ou as observações dizem "efeito de trânsito" / "nota fiscal de trânsito", a regra inverte: o emitente
da NF é o destinatário (e a entrega); o quadro destinatário/remetente é o remetente (e a coleta). É a mercadoria que o
cliente manda buscar no local de coleta. O pagador segue o campo Frete com as partes invertidas (1 = emitente paga).

**Observações da NF para coleta e entrega (regra do Frederick, 05/11/2026):** quando coleta ou entrega não conferem,
a conferência procura nas observações um trecho com "local de retirada", "local de coleta", "carregamento",
"local de entrega", "descarga" e semelhantes, e confere o município do CT-e nesse trecho. Vale mesmo quando a NF tem o
bloco de retirada/entrega (ex.: bloco em Montividiu, observação "LOCAL DE RETIRADA ... IVOLANDIA GO" = verde).

**Leituras imperfeitas de município:** "ÁREA/ZONA RURAL DE X" vale como X, e a UF grudada no nome ("MONTIVIDIUGO") é separada.
**Expedidor/recebedor que a NF não cita** (armazém, silo, terminal), com remetente/destinatário conferindo: amarelo, não vermelho.

Vermelho: CNPJ diferente com os dois dígitos verificadores válidos, CT-e citando outra NF, e CT-e com o mesmo
CNPJ como remetente e destinatário (exceto quando a própria NF tem emitente = destinatário).
CNPJ/CPF e chave com dígito verificador inválido são tratados como leitura ruim (amarelo ou conferência por aproximação).

## Economia de crédito da IA (11/11/2026)

- **Leitura guardada:** cada leitura por IA que "fecha" fica na tabela `auditoria_leituras` (por anexo, migração
  `auditoria_leituras_cache`, sem acesso pelo app). O ↻ e as reconferências reaproveitam a leitura e não gastam crédito.
  Nós: "Buscar leituras salvas" (antes de baixar) e "Montar leituras para guardar" → "Guardar leituras" (`guardar-leituras.js`).
- **gpt-4.1-mini primeiro:** "Converter leitura da IA" (`converter.js`) confere a leitura: chave com dígito verificador,
  CNPJ/CPF válidos, partes principais com documento e município, emitente da NF = CNPJ da chave e início da prestação
  no CT-e. Se não fechar, "Leitura confere?" manda o arquivo para o gpt-4.1 ("Ler de novo", `converter-forte.js`),
  que soma os tokens das duas leituras. Se o 4.1 falhar, fica a leitura do mini (sem guardar).
- **PDF digital como texto:** "Extrair texto do PDF" tira o texto embutido; com pelo menos 400 caracteres, CNPJ/CPF e
  44 dígitos, o mini recebe só o texto (bem mais barato). Foto e PDF escaneado continuam indo como arquivo.
- Sem crédito na OpenAI, a conferência mostra "Sem créditos na OpenAI: recarregar em platform.openai.com (Billing)".
