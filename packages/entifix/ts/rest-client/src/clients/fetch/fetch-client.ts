import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { HttpRequest, HttpResponse } from '../types';

export const performHttpRequestThroughFetch = <TResponseBody>(
  request: HttpRequest<unknown>
) =>
  Effect.gen(function* () {
    // Perform the HTTP request using the Fetch API
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body ? JSON.stringify(request.body) : undefined,
        }),
      catch: error =>
        new EntifixConnError(`HTTP request to ${request.url} failed`, error, {
          url: request.url,
          method: request.method,
        }),
    });

    // Check if the response is successful (status code 2xx)
    if (!response.ok) {
      // Services answer a failure with `{ error, code, detail }`. Carrying the
      // `code` into `details` is what lets the browser render a translated
      // message instead of the service's English `error` string. A body that is
      // not JSON is not itself a failure — the status already is one.
      const failure = yield* Effect.promise(() =>
        response.json().then(
          (parsed: unknown) => parsed as Record<string, unknown>,
          () => ({}) as Record<string, unknown>
        )
      );
      const code = failure['code'];

      yield* Effect.fail(
        new EntifixConnError(
          `HTTP request failed with status ${response.status}: ${response.statusText}`,
          undefined,
          {
            status: response.status,
            statusText: response.statusText,
            url: request.url,
            method: request.method,
            ...(typeof code === 'string' ? { code } : {}),
          }
        )
      );
    }

    // Parse the response body as JSON. If parse fails, fail with an EntifixExternalError with details about the failure.
    const body = yield* Effect.tryPromise({
      try: () => response.json() as Promise<TResponseBody>,
      catch: error =>
        new EntifixConnError('Failed to parse response body as JSON', error, {
          url: request.url,
          method: request.method,
          status: response.status,
          statusText: response.statusText,
        }),
    });

    // Return the HttpResponse object
    const httpResponse: HttpResponse<TResponseBody> = {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };

    return httpResponse;
  });
