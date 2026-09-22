# Build status — RB Project Bridge

## v0.6.0-alpha.2

**Estado:** piloto Cloud tecnicamente pronto para homologação funcional com Agile Hub; hospedagem externa bloqueada apenas por quota das contas atuais.

### Validado automaticamente

- Sintaxe do desktop e dos módulos Cloud.
- Suíte automatizada existente do Bridge.
- Provider GitLab e helpers Cloud.
- Dashboard web do piloto.
- Build completo da imagem `Dockerfile.cloud`.
- Container real iniciado no CI com chaves efêmeras.
- `/health` aprovado no container.
- Dashboard `/` servido pelo container.
- `/v1/capabilities` autenticado e confirmando GitLab + worker embutido.
- Workflow `Bridge Cloud CI` aprovado no branch `feat/bridge-cloud-v0.6`.
- Workflow desktop existente continua aprovado.

### Fluxo do primeiro piloto

Base44 → OAuth Device Flow → seleção Agile Hub → exportação → snapshot → transformação standalone Supabase → build isolado → Chromium headless → GitLab privado (`base44-source` + `main`) → pacote de entrega.

### Hospedagem

A imagem está pronta para host Docker com Chromium e Git.

- Railway: recusou projeto novo e serviço novo por `Free plan resource provision limit exceeded`; nenhum serviço existente foi alterado.
- Replit: app isolada criada, mas publicação bloqueada porque a conta atingiu o máximo de Autoscale deployments.

A preview Replit não foi considerada evidência de homologação porque não foi possível confirmar o runtime de forma confiável enquanto o Agent permanecia ocupado. O branch GitHub/CI é a fonte da verdade do piloto.

### Não declarar produção ainda

Ainda faltam as evidências reais do Agile Hub:

- autorização Base44 concluída no Cloud;
- exportação real;
- transformação/build/runtime do projeto real;
- publicação GitLab;
- revisão do relatório e das dependências convertidas/emuladas;
- homologação de dados, usuários, integrações e deploy antes de desligar a Base44.
