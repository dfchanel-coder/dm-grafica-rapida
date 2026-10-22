import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ValidationError,
  cleanBoolean,
  cleanEmail,
  cleanImages,
  cleanInteger,
  cleanMultiline,
  cleanPhone,
  cleanProductOptions,
  cleanSlug,
  cleanText,
  generateOrderCode,
  normalizeOrderCode,
  oneOf,
} from "../src/validate.js";

describe("cleanText", () => {
  it("colapsa espacios y recorta", () => {
    assert.equal(cleanText("  hola    mundo  "), "hola mundo");
  });

  it("devuelve cadena vacía cuando no hay valor", () => {
    assert.equal(cleanText(null), "");
    assert.equal(cleanText(undefined), "");
  });

  it("rechaza valores que no son texto", () => {
    assert.throws(() => cleanText(42, { label: "la cantidad" }), ValidationError);
  });

  it("exige el mínimo cuando corresponde", () => {
    assert.throws(() => cleanText("   ", { min: 1, label: "el nombre" }), ValidationError);
  });

  it("corta cuando supera el máximo", () => {
    assert.throws(() => cleanText("a".repeat(50), { max: 10, label: "el texto" }), ValidationError);
  });
});

describe("cleanMultiline", () => {
  it("conserva los saltos de línea y quita el espacio sobrante", () => {
    assert.equal(cleanMultiline("hola   \n  mundo  \n\n\n  otra  "), "hola\nmundo\n\notra");
  });

  it("normaliza los CRLF", () => {
    assert.equal(cleanMultiline("uno\r\ndos"), "uno\ndos");
  });
});

describe("cleanEmail", () => {
  it("pasa a minúsculas", () => {
    assert.equal(cleanEmail("  Cliente@DM.COM "), "cliente@dm.com");
  });

  it("rechaza correos inválidos", () => {
    assert.throws(() => cleanEmail("cliente@"), ValidationError);
    assert.throws(() => cleanEmail("cliente@@dm.com"), ValidationError);
    assert.throws(() => cleanEmail("sin arroba"), ValidationError);
  });
});

describe("cleanPhone", () => {
  it("acepta formatos con espacios y guiones", () => {
    assert.equal(cleanPhone("095 010 244"), "095 010 244");
    assert.equal(cleanPhone("+598 95 010 244"), "+598 95 010 244");
  });

  it("devuelve vacío cuando no hay teléfono", () => {
    assert.equal(cleanPhone(""), "");
  });

  it("rechaza letras", () => {
    assert.throws(() => cleanPhone("llamar al 095"), ValidationError);
  });
});

describe("cleanSlug", () => {
  it("quita tildes y pasa a minúsculas", () => {
    assert.equal(cleanSlug("  Sticker Troquelado  "), "sticker-troquelado");
    assert.equal(cleanSlug("Vinilos Adhesivos"), "vinilos-adhesivos");
  });

  it("conserva los números", () => {
    assert.equal(cleanSlug("Pack 100 unidades"), "pack-100-unidades");
  });

  it("colapsa los guiones repetidos", () => {
    assert.equal(cleanSlug("papel   +  kraft"), "papel-kraft");
  });

  it("rechaza un identificador vacío", () => {
    assert.throws(() => cleanSlug("!!!"), ValidationError);
  });
});

describe("cleanInteger", () => {
  it("acepta números y cadenas numéricas", () => {
    assert.equal(cleanInteger(10), 10);
    assert.equal(cleanInteger("25"), 25);
  });

  it("rechaza valores fuera de rango", () => {
    assert.throws(() => cleanInteger(0, { min: 1, label: "la cantidad" }), ValidationError);
    assert.throws(() => cleanInteger(500, { max: 100, label: "la cantidad" }), ValidationError);
  });

  it("rechaza valores que no son números", () => {
    assert.throws(() => cleanInteger("abc", { label: "la cantidad" }), ValidationError);
  });
});

describe("cleanBoolean y oneOf", () => {
  it("interpreta las formas que llegan del formulario", () => {
    assert.equal(cleanBoolean("true"), true);
    assert.equal(cleanBoolean("1"), true);
    assert.equal(cleanBoolean("on"), false);
    assert.equal(cleanBoolean("", true), true);
    assert.equal(cleanBoolean(undefined, true), true);
  });

  it("rechaza un valor fuera de la lista", () => {
    assert.equal(oneOf("a", ["a", "b"], { label: "el tipo" }), "a");
    assert.throws(() => oneOf("z", ["a", "b"], { label: "el tipo" }), ValidationError);
  });
});

describe("códigos de pedido", () => {
  it("genera códigos con el formato DMR-XXXXXX", () => {
    const code = generateOrderCode();
    assert.match(code, /^DMR-[A-Z2-9]{6}$/);
  });

  it("no repite caracteres ambiguos (0, O, 1, I)", () => {
    for (let i = 0; i < 200; i += 1) {
      assert.doesNotMatch(generateOrderCode(), /[01OI]/);
    }
  });

  it("normaliza lo que el cliente escribe a mano", () => {
    assert.equal(normalizeOrderCode("dmr-4k2p9z"), "DMR-4K2P9Z");
    assert.equal(normalizeOrderCode(" 4k2p9z "), "4K2P9Z");
  });
});

describe("cleanImages", () => {
  it("acepta una lista de objetos con url y alt", () => {
    const images = cleanImages([
      { url: "https://ejemplo.com/a.jpg", alt: "Producto" },
      { url: "http://ejemplo.com/b.png" },
    ]);

    assert.equal(images.length, 2);
    assert.equal(images[0].alt, "Producto");
    assert.equal(images[1].alt, "");
  });

  it("descarta lo que no es una dirección web válida", () => {
    assert.deepEqual(cleanImages([{ url: "javascript:alert(1)" }]), []);
    assert.deepEqual(cleanImages(["no-es-una-url"]), []);
  });

  it("limita la cantidad de imágenes", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      url: `https://ejemplo.com/${index}.jpg`,
    }));
    assert.equal(cleanImages(many).length, 8);
  });
});

describe("cleanProductOptions", () => {
  it("normaliza la definición de una opción", () => {
    const options = cleanProductOptions([
      {
        id: "Papel",
        label: "Papel",
        type: "select",
        required: "true",
        options: [{ value: "kraft", label: "Kraft", price_delta: 0 }],
      },
    ]);

    assert.equal(options[0].id, "papel");
    assert.equal(options[0].required, true);
    assert.equal(options[0].options[0].value, "kraft");
  });

  it("rechaza identificadores repetidos", () => {
    assert.throws(
      () =>
        cleanProductOptions([
          { id: "papel", label: "Papel", type: "text" },
          { id: "papel", label: "Otro papel", type: "text" },
        ]),
      ValidationError,
    );
  });

  it("rechaza un select sin opciones", () => {
    assert.throws(
      () => cleanProductOptions([{ id: "papel", label: "Papel", type: "select", options: [] }]),
      ValidationError,
    );
  });

  it("rechaza un tipo de opción desconocido", () => {
    assert.throws(
      () => cleanProductOptions([{ id: "x", label: "X", type: "archivo" }]),
      ValidationError,
    );
  });
});
