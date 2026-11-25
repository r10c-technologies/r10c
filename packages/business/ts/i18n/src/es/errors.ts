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
  forbiddenAction: '¿Quién puede darme acceso?',
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
  noActiveOrganizationAction: 'Elegir organización',
  notAMember: 'No perteneces a esa organización.',
  invalidRequest: 'La solicitud no es válida.',
  invalidBody: 'El cuerpo de la solicitud no es válido.',
  selectionTooLarge:
    'Esa selección es demasiado grande para actuar sobre ella de una vez. Acota el filtro o selecciona menos filas, e inténtalo de nuevo.',
  paymentDeclined: 'No se pudo procesar el pago. Intenta con otro método.',
  refundDeclined: 'No se pudo procesar el reembolso. Contacta a soporte.',
  noCapturedPayment:
    'No se cobró este pedido, así que no hay nada que devolver.',
  orderNotTransitionable:
    'Este pedido no puede hacer ese movimiento desde su estado actual.',
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
  mediaNotHttps: 'Cada URL de imagen debe ser una dirección https:// completa.',
  mediaAltMissing: 'Cada imagen necesita una descripción.',
  deviceModelUniversalNotAlone:
    '«Universal» ya incluye todos los modelos y no se combina con otro.',
  paymentPending:
    'Tu pago todavía se está confirmando. Inténtalo de nuevo en un momento.',
  cancelNotAuthorized:
    'Este pedido no se puede cancelar desde aquí. Puede que el plazo de cancelación haya terminado.',
  invalidQuery: 'La consulta no es válida.',
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
  // ADR 0079 §1–§2: una versión de producto se congela al lanzarla.
  specificationNotActive:
    'Esta oferta usa una versión del producto que no está activa. Lanza el producto o apunta la oferta a su versión activa.',
  specificationNotTransitionable:
    'Esta versión del producto no admite ese cambio en su estado actual.',
  specificationBeingRevised:
    'Este producto ya tiene una versión en diseño. Termínala o elimínala primero.',
  specificationStillPinned:
    'Una oferta publicada todavía vende esta versión del producto. Muévela o retírala primero.',
  specificationChanged:
    'Alguien más cambió este producto primero. Recárgalo e inténtalo de nuevo.',
  // Dos cambios compitieron por una oferta y el otro llegó primero; el vendedor
  // recarga y actúa sobre lo que hay ahora (#371).
  priceChanged:
    'Alguien más cambió este precio mientras lo editabas. Vuelve a cargarlo e inténtalo de nuevo.',
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
  // ADR 0082 §4: el inventario se cuenta en la unidad de su primer movimiento.
  unitMismatch:
    'Este producto se lleva en inventario en otra unidad. Usa la misma unidad, o crea otra oferta para venderlo en esta.',
  flowNotStarted:
    'No se pudo iniciar. Revisa lo solicitado e inténtalo de nuevo.',
  // La venta se compensó por completo: alguna línea fue rechazada y toda
  // existencia que se había apartado volvió a quedar disponible. Es un
  // resultado de inventario sobre el que el vendedor puede actuar, no una
  // falla.
  // Un canal retirado sigue siendo legible, porque cada pedido hecho por él
  // sigue nombrándolo — así que hay que rechazar la venta, no ocultar el canal.
  invalidTaxId: 'Ese NIT o CUI no es válido. Revisa los dígitos.',
  missingName: 'Escribe el nombre a quien emitimos la factura.',
  invalidTaxIdType: 'Elige a quién facturar.',
  invalidFiscalIdentity:
    'Revisa los datos fiscales: el NIT, la razón social, el régimen o el establecimiento no son válidos.',
  channelInactive: 'Ese canal de venta está inactivo.',
  notYours: 'Esa oferta pertenece a otro vendedor.',
  identifierRequired: 'Una cuenta necesita al menos un identificador.',
  emailRequired: 'Se requiere un identificador de correo electrónico.',
  roleNotAllowed: 'No puedes asignar ese rol.',
  userNotFound: 'No se encontró el usuario.',
  identifierInUse: 'Otra cuenta ya usa ese correo o nombre de usuario.',
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
  mixedCurrencies:
    'Los montos de un mismo vendedor están en más de una moneda.',
  unavailable:
    'Un servicio no está disponible en este momento. Inténtalo de nuevo en un momento.',
  invalid: 'Hay datos que no son válidos. Revisa el formulario.',
  invalidEnvelope: 'El cuerpo de la solicitud no es válido.',
  invalidRecords: 'Hay registros que no son válidos.',
  duplicateKey: 'Ya existe un registro con ese valor.',
  staleRevision:
    'Este registro cambió desde que lo abriste. Revisa la versión actual antes de guardar de nuevo.',
  unavailableInState:
    'Este registro ya no admite ese cambio en su estado actual. Recarga para ver dónde está.',
  declined: 'La solicitud fue rechazada.',
  contention: 'Otra operación se cruzó con esta. Inténtalo de nuevo.',
  overloaded: 'El servicio está saturado. Inténtalo de nuevo en un momento.',
  protocol: 'Un servicio respondió algo que no se pudo leer.',
  internal: 'Algo falló de nuestro lado. Ya quedó registrado.',
  idempotencyKeyMissing: 'A la solicitud le falta su clave de idempotencia.',
  idempotencyKeyReused:
    'Esa clave de idempotencia ya se usó con otra solicitud.',
  idempotencyKeyInFlight: 'Esa solicitud todavía se está procesando.',
  flowNotComposable: 'Esa operación no se puede armar para esta solicitud.',
  breakerOpen:
    'Ese servicio no está respondiendo ahora. Intente de nuevo en un momento.',
  bulkheadFull:
    'Ese servicio está ocupado ahora. Intente de nuevo en un momento.',
  notReady: 'Ese servicio se está iniciando. Intente de nuevo en un momento.',
  flowRequirementsUnmet:
    'Su organización no está habilitada para esa operación.',
  variantUnavailable: 'Esa operación no está disponible para usted.',
  flowNotFound: 'No se encontró esa operación.',
  flowSignalRejected: 'Esa operación no está esperando este paso.',
  invalidToken: 'Tu sesión no es válida. Inicia sesión de nuevo.',
  expiredToken: 'Tu sesión ha expirado. Inicia sesión de nuevo.',
  shippingOrderNotTransitionable:
    'Este envío no admite ese movimiento en su estado actual. Uno por despachar admite «Despachar»; uno despachado, «Registrar entrega» o «Registrar rechazo»; uno rechazado, «Registrar devolución».',
  refundExceedsCapture: 'Es más de lo que queda por reembolsar en este pedido.',
  codOverLimit:
    'Este pedido supera el límite de pago contra entrega. Paga a este vendedor con tarjeta.',
  codNotEntitled: 'Este vendedor no acepta pago contra entrega.',
  // Los datos de entrega y contacto de una compra en la tienda (ADR 0076).
  // Cada uno nombra un campo del formulario, que los muestra junto a él.
  vendorDoesNotShip:
    'Este vendedor todavía no hace envíos, así que no se le puede comprar en la tienda. Quita sus productos del carrito.',
  vendorDoesNotTakeLinks:
    'Este vendedor no acepta links de pago. Elige otra forma de pagarle.',
  orderNotAwaitingPayment:
    'Este pedido ya no espera su pago: se confirmó, venció o el comprador lo retiró. Si el comprador pagó un pedido vencido, devuélvele el dinero por tu proveedor de pagos: r10c nunca lo tuvo.',
  evidenceTypeRefused:
    'El comprobante tiene que ser una foto (JPEG, PNG o WebP) o un PDF.',
  evidenceTooLarge: 'El comprobante pesa demasiado: sube uno de 5 MB o menos.',
  evidenceLimitReached:
    'Este pedido ya tiene todos los comprobantes que admite. Escríbele al vendedor si falta algo.',
  payloadTooLarge: 'El archivo pesa más de lo que se puede subir aquí.',
  unsupportedMediaType: 'Este tipo de archivo no se puede subir aquí.',
  invalidPaymentDetails:
    'Revisa los datos del pago: un link es una dirección https del proveedor que elegiste, y el número de autorización no puede ir vacío.',
  guideMissing:
    'Registra la guía del envío antes de despacharlo: el comprador lo sigue por ella.',
  invalidGuide:
    'Revisa la guía: el número de guía no puede ir vacío ni pasar de 64 caracteres, elige una paquetería de la lista y, si pegas un enlace de rastreo, que sea una dirección https.',
  contactNameRequired: 'Escribe tu nombre.',
  phoneNotGuatemalan:
    'Escribe un teléfono de Guatemala de ocho dígitos, por ejemplo 5555-1234.',
  emailNotValid: 'Escribe un correo válido, por ejemplo nombre@correo.com.',
  departamentoUnknown: 'Elige un departamento.',
  municipioOutsideDepartamento: 'Elige un municipio de la lista.',
  zonaOutOfRange: 'La zona es un número del 1 al 25.',
  addressLineRequired:
    'Escribe la dirección: colonia, calle o avenida y número.',
  quantityUnreadable: 'Escribe la cantidad como número, por ejemplo 2 o 3.5.',
  quantityBelowMinimum: 'Es menos del mínimo que se vende de este producto.',
  quantityOffStep:
    'Este producto no se vende en esa cantidad exacta. Elige una de las que se venden.',
  quantityAboveMaximum: 'Es más de lo que cabe en una línea del pedido.',
  lineBelowOneMinorUnit:
    'Esa cantidad cuesta menos de un centavo. Pide una cantidad mayor.',
  saleRuleInvalid:
    'El paso y el mínimo deben ser cantidades de la unidad, y el mínimo un múltiplo del paso.',
  pricePerInvalid: 'Un precio es por 1, 100 o 1000 unidades.',
  priceTiersInvalid:
    'Cada precio por volumen empieza en una cantidad que el producto vende, mayor que su mínimo y que la del anterior, y cuesta menos que el precio anterior. Un precio tiene como máximo cinco.',
  stockSourceInvalid:
    'Una presentación se vende por unidad y toma un número entero de unidades de su base. Su base es otra oferta tuya que no es a su vez una presentación, y una presentación nunca es base de otra.',
  saleUnitFixed:
    'Esta oferta ya se publicó, así que su unidad no puede cambiar. Crea otra oferta para venderla en otra unidad.',
};
