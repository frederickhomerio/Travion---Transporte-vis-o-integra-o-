# Frete IQ — Regras de negócio, premissas e pontos em aberto

Versão 0.1, de 27/10/2026. A referência é a planilha **“Lista fretes 2025 3.xlsx”**. Ela foi usada como fonte de dados e de regras de cálculo. Textos dentro das células foram tratados como dados, nunca como instruções.

## 1. Modelo de dados

| Conceito | Regra |
|---|---|
| **Embarque (lote)** | Cadastro com identificador próprio (código `EMB-000001`). A mesma rota pode ter vários embarques. Origem e destino **não** identificam o embarque. |
| **Posição diária** | Porta, trânsito, carregados e observações de um embarque numa data. No máximo **uma posição por embarque por data**. |
| **Histórico** | Cada alteração registra a entidade, o campo, o valor anterior, o valor novo, o usuário e o horário. Ninguém consegue editar o histórico. |
| **Situação × status** | *Status de liberação* (Liberado / Suspenso / Não informado) é diferente de *situação cadastral* (Ativo / Arquivado). Um embarque suspenso continua visível e editável, com alerta. Um embarque arquivado sai da lista diária e não é editável. |
| **Cadastros auxiliares** | Filiais, comerciais (carteiras), clientes, produtos, locais (coleta/entrega) e usuários. |
| **Carteira** | Ao escolher o cliente, o app sugere a carteira dele. Trocar a carteira exige a permissão “Alterar carteira” e fica no histórico. |

## 2. Fórmulas

Usando `cap` = toneladas por veículo (padrão 40 t, configurável e editável por embarque):

| Indicador | Fórmula | Origem na planilha |
|---|---|---|
| Volume na porta | porta × cap | VOL PORTA |
| Volume em trânsito | trânsito × cap | Vol TRANSITO |
| Volume carregado | carregados × cap | Vol Carregado |
| Total operacional | porta + trânsito + carregados | Dashboard B4…H4 |
| **Volume projetado** | volume na porta + volume carregado (**sem trânsito**) | PORTA + CARREGADO |
| Volume potencial | porta + trânsito + carregado (em t) | — (informativo) |
| Lotes | embarques distintos **com posição na data**, dentro do filtro | Dashboard J4 |
| Meta do lote | cadência própria do lote, se houver. Sem cadência: meta padrão (2 veículos) × cap | META / Dashboard |
| Volume disponibilizado | soma das metas de cada lote (t) | Dashboard B8 |
| **Aderência** | projetado ÷ disponibilizado × 100, **sem teto de 100%**. Sem denominador válido, mostra “Sem meta definida”. | Dashboard |
| Ticket empresa / motorista | média simples dos fretes numéricos (como `MÉDIA` do Excel) | Dashboard |
| Faturamento projetado | volume projetado × ticket empresa | Dashboard |
| Margem % | 1 − ticket motorista ÷ ticket empresa | Dashboard |
| Margem R$ | faturamento projetado × margem % | Dashboard |

Exemplo do critério de aceite: porta 3, trânsito 2, carregados 4, 40 t → 120 t / 80 t / 160 t, projetado 280 t, total 9 veículos. Um lote com meta 2 e 40 t tem meta de 80 t.

**Total operacional não é frota.** É a soma das posições informadas. O mesmo caminhão pode aparecer em dias diferentes.

**Campos calculados não são editáveis.** O app sempre recalcula. Nenhuma coluna calculada da planilha é importada.

### Capacidade e meta preservadas no histórico

Cada posição guarda a capacidade (t/veículo) e a meta vigentes quando foi criada. Mudar a capacidade ou a cadência de um embarque atualiza só as posições de **hoje em diante** (horário de Brasília). Os dias anteriores ficam como estavam.

### Vários dias

No modo “Vários dias”, o app **não soma fotografias diárias**:

- **Porta e trânsito** são saldos. Vale a última posição de cada lote no período.
- **Carregados** é acumulado. Soma os carregados de cada dia.
- **Meta do período** é a soma das metas diárias dos lotes nos dias com posição.

## 3. Conferência com a planilha

Importando a aba Lista de Fretes do arquivo de referência, o app reproduz a aba Dashboard Operacional:

| Medida | Planilha | App |
|---|---|---|
| Porta / Trânsito / Carregados / Total | 57 / 42 / 25 / 124 | 57 / 42 / 25 / 124 |
| Lotes | 37 | 37 |
| Volume disponibilizado | 2.960 t | 2.960 t |
| Volume projetado | 3.280 t | 3.280 t |
| Volume em trânsito | 1.680 t | 1.680 t |
| Aderência | 110,81% | 110,81% |
| Ticket empresa / motorista | R$ 186,41 / R$ 164,00 | **R$ 183,92 / R$ 164,99** |

