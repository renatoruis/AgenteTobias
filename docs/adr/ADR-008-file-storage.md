# ADR-008 — Ficheiros

## Context

Fotos, talões, PDFs, garantias e manuais não podem viver na base. O acesso tem de respeitar o household. Ficheiros órfãos e objetos públicos são o risco principal. OCR fica fora do MVP.

## Options

- Cloudflare R2, metadata no D1, URL temporária.
- Binário em coluna ou em tabela SQLite.
- Disco de terceiros (outro bucket, pasta partilhada).

## Decision

R2. Chave `household/{household_id}/{file_id}`. Linha no D1 com mime, tamanho, sha256, autor e evento. URL temporária emitida pelo Worker depois de verificar sessão, household e visibilidade. Teto 10 MB. Tipos: JPEG, PNG, WebP, PDF. Compressão de imagem no cliente antes do envio.

Anular o último evento que aponta ao ficheiro apaga o objeto. Um cron pode varrer metadata sem evento ativo, quando aparecer o primeiro órfão; não é um serviço à parte no dia um.

O PDF não é lido pelo modelo no MVP.

## Pros

- 10 GB por mês e egress no Free chegam para talões e manuais.
- A base continua pequena.
- Apagar o household é apagar um prefixo e as linhas.
- API de objeto, fácil de copiar na saída.

## Cons

- Dois sítios para manter coerentes (linha e objeto). A ordem é: verificar, gravar objeto, gravar linha; se a linha falhar, apagar o objeto.
- Sem miniatura no MVP. A grelha pode mostrar o mime e o nome até haver uma razão para gerar thumbnails.

## Risks

Bucket público ou URL longa sem verificação. Mitigação: bucket privado e URL curta só depois do check. Upload a servir de veículo de malware. Mitigação: tipo, tamanho, sem execução, sem parser de PDF no servidor. Injeção indireta no dia em que o texto do PDF entrar no prompt. Mitigação: quando isso existir, o texto vai como dado delimitado e não acrescenta tools.

## Exit strategy

Copiar os objetos para outro armazenamento compatível. As chaves e a metadata estão no D1, por isso a lista do que copiar não depende do R2.
