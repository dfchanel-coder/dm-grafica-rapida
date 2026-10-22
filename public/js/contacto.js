/**
 * Formulario de contacto: genera una consulta en el panel de administración
 * y avisa al administrador por correo.
 */

import { api } from "./api.js";
import { el, clear, toast } from "./ui.js";

const form = el("[data-contact-form]");
const feedback = el("[data-contact-feedback]");

function showFeedback(message, type = "success") {
  if (!feedback) return;
  clear(feedback).innerHTML = `
    <div class="alert alert--${type}" role="status">
      ${message}
    </div>`;
}

function collect() {
  const value = (id) => (el(`#${id}`, form)?.value || "").trim();
  return {
    name: value("nombre"),
    email: value("email"),
    phone: value("telefono"),
    subject: value("asunto"),
    message: value("mensaje"),
  };
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const submit = el("[data-contact-submit]", form);
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  if (submit) {
    submit.disabled = true;
    submit.textContent = "Enviando…";
  }

  try {
    const payload = await api.createInquiry(collect());
    form.reset();
    showFeedback(payload?.message || "Gracias por escribirnos. Te respondemos a la brevedad.");
    toast("Consulta enviada.", "success");
  } catch (error) {
    showFeedback(error?.message || "No pudimos enviar tu consulta. Probá de nuevo.", "error");
    toast("No pudimos enviar la consulta.", "error");
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = "Enviar consulta";
    }
  }
});
