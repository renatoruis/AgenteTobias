# AgenteTobias — instruções para agents

Ler antes de escrever código:

1. [docs/adr/ADR-013-mcp-web.md](docs/adr/ADR-013-mcp-web.md) — a base no Worker, a web de gestão, o MCP como cliente.
2. [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md) — conta, domínio, recursos já criados, o que é de outro projeto.

Host: `https://tobias.timdevops.com.br`.

Código, tabelas, rotas e tipos em inglês. Texto que a família lê em português do Brasil. O fuso é Europe/Lisbon e a moeda é EUR.

Não fazer commit, push, nem deploy para produção sem pedido explícito de quem gere o repositório.

Não criar recursos Cloudflare com outro nome. Não tocar em Workers, D1 ou buckets que não estejam em `docs/CLOUDFLARE.md`.
