/**
 * Módulo de cambio de tema
 * Gestiona el cambio entre modo oscuro/claro con persistencia en localStorage
 */
(function initTheme() {
  const STORAGE_KEY = 'water-dashboard-theme';
  const DARK_CLASS = 'dark';

  /**
    * Obtiene el tema actual desde localStorage o la preferencia del sistema
   */
  function getTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return stored;
    }
    
    // Revisar preferencia del sistema
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    
    return 'light';
  }

  /**
    * Aplica el tema al documento
   */
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add(DARK_CLASS);
    } else {
      document.documentElement.classList.remove(DARK_CLASS);
    }
    
    // Actualizar el ícono del botón de tema si existe
    updateToggleIcon(theme);
    
    // Volver a renderizar íconos de Lucide después del cambio de tema
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      setTimeout(() => window.lucide.createIcons(), 100);
    }
  }

  /**
   * Actualiza el ícono del botón de tema
   */
  function updateToggleIcon(theme) {
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    
    if (sunIcon && moonIcon) {
      if (theme === 'dark') {
        sunIcon.classList.add('hidden');
        moonIcon.classList.remove('hidden');
      } else {
        sunIcon.classList.remove('hidden');
        moonIcon.classList.add('hidden');
      }
    }
  }

  /**
    * Alterna el tema
   */
  function toggleTheme() {
    const current = getTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    
    console.log(`[Theme] Switched to ${next} mode`);
  }

  /**
    * Inicializa el tema al cargar la página
   */
  function init() {
    const theme = getTheme();
    applyTheme(theme);
    
    // Vincular manejador del interruptor de tema
    const toggleButton = document.getElementById('theme-toggle');
    if (toggleButton) {
      toggleButton.addEventListener('click', toggleTheme);
    }
    
    // Escuchar cambios de tema del sistema
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem(STORAGE_KEY)) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      });
    }
    
    console.log(`[Theme] Initialized with ${theme} mode`);
  }

  // Inicializar de inmediato para evitar parpadeos
  init();

  // También inicializar en DOMContentLoaded para el botón de tema
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  }

  // Exponer función de cambio globalmente
  window.toggleTheme = toggleTheme;
})();
