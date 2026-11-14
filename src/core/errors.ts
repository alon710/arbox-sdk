export class ArboxError extends Error {
  override readonly name: string = 'ArboxError';
}

export interface ArboxAPIErrorInit {
  status: number;
  operation: string;
  method: string;
  path: string;
  body: unknown;
  headers: Headers;
}

type ErrorBody = {
  message?: unknown;
  errors?: unknown;
  error?: { name?: unknown; code?: unknown; message?: unknown };
};

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

export class ArboxAPIError extends ArboxError {
  override readonly name: string = 'ArboxAPIError';
  readonly status: number;
  readonly code: string | undefined;
  readonly operation: string;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly headers: Headers;

  constructor(init: ArboxAPIErrorInit) {
    const body = (init.body && typeof init.body === 'object' ? init.body : {}) as ErrorBody;
    const code = asText(body.error?.name);
    const detail = asText(body.error?.message) ?? asText(body.message) ?? `HTTP ${init.status}`;
    super(`${init.method} ${init.path} failed with ${init.status}${code ? ` ${code}` : ''}: ${detail}`);
    this.status = init.status;
    this.code = code;
    this.operation = init.operation;
    this.method = init.method;
    this.path = init.path;
    this.body = init.body;
    this.headers = init.headers;
  }
}

export class ArboxAuthenticationError extends ArboxAPIError {
  override readonly name: string = 'ArboxAuthenticationError';
}

export class ArboxPermissionDeniedError extends ArboxAPIError {
  override readonly name: string = 'ArboxPermissionDeniedError';
}

export class ArboxNotFoundError extends ArboxAPIError {
  override readonly name: string = 'ArboxNotFoundError';
}

export class ArboxValidationError extends ArboxAPIError {
  override readonly name: string = 'ArboxValidationError';
  readonly errors: Record<string, string[]>;

  constructor(init: ArboxAPIErrorInit) {
    super(init);
    const errors = (init.body as ErrorBody | null)?.errors;
    this.errors = errors && typeof errors === 'object' ? (errors as Record<string, string[]>) : {};
  }
}

export class ArboxRateLimitError extends ArboxAPIError {
  override readonly name: string = 'ArboxRateLimitError';
}

export class ArboxServerError extends ArboxAPIError {
  override readonly name: string = 'ArboxServerError';
}

export class ArboxConnectionError extends ArboxError {
  override readonly name: string = 'ArboxConnectionError';
}

export class ArboxTimeoutError extends ArboxConnectionError {
  override readonly name: string = 'ArboxTimeoutError';
}

export class ArboxReadOnlyError extends ArboxError {
  override readonly name: string = 'ArboxReadOnlyError';
}

export function createAPIError(init: ArboxAPIErrorInit): ArboxAPIError {
  if (init.status === 401) return new ArboxAuthenticationError(init);
  if (init.status === 403) return new ArboxPermissionDeniedError(init);
  if (init.status === 404) return new ArboxNotFoundError(init);
  if (init.status === 422) return new ArboxValidationError(init);
  if (init.status === 429) return new ArboxRateLimitError(init);
  if (init.status >= 500) return new ArboxServerError(init);
  return new ArboxAPIError(init);
}
