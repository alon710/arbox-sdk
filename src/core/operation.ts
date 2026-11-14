export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface OperationDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly pathParams: readonly string[];
  readonly queryParams: readonly string[];
  readonly body: boolean;
  readonly bodyParams: readonly string[];
}
