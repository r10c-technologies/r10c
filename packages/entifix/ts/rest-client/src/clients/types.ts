export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type HttpHeaders = Record<string, string>;

export interface HttpRequest<TBody = never> {
  method: HttpMethod;
  url: string;
  headers?: HttpHeaders;
  body?: TBody;
}

export interface HttpResponse<TBody> {
  status: number;
  headers: HttpHeaders;
  body: TBody;
}
