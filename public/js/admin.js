import { openSecuritySettings, editAdminAccount } from "./admin-security-ui.js";
import { paymentTotals } from "./payment-pricing.js";
import { PAYMENT_LABELS, instructionsHtml } from "./payment-ui.js";
import { productOptionsEditor } from "./product-options-editor.js";
/**
 * Panel de administración de DM Comunicación Visual.
 * Frontend estático sin build: ES modules nativos. Solo usa public/js/api.js y public/js/ui.js.
 */

import {
  adminApi,
  api,
  formatMoney,
  formatDate,
  escapeHtml,
  setCsrfToken,
  getCsrfToken,
  ApiError,
} from "./api.js";
import { el, els, clear, toast, setFieldError, clearFormErrors, initials, withQuery, placeholderImage } from "./ui.js";

const STATUS_ORDER = ["quote", "pending_payment", "paid", "in_production", "ready", "delivered", "cancelled", "refunded", "failed", "review"];

const PRICING_MODE_LABELS = { fixed: "Precio fijo", quote: "A cotizar" };

const DISCOUNT_TYPE_LABELS = { percent: "Porcentaje", fixed: "Monto fijo" };

const INQUIRY_STATUS_LABELS = { new: "Nuevo", read: "Leído", answered: "Respondido", archived: "Archivado" };

const state = {
  admin: null,
  csrfToken: null,
  overview: null,
  settings: null,
  paymentStatus: null,
  products: [],
  categories: [],
  orders: [],
  ordersTotal: 0,
  ordersLimit: 100,
  ordersOffset: 0,
  ordersFilters: { status: "all", q: "", from: "", to: "" },
  ordersCacheAll: [],
  ordersDetail: null,
  inquiries: [],
  coupons: [],
  emails: [],
  audit: [],
  admins: [],
  currentSection: "tablero",
  productImagesDraft: [],
  productImagesDirty: false,
};

const bootEl = el("#admin-boot");
const loginView = el("#login-view");
const appView = el("#app-view");
const loginForm = el("#login-form");
const loginEmail = el("#login-email");
const loginPassword = el("#login-password");
const loginError = el("#login-error");
const loginSubmit = el("#login-submit");
const logoutButton = el("#logout-button");
const adminName = el("#admin-name");
const adminAvatar = el("#admin-avatar");
const adminStatus = el("#admin-status");
const sidebar = el("#admin-sidebar");
const sidebarToggle = el("#sidebar-toggle");
const navLinks = els(".admin-nav__link");
const mainEl = el("#admin-main");

const modal = el("#admin-modal");
const modalOverlay = el("[data-modal-overlay]");
const modalDialog = el(".admin-modal__dialog");
const modalTitle = el("#admin-modal-title");
const modalText = el("#admin-modal-text");
const modalCancel = el("[data-modal-cancel]");
const modalConfirm = el("[data-modal-confirm]");
const modalClose = el("[data-modal-close]");
let modalResolve = null;
let modalLastFocus = null;
let modalFocusables = [];
let modalConfirmAction = null;
let modalSaving = false;

function sectionEl(name) {
  return el(`#section-${name}`);
}

function bodyEl(name) {
  const section = sectionEl(name);
  return section ? el("[data-section-body]", section) : null;
}

function viewEl(name, view) {
  const body = bodyEl(name);
  if (!body) return null;
  return el(`[data-view="${view}"]`, body);
}

function sectionErrorEl(name) {
  const section = sectionEl(name);
  return section ? el("[data-section-error]", section) : null;
}

function announce(message) {
  if (!adminStatus) return;
  adminStatus.textContent = message || "";
}

function setBusy(name, busy) {
  const body = bodyEl(name);
  if (!body) return;
  body.setAttribute("aria-busy", busy ? "true" : "false");
}

function showSectionError(name, message) {
  const err = sectionErrorEl(name);
  if (!err) return;
  if (!message) {
    err.hidden = true;
    err.textContent = "";
    return;
  }
  err.textContent = message;
  err.hidden = false;
}

function clearViews(name) {
  const primary = viewEl(name, "principal");
  const secondary = viewEl(name, "secundario");
  if (primary) clear(primary);
  if (secondary) {
    clear(secondary);
    secondary.hidden = true;
  }
}

function showPrimary(name) {
  const primary = viewEl(name, "principal");
  const secondary = viewEl(name, "secundario");
  if (primary) primary.hidden = false;
  if (secondary) secondary.hidden = true;
}

function showSecondary(name) {
  const primary = viewEl(name, "principal");
  const secondary = viewEl(name, "secundario");
  if (primary) primary.hidden = true;
  if (secondary) {
    secondary.hidden = false;
    secondary.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function showSkeleton(container) {
  if (!container) return;
  clear(container);
  const skeleton = document.createElement("div");
  skeleton.className = "skeleton";
  for (let i = 0; i < 5; i += 1) {
    const row = document.createElement("div");
    row.className = "skeleton__row";
    skeleton.appendChild(row);
  }
  container.appendChild(skeleton);
}

function emptyState(container, title, text) {
  if (!container) return;
  clear(container);
  const block = document.createElement("div");
  block.className = "admin-block";
  block.innerHTML = `<div class="admin-block__head"><h3>${escapeHtml(title)}</h3></div><p class="admin-block__note">${escapeHtml(text || "")}</p>`;
  container.appendChild(block);
}

function statusBadge(status, labels) {
  const label = labels?.[status] || status || "";
  const cls = status === "paid" || status === "delivered" || status === "ready" ? "badge badge--ok"
    : status === "quote" || status === "pending_payment" ? "badge badge--warn"
    : status === "cancelled" || status === "refunded" || status === "failed" ? "badge badge--danger"
    : "badge";
  return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

function badge(text, cls = "") {
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleString("es-UY", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return formatDate(value);
  }
}

function setModalFocusables() {
  if (!modalDialog) return;
  modalFocusables = Array.from(modalDialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter((elNode) => !elNode.hasAttribute("disabled") && elNode.getAttribute("aria-hidden") !== "true");
}

function trapFocus(e) {
  if (e.key !== "Tab" || modal.hidden) return;
  if (modalFocusables.length === 0) {
    e.preventDefault();
    return;
  }
  const first = modalFocusables[0];
  const last = modalFocusables[modalFocusables.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else if (document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function openModal({ title, text, confirmText = "Confirmar", cancelText = "Cancelar", danger = false, onConfirm = null } = {}) {
  if (!modal) return Promise.resolve(false);
  modalLastFocus = document.activeElement;
  modalConfirmAction = onConfirm;
  if (modalTitle) modalTitle.textContent = title || "";
  if (modalText) {
    modalText.innerHTML = "";
    if (typeof text === "string") {
      const p = document.createElement("p");
      p.textContent = text;
      modalText.appendChild(p);
    } else if (text) {
      modalText.appendChild(text);
    }
  }
  if (modalConfirm) {
    modalConfirm.textContent = confirmText;
    modalConfirm.className = danger ? "btn btn--danger" : "btn btn--primary";
  }
  if (modalCancel) modalCancel.textContent = cancelText;
  modal.hidden = false;
  document.body.classList.add("is-modal-open");
  setModalFocusables();
  setTimeout(() => {
    const focusTarget = modalFocusables[0] || modalClose || modalConfirm;
    if (focusTarget) focusTarget.focus();
  }, 10);
  return new Promise((resolve) => {
    modalResolve = resolve;
  });
}

function closeModal(result = false) {
  if (!modal) return;
  if (modalSaving && !result) return;
  modal.hidden = true;
  modalConfirmAction = null;
  document.body.classList.remove("is-modal-open");
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
  if (modalLastFocus && typeof modalLastFocus.focus === "function") {
    try { modalLastFocus.focus(); } catch {}
  }
}

function confirmDialog(message, opts = {}) {
  return openModal({ title: opts.title || "Confirmar", text: message, confirmText: opts.confirmText || "Confirmar", cancelText: opts.cancelText || "Cancelar", danger: opts.danger || false });
}

if (modalOverlay) modalOverlay.addEventListener("click", () => closeModal(false));
if (modalClose) modalClose.addEventListener("click", () => closeModal(false));
if (modalCancel) modalCancel.addEventListener("click", () => closeModal(false));
if (modalConfirm) modalConfirm.addEventListener("click", () => modalConfirmAction ? modalConfirmAction() : closeModal(true));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal && !modal.hidden) {
    e.preventDefault();
    closeModal(false);
  }
  if (e.key === "Tab") trapFocus(e);
});

if (sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    if (!sidebar) return;
    const open = sidebar.getAttribute("data-open") === "true";
    sidebar.setAttribute("data-open", open ? "false" : "true");
    sidebarToggle.setAttribute("aria-expanded", open ? "false" : "true");
  });
}
if (sidebar) {
  sidebar.addEventListener("click", (e) => {
    const link = e.target.closest(".admin-nav__link");
    if (link && window.innerWidth <= 1024) {
      sidebar.setAttribute("data-open", "false");
      if (sidebarToggle) sidebarToggle.setAttribute("aria-expanded", "false");
    }
  });
}

function setUserUI(adminUser) {
  navLinks.forEach(link => {
    const restricted = ["#ajustes", "#correos", "#auditoria", "#administradores"].includes(link.getAttribute("href"));
    link.hidden = restricted && adminUser?.role !== "owner";
  });
  if (logoutButton && !el("#security-settings")) {
    const button = document.createElement("button"); button.id = "security-settings"; button.type = "button"; button.className = "btn btn--secondary"; button.textContent = "Seguridad de mi cuenta";
    button.addEventListener("click", () => openSecuritySettings().catch(error => toast(error.message, "error")));
    logoutButton.before(button);
  }
  if (adminName) adminName.textContent = adminUser?.name || adminUser?.email || "";
  if (adminAvatar) {
    adminAvatar.textContent = initials(adminUser?.name || adminUser?.email || "DM");
  }
}

async function handleLogin(e) {
  e.preventDefault();
  if (!loginForm) return;
  clearFormErrors(loginForm);
  if (loginError) {
    loginError.hidden = true;
    loginError.textContent = "";
  }
  if (loginSubmit) {
    loginSubmit.disabled = true;
    loginSubmit.textContent = "Entrando...";
  }
  const email = loginEmail?.value || "";
  const password = loginPassword?.value || "";
  try {
    const res = await adminApi.login(email, password, el("#login-code")?.value || "");
    if (res?.csrfToken) {
      setCsrfToken(res.csrfToken);
      state.csrfToken = res.csrfToken;
    }
    state.admin = res?.admin || null;
    if (loginPassword) loginPassword.value = "";
    if (el("#login-code")) el("#login-code").value = "";
    setUserUI(state.admin);
    if (loginView) loginView.hidden = true;
    if (appView) appView.hidden = false;
    if (bootEl) bootEl.hidden = true;
    await bootPanel();
  } catch (err) {
    if (loginError) {
      loginError.textContent = err?.message || "No pudimos iniciar sesión.";
      loginError.hidden = false;
    } else {
      toast(err?.message || "No pudimos iniciar sesión.", "error");
    }
  } finally {
    if (loginSubmit) {
      loginSubmit.disabled = false;
      loginSubmit.textContent = "Entrar al panel";
    }
  }
}

if (loginForm) loginForm.addEventListener("submit", handleLogin);

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      await adminApi.logout();
    } catch (error) { toast(error.message || "No se pudo cerrar la sesión. Intentá de nuevo.", "error"); return; }
    setCsrfToken(null);
    state.admin = null;
    if (appView) appView.hidden = true;
    if (loginView) loginView.hidden = false;
    if (loginEmail) loginEmail.value = "";
    if (loginPassword) loginPassword.value = "";
    location.replace("/admin");
  });
}

