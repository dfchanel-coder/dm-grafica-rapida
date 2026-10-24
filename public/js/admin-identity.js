import { escapeHtml } from "./api.js";
// La contraseña se mantiene únicamente en el formulario y no se guarda.
export function confirmIdentity(verify, security = {}) {
  return new Promise((resolve, reject) => {
    const dialog = document.createElement("dialog");
    dialog.className = "identity-dialog";
    dialog.setAttribute("aria-labelledby", "identity-title");
    dialog.innerHTML = `<form><input type="text" name="username" autocomplete="username" value="${escapeHtml(security.email || "")}" hidden><h2 id="identity-title">Confirmá tu identidad</h2><p>Para esta operación sensible, ingresá tu contraseña actual. Tu sesión seguirá abierta.</p><label class="field"><span class="field__label">Contraseña actual</span><input class="input" type="password" autocomplete="current-password" maxlength="1024" required autofocus></label>${security.enabled ? '<label class="field"><span class="field__label">Código de autenticador o recuperación</span><input class="input" name="code" autocomplete="one-time-code" maxlength="80" required></label>' : ""}<p role="alert"></p><div class="admin-form__actions"><button type="button" class="btn btn--secondary">Cancelar</button><button type="submit" class="btn btn--primary">Confirmar</button></div></form>`;
    document.body.appendChild(dialog);
    const form = dialog.querySelector("form"), input = dialog.querySelector('[type="password"]'), error = dialog.querySelector('[role="alert"]'), submit = dialog.querySelector('[type="submit"]');
    const close = () => { input.value = ""; dialog.close(); dialog.remove(); };
    const cancel = () => { close(); reject(new Error("Operación cancelada. No se guardaron cambios.")); };
    dialog.addEventListener("cancel", event => { event.preventDefault(); cancel(); });
    dialog.querySelector('[type="button"]').addEventListener("click", cancel);
    form.addEventListener("submit", async event => {
      event.preventDefault(); submit.disabled = true; error.textContent = "";
      try { await verify(input.value, form.elements.code?.value || ""); close(); resolve(); }
      catch (err) { input.value = ""; error.textContent = err.message || "No se pudo verificar la contraseña."; submit.disabled = false; input.focus(); }
    });
    dialog.showModal();
  });
}
