/**
 * Copy owned by the three Next apps, one sub-tree per app.
 *
 * Only what an app authors. Chrome the shells render — breadcrumb root, the
 * account destinations, sign out — belongs to `shell`, and theme captions to
 * `controls`; nothing outside `apps/` may reference a key from here.
 */
export const app = {
  admin: {
    brand: 'r10c Admin',
    title: 'r10c · Administración del marketplace',
    description: 'Back-office del marketplace r10c.',
    /** The two palettes the account menu offers (#530). */
    themes: {
      ocean: 'Océano',
      midnight: 'Medianoche',
    },
    // El inicio del vendedor (#563): lo que requiere su atención hoy.
    home: {
      tiles: 'Pendientes de hoy',
      none: 'Cuando actúe por una organización, aquí verá lo que requiere su atención.',
    },
    nav: {
      // `//home`, where the proxy lands an authenticated visitor. Not the
      // breadcrumb root — that is the shell's `shell:breadcrumbs.home`.
      dashboard: 'Panel',
      account: 'Cuenta',
    },
    menu: {
      trigger: 'Admin',
      preferences: 'Preferencias',
      signOut: 'Cerrar sesión',
    },
    account: {
      title: 'Cuenta',
      signedIn: 'Sesión iniciada',
      verified: 'Identidad verificada por marketplace-admin-service.',
      failed:
        'No pudimos verificar tu sesión con el backend. Inicia sesión de nuevo.',
      userId: 'ID de usuario:',
      subject: 'Sujeto:',
      session: 'Sesión:',
      roles: 'Roles:',
      none: '(ninguno)',
      signingOut: 'Cerrando sesión…',
    },
    playground: 'Laboratorio del sistema de diseño',
  },
  auth: {
    brand: 'r10c Identity',
    title: 'r10c · Identidad',
    description: 'Inicia sesión en la flota r10c.',
    signIn: {
      overline: 'Identidad',
      title: 'Iniciar sesión',
      subtitle: 'Accede a la flota del marketplace r10c.',
      continue: 'Continuar',
      hosted:
        'Te llevaremos a r10c Identity para verificar tu identidad. Ahí puedes crear una cuenta, recuperarla o usar un segundo factor.',
      errors: {
        providerUnavailable: 'No pudimos contactar al proveedor de identidad.',
        invalidState: 'Ese enlace de acceso ya expiró. Vuelve a intentarlo.',
        accountInactive: 'Tu cuenta está suspendida.',
        accessDenied: 'Cancelaste el inicio de sesión.',
        invalidRequest: 'La respuesta del proveedor llegó incompleta.',
        unexpected: 'Algo falló al iniciar sesión.',
      },
    },
  },
  marketplace: {
    title: 'r10c · Marketplace',
    description: 'La tienda del marketplace r10c.',
    overline: 'Tienda',
    heading: 'Marketplace',
    lead: 'El mismo sistema de diseño entifix que la app de administración, con la paleta esmeralda propia de esta app. Cambia claro/oscuro abajo.',
    addToCart: 'Añadir al carrito',
    buttons: {
      title: 'Botones',
      subtitle: 'Los mismos átomos, con la marca de la tienda.',
      primary: 'Primario',
      secondary: 'Secundario',
      ghost: 'Fantasma',
      checkout: 'Pagar',
    },
    typography: {
      title: 'Tipografía',
      body: 'El texto base escala con el viewport y sigue la paleta activa.',
      caption:
        'Pie de foto — los colores de marca vienen del themes.css de esta app.',
    },
  },
  /**
   * The documentation site's own copy (apps/docs-site, #652 #653). Every page
   * of the site is generated from the capability and slice registers; this is
   * only the words around what they say.
   */
  docs: {
    brand: 'r10c',
    title: 'Documentación de r10c',
    description:
      'Qué hace r10c, quién puede hacerlo y dónde vive cada dato, generado desde el código.',
    languages: {
      title: 'Elige un idioma',
      es: 'Español',
      en: 'English',
    },
    home: {
      title: 'Inicio',
      description: 'Cuatro puertas al mismo registro, una por lector.',
      intro:
        'Cada caso de uso tiene una sola página, generada desde el registro de capacidades. Empieza por la entrada que te corresponde.',
      storybook: 'Componentes de la tienda (Storybook)',
      storybookNote:
        'Los componentes de la tienda, cada uno en sus estados, con su verificación de accesibilidad.',
    },
    audiences: {
      title: 'Para quién',
      developer: {
        title: 'Quien desarrolla',
        description:
          'Cada caso de uso por dominio, con los permisos que exige y los cruces entre servicios que usa.',
      },
      operator: {
        title: 'Quien opera la plataforma',
        description:
          'Qué rol concede cada permiso, y qué pasos hace un servicio en nombre de otro.',
      },
      merchant: {
        title: 'El comercio',
        description:
          'Lo que un vendedor puede hacer hoy, en qué pantalla, y lo que todavía no existe.',
      },
      evaluator: {
        title: 'Quien evalúa r10c',
        description:
          'Lo construido y lo planeado, contado desde el registro y no desde una promesa.',
      },
    },
    useCase: {
      id: 'Identificador',
      status: 'Estado',
      domain: 'Dominio',
      oda: 'Componente ODA',
      odaNone: 'Sin equivalente ODA',
      entities: 'Entidades',
      subject: 'sujeto',
      permissions: 'Permisos',
      crossing: 'cruce entre servicios',
      crossings: 'Cruces entre servicios',
      roles: 'Roles que lo conceden',
      noRole: 'Ningún rol: lo hace un servicio o el comprador',
      screens: 'Pantallas',
      noScreen: 'Ninguna pantalla: se invoca desde otra acción',
      verticals: 'Verticales',
      allVerticals: 'Todas',
      notBuilt:
        'Todavía no existe en el código. La fecha está en el hito, no aquí.',
      count: 'Casos de uso',
    },
    entityMap: {
      title: 'Mapa de entidades',
      description:
        'Las entidades que toca este caso de uso, con las partes que posee cada una y los registros a los que apunta.',
      from: 'Desde',
      member: 'Miembro',
      relation: 'Relación',
      to: 'Hacia',
      store: 'Store',
      part: 'Una parte propia',
      noStore: 'Sin store',
      noRelation:
        'Sus metadatos no declaran composición, enlace ni referencia a otro registro.',
      kinds: {
        composition: 'Composición: se escribe y se lee con su dueño',
        link: 'Enlace',
        reference: 'Referencia en el mismo store',
        id: 'Id en otro store, nunca un enlace',
      },
      short: {
        composition: 'posee',
        link: 'enlace',
        reference: 'referencia',
        id: 'id',
      },
    },
    api: {
      title: 'APIs',
      description:
        'Cada operación que sirve cada servicio, desde el documento OpenAPI que responde en $openapi.',
      intro:
        'Cada página se genera al compilar con el mismo ensamblado que sirve el servicio, sin levantar ningún servidor, así que no puede desviarse de él. Solo lectura: no hay área de pruebas, porque casi toda ruta pide una sesión o un token de cruce.',
      operations: 'operaciones',
      operation: 'Operación',
      slice: 'Slice',
      download: 'El documento OpenAPI',
      downloadNote: 'el JSON del que sale esta página.',
      name: 'Parámetro',
      in: 'En',
      required: 'Obligatorio',
      type: 'Tipo',
      yes: 'Sí',
      no: 'No',
      noParameters: 'Sin parámetros.',
      requestBody: 'Cuerpo de la solicitud',
      noBody: 'Sin cuerpo de solicitud.',
      noContent: 'sin cuerpo',
      failures: 'Fallos',
      none: 'Ninguno',
      problem: 'Cuerpo del error',
      problemNote:
        'Todo fallo responde application/problem+json con esta forma. Su code es la clave del catálogo errors, y un cliente decide por el code, nunca por el estado.',
      link: 'Su API',
    },
    flows: {
      title: 'Flujos',
      description:
        'Cada flujo por el que pasa una venta, paso a paso, compuesto con el mismo código que ejecuta el coordinador.',
      intro:
        'Un flujo es una hoja de ruta: el coordinador la compone una vez, a partir de una receta y de los hechos que verificó, y ejecuta sus pasos en orden sobre un motor durable. Estos son los flujos del MVP, cada uno para un vendedor.',
      diagram: 'Los pasos en orden, con cada rama que puede tomar una espera',
      interactive: 'Explorar el diagrama',
      static: 'Volver al diagrama estático',
      legendTitle: 'Cómo leerlo',
      legend: {
        pivot:
          'Borde grueso: el pivote. Antes de él todo paso se puede deshacer; después, el flujo solo avanza.',
        wait: 'Borde punteado: una espera a una respuesta de fuera del flujo.',
        compensatable:
          'Borde discontinuo: un paso que se deshace si falla un paso posterior antes del pivote.',
        retriable:
          'Borde simple: un paso que se reintenta hasta que sale bien, después del pivote.',
      },
      kinds: {
        pivot: 'Pivote',
        wait: 'Espera',
        compensatable: 'Se deshace si algo falla',
        retriable: 'Se reintenta hasta que sale bien',
      },
      columns: {
        order: 'N.º',
        step: 'Paso',
        kind: 'Tipo',
        service: 'Servicio',
        call: 'Llamada',
        undo: 'Se deshace con',
        when: 'Solo cuando',
      },
      coordinator: 'El propio coordinador',
      notUndone: 'No se deshace',
      always: 'Siempre',
      answeredWith: 'respondió',
      outcomes: {
        confirmed: 'el vendedor confirmó el pago',
        cancelled: 'el pago no llegó',
        delivered: 'entregado',
        refused: 'rechazado',
        unanswered: 'sin reporte a tiempo',
      },
      lifecycles: {
        title: 'Ciclos de vida',
        intro:
          'Existencias, liquidación y pagos a vendedores no son flujos: son un libro de movimientos, un pliegue sobre dos eventos y un corte. Cada paso nombra lo que ya está registrado — un caso de uso, una ruta, un evento o un barrido — y el sitio no se construye si un paso nombra algo que no existe.',
        planned: 'planificado, todavía no construido',
        kinds: {
          capability: 'Caso de uso',
          route: 'Ruta',
          event: 'Evento',
          sweep: 'Barrido',
        },
        columns: {
          order: 'N.º',
          step: 'Paso',
          kind: 'Tipo',
          names: 'Qué nombra',
        },
        items: {
          stock: {
            title: 'Existencias, de la entrada a la venta',
            description:
              'La existencia es un libro de movimientos: nunca se sobrescribe una cantidad, y una compra aparta antes de descontar.',
            steps: {
              receive:
                'El vendedor registra un movimiento: mercadería que entra, un conteo o una baja.',
              hold: 'Al comprar, el flujo aparta lo pedido. Si no alcanza, la compra se rechaza ahí.',
              convert:
                'Cuando el cobro sale bien, lo apartado se convierte en venta.',
              release:
                'Si el flujo falla antes del cobro, lo apartado se libera.',
              expire:
                'Un barrido libera lo que se apartó y nunca se cobró, al vencer su plazo.',
              restore:
                'Una cancelación o una devolución regresa la mercadería con un movimiento nuevo.',
              announce:
                'Cada cambio se anuncia, y las pestañas abiertas del vendedor lo ven sin recargar.',
              read: 'El vendedor consulta su posición de existencias.',
            },
          },
          settlement: {
            title: 'Liquidación de una venta',
            description:
              'La comisión se escribe cuando la venta y su cobro han llegado los dos, y se revierte cuando la cancelación y su reembolso han llegado los dos.',
            steps: {
              terms:
                'La plataforma fija los términos de comisión del vendedor. Ningún rol del vendedor puede escribirlos.',
              placed:
                'La orden colocada trae las líneas del vendedor y el canal de venta.',
              captured: 'El cobro dice que el dinero se movió, y por cuánto.',
              entries:
                'Con las dos, se escriben los apuntes de comisión, a los términos vigentes al vender.',
              cancelled: 'La cancelación dice que la venta ya no va.',
              refunded:
                'El reembolso dice que el dinero regresó. Con los dos, los apuntes se revierten copiando los originales, no recalculando.',
              balance: 'El vendedor ve lo que le pagará el próximo corte.',
            },
          },
          payout: {
            title: 'Pago a un vendedor',
            description:
              'Un corte liquida todos los apuntes pendientes en un pago por vendedor. Entregar ese pago todavía no está construido.',
            steps: {
              run: 'La plataforma corre el corte de liquidación.',
              settled:
                'Cada apunte pendiente queda asignado a ese corte, incluidas las reversiones.',
              payout:
                'Cada vendedor tiene su pago: lo bruto menos la comisión. Puede ser negativo y descontarse del siguiente.',
              disburse:
                'Entregar el pago a la cuenta del vendedor está planificado y no construido.',
            },
          },
        },
      },
      scenarios: {
        'checkout-card': {
          title: 'Compra en la tienda, con tarjeta',
          description:
            'El comprador paga al comprar: se aparta el inventario, se escribe la orden, se cobra y luego se abre el envío.',
        },
        'checkout-cash-on-delivery': {
          title: 'Compra en la tienda, contra entrega',
          description:
            'El comprador le paga al mensajero: el vendedor debe aceptar contra entrega, y no se mueve dinero al comprar.',
        },
        'checkout-payment-link': {
          title: 'Compra en la tienda, con enlace de pago',
          description:
            'El comprador paga fuera de la plataforma: la orden espera a que el vendedor confirme el pago, y libera el inventario si nunca llega.',
        },
        'checkout-counter': {
          title: 'Venta en mostrador',
          description:
            'El vendedor vende en persona: la misma compra, con la mercadería entregada en el momento en lugar de enviada.',
        },
        delivery: {
          title: 'Entrega, contra entrega',
          description:
            'El vendedor despacha el paquete y el flujo espera al mensajero: entregado cierra la orden, rechazado espera la devolución.',
        },
        cancellation: {
          title: 'Cancelar una orden pagada',
          description:
            'La orden se bloquea contra el despacho, se devuelve el dinero, la mercadería vuelve al inventario y la orden se cierra.',
        },
      },
      steps: {
        flow: { commit: 'Punto de compromiso: nada que cobrar ahora' },
        fulfilment: {
          'await-delivery': 'Esperar el reporte del mensajero',
          'await-return': 'Esperar que vuelva el paquete',
          dispatch: 'Despachar el paquete',
          hold: 'Retener el envío',
          open: 'Abrir el envío',
          withdraw: 'Retirar el envío',
        },
        order: {
          'await-payment': 'Esperar el pago',
          'claim-cancel': 'Reservar la orden para cancelarla',
          close: 'Cerrar la orden',
          'close-cancelled': 'Cerrar la orden como cancelada',
          'close-fulfilled': 'Cerrar la orden como cumplida',
          confirm: 'Confirmar la orden',
          'mark-dispatched': 'Marcar la orden como entregada en mano',
          'mark-shipped': 'Marcar la orden como enviada',
          'notify-buyer': 'Enviar el comprobante al comprador',
          'open-group': 'Abrir el comprobante del comprador',
          'payment-decision': 'Esperar la decisión del vendedor',
          write: 'Escribir la orden del vendedor',
        },
        payment: {
          capture: 'Cobrar',
          'cod-eligible': 'Verificar que se permite contra entrega',
          'record-collection': 'Registrar el efectivo cobrado',
          'record-confirmation': 'Registrar el pago confirmado',
          refund: 'Devolver el dinero',
        },
        stock: {
          convert: 'Convertir el apartado en venta',
          release: 'Liberar el apartado',
          reserve: 'Apartar el inventario',
          restore: 'Devolver la mercadería al inventario',
        },
      },
    },
    statuses: {
      implemented: 'Construido',
      planned: 'Planeado',
      'in-design': 'En diseño',
    },
    guides: {
      title: 'Guías por vertical',
      description:
        'De abrir la tienda a cobrar la comisión, para cada tipo de comercio del MVP.',
      inSpanish: '',
    },
    verticals: {
      hardware: 'Ferretería',
      'phone-accessories': 'Accesorios de celular',
      'shoemaking-supplies': 'Insumos de zapatería',
    },
    catalog: {
      title: 'Servicios',
      description:
        'Cada slice con lo que despliega, los stores que escribe y las APIs y eventos que expone, derivado de tools/slices.',
      storesTitle: 'Stores',
      storesDescription:
        'Cada store con su plano, su partición y su único escritor.',
      kind: 'Tipo',
      kinds: {
        domain: 'Dominio',
        system: 'Sistema',
        component: 'Componente',
        resource: 'Recurso',
        api: 'API',
      },
      slice: 'Slice',
      status: 'Estado',
      sliceStatuses: { active: 'Activo', planned: 'Planeado' },
      domains: 'Dominios',
      noDomain: 'Ninguno: es un slice de plataforma',
      deployments: 'Despliegues',
      noDeployment: 'Ninguno todavía',
      port: 'Puerto',
      inspector: 'Inspector',
      tags: 'Etiquetas',
      coDeployedWith: 'Desplegado junto a',
      stores: 'Stores que escribe',
      noStore: 'Ninguno',
      exposedAPIs: 'APIs que expone',
      dependantAPIs: 'APIs que consume',
      publishedEvents: 'Eventos que publica',
      subscriptions: 'Suscripciones',
      subscription: {
        event: 'Evento',
        mode: 'Modo',
        attempts: 'Intentos',
        dedupe: 'Deduplicación',
      },
      none: 'Ninguno',
      plane: 'Plano',
      planes: {
        control: 'Control',
        platform: 'Plataforma',
        tenant: 'Organización',
      },
      partitioning: 'Partición',
      partitionings: {
        single: 'Una base compartida',
        'per-organization': 'Una base por organización',
      },
      truth: 'Verdad',
      systemOfRecord: 'Registro original',
      projectionOf: 'Proyección de',
      writer: 'Único escritor',
      hosts: 'Dominios que aloja',
      noHosts: 'Ninguno: guarda registros que no son entidades',
      binding: 'Por qué comparten store',
      useCases: 'Casos de uso del dominio',
      package: 'Paquete',
      capability: 'Capacidad',
      store: 'Store',
      map: 'Mapa de stores por plano',
      mapDescription:
        'Los stores agrupados por plano, con el slice que escribe cada uno y la flecha de cada proyección.',
      mapLink: 'Ver el mapa',
    },
  },
};
