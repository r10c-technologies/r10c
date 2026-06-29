import { Effect } from 'effect/Effect';
import { EntifixBuildError } from '../entifix-error';

export type ConfigurationExtractMode = 'exact' | 'match' | 'compose';

export interface ConfigurationStoreGroup {
  getNumber(
    key: string,
    extractMode?: ConfigurationExtractMode
  ): Effect<number, EntifixBuildError>;
  getString(
    key: string,
    extractMode?: ConfigurationExtractMode
  ): Effect<string, EntifixBuildError>;
  getDate(
    key: string,
    extractMode?: ConfigurationExtractMode
  ): Effect<Date, EntifixBuildError>;
  getArrayNumber(
    key: string,
    extractMode?: ConfigurationExtractMode
  ): Effect<number[], EntifixBuildError>;
  getArrayString(
    key: string,
    extractMode?: ConfigurationExtractMode
  ): Effect<string[], EntifixBuildError>;
  getArrayDate(
    key: string,
    extractMode?: ConfigurationExtractMode
  ): Effect<Date[], EntifixBuildError>;
  getOptionalNumber(
    key: string,
    extractMode?: ConfigurationExtractMode
  ): Effect<number | undefined, EntifixBuildError>;
  getOptionalString(
    key: string,
    extractMode?: ConfigurationExtractMode
  ): Effect<string | undefined, EntifixBuildError>;
  getOptionalDate(
    key: string,
    extractMode?: ConfigurationExtractMode
  ): Effect<Date | undefined, EntifixBuildError>;
  getOptionalArrayNumber(
    key: string,
    extractMode?: ConfigurationExtractMode
  ): Effect<number[] | undefined, EntifixBuildError>;
  getOptionalArrayString(
    key: string,
    extractMode?: ConfigurationExtractMode
  ): Effect<string[] | undefined, EntifixBuildError>;
  getOptionalArrayDate(
    key: string,
    extractMode?: ConfigurationExtractMode
  ): Effect<Date[] | undefined, EntifixBuildError>;
}

export interface ConfigurationStore {
  in(key: string): ConfigurationStoreGroup;
}

export interface ConfigurationItem {
  key: string;
  value: unknown;
}

export interface ConfigurationPlain {
  [key: string]: ConfigurationItem[];
}
