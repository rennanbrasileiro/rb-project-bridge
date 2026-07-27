# Recuperação de branches de revisão

## Problema corrigido na 0.4.1

Versões anteriores inicializavam a branch `bridge/base44-refresh-*` como um histórico Git independente. O código, o preview e o pacote eram preservados, mas o GitHub não conseguia abrir um pull request contra `main` porque as branches não possuíam ancestral comum.

## Comportamento atual

Ao publicar uma entrega por revisão, o Bridge:

1. preserva a `main` e a `base44-source` anteriores;
2. verifica se a branch de revisão solicitada já existe;
3. preserva a branch existente e reserva uma sucessora datada quando necessário;
4. busca a branch principal do destino;
5. cria o commit convertido tendo a principal como ancestral;
6. envia a nova branch sem `force`;
7. abre o pull request usando a branch realmente publicada.

## Recuperar uma operação da 0.4.0

1. Instale a versão 0.4.1 sobre a versão anterior.
2. Abra o mesmo projeto e mantenha a mesma pasta de entrega.
3. Use **Continuar do ponto salvo**.
4. Não reexporte a Base44 e não gere uma operação nova.
5. A branch anterior permanecerá intacta e uma nova branch comparável será criada.
6. O pull request deve permanecer em rascunho até a homologação correspondente ao pacote contratado.

A retomada reutiliza exportação, conversão, build, preview, backup e pacote já preservados no checkpoint local.
