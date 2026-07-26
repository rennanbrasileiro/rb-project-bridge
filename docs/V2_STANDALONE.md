# V2 — Standalone Supabase

## Contrato de entrega

Uma operação Standalone somente termina com sucesso quando:

1. a exportação Base44 é preservada localmente em ZIP com hash;
2. um snapshot sanitizado é preparado para o branch `base44-source`;
3. o runtime Base44 é removido do `main`;
4. entidades viram migrations PostgreSQL/RLS;
5. o adapter Supabase/demo é gerado;
6. o gate de independência passa;
7. o build demo passa numa cópia isolada;
8. o `dist` é guardado em `preview` e pode ser aberto pelo Bridge;
9. o repositório GitHub é criado e confirmado como privado;
10. `main` e `base44-source` são publicados.

## Limites seguros

Funções personalizadas são preservadas e recebem um wrapper 501 até revisão. O Bridge não inventa lógica de pagamentos, webhooks, IA ou integrações críticas. Esses itens aparecem no relatório como bloqueadores de produção, mas não impedem a validação visual e estrutural local.

## Preview local

O build usa `npm run build:demo`. O adapter opera em modo localStorage e usuário demo quando não há URL/chave Supabase. Isso permite validar rotas e telas sem banco remoto. A conexão real é feita posteriormente usando `.env.local` e o scaffold Supabase gerado.
