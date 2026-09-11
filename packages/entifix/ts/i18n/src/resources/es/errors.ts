/**
 * The code vocabulary services answer with. A response carries
 * `{ error, code, detail }`; the app renders `t(code)` and keeps `detail` for the
 * console. Codes are stable identifiers — renaming one is a wire change.
 *
 * Every code a service emits must have an entry here, and `@r10c/i18n-check`
 * fails the build when one does not: the render path goes through
 * `useTranslateKey`, whose cast discards the typed-key gate, so a missing entry
 * is invisible to the compiler and reaches the user as the identifier itself.
 * The reverse is not checked — `network`, `configUnavailable` and `unexpected`
 * are synthesized in the browser and have no emission site to find.
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
  signInFailed: 'No se pudo completar el inicio de sesión.',
  noActiveOrganization: 'Selecciona una organización para continuar.',
  invalidRequest: 'La solicitud no es válida.',
  invalidBody: 'El cuerpo de la solicitud no es válido.',
  paymentDeclined: 'No se pudo procesar el pago. Intenta con otro método.',
  refundDeclined: 'No se pudo procesar el reembolso. Contacta a soporte.',
  noCapturedPayment: 'No se cobró este pedido, así que no hay nada que devolver.',
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
  unavailable: 'No se pudo completar la venta. Revisa la existencia.',
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
};
