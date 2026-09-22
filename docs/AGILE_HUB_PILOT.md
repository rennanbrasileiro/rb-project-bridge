# Agile Hub — primeiro piloto real do RB Project Bridge Cloud

## Objetivo

Executar a primeira retirada real de um produto Base44 pelo Bridge Cloud, usando o Agile Hub como caso piloto e GitLab como destino.

## Fluxo esperado

1. Abrir o dashboard hospedado do Bridge Cloud.
2. Informar a chave de acesso do piloto.
3. Autorizar a Base44 por Device Flow.
4. Confirmar que o Agile Hub aparece na lista de projetos.
5. Conectar o GitLab com token `api` + `write_repository`.
6. Usar o namespace desejado e criar/reutilizar `agile-hub` como projeto privado.
7. Executar em modo `standalone-supabase` com pacote `workspace`.
8. Acompanhar exportação, sanitização, transformação, build, Chromium e publicação.
9. Confirmar `base44-source` e `main` no GitLab.
10. Baixar o ZIP final pelo dashboard.
11. Revisar relatórios e blockers antes de qualquer corte da Base44.

## Critérios de GO técnico do piloto

- Base44 original permanece intacta.
- Exportação termina sem segredo bloqueante.
- Snapshot possui checksum e é preservado.
- Gate de independência Base44 é executado.
- Build standalone é aprovado.
- Chromium headless encontra conteúdo renderizado no `#root`.
- GitLab recebe repositório privado, `base44-source` e `main`.
- Pacote de entrega é baixável.
- Nenhum token aparece no repositório ou relatório.

## Depois do GO técnico

O resultado ainda não deve ser chamado de produção. Abrir a aplicação migrada e homologar:

- autenticação e perfis;
- entidades/CRUD;
- permissões e RLS;
- dados históricos;
- arquivos/storage;
- funções e integrações;
- comportamento do GitLab já existente no próprio Agile Hub;
- deploy, domínio, observabilidade e rollback.

Somente depois dessas evidências considerar o desligamento da Base44.

## Resultado esperado do primeiro ciclo

Ao final do primeiro ciclo devemos ter evidência concreta para separar três grupos:

1. **convertido automaticamente** — funciona fora da Base44 sem intervenção;
2. **convertido com ajuste** — Bridge identificou e corrigimos de forma genérica;
3. **bloqueador específico** — contrato Base44/integrador ainda sem adapter independente.

Todo item do grupo 2 deve, sempre que possível, virar melhoria genérica do Bridge em vez de patch exclusivo do Agile Hub.

## Estado da hospedagem do piloto

O código do `0.6.0-alpha.2` e a imagem Docker estão aprovados pelo CI. O Railway recusou novas provisões por limite do plano da conta, tanto em um projeto novo quanto como serviço isolado dentro de um projeto existente. Nenhum serviço ativo foi alterado.

Uma instância Replit isolada foi criada a partir do mesmo branch, mas a publicação também foi bloqueada pelo limite atual de deployments Autoscale da conta. O bloqueio de teste hospedado neste momento é, portanto, exclusivamente de capacidade de hospedagem da conta; o runtime do piloto permanece versionado, testado e pronto para qualquer host Docker compatível.
