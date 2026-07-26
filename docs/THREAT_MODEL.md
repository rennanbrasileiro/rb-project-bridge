# Threat Model

## Ativos protegidos

- Código-fonte do cliente.
- Tokens Base44 e GitHub.
- Secrets presentes acidentalmente no projeto.
- Repositórios privados.
- Relatórios e backups locais.

## Ameaças tratadas

### Exposição acidental de segredo

Mitigação: remoção de arquivos `.env`, geração de exemplo vazio, scanner bloqueante, redaction de logs e repositório privado por padrão.

### Path traversal ou links maliciosos

Mitigação: extração com paths preservados desabilitados, validação da árvore, rejeição de symlinks e arquivos especiais.

### Exportação excessiva

Mitigação: limite de 1 GB e 50 mil arquivos.

### Renderer comprometido

Mitigação: `nodeIntegration=false`, `contextIsolation=true`, CSP local, bloqueio de navegação e API IPC allowlisted.

### Execução de código durante build

Mitigação: build desabilitado por padrão, consentimento explícito, instalação com `--ignore-scripts` e execução em uma cópia temporária descartável. O script `build` ainda é código do projeto e deve ser executado apenas em projeto autorizado. Para ambientes hostis, usar sandbox/VM dedicada.

### Roubo de credenciais por logs ou contas globais

Mitigação: logger JSON com redaction de campos e padrões de token; HOME, configuração Base44, configuração GitHub e configuração global do Git ficam isoladas no diretório do aplicativo; o push recebe o token apenas em variável de ambiente efêmera e usa `GIT_ASKPASS`.

## Riscos residuais

- As sessões Base44 e GitHub permanecem no diretório do aplicativo até o operador usar a função de desconexão.
- Dependências do projeto podem conter código malicioso se o build for autorizado.
- O instalador sem assinatura de código pode gerar alerta do Windows SmartScreen.
- A API de exportação do Base44 está em beta e pode mudar.
- Dados, usuários, storage e integrações não são migrados pelo MVP.

## Requisitos antes de venda pública

- Assinar digitalmente o instalador Windows.
- Publicar política de privacidade e termos do serviço.
- Confirmar por escrito a permissão de uso comercial do fluxo Base44.
- Implantar telemetria somente opt-in e sem código/credenciais.
- Fazer pentest independente.
- Adicionar sandbox isolado para builds.
