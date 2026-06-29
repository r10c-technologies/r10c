import { ConfigurationExtractMode } from '@r10c/entifix-ts-core';

export interface BuildEntityRestOptions {
  uriConfig: {
    key: string;
    group?: string;
    extractionMode?: ConfigurationExtractMode;
  };
}
