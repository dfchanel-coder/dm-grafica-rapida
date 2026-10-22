import { ValidationError, cleanInteger, cleanText } from "./validate.js";

/**
 * Cálculo de precios. Regla central del proyecto:
 * el precio SIEMPRE sale de la base de datos. El cliente elige opciones y
 * cantidades, pero nunca dice cuánto cuesta.
 */

/**
 * Resuelve las opciones que eligió el cliente contra la definición del
 * producto y devuelve la foto de las opciones con su recargo.
 *
 * @param {Array} productOptions Definición guardada en products.options
 * @param {Object} selection    Mapa { idOpcion: valor } enviado por el cliente
 * @returns {{ snapshot: Array, delta: number }}
 */
export function resolveSelection(productOptions, selection = {}) {
  const snapshot = [];
  let delta = 0;

  for (const definition of productOptions || []) {
    const raw = selection?.[definition.id];

    if (definition.type === "select") {
      const choice = definition.options?.find((option) => option.value === raw);
      if (!choice) {
        if (definition.required) {
          throw new ValidationError(`Elegí "${definition.label}".`, definition.id);
        }
        continue;
      }
      delta += choice.price_delta || 0;
      snapshot.push({
        id: definition.id,
        label: definition.label,
        value: choice.label,
        price_delta: choice.price_delta || 0,
      });
      continue;
    }

    if (definition.type === "number") {
      const value = cleanInteger(raw ?? definition.min ?? 1, {
        min: definition.min ?? 1,
        max: definition.max ?? 9999,
        field: definition.id,
        label: definition.label,
      });
      snapshot.push({ id: definition.id, label: definition.label, value: String(value), price_delta: 0 });
      continue;
    }

    if (definition.type === "checkbox") {
      const enabled = raw === true || raw === "true" || raw === "on" || raw === "1";
      const optionDelta = enabled ? definition.price_delta || 0 : 0;
      delta += optionDelta;
      snapshot.push({
        id: definition.id,
        label: definition.label,
        value: enabled ? "Sí" : "No",
        price_delta: optionDelta,
      });
      continue;
    }

    const empty = raw === undefined || raw === null || String(raw).trim() === "";
    if (empty) {
      if (definition.required) {
        throw new ValidationError(`Completá "${definition.label}".`, definition.id);
      }
      continue;
    }

    const value = cleanText(raw, {
      max: definition.max_length || (definition.type === "textarea" ? 500 : 120),
      field: definition.id,
      label: definition.label,
    });
    snapshot.push({ id: definition.id, label: definition.label, value, price_delta: 0 });
  }

  return { snapshot, delta };
}

/**
 * Precio unitario final de un producto: base + recargos de las opciones.
 */
export function unitPriceFor(product, selection) {
  const { delta } = resolveSelection(product.options, selection);
  return Math.max(0, Number(product.price || 0) + delta);
}

/**
 * Totales del pedido: subtotal, descuento, envío, impuestos y total.
 * Los descuentos de cupón se calculan sobre el subtotal.
 */
export function calculateTotals({ subtotal, shippingCost = 0, discount = 0, tax = {} }) {
  const safeSubtotal = Math.max(0, Math.round(subtotal));
  const safeDiscount = Math.min(Math.max(0, Math.round(discount)), safeSubtotal);
  const base = safeSubtotal - safeDiscount;
  const includeTax = tax.include_tax !== false;
  const rate = Number(tax.rate || 0);
  const taxAmount = includeTax ? 0 : Math.round(base * (rate / 100));
  const safeShipping = Math.max(0, Math.round(shippingCost));
  return {
    subtotal: safeSubtotal,
    discount: safeDiscount,
    shipping: safeShipping,
    tax: taxAmount,
    total: base + taxAmount + safeShipping,
  };
}

/**
 * Costo de envío según los ajustes del sitio.
 * Devuelve 0 cuando corresponde envío gratis o cuando el cliente retira.
 */
export function shippingCostFor({ settings, subtotal, deliveryMethod }) {
  if (deliveryMethod === "pickup") return 0;
  const checkout = settings.checkout || {};
  const cost = Number(checkout.shipping_cost || 0);
  const threshold = Number(checkout.free_shipping_threshold || 0);
  if (threshold > 0 && subtotal >= threshold) return 0;
  return Math.max(0, cost);
}
