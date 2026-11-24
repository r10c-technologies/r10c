---
title: Guía para una peletería
description: Material para zapatería vendido por yarda, por par y por litro, con cortes que salen del mismo rollo.
order: 3
---

Una peletería vende material para quien fabrica o repara calzado: el sintético se
corta por yarda, las suelas van por par y el pegamento por litro. Esta guía
recorre lo que la plataforma ya hace por esa tienda y nombra el caso de uso
detrás de cada paso.

> Las unidades de venta siguen la decisión todavía propuesta sobre cómo se vende
> una oferta (unidad y paso). Las llamadas con peleterías pueden cambiar qué
> unidades se ofrecen; esta guía se revisa entonces.

## 1. Dejar la tienda lista

- Registrar los datos fiscales de la tienda
  :use-case[party-management:organization:set-fiscal-identity] y el número de
  WhatsApp que verá el comprador
  :use-case[party-management:organization:set-whatsapp-number].

## 2. Dar de alta el catálogo

- Crear cada producto con su asistente
  :use-case[product-configuration-management:product-offering:write].
- Decir en qué se vende: el sintético por yarda con paso de un cuarto, la suela
  por par, el pegamento por litro
  :use-case[product-configuration-management:product-offering:set-sale-unit].
- Vender un rollo entero o un paquete de suelas descontando de la misma
  existencia que el corte suelto
  :use-case[product-configuration-management:product-offering:draw-on-stock].
- Bajar el precio por volumen para el taller que compra en cantidad
  :use-case[product-configuration-management:product-offering-price:set-price-tiers].

## 3. Contar la existencia

- Registrar la mercadería que entra, los cortes de inventario y las mermas como
  movimientos :use-case[stock-management:stock-movement:write], y consultar la
  posición :use-case[stock-management:stock-item:read].

## 4. Publicar y vender

- Publicar la oferta :use-case[product-configuration-management:product-offering:publish].
- Venta en línea :use-case[order-management:checkout-group:checkout] y en el
  mostrador, que en una peletería es la mayor parte
  :use-case[sales-management:sales-channel:sell].

## 5. Despachar y entregar

- Despachar con guía y registrar el resultado
  :use-case[shipping-order-management:shipping-order:record-guide],
  :use-case[shipping-order-management:shipping-order:dispatch],
  :use-case[shipping-order-management:shipping-order:record-delivery].
- Cancelar cuando corresponde; lo cortado regresa a la existencia como
  movimiento :use-case[order-management:product-order:cancel].

## 6. Ver lo que se liquida

- Los términos :use-case[settlement-management:agreement:read], los apuntes
  :use-case[settlement-management:commission-entry:read] y el pago de cada corte
  :use-case[settlement-management:vendor-payout:read]. Entregar ese pago está
  planificado :use-case[settlement-management:vendor-payout:disburse].
