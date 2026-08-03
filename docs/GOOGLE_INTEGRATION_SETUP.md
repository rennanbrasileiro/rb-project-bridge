# Google Workspace Gateway — configuração operacional

O RB Project Bridge suporta várias contas Google simultaneamente. Cada conta concede OAuth separadamente e recebe um registro próprio no cofre criptografado do sistema operacional.

## 1. Criar o projeto Google Cloud

1. Crie ou selecione um projeto Google Cloud sob custódia da RB HUB.
2. Configure a tela de consentimento OAuth.
3. Enquanto o aplicativo for de uso interno, mantenha-o em modo de teste e cadastre como usuários de teste:
   - `rennanbrasileiro@gmail.com`
   - `rbhubsolucoes@gmail.com`
4. Crie um OAuth Client ID do tipo **Aplicativo para computador**.
5. Copie o Client ID para o painel Google Workspace do Bridge. O Client Secret, quando fornecido pelo arquivo JSON do Google, é aceito e armazenado criptografado.

> Atenção operacional: em um aplicativo OAuth externo com status **Teste**, refresh tokens que incluem escopos além de perfil básico normalmente expiram em sete dias. Para uso contínuo, publique o aplicativo e conclua as verificações aplicáveis ou use uma organização Google Workspace/Cloud Identity com a configuração corporativa adequada.

## 2. Habilitar APIs

Habilite no mesmo projeto:

- Gmail API
- Google Drive API
- Google Docs API
- Google Sheets API
- Google Slides API
- Google Calendar API
- People API
- Generative Language API, quando usar a Gemini Developer API
- Discovery Engine API, quando contratar o Gemini Notebook Enterprise

## 3. Escopos usados

O Bridge usa autorização incremental e permite escolher serviços por conta.

- Perfil: `openid`, `email`, `profile`
- Gmail: `gmail.modify`, `gmail.send`
- Drive e documentos: `drive`, `documents`, `spreadsheets`, `presentations`
- Agenda: `calendar`
- Contatos: `contacts`
- Gemini Notebook Enterprise: `cloud-platform`

Escopos amplos do Gmail e Drive podem exigir verificação do aplicativo antes de distribuição pública. Para uso privado em modo de teste, limite o consentimento aos usuários de teste da RB HUB.

## 4. Segurança

- O fluxo usa Authorization Code + PKCE e callback loopback em `127.0.0.1`.
- O Bridge solicita acesso offline para obter refresh token.
- Tokens e configurações sensíveis são criptografados pelo `safeStorage` do Electron.
- Se o cofre seguro do sistema estiver indisponível, a gravação é bloqueada; não existe fallback em texto puro.
- Senhas Google nunca são recebidas pelo aplicativo.
- O repositório não deve conter OAuth Client Secret, refresh token, service role ou API key.
- Ao remover uma conta, o Bridge tenta revogar o token no Google e apaga o registro local.

## 5. Contas múltiplas

Use **Adicionar conta Google** uma vez para cada identidade. O parâmetro `prompt=consent select_account` força o Google a apresentar o seletor de contas, permitindo manter pessoal e empresarial ao mesmo tempo.

Rótulos recomendados:

- `Pessoal` — `rennanbrasileiro@gmail.com`
- `RB HUB` — `rbhubsolucoes@gmail.com`

## 6. Limitações antes da publicação pública

A integração fica funcional para usuários de teste assim que as APIs e o OAuth Client ID forem configurados, porém a expiração de sete dias torna esse modo inadequado para sincronização permanente. Para oferecer o recurso a clientes externos ou operar sem reconexão semanal, será necessário concluir:

- política de privacidade e termos de uso;
- domínio verificado;
- publicação e revisão dos escopos sensíveis/restritos pelo Google;
- avaliação de segurança, quando exigida;
- processo de exclusão e exportação de dados;
- contrato de tratamento de dados e registro de auditoria.
