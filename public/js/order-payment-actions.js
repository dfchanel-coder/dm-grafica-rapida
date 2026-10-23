import { api, escapeHtml, formatMoney } from "./api.js";
import { PAYMENT_LABELS, totalsHtml } from "./payment-ui.js";
export async function mountPaymentActions(container, order, email, onUpdated) {
  if (!email || order.paid_at || !["pending_payment", "failed"].includes(order.status)) return;
  const section = document.createElement("section");
  section.className = "summary-card";
  section.innerHTML = '<h3>Elegir o cambiar medio de pago</h3><p role="status">Consultando opciones…</p>';
  container.appendChild(section);
  try {
    const preview = await api.orderPaymentOptions(order.code, email);
    if (!section.isConnected) return;
    const methods = Object.keys(preview.methods).filter(key => preview.methods[key]);
    if (!methods.length) { section.innerHTML = '<p>No hay medios de pago habilitados en este momento. Contactanos para continuar.</p>'; return; }
    section.innerHTML = `<h3>Elegir o cambiar medio de pago</h3><label class="field"><span class="field__label">Medio de pago</span><select class="select">${methods.map(method => `<option value="${method}" ${method === order.payment_provider ? "selected" : ""}>${PAYMENT_LABELS[method]} — ${formatMoney(preview.totals[method].total)}</option>`).join("")}</select></label><div data-detail aria-live="polite"></div><p>Revisá el total antes de confirmar. Los enlaces de pago anteriores dejarán de ser válidos para confirmar este pedido automáticamente.</p><button class="btn btn--primary" type="button">Confirmar medio y total</button><p data-message role="status"></p>`;
    const select = section.querySelector("select"), button = section.querySelector("button");
    const render = () => { section.querySelector("[data-detail]").innerHTML = totalsHtml(preview.totals[select.value]); };
    select.addEventListener("change", render); render();
    button.addEventListener("click", async () => {
      button.disabled = true; select.disabled = true;
      try {
        const result = await api.changeOrderPayment({ code: order.code, email, method: select.value, expected_total: preview.totals[select.value].total, revision: preview.revision });
        if (result.checkout_url) { location.href = result.checkout_url; return; }
        onUpdated(result.order);
      } catch (error) {
        section.querySelector("[data-message]").textContent = error.message + " Actualizá el estado del pedido para volver a intentarlo.";
      }
    });
  } catch (error) { section.innerHTML = `<p>${escapeHtml(error.message)}</p>`; }
}
