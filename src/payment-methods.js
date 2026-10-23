import { ValidationError } from "./validate.js";
import { checkoutEnabled } from "./payments.js";
export function paymentMethods(settings) {
  return {
    mercadopago: settings.payments?.mercadopago_enabled !== false && checkoutEnabled(),
    transfer: settings.payments?.transfer?.enabled === true,
    cash: settings.payments?.cash?.enabled === true,
  };
}
export function paymentSnapshot(settings, method) {
  if (method === "transfer") return structuredClone(settings.payments.transfer);
  if (method === "cash") return structuredClone(settings.payments.cash);
  return {};
}
export function requirePaymentMethod(settings, method, { quote = false } = {}) {
  if (!["mercadopago", "transfer", "cash"].includes(method)) throw new ValidationError("Elegí un medio de pago válido.", "payment_method");
  if (!paymentMethods(settings)[method] && !(quote && method === "mercadopago")) throw new ValidationError("Ese medio de pago no está disponible. Elegí otro.", "payment_method");
}
