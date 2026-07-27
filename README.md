# RB Project Bridge

Aplicativo desktop da RB HUB para retirar produtos de plataformas limitadas, preservar o ativo, normalizar o código em um workspace GitHub-first, verificar o funcionamento real e conduzir defeitos, retestes, handoff e corte.

## Versão atual — 0.6.0

A v0.6 corrige as lacunas encontradas no piloto real do FitHub. O Bridge deixa de considerar “frontend exportado + build aprovado” como migração funcional e passa a exigir evidências vigentes de runtime, banco, autenticação, CRUD e RLS.

A regra central é:

> **A tentativa mais recente prevalece. Uma reprovação posterior invalida aprovações anteriores até que um novo reteste seja aprovado.**

## O que mudou

### Evidência confiável

Cada tentativa passa a ser registrada em um ledger append-only com:

- gate e ambiente;
- versão do código;
- início e fim;
- estado `passed`, `failed`, `blocked` ou `skipped`;
- evidências, erros e artefatos;
- executor.

Uma falha atual de build, runtime, independência ou segurança bloqueia publicação e merge, mesmo quando existe um checkpoint antigo aprovado.

### Reprovação acionável

As validações possuem estados distintos:

- pendente;
- aprovado;
- reprovado;
- bloqueado;
- não aplicável.

Uma reprovação exige comportamento esperado, observado, passos para reprodução, severidade e evidência. O Bridge cria um defeito rastreável com responsável e ciclo:

```text
open → in_progress → ready_for_retest → resolved
```

O defeito só é resolvido por novo reteste aprovado ou por aceitação formal de risco.

### Workspace funcional real

Todo workspace Supabase gerado recebe:

- trigger automático para criar `profiles` após o cadastro do usuário;
- migration de infraestrutura de verificação;
- tabela smoke protegida por RLS;
- script `scripts/rb-verify-workspace.mjs`;
- comando `npm run rb:verify`;
- relatório `RB-FUNCTIONAL-VERIFICATION.json`.

Na aplicação desktop, o botão **Testar banco, login e CRUD** executa automaticamente:

1. inicialização do Supabase local;
2. reaplicação de migrations em banco limpo;
3. criação de dois usuários temporários;
4. login real com e-mail e senha;
5. criação automática dos profiles;
6. criação, leitura, alteração e exclusão de registro;
7. bloqueio de leitura anônima;
8. isolamento RLS entre usuários;
9. limpeza dos dados temporários.

Nenhuma senha, service role key ou token é persistido no relatório.

## GitHub é o ativo canônico

O Bridge não migra “para outra plataforma”. Ele normaliza o produto para um repositório privado, independente e verificável. Depois disso, o projeto pode continuar em:

- IDE local ou agente de código;
- Emergent, quando o projeto puder ser importado pelo GitHub;
- Bolt, quando o projeto puder ser importado pelo GitHub;
- Lovable apenas quando já existir vínculo compatível com o repositório, pois a plataforma não funciona hoje como destino universal para qualquer repositório arbitrário;
- infraestrutura própria ou provedores de deploy.

## Plataformas e conectores

A arquitetura possui um contrato `SourceAdapter` para tratar origens diferentes sem fingir que todas exportam os mesmos recursos.

| Origem | Código | GitHub | Backend/dados | Estado no Bridge |
|---|---|---|---|---|
| Base44 | Exportação/eject | Sincronização | Exportação e migração separadas | Piloto implementado |
| Lovable | GitHub sync | Exporta, mas não importa qualquer repo como projeto novo | Migração manual quando usa Lovable Cloud | Matriz e contrato preparados |
| Emergent | GitHub | Importa branch/repositório | Depende da stack | Matriz e contrato preparados |
| Bolt | GitHub ou download | Importa repositório | Depende de Bolt DB ou Supabase | Matriz e contrato preparados |
| GitHub | Nativo | Ativo canônico | Descoberta por inspeção | Preparado |
| ZIP/pasta | Fornecido | Bridge publica | Descoberta por inspeção | Preparado |

A segunda origem só será implementada de ponta a ponta depois que o FitHub concluir o gate funcional real.

## Pacotes comerciais

1. **Diagnóstico e preservação** — backup, snapshot, inventário e plano de saída.
2. **Sandbox executável** — aplicação navegável fora da origem, validada em Chromium.
3. **Workspace evolutivo** — repositório modificável com banco, migrations e verificador funcional.
4. **Migração completa e homologação** — substituição da origem com dados, usuários, storage, integrações, implantação, aceite e rollback.

