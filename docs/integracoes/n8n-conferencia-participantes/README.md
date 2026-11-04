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
