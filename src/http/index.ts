import { embedPending } from "../infrastructure/search"
import type { Env } from "../env"
import { app } from "./app"

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx)
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    try {
      await embedPending(env, 20)
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error"
      console.error(JSON.stringify({ error: name }))
      controller.noRetry()
    }
  },
} satisfies ExportedHandler<Env>
