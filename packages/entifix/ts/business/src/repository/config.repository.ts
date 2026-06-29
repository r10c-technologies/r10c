import { ConfigurationStore } from '@r10c/entifix-ts-core';
import { Context } from 'effect';

export class ConfigurationRepositoryTag extends Context.Tag(
  'ConfigurationRepositoryTag'
)<ConfigurationRepositoryTag, ConfigurationStore>() {}