function setActiveNav(section) {
  navLinks.forEach((link) => {
    if (link.dataset.section === section) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function showSection(section) {
  if (!section) return;
  const sections = els(".admin-section");
  sections.forEach((sec) => {
    sec.hidden = sec.dataset.section !== section;
  });
  setActiveNav(section);
  state.currentSection = section;
  showPrimary(section);
  if (mainEl) {
    try { mainEl.focus({ preventScroll: true }); } catch { mainEl.focus(); }
  }
  announce("");
}

navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const section = link.dataset.section;
    location.hash = `#${section}`;
  });
});

async function route() {
  const hash = (location.hash || "#tablero").replace("#", "");
  if (!hash) {
    showSection("tablero");
    return;
  }
  if (hash.startsWith("pedido/")) {
    const id = hash.split("/")[1];
    showSection("pedidos");
    await loadOrders();
    await openOrderDetail(id);
    return;
  }
  if (hash.startsWith("consultas/")) {
    const id = hash.split("/")[1];
    showSection("consultas");
    await loadInquiries();
    openInquiryDetail(id);
    return;
  }
  const allowed = ["tablero", "pedidos", "productos", "categorias", "consultas", "cupones", "ajustes", "correos", "auditoria", "administradores"];
  const section = allowed.includes(hash) ? hash : "tablero";
  showSection(section);
  await loadSection(section);
}

window.addEventListener("hashchange", route);

async function loadSection(section) {
  try {
    if (section === "tablero") return loadDashboard();
    if (section === "pedidos") return loadOrders();
    if (section === "productos") return loadProducts();
    if (section === "categorias") return loadCategories();
    if (section === "consultas") return loadInquiries();
    if (section === "cupones") return loadCoupons();
    if (section === "ajustes") return loadSettings();
    if (section === "correos") return loadEmails();
    if (section === "auditoria") return loadAudit();
    if (section === "administradores") return loadAdmins();
  } catch (err) {
    showSectionError(section, err?.message || "No pudimos cargar esta sección.");
    toast(err?.message || "Error al cargar.", "error");
  }
}

async function bootPanel() {
  try {
    announce("Cargando información del panel...");
    const [overviewRes, settingsRes, paymentRes] = await Promise.allSettled([
      adminApi.overview(),
      state.admin?.role === "owner" ? adminApi.settings() : api.publicSettings(),
      api.paymentStatus(),
    ]);
    if (overviewRes.status === "fulfilled") state.overview = overviewRes.value;
    if (settingsRes.status === "fulfilled") state.settings = settingsRes.value?.settings || settingsRes.value;
    if (paymentRes.status === "fulfilled") state.paymentStatus = paymentRes.value;
    await route();
    announce("Panel listo.");
  } catch (err) {
    toast(err?.message || "No pudimos iniciar el panel.", "error");
  }
}

async function init() {
  if (bootEl) bootEl.hidden = false;
  if (loginView) loginView.hidden = true;
  if (appView) appView.hidden = true;
  try {
    const res = await adminApi.session();
    if (res?.admin) {
      state.admin = res.admin;
      if (res.csrfToken) {
        setCsrfToken(res.csrfToken);
        state.csrfToken = res.csrfToken;
      }
      setUserUI(state.admin);
      if (loginView) loginView.hidden = true;
      if (appView) appView.hidden = false;
      if (bootEl) bootEl.hidden = true;
      await bootPanel();
      return;
    }
  } catch (err) {
    if (err?.status === 401) {
      setCsrfToken(null);
    }
  }
  if (bootEl) bootEl.hidden = true;
  if (loginView) loginView.hidden = false;
  if (appView) appView.hidden = true;
}

init();

// ========================== DASHBOARD ==========================
async function loadDashboard() {
  const section = "tablero";
  const container = viewEl(section, "principal");
  if (!container) return;
  clearViews(section);
  showPrimary(section);
  setBusy(section, true);
  showSectionError(section, null);
  showSkeleton(container);
  try {
    if (!state.overview) {
      const res = await adminApi.overview();
      state.overview = res;
    }
    if (!state.settings) {
      const res = await (state.admin?.role === "owner" ? adminApi.settings() : api.publicSettings());
      state.settings = res?.settings || res;
    }
    renderDashboard(container);
  } catch (err) {
    showSectionError(section, err?.message || "No pudimos cargar el tablero.");
    emptyState(container, "Error al cargar", err?.message || "Probá recargar la página.");
  } finally {
    setBusy(section, false);
  }
}

function renderDashboard(container) {
  clear(container);
  const o = state.overview || {};
  const counts = o.counts || {};
  const revenue = o.revenue || {};
  const ordersByStatus = o.ordersByStatus || {};
  const recent = o.recentOrders || [];
  const topProducts = o.topProducts || [];
  const lowStock = o.lowStock || [];
  const setup = o.setup || {};
  const statusLabels = o.statusLabels || {};

  const paidPending = (ordersByStatus.pending_payment || 0) + (ordersByStatus.quote || 0);
  const grid = document.createElement("div");
  grid.className = "kpi-grid";
  grid.innerHTML = `
    <article class="kpi kpi--accent"><p class="kpi__label">Pedidos totales</p><p class="kpi__value">${Number(counts.orders || 0)}</p></article>
    <article class="kpi kpi--warn"><p class="kpi__label">Pendientes / cotizar</p><p class="kpi__value">${Number(paidPending)}</p></article>
    <article class="kpi kpi--ok"><p class="kpi__label">Pagados</p><p class="kpi__value">${Number(counts.paid || 0)}</p></article>
    <article class="kpi"><p class="kpi__label">Productos activos</p><p class="kpi__value">${Number(counts.products || 0)}</p></article>
    <article class="kpi"><p class="kpi__label">Recaudado (confirmados)</p><p class="kpi__value">${formatMoney(revenue.paid_total || 0)}</p></article>
    <article class="kpi"><p class="kpi__label">Este mes</p><p class="kpi__value">${formatMoney(revenue.month_total || 0)}</p><p class="kpi__hint">${Number(revenue.month_orders || 0)} pedidos</p></article>
    <article class="kpi"><p class="kpi__label">Consultas nuevas</p><p class="kpi__value">${Number(counts.new_inquiries || 0)}</p></article>
    <article class="kpi"><p class="kpi__label">Stock bajo (≤3)</p><p class="kpi__value">${Number(counts.low_stock || 0)}</p></article>
  `;
  container.appendChild(grid);

  const note = document.createElement("p");
  note.className = "admin-block__note";
  note.style.marginBottom = "var(--space-4)";
  note.textContent = "Los KPIs «hoy / últimos 7 días» no se calculan desde el backend con los datos expuestos; se muestran totales/mes. Si necesitás esa ventana, el listado de pedidos permite filtrar client-side sobre hasta 300 resultados.";
  container.appendChild(note);

  const blocks = document.createElement("div");
  blocks.className = "admin-blocks";

  const recentBlock = document.createElement("section");
  recentBlock.className = "admin-block";
  recentBlock.innerHTML = `<div class="admin-block__head"><h3>Pedidos recientes</h3><p class="admin-block__note">Últimos 8</p></div>`;
  if (recent.length === 0) {
    const p = document.createElement("p");
    p.className = "admin-block__note";
    p.textContent = "Todavía no hay pedidos.";
    recentBlock.appendChild(p);
  } else {
    const wrap = document.createElement("div");
    wrap.className = "table-scroll";
    const table = document.createElement("table");
    table.className = "admin-table";
    table.innerHTML = `<thead><tr><th>Código</th><th>Cliente</th><th>Estado</th><th class="is-numeric">Total</th><th>Fecha</th><th></th></tr></thead><tbody></tbody>`;
    const tbody = table.querySelector("tbody");
    recent.forEach((ord) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="admin-code">${escapeHtml(ord.code || "")}</td><td><div class="cell-strong">${escapeHtml(ord.customer_name || "")}</div><div class="cell-muted">${escapeHtml(ord.customer_email || "")}</div></td><td>${statusBadge(ord.status, statusLabels)}</td><td class="is-numeric">${ord.requires_quote && ord.status === "quote" ? "A cotizar" : formatMoney(ord.total || 0)}</td><td class="cell-muted">${formatDate(ord.created_at)}</td><td class="cell-actions"><button class="btn btn--secondary btn--sm" data-act="open-order" data-id="${escapeHtml(ord.id)}">Ver</button></td>`;
      tbody.appendChild(tr);
    });
    wrap.appendChild(table);
    recentBlock.appendChild(wrap);
  }
  blocks.appendChild(recentBlock);

  const topBlock = document.createElement("section");
  topBlock.className = "admin-block";
  topBlock.innerHTML = `<div class="admin-block__head"><h3>Productos más vendidos</h3><p class="admin-block__note">Por unidades (pagados/confirmados)</p></div>`;
  if (topProducts.length === 0) {
    const p = document.createElement("p");
    p.className = "admin-block__note";
    p.textContent = "Sin datos aún.";
    topBlock.appendChild(p);
  } else {
    const list = document.createElement("div");
    list.style.display = "grid";
    list.style.gap = "var(--space-2)";
    topProducts.forEach((tp) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.innerHTML = `<span>${escapeHtml(tp.product_name || "")}</span><span class="cell-muted">${tp.units || 0} uds · ${formatMoney(tp.revenue || 0)}</span>`;
      list.appendChild(row);
    });
    topBlock.appendChild(list);
  }
  blocks.appendChild(topBlock);

  const stockBlock = document.createElement("section");
  stockBlock.className = "admin-block";
  stockBlock.innerHTML = `<div class="admin-block__head"><h3>Stock bajo</h3><p class="admin-block__note">Productos con gestión de stock</p></div>`;
  if (lowStock.length === 0) {
    const p = document.createElement("p");
    p.className = "admin-block__note";
    p.textContent = "Todo OK.";
    stockBlock.appendChild(p);
  } else {
    const wrap = document.createElement("div");
    wrap.className = "table-scroll";
    const table = document.createElement("table");
    table.className = "admin-table";
    table.innerHTML = `<thead><tr><th>Producto</th><th class="is-numeric">Stock</th><th></th></tr></thead><tbody></tbody>`;
    const tbody = table.querySelector("tbody");
    lowStock.forEach((ps) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${escapeHtml(ps.name || "")}</td><td class="is-numeric">${ps.stock ?? 0}</td><td class="cell-actions"><button class="btn btn--secondary btn--sm" data-act="edit-product" data-id="${escapeHtml(ps.id)}">Editar</button></td>`;
      tbody.appendChild(tr);
    });
    wrap.appendChild(table);
    stockBlock.appendChild(wrap);
  }
  blocks.appendChild(stockBlock);

  container.appendChild(blocks);

  const setupBlock = document.createElement("section");
  setupBlock.className = "admin-block";
  setupBlock.innerHTML = `<div class="admin-block__head"><h3>Checklist de puesta en marcha</h3><p class="admin-block__note">Revisá lo que falta antes de abrir al público</p></div>`;
  const items = [
    { ok: (counts.products || 0) > 0, label: "Hay productos cargados", detail: `${counts.products || 0} activos`, link: "#productos" },
    { ok: (setup.productsWithoutPrice || 0) === 0, label: "Productos fijos con precio > 0", detail: setup.productsWithoutPrice ? `${setup.productsWithoutPrice} producto(s) con precio 0` : "OK", warn: (setup.productsWithoutPrice || 0) > 0, link: "#productos" },
    { ok: (setup.inactiveProducts || 0) >= 0, label: "Productos inactivos", detail: `${setup.inactiveProducts || 0} sin publicar`, link: "#productos" },
    { ok: setup.hasAdminEmail, label: "Correo de avisos configurado", detail: setup.hasAdminEmail ? "Configurado" : "Sin configurar (usar Ajustes → Notificaciones o .env)", link: "#ajustes" },
    { ok: setup.checkoutEnabled, label: "Checkout habilitado", detail: setup.checkoutEnabled ? "Habilitado" : "Deshabilitado (CHECKOUT_ENABLED)", link: null },
    { ok: setup.storageReady, label: "Almacenamiento de imágenes", detail: setup.storageReady ? "Configurado" : "Sin configurar (SUPABASE_STORAGE_BUCKET)", link: null },
    { ok: setup.hasWhatsapp, label: "WhatsApp en datos del negocio", detail: setup.hasWhatsapp ? "Configurado" : "Falta en Ajustes → Negocio", link: "#ajustes" },
    { ok: (counts.new_inquiries || 0) === 0, label: "Sin consultas nuevas", detail: `${counts.new_inquiries || 0} sin leer`, warn: (counts.new_inquiries || 0) > 0, link: "#consultas" },
  ];
  const list = document.createElement("ul");
  list.className = "checklist";
  items.forEach((it) => {
    const li = document.createElement("li");
    li.className = `checklist__item ${it.ok && !it.warn ? "checklist__item--ok" : it.warn ? "checklist__item--warn" : "checklist__item--bad"}`;
    li.innerHTML = `<span class="checklist__mark">${it.ok && !it.warn ? "✓" : "!"}</span><div class="checklist__text"><span class="checklist__label">${escapeHtml(it.label)}</span><span class="checklist__detail">${escapeHtml(it.detail)}</span>${it.link ? `<a class="checklist__link" href="${it.link}">Ir</a>` : ""}</div>`;
    list.appendChild(li);
  });
  setupBlock.appendChild(list);
  container.appendChild(setupBlock);

  container.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "open-order") {
      location.hash = `#pedido/${btn.dataset.id}`;
    }
    if (btn.dataset.act === "edit-product") {
      location.hash = "#productos";
      setTimeout(() => editProduct(btn.dataset.id), 50);
    }
  }, { once: true });
}

