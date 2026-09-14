import { ConfigurationClient } from '@entifix/core';
import { Context } from 'effect';

export class ConfigurationRepositoryTag extends Context.Tag(
  'ConfigurationRepositoryTag',
)<ConfigurationRepositoryTag, ConfigurationClient>() {}
