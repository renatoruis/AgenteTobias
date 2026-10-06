import { escapeHtml } from "./text"

export type Section = "casa" | "estatisticas" | "ligacao"

const ITEMS: Array<{ id: Section; href: string; label: string; icon: string }> = [
  {
    id: "casa",
    href: "/casa",
    label: "Casa",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 10.8 12 4.5l7.5 6.3V19a1.2 1.2 0 0 1-1.2 1.2H15v-5.4H9V20.2H5.7A1.2 1.2 0 0 1 4.5 19Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  },
  {
    id: "estatisticas",
    href: "/estatisticas",
    label: "Números",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19.5V12M12 19.5V5.5M19 19.5v-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  },
  {
    id: "ligacao",
    href: "/ligacao",
    label: "Ligação",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.8 13.2a4.2 4.2 0 0 0 5.9.2l1.7-1.7a4.2 4.2 0 0 0-5.9-5.9l-1 1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M14.2 10.8a4.2 4.2 0 0 0-5.9-.2l-1.7 1.7a4.2 4.2 0 0 0 5.9 5.9l1-1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  },
]

function item(current: Section, place: "side" | "tab"): string {
  return ITEMS.map((entry) => {
    const here = entry.id === current ? ` aria-current="page"` : ""
    return `<a href="${entry.href}"${here}>${entry.icon}<span>${entry.label}</span></a>`
  }).join(place === "side" ? "" : "")
}

export function documentPage(title: string, body: string, section: Section | null): string {
  const shell = section
    ? `<div class="app">
<aside class="sidebar">
  <p class="brand">Tobias</p>
  <nav>${item(section, "side")}</nav>
  <form class="sidebar-foot" method="post" action="/sair"><button type="submit">Sair</button></form>
</aside>
<div class="content">
  <div class="topbar"><form method="post" action="/sair"><button type="submit">Sair</button></form></div>
  ${body}
</div>
<nav class="tabbar">${item(section, "tab")}</nav>
</div>`
    : `<main class="gate">${body}</main>`
  return `<!doctype html>
<html lang="pt-PT">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#f2f2f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/gestao.css">
<body>
${shell}
<script src="/gestao.js"></script>
`
}
