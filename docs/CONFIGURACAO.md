# Travion — Configuração e implantação

Este guia leva o app da prévia local para produção com banco de dados real.

> **Situação atual:** o banco (estrutura, permissões, funções e testes) foi validado em PostgreSQL 16 local, com uma simulação mínima da autenticação do Supabase. **Ainda não foi executado num projeto Supabase real**, porque o projeto e as credenciais não foram fornecidos. Os passos abaixo devem ser seguidos e conferidos na primeira instalação.

## 1. O que você precisa

| Item | Para quê | Quem fornece |
|---|---|---|
| Projeto no Supabase (plano gratuito serve para testes) | Banco PostgreSQL, login, tempo real | Transpanorama (conta própria) |
| URL do projeto e chave **anon** (pública) | Ligar o app ao banco | Supabase → Project Settings → API |
| Hospedagem de site estático (Vercel, Netlify, Cloudflare Pages ou similar) | Publicar o app | Transpanorama |
| Node.js 20 ou mais novo | Gerar a versão de produção | Máquina de quem implanta |

**Nunca** use a chave `service_role` no app nem a envie por chat ou e-mail. Ela ignora todas as regras de acesso.

## 2. Criar o banco

> **Situação em 27/10/2026:** o banco da Transpanorama (projeto `xdnjwnhhyttysbmmzjpn`) já está com os passos 2.1 a 2.4 concluídos. Esse projeto também guarda tabelas de outro sistema (`freight_quotes`, `whatsapp_*`, funções `iq_*`). As migrações do Travion só alteram os próprios objetos e não mexem nessas tabelas.

1. Crie o projeto no Supabase (região São Paulo, `sa-east-1`, de preferência).
2. Abra **SQL Editor** e execute, **nesta ordem**, o conteúdo de cada arquivo:
   1. `supabase/migrations/20261026000100_estrutura.sql`
   2. `supabase/migrations/20261026000200_permissoes.sql`
   3. `supabase/migrations/20261026000300_funcoes.sql`
   4. `supabase/migrations/20261026000400_importacao_realtime.sql`
   5. `supabase/migrations/20261026000500_dados_demo.sql`
   6. `supabase/migrations/20261027000600_search_path.sql`
   7. `supabase/migrations/20261027000700_promover_existente.sql` (opcional; não aplicada em produção)
   8. `supabase/migrations/20261027000800_cadastros_v2.sql`
   9. `supabase/migrations/20261027000900_centros_custo.sql`
  10. `supabase/migrations/20261027001000_precos_cna.sql` (preços da CNA às 15h; liga pg_cron e pg_net)
  11. `supabase/migrations/20261027001100_precos_cna_conversoes.sql` (etanol em litro e algodão em libra-peso para kg)
