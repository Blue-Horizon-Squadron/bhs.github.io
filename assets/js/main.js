/**
 * Blue Horizon Squadron — Main JS
 * Navigation, scroll effects, and general utilities
 */

(function () {
  'use strict';

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const nav    = document.getElementById('site-nav');
  const toggle = document.getElementById('nav-toggle');
  const links  = document.getElementById('nav-links');

  // Scroll effect
  if (nav) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 20) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    }, { passive: true });
  }

  // Mobile toggle
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      const isOpen = links.classList.toggle('is-open');
      toggle.classList.toggle('is-active', isOpen);
      toggle.setAttribute('aria-expanded', isOpen);
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target)) {
        links.classList.remove('is-open');
        toggle.classList.remove('is-active');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });

    // Close on nav link click (mobile)
    links.querySelectorAll('.nav-link').forEach(function (link) {
      link.addEventListener('click', function () {
        links.classList.remove('is-open');
        toggle.classList.remove('is-active');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ─── Smooth scroll for anchor links ─────────────────────────────────────────

  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // ─── Active nav link ─────────────────────────────────────────────────────────

  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(function (link) {
    const href = link.getAttribute('href');
    if (href && href !== '/' && currentPath.startsWith(href)) {
      link.classList.add('active');
    }
  });

})();
