import { accessor } from '@entifix/core';

/** One refused row of an import, as its `rejections` composition holds it. */
export interface ImportRejection {
  /** The row's number as the sheet shows it: the header is row 1. */
  readonly rowNumber: number;
  /** The `errors` catalog key the row was refused with. */
  readonly code: string;
  /** The column the refusal names, when it names one. */
  readonly column?: string;
}

/**
 * A **value**, not an entity: it has no id and is never addressed apart from
 * the import that holds it (ADR 0034).
 */
export class ImportRejectionRow implements ImportRejection {
  #rowNumber: number;
  #code: string;
  #column?: string;

  constructor(rowNumber = 0, code = '', column?: string) {
    this.#rowNumber = rowNumber;
    this.#code = code;
    this.#column = column;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:catalog-import.rejection.rowNumber',
    required: true,
  })
  get rowNumber(): number {
    return this.#rowNumber;
  }
  set rowNumber(value: number) {
    this.#rowNumber = value;
  }

  /** Rendered through the `errors` catalog, never as authored copy. */
  @accessor({
    type: 'string',
    labelKey: 'entity:catalog-import.rejection.code',
    required: true,
  })
  get code(): string {
    return this.#code;
  }
  set code(value: string) {
    this.#code = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:catalog-import.rejection.column',
  })
  get column(): string | undefined {
    return this.#column;
  }
  set column(value: string | undefined) {
    this.#column = value;
  }
}
