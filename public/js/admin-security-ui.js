import { adminApi, escapeHtml } from "./api.js";
function makeDialog(title) {
  const dialog = document.createElement("dialog"); dialog.className = "identity-dialog";
  dialog.innerHTML = `<h2>${escapeHtml(title)}</h2><div data-content></div><p role="alert"></p><button type="button" class="btn btn--secondary" data-close>Cerrar</button>`;
  document.body.appendChild(dialog);
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener("close", () => dialog.remove()); dialog.showModal();
  return dialog;
}
export async function openSecuritySettings() {
  const status = await adminApi.mfaStatus();
  const dialog = makeDialog("Seguridad de mi cuenta"), content = dialog.querySelector('[data-content]'), error = dialog.querySelector('[role="alert"]');
  content.innerHTML = `<p>Segundo factor: <strong>${status.enabled ? "activado" : "sin activar"}</strong>.</p><p>Tu contraseña y tus permisos actuales se mantienen. Solo activá el segundo factor cuando tengas tu autenticador disponible.</p>`;
  if (!status.configured && !status.enabled) { content.innerHTML += '<p>Falta configurar ADMIN_MFA_KEY en Render. Consultá la guía de seguridad del proyecto.</p>'; return; }
  const button = document.createElement("button"); button.className = "btn btn--primary"; button.textContent = status.enabled ? "Desactivar segundo factor" : "Configurar autenticador"; content.appendChild(button);
  if (status.enabled) content.appendChild(Object.assign(document.createElement("p"), { textContent: `Códigos de recuperación restantes: ${status.remaining}.` }));
  button.onclick = async () => {
    button.disabled = true; error.textContent = "";
    try {
      if (status.enabled) { await adminApi.mfaDisable(); content.textContent = "Segundo factor desactivado. Tu contraseña no cambió."; return; }
      const setup = await adminApi.mfaSetup();
      content.innerHTML = `<p>En tu aplicación de autenticación agregá una cuenta con clave manual, basada en tiempo (TOTP):</p><p><code style="overflow-wrap:anywhere">${escapeHtml(setup.secret)}</code></p><p>Esta clave es secreta. La configuración vence en diez minutos y todavía no está activa.</p><form><label class="field"><span class="field__label">Código de seis dígitos</span><input class="input" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label><button class="btn btn--primary">Verificar y activar</button></form>`;
      content.querySelector("form").onsubmit = async event => {
        event.preventDefault(); const submit = event.target.querySelector("button"); submit.disabled = true;
        try {
          const result = await adminApi.mfaEnable(event.target.elements.code.value);
          content.innerHTML = `<p><strong>Segundo factor activado.</strong> Guardá estos códigos en tu gestor de contraseñas. Se muestran una sola vez y cada uno sirve una vez si perdés el autenticador.</p><pre style="overflow-wrap:anywhere;white-space:pre-wrap">${result.recovery.map(escapeHtml).join("\n")}</pre><p>Tu sesión actual sigue abierta; las otras sesiones se cerraron.</p>`;
          error.textContent = "";
        } catch (err) { error.textContent = err.message; submit.disabled = false; }
      };
    } catch (err) { error.textContent = err.message; button.disabled = false; }
  };
}
export function editAdminAccount(account, current) {
  return new Promise(resolve => {
    const dialog = makeDialog(account ? "Editar administrador" : "Crear administrador");
    const own = account?.id === current.id;
    dialog.querySelector('[data-content]').innerHTML = `<form><label class="field">Nombre<input class="input" name="name" required maxlength="100" value="${escapeHtml(account?.name || "")}"></label>${account ? "" : '<label class="field">Correo<input class="input" name="email" type="email" required maxlength="254"></label>'}<label class="field">${account ? "Nueva contraseña (dejar vacía para conservar)" : "Contraseña"}<input class="input" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="1024" ${account ? "" : "required"}></label><label class="field">Permisos<select class="input" name="role" ${own ? "disabled" : ""}><option value="operator" ${account?.role !== "owner" ? "selected" : ""}>Operador: catálogo y pedidos</option><option value="owner" ${account?.role === "owner" ? "selected" : ""}>Administrador: acceso completo</option></select></label><p>Solo el acceso completo permite administrar cuentas, ajustes y confirmar cobros manuales.</p><label><input type="checkbox" name="active" ${account?.active !== false ? "checked" : ""} ${own ? "disabled" : ""}> Cuenta activa</label><p>Los cambios de contraseña, permisos o estado cierran las sesiones de la cuenta modificada.</p><button class="btn btn--primary">Guardar</button></form>`;
    dialog.addEventListener("close", () => resolve(false), { once: true });
    const form = dialog.querySelector("form");
    form.onsubmit = async event => {
      event.preventDefault(); const submit = form.querySelector('button'); submit.disabled = true;
      const payload = { name: form.elements.name.value, role: form.elements.role.value, active: form.elements.active.checked };
      if (form.elements.password.value) payload.password = form.elements.password.value;
      try {
        if (account) await adminApi.updateAdmin(account.id, payload);
        else await adminApi.createAdmin({ ...payload, email: form.elements.email.value });
        resolve(true); dialog.close();
        if (own && payload.password) location.reload();
      } catch (err) { dialog.querySelector('[role="alert"]').textContent = err.message; submit.disabled = false; }
    };
  });
}