**Por que os tickets mudam:** dois fretes estavam gravados como texto (ex.: “R$ 142,00”). A `MÉDIA` do Excel ignora texto. O app converte esses valores em número, então passa a usar os 37 fretes de empresa e 36 de motorista. O valor original fica guardado para conferência. Um frete empresa igual a zero (linha 13) entra na média, como na planilha. Isso pode ser desligado em Configurações.

Este teste é automatizado (`src/lib/planilha.test.ts`, com `PLANILHA_REFERENCIA` apontando para o arquivo).

## 4. Posições diárias

- A data padrão é **hoje em America/Sao_Paulo**. Datas anteriores continuam consultáveis.
- Os contadores **nunca** são copiados nem zerados automaticamente de um dia para o outro.
- “Abrir posições” é uma ação explícita. O usuário escolhe se transporta porta e trânsito da última posição anterior ou se começa em zero. **Carregados sempre começa em 0.** Posições que já existem não são alteradas.
- Os contadores aceitam só inteiros ≥ 0. Vazio significa “não informado”, que é diferente de zero.
- Uma alteração só aparece como salva depois de o servidor confirmar. Sem conexão, nada é marcado como salvo, e o app mostra o erro e oferece “tentar de novo”.

## 5. Trabalho simultâneo

- Cada gravação envia só os campos alterados e o valor que o usuário viu antes de editar.
- Se outra pessoa mudou **o mesmo campo** nesse meio-tempo, nada é gravado. O app mostra os dois valores e a pessoa escolhe qual fica.
- Se foram campos diferentes, as duas alterações são mantidas.
- As outras telas recebem a mudança em tempo real. Ao reconectar, o app recarrega tudo.

## 6. Perfis e permissões

As permissões são conferidas **no banco**, inclusive em exportações, indicadores e tempo real. Ver e editar são permissões separadas. A matriz padrão pode ser alterada pelo administrador em Administração → Permissões, e exceções individuais por usuário ficam registradas.

| Perfil | Padrão |
|---|---|
| Administrador | Tudo. O último administrador ativo não pode ser removido nem bloqueado. |
| Gestor | Suas filiais: cadastro, liberar/suspender, cadência, capacidade, arquivar, posições, histórico, compartilhamento. **Sem financeiro**, a não ser por autorização específica. |
| Operação | Suas filiais: ver, abrir posições, contadores, observação operacional. Sem financeiro, permissões ou carteira. |
| Comercial | Própria carteira: ver, financeiro (ver e editar), cadência, observação para o cliente, histórico, compartilhamento. Contadores só com permissão extra. |
| Consulta | Somente leitura no seu escopo. |
| Cliente externo | Apenas o link protegido do próprio cliente. |

Novos usuários entram por convite ou pedem acesso e aguardam aprovação. Até lá, não veem nenhum dado.

## 7. Posições de Embarque (cliente)

- Usa a mesma base da Lista de Fretes. Não há segunda digitação.
- Agrupa só registros compatíveis (mesma origem, coleta, destino, entrega e produto). Mostra o total do cliente e o detalhe por rota.
- Saídas: texto para WhatsApp (modelo combinado), imagem PNG, PDF, e-mail (assunto e corpo) e link de consulta. **Nada é enviado automaticamente.**
- Imagem e PDF são um retrato do momento e levam o horário impresso. O link mostra a posição atualizada.
- **Link do cliente:** código imprevisível de 256 bits, com validade de 1 a 720 h (padrão 72 h). Pode ser revogado, serve a um único cliente e é somente leitura. Mostra a posição mais recente até hoje. **Nunca** expõe valores financeiros, observações internas, status de liberação ou nomes de usuários.

## 8. Importação da planilha

- Fluxo: arquivo → aba → mapeamento de colunas → **data operacional obrigatória** → prévia com inconsistências → confirmação → relatório. O nome do arquivo não comprova a data.
- A aba **Lista de Fretes** é a fonte. As abas Dashboard e Posição de Embarques são visões derivadas e não são importadas. A aba **Clientes** alimenta clientes e carteiras.
- Só valores são lidos. Fórmulas e macros nunca são executadas (só `.xlsx`).
- O app ignora linhas vazias, linhas de total e linhas sem cliente, origem ou destino. Também trata espaços extras, acentos e “R$ 67,50”.
- Valor ausente **não vira zero**. Status vazio vira “Não informado”. Uma observação com “suspenso” só **sugere** a mudança, e cada linha precisa ser marcada.
- A identidade é estável: cliente, filial, rota, locais e produto, mais o número da ocorrência no arquivo. Reimportar o mesmo arquivo **não duplica** (testado: 37 vinculados, 0 novos, 37 posições iguais).
- Linhas com a mesma rota viram embarques distintos. Não são mescladas.
- Uma posição já existente com números diferentes é **mantida** e informada no relatório, a menos que o usuário marque “substituir”.
- Uma carteira diferente da cadastrada vira aviso. A carteira não é trocada automaticamente.
- Colunas extras (OBSERVAÇÃO TRANSPANORAMA, PONTO) ficam numa área restrita do embarque, sem uso em cálculo.

### Mapeamento usado na planilha de referência

