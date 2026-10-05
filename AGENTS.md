# AgenteTobias — instruções para agents

Ler por esta ordem, antes de escrever código:

1. [docs/requirements/README.md](docs/requirements/README.md) — o teu pacote, os ficheiros que podes tocar, os que não podes.
2. [docs/requirements/00-contract.md](docs/requirements/00-contract.md) — rotas, JSON, tabelas, tipos. Não inventar campos.
3. [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md) — conta, domínio, recursos já criados, o que é de outro projeto.
4. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — porquê. Se um requisito e a arquitetura divergirem, o requisito ganha no detalhe de implementação e a arquitetura ganha no desenho.

Host: `https://tobias.timdevops.com.br`.

Código, tabelas, rotas e tipos em inglês. Texto que a família lê em português de Portugal.

Um agent implementa um pacote. Não “ajuda” noutro pacote editando ficheiros alheios. Se falta uma função, o nome já está no contrato: implementa a tua e deixa a chamada no sítio combinado.

Não fazer commit, push, nem deploy para produção sem pedido explícito de quem gere o repositório. Preview local com Wrangler é permitido ao pacote de plataforma.

Não criar recursos Cloudflare com outro nome. Não tocar em Workers, D1 ou buckets que não estejam em `docs/CLOUDFLARE.md`.
