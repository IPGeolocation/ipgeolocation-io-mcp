export class RequestCancelledError extends Error {
  constructor() {
    super("Tool call cancelled. The API may already have processed the request; no automatic retry was made.");
    this.name = "RequestCancelledError";
  }
}

export class ResourceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceLimitError";
  }
}