// ========================== PEDIDOS ==========================
async function loadOrders() {
  const section = "pedidos";
  const container = viewEl(section, "principal");
  if (!container) return;
  clearViews(section);
  showPrimary(section);
  setBusy(section, true);
  showSectionError(section, null);
  showSkeleton(container);
  try {
    const res = await adminApi.orders({ limit: state.ordersLimit, offset: state.ordersOffset });
    state.orders = res.orders || [];
    state.ordersTotal = res.total || 0;
    state.ordersCacheAll = state.orders.slice();
    renderOrdersList(container);
  } catch (err) {
    showSectionError(section, err?.message || "No pudimos cargar los pedidos.");
    emptyState(container, "Error al cargar", err?.message || "Probá recargar la página.");
  } finally {
    setBusy(section, false);
  }
}

function renderOrdersList(container) {
  clear(container);
  const wrap = document.createElement("div");
  wrap.className = "admin-toolbar";
  wrap.innerHTML = `
    <div class="field admin-toolbar__grow"><label class="field__label" for="orders-search">Buscar</label><input class="input" id="orders-search" placeholder="Código, nombre o correo"></div>
    <div class="field"><label class="field__label" for="orders-status">Estado</label><select class="select" id="orders-status"><option value="all">Todos</option></select></div>
    <div class="field"><label class="field__label" for="orders-from">Desde</label><input class="input" type="date" id="orders-from"></div>
    <div class="field"><label class="field__label" for="orders-to">Hasta</label><input class="input" type="date" id="orders-to"></div>
    <button class="btn btn--secondary" id="orders-apply">Aplicar</button>
    <button class="btn btn--secondary" id="orders-clear">Limpiar</button>
  `;
  container.appendChild(wrap);

  const statusSel = el("#orders-status", wrap);
  const statusLabels = state.overview?.statusLabels || {};
  Object.keys(statusLabels).filter(st => st === order.status || (order.status !== "refunded" && (order.paid_at ? ["in_production", "ready", "delivered", "cancelled"] : ["cancelled"]).includes(st))).forEach((st) => {
    const opt = document.createElement("option");
    opt.value = st;
    opt.textContent = statusLabels[st];
    statusSel.appendChild(opt);
  });
  if (state.ordersFilters.status) statusSel.value = state.ordersFilters.status;
  const search = el("#orders-search", wrap);
  const from = el("#orders-from", wrap);
  const to = el("#orders-to", wrap);
  search.value = state.ordersFilters.q || "";
  from.value = state.ordersFilters.from || "";
  to.value = state.ordersFilters.to || "";

  el("#orders-apply", wrap).addEventListener("click", () => {
    state.ordersFilters = { status: statusSel.value, q: search.value.trim(), from: from.value, to: to.value };
    applyOrdersFilters(container);
  });
  el("#orders-clear", wrap).addEventListener("click", () => {
    state.ordersFilters = { status: "all", q: "", from: "", to: "" };
    if (search) search.value = "";
    if (statusSel) statusSel.value = "all";
    if (from) from.value = "";
    if (to) to.value = "";
    applyOrdersFilters(container);
  });

  const tableWrap = document.createElement("div");
  tableWrap.className = "table-scroll";
  tableWrap.setAttribute("tabindex", "0");
  tableWrap.setAttribute("role", "region");
  tableWrap.setAttribute("aria-label", "Listado de pedidos");
  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = `<thead><tr><th>Código</th><th>Cliente</th><th>Entrega</th><th>Estado</th><th class="is-numeric">Ítems</th><th class="is-numeric">Total</th><th>Fecha</th><th></th></tr></thead><tbody></tbody>`;
  tableWrap.appendChild(table);
  container.appendChild(tableWrap);
  const tbody = table.querySelector("tbody");
  const list = getFilteredOrders();
  if (list.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="8" class="cell-muted">No hay pedidos con esos filtros.</td>`;
    tbody.appendChild(tr);
  } else {
    list.forEach((ord) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="admin-code">${escapeHtml(ord.code || "")}</td><td><div class="cell-strong">${escapeHtml(ord.customer_name || "")}</div><div class="cell-muted">${escapeHtml(ord.customer_email || "")}</div></td><td class="cell-muted">${ord.delivery_method === "pickup" ? "Retiro" : "Envío"}</td><td>${statusBadge(ord.status, statusLabels)}</td><td class="is-numeric">${ord.item_count || 0}</td><td class="is-numeric">${ord.requires_quote && ord.status === "quote" ? "A cotizar" : formatMoney(ord.total || 0)}</td><td class="cell-muted">${formatDate(ord.created_at)}</td><td class="cell-actions"><button class="btn btn--secondary btn--sm" data-act="view-order" data-id="${escapeHtml(ord.id)}">Ver / gestionar</button></td>`;
      tbody.appendChild(tr);
    });
  }

  const pag = document.createElement("div");
  pag.className = "admin-pagination";
  pag.innerHTML = `<div>Mostrando ${list.length} resultado(s). Total de pedidos: ${state.ordersTotal}. Los filtros de fecha se aplican a los pedidos de esta página.</div>`;
  container.appendChild(pag);

  container.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act='view-order']");
    if (btn) location.hash = `#pedido/${btn.dataset.id}`;
  }, { once: true });
}

function getFilteredOrders() {
  let list = state.orders.slice();
  const f = state.ordersFilters;
  if (f.status && f.status !== "all") {
    list = list.filter((o) => o.status === f.status);
  }
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter((o) => (o.code || "").toLowerCase().includes(q) || (o.customer_name || "").toLowerCase().includes(q) || (o.customer_email || "").toLowerCase().includes(q));
  }
  if (f.from) {
    const from = new Date(f.from + "T00:00:00");
    list = list.filter((o) => new Date(o.created_at) >= from);
  }
  if (f.to) {
    const to = new Date(f.to + "T23:59:59");
    list = list.filter((o) => new Date(o.created_at) <= to);
  }
  return list;
}

function applyOrdersFilters(container) {
  renderOrdersList(container);
}

async function openOrderDetail(id) {
  const section = "pedidos";
  const secondary = viewEl(section, "secundario");
  if (!secondary) return;
  clear(secondary);
  showSecondary(section);
  showSkeleton(secondary);
  try {
    const res = await adminApi.order(id);
    state.ordersDetail = res;
    renderOrderDetail(secondary, res);
  } catch (err) {
    emptyState(secondary, "Error al cargar el pedido", err?.message || "No se pudo obtener el detalle.");
    toast(err?.message || "Error al cargar el pedido.", "error");
  }
}

