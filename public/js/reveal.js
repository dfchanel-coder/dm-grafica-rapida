/**
 * Animaciones de entrada y estado del encabezado al hacer scroll.
 */
function initReveal() {
  const targets = document.querySelectorAll("main > section, .product-card, .step");
  targets.forEach((node) => node.classList.add("reveal"));
  if (!("IntersectionObserver" in window)) {
    targets.forEach((node) => node.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  targets.forEach((node) => io.observe(node));
}

function initHeaderScroll() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  const onScroll = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 24);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { initReveal(); initHeaderScroll(); }, { once: true });
} else {
  initReveal(); initHeaderScroll();
}