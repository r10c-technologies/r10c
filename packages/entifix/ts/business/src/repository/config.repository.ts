import { Context } from 'effect';
import { ConfigurationStore } from '@r10c/entifix-ts-core';

export class ConfigurationRepositoryTag extends Context.Tag(
  'ConfigurationRepositoryTag'
)<ConfigurationRepositoryTag, ConfigurationStore>() {}
