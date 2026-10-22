/**
 * Cliente HTTP del sitio.
 * Un único punto para talking con la API: errores homogeneousos y simples.
 */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, { method = "GET", body, headers = {}, admin = false } = {}) {
  const options = {
    method,
    headers: { Accept: "application/json", ...headers },
    credentials: "same-origin",
  };

  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  if (admin) {
    const token = getCsrfToken();
    if (token) options.headers["X-CSRF-Token"] = token;
  }

  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiError("No pudimos conectar con el servidor. Revisá tu conexión.", 0);
  }

  if (response.status === 204) return null;

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : {};

  if (!response.ok) {
    throw new ApiError(payload.error || "Ocurrió un error. Probá de nuevo.", response.status);
  }

  return payload;
}

/* --- Token CSRF del panel ------------------------------------------------ */

const CSRF_KEY = "dmgrafica:csrf";

export function setCsrfToken(token) {
  if (token) sessionStorage.setItem(CSRF_KEY, token);
  else sessionStorage.removeItem(CSRF_KEY);
}

export function getCsrfToken() {
  return sessionStorage.getItem(CSRF_KEY);
}

/* --- Formato ------------------------------------------------------------- */

export function formatMoney(amount, currency = "UYU") {
  const value = Number(amount || 0);
  try {
    return new Intl.NumberFormat("es-UY", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$ ${value.toLocaleString("es-UY")}`;
  }
}

export function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-UY", { day: "numeric", month: "long", year: "numeric" });
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* --- Endpoints ------------------------------------------------------------ */

export const api = {
  publicSettings: () => request("/api/settings/public"),
  catalog: () => request("/api/catalog"),
  product: (slug) => request(`/api/products/${encodeURIComponent(slug)}`),
  createOrder: (payload) => request("/api/orders", { method: "POST", body: payload }),
  trackOrder: (code, email) => request(`/api/orders/track?code=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`),
  reconcileOrder: (code, email) => request("/api/orders/reconcile", { method: "POST", body: { code, email } }),
  createInquiry: (payload) => request("/api/inquiries", { method: "POST", body: payload }),
  paymentStatus: () => request("/api/payments/status"),
};

/* --- API del panel -------------------------------------------------------- */

export const adminApi = {
  session: () => request("/api/admin/session"),
  login: (email, password) => request("/api/admin/login", { method: "POST", body: { email, password } }),
  logout: () => request("/api/admin/logout", { method: "POST", admin: true }),

  overview: () => request("/api/admin/overview"),
  products: () => request("/api/admin/products"),
  createProduct: (payload) => request("/api/admin/products", { method: "POST", body: payload, admin: true }),
  updateProduct: (id, payload) => request(`/api/admin/products/${id}`, { method: "PUT", body: payload, admin: true }),
  deleteProduct: (id) => request(`/api/admin/products/${id}`, { method: "DELETE", admin: true }),
  uploadImage: async (id, file) => {
    const form = new FormData();
    form.append("image", file);
    const response = await fetch(`/api/admin/products/${id}/images`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
      headers: { "X-CSRF-Token": getCsrfToken() || "" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(payload.error || "No pudimos subir la imagen.", response.status);
    return payload;
  },
  deleteImage: (id, url) => request(`/api/admin/products/${id}/images?url=${encodeURIComponent(url)}`, { method: "DELETE", admin: true }),

  categories: () => request("/api/admin/categories"),
  createCategory: (payload) => request("/api/admin/categories", { method: "POST", body: payload, admin: true }),
  updateCategory: (id, payload) => request(`/api/admin/categories/${id}`, { method: "PUT", body: payload, admin: true }),
  deleteCategory: (id) => request(`/api/admin/categories/${id}`, { method: "DELETE", admin: true }),

  orders: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/api/admin/orders${query ? `?${query}` : ""}`);
  },
  order: (id) => request(`/api/admin/orders/${id}`),
  updateOrder: (id, payload) => request(`/api/admin/orders/${id}`, { method: "PATCH", body: payload, admin: true }),
  quoteOrder: (id, payload) => request(`/api/admin/orders/${id}/quote`, { method: "POST", body: payload, admin: true }),

  inquiries: () => request("/api/admin/inquiries"),
  updateInquiry: (id, payload) => request(`/api/admin/inquiries/${id}`, { method: "PATCH", body: payload, admin: true }),

  coupons: () => request("/api/admin/coupons"),
  createCoupon: (payload) => request("/api/admin/coupons", { method: "POST", body: payload, admin: true }),
  updateCoupon: (id, payload) => request(`/api/admin/coupons/${id}`, { method: "PUT", body: payload, admin: true }),
  deleteCoupon: (id) => request(`/api/admin/coupons/${id}`, { method: "DELETE", admin: true }),

  settings: () => request("/api/admin/settings"),
  updateSettings: (payload) => request("/api/admin/settings", { method: "PUT", body: payload, admin: true }),

  emails: () => request("/api/admin/emails"),
  audit: () => request("/api/admin/audit"),
  admins: () => request("/api/admin/admins"),
  createAdmin: (payload) => request("/api/admin/admins", { method: "POST", body: payload, admin: true }),
  updateAdmin: (id, payload) => request(`/api/admin/admins/${id}`, { method: "PUT", body: payload, admin: true }),
};
