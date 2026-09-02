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
  invalidQuery: 'La consulta no es válida.',
  invalidCommand: 'El comando no es válido.',
  notFound: 'No se encontró el registro.',
  // Un fallo *por fila* de una acción masiva: el registro ya estaba en el
  // estado pedido, así que no se escribió nada. No es un error de la ejecución
  // — se informa por fila para que un recuento de éxitos no mienta sobre ella.
  alreadyRetired: 'Ya estaba retirado.',
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
  unexpected: 'Algo salió mal.',
};
