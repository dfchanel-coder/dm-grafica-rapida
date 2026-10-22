import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validación de la firma que Mercado Pago manda en los webhooks.
 *
 * Manifiesto documentado:
 *   id:{data.id};request-id:{x-request-id};ts:{ts};
 *
 * Además de la firma se verifica que la notificación no sea vieja: una
 * petición capturada hace tiempo no sirve para reenviar un pago.
 */
export function validateMercadoPagoSignature({
  signature,
  requestId,
  dataId,
  secret,
  maxAgeSeconds = 300,
  now = Date.now(),
}) {
  if (!signature || !requestId || !dataId || !secret) return false;

  const fields = Object.fromEntries(
    signature.split(",").map((part) => {
      const separator = part.indexOf("=");
      return separator < 0
        ? ["", ""]
        : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    }),
  );

  const timestamp = fields.ts;
  const received = fields.v1;
  if (!timestamp || !/^[a-f0-9]{64}$/i.test(received || "")) return false;

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  if (maxAgeSeconds > 0 && Math.abs(now / 1000 - seconds) > maxAgeSeconds) return false;

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const expected = createHmac("sha256", secret).update(manifest).digest();
  const actual = Buffer.from(received, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
