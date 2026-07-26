# Playbook de entrega ao cliente

Este documento define o processo padrão para vender, executar e entregar uma saída da Base44 sem confundir preservação, sandbox, workspace e migração completa.

## 1. Antes da proposta

Registre:

- proprietário legal e técnico do produto;
- projeto Base44 e ambientes existentes;
- funcionalidades críticas;
- volume e criticidade dos dados;
- perfis de usuário e regras de acesso;
- arquivos e storage;
- funções, webhooks, pagamentos, e-mails e integrações;
- domínio, DNS e ambiente atual;
- destino pretendido;
- data desejada de corte;
- exigências de segurança, LGPD, backup, suporte e SLA.

Sem essas informações, ofereça primeiro **Diagnóstico e preservação**.

## 2. Escolha do pacote

### Diagnóstico e preservação

Use quando o cliente precisa recuperar o ativo, reduzir risco e receber uma avaliação. O aceite comprova backup, snapshot, inventário e plano; não comprova execução.

### Sandbox executável

Use para demonstração, avaliação visual ou evolução inicial. O aceite comprova que a aplicação abre e navega no fluxo inicial sem erro fatal. Dados e integrações podem estar simulados.

### Workspace evolutivo

Use quando o cliente ou uma equipe precisa continuar o desenvolvimento fora da Base44. O aceite exige repositório, scripts, banco local preparado e documentação. A validação funcional do banco deve ser contratada e registrada.

### Migração completa e homologação

Use somente com escopo funcional, ambientes, responsáveis e critérios de aceite definidos. Inclui projeto específico para dados, usuários, storage, backend, integrações, deploy e corte.

## 3. Autorização e segurança

Antes de exportar:

- obtenha autorização expressa do proprietário;
- confirme quais contas podem ser acessadas;
- defina onde o repositório privado ficará;
- defina canal seguro para credenciais;
- registre dados pessoais e sensíveis envolvidos;
- combine retenção e descarte das cópias temporárias.

Nunca solicite ou registre senhas, tokens ou service role dentro do Bridge, do GitHub ou dos relatórios.

## 4. Execução no Bridge

1. Conecte Base44 e GitHub.
2. Informe cliente e responsável pelo recebimento.
3. Selecione o projeto e a pasta de trabalho.
4. Selecione o pacote contratado.
5. Selecione o perfil de destino.
6. Marque os itens previstos no escopo comercial.
7. Escolha ou crie o repositório privado autorizado.
8. Execute a operação.
9. Analise contratos convertidos, encaminhados, emulados e bloqueados.
10. Corrija bloqueadores até alcançar o estágio contratado ou registre a pendência no backlog.

## 5. Evidências automáticas

O Bridge pode comprovar automaticamente:

- integridade do backup por SHA-256;
- ausência de segredos bloqueantes na cópia publicável;
- remoção estrutural das dependências reconhecidas da Base44;
- build em cópia isolada;
- renderização inicial em Chromium;
- inventário dos contratos de runtime;
- preparação do workspace;
- preservação e estratégia segura do GitHub;
- geração do pacote de handoff.

Essas evidências não substituem testes de negócio.

## 6. Homologação funcional

Crie uma matriz com pelo menos:

| Fluxo | Perfil | Dados | Backend | Integração | Ambiente | Evidência | Estado |
|---|---|---|---|---|---|---|---|

Para cada fluxo crítico, valide:

- acesso e autorização;
- navegação;
- CRUD e regras de negócio;
- persistência;
- uploads e downloads;
- e-mails e notificações;
- pagamentos e webhooks;
- jobs e integrações externas;
- comportamento de erro;
- logs e alertas.

## 7. Migração de dados

Defina por escrito:

- origem e destino;
- período histórico;
- campos e transformações;
- chaves e deduplicação;
- dados descartados;
- tratamento de anexos;
- janela de congelamento;
- carga inicial e carga delta;
- totais de reconciliação;
- amostragem e aceite;
- rollback.

Nunca declare dados migrados sem reconciliação documentada.

## 8. Usuários e autenticação

Defina:

- estratégia de recriação ou migração;
- papéis e permissões;
- convite e ativação;
- redefinição de senha;
- OAuth e redirecionamentos;
- SMTP e templates;
- expiração e revogação de sessões;
- contas administrativas de emergência.

Chaves administrativas ficam apenas no backend.

## 9. Implantação

Para produção, registre:

- ambientes de desenvolvimento, homologação e produção;
- proprietário das contas;
- CI/CD e proteção de branches;
- variáveis e cofre de secrets;
- domínio, DNS e TLS;
- banco, migrations e pool de conexões;
- storage e políticas;
- logs, métricas e alertas;
- backup, retenção e restauração;
- custos e limites;
- rollback e plano de incidentes.

O perfil AWS é um blueprint nesta versão. Ele não deve ser vendido como migração automática para Lambda.

## 10. Pacote entregue

Entregue ao cliente:

- acesso ou transferência do repositório privado;
- ZIP e SHA-256;
- snapshot Base44 preservado;
- manifesto do pacote;
- guia de handoff;
- checklist de aceite;
- blueprint de implantação;
- checklist de credenciais;
- backlog de pendências;
- relatório de prontidão;
- matriz de homologação e evidências do escopo contratado.

Credenciais são transferidas separadamente.

## 11. Reunião de handoff

Na reunião final:

1. demonstre o ambiente entregue;
2. percorra os fluxos contratados;
3. apresente a arquitetura;
4. entregue acessos e confirme a custódia;
5. apresente backup e restauração;
6. revise pendências e limitações;
7. defina suporte e responsáveis;
8. colha o aceite formal;
9. combine a data de desligamento da Base44;
10. remova acessos temporários após o corte.

## 12. Regra de encerramento

A operação só deve ser chamada de **migração completa** quando:

- o escopo contratado estiver homologado;
- dados e usuários previstos tiverem evidência de migração;
- storage e integrações previstas funcionarem;
- produção estiver implantada e monitorada;
- backup e rollback tiverem sido testados;
- o cliente tiver assumido a custódia;
- existir aceite formal e plano de desligamento da Base44.

Quando isso não ocorrer, entregue o estágio efetivamente alcançado e mantenha o restante no backlog.
