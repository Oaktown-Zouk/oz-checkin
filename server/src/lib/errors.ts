export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(404, message);
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Conflict") {
    super(409, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden") {
    super(403, message);
  }
}
