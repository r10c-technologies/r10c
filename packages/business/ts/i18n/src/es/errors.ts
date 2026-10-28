/**
 * The code vocabulary services answer with. A refusal is an
 * `application/problem+json` body whose top-level `code` is the key here; the
 * app renders `t(code)`, interpolating the failure's own fields, and keeps
 * `detail` for the console ([ADR 0064](../../../../../../docs/adr/0064-failures-reach-the-slice-shell.md)).
 * Codes are permanent — renaming one is a new failure.
 *
 * Every code a service emits must have an entry here, and `@r10c/i18n-check`
 * fails the build when one does not: the render path goes through
 * `useTranslateKey`, whose cast discards the typed-key gate, so a missing entry
 * is invisible to the compiler and reaches the user as the identifier itself.
 * The check runs both ways: a registered failure with no key fails it, and so
 * does a key that neither a registered failure nor a route's hand-written
 * refusal claims — except `network`, `configUnavailable` and `unexpected`,
 * which are synthesized in the browser and have no emission site to find.
 */
export const errors = {
  unauthenticated: 'Tu sesión no es válida. Inicia sesión de nuevo.',
  forbidden: 'No tienes permiso para realizar esta acción.',
  sessionExpired: 'Tu sesión ha expirado.',
  sessionUnresolved: 'No se pudo resolver la sesión.',
  invalidCredentials: 'Credenciales inválidas.',
  invalidState: 'Ese enlace de acceso ya expiró. Vuelve a intentarlo.',
  accountInactive: 'Tu cuenta está suspendida.',
  providerUnavailable: 'No pudimos contactar al proveedor de identidad.',
  upstreamUnavailable:
    'Ese servicio no responde en este momento. Inténtalo de nuevo en un momento.',
  signInFailed: 'No se pudo completar el inicio de sesión.',
  noActiveOrganization: 'Selecciona una organización para continuar.',
  invalidRequest: 'La solicitud no es válida.',
  invalidBody: 'El cuerpo de la solicitud no es válido.',
  paymentDeclined: 'No se pudo procesar el pago. Intenta con otro método.',
  refundDeclined: 'No se pudo procesar el reembolso. Contacta a soporte.',
  noCapturedPayment:
    'No se cobró este pedido, así que no hay nada que devolver.',
  multiVendorOrder:
    'Este pedido también incluye a otro vendedor, así que solo un operador puede cancelarlo.',
  orderNotFulfillable:
    'Este pedido ya no se puede marcar como entregado. Puede que se haya cancelado.',
  orderNotCancellable:
    'Este pedido ya no se puede cancelar. Puede que ya vaya en camino o que la cancelación esté en curso.',
  categoryParentMissing: 'La categoría superior no existe.',
  categoryParentRetired:
    'La categoría superior está retirada. Restáurala primero o elige otra.',
  categoryCycle:
    'Una categoría no puede quedar dentro de sí misma ni de una de sus subcategorías.',
  categoryTooDeep: 'Las categorías pueden tener como máximo cinco niveles.',
  categoryHasChildren:
    'Esta categoría todavía tiene subcategorías activas. Retíralas o muévelas primero.',
  categoryTreeUnreadable:
    'No se pudo revisar el árbol de categorías en este momento. Inténtalo de nuevo en un momento.',
  mediaNotHttps: 'Cada URL de imagen debe ser una dirección https:// completa.',
  mediaAltMissing: 'Cada imagen necesita una descripción.',
  paymentPending:
    'Tu pago todavía se está confirmando. Inténtalo de nuevo en un momento.',
  cancelNotAuthorized:
    'Este pedido no se puede cancelar desde aquí. Puede que el plazo de cancelación haya terminado.',
  invalidQuery: 'La consulta no es válida.',
  invalidCommand: 'El comando no es válido.',
  notFound: 'No se encontró el registro.',
  // Un fallo *por fila* de una acción masiva: el registro ya estaba en el
  // estado pedido, así que no se escribió nada. No es un error de la ejecución
  // — se informa por fila para que un recuento de éxitos no mienta sobre ella.
  alreadyRetired: 'Ya estaba retirado.',
  // El único movimiento realmente ilegal del ciclo de vida de una oferta:
  // retirar algo que nunca se publicó. Se rechaza en el dominio, no en la ruta.
  illegalOfferingTransition: 'La oferta no puede pasar a ese estado.',
  // El registro publicado lleva un monto y una moneda, así que sin precio no
  // hay nada que proyectar. Se rechaza en el verbo, donde el vendedor lo corrige.
  offeringHasNoPrice: 'Agrega un precio antes de publicar esta oferta.',
  // La oferta apunta a una especificación borrada. El registro publicado copia
  // su descripción, marca y categoría, así que publicar igual dejaría una ficha
  // con nombre y precio y nada más — que se lee como un fallo de la tienda y no
  // como datos que el vendedor tiene que arreglar. La baja sí se permite.
  offeringHasNoSpecification:
    'Esta oferta apunta a una especificación que ya no existe.',
  // Dos cambios compitieron por una oferta y el otro llegó primero; el vendedor
  // recarga y actúa sobre lo que hay ahora (#371).
  offeringChanged:
    'Esta oferta cambió mientras trabajabas. Recárgala e inténtalo de nuevo.',
  // La cantidad de un movimiento es con signo, así que un documento bien
  // formado todavía puede contradecir su motivo: una entrada de -50 dice que
  // llegó mercadería y que se restó existencia. Se rechaza en el dominio.
  inconsistentMovement: 'La cantidad no corresponde al motivo del movimiento.',
  // Lo que queda por prometer es `onHand - reserved`, y la reserva se toma con
  // una escritura atómica condicionada a eso. Cero documentos alcanzados *es* la
  // respuesta de falta de existencia, no un error del sistema.
  insufficientStock: 'No hay existencia suficiente para reservar.',
  // La venta se compensó por completo: alguna línea fue rechazada y toda
  // existencia que se había apartado volvió a quedar disponible. Es un
  // resultado de inventario sobre el que el vendedor puede actuar, no una
  // falla.
  // Un canal retirado sigue siendo legible, porque cada pedido hecho por él
  // sigue nombrándolo — así que hay que rechazar la venta, no ocultar el canal.
  channelInactive: 'Ese canal de venta está inactivo.',
  notYours: 'Esa oferta pertenece a otro vendedor.',
  resourceBusy: 'El recurso está ocupado, inténtalo de nuevo.',
  identifierRequired: 'Una cuenta necesita al menos un identificador.',
  emailRequired: 'Se requiere un identificador de correo electrónico.',
  roleNotAllowed: 'No puedes asignar ese rol.',
  userNotFound: 'No se encontró el usuario.',
  userNotAllowed: 'No puedes modificar ese usuario.',
  selfRoleChange: 'No puedes cambiar tu propio rol ni tu estado.',
  nothingToUpdate: 'No hay nada que actualizar.',
  unknownRole: 'Rol desconocido.',
  unknownStatus: 'Estado desconocido.',
  configUnavailable: 'No se pudo cargar la configuración.',
  secretRequiresValue:
    'Para dejar de marcar un valor como secreto, escribe uno nuevo.',
  network: 'Error de red. Comprueba que el servicio esté disponible.',
  // Un servicio que no respondió dentro del plazo. Se distingue de `network`
  // a propósito: la búsqueda de registros consulta varios servicios a la vez y
  // uno lento degrada solo su grupo, así que el lector necesita saber cuál de
  // las dos cosas pasó.
  timeout: 'El servicio tardó demasiado en responder.',
  unexpected: 'Algo salió mal.',
  // The failures entifix and the fleet register (ADR 0064): a code is the
  // failure's own, permanent, and the gate reads the registry for it.
  stockUnavailable: 'No se pudo completar la venta. Revisa la existencia.',
  unavailable:
    'Un servicio no está disponible en este momento. Inténtalo de nuevo en un momento.',
  invalid: 'Hay datos que no son válidos. Revisa el formulario.',
  invalidEnvelope: 'El cuerpo de la solicitud no es válido.',
  invalidRecords: 'Hay registros que no son válidos.',
  duplicateKey: 'Ya existe un registro con ese valor.',
  declined: 'La solicitud fue rechazada.',
  contention: 'Otra operación se cruzó con esta. Inténtalo de nuevo.',
  overloaded: 'El servicio está saturado. Inténtalo de nuevo en un momento.',
  protocol: 'Un servicio respondió algo que no se pudo leer.',
  internal: 'Algo falló de nuestro lado. Ya quedó registrado.',
  idempotencyKeyMissing: 'A la solicitud le falta su clave de idempotencia.',
  idempotencyKeyReused:
    'Esa clave de idempotencia ya se usó con otra solicitud.',
  idempotencyKeyInFlight: 'Esa solicitud todavía se está procesando.',
  invalidToken: 'Tu sesión no es válida. Inicia sesión de nuevo.',
  expiredToken: 'Tu sesión ha expirado. Inicia sesión de nuevo.',
};
