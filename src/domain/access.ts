import type { Role, Visibility } from "./types"

export function canRead(
  role: Role,
  visibility: Visibility,
  actorId: string,
  userId: string,
): boolean {
  if (visibility === "household") return true
  if (visibility === "adults") return role === "owner" || role === "adult"
  if (visibility === "private") return role === "owner" || isActor(actorId, userId)
  return false
}

export function canVoid(
  role: Role,
  visibility: Visibility,
  actorId: string,
  userId: string,
): boolean {
  if (visibility === "private") return role === "owner" || isActor(actorId, userId)
  return role === "owner" || role === "adult" || isActor(actorId, userId)
}

export function canSetVisibility(
  role: Role,
  visibility: Visibility,
  actorId: string,
  userId: string,
): boolean {
  if (visibility === "private" && !isActor(actorId, userId)) return false
  if (role === "child" && visibility === "adults") return false
  return true
}

export function readScope(role: Role): { visibilities: Visibility[]; ownPrivate: boolean } {
  if (role === "owner") {
    return { visibilities: ["household", "adults", "private"], ownPrivate: true }
  }
  if (role === "adult") {
    return { visibilities: ["household", "adults"], ownPrivate: true }
  }
  return { visibilities: ["household"], ownPrivate: true }
}

function isActor(actorId: string, userId: string): boolean {
  return actorId !== "" && actorId === userId
}
