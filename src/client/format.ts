const civilDate = new Intl.DateTimeFormat("pt-PT", {
  timeZone: "Europe/Lisbon",
  day: "numeric",
  month: "long",
  year: "numeric",
})

export function formatCivilDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return civilDate.format(date)
}
