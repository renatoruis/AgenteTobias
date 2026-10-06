export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export const KIND_LABEL: Record<string, string> = {
  vehicle: "Carro",
  merchant: "Loja",
  appliance: "Eletrodoméstico",
  place: "Lugar",
  person: "Pessoa",
  pet: "Animal",
  document: "Documento",
  other: "Outro",
}

export const ROLE_LABEL: Record<string, string> = {
  owner: "Dono",
  adult: "Adulto",
  member: "Membro",
  child: "Criança",
}

export const TYPE_LABEL: Record<string, string> = {
  expense: "Despesas",
  income: "Receitas",
  purchase: "Compras",
  "vehicle.fuel": "Abastecimentos",
  "vehicle.maintenance": "Manutenção",
  warranty: "Garantias",
  "object.location": "Onde está",
  reminder: "Lembretes",
  incident: "Incidentes",
  note: "Notas",
}

export const ERROR_TEXT: Record<string, string> = {
  nome: "Esse nome não serve.",
  existe: "Esse nome já existe.",
  dados: "Dados inválidos.",
  proibido: "Só o dono faz isso.",
  indisponivel: "Falhou. Tente de novo.",
  telefone: "Esse telefone não serve.",
  url: "O link precisa começar com http:// ou https://.",
  dono: "O dono da casa não pode ser removido.",
}

export function errorText(code: string | undefined): string {
  if (!code) return ""
  return ERROR_TEXT[code] ?? ""
}
