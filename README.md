# RB Project Bridge

Aplicativo desktop para exportar projetos Base44, criar um backup verificável, remover arquivos locais sensíveis, bloquear credenciais expostas e publicar o código em um repositório GitHub autorizado pelo proprietário.

## Entrega do MVP

O fluxo implementado é:

1. Autenticação Base44 pelo fluxo oficial da CLI.
2. Listagem dos projetos da conta autorizada.
3. Exportação do pacote-fonte do projeto selecionado.
4. Validação da árvore exportada e limite de tamanho.
5. Backup ZIP com SHA-256.
6. Cópia de trabalho independente.
7. Remoção de `.env`, `.git`, caches e artefatos gerados.
8. Geração de `.env.example` sem valores.
9. Varredura bloqueante de tokens, chaves privadas e segredos.
10. Inventário de entidades, funções, conectores e uso do SDK Base44.
11. Validação estrutural e build opcional mediante consentimento.
12. Autenticação GitHub pelo navegador usando GitHub CLI.
13. Criação de repositório privado ou público.
14. Commit inicial e push para `main`.
15. Relatórios JSON/Markdown e histórico local.

## O que não é migrado automaticamente

- Registros do banco de dados.
- Contas de usuários e sessões.
- Valores de secrets.
- Autorizações OAuth.
- Arquivos armazenados no Base44 Storage.
- Domínio, DNS ou configurações de produção.

Esses elementos exigem uma segunda etapa de migração.

## Segurança

- O aplicativo não solicita senhas do Base44 ou GitHub.
- As sessões Base44 e GitHub ficam isoladas no diretório privado do aplicativo, sem reutilizar as contas globais do computador.
- O push usa credencial efêmera por processo; o token não é incluído na URL do repositório, no commit ou nos logs.
- A desconexão remove os dados locais da sessão correspondente.
- Repositórios são privados por padrão.
- O repositório só é criado depois da varredura de segredos e da validação estrutural.
- Logs passam por redaction antes de serem gravados.
- Symlinks e arquivos especiais bloqueiam a execução.
- O backup original não é alterado.

Leia [THREAT_MODEL.md](docs/THREAT_MODEL.md) antes de uso comercial.

## Desenvolvimento

Requisitos para desenvolvimento:

- Node.js 20.19 ou superior.
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

O script instala dependências, executa os testes, gera as versões portátil e instalável e grava os hashes SHA-256. O comando manual equivalente continua disponível com `npm run dist:win`.

Os artefatos são escritos em `release/`. O workflow `.github/workflows/build.yml` executa testes e gera o instalador em runner Windows.

## Operação

Consulte [OPERATOR_RUNBOOK.md](docs/OPERATOR_RUNBOOK.md).

## Estado da qualidade

Os testes automatizados cobrem:

- normalização de nomes de repositório;
- redaction de logs;
- sanitização de arquivos;
- scanner de segredos;
- inventário Base44;
- bloqueio antes da criação do repositório;
- validação de symlinks;
- geração de relatório e histórico;
- captura segura de credenciais de subprocessos;
- isolamento das sessões do cliente;
- cancelamento e retomada de publicação;
- paginação de organizações GitHub;
- build em cópia isolada sem contaminar o repositório;
- validação de limites e caminhos de retomada;
- fluxo completo com serviços simulados.

O estado exato de homologação está documentado em [BUILD_STATUS.md](BUILD_STATUS.md).

## Licença

Uso interno da RB HUB neste estágio. Antes da comercialização pública, definir licença, política de privacidade, termos do serviço e assinatura de código do instalador.
