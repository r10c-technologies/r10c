/**
 * Copy for the screens r10c's own shells render: the identity surface (user
 * administration and the signed-in account) and the storefront.
 *
 * Until entifix 0.5.0 both lived inside the framework's `shell` namespace,
 * which rendered neither — only these shells read them. They are r10c's
 * product copy, so they are r10c's namespace (ADR 0060).
 */
export const r10c = {
  /**
   * El correo al comprador de la tienda: el recibo y el enlace de acceso de un
   * solo uso (ADR 0076 §6). Registro de «tú», como la tienda.
   */
  mail: {
    receipt: {
      subject: 'Tu pedido {{number}}',
      greeting: 'Hola, {{name}}:',
      intro:
        'Gracias por tu compra. Este es el resumen de tu pedido {{number}}.',
      sellerOrder: 'Pedido {{number}} · {{tender}}',
      line: '{{quantity}} × {{name}} — {{amount}}',
      orderTotal: 'Total de este pedido: {{amount}}',
      ivaIncluded: 'IVA incluido: {{amount}}',
      billedTo: 'Facturado a: {{name}} · {{idType}} {{taxId}}',
      billedToCf: 'Facturado a: Consumidor final',
      total: 'Total: {{amount}}',
      deliveryHeading: 'Entrega',
    },
    access: {
      subject: 'Tu enlace para ver el pedido {{number}}',
      intro: 'Pediste un enlace para volver a ver tu pedido {{number}}.',
      link: 'Abre tu pedido en cualquier dispositivo con este enlace. Funciona una vez y vence en {{hours}} horas:',
      action: 'Abrir mi pedido',
      notYou:
        'Si no pediste este correo, puedes ignorarlo: nadie más recibió el enlace.',
    },
    tender: {
      card: 'Tarjeta',
      cod: 'Contra entrega',
      cash: 'Efectivo',
      link: 'Link de pago',
    },
  },
  auth: {
    nav: {
      organization: 'Mi organización',
      identity: 'Identidad',
      users: 'Usuarios',
      accountSection: 'Cuenta',
    },
    organization: {
      overline: 'Organización',
      title: 'Datos fiscales',
      subtitle:
        'El NIT, la razón social, el régimen y el establecimiento con que se documenta cada pedido que vendes.',
      failed: 'No se pudieron leer los datos fiscales de tu organización.',
      saved:
        'Datos fiscales guardados. Los pedidos nuevos los usan desde ahora.',
      paymentLink: {
        title: 'Enlaces de pago',
        hint: 'Los compradores pueden elegir pagar con un enlace que tú les envías. Tú confirmas cada pago; un pedido sin pagar se cancela cuando vence su plazo.',
        accepts: 'Acepto pagos con un enlace que envío',
        failed: 'No se pudo leer si aceptas enlaces de pago.',
        saved: 'Guardado. Las compras nuevas lo siguen desde ahora.',
      },
      whatsapp: {
        title: 'WhatsApp',
        hint: 'El número de WhatsApp al que tus compradores pueden escribirte. Cada recibo con tus pedidos ofrece un chat contigo. Déjalo vacío para no ofrecerlo.',
        failed: 'No se pudo leer tu número de WhatsApp.',
        saved: 'Guardado. Los recibos ofrecen el chat desde ahora.',
      },
    },
    account: {
      overline: 'Cuenta',
      title: 'Mi cuenta',
      subtitle: 'Tu identidad y tu acceso a la flota r10c.',
      menu: 'Cuenta',
      identifiers: 'Identificadores',
      noIdentifiers: 'Sin identificadores registrados.',
      userId: 'ID de usuario',
      subject: 'Sujeto',
      session: 'Sesión',
      roles: 'Roles',
      none: 'Ninguno',
      failed: 'No pudimos cargar tu cuenta.',
    },
    sessions: {
      overline: 'Seguridad',
      title: 'Sesiones activas',
      subtitle: 'Dónde has iniciado sesión. Cierra las que no reconozcas.',
      current: 'Este dispositivo',
      unknownDevice: 'Dispositivo desconocido',
      startedAt: 'Iniciada',
      expiresAt: 'Expira',
      lastIp: 'IP',
      actionsFor: 'Acciones de la sesión en {{device}}',
      othersCount_one: '(1 sesión)',
      othersCount_other: '({{count}} sesiones)',
      empty: 'No hay otras sesiones activas.',
      failed: 'No pudimos cargar tus sesiones.',
      loading: 'Cargando sesiones…',
    },
    organizations: {
      switchTitle: 'Cambiar de organización',
      trigger: 'Organización: {{name}}',
      current: 'Actual',
      switching: 'Cambiando…',
      close: 'Cerrar',
      loading: 'Cargando organizaciones…',
      failed: 'No pudimos cargar tus organizaciones.',
      none: 'Tu cuenta no pertenece a ninguna organización.',
      unnamed: 'Organización sin nombre',
      grantTitle: '¿Quién puede darme acceso?',
      grantMember:
        'Los permisos los conceden los administradores de {{organization}}. Pídele a uno de ellos el acceso que necesitas.',
      grantOperator:
        'Tu cuenta no pertenece a ninguna organización: los permisos los concede un operador de la plataforma.',
    },
    security: {
      overline: 'Seguridad',
      title: 'Contraseña y acceso',
      subtitle:
        'Tu contraseña, tu segundo factor y tus cuentas vinculadas viven en r10c Identity.',
      explain:
        'r10c no guarda tu contraseña. Adminístrala, junto con la verificación en dos pasos y tus accesos sociales, en el proveedor de identidad.',
      manage: 'Administrar en r10c Identity',
    },
    fields: {
      email: 'Correo',
    },
    users: {
      title: 'Usuarios',
      newTitle: 'Nuevo usuario',
      fallbackName: 'Usuario',
      sessionsTitle: 'Sesiones de este usuario',
      sessionsEmpty: 'Este usuario no tiene sesiones activas.',
      sessionsFailed: 'No pudimos cargar las sesiones de este usuario.',
    },
  },
  storefront: {
    missing: {
      heading: 'No encontramos esa página',
      body: 'El producto o la categoría que buscas no existe, o ya no está disponible.',
      home: 'Volver al inicio',
      search: 'Buscar en la tienda',
    },
    nav: {
      skipToContent: 'Saltar al contenido',
      catalog: 'Catálogo',
    },
    breadcrumbs: {
      label: 'Ruta de navegación',
      home: 'Inicio',
    },
    home: {
      overline: 'Tienda',
      heading: 'Marketplace r10c',
      // Lo que el h1 promete, distinto del nombre de la tienda (#570).
      promise: 'Productos de varios vendedores, en una sola tienda',
      // Solo lo que hoy es cierto. Lo de entrega y pago contra entrega espera
      // a que cada vendedor lo diga en su producto (#589).
      claims: {
        label: 'Por qué comprar aquí',
        multiVendor: 'Compra a varios vendedores en un solo pedido.',
        cancel:
          'Puedes cancelar desde tu recibo mientras tu pedido no ha salido.',
      },
      categories: 'Categorías',
      newest: 'Lo más nuevo',
      featured: 'Destacados',
    },
    sampleStore: {
      note: 'Tienda de muestra · los precios son ilustrativos, no una cotización.',
    },
    seller: {
      overline: 'Tienda',
      empty: 'Este vendedor todavía no tiene productos publicados.',
      share: 'Compartir por WhatsApp',
      shareText: 'Mira la tienda de {{seller}}: {{url}}',
      chat: 'Escribir al vendedor',
      chatText: 'Hola {{seller}}, vi tu tienda y tengo una consulta.',
      description: 'Compra los productos de {{seller}}.',
    },
    category: {
      overline: 'Categoría',
      empty: 'No hay productos en esta categoría todavía.',
      children: 'Subcategorías',
    },
    // Lo que compra un precio, junto al precio, cuando no es una pieza: un
    // metro, o cien tornillos (ADR 0082 §5).
    price: {
      per: 'por {{symbol}}',
      perQuantity: 'por {{quantity}} {{symbol}}',
      // Una cantidad con su unidad: «3.5 m», «2 u.».
      quantity: '{{quantity}} {{symbol}}',
      // Cómo se vende lo que no se vende de uno en uno.
      sold: 'Desde {{minimum}}, de {{step}} en {{step}}',
      // Lo que trae una presentación de su base (ADR 0082 §7): «Contiene 100 m».
      contains: 'Contiene {{quantity}}',
      // Un precio que baja con la cantidad (ADR 0082 §8): la tabla en la
      // página del producto, y la nota en una línea que alcanzó uno.
      tiers: {
        heading: 'Precios por volumen',
        caption: 'Toda la línea se cobra al precio que alcanza su cantidad.',
        quantity: 'Cantidad',
        price: 'Precio',
        from: 'Desde {{quantity}}',
        base: 'Menos de {{quantity}}',
      },
      tierApplied: 'Precio por volumen desde {{quantity}}',
    },
    product: {
      buy: 'Comprar',
      soldBy: 'Vendido por {{seller}}',
      delivery: {
        ships: 'Envío por el vendedor',
        cod: 'Pago contra entrega disponible',
        doesNotShip:
          'Este vendedor no hace envíos, así que este producto no se puede comprar en la tienda en línea.',
        atTheDoor: 'Qué pasa al recibirlo',
        refuse:
          'Puedes rechazar el paquete al recibirlo; si pagaste con tarjeta, se te reembolsa.',
        noReturns: 'No hay devoluciones después de la entrega.',
      },
      details: 'Detalles',
      seller: 'Vendedor',
      addToCart: 'Añadir al carrito',
      // El botón de la tarjeta: una palabra corta, y un nombre que dice qué añade.
      add: 'Añadir',
      addNamed: 'Añadir {{name}} al carrito',
      brand: 'Marca',
      category: 'Categoría',
      reference: 'Referencia',
      related: 'También te puede interesar',
      /**
       * `availableHint` es una **pista**, y el nombre lo dice: el catálogo
       * publicado es consistente en diferido a propósito y la verdad es la
       * reserva del checkout (ADR 0009). Por eso la copia no promete
       * existencias concretas.
       */
      available: 'Disponible',
      unavailable: 'Sin existencias',
      gallery: 'Imágenes del producto',
      galleryPrevious: 'Imagen anterior',
      galleryNext: 'Imagen siguiente',
      galleryPosition: '{{index}} de {{total}}',
    },
    catalog: {
      unavailable:
        'No pudimos cargar el catálogo en este momento. No es que no haya productos: inténtalo de nuevo en un momento.',
      retry: 'Reintentar',
    },
    listing: {
      // i18next picks the form from `count` by the locale's plural rules.
      results_one: '{{count}} producto',
      results_other: '{{count}} productos',
      empty: 'Ningún producto coincide con estos filtros.',
      filters: 'Filtrar',
      // The disclosure a phone shows in place of the panel; `count` is how
      // many filters are in force, and none reads as the bare word.
      filtersSummary_zero: 'Filtrar',
      filtersSummary_one: 'Filtrar (1)',
      filtersSummary_other: 'Filtrar ({{count}})',
      sort: 'Ordenar',
      sorts: {
        priceAsc: 'Precio: menor a mayor',
        priceDesc: 'Precio: mayor a menor',
        newest: 'Más recientes',
        name: 'Nombre',
      },
      facets: {
        category: 'Categoría',
        brand: 'Marca',
        seller: 'Vendedor',
        price: 'Precio',
        available: 'Solo disponibles',
        min: 'Desde',
        max: 'Hasta',
        apply: 'Aplicar',
      },
      // "Mi teléfono" (plan 1.17): what fits the buyer's phone, made for it or
      // universal.
      myPhone: {
        label: 'Mi teléfono',
        choose: 'Elige tu modelo',
        apply: 'Ver lo que le queda',
        showing: 'Mostrando lo que le queda a tu {{model}}.',
        forget: 'Quitar',
      },
    },
    search: {
      heading: 'Buscar',
      label: 'Buscar productos',
      placeholder: 'Lámpara, taza, manta…',
      submit: 'Buscar',
      resultsFor: 'Resultados para «{{term}}»',
      empty: 'No encontramos nada para «{{term}}».',
    },
    cart: {
      view: 'Ver carrito',
      // No `count_one`/`count_other`: el número solo se conoce en el navegador,
      // así que el servidor traduce alrededor de una marca, y `count` elegiría
      // una forma.
      itemsOne: '{{items}} artículo',
      itemsOther: '{{items}} artículos',
      heading: 'Carrito',
      empty: 'Tu carrito está vacío.',
      remove: 'Quitar',
      removeNamed: 'Quitar {{name}} del carrito',
      added: 'Se añadió {{name}} al carrito.',
      removed: 'Se quitó {{name}} del carrito.',
      undo: 'Deshacer',
      quantity: 'Cantidad',
      quantityOf: 'Cantidad de {{name}}',
      // Una cantidad rechazada, no redondeada (ADR 0082 §3): el motivo es el
      // del catálogo `errors`.
      refused: 'No se cambió {{name}} en el carrito.',
      blocked: 'Cambia las cantidades marcadas para revisar el pedido.',
      update: 'Actualizar',
      total: 'Total',
      keepShopping: 'Seguir comprando',
      review: 'Revisar pedido',
    },
    review: {
      changed:
        'Algo cambió desde que revisaste este pedido: un precio, o un producto que ya no está a la venta. Revísalo de nuevo antes de confirmarlo.',
      unavailable:
        'Algunos productos de tu carrito ya no están a la venta y no forman parte de este pedido.',
      heading: 'Revisa tu pedido',
      intro:
        'Revisa los productos de cada vendedor y cómo le pagas. No se pide ni se cobra nada hasta que confirmes el pedido.',
      subtotal: 'Subtotal',
      // Cómo le pagas a cada vendedor (ADR 0076 §7): sin nada marcado de
      // antemano, y dicho como un hecho cuando el vendedor acepta una sola.
      payment: {
        legend: 'Cómo le pagas a {{seller}}',
        card: 'Tarjeta',
        cod: 'Contra entrega',
        codHint: 'Pagas en efectivo cuando llegue el paquete.',
        simulated:
          'Pago simulado: no te pedimos datos de tarjeta ni te cobramos nada.',
        onlyCard:
          'Pagas con tarjeta. Pago simulado: no te pedimos datos de tarjeta ni te cobramos nada.',
        onlyCod: 'Pagas en efectivo cuando llegue el paquete.',
        link: 'Link de pago',
        linkHint:
          'El vendedor te envía un link de pago y, cuando le pagas, lo confirma. Tu pedido te espera 48 horas.',
        required: 'Elige cómo le pagas a este vendedor.',
      },
      edit: 'Editar carrito',
      place: 'Confirmar pedido',
      // Entrega y contacto (ADR 0076 §2). Sin código postal ni país: se
      // entrega dentro de Guatemala, por departamento, municipio y zona.
      tax: {
        legend: 'Facturación',
        intro:
          'Si necesitas factura con tu NIT, elígelo aquí. Si no, la emitimos a consumidor final.',
        idTypes: {
          cf: 'Consumidor final (CF)',
          nit: 'NIT',
          cui: 'CUI (DPI)',
        },
        hints: {
          taxId:
            'Sin guiones. El NIT termina en su dígito verificador, que puede ser K.',
        },
      },
      delivery: {
        legend: 'Entrega y contacto',
        intro:
          'Lo usamos para entregarte el pedido y avisarte cómo va. Solo lo ven los vendedores que lo envían, y lo borramos cuando ya no hace falta.',
        optional: '(opcional)',
        chooseMunicipio: 'Elige tu municipio',
        fields: {
          name: 'Nombre de quien recibe',
          phone: 'Teléfono',
          email: 'Correo electrónico',
          municipio: 'Municipio',
          zona: 'Zona',
          addressLine: 'Dirección',
          reference: 'Referencia',
          taxIdType: 'Facturar a',
          taxId: 'NIT o CUI',
          taxName: 'Nombre en la factura',
        },
        hints: {
          phone: 'Ocho dígitos. El repartidor te llama a este número.',
          email: 'Te enviamos el recibo y cómo volver a tu pedido.',
          reference: 'Por ejemplo: frente al parque, portón negro.',
        },
      },
    },
    checkout: {
      empty: 'Ninguno de estos productos sigue a la venta.',
      failed: 'No se pudo iniciar la compra. Inténtalo de nuevo.',
      doesNotShip:
        '{{seller}} no hace envíos, así que no se le puede comprar en la tienda. Quita sus productos del carrito para continuar.',
      thisSeller: 'Uno de los vendedores',
      quantity:
        'Una cantidad del carrito ya no se vende así. Cámbiala para continuar.',
      // Un medio de pago por vendedor (ADR 0070). El pago contra entrega solo
      // se ofrece donde el vendedor lo acepta.
      method: {
        card: 'Tarjeta',
        cod: 'Contra entrega',
        link: 'Link de pago',
      },
    },
    order: {
      ivaIncluded: 'IVA incluido:',
      fiscal: {
        pending: 'Factura electrónica en certificación.',
        certified:
          'Factura electrónica {{type}} serie {{series}} número {{number}}. Autorización {{authorization}}.',
        voided:
          'Factura electrónica {{type}} serie {{series}} número {{number}}, anulada. Autorización {{authorization}}.',
      },
      billedTo: 'Facturado a: {{name}} · {{idType}} {{taxId}}',
      billedToCf: 'Facturado a: Consumidor final',
      statusHeading: 'Estamos registrando tu pedido',
      pending:
        'Estamos confirmando tu pedido con cada vendedor. Esta página se actualiza sola.',
      failed:
        'No se pudo registrar tu pedido y no se cobró nada. Tu carrito sigue aquí.',
      retry: 'Intentar de nuevo',
      checkNow: 'Ver si ya está listo',
      checkNowHint:
        'Tu navegador no actualiza esta página por sí solo. Usa el botón para ver si tu pedido ya quedó registrado.',
      heading: '¡Gracias por tu compra!',
      placed: 'Tu pedido quedó registrado y el vendedor ya fue notificado.',
      reference: 'Número de pedido',
      vendorNumber: 'Pedido {{number}}',
      receiptUntil: 'Puedes volver a ver este recibo hasta el {{date}}.',
      delivery: {
        heading: 'Entrega',
        phone: 'Teléfono: •••• {{ending}}',
        zona: 'Zona {{zona}}',
      },
      units: 'Cant. {{quantity}}',
      total: 'Total',
      unavailable:
        'No pudimos cargar tu pedido en este momento. Tu compra está registrada con el número de arriba; inténtalo de nuevo en un momento.',
      keepShopping: 'Seguir comprando',
      expiredHeading: 'No hay ningún pedido que mostrar',
      expired:
        'El comprobante de tu última compra ya no está disponible en este navegador. Si acabas de comprar, revisa el correo de confirmación.',
      // El plazo se nombra en vez de dejar que el botón deje de funcionar solo:
      // el comprobante lleva la fecha que el servidor selló, y el botón se va
      // cuando pasa, mientras el comprobante se sigue leyendo hasta su propio
      // `receiptEndsAt` (ADR 0076 §6).
      cancel: 'Cancelar pedido',
      cancelTitle: '¿Cancelar el pedido de {{seller}}?',
      cancelMessage:
        'Se cancelará este pedido y te reembolsaremos su total. Los pedidos de otros vendedores en esta compra no cambian.',
      cancelConfirm: 'Cancelar pedido y reembolsar',
      cancelKeep: 'Conservar el pedido',
      cancelledTag: 'Cancelado',
      // Por dónde va cada pedido hasta la puerta (ADR 0081 §11). Un pago en
      // curso nunca dice que el dinero se cobró.
      whatsapp: {
        label: 'Escribir al vendedor por WhatsApp',
        text: {
          placed: 'Hola, te escribo por mi pedido {{number}}.',
          awaitingPayment:
            'Hola, te escribo por el pago de mi pedido {{number}}.',
          dispatched: 'Hola, te escribo por el envío de mi pedido {{number}}.',
          delivered: 'Hola, recibí mi pedido {{number}} y te escribo por él.',
        },
      },
      tracker: {
        heading: 'Seguimiento',
        placed: 'Pedido recibido',
        payment: {
          card: 'Pago con tarjeta',
          link: 'Pago por link',
        },
        dispatched: 'Despachado',
        delivered: 'Entregado',
        state: {
          done: 'completado',
          current: 'en curso',
          todo: 'pendiente',
        },
        codNote: 'Pagas al recibirlo.',
        guide: '{{courier}}, guía {{number}}',
        follow: 'Rastrear el envío',
      },
      // Un pedido con link de pago (ADR 0081): espera a que el vendedor
      // confirme el pago, y el comprador paga por el link que el vendedor pone.
      payment: {
        awaiting: 'Esperando el pago',
        until: 'El vendedor te guarda este pedido hasta el {{time}}.',
        noLink:
          'El vendedor te enviará un link de pago. También aparecerá aquí.',
        pay: 'Pagar con {{provider}}',
        unlisted:
          'Este link es del propio vendedor y abre {{host}}. Paga solo si lo reconoces.',
        expired:
          'Este pedido venció antes de que el vendedor confirmara un pago. Si pagaste, pide al vendedor que te devuelva el dinero.',
        // El comprobante que el comprador adjunta (ADR 0081 §6).
        evidence: {
          title: 'Comprobante de pago',
          hint: 'Sube la captura o el PDF que te dio tu banco o el proveedor del link: una foto (JPEG, PNG o WebP) o un PDF de hasta 5 MB.',
          file: 'Archivo del comprobante',
          submit: 'Adjuntar comprobante',
          attachedOne: 'Comprobante {{n}} ({{kind}})',
          view: 'Ver',
          image: 'imagen',
          pdf: 'PDF',
          attached:
            'Adjuntaste el comprobante. El vendedor lo revisará y confirmará tu pago.',
          failed: 'No pudimos adjuntar el comprobante. Inténtalo otra vez.',
        },
      },
      cancelledAll: 'Todos los pedidos de esta compra quedaron cancelados.',
      cancelWindow: 'Puedes cancelar este pedido hasta las {{time}}.',
      cancelledHeading: 'Pedido cancelado',
      cancelled:
        'Cancelamos tu pedido y el reembolso ya va en camino. Puede tardar unos días en aparecer en tu estado de cuenta.',
      cancelling: 'Cancelando este pedido…',
      cancelPaymentPending:
        'Tu pago todavía se está confirmando, así que aún no se puede cancelar el pedido. Inténtalo de nuevo en un momento.',
      cancelFailed:
        'No se pudo cancelar el pedido. Puede que el plazo haya terminado o que ya vaya en camino.',
      findLink: 'Encontrar mi pedido',
      movedHeading: 'Este pedido se abrió en otro dispositivo',
      moved:
        'Alguien abrió este pedido con el enlace de tu correo, así que este navegador ya no puede mostrarlo. Si fuiste tú, sigue en ese dispositivo; si no, pide un enlace nuevo.',
      find: {
        heading: 'Encontrar mi pedido',
        intro:
          'Escribe el número de tu pedido (el de la compra o el de un vendedor) y el correo con el que compraste. Si coinciden, te enviamos un enlace para abrirlo.',
        number: 'Número de pedido',
        email: 'Correo electrónico',
        submit: 'Enviarme un enlace',
        sent: 'Si los datos coinciden con un pedido, te enviamos un enlace a ese correo. Puede tardar unos minutos.',
      },
      access: {
        heading: 'Abrir tu pedido',
        intro:
          'Este enlace abre tu pedido en este navegador. Solo funciona una vez, y el navegador donde lo abrías antes dejará de mostrarlo.',
        open: 'Abrir mi pedido',
        failed:
          'Este enlace ya se usó o venció. Puedes pedir uno nuevo con el número de tu pedido y tu correo.',
        missing:
          'Este enlace está incompleto. Puedes pedir uno nuevo con el número de tu pedido y tu correo.',
      },
    },
    footer: {
      note: 'Catálogo de demostración. Ningún pedido es real.',
      findOrder: 'Encontrar mi pedido',
    },
  },
  /**
   * System management — the operator surface. Lives in the framework shell so
   * a dedicated management app can mount the same screens later, which is why the
   * copy is here rather than in an app catalog.
   */
  /**
   * La superficie de existencias — las primeras pantallas de Operaciones del
   * back office.
   *
   * El *nombre del nivel* ("Operaciones") sale de `nav.screenType.operation`;
   * esto nombra el grupo dentro de él.
   */
  stock: {
    nav: {
      stock: 'Existencias',
      items: 'Existencias en almacén',
      movements: 'Libro de movimientos',
      reservations: 'Reservas',
    },
    item: {
      outOfStock: 'Sin existencias disponibles',
    },
    // Las tarjetas del inicio del vendedor (#563): cada una lleva a la lista
    // filtrada que cuenta.
    home: {
      outOfStock: 'Productos agotados',
    },
  },
  order: {
    nav: {
      // El grupo y su destino: el encabezado no se repite en el elemento.
      orders: 'Pedidos',
      received: 'Pedidos recibidos',
    },
    home: {
      latest: 'Últimos pedidos',
      none: 'Aún no ha recibido pedidos.',
    },
    // La columna de productos de la lista: el primero y cuántos más (#556).
    list: {
      itemsMore_one: '{{name}} y 1 más',
      itemsMore_other: '{{name}} y {{count}} más',
    },
    // La región de un pedido con link de pago (ADR 0081): el vendedor pone el
    // link con el que paga el comprador y confirma el pago con su número de
    // autorización.
    payment: {
      heading: 'Link de pago',
      due: 'Esperando el pago hasta el {{time}}. Después el pedido se cancela y su inventario vuelve a la venta.',
      linkSet: 'Link puesto ({{provider}}): {{url}}',
      confirmed: 'Pagado. Autorización {{reference}}, confirmada el {{time}}.',
      provider: 'Proveedor del link',
      providerName: 'Nombre del proveedor (opcional)',
      url: 'Link de pago (https)',
      setLink: 'Poner link de pago',
      reference: 'Número de autorización',
      confirm: 'Confirmar pago',
      // Los comprobantes de pago adjuntos (ADR 0081 §6).
      evidence: 'Comprobantes de pago',
      evidenceOne: 'Comprobante {{n}}, adjuntado por {{by}} el {{time}}',
      attachedBy: { buyer: 'el comprador', vendor: 'tu equipo' },
      evidenceFile: 'Comprobante que te enviaron (foto o PDF, hasta 5 MB)',
      attachEvidence: 'Adjuntar comprobante',
    },
  },
  fulfilment: {
    nav: {
      // El grupo y su único destino: lo que el vendedor abre para entregar
      // paquetes al mensajero, y que abre en los que esperan despacho.
      title: 'Despacho',
      shipments: 'Envíos',
    },
    home: {
      awaitingDispatch: 'Envíos por despachar',
    },
    // Una línea del contenido del paquete en la lista: «2 × Lámpara» (#557).
    list: {
      line: '{{quantity}} × {{name}}',
    },
    whatsapp: {
      heading: 'Comprador',
      label: 'Escribir al comprador por WhatsApp',
      text: {
        preparing:
          'Hola, te escribo por tu pedido {{number}}: lo estamos preparando.',
        dispatched:
          'Hola, tu pedido {{number}} va en camino. Tu guía es {{tracking}}.',
        delivered: 'Hola, ¿recibiste bien tu pedido {{number}}?',
      },
    },
    guide: {
      heading: 'Guía del envío',
      missing:
        'Este envío todavía no tiene guía. Regístrela antes de despacharlo: el comprador sigue el paquete por ella.',
      recorded: '{{courier}}, guía {{number}}',
      follow: 'Rastrear el envío',
      courier: 'Paquetería',
      courierName: 'Nombre de la paquetería',
      trackingUrl: 'Enlace de rastreo (opcional)',
      number: 'Número de guía',
      record: 'Registrar guía',
    },
  },
  settlement: {
    nav: {
      // El mismo nombre de grupo en las dos gradas: un acuerdo se redacta
      // (Definiciones) y el resto lo produce un proceso (Operaciones). El
      // encabezado de cada grada sale de `nav.screenType`.
      settlement: 'Liquidaciones',
      agreements: 'Acuerdos',
      agreements_vendor: 'Mi acuerdo',
      entries: 'Apuntes de comisión',
      entries_vendor: 'Mis comisiones',
      runs: 'Cortes de liquidación',
      payouts: 'Pagos a vendedores',
      payouts_vendor: 'Mis pagos',
    },
    home: {
      // Lo que el próximo corte le pagará: el saldo de #562.
      balance: 'Su próximo pago',
    },
    agreement: {
      channelRatesHint:
        'Déjalo en blanco para cobrar la comisión por defecto en ese canal. Un 0 significa que no se cobra nada.',
      channelRateDefault: 'Por defecto',
      noChannelRates: 'Sin tarifas por canal',
    },
  },
  sales: {
    nav: {
      sales: 'Ventas',
      channels: 'Canales de venta',
      guided: 'Ventas',
      counterSale: 'Vender en mostrador',
    },
    counterSale: {
      title: 'Venta en mostrador',
      steps: {
        channel: 'Canal',
        lines: 'Productos',
        payment: 'Cobro',
        summary: 'Resumen',
      },
      channelHint: 'Elija el canal por el que se hace esta venta.',
      linesHint: 'Agregue los productos publicados que está vendiendo.',
      addLine: 'Agregar producto',
      removeLine: 'Quitar',
      removeLineNamed: 'Quitar {{name}}',
      tender: {
        cash: 'Efectivo',
        card: 'Tarjeta',
        voucher: 'Vale',
        transfer: 'Transferencia',
      },
      quantity: 'Cantidad',
      offering: 'Producto',
      total: 'Total',
      paymentMethod: 'Forma de pago',
      tax: {
        idType: 'Facturar a',
        idTypes: { cf: 'Consumidor final', nit: 'NIT', cui: 'CUI' },
        taxId: 'Número de NIT o CUI',
        name: 'Nombre en la factura',
        billedTo: 'Facturado a',
      },
      charge: 'Cobrar',
      sold: 'Venta registrada',
      soldDetail: 'La existencia ya se descontó y el pedido quedó registrado.',
      newSale: 'Nueva venta',
      emptyLines: 'Agregue al menos un producto para cobrar.',
    },
  },
  marketplaceAdmin: {
    nav: {
      // Moved out of the `app:` catalog with the nav table itself: this copy
      // belongs to the shell that owns the screens, so a second host mounting
      // it does not re-translate them.
      catalog: 'Catálogo',
      products: 'Productos',
      brands: 'Marcas',
      deviceModels: 'Modelos de teléfono',
      categories: 'Categorías',
      offerings: 'Ofertas comerciales',
      offeringPrices: 'Precios de oferta',
      // La sección Asistentes. El *nombre del nivel* ("Asistentes") sale de
      // `nav.screenType.wizard`; esto nombra el grupo dentro de él.
      guided: 'Catálogo',
    },
    /**
     * El asistente de alta de producto. Los nombres de los pasos son de este
     * dominio, no del control — por eso viven acá y no en `controls`.
     */
    /**
     * La página de una oferta reúne lo que antes eran tres pantallas (#564):
     * cada región lee y escribe en su propio servicio.
     */
    offering: {
      // Junto al precio en la lista de ofertas, cuando no es por una unidad:
      // la columna de la unidad dice cuál (ADR 0082 §5).
      pricePer: 'por {{quantity}}',
      saleUnit: {
        resets:
          'El paso y la cantidad mínima vuelven a una unidad completa de la unidad nueva. Después de publicar la oferta, la unidad ya no cambia.',
      },
      stockSource: {
        hint: 'Una caja, un rollo o una docena se vende del inventario de otra oferta: cada una que se vende toma esta cantidad de ella, así la caja y las sueltas comparten un mismo saldo.',
        loading: 'Cargando tus ofertas…',
        none: 'Ninguna: tiene su propio inventario',
        factor: 'Cada una toma',
        notCounted:
          'Una presentación se vende por unidad. Primero define la unidad de esta oferta en piezas.',
      },
      regions: {
        images: 'Imágenes',
        prices: 'Precios',
        stock: 'Existencias',
        movements: 'Movimientos de inventario',
      },
      images: {
        none: 'Esta especificación todavía no tiene imágenes.',
        edit: 'Editar especificación',
        shared:
          'Las imágenes son de la especificación: cambiarlas cambia también las demás ofertas que la usan.',
        previous: 'Imagen anterior',
        next: 'Imagen siguiente',
        position: '{{index}} de {{total}}',
      },
    },
    // Dónde baja un precio con la cantidad (ADR 0082 §8): el formulario
    // que abre `set-price-tiers`.
    price: {
      tiers: {
        hint: 'Desde cada cantidad, toda la línea cuesta el precio que pongas aquí, por la misma cantidad que el precio base. Cada tramo empieza más arriba y cuesta menos que el anterior.',
        none: 'Sin precios por volumen: toda cantidad se cobra al precio base.',
        loading: 'Cargando el producto…',
        row: 'Tramo {{position}}',
        remove: 'Quitar el tramo {{position}}',
        add: 'Agregar un tramo',
      },
    },
    /** La página de una especificación: sus ofertas, y cómo ofertarla. */
    product: {
      regions: {
        offerings: 'Ofertas de este producto',
      },
    },
    wizard: {
      productSetup: {
        title: 'Nuevo producto',
        launch: 'Nuevo producto guiado',
        steps: {
          start: 'Origen',
          source: 'Producto base',
          identity: 'Identificación',
          classification: 'Clasificación',
          summary: 'Resumen',
        },
        start: {
          question: '¿Cómo desea empezar?',
          blank: 'Desde cero',
          blankHint: 'Cargar los datos a mano.',
          duplicate: 'Duplicar uno existente',
          duplicateHint:
            'Partir de un producto ya cargado. El código no se copia: identifica al original.',
        },
        source: {
          prompt: 'Elija el producto del que desea partir.',
          chosen: 'Producto base: {{name}}',
          required: 'Elija un producto para continuar.',
        },
        summary: {
          prompt: 'Revise lo cargado antes de crearlo.',
          origin: 'Origen',
          originBlank: 'Desde cero',
          originDuplicate: 'Duplicado de {{name}}',
          empty: 'Sin definir',
        },
        recap: 'Ya había respondido:',
        fits: {
          universal: 'Universal: le queda a cualquier teléfono',
          universalShort: 'Universal',
          universalHint:
            'Marque esta opción para cargadores, cables y soportes. No se combina con modelos.',
        },
      },
    },
  },
  systemManagement: {
    nav: {
      section: 'Sistema',
      configuration: 'Configuración',
    },
    configuration: {
      title: 'Configuración de la plataforma',
      description:
        'Parámetros que cada servicio resuelve al arrancar. Editar un valor afecta al servicio en su próximo arranque.',
      secretPlaceholder: '•••••• (sin cambios)',
      secretHint:
        'Dejar en blanco mantiene el valor guardado. Escribir uno nuevo lo reemplaza.',
    },
  },
};
