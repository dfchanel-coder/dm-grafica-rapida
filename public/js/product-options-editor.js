import { escapeHtml } from "./api.js";

// Conserva identificadores y valores existentes: los carritos guardados los usan.
export function productOptionsEditor(container, initial = []) {
  let options = structuredClone(initial);
  const types = { select: "Lista de valores", checkbox: "Casilla", text: "Texto corto", textarea: "Texto largo", number: "Número" };
  const input = (label, key, value, type = "text") => `<label class="field"><span class="field__label">${label}</span><input class="input" data-key="${key}" type="${type}" value="${escapeHtml(String(value ?? ""))}"></label>`;
  function render() {
    container.innerHTML = options.map((option, index) => `<fieldset class="admin-form__section" data-option="${index}"><legend>Opción ${index + 1}</legend>
      ${input("Nombre visible", "label", option.label)}
      ${input("Ayuda para el cliente", "help", option.help || "")}
      <label class="field"><span class="field__label">Tipo</span><select class="select" data-key="type">${Object.entries(types).map(([value, label]) => `<option value="${value}" ${value === option.type ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label class="checkbox"><input type="checkbox" data-key="required" ${option.required ? "checked" : ""}><span>Obligatoria</span></label>
      ${option.type === "checkbox" ? input("Recargo (UYU)", "price_delta", option.price_delta || 0, "number") : ""}
      ${option.type === "number" ? input("Mínimo", "min", option.min ?? 1, "number") + input("Máximo", "max", option.max ?? 9999, "number") : ""}
      ${["text", "textarea"].includes(option.type) ? input("Máximo de caracteres", "max_length", option.max_length ?? 120, "number") : ""}
      ${option.type === "select" ? `<div>${(option.options || []).map((choice, choiceIndex) => `<div class="admin-form__grid" data-choice="${choiceIndex}">${input("Valor visible", "label", choice.label)}${input("Recargo (UYU)", "price_delta", choice.price_delta || 0, "number")}<button type="button" class="btn btn--secondary btn--sm" data-action="remove-choice">Quitar valor</button></div>`).join("")}</div><button type="button" class="btn btn--secondary btn--sm" data-action="add-choice" ${(option.options || []).length >= 30 ? "disabled" : ""}>Agregar valor</button>` : ""}
      <button type="button" class="btn btn--secondary btn--sm" data-action="remove">Quitar opción</button></fieldset>`).join("") + `<button type="button" class="btn btn--secondary" data-action="add" ${options.length >= 10 ? "disabled" : ""}>Agregar opción</button><p class="admin-block__note">Hasta 10 opciones y 30 valores por lista.</p>`;
  }
  container.addEventListener("input", (event) => {
    const field = event.target;
    if (!field.dataset.key) return;
    const option = options[Number(field.closest("[data-option]").dataset.option)];
    const choice = field.closest("[data-choice]");
    const target = choice ? option.options[Number(choice.dataset.choice)] : option;
    target[field.dataset.key] = field.type === "checkbox" ? field.checked : field.type === "number" ? Number(field.value) : field.value;
    if (field.dataset.key === "type") render();
  });
  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const index = Number(button.closest("[data-option]")?.dataset.option);
    const id = () => crypto.randomUUID().replaceAll("-", "_");
    switch (button.dataset.action) {
      case "add": options.push({ id: id(), label: "", type: "select", required: false, options: [] }); break;
      case "remove": options.splice(index, 1); break;
      case "add-choice": (options[index].options ||= []).push({ value: id(), label: "", price_delta: 0 }); break;
      case "remove-choice": options[index].options.splice(Number(button.closest("[data-choice]").dataset.choice), 1); break;
    }
    render();
  });
  render();
  return () => structuredClone(options);
}
