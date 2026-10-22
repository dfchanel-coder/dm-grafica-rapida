/**
 * Carrusel simple, accesible, sin dependencias.
 */
export function initCarousel(root) {
  const track = root.querySelector("[data-carousel-track]");
  const slides = Array.from(track?.children || []);
  if (!track || slides.length === 0) return;

  let index = 0;
  const dotsContainer = root.querySelector("[data-carousel-dots]");

  const renderDots = () => {
    if (!dotsContainer) return;
    dotsContainer.innerHTML = slides.map((_, i) => `
      <button class="carousel__dot" type="button" data-index="${i}" aria-label="Ir a la imagen ${i + 1}" ${i === index ? 'aria-current="true"' : ""}></button>
    `).join("");
  };

  const goTo = (i) => {
    index = (i + slides.length) % slides.length;
    track.style.transform = `translateX(-${index * 100}%)`;
    renderDots();
  };

  root.querySelector("[data-carousel-prev]")?.addEventListener("click", () => goTo(index - 1));
  root.querySelector("[data-carousel-next]")?.addEventListener("click", () => goTo(index + 1));
  dotsContainer?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-index]");
    if (btn) goTo(Number(btn.dataset.index));
  });

  renderDots();
  goTo(0);

  let timer = setInterval(() => goTo(index + 1), 5000);
  root.addEventListener("mouseenter", () => clearInterval(timer));
  root.addEventListener("mouseleave", () => { timer = setInterval(() => goTo(index + 1), 5000); });

  // Soporte teclado
  root.setAttribute("tabindex", "0");
  root.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") goTo(index - 1);
    if (e.key === "ArrowRight") goTo(index + 1);
  });
}

export function initAllCarousels() {
  document.querySelectorAll("[data-carousel]").forEach(initCarousel);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAllCarousels, { once: true });
} else {
  initAllCarousels();
}