O Bridge separa três decisões:

- **Merge do workspace** — exige evidência técnica vigente e ausência de defeito bloqueante.
- **Handoff do pacote** — exige todos os itens contratados homologados e nenhum defeito aberto.
- **Produção** — exige ambiente, dados, integrações, aceite funcional e rollback aprovados.

## Pontuação de prontidão

A pontuação deixa de premiar apenas preparação estrutural:

- até **80/100**: workspace funcional preparado, mas banco e login ainda não testados;
- até **90/100**: Supabase, autenticação, CRUD e RLS aprovados;
- **100/100**: escopo de produção, implantação e aceite concluídos, sem defeitos abertos.

Runtime reprovado limita a nota; achado de segurança ou defeito crítico também reduz a prontidão.

## Fluxo de ponta a ponta

1. Conectar origem e GitHub.
2. Descobrir capacidades e limitações da origem.
3. Selecionar pacote e escopo realistas.
4. Preservar código, snapshot e metadados.
5. Normalizar para o workspace canônico.
6. Compilar e validar o runtime visual.
7. Preparar o ambiente de destino.
8. Executar **Testar banco, login e CRUD**.
9. Corrigir defeitos no workspace GitHub-first.
10. Recriar preview e retestar apenas os gates afetados.
11. Publicar ou atualizar o PR somente com evidência vigente aprovada.
12. Migrar dados, usuários, arquivos e integrações contratados.
13. Implantar homologação.
14. Executar aceite funcional e rollback.
15. Regenerar ZIP, checksum e pacote final.
16. Transferir custódia e desligar a origem somente depois do corte aprovado.

## Comandos padronizados do workspace

```bash
npm run rb:demo       # sandbox visual
npm run rb:workspace  # evolução com ambiente conectado
npm run rb:verify     # Supabase, login, profiles, CRUD e RLS
npm run rb:package    # build do produto
```

## Artefatos da entrega

- repositório GitHub privado;
- backup e snapshot verificáveis;
- ZIP e SHA-256;
- preview local;
- `RB-BRIDGE-REPORT.json` e `.md`;
- `RB-MIGRATION-READINESS.json` e `.md`;
- `RB-FUNCTIONAL-VERIFICATION.json`;
- ledger de verificações;
- defeitos e histórico de retestes;
- `CLIENT_DELIVERY/CLIENT_DELIVERY_MANIFEST.json`;
- checklist, handoff, blueprint, backlog e plano de execução;
- `PILOT_EXTENSION_REQUEST.json` para incorporar obstáculos reutilizáveis ao núcleo.

## Segurança

- secrets não entram no repositório, ZIP, log ou evidência;
- service role só existe em memória durante o teste local;
- repositórios são privados por padrão;
- branches anteriores são preservadas;
- o backup original não é alterado;
- contas de produção devem ficar sob custódia do cliente;
- credenciais são entregues por cofre ou canal seguro.

## Limite do MVP

O Bridge é o plano de controle de portabilidade, verificação e entrega. Ele não é IDE, editor visual nem executor arbitrário de chaves. O código evolui no workspace e no GitHub; o Bridge captura, verifica, registra defeitos, retesta e empacota.

O MVP comercial será considerado congelado quando o FitHub concluir, pelo próprio Bridge, preview vigente, Supabase local, migrations, usuário temporário, login, profiles, CRUD e RLS; uma falha abrir defeito e bloquear entrega; a correção puder ser retestada sem nova exportação; e o pacote final refletir somente evidências vigentes.

Consulte [PRODUCT_COMPLETION_PLAN_V0.6.md](docs/PRODUCT_COMPLETION_PLAN_V0.6.md) para o plano completo.

## Desenvolvimento

Requisitos: Node.js 20.19 ou superior e Windows 10/11, Linux ou macOS.

```bash
npm install
npm run check
npm start
```

O pipeline valida sintaxe, regressões do FitHub, script gerado, adapters, prontidão, pacote, instalador Windows, OAuth no executável e checksums.

## Licença

Uso interno da RB HUB neste estágio. Antes da comercialização pública, definir licença, política de privacidade, termos, SLA, tratamento de dados e assinatura de código do instalador.
