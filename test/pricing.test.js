import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateTotals,
  resolveSelection,
  shippingCostFor,
  unitPriceFor,
} from "../src/pricing.js";
import { ValidationError } from "../src/validate.js";

/**
 * Estas pruebas cubren la regla central del proyecto: el precio siempre sale
 * de la base de datos y el navegador nunca puede influenciar el total.
 */

describe("resolveSelection", () => {
  const productOptions = [
    {
      id: "papel",
      label: "Papel",
      type: "select",
      required: true,
      options: [
        { value: "fotografico", label: "Papel fotográfico", price_delta: 500 },
        { value: "kraft", label: "Papel kraft", price_delta: 0 },
      ],
    },
    { id: "cantidad", label: "Cantidad", type: "number", min: 50, max: 5000 },
    { id: "laminado", label: "Laminado", type: "checkbox", price_delta: 300 },
    { id: "nota", label: "Nota", type: "textarea", max_length: 200 },
  ];

  it("devuelve la foto de las opciones y el recargo total", () => {
    const options = [
      {
        id: "papel",
        label: "Papel",
        type: "select",
        required: true,
        options: [
          { value: "fotografico", label: "Papel fotográfico", price_delta: 500 },
          { value: "kraft", label: "Papel kraft", price_delta: 0 },
        ],
      },
      { id: "cantidad", label: "Cantidad", type: "number", min: 50, max: 5000 },
      { id: "laminado", label: "Laminado", type: "checkbox", price_delta: 300 },
      { id: "nota", label: "Nota", type: "textarea", max_length: 200 },
    ];
    const { snapshot, delta } = resolveSelection(options, {
      papel: "fotografico",
      cantidad: "250",
      laminado: "true",
      nota: "  Llamame antes  ",
    });

    assert.equal(delta, 800);
    assert.equal(snapshot.length, 4);
    assert.deepEqual(
      snapshot.map((option) => option.id),
      ["papel", "cantidad", "laminado", "nota"],
    );
    assert.equal(snapshot[0].value, "Papel fotográfico");
    assert.equal(snapshot[1].value, "250");
    assert.equal(snapshot[2].value, "Sí");
    assert.equal(snapshot[3].value, "Llamame antes");
  });

  it("rechaza una opción obligatoria que no está en la lista", () => {
    assert.throws(
      () => resolveSelection(productOptions, { papel: "cartulina" }),
      (error) => error instanceof ValidationError && error.field === "papel",
    );
  });

  it("rechaza una opción obligatoria vacía", () => {
    const optionsObligatorias = [
      {
        id: "papel",
        label: "Papel",
        type: "select",
        required: true,
        options: [
          { value: "fotografico", label: "Papel fotográfico", price_delta: 500 },
          { value: "kraft", label: "Papel kraft", price_delta: 0 },
        ],
      },
      { id: "nota", label: "Nota", type: "textarea", required: true, max_length: 200 },
    ];
    assert.throws(
      () => resolveSelection(optionsObligatorias, { papel: "kraft", nota: "   " }),
      (error) => error instanceof ValidationError && error.field === "nota",
    );
  });

  it("ignora las opciones opcionales que el cliente no eligió", () => {
    const { snapshot, delta } = resolveSelection(productOptions, { papel: "kraft" });
    assert.equal(delta, 0);
    assert.deepEqual(snapshot.map((option) => option.id).sort(), ["cantidad", "laminado", "papel"]);
  });

  it("no suma recargo cuando la casilla está desmarcada", () => {
    const { delta } = resolveSelection(productOptions, { papel: "kraft", laminado: "false" });
    assert.equal(delta, 0);
  });

  it("respeta el mínimo de una opción numérica", () => {
    assert.throws(
      () => resolveSelection(productOptions, { papel: "kraft", cantidad: "10" }),
      (error) => error instanceof ValidationError && error.field === "cantidad",
    );
  });
});

