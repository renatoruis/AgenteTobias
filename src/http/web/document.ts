import { escapeHtml } from "./text"

const NAV = `<nav>
  <a href="/casa">Casa</a>
  <a href="/estatisticas">Estatísticas</a>
  <a href="/ligacao">API</a>
  <form method="post" action="/sair"><button type="submit">Sair</button></form>
</nav>`

export function documentPage(title: string, body: string, nav: boolean): string {
  return `<!doctype html>
<html lang="pt-PT">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/gestao.css">
<body>
<main>
${nav ? NAV : ""}
${body}
</main>
<script src="/gestao.js"></script>
`
}
