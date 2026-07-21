import { expect, type Locator, type Page } from '@playwright/test';

/** How a filter row is filled in. */
export interface FilterClause {
  member: string;
  operator: string;
  value: string;
}

export interface SortClause {
  member: string;
  direction?: 'asc' | 'desc';
}

/**
 * A driver for the `EntityTable` organism: filters, sorting, paging and the
 * rendered rows.
 *
 * Every entity listing in the workspace is the same component, so its selectors
 * belong in one place rather than being re-declared as local helpers in each
 * suite — which is what the two admin specs did, with two different sets of
 * conventions for the same widget.
 *
 * The wide (grid) layout is what is asserted on. Both layouts always render —
 * the pivot is CSS-only, so there is no SSR hydration mismatch — and the table
 * is the one carrying column semantics.
 */
export class EntityTablePage {
  constructor(private readonly page: Page) {}

  /** Rows of the wide layout. */
  get rows(): Locator {
    return this.page.locator('table tbody tr');
  }

  /** Waits until the listing has painted at least one row. */
  async waitForRows(): Promise<void> {
    await expect(this.rows.first()).toBeVisible();
  }

  /** Column headers, in render order. */
  async headers(): Promise<string[]> {
    return this.page.locator('table thead th').allInnerTexts();
  }

  /**
   * The values of one column, addressed by its header label rather than by
   * position: a column added to the entity — or reordered by the user's saved
   * preferences — must not silently shift what a spec is asserting on.
   */
  async columnValues(header: string): Promise<string[]> {
    const index = (await this.headers()).findIndex(
      label => label.trim() === header,
    );
    if (index === -1) {
      throw new Error(
        `No column headed "${header}". Rendered columns: ${(await this.headers()).join(', ')}.`,
      );
    }
    return this.page
      .locator(`table tbody tr td:nth-child(${index + 1})`)
      .allInnerTexts();
  }

  /** The distinct values of a column, sorted — the usual assertion subject. */
  async distinctColumnValues(header: string): Promise<string[]> {
    return [...new Set(await this.columnValues(header))].sort();
  }

  // --- filtering ----------------------------------------------------------

  async openFilters(): Promise<void> {
    await this.page
      .getByRole('button', { name: 'Filters', exact: true })
      .click();
  }

  /** `and` (default) or `or` across the rows of the panel. */
  async matchAny(match: 'and' | 'or'): Promise<void> {
    await this.page.getByLabel('Match all or any filter').selectOption(match);
  }

  /**
   * Adds a filter row and fills it in.
   *
   * The member is always selected explicitly, never left at the default: a new
   * row defaults to the entity's *first filterable* member, so a spec relying
   * on it would break the moment a member is declared ahead of that one.
   */
  async addFilter({ member, operator, value }: FilterClause): Promise<void> {
    const index = await this.page.getByLabel('Filter member').count();
    await this.page.getByRole('button', { name: 'Add filter' }).click();
    await this.page.getByLabel('Filter member').nth(index).selectOption(member);
    await this.page
      .getByLabel('Filter operator')
      .nth(index)
      .selectOption(operator);
    await this.page.getByLabel('Filter value').nth(index).fill(value);
  }

  /** Filtering is emitted on Apply, not per keystroke — each emission is a request. */
  async applyFilters(): Promise<void> {
    await this.page.getByRole('button', { name: 'Apply filters' }).click();
  }

  async clearFilters(): Promise<void> {
    await this.page.getByRole('button', { name: 'Clear filters' }).click();
  }

  /** Opens the panel, adds every clause, applies. */
  async filterBy(...clauses: FilterClause[]): Promise<void> {
    await this.openFilters();
    for (const clause of clauses) {
      await this.addFilter(clause);
    }
    await this.applyFilters();
  }

  // --- sorting ------------------------------------------------------------

  async openSorting(): Promise<void> {
    await this.page
      .getByRole('button', { name: 'Sorting', exact: true })
      .click();
  }

  async addSort({ member, direction = 'asc' }: SortClause): Promise<void> {
    const index = await this.page.getByLabel('Sort member').count();
    await this.page.getByRole('button', { name: 'Add sort' }).click();
    await this.page.getByLabel('Sort member').nth(index).selectOption(member);
    await this.page
      .getByLabel('Sort direction')
      .nth(index)
      .selectOption(direction);
  }

  async applySorting(): Promise<void> {
    await this.page.getByRole('button', { name: 'Apply sorting' }).click();
  }

  /** Opens the panel, adds every term in precedence order, applies. */
  async sortBy(...clauses: SortClause[]): Promise<void> {
    await this.openSorting();
    for (const clause of clauses) {
      await this.addSort(clause);
    }
    await this.applySorting();
  }

  // --- paging -------------------------------------------------------------

  /**
   * `exact` matters: Next.js' dev-tools button also matches a loose "Next".
   */
  async nextPage(): Promise<void> {
    await this.page.getByRole('button', { name: 'Next', exact: true }).click();
  }

  async previousPage(): Promise<void> {
    await this.page
      .getByRole('button', { name: 'Previous', exact: true })
      .click();
  }
}