function renderOrderDetail(container, res) {
  clear(container);
  const order = res.order || {};
  const items = res.items || [];
  const statusLabels = res.statusLabels || state.overview?.statusLabels || {};
  const head = document.createElement("div");
  head.className = "detail__head";
  head.innerHTML = `<div><h3>Pedido ${escapeHtml(order.code || "")}</h3><p class="detail__meta"><span>Creado: ${formatDateTime(order.created_at)}</span><span>${statusBadge(order.status, statusLabels)}</span>${order.paid_at ? `<span>Pagado: ${formatDateTime(order.paid_at)}</span>` : ""}</p></div><div class="cell-actions"><button class="btn btn--secondary" data-act="back-orders">← Volver al listado</button></div>`;
  container.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "detail__grid";

  const client = document.createElement("section");
  client.className = "detail__card";
  client.innerHTML = `<h4>Cliente</h4><dl class="data-list"><div class="data-list__row"><dt>Nombre</dt><dd>${escapeHtml(order.customer_name || "")}</dd></div><div class="data-list__row"><dt>Correo</dt><dd>${escapeHtml(order.customer_email || "")}</dd></div><div class="data-list__row"><dt>Teléfono</dt><dd>${escapeHtml(order.customer_phone || "")}</dd></div><div class="data-list__row"><dt>RUT/Cédula</dt><dd>${escapeHtml(order.customer_tax_id || "")}</dd></div></dl>`;
  grid.appendChild(client);

  const delivery = document.createElement("section");
  delivery.className = "detail__card";
  delivery.innerHTML = `<h4>Entrega</h4><dl class="data-list"><div class="data-list__row"><dt>Método</dt><dd>${order.delivery_method === "pickup" ? "Retiro" : "Envío"}</dd></div><div class="data-list__row"><dt>Dirección</dt><dd>${escapeHtml(order.shipping_address || "")}</dd></div><div class="data-list__row"><dt>Ciudad/Dep.</dt><dd>${escapeHtml([order.shipping_city, order.shipping_department].filter(Boolean).join(" - "))}</dd></div><div class="data-list__row"><dt>Entrega estimada</dt><dd>${escapeHtml(order.estimated_delivery || "")}</dd></div></dl>`;
  grid.appendChild(delivery);

  const stateCard = document.createElement("section");
  stateCard.className = "detail__card";
  stateCard.innerHTML = `<h4>Estado y gestión</h4><div class="field"><label class="field__label" for="order-status">Estado</label><select class="select" id="order-status"></select></div><div class="field"><label class="field__label" for="order-phone">Teléfono</label><input class="input" id="order-phone" value="${escapeHtml(order.customer_phone || "")}"></div><div class="field"><label class="field__label" for="order-delivery">Entrega estimada</label><input class="input" id="order-delivery" value="${escapeHtml(order.estimated_delivery || "")}"></div><div class="field"><label class="field__label" for="order-notes">Notas internas</label><textarea class="textarea" id="order-notes">${escapeHtml(order.internal_notes || "")}</textarea></div><button class="btn btn--primary" id="order-save">Guardar cambios</button>`;
  const stSel = el("#order-status", stateCard);
  Object.keys(statusLabels).filter(st => st === order.status || (order.status !== "refunded" && (order.paid_at ? ["in_production", "ready", "delivered", "cancelled"] : ["cancelled"]).includes(st))).forEach((st) => {
    const opt = document.createElement("option");
    opt.value = st;
    opt.textContent = statusLabels[st];
    if (st === order.status) opt.selected = true;
    stSel.appendChild(opt);
  });
  const paymentCard = document.createElement("section");
  paymentCard.className = "detail__card";
  paymentCard.innerHTML = `<h4>Pago: ${escapeHtml(PAYMENT_LABELS[order.payment_provider] || order.payment_provider)}</h4>${instructionsHtml(order)}${order.payment_reference ? `<p>Referencia: ${escapeHtml(order.payment_reference)}</p>` : ""}${order.payment_confirmed_by ? `<p>Confirmado por administrador: ${escapeHtml(order.payment_confirmed_by_name || order.payment_confirmed_by)}</p>` : ""}${state.admin?.role === "owner" && !order.paid_at && order.status === "pending_payment" && ["transfer", "cash"].includes(order.payment_provider) ? `<label class="field"><span class="field__label">Referencia del ingreso verificado</span><input class="input" id="manual-payment-reference" maxlength="200"></label><button class="btn btn--primary" id="manual-payment-confirm">Confirmar cobro de ${formatMoney(order.total)}</button><p class="admin-block__note">Verificá el ingreso real antes de confirmar. Un comprobante enviado no equivale a un pago verificado.</p>` : ""}`;
  grid.appendChild(paymentCard);
  grid.appendChild(stateCard);
  container.appendChild(grid);

  const itemsCard = document.createElement("section");
  itemsCard.className = "detail__card";
  itemsCard.innerHTML = `<h4>Ítems</h4>`;
  const tableWrap = document.createElement("div");
  tableWrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = `<thead><tr><th>Producto</th><th>Opciones</th><th class="is-numeric">Cant.</th><th class="is-numeric">P. unit.</th><th class="is-numeric">Subtotal</th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody");
  items.forEach((it) => {
    const tr = document.createElement("tr");
    const opts = Array.isArray(it.options) ? it.options.map((o) => `${o.label || o.id}: ${o.value || ""}`).join(", ") : "";
    tr.innerHTML = `<td><div class="cell-strong">${escapeHtml(it.product_name || "")}</div>${it.customization ? `<div class="cell-muted">${escapeHtml(it.customization)}</div>` : ""}${it.is_quote ? `<span class="badge badge--warn">A cotizar</span>` : ""}</td><td class="cell-muted">${escapeHtml(opts)}</td><td class="is-numeric">${it.quantity || 0}</td><td class="is-numeric">${it.is_quote ? "-" : formatMoney(it.unit_price || 0)}</td><td class="is-numeric">${it.is_quote ? "-" : formatMoney(it.line_total || 0)}</td>`;
    tbody.appendChild(tr);
  });
  tableWrap.appendChild(table);
  itemsCard.appendChild(tableWrap);

  const totals = document.createElement("dl");
  totals.className = "data-list totals";
  totals.innerHTML = `<div class="data-list__row"><dt>Subtotal</dt><dd>${formatMoney(order.subtotal || 0)}</dd></div><div class="data-list__row"><dt>Descuento</dt><dd>${formatMoney(order.discount || 0)}</dd></div><div class="data-list__row"><dt>Ajuste por medio de pago</dt><dd>${formatMoney(order.payment_adjustment || 0)}</dd></div><div class="data-list__row"><dt>Importe cotizado</dt><dd>${formatMoney(order.quoted_total || 0)}</dd></div><div class="data-list__row"><dt>Envío</dt><dd>${formatMoney(order.shipping_cost || 0)}</dd></div><div class="data-list__row"><dt>IVA</dt><dd>${formatMoney(order.tax || 0)}</dd></div><div class="data-list__row data-list__row--total"><dt>Total</dt><dd>${order.requires_quote && order.status === "quote" ? "A cotizar" : formatMoney(order.total || 0)}</dd></div>`;
  itemsCard.appendChild(totals);
  container.appendChild(itemsCard);

  if (order.requires_quote && !order.paid_at && ["quote", "pending_payment", "failed"].includes(order.status)) {
    const quote = document.createElement("section");
    quote.className = "admin-form";
    quote.innerHTML = `<div class="admin-form__head"><h3>Cotizar pedido</h3><p class="admin-block__note">Fijá el importe de los ítems a cotizar. Se suma al subtotal para calcular el total.</p></div><div class="admin-form__grid"><div class="field">${items.filter(it => it.is_quote).map(it => `<label class="field__label" for="quote-${it.id}">${escapeHtml(it.product_name)} × ${it.quantity}: importe total de la línea (UYU)</label><input class="input" id="quote-${it.id}" data-quote-item="${it.id}" type="number" min="0" step="1" value="${it.quoted_amount ?? 0}">`).join("")}</div><div class="field"><label class="field__label" for="quote-notes">Notas para el cliente</label><input class="input" id="quote-notes" value="${escapeHtml(order.quote_notes || "")}"></div></div><label class="checkbox"><input type="checkbox" id="quote-link" checked><span>Generar link de pago al cotizar</span></label><div class="admin-form__actions"><button class="btn btn--primary" id="quote-send">Enviar cotización</button><button class="btn btn--secondary" id="quote-mailto">Escribir un correo al cliente</button></div>`;
    container.appendChild(quote);
  }

  const audit = document.createElement("section");
  audit.className = "admin-block";
  audit.innerHTML = `<div class="admin-block__head"><h3>Historial (auditoría)</h3><p class="admin-block__note">Eventos relacionados con este pedido</p></div>`;
  const ul = document.createElement("ul");
  ul.className = "timeline";
  audit.appendChild(ul);
  container.appendChild(audit);
  loadOrderAudit(order.id, ul);

  container.addEventListener("click", async (e) => {
    if (e.target.closest("[data-act='back-orders']")) {
      location.hash = "#pedidos";
      showPrimary("pedidos");
      return;
    }
    if (e.target.id === "manual-payment-confirm") {
      const reference = el("#manual-payment-reference", container).value.trim();
      if (!reference) { toast("Ingresá la referencia del cobro verificado.", "error"); return; }
      if (!await confirmDialog(`¿Confirmás que recibiste ${formatMoney(order.total)} por ${PAYMENT_LABELS[order.payment_provider]}?`, { title: "Confirmar ingreso", confirmText: "Sí, ingreso verificado" })) return;
      e.target.disabled = true;
      try {
        await adminApi.confirmPayment(order.id, { reference, revision: order.payment_revision, expected_total: order.total });
        toast("Pago confirmado.", "success");
        await loadOrders(); await openOrderDetail(order.id);
      } catch (error) { toast(error.message, "error"); e.target.disabled = false; }
      return;
    }
    if (e.target.id === "order-save") {
      const btn = e.target;
      btn.disabled = true;
      try {
        await adminApi.updateOrder(order.id, {
          status: el("#order-status")?.value,
          customer_phone: el("#order-phone")?.value,
          estimated_delivery: el("#order-delivery")?.value,
          internal_notes: el("#order-notes")?.value,
        });
        toast("Pedido actualizado.", "success");
        announce("Pedido actualizado.");
        await loadOrders();
        await openOrderDetail(order.id);
      } catch (err) {
        toast(err?.message || "No pudimos guardar.", "error");
      } finally {
        btn.disabled = false;
      }
      return;
    }
    if (e.target.id === "quote-send") {
      const btn = e.target;
      btn.disabled = true;
      try {
        const amount = Number(el("#quote-amount")?.value || 0);
        const notes = el("#quote-notes")?.value || "";
        const gen = el("#quote-link")?.checked !== false;
        const res = await adminApi.quoteOrder(order.id, { quote_amount: amount, quote_items: Object.fromEntries(els("[data-quote-item]", container).map(node => [node.dataset.quoteItem, Number(node.value)])), quote_notes: notes, generate_payment_link: gen });
        toast("Cotización enviada/actualizada.", "success");
        if (res?.checkoutUrl) {
          toast("Link de pago generado.", "success");
        }
        await loadOrders();
        await openOrderDetail(order.id);
      } catch (err) {
        toast(err?.message || "No pudimos cotizar.", "error");
      } finally {
        btn.disabled = false;
      }
      return;
    }
    if (e.target.id === "quote-mailto") {
      const subject = encodeURIComponent(`Cotización DM Comunicación Visual - Pedido ${order.code}`);
      const body = encodeURIComponent(`Hola ${order.customer_name},\n\nTu cotización del pedido ${order.code} está lista. Podés ver y pagar desde el panel de seguimiento o desde el link que te enviamos.\n\nSaludos,\nDM Comunicación Visual`);
      window.location.href = `mailto:${order.customer_email}?subject=${subject}&body=${body}`;
    }
  });
}

async function loadOrderAudit(orderId, ul) {
  try {
    const res = await adminApi.audit();
    const events = (res.events || []).filter((ev) => ev.target_type === "order" && ev.target_id === orderId);
    if (events.length === 0) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="timeline__when">-</span><span class="cell-muted">Sin eventos registrados.</span>`;
      ul.appendChild(li);
      return;
    }
    events.forEach((ev) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="timeline__when">${formatDateTime(ev.created_at)}</span><span><strong>${escapeHtml(ev.admin_name || ev.admin_email || "Sistema")}</strong> · ${escapeHtml(ev.action || "")}${ev.detail ? ` · ${escapeHtml(JSON.stringify(ev.detail))}` : ""}</span>`;
      ul.appendChild(li);
    });
  } catch {
    const li = document.createElement("li");
    li.innerHTML = `<span class="timeline__when">-</span><span class="cell-muted">No se pudo cargar el historial.</span>`;
    ul.appendChild(li);
  }
}

// ========================== PRODUCTOS ==========================
async function loadProducts() {
  const section = "productos";
  const container = viewEl(section, "principal");
  if (!container) return;
  clearViews(section);
  showPrimary(section);
  setBusy(section, true);
  showSectionError(section, null);
  showSkeleton(container);
  try {
    const [prodRes, catRes] = await Promise.all([adminApi.products(), adminApi.categories()]);
    state.products = prodRes.products || [];
    state.categories = catRes.categories || [];
    renderProductsList(container);
  } catch (err) {
    showSectionError(section, err?.message || "No pudimos cargar los productos.");
    emptyState(container, "Error al cargar", err?.message || "Probá recargar la página.");
  } finally {
    setBusy(section, false);
  }
}

function renderProductsList(container) {
  clear(container);
  const head = document.createElement("div");
  head.className = "admin-toolbar";
  head.innerHTML = `<button class="btn btn--primary" id="prod-new">+ Nuevo producto</button><div class="admin-toolbar__grow"></div><p class="admin-block__note">${state.products.length} producto(s)</p>`;
  container.appendChild(head);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = `<thead><tr><th>Producto</th><th>Categoría</th><th>Modo</th><th>Precio</th><th>Estado</th><th>Stock</th><th></th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody");
  if (state.products.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7" class="cell-muted">No hay productos.</td>`;
    tbody.appendChild(tr);
  } else {
    state.products.forEach((p) => {
      const tr = document.createElement("tr");
      const imgs = Array.isArray(p.images) ? p.images : [];
      tr.innerHTML = `<td><div class="cell-strong">${escapeHtml(p.name || "")}</div><div class="cell-muted">${escapeHtml(p.slug || "")}</div></td><td class="cell-muted">${escapeHtml([p.parent_category_name, p.category_name].filter(Boolean).join(" / ") || "-")}</td><td>${p.pricing_mode === "quote" ? badge("A cotizar", "badge--warn") : badge("Precio fijo")}</td><td class="is-numeric">${p.pricing_mode === "quote" ? "-" : formatMoney(p.price || 0)}</td><td>${p.active ? badge("Activo", "badge--ok") : badge("Inactivo")}</td><td class="is-numeric">${p.manage_stock ? p.stock : "-"}</td><td class="cell-actions"><button class="btn btn--secondary btn--sm" data-act="edit-prod" data-id="${escapeHtml(p.id)}">Editar</button></td>`;
      tbody.appendChild(tr);
    });
  }
  wrap.appendChild(table);
  container.appendChild(wrap);
  container.onclick = (e) => {
    if (e.target.id === "prod-new") editProduct(null);
    const btn = e.target.closest("button[data-act='edit-prod']");
    if (btn) editProduct(btn.dataset.id);
  };
}

