export class AgentError extends Error {
  readonly status: 400 | 401 | 403 | 404
  readonly code: "validation" | "unauthorized" | "forbidden" | "not_found"

  constructor(
    status: 400 | 401 | 403 | 404,
    code: "validation" | "unauthorized" | "forbidden" | "not_found",
    message: string,
  ) {
    super(message)
    this.name = "AgentError"
    this.status = status
    this.code = code
  }
}
