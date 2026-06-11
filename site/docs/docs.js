/* OpenLeads docs — mobile menu + on-this-page scroll-spy. Dependency-free. */
"use strict";

// nav shadow
const nav = document.getElementById("nav");
const onScroll = () => nav && nav.classList.toggle("scrolled", window.scrollY > 12);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// mobile sidebar toggle
const toggle = document.getElementById("dsbToggle");
if (toggle) {
  toggle.addEventListener("click", () => document.body.classList.toggle("menu-open"));
  document.querySelectorAll(".dsb__link").forEach((a) =>
    a.addEventListener("click", () => document.body.classList.remove("menu-open")));
}

// scroll-spy: highlight the current section in the right-rail TOC
const tocLinks = Array.from(document.querySelectorAll(".dtoc a"));
if (tocLinks.length && "IntersectionObserver" in window) {
  const byId = new Map(tocLinks.map((a) => [a.getAttribute("href").slice(1), a]));
  const heads = tocLinks
    .map((a) => document.getElementById(a.getAttribute("href").slice(1)))
    .filter(Boolean);
  let active = null;
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        if (active) active.classList.remove("active");
        active = byId.get(e.target.id);
        if (active) active.classList.add("active");
      }
    });
  }, { rootMargin: "-90px 0px -70% 0px", threshold: 0 });
  heads.forEach((h) => spy.observe(h));
}