function editProduct(id) {
  const section = "productos";
  const secondary = viewEl(section, "secundario");
  if (!secondary) return;
  clear(secondary);
  showSecondary(section);
  const prod = id ? state.products.find((p) => p.id === id) : null;
  state.productImagesDraft = Array.isArray(prod?.images) ? prod.images.slice() : [];
  state.productImagesDirty = false;
  const form = document.createElement("form");
  form.className = "admin-form";
  form.id = "product-form";
  form.noValidate = true;
  form.innerHTML = `
    <div class="admin-form__head"><h3>${prod ? "Editar producto" : "Nuevo producto"}</h3><button class="btn btn--secondary" type="button" data-act="back-products">← Volver</button></div>
    <input type="hidden" id="prod-id" value="${escapeHtml(prod?.id || "")}">
    <div class="admin-form__section"><h4>Información básica</h4><div class="admin-form__grid"><div class="field"><label class="field__label" for="prod-name">Nombre *</label><input class="input" id="prod-name" value="${escapeHtml(prod?.name || "")}" required></div><div class="field"><label class="field__label" for="prod-slug">Identificador (slug) *</label><input class="input" id="prod-slug" value="${escapeHtml(prod?.slug || "")}" required></div></div><div class="field"><label class="field__label" for="prod-short">Descripción corta</label><input class="input" id="prod-short" maxlength="300" value="${escapeHtml(prod?.short_description || "")}"></div><div class="field"><label class="field__label" for="prod-desc">Descripción</label><textarea class="textarea" id="prod-desc">${escapeHtml(prod?.description || "")}</textarea></div></div>
    <div class="admin-form__section"><h4>Precio y modo</h4><div class="admin-form__grid"><div class="field"><label class="field__label" for="prod-mode">Modo de precio</label><select class="select" id="prod-mode"><option value="fixed">Precio fijo</option><option value="quote">A cotizar</option></select></div><div class="field"><label class="field__label" for="prod-price">Precio (UYU)</label><input class="input" id="prod-price" type="number" min="0" value="${prod?.price ?? 0}"></div><div class="field"><label class="field__label" for="prod-compare">Precio tachado</label><input class="input" id="prod-compare" type="number" min="0" value="${prod?.compare_at_price ?? ""}"></div></div><p class="admin-block__note">Si el modo es "A cotizar", el precio puede quedar en 0. El precio tachado debe ser igual o mayor al precio de venta.</p></div>
    <div class="admin-form__section"><h4>Precio según medio de pago</h4><p class="admin-block__note">Solo afecta a este producto. El porcentaje no se aplica al envío. Para cotizaciones se aplica al importe que presupuestes.</p><div class="admin-form__grid"><label class="field"><span class="field__label">Regla</span><select class="select" id="prod-payment-rule"><option value="none">Precio único</option><option value="mp_surcharge">Precio base + recargo por Mercado Pago</option><option value="cash_discount">Precio publicado con descuento por transferencia / contado</option></select></label><label class="field"><span class="field__label">Porcentaje</span><input class="input" id="prod-payment-percent" type="number" min="0" max="100" step="1" value="${prod?.payment_percent ?? 12}"></label></div><p id="prod-payment-preview" class="alert alert--info" aria-live="polite"></p></div>
    <div class="admin-form__section"><h4>Categoría y visibilidad</h4><div class="admin-form__grid"><div class="field"><label class="field__label" for="prod-cat">Categoría</label><select class="select" id="prod-cat"><option value="">Sin categoría</option></select><button class="btn btn--secondary btn--sm" type="button" id="prod-new-category">Crear categoría o subcategoría</button></div><div class="field"><label class="field__label" for="prod-sort">Orden</label><input class="input" id="prod-sort" type="number" value="${prod?.sort_order ?? 0}"></div></div><label class="checkbox"><input type="checkbox" id="prod-active" ${prod?.active ? "checked" : ""}><span>Activo (visible en el sitio)</span></label><label class="checkbox"><input type="checkbox" id="prod-featured" ${prod?.featured ? "checked" : ""}><span>Destacado</span></label></div>
    <div class="admin-form__section"><h4>Stock</h4><label class="checkbox"><input type="checkbox" id="prod-manage" ${prod?.manage_stock ? "checked" : ""}><span>Gestionar stock</span></label><div class="field"><label class="field__label" for="prod-stock">Stock</label><input class="input" id="prod-stock" type="number" min="0" value="${prod?.stock ?? 0}"></div><div class="field"><label class="field__label" for="prod-min">Cantidad mínima</label><input class="input" id="prod-min" type="number" min="1" value="${prod?.min_quantity ?? 1}"></div><div class="field"><label class="field__label" for="prod-lead">Días de producción</label><input class="input" id="prod-lead" type="number" min="0" value="${prod?.lead_time_days ?? 3}"></div></div>
    <div class="admin-form__section"><h4>Personalización</h4><label class="checkbox"><input type="checkbox" id="prod-pers" ${prod?.personalization_enabled ? "checked" : ""}><span>Habilitar campo de personalización</span></label><div class="field"><label class="field__label" for="prod-pers-prompt">Indicación al cliente</label><input class="input" id="prod-pers-prompt" value="${escapeHtml(prod?.personalization_prompt || "")}"></div></div>
    <div class="admin-form__section"><h4>Cómo aparece en buscadores</h4><div class="field"><label class="field__label" for="prod-seo-t">Título SEO</label><input class="input" id="prod-seo-t" maxlength="70" value="${escapeHtml(prod?.seo_title || "")}"></div><div class="field"><label class="field__label" for="prod-seo-d">Descripción SEO</label><input class="input" id="prod-seo-d" maxlength="165" value="${escapeHtml(prod?.seo_description || "")}"></div></div>
    <div class="admin-form__section"><h4>Opciones del producto</h4><p class="admin-block__note">Agregá tamaños, terminaciones o campos para que el cliente personalice su pedido. Los recargos se suman al precio por unidad.</p><div id="prod-options"></div></div>
    <div class="admin-form__section"><h4>Imágenes</h4><div id="prod-images" class="image-grid"></div><div class="image-uploader"><p>Subí imágenes (requiere guardar el producto primero si es nuevo).</p><input type="file" id="prod-image-file" accept="image/*"></div><p class="admin-block__note">La primera imagen será la portada. Usá las flechas para cambiar el orden y guardá el producto para confirmar.</p></div>
    <div class="admin-form__actions"><button class="btn btn--primary" type="submit">Guardar</button><button class="btn btn--secondary" type="button" data-act="back-products">Cancelar</button>${prod ? `<button class="btn btn--danger" type="button" id="prod-delete">Eliminar</button>` : ""}</div>
  `;
  secondary.appendChild(form);

  const readOptions = productOptionsEditor(el("#prod-options", form), prod?.options || []);
  const paymentRule = el("#prod-payment-rule", form);
  paymentRule.value = prod?.payment_rule || "none";
  const updatePaymentPreview = () => {
    const percent = Number(el("#prod-payment-percent", form).value || 0);
    const line = { line_total: Number(el("#prod-price", form).value || 0), payment_rule: paymentRule.value, payment_percent: percent };
    el("#prod-payment-percent", form).disabled = paymentRule.value === "none";
    el("#prod-payment-preview", form).textContent = `Ejemplo sin opciones ni cupón: Mercado Pago ${formatMoney(paymentTotals([line], { method: "mercadopago" }).total)} · Transferencia / contado ${formatMoney(paymentTotals([line], { method: "transfer" }).total)}. Importes redondeados a pesos enteros. Los medios deben estar habilitados en Ajustes.`;
  };
  [paymentRule, el("#prod-payment-percent", form), el("#prod-price", form)].forEach(node => node.addEventListener("input", updatePaymentPreview));
  updatePaymentPreview();
  const modeSel = el("#prod-mode", form);
  if (prod?.pricing_mode) modeSel.value = prod.pricing_mode;
  const catSel = el("#prod-cat", form);
  fillProductCategories(catSel, prod?.category_id);
  el("#prod-new-category", form).addEventListener("click", () => {
    const selected = state.categories.find((c) => c.id === catSel.value);
    editCategory(null, (category) => {
      fillProductCategories(catSel, category.id);
      announce("Categoría creada y seleccionada. Los datos del producto se conservaron.");
    }, selected?.parent_id || selected?.id || null);
  });

  renderProductImages(form);

  form.addEventListener("click", async (e) => {
    if (e.target.closest("[data-act='back-products']")) {
      location.hash = "#productos";
      showPrimary("productos");
      return;
    }
    if (e.target.id === "prod-delete" && prod) {
      const ok = await confirmDialog("¿Eliminar este producto? Esta acción no se puede deshacer.", { title: "Eliminar producto", danger: true, confirmText: "Eliminar" });
      if (!ok) return;
      try {
        await adminApi.deleteProduct(prod.id);
        toast("Producto eliminado.", "success");
        await loadProducts();
        location.hash = "#productos";
        showPrimary("productos");
      } catch (err) {
        toast(err?.message || "No pudimos eliminar.", "error");
      }
      return;
    }
    const imgBtn = e.target.closest("button[data-act='img-act']");
    if (imgBtn) {
      const idx = Number(imgBtn.dataset.idx);
      if (imgBtn.dataset.actImg === "up" && idx > 0) {
        const arr = state.productImagesDraft;
        [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
        state.productImagesDirty = true;
        renderProductImages(form);
      }
      if (imgBtn.dataset.actImg === "down" && idx < state.productImagesDraft.length - 1) {
        const arr = state.productImagesDraft;
        [arr[idx], arr[idx+1]] = [arr[idx+1], arr[idx]];
        state.productImagesDirty = true;
        renderProductImages(form);
      }
      if (imgBtn.dataset.actImg === "del") {
        const ok = await confirmDialog("¿Quitar esta imagen?", { title: "Quitar imagen", confirmText: "Quitar" });
        if (!ok) return;
        const img = state.productImagesDraft[idx];
        state.productImagesDraft.splice(idx, 1);
        state.productImagesDirty = true;
        renderProductImages(form);
        if (prod && img?.url) {
          try {
            await adminApi.deleteImage(prod.id, img.url);
            toast("Imagen eliminada.", "success");
          } catch (err) {
            toast(err?.message || "No pudimos borrar la imagen del servidor.", "error");
          }
        }
      }
    }
  });

  const fileInput = el("#prod-image-file", form);
  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (!prod) {
        toast("Guardá el producto primero para poder subir imágenes.", "error");
        fileInput.value = "";
        return;
      }
      try {
        const res = await adminApi.uploadImage(prod.id, file);
        if (res?.url) {
          state.productImagesDraft.push({ url: res.url, alt: prod.name || "" });
          state.productImagesDirty = true;
          renderProductImages(form);
          await adminApi.updateProduct(prod.id, { images: state.productImagesDraft });
          state.productImagesDirty = false;
          toast("Imagen subida.", "success");
        }
      } catch (err) {
        toast(err?.message || "No pudimos subir la imagen.", "error");
      } finally {
        fileInput.value = "";
      }
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      let payload = {
        name: el("#prod-name", form)?.value,
        slug: el("#prod-slug", form)?.value,
        short_description: el("#prod-short", form)?.value,
        description: el("#prod-desc", form)?.value,
        pricing_mode: el("#prod-mode", form)?.value,
        price: Number(el("#prod-price", form)?.value || 0),
        payment_rule: paymentRule.value,
        payment_percent: Number(el("#prod-payment-percent", form).value || 0),
        compare_at_price: el("#prod-compare", form)?.value === "" ? null : Number(el("#prod-compare", form)?.value || 0),
        category_id: el("#prod-cat", form)?.value || null,
        sort_order: Number(el("#prod-sort", form)?.value || 0),
        active: el("#prod-active", form)?.checked,
        featured: el("#prod-featured", form)?.checked,
        manage_stock: el("#prod-manage", form)?.checked,
        stock: Number(el("#prod-stock", form)?.value || 0),
        min_quantity: Number(el("#prod-min", form)?.value || 1),
        lead_time_days: Number(el("#prod-lead", form)?.value || 3),
        personalization_enabled: el("#prod-pers", form)?.checked,
        personalization_prompt: el("#prod-pers-prompt", form)?.value,
        seo_title: el("#prod-seo-t", form)?.value,
        seo_description: el("#prod-seo-d", form)?.value,
        options: readOptions(),
        images: state.productImagesDraft,
      };
      if (payload.compare_at_price !== null && payload.compare_at_price < payload.price) {
        toast("El precio tachado no puede ser menor al precio.", "error");
        btn.disabled = false;
        return;
      }
      let res;
      if (prod?.id) {
        res = await adminApi.updateProduct(prod.id, payload);
        toast("Producto guardado.", "success");
      } else {
        res = await adminApi.createProduct(payload);
        toast("Producto creado.", "success");
      }
      await loadProducts();
      location.hash = "#productos";
      showPrimary("productos");
    } catch (err) {
      toast(err?.message || "No pudimos guardar el producto.", "error");
    } finally {
      btn.disabled = false;
    }
  });
}

