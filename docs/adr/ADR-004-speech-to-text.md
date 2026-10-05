# ADR-004 — Speech-to-Text

## Context

A família tem de poder tocar no microfone e dizer um abastecimento, com valores e nomes, em português europeu ou do Brasil. O STT não pode dominar a fatura. O Safari no iPhone é o cliente principal. Streaming, Whisper no aparelho e a Web Speech API foram considerados.

## Options

- Gravar no browser (`audio/mp4`, até 60 s) e transcrever com `@cf/openai/whisper-large-v3-turbo` ($0,0005 por minuto, 46,63 neurónios por minuto).
- `gpt-4o-mini-transcribe` da OpenAI ($0,003 por minuto) como caminho principal.
- Web Speech API.
- Whisper local no telemóvel (WASM ou equivalente).
- Streaming para um modelo em tempo real (~$0,017 por minuto nos modelos live da OpenAI).

## Decision

Gravar, enviar, transcrever com Whisper large v3 turbo no Workers AI. A transcrição aparece editável antes da interpretação. Áudios abaixo de ~0,4 s descartam-se. O áudio não fica guardado depois da transcrição aceite. Retry usa o mesmo `client_message_id`.

`gpt-4o-mini-transcribe`, via AI Gateway BYOK, só entra se o conjunto de avaliação falhar em números, PT-PT, lojas ou modelos de carro. Não se transcreve duas vezes por defeito.

## Pros

- Custo de cêntimos mesmo a 100 áudios curtos por dia (~$0,50 por mês).
- O mesmo caminho de interpretação do texto, depois da transcrição.
- Formato compatível com o Safari iOS.
- O áudio não se torna mais um arquivo sensível.

## Cons

- Sem resultado parcial enquanto a pessoa fala. Para frases curtas, a espera depois de soltar o botão é o que conta (meta: menos de 5 s).
- Qualidade em ambiente ruidoso e em numerais por extenso fica por medir.

## Risks

Whisper a trocar “setenta” ou a matrícula. Mitigação: edição antes de gravar o facto, e o eval. Esgotar os 10.000 neurónios diários num dia de muita voz. Mitigação: teto de 60 s e, se for recorrente, Workers Paid, onde o excesso se paga em vez de cortar o serviço até à meia-noite UTC.

## Exit strategy

`transcribe` está na interface do provedor. Mudar de modelo de voz não muda o chat nem os eventos. A Web Speech API pode reavaliar-se se o Safari a tornar estável e privada o suficiente; hoje não é o caminho.
