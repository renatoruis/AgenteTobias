import type { Env } from "../env"
import { app } from "./app"

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
