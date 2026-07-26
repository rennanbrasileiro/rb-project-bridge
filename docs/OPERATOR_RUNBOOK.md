# Runbook do Operador

## Antes do atendimento

1. Instale a versão assinada do RB Project Bridge.
2. Garanta conexão estável com a internet.
3. Crie uma pasta de entrega específica para o cliente.
4. Confirme identidade e autorização do proprietário do projeto.
5. Explique que banco, usuários, secrets e storage não fazem parte da exportação básica.

## Durante a migração

1. O cliente conecta a própria conta Base44 pelo navegador.
2. O cliente conecta a própria conta GitHub pelo navegador.
3. Selecione o projeto correto e confira o App ID.
4. Crie o repositório como privado, salvo autorização expressa para público.
5. Mantenha a validação de build desativada quando não houver necessidade.
6. Marque a autorização do proprietário.
7. Execute a migração e acompanhe os gates.

## Em caso de bloqueio por segredo

1. Não force a publicação.
2. Abra o relatório local.
3. Localize arquivo e linha indicados.
4. Remova ou substitua o segredo na cópia de trabalho.
5. Revogue a credencial exposta na plataforma de origem.
6. Reinicie a migração para um novo repositório.

## Entrega ao cliente

Entregue:

- URL do repositório.
- SHA do primeiro commit.
- ZIP original e arquivo `.sha256`.
- Relatório JSON/Markdown.
- Declaração clara do que ficou pendente.

## Encerramento

1. Desconecte Base44 e GitHub quando o computador não for exclusivo do cliente.
2. Transfira o backup por canal seguro.
3. Apague cópias temporárias conforme contrato.
4. Registre aceite da entrega.
