import { Effect } from 'effect';

import { HttpRequest } from '../../../clients/types';

export const buildEntityRequest = () => Effect.succeed({} as HttpRequest);
