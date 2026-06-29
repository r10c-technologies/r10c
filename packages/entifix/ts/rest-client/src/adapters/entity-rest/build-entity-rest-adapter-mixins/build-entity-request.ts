import { Effect } from 'effect';
import { HttpRequest } from '../../../clients/types';

export const buildEntityRequest = () =>
  Effect.gen(function* () {
    return {} as HttpRequest;
  });