CARTEIRA → carteira · FILIAL → filial · CLIENTE → cliente · ORIGEM → cidade de origem · CARREGAMENTO → local de coleta · DESTINO → cidade de destino · UF → UF de destino · DESCARGA → local de entrega · PRODUTO → produto · FRETE EMP / FRETE MOT → fretes · STATUS → status · PORTA / TRANSITO / CARREGADOS → contadores · OBSERVAÇÃO → **observação interna** · META → cadência · VOL PORTA, Vol TRANSITO, Vol Carregado, Embarque, PORTA + CARREGADO → ignoradas (o app recalcula) · OBSERVAÇÃO TRANSPANORAMA, PONTO → referência.

## 9. Premissas adotadas e pontos que exigem definição

Cada item abaixo foi decidido de forma conservadora para não travar o trabalho. **Precisa da sua confirmação.**

| # | Ponto | O que o app faz hoje | Decisão necessária |
|---|---|---|---|
| 1 | **Unidade do frete** | Todos os fretes começam como “não confirmada”. Faturamento, margem R$ e margem % aparecem como “Não validado”. | Confirmar se FRETE EMP e FRETE MOT são R$/t. Se forem, confirmar em lote. |
| 2 | Coluna OBSERVAÇÃO | Importada como **observação interna**. A aba Posição de Embarques da planilha a mostrava ao cliente. | Pode ir para o cliente? Se sim, mapear como “Observação para o cliente” na importação. |
| 3 | UF de origem | A planilha não tem. A origem fica sem UF. | Informar UF por cidade ou aceitar sem UF. |
| 4 | Coluna META | Mapeada como cadência (veículos/dia). Na planilha de referência ela está vazia, então vale o padrão de 2 veículos/lote. | Confirmar o significado de META e se a cadência deve ser em veículos/dia ou t/dia. |
| 5 | Lotes | Conta os embarques **com posição na data**. A planilha contava todas as linhas. | Confirmar. |
| 6 | Frete zero no ticket | Incluído (igual à planilha). | Manter? Configurável. |
| 7 | Metas financeiras | Uma meta por data, global, sem herança entre dias. As metas da planilha não foram adotadas. | Definir metas e se haverá meta por filial. |
| 8 | Comercial com financeiro e cadência | Ligado por padrão. | Confirmar a matriz de permissões. |
| 9 | “NÃO CARREGAR” na aba Clientes | Tratado como **restrição comercial** (alerta), não como nome de carteira. | Confirmar se deve bloquear novos embarques. |
| 10 | Propagação de capacidade/meta | Vale de hoje em diante. | Confirmar. |
| 11 | Link do cliente | Mostra a última data até hoje e omite o status de liberação. | Confirmar se o cliente deve ver “Suspenso”. |
| 12 | Limite de tentativas no link | Não implementado (só o limite geral do Supabase). | Definir antes de uso amplo. |
| 13 | E-mail de convite | O app registra o convite, mas não envia o e-mail. | Decidir se usa o e-mail do Supabase/SMTP. |
| 14 | Retenção do histórico e dos dados demonstrativos | Sem expurgo automático. | Definir o prazo (aspecto LGPD). |

## 10. Critérios de aceite × testes

| Critério | Como foi verificado |
|---|---|
| Alterar uma posição atualiza lista, dashboard e resumo do cliente | Mesma base e mesmo estado no app. Tempo real por Supabase Realtime (**não testado em projeto real**). |
| Dois usuários sem perda silenciosa | `supabase/tests/10_aceite.sql`: conflito no mesmo campo, mescla em campos diferentes. |
| Operação não altera financeiro, nem por requisição direta | `10_aceite.sql`: chamada direta recusada, leitura da tabela financeira vazia. |
| Cliente externo não consulta outro cliente | `10_aceite.sql`: token de um cliente só retorna esse cliente; revogado e expirado recusados. |
| 3/2/4 a 40 t → 120/80/160 t, projetado 280 t, total 9 | `10_aceite.sql` e `src/lib/calculos.test.ts`. |
| Meta 2 a 40 t = 80 t | `calculos.test.ts`. |
| Sem meta não divide por zero | `calculos.test.ts` (“Sem meta definida”). |
| Mudar capacidade não altera histórico | `10_aceite.sql`. |
| Reimportação não duplica | `20_importacao.sql` e teste de tela com a planilha real. |
| Celular e computador | Testes de tela em 390 px e 1366 px, sem rolagem horizontal da página. |
| Módulos 4 e 5 reservados | Menu “Em breve”, sem função simulada. |

## 11. Limitações desta versão

- **Integração com Supabase não testada em projeto real.** O banco foi validado em PostgreSQL 16 local, com simulação do login. Login por e-mail, tempo real e políticas precisam ser conferidos na primeira instalação.
- A prévia local (sem servidor) guarda dados só no navegador e reproduz as permissões apenas para demonstração. A segurança real está no banco.
- O app não funciona offline por desenho: nenhuma gravação é confirmada sem servidor.
