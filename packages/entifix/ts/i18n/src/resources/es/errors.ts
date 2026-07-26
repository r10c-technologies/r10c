/**
 * The code vocabulary services answer with. A response carries
 * `{ error, code, detail }`; the app renders `t(code)` and keeps `detail` for the
 * console. Codes are stable identifiers — renaming one is a wire change.
 */
export const errors = {
  unauthenticated: 'Tu sesión no es válida. Inicia sesión de nuevo.',
  forbidden: 'No tienes permiso para realizar esta acción.',
  sessionExpired: 'Tu sesión ha expirado.',
  sessionUnresolved: 'No se pudo resolver la sesión.',
  invalidCredentials: 'Credenciales inválidas.',
  invalidRequest: 'La solicitud no es válida.',
  invalidBody: 'El cuerpo de la solicitud no es válido.',
  invalidQuery: 'La consulta no es válida.',
  invalidCommand: 'El comando no es válido.',
  notFound: 'No se encontró el registro.',
  resourceBusy: 'El recurso está ocupado, inténtalo de nuevo.',
  identifierRequired: 'Una cuenta necesita al menos un identificador.',
  credentialsRequired: 'El registro requiere una contraseña y un identificador.',
  roleNotAllowed: 'No puedes asignar ese rol.',
  userNotFound: 'No se encontró el usuario.',
  userNotAllowed: 'No puedes modificar ese usuario.',
  selfRoleChange: 'No puedes cambiar tu propio rol ni tu estado.',
  nothingToUpdate: 'No hay nada que actualizar.',
  unknownRole: 'Rol desconocido.',
  unknownStatus: 'Estado desconocido.',
  configUnavailable: 'No se pudo cargar la configuración.',
  network: 'Error de red. Comprueba que el servicio esté disponible.',
  unexpected: 'Algo salió mal.',
  accountLocked: 'Demasiados intentos. Inténtalo de nuevo más tarde.',
  passwordIncorrect: 'La contraseña actual no es correcta.',
  passwordTooShort: 'La contraseña debe tener al menos 8 caracteres.',
  invalidResetToken: 'Este enlace ya no es válido. Solicita uno nuevo.',
};
