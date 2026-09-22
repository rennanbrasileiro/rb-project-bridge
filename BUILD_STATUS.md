# Build status — RB Project Bridge

## v0.6.0-alpha.2

**Estado:** piloto Cloud pronto para homologação funcional com Agile Hub.

### Validado automaticamente

- Sintaxe do desktop e dos módulos Cloud.
- Suíte automatizada existente do Bridge.
- Provider GitLab e helpers Cloud.
- Dashboard web do piloto.
- Build completo da imagem `Dockerfile.cloud`.
- Workflow `Bridge Cloud CI` aprovado no branch `feat/bridge-cloud-v0.6`.
- Workflow desktop existente continua aprovado.

### Fluxo do primeiro piloto

Base44 → OAuth Device Flow → seleção Agile Hub → exportação → snapshot → transformação standalone Supabase → build isolado → Chromium headless → GitLab privado (`base44-source` + `main`) → pacote de entrega.

### Hospedagem

A imagem está pronta para host Docker com Chromium e Git. A tentativa de provisionamento Railway foi bloqueada pelo limite atual do plano da conta, sem alterar serviços existentes. Uma instância Replit isolada está sendo preparada como alternativa para o primeiro teste.

### Não declarar produção ainda

Ainda faltam as evidências reais do Agile Hub:

- autorização Base44 concluída no Cloud;
- exportação real;
- transformação/build/runtime do projeto real;
- publicação GitLab;
- revisão do relatório e das dependências convertidas/emuladas;
- homologação de dados, usuários, integrações e deploy antes de desligar a Base44.