describe("unitPriceFor", () => {
  it("suma el recargo de las opciones al precio base", () => {
    const product = {
      price: 1000,
      options: [
        {
          id: "talla",
          label: "Talla",
          type: "select",
          options: [
            { value: "chica", label: "Chica", price_delta: 0 },
            { value: "grande", label: "Grande", price_delta: 250 },
          ],
        },
      ],
    };

    assert.equal(unitPriceFor(product, { talla: "chica" }), 1000);
    assert.equal(unitPriceFor(product, { talla: "grande" }), 1250);
  });

  it("nunca devuelve un precio negativo", () => {
    const product = {
      price: 0,
      options: [
        {
          id: "descuento",
          label: "Descuento",
          type: "checkbox",
          price_delta: -500,
        },
      ],
    };

    assert.equal(unitPriceFor(product, { descuento: "true" }), 0);
  });
});

describe("calculateTotals", () => {
  it("calcula el total con descuento y envío", () => {
    const totals = calculateTotals({
      subtotal: 10_000,
      discount: 2_000,
      shippingCost: 1_500,
      tax: { include_tax: true, rate: 22 },
    });

    assert.equal(totals.subtotal, 10_000);
    assert.equal(totals.discount, 2_000);
    assert.equal(totals.shipping, 1_500);
    assert.equal(totals.tax, 0);
    assert.equal(totals.total, 9_500);
  });

  it("agrega el impuesto cuando el precio no lo incluye", () => {
    const totals = calculateTotals({
      subtotal: 10_000,
      discount: 0,
      shippingCost: 0,
      tax: { include_tax: false, rate: 22 },
    });

    assert.equal(totals.tax, 2_200);
    assert.equal(totals.total, 12_200);
  });

  it("nunca deja el descuento por encima del subtotal", () => {
    const totals = calculateTotals({
      subtotal: 1_000,
      discount: 5_000,
      tax: { include_tax: true, rate: 22 },
    });

    assert.equal(totals.discount, 1_000);
    assert.equal(totals.total, 0);
  });

  it("redondea a pesos enteros", () => {
    const totals = calculateTotals({
      subtotal: 1_000.4,
      shippingCost: 12.6,
      tax: { include_tax: true, rate: 22 },
    });

    assert.equal(totals.subtotal, 1_000);
    assert.equal(totals.shipping, 13);
    assert.ok(Number.isInteger(totals.total));
  });

  it("normaliza valores negativos a cero", () => {
    const totals = calculateTotals({
      subtotal: -500,
      discount: -100,
      shippingCost: -80,
      tax: { include_tax: true, rate: 22 },
    });

    assert.equal(totals.subtotal, 0);
    assert.equal(totals.discount, 0);
    assert.equal(totals.shipping, 0);
    assert.equal(totals.total, 0);
  });
});

describe("shippingCostFor", () => {
  const settings = {
    checkout: {
      shipping_cost: 1_200,
      free_shipping_threshold: 15_000,
      allow_pickup: true,
    },
  };

  it("cobra el envío cuando no llega al monto mínimo", () => {
    assert.equal(
      shippingCostFor({ settings, subtotal: 10_000, deliveryMethod: "shipping" }),
      1_200,
    );
  });

  it("deja el envío gratis a partir del monto mínimo", () => {
    assert.equal(
      shippingCostFor({ settings, subtotal: 15_000, deliveryMethod: "shipping" }),
      0,
    );
  });

  it("no cobra envío cuando el cliente retira en el local", () => {
    assert.equal(
      shippingCostFor({ settings, subtotal: 1_000, deliveryMethod: "pickup" }),
      0,
    );
  });

  it("usa el costo configurado aunque no exista monto mínimo", () => {
    const sinMinimo = { checkout: { shipping_cost: 800, free_shipping_threshold: 0 } };
    assert.equal(
      shippingCostFor({ settings: sinMinimo, subtotal: 100_000, deliveryMethod: "shipping" }),
      800,
    );
  });
});
