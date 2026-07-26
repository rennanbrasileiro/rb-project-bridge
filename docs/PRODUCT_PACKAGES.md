# Pacotes do RB Project Bridge

O Bridge não deve vender “migração” como um único resultado. Cada operação precisa terminar em um estágio verificável, com evidências, limitações e próxima ação.

## 1. Diagnóstico e Preservação

**Objetivo:** retirar o risco de dependência exclusiva da Base44 e preservar o ativo técnico.

### Entregáveis

- exportação original imutável;
- backup ZIP com SHA-256;
- snapshot sanitizado em branch própria;
- inventário de entidades, funções, integrações e dependências;
- relatório de riscos e segredos;
- histórico e branches anteriores preservados.

### Critério de aceite

O código original pode ser recuperado e auditado, mas não há compromisso de execução independente.

## 2. Sandbox Executável

**Objetivo:** permitir demonstração, avaliação visual e evolução do front-end fora da Base44.

### Entregáveis

- tudo do pacote de Preservação;
- runtime Base44 removido;
- adapter standalone;
- entidades mapeadas para Supabase;
- modo demo com dados temporários no navegador;
- build isolado;
- preview validado em Chromium;
- inventário de contratos convertidos, encaminhados, emulados e bloqueados.

### Critério de aceite

A aplicação abre, monta o React, permite navegação e não apresenta erro fatal no fluxo inicial. Dados reais, autenticação, pagamentos e integrações podem continuar simulados.

## 3. Workspace Evolutivo

**Objetivo:** entregar um repositório que uma equipe consiga abrir, alterar e testar com banco local independente.

### Entregáveis

- tudo do Sandbox;
- scripts de preparação do Supabase local;
- Docker e migrations documentados;
- `.env.local` gerado com credenciais locais;
- reset e geração de tipos;
- documentação para VS Code, Dev Containers, Codespaces ou plataforma Git compatível;
- matriz de funcionalidades e pendências;
- validação de CRUD, autenticação e políticas RLS no ambiente local.

### Critério de aceite

Uma máquina limpa, com Node e Docker, consegue iniciar front-end e banco local seguindo comandos documentados. Funcionalidades selecionadas persistem dados fora da Base44.

## 4. Migração Completa e Homologação

**Objetivo:** substituir a Base44 como ambiente operacional.

### Entregáveis

- tudo do Workspace;
- migração dos registros reais;
- migração ou recriação de usuários e autenticação;
- storage e arquivos;
- secrets e integrações externas;
- conversão das funções de backend;
- pagamentos, webhooks e jobs;
- observabilidade e logs;
- implantação no destino escolhido;
- domínio, DNS, backup e rollback;
- roteiro e evidências de homologação.

### Critério de aceite

Os fluxos críticos definidos em contrato funcionam no ambiente de destino com dados e integrações reais, e o sistema não depende do runtime Base44.

## O que a plataforma automatiza

| Capacidade | Automação atual |
|---|---|
| Preservação | Completa |
| Desacoplamento estrutural | Completa para os padrões reconhecidos |
| Sandbox e validação Chromium | Completa quando todos os contratos usados possuem tratamento |
| Workspace Supabase local | Preparado automaticamente; validação depende de Docker na máquina |
| Dados, usuários e storage reais | Projeto específico |
| Funções e integrações de negócio | Inventariadas; conversão depende do contrato de cada função |
| Produção e homologação | Projeto específico com critérios definidos |

## Regra comercial

A proposta ao cliente deve informar:

1. estágio contratado;
2. funcionalidades incluídas;
3. contratos Base44 emulados ou ainda não suportados;
4. integrações que exigem credenciais ou revisão;
5. dados que serão ou não migrados;
6. critérios objetivos de aceite;
7. valor e prazo para avançar ao estágio seguinte.

A nota de prontidão gerada pelo Bridge é uma evidência técnica, não substitui a homologação funcional do cliente.
