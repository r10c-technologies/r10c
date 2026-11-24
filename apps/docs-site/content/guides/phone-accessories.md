---
title: Guía para una tienda de accesorios de celular
description: Fundas, vidrios y cargadores por pieza, cada uno ajustado a los teléfonos con los que funciona.
order: 2
---

En una tienda de accesorios, la pregunta del comprador no es qué producto es,
sino si le queda a su teléfono. Esta guía recorre lo que la plataforma ya hace
por esa tienda y nombra el caso de uso detrás de cada paso.

## 1. Dejar la tienda lista

- Registrar los datos fiscales de la tienda
  :use-case[party-management:organization:set-fiscal-identity] y el número de
  WhatsApp que verá el comprador
  :use-case[party-management:organization:set-whatsapp-number].
- Decidir si se aceptan enlaces de pago
  :use-case[party-management:organization:set-payment-link-acceptance].

## 2. Dar de alta el catálogo

- Crear cada producto con su asistente, y marcar en él los modelos de teléfono
  a los que les queda, o que es universal
  :use-case[product-configuration-management:product-offering:write].
- La lista de modelos es de la plataforma, la misma para todas las tiendas; un
  modelo que ya no se vende se retira, y se puede restaurar
  :use-case[catalog-reference:device-model:retire],
  :use-case[catalog-reference:device-model:restore].
- Cuando una ficha cambia, revisarla y liberar la versión nueva
  :use-case[product-configuration-management:product-specification:revise],
  :use-case[product-configuration-management:product-specification:release].
- Bajar el precio por volumen si se vende al mayoreo
  :use-case[product-configuration-management:product-offering-price:set-price-tiers].

## 3. Contar la existencia

- Registrar la mercadería que entra y los conteos como movimientos
  :use-case[stock-management:stock-movement:write], y consultar la posición
  :use-case[stock-management:stock-item:read].

## 4. Publicar, y que el comprador encuentre lo suyo

- Publicar la oferta :use-case[product-configuration-management:product-offering:publish].
- En la tienda en línea, el comprador filtra por el modelo de su teléfono y ve
  solo lo que le queda, más lo universal
  :use-case[marketplace-catalog:published-offering:filter-by-device].

## 5. Vender, despachar y entregar

- Venta en línea :use-case[order-management:checkout-group:checkout] y en el
  mostrador :use-case[sales-management:sales-channel:sell].
- Despachar con guía y registrar la entrega, el rechazo o la devolución
  :use-case[shipping-order-management:shipping-order:record-guide],
  :use-case[shipping-order-management:shipping-order:dispatch],
  :use-case[shipping-order-management:shipping-order:record-delivery],
  :use-case[shipping-order-management:shipping-order:record-refusal],
  :use-case[shipping-order-management:shipping-order:record-return].
- Cancelar cuando corresponde :use-case[order-management:product-order:cancel].

## 6. Ver lo que se liquida

- Los términos de comisión :use-case[settlement-management:agreement:read], los
  apuntes de cada venta :use-case[settlement-management:commission-entry:read]
  y el pago de cada corte :use-case[settlement-management:vendor-payout:read].
  Entregar ese pago está planificado
  :use-case[settlement-management:vendor-payout:disburse].