function renderProductImages(form) {
  const grid = el("#prod-images", form);
  if (!grid) return;
  clear(grid);
  if (state.productImagesDraft.length === 0) {
    const p = document.createElement("p");
    p.className = "admin-block__note";
    p.textContent = "Sin imágenes.";
    grid.appendChild(p);
    return;
  }
  state.productImagesDraft.forEach((img, idx) => {
    const card = document.createElement("article");
    card.className = "image-card";
    card.innerHTML = `<img class="image-card__preview" src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || "")}"><div class="image-card__actions"><button class="btn btn--secondary" type="button" data-act="img-act" data-act-img="up" data-idx="${idx}">↑</button><button class="btn btn--secondary" type="button" data-act="img-act" data-act-img="down" data-idx="${idx}">↓</button><button class="btn btn--danger" type="button" data-act="img-act" data-act-img="del" data-idx="${idx}">Quitar</button></div>`;
    grid.appendChild(card);
  });
}

// ========================== CATEGORÍAS ==========================
async function loadCategories() {
  const section = "categorias";
  const container = viewEl(section, "principal");
  if (!container) return;
  clearViews(section);
  showPrimary(section);
  setBusy(section, true);
  showSectionError(section, null);
  showSkeleton(container);
  try {
    const res = await adminApi.categories();
    state.categories = res.categories || [];
    renderCategories(container);
  } catch (err) {
    showSectionError(section, err?.message || "No pudimos cargar las categorías.");
    emptyState(container, "Error al cargar", err?.message || "Probá recargar la página.");
  } finally {
    setBusy(section, false);
  }
}

function categoryLabel(category) {
  const parent = state.categories.find((c) => c.id === category.parent_id);
  return `${parent ? parent.name + " / " : ""}${category.name}${category.active === false || parent?.active === false ? " (inactiva)" : ""}`;
}

function orderedCategories() {
  const sorted = state.categories.slice().sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.name.localeCompare(b.name, "es"));
  return sorted.filter((c) => !c.parent_id).flatMap((root) => [root, ...sorted.filter((c) => c.parent_id === root.id)]);
}

function fillProductCategories(select, selected) {
  select.replaceChildren(new Option("Sin categoría", ""));
  orderedCategories().forEach((category) => select.add(new Option(categoryLabel(category), category.id)));
  select.value = selected || "";
}

function editCategory(category = null, onSaved = null, parentId = null) {
  const form = document.createElement("form");
  form.className = "admin-form";
  form.innerHTML = `
    <p class="admin-block__note">Las categorías quedan guardadas para futuros productos. Elegí una categoría principal para crear una subcategoría.</p>
    <div class="field"><label class="field__label" for="cat-name">Nombre *</label><input class="input" id="cat-name" required minlength="2" maxlength="100" value="${escapeHtml(category?.name || "")}"></div>
    <div class="field"><label class="field__label" for="cat-slug">Identificador para el enlace *</label><input class="input" id="cat-slug" required maxlength="120" pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-describedby="cat-slug-help" value="${escapeHtml(category?.slug || "")}"><p class="admin-block__note" id="cat-slug-help">Letras minúsculas, números y guiones. Cambiarlo modifica el enlace de la categoría.</p></div>
    <div class="field"><label class="field__label" for="cat-parent">Categoría principal</label><select class="select" id="cat-parent"><option value="">Ninguna (categoría principal)</option></select></div>
    <div class="field"><label class="field__label" for="cat-description">Descripción</label><textarea class="textarea" id="cat-description" maxlength="400">${escapeHtml(category?.description || "")}</textarea></div>
    <div class="field"><label class="field__label" for="cat-sort">Orden</label><input class="input" id="cat-sort" type="number" min="0" max="10000" step="1" value="${Number(category?.sort_order || 0)}"></div>
    <label class="checkbox"><input type="checkbox" id="cat-active" ${category?.active !== false ? "checked" : ""}><span>Activa (visible en el catálogo)</span></label>
    <p class="admin-block__note">Desactivar una categoría principal también oculta sus subcategorías y productos del catálogo.</p>
    <p id="cat-error" role="alert" hidden></p>`;
  const parentSelect = el("#cat-parent", form);
  state.categories.filter((c) => !c.parent_id && c.id !== category?.id).forEach((c) => parentSelect.add(new Option(categoryLabel(c), c.id)));
  parentSelect.value = category?.parent_id || parentId || "";
  if (category && state.categories.some((c) => c.parent_id === category.id)) {
    parentSelect.disabled = true;
    parentSelect.insertAdjacentHTML("afterend", '<p class="admin-block__note">Esta categoría tiene subcategorías; debe mantenerse como principal.</p>');
  }
  const nameInput = el("#cat-name", form);
  const slugInput = el("#cat-slug", form);
  let customSlug = Boolean(category);
  slugInput.addEventListener("input", () => { customSlug = Boolean(slugInput.value); });
  nameInput.addEventListener("input", () => {
    if (!customSlug) slugInput.value = nameInput.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  });
  let saving = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    saving = true;
    modalSaving = true;
    modalConfirm.disabled = true;
    const error = el("#cat-error", form);
    error.hidden = true;
    try {
      const payload = { name: nameInput.value.trim(), slug: slugInput.value.trim(), description: el("#cat-description", form).value.trim(), parent_id: parentSelect.value || null, sort_order: Number(el("#cat-sort", form).value || 0), active: el("#cat-active", form).checked };
      const res = category ? await adminApi.updateCategory(category.id, payload) : await adminApi.createCategory(payload);
      const saved = res.category;
      state.categories = state.categories.filter((c) => c.id !== saved.id).concat(saved);
      closeModal(true);
      toast(category ? "Categoría actualizada." : "Categoría creada.", "success");
      if (onSaved) onSaved(saved);
      else await loadCategories();
    } catch (err) {
      error.textContent = err?.message || "No pudimos guardar la categoría.";
      error.hidden = false;
    } finally {
      saving = false;
      modalSaving = false;
      modalConfirm.disabled = false;
    }
  });
  openModal({ title: category ? "Editar categoría" : "Nueva categoría o subcategoría", text: form, confirmText: "Guardar categoría", onConfirm: () => form.requestSubmit() });
}

function renderCategories(container) {
  clear(container);
  const head = document.createElement("div");
  head.className = "admin-toolbar";
  head.innerHTML = `<button class="btn btn--primary" id="cat-new">+ Nueva categoría o subcategoría</button>`;
  container.appendChild(head);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", "Categorías y subcategorías");
  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = `<thead><tr><th>Nombre</th><th>Enlace</th><th>Orden</th><th>Productos</th><th>Estado</th><th></th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody");
  orderedCategories().forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="cell-strong">${escapeHtml(categoryLabel(c))}</td><td class="cell-muted">${escapeHtml(c.slug || "")}</td><td class="is-numeric">${c.sort_order ?? 0}</td><td class="is-numeric">${c.product_count ?? 0}</td><td>${c.active ? badge("Activa", "badge--ok") : badge("Inactiva")}</td><td class="cell-actions"><button class="btn btn--secondary btn--sm" data-act="edit-cat" data-id="${escapeHtml(c.id)}">Editar</button></td>`;
    tbody.appendChild(tr);
  });
  if (!state.categories.length) tbody.innerHTML = '<tr><td colspan="6">No hay categorías. Creá la primera para organizar tus productos.</td></tr>';
  wrap.appendChild(table);
  container.appendChild(wrap);
  container.onclick = (event) => {
    if (event.target.closest("#cat-new")) editCategory();
    const button = event.target.closest("[data-act='edit-cat']");
    if (button) editCategory(state.categories.find((c) => c.id === button.dataset.id));
  };
}

// ========================== CONSULTAS ==========================
async function loadInquiries() {
  const section = "consultas";
  const container = viewEl(section, "principal");
  if (!container) return;
  clearViews(section);
  showPrimary(section);
  setBusy(section, true);
  showSectionError(section, null);
  showSkeleton(container);
  try {
    const res = await adminApi.inquiries();
    state.inquiries = res.inquiries || [];
    renderInquiries(container);
  } catch (err) {
    showSectionError(section, err?.message || "No pudimos cargar las consultas.");
    emptyState(container, "Error al cargar", err?.message || "Probá recargar la página.");
  } finally {
    setBusy(section, false);
  }
}

