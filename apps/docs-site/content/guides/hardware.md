---
title: Guía para una ferretería
description: De abrir la tienda a cobrar la comisión, para quien vende cable por metro, tornillos por ciento y clavos por libra.
order: 1
---

Una ferretería vende casi nada por pieza. El cable se corta por metro, el tornillo
se cuenta por ciento, el clavo se pesa por libra, y el mismo producto se vende
suelto y en caja. Esta guía recorre lo que la plataforma ya hace por esa tienda,
paso a paso, y nombra el caso de uso detrás de cada paso.

## 1. Dejar la tienda lista

- Registrar los datos fiscales de la tienda, que van en cada factura electrónica:
  :use-case[party-management:organization:set-fiscal-identity].
- Indicar el número de WhatsApp que verá el comprador:
  :use-case[party-management:organization:set-whatsapp-number].
- Decidir si se aceptan enlaces de pago, el pago que el comprador hace fuera de
  la plataforma y el vendedor confirma:
  :use-case[party-management:organization:set-payment-link-acceptance].

## 2. Dar de alta el catálogo

- Crear cada producto con su asistente: la ficha técnica y la oferta que se
  publica en la tienda :use-case[product-configuration-management:product-offering:write].
- Decir en qué se vende cada oferta y de a cuánto: el cable por metro con paso
  de medio metro, el tornillo por ciento, el clavo por libra
  :use-case[product-configuration-management:product-offering:set-sale-unit].
- Vender una caja o un rollo **sin llevar otra existencia**: la presentación
  descuenta de la oferta base, multiplicando por su contenido
  :use-case[product-configuration-management:product-offering:draw-on-stock].
- Bajar el precio por volumen, para toda la línea, desde la cantidad que se
  decida :use-case[product-configuration-management:product-offering-price:set-price-tiers].
- Cuando una ficha cambia, revisarla y liberar la versión nueva; lo ya vendido
  conserva la versión con la que se vendió
  :use-case[product-configuration-management:product-specification:revise],
  :use-case[product-configuration-management:product-specification:release].

## 3. Contar la existencia

- Registrar la mercadería que entra, los conteos y las bajas como movimientos:
  nunca se escribe una cantidad encima de otra
  :use-case[stock-management:stock-movement:write].
- Consultar la posición de cada producto y lo que hay apartado por compras en
  curso :use-case[stock-management:stock-item:read],
  :use-case[stock-management:reservation:read].

## 4. Publicar

- Publicar la oferta en la tienda en línea, y retirarla cuando haga falta
  :use-case[product-configuration-management:product-offering:publish],
  :use-case[product-configuration-management:product-offering:unpublish].

## 5. Vender

- En la tienda en línea, el comprador arma su carrito y paga con tarjeta,
  contra entrega o con enlace de pago
  :use-case[order-management:checkout-group:checkout].
- En el mostrador, la misma venta se hace desde el punto de venta de la tienda,
  con el mismo inventario y el mismo libro de ventas
  :use-case[sales-management:sales-channel:sell].
- Con enlace de pago, la orden espera: el vendedor envía el enlace, recibe el
  comprobante y confirma el pago
  :use-case[order-management:product-order:set-payment-link],
  :use-case[order-management:product-order:attach-payment-evidence],
  :use-case[order-management:product-order:confirm-payment].

## 6. Despachar y entregar

- Anotar la guía del envío y despachar el paquete
  :use-case[shipping-order-management:shipping-order:record-guide],
  :use-case[shipping-order-management:shipping-order:dispatch].
- Registrar lo que pasó: entregado, rechazado o devuelto
  :use-case[shipping-order-management:shipping-order:record-delivery],
  :use-case[shipping-order-management:shipping-order:record-refusal],
  :use-case[shipping-order-management:shipping-order:record-return].
- Cancelar una orden cuando corresponde: la mercadería regresa a la existencia y
  el dinero al comprador :use-case[order-management:product-order:cancel].

## 7. Ver lo que se liquida

- Consultar los términos de comisión acordados con la plataforma
  :use-case[settlement-management:agreement:read].
- Ver los apuntes de comisión de cada venta y los cortes en los que se
  liquidaron :use-case[settlement-management:commission-entry:read],
  :use-case[settlement-management:settlement-run:read].
- Ver el pago que le corresponde en cada corte
  :use-case[settlement-management:vendor-payout:read]. Entregar ese pago a la
  cuenta de la tienda está planificado y todavía no construido
  :use-case[settlement-management:vendor-payout:disburse].
