# Travion

App interno da Transpanorama para acompanhar embarques rodoviários. Substitui a planilha operacional compartilhada.

**Módulos:** 1. Lista de Fretes · 2. Dashboard Operacional · 3. Posições de Embarque · Administração (usuários, permissões, cadastros, importação da planilha, configurações, metas). Os módulos 4. Análise e 5. Posição estão reservados (“Em breve”).

**Tecnologia:** React 18 + TypeScript + Vite no navegador. Supabase (PostgreSQL com RLS, login e tempo real) no servidor. Toda regra de acesso e toda gravação são conferidas no banco.

## Começar rápido (prévia local, sem servidor)

```bash
npm install --legacy-peer-deps
npm run dev
```

Sem as variáveis do Supabase, o app abre em **PRÉVIA LOCAL**, com dados fictícios guardados só no navegador e um seletor para simular cada perfil. Uma faixa amarela fica sempre visível.

## Produção

Siga [`docs/CONFIGURACAO.md`](docs/CONFIGURACAO.md). Ele cobre o projeto Supabase, as migrações, o login, o primeiro administrador, as variáveis e a publicação.

## Documentos

- [`docs/REGRAS_DE_NEGOCIO.md`](docs/REGRAS_DE_NEGOCIO.md): fórmulas, conferência com a planilha, permissões, importação, **pontos que exigem definição** e critérios de aceite.
- [`docs/CONFIGURACAO.md`](docs/CONFIGURACAO.md): instalação e segurança.

## Estrutura

```
supabase/migrations/   banco: tabelas, permissões (RLS), funções, importação, dados demonstrativos
supabase/tests/        testes de aceite do banco (somente ambiente local)
src/lib/               regras de cálculo, leitura da planilha, texto do WhatsApp (com testes)
src/data/              acesso a dados: supabaseApi (produção) e localApi (prévia)
src/pages/             telas
src/components/        componentes de interface
```

## Testes

```bash
npm test          # cálculo e importação (Vitest)
npm run test:db   # critérios de aceite no PostgreSQL local
npm run build     # verificação de tipos e build de produção
```

A planilha de referência não fica no repositório (contém dados comerciais). Para conferir os totais com ela: `PLANILHA_REFERENCIA=/caminho/arquivo.xlsx npm test`.
