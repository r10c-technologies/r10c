/**
 * The `es` shape is the contract: annotating with it makes a key that exists in
 * Spanish but not here a *compile* error, so a half-translated locale cannot
 * reach a build. `tools/check-i18n.mjs` covers what types cannot — empty values,
 * and keys present here but absent from `es`.
 */
type EsControls = typeof import('../es/controls').controls;

export const controls: EsControls = {
  table: {
    open: 'Open',
    select: 'Select',
    actions: 'Actions',
    new: 'New',
    filters: 'Filters',
    sorting: 'Sorting',
    loading: 'Loading…',
    empty: 'No records',
    error: 'Could not load records',
    selection: 'Selection',
    selectRow: 'Select {{record}}',
    selectAllOnPage: 'Select all on this page',
    selectAllMatching_one: 'Select {{count}} match',
    selectAllMatching_other: 'Select all {{count}} matches',
    selectedCount_one: '{{count}} selected',
    selectedCount_other: '{{count}} selected',
    clearSelection: 'Clear selection',
  },
  bulk: {
    running: 'Running…',
    succeeded_one: '{{count}} record updated',
    succeeded_other: '{{count}} records updated',
    failed_one: '{{count}} record failed',
    failed_other: '{{count}} records failed',
    retryFailed: 'Retry the failures',
    dismiss: 'Dismiss result',
    resultLabel: 'Bulk action result',
    barLabel: 'Actions on the selection',
  },
  form: {
    details: 'Details',
    new: 'New',
    view: 'View',
    edit: 'Edit',
    save: 'Save',
    saving: 'Saving…',
    delete: 'Delete',
    deleting: 'Deleting…',
    clone: 'Duplicate',
    moreActions: 'More actions',
    back: 'Back',
    loading: 'Loading…',
  },
  pagination: {
    summary: 'Page {{current}} of {{total}} · {{items}} items',
    rows: 'Rows',
    previous: 'Previous',
    next: 'Next',
  },
  columns: {
    title: 'Columns',
    subtitle: 'Visibility and order',
    reset: 'Reset to default',
    moveUp: 'Move {{column}} up',
    moveDown: 'Move {{column}} down',
  },
  filter: {
    match: 'Match',
    all: 'all',
    any: 'any',
    add: 'Add filter',
    apply: 'Apply',
    clear: 'Clear',
    none: 'No filterable members on this entity.',
    listPlaceholder: 'comma, separated, values',
    matchAria: 'Match all or any filter',
    member: 'Filter member',
    operator: 'Filter operator',
    value: 'Filter value',
    rangeEnd: 'Filter range end',
    remove: 'Remove filter',
    applyAria: 'Apply filters',
    clearAria: 'Clear filters',
  },
  sort: {
    by: 'Sort by',
    then: 'then by',
    ascending: 'ascending',
    descending: 'descending',
    add: 'Add sort',
    apply: 'Apply',
    clear: 'Clear',
    none: 'No sortable members on this entity.',
    member: 'Sort member',
    direction: 'Sort direction',
    raisePriority: 'Raise sort priority',
    lowerPriority: 'Lower sort priority',
    remove: 'Remove sort',
    applyAria: 'Apply sorting',
    clearAria: 'Clear sorting',
  },
  tabs: {
    close: 'Close {{label}}',
    new: 'Open a new tab',
  },
  link: {
    search: 'Search {{field}}',
    suggestAria: 'Show {{field}} suggestions',
    browseAria: 'Browse {{field}}',
    browseTitle: 'Select {{field}}',
    clear: 'Clear {{field}}',
    empty: '— unassigned —',
    loading: 'Loading…',
    noResults: 'No matches',
    error: 'Could not load options',
    close: 'Close',
  },
  detail: {
    addRow: 'Add row',
    removeRow: 'Remove row {{row}}',
    rowActions: 'Row actions',
    empty: 'No rows yet.',
    errorSummary_one: '{{count}} cell has errors',
    errorSummary_other: '{{count}} cells have errors',
  },
  value: {
    none: '— none —',
    yes: 'Yes',
    no: 'No',
    /**
     * A `composition` in a table: its rows are edited on the master's own
     * screen rather than in the cell, so the cell says how many there are.
     */
    rowCount_one: '{{count}} row',
    rowCount_other: '{{count}} rows',
  },
  /**
   * `required`…`option` are the metadata-derived rules. The rest are the
   * vocabulary an entity's Standard Schema writes its messages in: a schema
   * carries the *key*, never a sentence, so a rule stays translatable.
   *
   * `field` is the only parameter available — a Standard Schema issue exposes a
   * message and a path, nothing else — so these stay unquantified. A rule that
   * has to state its bound writes its own key in its domain catalog and passes
   * it namespaced (`entity:product-specification.validation.codeLength`).
   */
  validation: {
    required: '{{field}} is required',
    number: '{{field}} must be a number',
    date: '{{field}} must be a date',
    option: '{{field}} is not a valid option',
    minLength: '{{field}} is too short',
    maxLength: '{{field}} is too long',
    min: '{{field}} is too small',
    max: '{{field}} is too large',
    pattern: '{{field}} has an invalid format',
  },
  operator: {
    eq: 'is',
    ne: 'is not',
    gt: 'greater than',
    gte: 'greater or equal',
    lt: 'less than',
    lte: 'less or equal',
    in: 'is one of',
    nin: 'is none of',
    between: 'between',
    nbetween: 'not between',
    like: 'contains',
    nlike: 'does not contain',
    isNull: 'is empty',
    isNotNull: 'is not empty',
  },
  theme: {
    label: 'Theme',
  },
  themes: {
    aurora: 'Aurora',
    sunset: 'Sunset',
    midnight: 'Midnight',
    ocean: 'Ocean (runtime)',
    marketplace: 'Marketplace',
    marketplaceDark: 'Marketplace dark',
    auth: 'Identity',
    authDark: 'Identity dark',
  },
  confirm: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    title: 'Confirm',
  },
  breadcrumbs: {
    label: 'Breadcrumb',
  },
};
