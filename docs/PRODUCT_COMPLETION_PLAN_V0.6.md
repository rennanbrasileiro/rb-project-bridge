# RB Project Bridge — Plano de conclusão do produto (v0.6)

## Decisão de produto

O RB Project Bridge não deve prometer uma migração funcional apenas porque exportou o frontend, gerou um adapter, compilou e abriu um preview. A unidade de sucesso do produto passa a ser um **workspace GitHub-first executável, verificável e evolutivo**, com evidências automáticas de backend e fluxos críticos.

GitHub é o ativo canônico. Base44, Lovable, Emergent, Bolt e outras plataformas são conectores de origem e/ou ambientes opcionais de continuidade. O produto migrado deve sobreviver sem depender da plataforma de origem ou do Bridge.

## Problemas confirmados no piloto FitHub

1. O preview demo validou aparência, mas não exercitou autenticação, banco ou dados reais.
2. Uma revalidação posterior falhou em runtime, mas o checkpoint anterior ainda pôde ser publicado.
3. A tela de homologação registra apenas aprovação ou pendência manual; uma reprovação não gera defeito acionável, responsável, reteste ou critério de resolução.
4. O workspace preparado não executa automaticamente um gate de Supabase, migrations, usuário de teste, login, CRUD e RLS.
5. O pacote “migração completa” aparece cedo demais no fluxo, embora o estágio produzido seja apenas workspace preparado.
6. A arquitetura está acoplada à Base44 e precisa de contratos formais para outras origens.

## Princípios obrigatórios

- A evidência mais recente prevalece. Uma falha posterior invalida um passe anterior até novo reteste aprovado.
- “Demo visual”, “workspace conectado”, “homologação funcional” e “produção” são gates diferentes.
- Rejeição é um defeito, não apenas um booleano falso.
- Nenhum gate humano substitui uma verificação automatizável.
- Nenhum adapter específico do cliente deve entrar no núcleo sem contrato e teste de regressão.
- Credenciais nunca entram no repositório, pacote, log ou evidência.
- O Bridge não é uma IDE. Código evolui no repositório; o Bridge orquestra, testa, registra e empacota.

## Arquitetura-alvo

### 1. Source Adapter

Contrato comum para cada plataforma de origem:

- identificar projeto e versão;
- exportar código e assets;
- inventariar backend, entidades, funções, autenticação, storage e integrações;
- exportar dados quando permitido;
- declarar limitações e evidências disponíveis;
- produzir `RB-SOURCE-MANIFEST.json` normalizado.

Adaptadores planejados:

- `base44` — piloto completo;
- `lovable` — GitHub/code export; backend Lovable Cloud ou Supabase tratado separadamente;
- `emergent` — GitHub pull/push e stack FastAPI/MongoDB ou Supabase;
- `bolt` — ZIP/GitHub e Bolt Database/Supabase;
- futuros: Replit, v0, Bubble, FlutterFlow e outros, conforme contrato oficial de exportação.

### 2. Canonical Workspace

Todo projeto deve terminar com:

- repositório GitHub privado;
- `RB-MIGRATION-MANIFEST.json` independente da origem;
- scripts padronizados `rb:demo`, `rb:workspace`, `rb:verify`, `rb:package`;
- `.env.example` sem secrets;
- migrations versionadas;
- matriz de capacidades e lacunas;
- testes automatizados e jornadas funcionais;
- documentação de evolução e deploy.

### 3. Target Adapter

Contrato comum para preparar e verificar destino:

- Supabase local;
- Supabase Cloud;
- backend existente do projeto;
- implantação estática + backend gerenciado;
- blueprint AWS;
- continuidade opcional em Emergent ou Bolt por importação GitHub.

Lovable não é destino universal enquanto não aceitar importar um repositório arbitrário como novo projeto. Pode continuar sendo origem e ambiente de evolução apenas para projetos já vinculados ao próprio repositório.

### 4. Verification Ledger

Registro append-only de tentativas:

- gate;
- início e fim;
- versão do código;
- ambiente;
- status `passed`, `failed`, `blocked` ou `skipped`;
- evidências;
- erros;
- artefatos;
- executor.

A prontidão usa a tentativa efetiva mais recente de cada gate, nunca um booleano histórico solto.

### 5. Defect and Retest Loop

Uma reprovação gera:

- identificador;
- gate e jornada;
- severidade;
- comportamento esperado;
- comportamento observado;
- passos para reproduzir;
- evidência;
- responsável;
- estado `open`, `in_progress`, `ready_for_retest`, `resolved`, `accepted_risk`;
- vínculo com commit/PR;
- histórico de retestes.

O aceite só volta a aprovado quando um reteste posterior fecha o defeito.

## Fluxo final de ponta a ponta

1. Conectar origem e GitHub.
2. Descobrir automaticamente capacidades e limitações da origem.
3. Selecionar resultado desejado; o Bridge recomenda o pacote realista.
4. Preservar código, dados disponíveis e metadados.
5. Normalizar para o workspace canônico.
6. Executar build e runtime visual.
7. Preparar destino real.
8. Executar verificação automática de infraestrutura, migrations, autenticação, CRUD, RLS e storage.
9. Executar jornadas funcionais configuradas.
10. Abrir defeitos para falhas e orientar correção no GitHub/ambiente de evolução.
11. Retestar somente gates afetados.
12. Publicar PR apenas quando os gates mínimos da entrega estiverem verdes.
13. Implantar homologação.
14. Migrar e reconciliar dados, usuários e arquivos.
15. Executar aceite funcional e rollback.
16. Gerar pacote final e liberar corte.

## Entregas da v0.6

### Gate A — Integridade

- ledger de verificações;
- falha mais recente invalida passe anterior;
- retry publish bloqueado quando runtime atual está reprovado;
- painel mostra evidência atual, não histórica;
- regressão do cenário real do FitHub.

### Gate B — Reprovação acionável

- estados completos de homologação;
- formulário de rejeição com esperado, observado, severidade e evidência;
- backlog de defeitos;
- reteste e resolução;
- pacote final bloqueado por defeitos abertos.

### Gate C — Verificação real do workspace

- script padronizado `rb:verify`;
- Supabase local iniciado e migrations aplicadas;
- criação de usuário de teste;
- login com senha e leitura de sessão;
- criação automática de profile;
- CRUD e RLS em entidade segura;
- relatório JSON consumido pelo Bridge;
- botão “Executar testes funcionais”.

### Gate D — Jornadas funcionais

- manifesto de jornadas críticas;
- navegador automatizado com captura de console, erro de página, DOM e screenshot;
- login, navegação e fluxo CRUD do FitHub;
- resultados vinculados ao ledger e aos defeitos.

### Gate E — Multi-origem

- interface `SourceAdapter`;
- Base44 movida para o contrato comum sem regressão;
- conectores de descoberta para GitHub/ZIP;
- perfis documentados para Lovable, Emergent e Bolt;
- matriz de portabilidade exibida antes da operação.

## Critério de MVP congelado

O MVP comercial será considerado completo quando o FitHub puder seguir do código exportado até um ambiente Supabase funcional com usuário de teste, login, CRUD e RLS aprovados automaticamente; uma falha criar defeito e impedir entrega; a correção ser feita no GitHub e retestada sem nova exportação; e o pacote final refletir somente evidências vigentes.

A expansão para uma segunda origem só começa após esse critério estar verde no piloto.
