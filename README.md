# RB Project Bridge

Aplicativo desktop para transformar projetos Base44 em entregas independentes, verificáveis e retomáveis: exportação sanitizada, conversão para Supabase, build local, execução validada em navegador, preview navegável e publicação segura em GitHub privado.

## Versão atual — 0.2.6

A v0.2.6 fecha a diferença entre **compilar** e **funcionar**. Depois do build, o Bridge abre o bundle em um Chromium isolado, acompanha erros de JavaScript e confirma que a aplicação realmente montou conteúdo antes de permitir a publicação.

Principais capacidades:

- sessão GitHub reutilizada e cacheada, sem reconexões desnecessárias;
- autorização solicitada somente quando falta uma capacidade real, como `workflow`;
- checkpoints persistentes do início até a entrega;
- retomada exclusiva da publicação quando exportação, conversão e build já passaram;
- preview disponível mesmo quando a entrega externa fica parcial;
- validação do bundle em Chromium, com bloqueio de telas brancas;
- diagnóstico visível no preview quando ocorre erro de execução;
- compatibilidade genérica para assinaturas `base44.entities.*.subscribe`;
- auditoria dos métodos Base44 usados pelo projeto e bloqueio dos ainda não suportados;
- service worker de produção desativado no modo demo para evitar bundles antigos em cache;
- distinção entre snapshot Base44 salvo e aplicação independente realmente entregue;
- preservação automática da branch principal e da origem anterior;
- atualização por pull request quando o GitHub evoluiu depois da última entrega;
- interface operacional em cinco etapas, com resumo, próxima ação e detalhes técnicos recolhidos.

## Fluxo do produto

1. **Conectar contas** — autentica Base44 e GitHub pelo navegador e reutiliza sessões válidas.
2. **Selecionar produto e pasta** — define a origem e o diretório que guardará backup, código convertido, preview e relatório.
3. **Exportar** — baixa ou reaproveita um snapshot Base44 válido, valida a árvore e gera backup ZIP com SHA-256.
4. **Desacoplar** — remove o runtime Base44, gera a aplicação standalone e prepara Supabase, schema, RLS, adapter e modo demo.
5. **Auditar runtime** — identifica métodos Base44 usados pelas telas, aplica compatibilidades conhecidas e bloqueia dependências ainda não convertidas.
6. **Validar** — instala dependências em cópia isolada, executa o build, abre o resultado em Chromium e confirma a renderização do React.
7. **Preservar** — salva a `main` e a `base44-source` anteriores em branches datadas antes de qualquer substituição.
8. **Entregar** — publica o snapshot e a aplicação independente; quando há evolução concorrente, abre uma revisão em vez de sobrescrever a `main`.

## Checkpoints e retomada

Cada operação registra um estado verificável:

- `initialized`
- `exported`
- `converted`
- `ready-to-publish`
- `repository-ready`
- `snapshot-published`
- `delivered`

Somente operações que chegaram a `ready-to-publish` podem oferecer **Continuar do ponto salvo**. A retomada mantém a estratégia original de entrega e não repete exportação, transformação, instalação ou build já aprovados.

## Critério de aprovação do preview

O preview só é considerado aprovado quando:

- o build produz `index.html` e os assets;
- o servidor local consegue entregar o bundle;
- uma janela Chromium isolada carrega a aplicação;
- o elemento `#root` recebe conteúdo renderizado;
- não há erro fatal, rejeição não tratada ou falha principal de carregamento.

Quando um erro escapar para a abertura manual, o preview exibe um painel com a mensagem técnica, em vez de permanecer branco silenciosamente.

## Segurança

- O aplicativo não solicita senhas da Base44 ou do GitHub.
- As sessões ficam isoladas no diretório privado do aplicativo.
- Tokens não são incluídos em URL, commit ou log.
- Logs passam por redaction antes da persistência.
- `.env`, `.git`, caches e artefatos temporários são removidos da cópia publicável.
- Possíveis tokens, chaves privadas e segredos bloqueiam a entrega.
- Symlinks e arquivos especiais bloqueiam a execução.
- Repositórios são privados por padrão e não podem ser publicados como públicos pelo fluxo do produto.
- O backup original nunca é modificado.
- A branch principal existente é preservada antes da atualização.

Leia [THREAT_MODEL.md](docs/THREAT_MODEL.md) antes de uso comercial.

## O que exige etapa adicional

A conversão estrutural não transfere automaticamente:

- registros do banco de dados;
- contas de usuários e sessões;
- valores de secrets;
- autorizações OAuth;
- arquivos armazenados no Base44 Storage;
- domínio, DNS ou configuração de produção;
- funções Base44 cujo código original depende de `context.base44`, secrets ou payloads específicos.

Esses itens devem ser migrados e homologados conforme o ambiente de destino. Quando o projeto usa uma API de runtime ainda não suportada, a operação é interrompida com a identificação do arquivo e do método, em vez de publicar uma aplicação quebrada.

## Desenvolvimento

Requisitos:

- Node.js 20.19 ou superior;
- Windows 10/11, Linux ou macOS.

```bash
npm install
npm run check
npm start
```

## Gerar instalador Windows

```powershell
./scripts/build-windows.ps1
```

O pipeline automatizado executa:

- validação sintática;
- testes automatizados;
- empacotamento instalável e portátil;
- smoke test do OAuth Base44 no executável empacotado;
- geração de SHA-256;
- upload dos artefatos;
- publicação do release candidate após atualização da `main`.

Os artefatos locais são gravados em `release/`.

## Estado da qualidade

A suíte cobre, entre outros pontos:

- autenticação e capacidades GitHub;
- cache e deduplicação de verificações;
- normalização e inteligência de repositórios;
- retries de rede Base44;
- sanitização, redaction e scanner de segredos;
- transformação standalone e gate Supabase;
- compatibilidade de assinaturas em tempo real;
- auditoria de métodos Base44 no código exportado;
- desativação do service worker no modo demo;
- diagnóstico de erros de execução no preview;
- validação da renderização em Chromium;
- preservação de branches;
- checkpoints e retomada segura;
- preview em entrega parcial;
- estratégia por pull request quando o GitHub já evoluiu;
- build em cópia isolada;
- fluxo completo com serviços simulados.

Consulte [OPERATOR_RUNBOOK.md](docs/OPERATOR_RUNBOOK.md) e [BUILD_STATUS.md](BUILD_STATUS.md).

## Licença

Uso interno da RB HUB neste estágio. Antes da comercialização pública, definir licença, política de privacidade, termos do serviço e assinatura de código do instalador.
