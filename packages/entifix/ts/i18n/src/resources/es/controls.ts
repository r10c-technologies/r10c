/**
 * Copy owned by `@r10c/entifix-react-controls` — the agnostic entity UI. It lives
 * here rather than next to the components because the typed-key augmentation has
 * to see every namespace from one module, and `entifix:tooling` may not import
 * `entifix:react`.
 */
export const controls = {
  table: {
    open: 'Abrir',
    select: 'Seleccionar',
    actions: 'Acciones',
    new: 'Nuevo',
    filters: 'Filtros',
    sorting: 'Orden',
    loading: 'Cargando…',
    empty: 'Sin registros',
    error: 'No se pudieron cargar los registros',
  },
  form: {
    details: 'Detalles',
    new: 'Nuevo',
    view: 'Ver',
    edit: 'Editar',
    save: 'Guardar',
    saving: 'Guardando…',
    delete: 'Eliminar',
    deleting: 'Eliminando…',
    back: 'Volver',
    loading: 'Cargando…',
  },
  pagination: {
    summary: 'Página {{current}} de {{total}} · {{items}} registros',
    rows: 'Filas',
    previous: 'Anterior',
    next: 'Siguiente',
  },
  columns: {
    title: 'Columnas',
    subtitle: 'Visibilidad y orden',
    reset: 'Restablecer',
    moveUp: 'Subir {{column}}',
    moveDown: 'Bajar {{column}}',
  },
  filter: {
    match: 'Coincidir',
    all: 'todos',
    any: 'cualquiera',
    add: 'Añadir filtro',
    apply: 'Aplicar',
    clear: 'Limpiar',
    none: 'Esta entidad no tiene miembros filtrables.',
    listPlaceholder: 'valores, separados, por comas',
    matchAria: 'Coincidir todos o cualquiera de los filtros',
    member: 'Miembro del filtro',
    operator: 'Operador del filtro',
    value: 'Valor del filtro',
    rangeEnd: 'Fin del rango del filtro',
    remove: 'Quitar filtro',
    applyAria: 'Aplicar filtros',
    clearAria: 'Limpiar filtros',
  },
  sort: {
    by: 'Ordenar por',
    then: 'después por',
    ascending: 'ascendente',
    descending: 'descendente',
    add: 'Añadir orden',
    apply: 'Aplicar',
    clear: 'Limpiar',
    none: 'Esta entidad no tiene miembros ordenables.',
    member: 'Miembro de orden',
    direction: 'Dirección de orden',
    raisePriority: 'Subir prioridad de orden',
    lowerPriority: 'Bajar prioridad de orden',
    remove: 'Quitar orden',
    applyAria: 'Aplicar orden',
    clearAria: 'Limpiar orden',
  },
  tabs: {
    close: 'Cerrar {{label}}',
    new: 'Abrir una pestaña nueva',
  },
  /**
   * El editor de una relación. `search` es la búsqueda rápida y `browse` abre el
   * catálogo completo; ambos botones son iconos, así que sus etiquetas `aria` son
   * lo único que un lector de pantalla anuncia.
   */
  link: {
    search: 'Buscar {{field}}',
    suggestAria: 'Ver sugerencias de {{field}}',
    browseAria: 'Examinar {{field}}',
    browseTitle: 'Seleccionar {{field}}',
    clear: 'Quitar {{field}}',
    empty: '— sin asignar —',
    loading: 'Cargando…',
    noResults: 'Sin coincidencias',
    error: 'No se pudieron cargar las opciones',
    close: 'Cerrar',
  },
  value: {
    none: '— ninguno —',
    yes: 'Sí',
    no: 'No',
  },
  /**
   * `required`…`option` son las reglas derivadas de la metadata. El resto es el
   * vocabulario en el que un Standard Schema de una entidad escribe sus
   * mensajes: el esquema lleva la *clave*, nunca una frase, para que la regla
   * siga siendo traducible.
   *
   * `field` es el único parámetro disponible — un issue de Standard Schema
   * expone un mensaje y una ruta, nada más — así que estos mensajes no indican
   * el límite. Una regla que deba enunciarlo escribe su propia clave en el
   * catálogo de su dominio (`entity:product-specification.validation.codeLength`).
   */
  validation: {
    required: '{{field}} es obligatorio',
    number: '{{field}} debe ser un número',
    date: '{{field}} debe ser una fecha',
    option: '{{field}} no es una opción válida',
    minLength: '{{field}} es demasiado corto',
    maxLength: '{{field}} es demasiado largo',
    min: '{{field}} es demasiado pequeño',
    max: '{{field}} es demasiado grande',
    pattern: '{{field}} tiene un formato inválido',
  },
  /**
   * The filter vocabulary shown to a user. Deliberately distinct from
   * `RSQL_TOKENS` in `entifix-ts-core` — those are wire tokens (`==`, `=gt=`)
   * and must never be translated.
   */
  operator: {
    eq: 'es',
    ne: 'no es',
    gt: 'mayor que',
    gte: 'mayor o igual',
    lt: 'menor que',
    lte: 'menor o igual',
    in: 'es uno de',
    nin: 'no es ninguno de',
    between: 'entre',
    nbetween: 'fuera de',
    like: 'contiene',
    nlike: 'no contiene',
    isNull: 'está vacío',
    isNotNull: 'no está vacío',
  },
  theme: {
    label: 'Tema',
  },
  /**
   * Captions for the theme presets shipped by `@r10c/entifix-style`, plus the
   * per-app brand sets. They name design-system tokens, not app copy, so they
   * live beside the switcher that renders them and stay reachable from
   * Storybook, where no shell is mounted.
   */
  themes: {
    aurora: 'Aurora',
    sunset: 'Atardecer',
    midnight: 'Medianoche',
    ocean: 'Océano (en runtime)',
    marketplace: 'Marketplace',
    marketplaceDark: 'Marketplace oscuro',
    auth: 'Identidad',
    authDark: 'Identidad oscura',
  },
  breadcrumbs: {
    label: 'Ruta de navegación',
  },
};
