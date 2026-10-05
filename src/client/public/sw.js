const CACHE = "tobias-shell-v1"

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/")) return

  const shell =
    request.mode === "navigate" ||
    request.destination === "document" ||
    request.destination === "script" ||
    request.destination === "style"

  if (!shell) return

  const network = fetch(request)
    .then((response) => ({ response, copy: response.clone() }))
    .catch(() => null)

  event.waitUntil(
    (async () => {
      const result = await network
      if (!result || !result.response.ok) return
      const cache = await caches.open(CACHE)
      await cache.put(request, result.copy)
    })(),
  )

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(request)
      if (cached) return cached
      const result = await network
      if (result) return result.response
      if (request.mode === "navigate") {
        const fallback = (await cache.match("/")) || (await cache.match("/index.html"))
        if (fallback) return fallback
      }
      return Response.error()
    })(),
  )
})
