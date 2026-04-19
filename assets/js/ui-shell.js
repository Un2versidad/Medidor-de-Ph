(function attachShellModule(global) {
  const WaterDashboard = global.WaterDashboard || (global.WaterDashboard = {});

  function optionsMarkup() {
    return `
      <option value="chiriqui">Chiriquí</option>
      <option value="cocle">Coclé</option>
      <option value="panama_oeste">Panamá Oeste</option>
      <option value="colon">Colón</option>
      <option value="panama_este">Panamá Este</option>
      <option value="panama">Panamá</option>
      <option value="darien">Darién</option>
      <option value="panama_norte_chilibre">Panamá Norte (Chilibre)</option>
    `;
  }

  function historyPanel(config) {
    return `
      <div id="${config.tabId}" class="tab-content">
        <div class="flex flex-wrap items-center gap-3 mb-4">
          <select id="${config.selectId}" title="Ubicación para ${config.label}" aria-label="Ubicación para ${config.label}" class="h-8 rounded-md border border-input bg-background px-3 text-sm shadow-sm cursor-pointer">
            ${optionsMarkup()}
          </select>
          <div class="flex gap-1 p-0.5 bg-muted rounded-md border border-border">
            <button class="htab active" data-range="7d" data-window="12h">7 Días</button>
            <button class="htab" data-range="1d" data-window="1h">1 Día</button>
            <button class="htab" data-range="1h" data-window="5m">1 Hora</button>
          </div>
          <span class="text-xs text-muted-foreground ml-auto hidden sm:block">${config.note}</span>
        </div>
        <p class="text-sm font-semibold mb-3 flex items-center gap-2">
          <i data-lucide="${config.icon}" class="w-4 h-4 text-primary"></i>
          ${config.title}
        </p>
        <canvas id="${config.canvasId}"></canvas>
        <div id="${config.nodataId}" class="hidden py-10 text-center text-sm text-muted-foreground">Sin datos para esta ubicación y rango</div>
      </div>
    `;
  }

  WaterDashboard.renderAppShell = function renderAppShell() {
    return `
    <a href="#main-content" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-card focus:text-foreground focus:px-3 focus:py-2 focus:rounded-md focus:shadow">
      Saltar al contenido principal
    </a>
    <div class="dashboard-shell relative isolate flex flex-col min-h-screen">
      <div class="dashboard-atmosphere" aria-hidden="true">
        <div class="dashboard-orb dashboard-orb-a"></div>
        <div class="dashboard-orb dashboard-orb-b"></div>
        <div class="dashboard-orb dashboard-orb-c"></div>
      </div>

      <header class="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur shadow-[0_10px_28px_rgba(15,23,42,0.06)] dark:shadow-[0_10px_28px_rgba(0,0,0,0.3)] app-header">
        <div class="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4">
          <div class="flex items-center justify-between gap-4 mb-2">
            <div class="min-w-0">
              <p class="text-[11px] uppercase tracking-[0.28em] font-semibold text-primary/80">Panamá · Monitoreo de calidad de agua</p>
              <h1 class="text-lg md:text-2xl font-bold tracking-tight">HydroLabs | Red de Monitoreo de Calidad de Agua</h1>
              <p class="text-sm text-muted-foreground mt-1">pH, turbidez y TDS con visualización en tiempo real y guardado calibrado.</p>
            </div>
            <div class="dashboard-brand-pill hidden sm:flex shrink-0 items-center gap-3 rounded-full border border-border bg-card px-3.5 py-2 shadow-sm">
              <span class="dashboard-brand-mark">
                <img class="h-7 w-7" src="./img/favicon-hydrolabs.svg" alt="HydroLabs" width="28" height="28" loading="lazy">
              </span>
              <div class="min-w-0">
                <p class="dashboard-brand-title">HydroLabs Node</p>
                <p class="dashboard-brand-subtitle"><span class="dashboard-pulse-dot" aria-hidden="true"></span>Red activa en tiempo real</p>
              </div>
            </div>
          </div>
          <nav class="flex items-center gap-4 pt-2 border-t border-border/50">
            <a href="landing.html" class="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
              <i data-lucide="home" class="w-3.5 h-3.5"></i>
              Inicio
            </a>
            <a href="components.html" class="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
              <i data-lucide="cpu" class="w-3.5 h-3.5"></i>
              Componentes
            </a>
            <a href="index.html?dashboard=1" class="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1.5">
              <i data-lucide="gauge" class="w-3.5 h-3.5"></i>
              Dashboard
            </a>
            <button id="theme-toggle" class="theme-toggle ml-auto" aria-label="Cambiar tema" title="Cambiar tema" style="width: 32px; height: 32px;">
              <i id="theme-icon-sun" data-lucide="sun" class="w-4 h-4"></i>
              <i id="theme-icon-moon" data-lucide="moon" class="w-4 h-4 hidden"></i>
            </button>
          </nav>
        </div>
      </header>

      <main id="main-content" class="flex-1 w-full max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-5">
        <!-- Sección de control simplificada -->
        <section class="dashboard-control-panel rounded-2xl border border-border bg-card/90 backdrop-blur-xl shadow-[0_20px_60px_rgba(15,23,42,0.08)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.3)] overflow-hidden">
          <div class="grid gap-5 p-5 md:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div class="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div class="flex flex-col gap-2 min-w-0 flex-1">
                <label for="location-select" class="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <i data-lucide="map-pin" class="w-3.5 h-3.5"></i>
                  Punto de Muestreo
                </label>
                <select id="location-select" name="location" autocomplete="off" class="h-11 rounded-xl border border-input bg-background px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 cursor-pointer">
                  ${optionsMarkup()}
                </select>
              </div>
              <div class="hidden lg:block min-w-0 flex-1 rounded-xl border border-dashed border-border/80 bg-muted/30 px-4 py-3">
                <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                  <i data-lucide="info" class="w-3.5 h-3.5"></i>
                  Flujo de trabajo
                </p>
                <p class="text-sm text-muted-foreground leading-relaxed">Selecciona ubicación, sumerge los sensores y ejecuta una lectura.</p>
              </div>
            </div>
            <div class="flex gap-2">
              <button id="export-json-btn" class="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-border bg-background text-foreground text-sm font-semibold hover:bg-muted transition-all whitespace-nowrap">
                <i data-lucide="download" class="w-4 h-4"></i>
                <span class="hidden sm:inline">Exportar JSON</span>
              </button>
              <button id="generate-report-btn" class="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-border bg-background text-foreground text-sm font-semibold hover:bg-muted transition-all whitespace-nowrap">
                <i data-lucide="file-text" class="w-4 h-4"></i>
                <span class="hidden sm:inline">Generar Reporte</span>
              </button>
              <button id="take-reading-btn" class="capture-control-btn capture-btn-paused inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl border text-sm font-semibold shadow-md disabled:pointer-events-none disabled:opacity-50 transition-all whitespace-nowrap" aria-live="polite" aria-pressed="false">
                <span id="btn-text" class="flex items-center gap-2">
                  <i data-lucide="droplets" class="w-4 h-4"></i>
                  Tomar Lectura
                </span>
                <span id="btn-spinner" class="hidden items-center gap-2">
                  <i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>
                  Procesando…
                </span>
              </button>
            </div>
            <div class="lg:col-span-2 mt-2 rounded-xl border border-border/70 bg-muted/30 px-4 py-3">
              <p id="primary-action-note" class="text-xs text-muted-foreground mb-1">Lectura detenida. Pulsa "Tomar Lectura" para iniciar la captura.</p>
              <p id="sensor-preview-note" class="text-sm text-foreground font-medium">Vista previa en vivo activa: estos datos no se guardan.</p>
              <p id="calibration-note" class="text-xs text-muted-foreground mt-1">Calibración pendiente. Espera unos segundos antes de guardar una lectura.</p>
              <div class="mt-3 rounded-lg border border-border/70 bg-card/70 p-3">
                <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <i data-lucide="cpu" class="w-3.5 h-3.5"></i>
                  Leyenda LED Matrix
                </p>
                <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 text-xs text-foreground/90">
                  <p><span class="font-semibold text-emerald-700 dark:text-emerald-300">Diagonal:</span> agua apta (estado verde).</p>
                  <p><span class="font-semibold text-amber-700 dark:text-amber-300">Bloque central:</span> agua tolerable (estado amarillo).</p>
                  <p><span class="font-semibold text-rose-700 dark:text-rose-300">X:</span> no apta (estado rojo).</p>
                  <p><span class="font-semibold text-sky-700 dark:text-sky-300">Marco:</span> lectura en proceso / equipo ocupado.</p>
                  <p class="sm:col-span-2 xl:col-span-2"><span class="font-semibold text-cyan-700 dark:text-cyan-300">Barras de preview:</span> pH (izq), TDS (centro) y turbidez (der). Solo vista previa, no guardado automático.</p>
                </div>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <p id="alerts-config-note" class="text-xs text-muted-foreground">Alertas: Discord, correo y Telegram sin verificar.</p>
                <button id="test-alerts-btn" class="inline-flex items-center justify-center gap-1.5 h-7 px-3 rounded-lg border border-border bg-background text-foreground text-xs font-semibold hover:bg-muted transition-colors">
                  <i data-lucide="bell" class="w-3.5 h-3.5"></i>
                  Probar alertas
                </button>
              </div>
            </div>
          </div>
        </section>

        <section id="reading-cards" class="dashboard-metric-grid grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          <div class="rounded-2xl border-2 border-border bg-card/90 backdrop-blur shadow-sm p-4 flex flex-col gap-1 transition-colors duration-300" id="card-location">
            <span class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><i data-lucide="map-pin" class="w-3 h-3"></i> Ubicación Activa</span>
            <span class="text-base font-bold text-foreground leading-tight mt-1 wrap-break-word" id="card-location-val">—</span>
          </div>
          <div class="rounded-2xl border-2 border-border bg-card/90 backdrop-blur shadow-sm p-4 flex flex-col gap-1 transition-colors duration-300" id="card-ph">
            <span class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><i data-lucide="flask-conical" class="w-3 h-3"></i> pH</span>
            <span class="text-3xl font-bold font-mono text-foreground leading-tight" id="card-ph-val">—</span>
            <span class="text-[10px] text-muted-foreground">Normal: 6.5 – 8.5</span>
            <span class="text-[11px] text-muted-foreground" id="card-ph-meaning">Significado: sin lectura</span>
          </div>
          <div class="rounded-2xl border-2 border-border bg-card/90 backdrop-blur shadow-sm p-4 flex flex-col gap-1 transition-colors duration-300" id="card-ntu">
            <span class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><i data-lucide="waves" class="w-3 h-3"></i> Turbidez (NTU)</span>
            <span class="text-3xl font-bold font-mono text-foreground leading-tight" id="card-ntu-val">—</span>
            <span class="text-[10px] text-muted-foreground">Normal: &lt; 1 NTU</span>
            <span class="text-[11px] text-muted-foreground" id="card-ntu-meaning">Significado: sin lectura</span>
          </div>
          <div class="rounded-2xl border-2 border-border bg-card/90 backdrop-blur shadow-sm p-4 flex flex-col gap-1 transition-colors duration-300" id="card-tds">
            <span class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><i data-lucide="beaker" class="w-3 h-3"></i> TDS (ppm)</span>
            <span class="text-3xl font-bold font-mono text-foreground leading-tight" id="card-tds-val">—</span>
            <span class="text-[10px] text-muted-foreground">Referencia: &lt; 600 ppm</span>
            <span class="text-[11px] text-muted-foreground" id="card-tds-meaning">Significado: sin lectura</span>
          </div>
          <div class="rounded-2xl border-2 border-border bg-card/90 backdrop-blur shadow-sm p-4 flex flex-col gap-1 transition-colors duration-300" id="card-status">
            <span class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1"><i data-lucide="shield-check" class="w-3 h-3"></i> Estado del Agua</span>
            <span class="inline-flex items-center self-start rounded-full px-2.5 py-0.5 text-xs font-semibold mt-1 border bg-muted text-muted-foreground border-border" id="card-status-val">Sin datos</span>
            <span class="text-[11px] text-muted-foreground" id="card-status-meaning">Interpretación: sin lectura</span>
            <span class="text-[10px] text-muted-foreground font-mono" id="card-ts"></span>
          </div>
        </section>

        <section class="dashboard-tabs-shell rounded-2xl border border-border bg-card/90 backdrop-blur-xl shadow-[0_20px_60px_rgba(15,23,42,0.08)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.3)] overflow-hidden">
          <div class="flex border-b bg-muted/35 px-2 pt-2 gap-1 flex-wrap">
            <button class="tab-btn flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-xl border-b-2 border-primary text-primary bg-card -mb-px transition-colors" data-tab="tab-map"><i data-lucide="map" class="w-4 h-4"></i> Mapa Calidad</button>
            <button class="tab-btn flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-xl border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-background/60 -mb-px transition-colors" data-tab="tab-live"><i data-lucide="radio" class="w-4 h-4"></i> Datos en vivo</button>
            <button class="tab-btn flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-xl border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-background/60 -mb-px transition-colors" data-tab="tab-ph-hist"><i data-lucide="activity" class="w-4 h-4"></i> Historial pH</button>
            <button class="tab-btn flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-xl border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-background/60 -mb-px transition-colors" data-tab="tab-ntu-hist"><i data-lucide="waves" class="w-4 h-4"></i> Historial Turbidez</button>
            <button class="tab-btn flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-xl border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-background/60 -mb-px transition-colors" data-tab="tab-tds-hist"><i data-lucide="beaker" class="w-4 h-4"></i> Historial TDS</button>
            <button class="tab-btn flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-xl border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-background/60 -mb-px transition-colors" data-tab="tab-comparison"><i data-lucide="table" class="w-4 h-4"></i> Comparativa Provincias</button>
            <button class="tab-btn flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-xl border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-background/60 -mb-px transition-colors" data-tab="tab-persisted"><i data-lucide="database" class="w-4 h-4"></i> Persistidas DB</button>
            <button class="tab-btn flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-xl border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-background/60 -mb-px transition-colors" data-tab="tab-resources"><i data-lucide="cpu" class="w-4 h-4"></i> Recursos Arduino</button>
            <button class="tab-btn flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-xl border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-background/60 -mb-px transition-colors" data-tab="tab-log"><i data-lucide="clipboard-list" class="w-4 h-4"></i> Registro</button>
            <button class="tab-btn flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-xl border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-background/60 -mb-px transition-colors" data-tab="tab-chatbot"><i data-lucide="message-circle" class="w-4 h-4"></i> Asistente</button>
          </div>
          <div class="p-4 md:p-5">
            <div id="tab-map" class="tab-content active">
              <div class="flex flex-wrap gap-4 text-xs font-semibold mb-3">
                <span class="flex items-center gap-1.5 text-green-600"><i data-lucide="circle" class="w-3 h-3 legend-dot"></i> Apta</span>
                <span class="flex items-center gap-1.5 text-yellow-500"><i data-lucide="circle" class="w-3 h-3 legend-dot"></i> Tolerable</span>
                <span class="flex items-center gap-1.5 text-red-600"><i data-lucide="circle" class="w-3 h-3 legend-dot"></i> No Apta / Peligro</span>
                <span class="flex items-center gap-1.5 text-slate-400"><i data-lucide="circle" class="w-3 h-3 legend-dot"></i> Sin datos</span>
              </div>
              <div id="map-container"></div>
            </div>
            <div id="tab-live" class="tab-content">
              <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <p class="text-sm font-semibold flex items-center gap-2"><i data-lucide="radio" class="w-4 h-4 text-primary"></i> Datos en vivo (sin guardar)</p>
                <span id="live-ts-val" class="text-xs text-muted-foreground font-mono">Sin preview en vivo</span>
              </div>
              <p id="live-preview-note" class="text-xs text-muted-foreground mb-3">Esta vista muestra solo datos en tiempo real. No se guardan en la base de datos hasta pulsar "Tomar Lectura".</p>
              <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                <div class="rounded-2xl border border-border bg-card/70 p-3.5 flex flex-col gap-1">
                  <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ubicación</span>
                  <span id="live-location-val" class="text-base font-bold text-foreground">—</span>
                </div>
                <div class="rounded-2xl border border-border bg-card/70 p-3.5 flex flex-col gap-1">
                  <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">pH</span>
                  <span id="live-ph-val" class="text-2xl font-bold font-mono text-foreground">—</span>
                  <span class="text-[10px] text-muted-foreground">No guardado</span>
                </div>
                <div class="rounded-2xl border border-border bg-card/70 p-3.5 flex flex-col gap-1">
                  <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Turbidez (NTU)</span>
                  <span id="live-ntu-val" class="text-2xl font-bold font-mono text-foreground">—</span>
                  <span class="text-[10px] text-muted-foreground">No guardado</span>
                </div>
                <div class="rounded-2xl border border-border bg-card/70 p-3.5 flex flex-col gap-1">
                  <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">TDS (ppm)</span>
                  <span id="live-tds-val" class="text-2xl font-bold font-mono text-foreground">—</span>
                  <span class="text-[10px] text-muted-foreground">No guardado</span>
                </div>
                <div class="rounded-2xl border border-border bg-card/70 p-3.5 flex flex-col gap-1">
                  <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Estado en vivo</span>
                  <span id="live-status-val" class="inline-flex items-center self-start rounded-full px-2.5 py-0.5 text-xs font-semibold border bg-muted text-muted-foreground border-border">Sin datos</span>
                  <span id="live-status-meaning" class="text-[11px] text-muted-foreground">Sin lectura en vivo.</span>
                </div>
              </div>
            </div>
            <div id="tab-comparison" class="tab-content">
              <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <p class="text-sm font-semibold flex items-center gap-2"><i data-lucide="table" class="w-4 h-4 text-primary"></i> Comparativa por Provincia</p>
                <span id="comparison-updated-at" class="text-xs text-muted-foreground">Actualización pendiente</span>
              </div>
              <div class="overflow-x-auto rounded-xl border border-border bg-card/70">
                <table class="w-full text-sm border-collapse">
                  <thead>
                    <tr class="bg-muted text-muted-foreground text-[11px] uppercase tracking-wider">
                      <th class="px-3 py-2.5 text-left font-semibold">Provincia</th>
                      <th class="px-3 py-2.5 text-left font-semibold">pH</th>
                      <th class="px-3 py-2.5 text-left font-semibold">NTU</th>
                      <th class="px-3 py-2.5 text-left font-semibold">TDS</th>
                      <th class="px-3 py-2.5 text-left font-semibold">Estado</th>
                      <th class="px-3 py-2.5 text-left font-semibold">Significado simple</th>
                      <th class="px-3 py-2.5 text-left font-semibold">Última Lectura</th>
                    </tr>
                  </thead>
                  <tbody id="comparison-tbody">
                    <tr><td colspan="7" class="px-3 py-8 text-center text-muted-foreground">Sin datos comparativos aún</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div id="tab-persisted" class="tab-content">
              <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <p class="text-sm font-semibold flex items-center gap-2"><i data-lucide="database" class="w-4 h-4 text-primary"></i> Últimas lecturas persistidas</p>
                <div class="flex flex-wrap items-center gap-2">
                  <span id="persisted-source-pill" class="persisted-source-pill persisted-source-idle">Verificando fuente…</span>
                  <span id="persisted-updated-at" class="text-xs text-muted-foreground font-mono">Pendiente</span>
                </div>
              </div>
              <p id="persisted-view-note" class="text-xs text-muted-foreground mb-3">Esta vista lista solo lecturas que ya quedaron persistidas. Si el almacenamiento no está disponible, se señalará el respaldo activo.</p>
              <div class="overflow-x-auto rounded-xl border border-border bg-card/70">
                <table class="w-full text-sm border-collapse">
                  <thead>
                    <tr class="bg-muted text-muted-foreground text-[11px] uppercase tracking-wider">
                      <th class="px-3 py-2.5 text-left font-semibold">Ubicación</th>
                      <th class="px-3 py-2.5 text-left font-semibold">Fecha/Hora</th>
                      <th class="px-3 py-2.5 text-left font-semibold">Fuente</th>
                      <th class="px-3 py-2.5 text-left font-semibold">pH</th>
                      <th class="px-3 py-2.5 text-left font-semibold">NTU</th>
                      <th class="px-3 py-2.5 text-left font-semibold">TDS</th>
                      <th class="px-3 py-2.5 text-left font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody id="persisted-tbody">
                    <tr><td colspan="7" class="px-3 py-8 text-center text-muted-foreground">Cargando lecturas persistidas…</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            ${historyPanel({ tabId: 'tab-ph-hist', selectId: 'ph-hist-location', label: 'historial de pH', title: 'pH — Potencial de Hidrógeno', note: 'Ref: 6.5 (mín) y 8.5 (máx)', icon: 'activity', canvasId: 'ph-hist-chart', nodataId: 'ph-hist-nodata' })}
            ${historyPanel({ tabId: 'tab-ntu-hist', selectId: 'ntu-hist-location', label: 'historial de turbidez', title: 'Turbidez (NTU)', note: 'Seguro: <1 NTU | Tolerable: <5 NTU', icon: 'waves', canvasId: 'ntu-hist-chart', nodataId: 'ntu-hist-nodata' })}
            ${historyPanel({ tabId: 'tab-tds-hist', selectId: 'tds-hist-location', label: 'historial de TDS', title: 'TDS (ppm) — Sólidos disueltos totales', note: 'Seguro: <600 ppm | Riesgo: >900 ppm', icon: 'beaker', canvasId: 'tds-hist-chart', nodataId: 'tds-hist-nodata' })}
            <div id="tab-resources" class="tab-content">
              <div class="flex flex-wrap items-center gap-3 mb-4">
                <div class="flex gap-1 p-0.5 bg-muted rounded-md border border-border" id="resources-range-tabs">
                  <button class="htab active" data-range="1h" data-window="5m">1 Hora</button>
                  <button class="htab" data-range="6h" data-window="30m">6 Horas</button>
                  <button class="htab" data-range="1d" data-window="1h">1 Día</button>
                </div>
                <span class="text-xs text-muted-foreground ml-auto">Uso del Linux host de Arduino App Lab (CPU y memoria)</span>
              </div>
              <div class="grid gap-4 lg:grid-cols-2">
                <div class="rounded-xl border border-border bg-card/60 p-3">
                  <p class="text-sm font-semibold mb-2 flex items-center gap-2"><i data-lucide="cpu" class="w-4 h-4 text-primary"></i> CPU Usage (%)</p>
                  <canvas id="resource-cpu-chart"></canvas>
                  <div id="resource-cpu-nodata" class="hidden py-6 text-center text-sm text-muted-foreground">Sin datos de CPU para este rango</div>
                </div>
                <div class="rounded-xl border border-border bg-card/60 p-3">
                  <p class="text-sm font-semibold mb-2 flex items-center gap-2"><i data-lucide="microchip" class="w-4 h-4 text-primary"></i> Memory Usage (%)</p>
                  <canvas id="resource-mem-chart"></canvas>
                  <div id="resource-mem-nodata" class="hidden py-6 text-center text-sm text-muted-foreground">Sin datos de memoria para este rango</div>
                </div>
              </div>
            </div>
            <div id="tab-log" class="tab-content">
              <p class="text-sm font-semibold mb-3 flex items-center gap-2"><i data-lucide="clipboard-list" class="w-4 h-4 text-primary"></i> Registro de Lecturas Recientes</p>
              <div class="overflow-x-auto rounded-xl border border-border bg-card/70">
                <table class="w-full text-sm border-collapse">
                  <thead>
                    <tr class="bg-muted text-muted-foreground text-[11px] uppercase tracking-wider">
                      <th class="px-3 py-2.5 text-left font-semibold">Fecha/Hora</th>
                      <th class="px-3 py-2.5 text-left font-semibold">Ubicación</th>
                      <th class="px-3 py-2.5 text-left font-semibold">pH</th>
                      <th class="px-3 py-2.5 text-left font-semibold">NTU</th>
                      <th class="px-3 py-2.5 text-left font-semibold">TDS</th>
                      <th class="px-3 py-2.5 text-left font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody id="log-tbody">
                    <tr><td colspan="6" class="px-3 py-8 text-center text-muted-foreground">Sin lecturas aún</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div id="tab-chatbot" class="tab-content">
              <div class="flex flex-col h-[600px] max-h-[70vh]">
                <div class="flex items-center justify-between mb-4 pb-3 border-b border-border">
                  <div class="flex items-center gap-2.5">
                    <div class="w-10 h-10 rounded-xl bg-linear-to-br from-teal-500 to-teal-600 flex items-center justify-center shadow-sm">
                      <i data-lucide="bot" class="w-5 h-5 text-white"></i>
                    </div>
                    <div>
                      <p class="text-sm font-semibold text-foreground">HydroBot · Asistente de Calidad del Agua</p>
                      <p class="text-xs text-muted-foreground">Experto en análisis de pH, turbidez y TDS</p>
                    </div>
                  </div>
                  <button id="chatbot-config-toggle" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors shadow-sm" aria-label="Configurar API Key">
                    <i data-lucide="settings" class="w-3.5 h-3.5"></i>
                    Configurar
                  </button>
                </div>
                
                <div id="chatbot-config-panel" class="hidden mb-4 rounded-xl border-2 border-primary/20 bg-linear-to-br from-primary/5 to-primary/10 p-4 shadow-sm">
                  <div class="flex items-center justify-between mb-3">
                    <p class="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <i data-lucide="key" class="w-3.5 h-3.5"></i>
                      Configuración de OpenRouter API
                    </p>
                    <div id="chatbot-config-status" class="flex items-center gap-1.5 text-xs">
                      <i data-lucide="circle" class="w-2.5 h-2.5"></i>
                      <span id="chatbot-config-status-text">No configurado</span>
                    </div>
                  </div>
                  <div class="flex gap-2 mb-3">
                    <input 
                      type="password" 
                      id="chatbot-api-key-input" 
                      placeholder="sk-or-v1-..." 
                      class="flex-1 h-10 rounded-lg border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      aria-label="OpenRouter API Key"
                    />
                    <button id="chatbot-save-key" class="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold shadow hover:bg-primary/90 transition-colors">
                      <i data-lucide="save" class="w-3.5 h-3.5"></i>
                      Guardar
                    </button>
                    <button id="chatbot-clear-key" class="inline-flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg border border-border bg-background text-foreground text-sm font-semibold hover:bg-muted transition-colors">
                      <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                      Limpiar
                    </button>
                  </div>
                  <div class="flex items-start gap-2 text-xs text-muted-foreground bg-background/50 rounded-lg p-2.5">
                    <i data-lucide="info" class="w-3.5 h-3.5 shrink-0 mt-0.5"></i>
                    <p>
                      Obtén tu API key gratuita en <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline font-medium">openrouter.ai/keys</a>. 
                      Tu clave se guarda localmente en tu navegador.
                    </p>
                  </div>
                </div>

                <div id="chatbot-messages" class="flex-1 overflow-y-auto rounded-xl border border-border bg-linear-to-b from-muted/30 to-muted/10 p-4 mb-4 space-y-4" role="log" aria-live="polite" aria-label="Mensajes del chat">
                  <div class="flex flex-col items-center justify-center text-center py-12 px-4">
                    <div class="w-16 h-16 rounded-2xl bg-linear-to-br from-teal-500 to-teal-600 flex items-center justify-center mb-4 shadow-lg">
                      <i data-lucide="bot" class="w-8 h-8 text-white"></i>
                    </div>
                    <h3 class="text-base font-semibold text-foreground mb-2">HydroBot · Asistente de Calidad del Agua</h3>
                    <p class="text-sm text-muted-foreground max-w-md leading-relaxed">
                      Soy HydroBot. Puedo ayudarte a interpretar pH, turbidez y TDS,
                      además de responder preguntas de calidad del agua en lenguaje simple.
                    </p>
                    <div class="mt-6 flex flex-wrap gap-2 justify-center">
                      <button class="quick-question px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted transition-colors">
                        ¿Qué significa un pH de 7.5?
                      </button>
                      <button class="quick-question px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted transition-colors">
                        ¿Cuándo es peligrosa la turbidez?
                      </button>
                      <button class="quick-question px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted transition-colors">
                        Explica los estados del agua
                      </button>
                    </div>
                  </div>
                </div>

                <div class="flex gap-2">
                  <input 
                    type="text" 
                    id="chatbot-input" 
                    placeholder="Escribe tu pregunta aquí..." 
                    class="flex-1 h-12 rounded-xl border border-input bg-background px-4 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-shadow"
                    aria-label="Mensaje del chat"
                  />
                  <button id="chatbot-send" class="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl bg-primary text-primary-foreground text-sm font-semibold shadow-md hover:shadow-lg hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 transition-all">
                    <span id="chatbot-send-text" class="flex items-center gap-2">
                      <i data-lucide="send" class="w-4 h-4"></i>
                      Enviar
                    </span>
                    <span id="chatbot-send-spinner" class="hidden items-center gap-2">
                      <i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>
                      Enviando…
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <div id="error-container" class="hidden fixed bottom-4 right-4 max-w-sm rounded-xl bg-destructive text-destructive-foreground px-4 py-3 text-sm font-medium shadow-lg z-50" aria-live="polite"></div>
    </div>
    `;
  };
}(window));