function renderInquiries(container) {
  clear(container);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = `<thead><tr><th>Fecha</th><th>Cliente</th><th>Asunto</th><th>Estado</th><th></th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody");
  if (state.inquiries.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="cell-muted">No hay consultas.</td>`;
    tbody.appendChild(tr);
  } else {
    state.inquiries.forEach((inq) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="cell-muted">${formatDate(inq.created_at)}</td><td><div class="cell-strong">${escapeHtml(inq.name || "")}</div><div class="cell-muted">${escapeHtml(inq.email || "")}</div></td><td>${escapeHtml(inq.subject || "")}</td><td>${badge(INQUIRY_STATUS_LABELS[inq.status] || inq.status, inq.status === "new" ? "badge--warn" : "")}</td><td class="cell-actions"><button class="btn btn--secondary btn--sm" data-act="view-inq" data-id="${escapeHtml(inq.id)}">Ver</button></td>`;
      tbody.appendChild(tr);
    });
  }
  wrap.appendChild(table);
  container.appendChild(wrap);
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act='view-inq']");
    if (btn) openInquiryDetail(btn.dataset.id);
  }, { once: true });
}

function openInquiryDetail(id) {
  const section = "consultas";
  const secondary = viewEl(section, "secundario");
  if (!secondary) return;
  clear(secondary);
  showSecondary(section);
  const inq = state.inquiries.find((i) => String(i.id) === String(id));
  if (!inq) {
    emptyState(secondary, "Consulta no encontrada", "Puede no estar en la lista cargada.");
    return;
  }
  const card = document.createElement("article");
  card.className = "admin-form";
  card.innerHTML = `<div class="admin-form__head"><h3>${escapeHtml(inq.subject || "Consulta")}</h3><button class="btn btn--secondary" data-act="back-inq">← Volver</button></div><div class="detail__grid"><section class="detail__card"><h4>Cliente</h4><dl class="data-list"><div class="data-list__row"><dt>Nombre</dt><dd>${escapeHtml(inq.name || "")}</dd></div><div class="data-list__row"><dt>Correo</dt><dd>${escapeHtml(inq.email || "")}</dd></div><div class="data-list__row"><dt>Teléfono</dt><dd>${escapeHtml(inq.phone || "")}</dd></div></dl></section><section class="detail__card"><h4>Estado</h4><div class="field"><label class="field__label" for="inq-status">Cambiar estado</label><select class="select" id="inq-status"></select></div><button class="btn btn--primary" id="inq-save">Guardar</button></section></div><section class="detail__card"><h4>Mensaje</h4><p style="white-space:pre-wrap;">${escapeHtml(inq.message || "")}</p></section>`;
  secondary.appendChild(card);
  const sel = el("#inq-status", card);
  Object.keys(INQUIRY_STATUS_LABELS).forEach((st) => {
    const opt = document.createElement("option");
    opt.value = st;
    opt.textContent = INQUIRY_STATUS_LABELS[st];
    if (st === inq.status) opt.selected = true;
    sel.appendChild(opt);
  });
  card.addEventListener("click", async (e) => {
    if (e.target.closest("[data-act='back-inq']")) {
      location.hash = "#consultas";
      showPrimary("consultas");
      return;
    }
    if (e.target.id === "inq-save") {
      try {
        await adminApi.updateInquiry(inq.id, { status: sel.value });
        toast("Consulta actualizada.", "success");
        await loadInquiries();
        location.hash = "#consultas";
        showPrimary("consultas");
      } catch (err) {
        toast(err?.message || "No pudimos guardar.", "error");
      }
    }
  });
}

// ========================== CUPONES ==========================
async function loadCoupons() {
  const section = "cupones";
  const container = viewEl(section, "principal");
  if (!container) return;
  clearViews(section);
  showPrimary(section);
  setBusy(section, true);
  showSectionError(section, null);
  showSkeleton(container);
  try {
    const res = await adminApi.coupons();
    state.coupons = res.coupons || [];
    renderCoupons(container);
  } catch (err) {
    showSectionError(section, err?.message || "No pudimos cargar los cupones.");
    emptyState(container, "Error al cargar", err?.message || "Probá recargar la página.");
  } finally {
    setBusy(section, false);
  }
}

function renderCoupons(container) {
  clear(container);
  const head = document.createElement("div");
  head.className = "admin-toolbar";
  head.innerHTML = `<button class="btn btn--primary" id="cup-new">+ Nuevo cupón</button>`;
  container.appendChild(head);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = `<thead><tr><th>Código</th><th>Tipo</th><th class="is-numeric">Valor</th><th>Mínimo</th><th>Usos</th><th>Estado</th><th></th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody");
  if (state.coupons.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7" class="cell-muted">No hay cupones.</td>`;
    tbody.appendChild(tr);
  } else {
    state.coupons.forEach((c) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="admin-code">${escapeHtml(c.code || "")}</td><td>${c.discount_type === "percent" ? "Porcentaje" : "Monto fijo"}</td><td class="is-numeric">${c.discount_type === "percent" ? c.discount_value + "%" : formatMoney(c.discount_value)}</td><td class="is-numeric">${formatMoney(c.min_subtotal || 0)}</td><td class="is-numeric">${c.used_count || 0}/${c.max_uses || "∞"}</td><td>${c.active ? badge("Activo", "badge--ok") : badge("Inactivo")}</td><td class="cell-actions"><button class="btn btn--secondary btn--sm" data-act="edit-cup" data-id="${escapeHtml(c.id)}">Editar</button></td>`;
      tbody.appendChild(tr);
    });
  }
  wrap.appendChild(table);
  container.appendChild(wrap);
  container.onclick = async (e) => {
    if (e.target.id === "cup-new") {
      const code = prompt("Código del cupón (se convierte a mayúsculas)");
      if (!code) return;
      const type = prompt("Tipo: percent (porcentaje) o fixed (monto en pesos)", "percent");
      if (type === null) return;
      const val = prompt("Valor del descuento (ejemplo: 10 para 10% o 100 para $100)");
      if (val === null) return;
      const maxUses = prompt("Máximo de usos totales. Dejá vacío para sin límite.", "");
      if (maxUses === null) return;
      try {
        await adminApi.createCoupon({ code, discount_type: type === "fixed" ? "fixed" : "percent", discount_value: Number(val || 0), min_subtotal: 0, max_uses: maxUses.trim() || null, active: true });
        toast("Cupón creado.", "success");
        await loadCoupons();
      } catch (err) {
        toast(err?.message || "No pudimos crear.", "error");
      }
      return;
    }
    const btn = e.target.closest("button[data-act='edit-cup']");
    if (btn) {
      const cup = state.coupons.find((c) => c.id === btn.dataset.id);
      if (!cup) return;
      const active = confirm("¿Cupón activo?");
      const val = prompt("Valor", cup.discount_value);
      if (val === null) return;
      const maxUses = prompt("Máximo de usos totales. Dejá vacío para sin límite.", cup.max_uses ?? "");
      if (maxUses === null) return;
      try {
        await adminApi.updateCoupon(cup.id, { active, discount_value: Number(val || cup.discount_value), max_uses: maxUses.trim() || null });
        toast("Cupón actualizado.", "success");
        await loadCoupons();
      } catch (err) {
        toast(err?.message || "No pudimos guardar.", "error");
      }
    }
  };
}

// ========================== AJUSTES ==========================
async function loadSettings() {
  const section = "ajustes";
  const container = viewEl(section, "principal");
  if (!container) return;
  clearViews(section);
  showPrimary(section);
  setBusy(section, true);
  showSectionError(section, null);
  showSkeleton(container);
  try {
    if (!state.settings) {
      const res = await (state.admin?.role === "owner" ? adminApi.settings() : api.publicSettings());
      state.settings = res?.settings || res;
    }
    renderSettings(container);
  } catch (err) {
    showSectionError(section, err?.message || "No pudimos cargar los ajustes.");
    emptyState(container, "Error al cargar", err?.message || "Probá recargar la página.");
  } finally {
    setBusy(section, false);
  }
}

function renderSettings(container) {
  clear(container);
  const s = state.settings || {};
  const form = document.createElement("form");
  form.className = "admin-form";
  form.id = "settings-form";
  form.innerHTML = `
    <div class="admin-form__head"><h3>Ajustes del sitio</h3></div>
    <div class="admin-form__section"><h4>Negocio</h4><div class="admin-form__grid"><div class="field"><label class="field__label" for="set-name">Nombre</label><input class="input" id="set-name" value="${escapeHtml(s.business?.name || "")}"></div><div class="field"><label class="field__label" for="set-whatsapp">WhatsApp</label><input class="input" id="set-whatsapp" value="${escapeHtml(s.business?.whatsapp || "")}"></div><div class="field"><label class="field__label" for="set-email">Email</label><input class="input" id="set-email" value="${escapeHtml(s.business?.email || "")}"></div><div class="field"><label class="field__label" for="set-phone">Teléfono</label><input class="input" id="set-phone" value="${escapeHtml(s.business?.phone || "")}"></div><div class="field"><label class="field__label" for="set-address">Dirección</label><input class="input" id="set-address" value="${escapeHtml(s.business?.address || "")}"></div><div class="field"><label class="field__label" for="set-city">Ciudad</label><input class="input" id="set-city" value="${escapeHtml(s.business?.city || "")}"></div></div></div>
    <div class="admin-form__section"><h4>Colores de marca</h4><div class="admin-form__grid"><div class="field"><label class="field__label" for="set-primary">Color primario</label><div class="color-field"><input type="color" id="set-primary" value="${escapeHtml(s.brand?.primary || "#134E9D")}"><input class="input" id="set-primary-hex" value="${escapeHtml(s.brand?.primary || "#134E9D")}"></div></div><div class="field"><label class="field__label" for="set-accent">Color acento</label><div class="color-field"><input type="color" id="set-accent" value="${escapeHtml(s.brand?.accent || "#7A9A78")}"><input class="input" id="set-accent-hex" value="${escapeHtml(s.brand?.accent || "#7A9A78")}"></div></div><div class="field"><label class="field__label" for="set-ink">Color texto</label><div class="color-field"><input type="color" id="set-ink" value="${escapeHtml(s.brand?.ink || "#1F2933")}"><input class="input" id="set-ink-hex" value="${escapeHtml(s.brand?.ink || "#1F2933")}"></div></div></div></div>
    <div class="admin-form__section"><h4>Checkout</h4><div class="admin-form__grid"><div class="field"><label class="field__label" for="set-ship">Costo de envío</label><input class="input" id="set-ship" type="number" value="${s.checkout?.shipping_cost ?? 0}"></div><div class="field"><label class="field__label" for="set-free">Envío gratis desde</label><input class="input" id="set-free" type="number" value="${s.checkout?.free_shipping_threshold ?? 0}"></div></div><label class="checkbox"><input type="checkbox" id="set-pickup" ${s.checkout?.allow_pickup ? "checked" : ""}><span>Permitir retiro en local</span></label><div class="field"><label class="field__label" for="set-pickup-note">Nota de retiro</label><input class="input" id="set-pickup-note" value="${escapeHtml(s.checkout?.pickup_note || "")}"></div></div>
    <div class="admin-form__section"><h4>Medios de pago</h4><p class="admin-block__note">Los descuentos y recargos se configuran en cada producto. Habilitar transferencia no activa descuentos por sí solo. Mercado Pago además requiere la configuración del servidor.</p><label class="checkbox"><input id="set-mp-enabled" type="checkbox" ${s.payments?.mercadopago_enabled !== false ? "checked" : ""}><span>Ofrecer Mercado Pago</span></label><label class="checkbox"><input id="set-transfer-enabled" type="checkbox" ${s.payments?.transfer?.enabled ? "checked" : ""}><span>Ofrecer transferencia</span></label><div class="admin-form__grid">${[["bank","Banco"],["holder","Titular"],["account","Cuenta"]].map(([key,label]) => `<label class="field"><span class="field__label">${label}</span><input class="input" id="set-transfer-${key}" maxlength="160" value="${escapeHtml(s.payments?.transfer?.[key] || "")}"></label>`).join("")}</div><p class="admin-block__note">Moneda de la cuenta: pesos uruguayos (UYU). Los datos se entregan al cliente después de crear el pedido.</p><label class="field"><span class="field__label">Instrucciones de transferencia</span><textarea class="textarea" id="set-transfer-instructions" maxlength="1500">${escapeHtml(s.payments?.transfer?.instructions || "")}</textarea></label><label class="checkbox"><input id="set-cash-enabled" type="checkbox" ${s.payments?.cash?.enabled ? "checked" : ""}><span>Ofrecer pago al contado en efectivo</span></label><label class="field"><span class="field__label">Dónde y cuándo pagar en efectivo</span><textarea class="textarea" id="set-cash-instructions" maxlength="1500">${escapeHtml(s.payments?.cash?.instructions || "")}</textarea></label></div>
    <div class="admin-form__section"><h4>Datos legales</h4><label class="field"><span class="field__label">Razón social</span><input class="input" id="set-legal-name" maxlength="160" value="${escapeHtml(s.business?.legal_name || "")}"></label><label class="field"><span class="field__label">RUT</span><input class="input" id="set-tax-id" maxlength="160" value="${escapeHtml(s.business?.tax_id || "")}"></label><p class="admin-block__note">Completá con los datos reales antes de abrir las ventas.</p></div>
    <div class="admin-form__section"><h4>Impuestos</h4><label class="checkbox"><input type="checkbox" id="set-tax-inc" ${s.tax?.include_tax ? "checked" : ""}><span>IVA incluido</span></label><div class="admin-form__grid"><div class="field"><label class="field__label" for="set-tax-rate">Tasa %</label><input class="input" id="set-tax-rate" type="number" value="${s.tax?.rate ?? 22}"></div><div class="field"><label class="field__label" for="set-tax-label">Etiqueta</label><input class="input" id="set-tax-label" value="${escapeHtml(s.tax?.label || "IVA incluido")}"></div></div></div>
    <div class="admin-form__section"><h4>Notificaciones</h4><div class="field"><label class="field__label" for="set-admin-email">Correo de avisos</label><input class="input" id="set-admin-email" value="${escapeHtml(s.notifications?.admin_email || "")}"></div><label class="checkbox"><input type="checkbox" id="set-notify-paid" ${s.notifications?.notify_on_paid !== false ? "checked" : ""}><span>Avisar al admin cuando hay pago confirmado</span></label><label class="checkbox"><input type="checkbox" id="set-notify-inq" ${s.notifications?.notify_on_inquiry !== false ? "checked" : ""}><span>Avisar al admin en nuevas consultas</span></label><label class="checkbox"><input type="checkbox" id="set-notify-cust" ${s.notifications?.notify_customer !== false ? "checked" : ""}><span>Avisar al cliente por cambios de estado</span></label></div>
    <div class="admin-form__actions"><button class="btn btn--primary" type="submit">Guardar ajustes</button></div>
  `;
  container.appendChild(form);

  const p = el("#set-primary", form); const ph = el("#set-primary-hex", form);
  const a = el("#set-accent", form); const ah = el("#set-accent-hex", form);
  const i = el("#set-ink", form); const ih = el("#set-ink-hex", form);
  if (p && ph) { p.addEventListener("input", () => { ph.value = p.value; }); ph.addEventListener("input", () => { if (/^#[0-9a-fA-F]{6}$/.test(ph.value)) p.value = ph.value; }); }
  if (a && ah) { a.addEventListener("input", () => { ah.value = a.value; }); ah.addEventListener("input", () => { if (/^#[0-9a-fA-F]{6}$/.test(ah.value)) a.value = ah.value; }); }
  if (i && ih) { i.addEventListener("input", () => { ih.value = i.value; }); ih.addEventListener("input", () => { if (/^#[0-9a-fA-F]{6}$/.test(ih.value)) i.value = ih.value; }); }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const payload = {
        business: {
          legal_name: el("#set-legal-name", form)?.value,
          tax_id: el("#set-tax-id", form)?.value,
          name: el("#set-name", form)?.value,
          whatsapp: el("#set-whatsapp", form)?.value,
          email: el("#set-email", form)?.value,
          phone: el("#set-phone", form)?.value,
          address: el("#set-address", form)?.value,
          city: el("#set-city", form)?.value,
        },
        brand: {
          primary: el("#set-primary-hex", form)?.value || el("#set-primary", form)?.value,
          accent: el("#set-accent-hex", form)?.value || el("#set-accent", form)?.value,
          ink: el("#set-ink-hex", form)?.value || el("#set-ink", form)?.value,
        },
        checkout: {
          shipping_cost: Number(el("#set-ship", form)?.value || 0),
          free_shipping_threshold: Number(el("#set-free", form)?.value || 0),
          allow_pickup: el("#set-pickup", form)?.checked,
          pickup_note: el("#set-pickup-note", form)?.value,
        },
        payments: {
          mercadopago_enabled: el("#set-mp-enabled", form).checked,
          transfer: { enabled: el("#set-transfer-enabled", form).checked, currency: "UYU", bank: el("#set-transfer-bank", form).value, holder: el("#set-transfer-holder", form).value, account: el("#set-transfer-account", form).value, instructions: el("#set-transfer-instructions", form).value },
          cash: { enabled: el("#set-cash-enabled", form).checked, instructions: el("#set-cash-instructions", form).value },
        },
        tax: {
          include_tax: el("#set-tax-inc", form)?.checked,
          rate: Number(el("#set-tax-rate", form)?.value || 22),
          label: el("#set-tax-label", form)?.value,
        },
        notifications: {
          admin_email: el("#set-admin-email", form)?.value,
          notify_on_paid: el("#set-notify-paid", form)?.checked,
          notify_on_inquiry: el("#set-notify-inq", form)?.checked,
          notify_customer: el("#set-notify-cust", form)?.checked,
        },
      };
      const res = await adminApi.updateSettings(payload);
      state.settings = res?.settings || res;
      toast("Ajustes guardados.", "success");
      announce("Ajustes guardados.");
    } catch (err) {
      toast(err?.message || "No pudimos guardar los ajustes.", "error");
    } finally {
      btn.disabled = false;
    }
  });
}

// ========================== CORREOS ==========================
async function loadEmails() {
  const section = "correos";
  const container = viewEl(section, "principal");
  if (!container) return;
  clearViews(section);
  showPrimary(section);
  setBusy(section, true);
  showSectionError(section, null);
  showSkeleton(container);
  try {
    const res = await adminApi.emails();
    state.emails = res.emails || [];
    renderEmails(container);
  } catch (err) {
    showSectionError(section, err?.message || "No pudimos cargar el registro de correos.");
    emptyState(container, "Error al cargar", err?.message || "Probá recargar la página.");
  } finally {
    setBusy(section, false);
  }
}

function renderEmails(container) {
  clear(container);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = `<thead><tr><th>Fecha</th><th>Para</th><th>Asunto</th><th>Plantilla</th><th>Estado</th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody");
  if (state.emails.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="cell-muted">Sin registros.</td>`;
    tbody.appendChild(tr);
  } else {
    state.emails.slice(0, 100).forEach((e) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="cell-muted">${formatDateTime(e.created_at)}</td><td>${escapeHtml(e.to_email || "")}</td><td class="cell-wrap">${escapeHtml(e.subject || "")}</td><td class="cell-muted">${escapeHtml(e.template || "")}</td><td>${e.status === "sent" ? badge("Enviado", "badge--ok") : badge("Fallido", "badge--danger")}${e.error ? `<div class="cell-error">${escapeHtml(e.error)}</div>` : ""}</td>`;
      tbody.appendChild(tr);
    });
  }
  wrap.appendChild(table);
  container.appendChild(wrap);
}

// ========================== AUDITORÍA ==========================
async function loadAudit() {
  const section = "auditoria";
  const container = viewEl(section, "principal");
  if (!container) return;
  clearViews(section);
  showPrimary(section);
  setBusy(section, true);
  showSectionError(section, null);
  showSkeleton(container);
  try {
    const res = await adminApi.audit();
    state.audit = res.events || [];
    renderAudit(container);
  } catch (err) {
    showSectionError(section, err?.message || "No pudimos cargar la auditoría.");
    emptyState(container, "Error al cargar", err?.message || "Probá recargar la página.");
  } finally {
    setBusy(section, false);
  }
}

function renderAudit(container) {
  clear(container);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = `<thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Objeto</th><th>Detalle</th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody");
  if (state.audit.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="cell-muted">Sin registros.</td>`;
    tbody.appendChild(tr);
  } else {
    state.audit.slice(0, 150).forEach((ev) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="cell-muted">${formatDateTime(ev.created_at)}</td><td>${escapeHtml(ev.admin_name || ev.admin_email || "-")}</td><td>${escapeHtml(ev.action || "")}</td><td class="cell-muted">${escapeHtml(ev.target_type || "")}${ev.target_id ? ` · ${ev.target_id}` : ""}</td><td class="cell-wrap cell-muted">${escapeHtml(ev.detail ? JSON.stringify(ev.detail) : "")}</td>`;
      tbody.appendChild(tr);
    });
  }
  wrap.appendChild(table);
  container.appendChild(wrap);
}

// ========================== ADMINISTRADORES ==========================
async function loadAdmins() {
  const section = "administradores";
  const container = viewEl(section, "principal");
  if (!container) return;
  clearViews(section);
  showPrimary(section);
  setBusy(section, true);
  showSectionError(section, null);
  showSkeleton(container);
  try {
    const res = await adminApi.admins();
    state.admins = res.admins || [];
    renderAdmins(container);
  } catch (err) {
    showSectionError(section, err?.message || "No pudimos cargar los administradores.");
    emptyState(container, "Error al cargar", err?.message || "Probá recargar la página.");
  } finally {
    setBusy(section, false);
  }
}

function renderAdmins(container) {
  clear(container);
  const head = document.createElement("div");
  head.className = "admin-toolbar";
  head.innerHTML = `<button class="btn btn--primary" id="adm-new">+ Nuevo administrador</button>`;
  container.appendChild(head);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = `<thead><tr><th>Nombre</th><th>Correo</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector("tbody");
  if (state.admins.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="cell-muted">Sin administradores.</td>`;
    tbody.appendChild(tr);
  } else {
    state.admins.forEach((a) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="cell-strong">${escapeHtml(a.name || "")}</td><td>${escapeHtml(a.email || "")}</td><td>${a.active ? badge("Activo", "badge--ok") : badge("Inactivo")}</td><td class="cell-muted">${formatDateTime(a.last_login_at)}</td><td class="cell-actions"><button class="btn btn--secondary btn--sm" data-act="edit-adm" data-id="${escapeHtml(a.id)}">Editar</button></td>`;
      tbody.appendChild(tr);
    });
  }
  wrap.appendChild(table);
  container.appendChild(wrap);
  container.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const account = button.dataset.act === "edit-adm" ? state.admins.find(a => a.id === button.dataset.id) : null;
    if (button.id !== "adm-new" && !account) return;
    try {
      const changed = await editAdminAccount(account, state.admin);
      if (changed) { toast("Administrador guardado.", "success"); await loadAdmins(); }
    } catch (error) { toast(error.message, "error"); }
  });
}
