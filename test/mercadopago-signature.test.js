import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { validateMercadoPagoSignature } from "../src/mercadopago-signature.js";

/**
 * El webhook de Mercado Pago es la única vía para dar por pagado un pedido.
 * Si la firma no se valida bien, cualquiera podría "pagar" un pedido falso.
 */

const SECRET = "secreto-de-prueba-para-el-webhook";
const DATA_ID = "123456789";
const REQUEST_ID = "req-abc-123";

function sign({ dataId = DATA_ID, requestId = REQUEST_ID, ts, secret = SECRET } = {}) {
  const timestamp = String(ts);
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${timestamp},v1=${v1}`;
}

describe("validateMercadoPagoSignature", () => {
  it("acepta una firma válida y reciente", () => {
    const now = Date.now();
    const signature = sign({ ts: Math.floor(now / 1000) });

    assert.equal(
      validateMercadoPagoSignature({
        signature,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
        now,
      }),
      true,
    );
  });

  it("acepta el id de pago en minúsculas y en mayúsculas", () => {
    const now = Date.now();
    const signature = sign({ ts: Math.floor(now / 1000), dataId: "abc123" });

    assert.equal(
      validateMercadoPagoSignature({
        signature,
        requestId: REQUEST_ID,
        dataId: "ABC123",
        secret: SECRET,
        now,
      }),
      true,
    );
  });

  it("rechaza una firma hecha con otro secreto", () => {
    const now = Date.now();
    const signature = sign({ ts: Math.floor(now / 1000), secret: "otro-secreto" });

    assert.equal(
      validateMercadoPagoSignature({
        signature,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
        now,
      }),
      false,
    );
  });

  it("rechaza si cambia el id del pago", () => {
    const now = Date.now();
    const signature = sign({ ts: Math.floor(now / 1000) });

    assert.equal(
      validateMercadoPagoSignature({
        signature,
        requestId: REQUEST_ID,
        dataId: "999999999",
        secret: SECRET,
        now,
      }),
      false,
    );
  });

  it("rechaza si cambia el request-id", () => {
    const now = Date.now();
    const signature = sign({ ts: Math.floor(now / 1000) });

    assert.equal(
      validateMercadoPagoSignature({
        signature,
        requestId: "req-otro",
        dataId: DATA_ID,
        secret: SECRET,
        now,
      }),
      false,
    );
  });

  it("rechaza una notificación vieja (replay)", () => {
    const now = Date.now();
    const oldTs = Math.floor(now / 1000) - 3_600;
    const signature = sign({ ts: oldTs });

    assert.equal(
      validateMercadoPagoSignature({
        signature,
        requestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
        now,
      }),
      false,
    );
  });

  it("rechaza si falta cualquier dato", () => {
    const now = Date.now();
    const signature = sign({ ts: Math.floor(now / 1000) });
    const base = { signature, requestId: REQUEST_ID, dataId: DATA_ID, secret: SECRET, now };

    assert.equal(validateMercadoPagoSignature({ ...base, signature: "" }), false);
    assert.equal(validateMercadoPagoSignature({ ...base, requestId: "" }), false);
    assert.equal(validateMercadoPagoSignature({ ...base, dataId: "" }), false);
    assert.equal(validateMercadoPagoSignature({ ...base, secret: "" }), false);
  });

  it("rechaza una firma con formato inválido", () => {
    const now = Date.now();

    assert.equal(
      validateMercadoPagoSignature({
        signature: "ts=123,v1=zzzz",
        requestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
        now,
      }),
      false,
    );

    assert.equal(
      validateMercadoPagoSignature({
        signature: "basura",
        requestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
        now,
      }),
      false,
    );
  });
});
