# Handoff para Gemini e Gemini Notebook Enterprise

## Produtos diferentes

1. **Google AI Pro** é uma assinatura de usuário para os aplicativos do Gemini/NotebookLM. Ela não substitui o faturamento da Gemini Developer API.
2. **Gemini Developer API** usa chave de API e cobrança/quota próprias. O Bridge guarda a chave no cofre local e permite testar um modelo configurado.
3. **Gemini Notebook Enterprise** é um produto Google Cloud separado, com IAM, licença e projeto próprios. A API está em prévia e deve ser tratada como integração opcional.

## Configuração Gemini Developer API

1. Crie a chave no Google AI Studio ou no projeto Google Cloud escolhido.
2. Restrinja a chave quando o ambiente permitir.
3. Informe a chave no painel do Bridge.
4. Defina o modelo desejado. O padrão inicial é `gemini-2.5-flash`.
5. Use **Testar Gemini** apenas depois de conferir cobrança e quotas.

## Configuração Gemini Notebook Enterprise

1. Escolha um projeto Google Cloud sob custódia da RB HUB.
2. Ative a Discovery Engine API.
3. Configure o Gemini Notebook Enterprise.
4. Adquira/ative a assinatura e atribua uma licença ao usuário Google.
5. Conceda os papéis IAM exigidos, ao menos o papel de usuário do Cloud Gemini Notebook; administradores precisam dos papéis administrativos documentados pelo Google.
6. Informe no Bridge:
   - número numérico do projeto;
   - multirregião `global`, `us` ou `eu`;
   - uma conta Google conectada com o serviço `notebook` autorizado.

## Operações preparadas no Bridge

- listar notebooks visualizados recentemente;
- criar notebook;
- adicionar fontes em lote:
  - Google Docs;
  - Google Slides;
  - texto bruto;
  - conteúdo web;
  - vídeo do YouTube;
- enviar arquivos locais compatíveis ao notebook.

## Modelo de organização dos notebooks

- `RB HUB — Governança e visão geral`
- `EcoHub — Produto, arquitetura e operação`
- `Compliance Hub — Produto, banco e evidências`
- `Radar — Contexto e atenção`
- `TimeFlow Pro — Ponto e automações`
- um notebook por cliente, quando houver autorização e separação de dados adequada.

## Regra de sincronização

O catálogo mestre deve conter metadados e links. Dados pessoais, e-mails e documentos de clientes só entram em notebook após classificação, autorização e aplicação das regras de LGPD. A sincronização não deve copiar indiscriminadamente toda a caixa de e-mail.