- `20261027001200_locais_link_mapa.sql`: link do Google Maps nos locais (anúncio de frete).
- `20261027001300_papeis_supervisor_embarcador.sql` e `20261027001310_matriz_novo_embarque.sql`: papéis Supervisor e Embarcador; quem cadastra embarque.
- `20261027001400_posicoes_confirmacao.sql`: confirmação da posição pelos supervisores (Posições de Embarque), horário do servidor e logo da TP (Posição do Cliente). Só acrescenta colunas e funções; não apaga nem altera dados.
- `20261027001510_permissao_pagina_posicoes.sql`: permissão `posicoes.pagina` (acesso à página Posições de Embarque) e edição de contadores para o Coordenador Comercial.
- `20261027001500_suspender_encerrar.sql`: suspensão com encerramento automático após 7 dias (pg_cron de hora em hora) e encerramento definitivo (permissão nova `embarques.encerrar`, gestor). Rode antes de publicar o app: a tela lê as colunas novas `suspenso_em` e `encerrado_*`.
- `20261027001600_papel_apoio.sql` e `20261027001610_apoio_operacional.sql`: papel **Apoio Operacional**, solicitações de documentação (lote e emissão), lote do ERP, pendências, anexos, notificações internas e o bucket privado `documentacao` no Storage (15 MB por arquivo; PDF, PNG, JPG e WEBP). A 1600 precisa ser confirmada (COMMIT) antes da 1610, porque acrescenta um valor ao tipo `papel_usuario`. Só cria objetos novos; não apaga nem altera dados existentes.
- `20261028001700_cadastro.sql`: aba **Cadastro** (tipo Cadastro na mesma fila do apoio, status Cadastro concluído, permissões `cadastro.solicitar` e `cadastro.ver`, mais formatos no bucket `documentacao`, 10 MB por arquivo do cadastro). `20261028001710_unificar_apoio_operacao.sql`: quem era Operação passa a Apoio Operacional. As duas só acrescentam; podem ir numa colagem só.

   Alternativa: com a [Supabase CLI](https://supabase.com/docs/guides/cli), `supabase link --project-ref SEU_PROJETO` e depois `supabase db push`.
3. **Não execute** nada da pasta `supabase/tests/`. Aqueles arquivos simulam o Supabase e servem só para testes locais.
4. Confira em **Database → Publications → supabase_realtime** se as tabelas `embarques`, `posicoes_diarias`, `embarque_financeiro`, `configuracoes`, `metas_diarias` e `clientes` estão marcadas. A migração 4 as adiciona; se a publicação não existir no seu projeto, marque-as manualmente.
5. Em **Project Settings → API → Exposed schemas**, mantenha apenas `public` (o padrão). O schema `private` guarda funções internas e **não** deve ser exposto.

## 3. Login

Em **Authentication**:

- **Sign In / Providers → Email:** habilitado. Recomendado manter “Confirm email” ligado.
- **URL Configuration → Site URL:** o endereço onde o app será publicado (ex.: `https://travion.transpanorama.com.br`).
- **URL Configuration → Redirect URLs:** acrescente o mesmo endereço (e `http://localhost:5173` se for rodar localmente).
- **Novos cadastros:** o botão “Solicitar acesso” do app usa o cadastro do Supabase. A conta nasce **aguardando aprovação**, sem acesso a nenhum dado, até um administrador aprovar. Se preferir só convites, desligue “Allow new users to sign up”. Nesse caso, quem foi convidado precisa ser criado em Authentication → Users → Add user, com o mesmo e-mail do convite.
- **E-mails:** o envio padrão do Supabase tem limite baixo por hora. Para uso real, configure um SMTP próprio em Authentication → Emails → SMTP Settings.

## 4. Primeiro administrador

1. Abra o app (passo 6) e use **Solicitar acesso** com o seu e-mail. Confirme o e-mail se o Supabase pedir.
2. No **SQL Editor** do Supabase, execute:

   ```sql
   select private.promover_administrador('seu.email@transpanorama.com.br');
   ```

3. Entre no app. A partir daí, os demais usuários são aprovados ou convidados em **Administração → Usuários e convites**.

Essa função só pode ser executada no SQL Editor (por quem administra o projeto Supabase); ela não fica disponível para usuários do app.

## 5. Variáveis do app

Copie `.env.example` para `.env.local` e preencha:

```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=chave-anon-do-projeto
```

Sem essas variáveis, o app abre em **PRÉVIA LOCAL**: dados fictícios guardados só no navegador, com uma faixa amarela fixa avisando. A prévia nunca grava no banco.

## 6. Rodar e publicar

```bash
npm install --legacy-peer-deps   # a opção contorna um problema conhecido do npm com estas dependências
npm run dev                      # desenvolvimento em http://localhost:5173
npm run build                    # gera a pasta dist/
```

Publique a pasta `dist/` em qualquer hospedagem de site estático. O app usa rotas com `#` (ex.: `/#/dashboard`), então não é preciso configurar redirecionamento no servidor. Defina as duas variáveis do passo 5 também no painel da hospedagem antes do build.

## 7. Carga inicial de dados

1. **Administração → Cadastros:** confira filiais, comerciais e produtos (ou deixe a importação criar).
2. **Administração → Importação:** envie a planilha `.xlsx`, escolha a aba **Lista de Fretes** e a aba **Clientes**, revise o mapeamento de colunas, **informe a data operacional** e gere a prévia. Só depois de conferir, confirme.
3. **Administração → Configurações:** confirme 40 t por veículo e meta de 2 veículos por lote.
4. Os fretes entram como **R$/t** (regra confirmada). Se algum embarque for cobrado de outra forma, ajuste a unidade na aba Financeiro dos detalhes; o Dashboard então marca as projeções financeiras como não validadas.
5. **Administração → Metas diárias:** cadastre as metas financeiras do dia, se houver.

### Dados demonstrativos

Em **Administração → Dados demonstrativos** (só administrador) é possível carregar um conjunto fictício marcado como `[DEMO]`. Ele fica separado dos dados reais: só aparece com o “Modo demonstração” ligado e nunca entra nos indicadores reais. O mesmo botão permite apagá-lo.

## 8. Testes

```bash
npm test                                           # regras de cálculo e leitura da planilha (Vitest)
PLANILHA_REFERENCIA=/caminho/lista.xlsx npm test   # inclui a conferência com a planilha original
npm run test:db                                    # critérios de aceite no banco (precisa de PostgreSQL 16 local)
```

O `test:db` recria um banco chamado `freteiq_test`, aplica uma simulação mínima do Supabase (`supabase/tests/00_stub_supabase.sql`), as cinco migrações e os testes. Não aponte esse script para o banco de produção.

## 9. Segurança: o que já está feito e o que falta

Feito:
- Toda leitura passa pelo RLS (Row Level Security) do PostgreSQL, por filial, carteira e permissão.
- Nenhuma tabela aceita gravação direta do app. Toda gravação passa por funções do servidor que conferem a permissão de cada campo, a versão do registro e gravam o histórico.
- Valores financeiros ficam numa tabela separada, legível só por quem tem “Ver financeiro”.
- O link do cliente usa um código aleatório de 256 bits. O banco guarda só o resumo criptográfico (hash), nunca o código.

Pendente (ver `REGRAS_DE_NEGOCIO.md`, seção 9):
- Limite de tentativas por IP na consulta pública. Hoje depende só do limite geral do Supabase.
- Backup e retenção: configurar no plano do Supabase (Point-in-Time Recovery está nos planos pagos).
- Revisão de segurança por terceiro antes de abrir o link do cliente em larga escala.
