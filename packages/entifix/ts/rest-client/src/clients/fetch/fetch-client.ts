import { Effect } from 'effect';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { HttpRequest, HttpResponse } from '../types';

export const performHttpRequestThroughFetch = <TResponseBody>(
  request: HttpRequest
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
      yield* Effect.fail(
        new EntifixConnError(
          `HTTP request failed with status ${response.status}: ${response.statusText}`,
          undefined,
          {
            status: response.status,
            statusText: response.statusText,
            url: request.url,
            method: request.method,
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
