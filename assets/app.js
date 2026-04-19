(function bootstrapDashboard(global) {
const {
  apiFetch,
  buildChart,
  computeStatus,
  fmtTS,
  loadRuntimeConfig,
  LOCATIONS,
  MARKER_COLOR,
  MOCK_READINGS,
  NO_DATA_COLOR,
  renderAppShell,
  renderHistChart,
  STATUS_BADGE,
  STATUS_BORDER,
  STATUS_LABEL,
  STATUS_ROW,
  mockHistory,
} = global.WaterDashboard;

let testMode = false;
let socket = null;
let currentLocation = 'panama';
let readingInProgress = false;
let mapInstance = null;
let mapMarkers = {};
let logEntries = [];
let calibrationEndsAt = 0;
let calibrationTimer = null;

let calibrationSeconds = 30;
let minTakeReadingGapS = 0;
let captureEnabled = true;
let latestByLocation = {};
let livePreviewByLocation = {};
let notificationConfig = {
  discordConfigured: false,
  emailConfigured: false,
  emailAlertsConfigured: false,
  telegramConfigured: false,
  telegramTargets: 0,
};
let chatbotBackendConfigured = false;
let storageConfig = {
  ready: false,
  mode: null,
  error: null,
};
let persistedOverviewRows = [];
let persistedOverviewMeta = {
  source: null,
  warning: null,
  detail: null,
  mode: null,
  updatedAt: null,
};

const charts = {
  ph: null,
  ntu: null,
  tds: null,
  cpu: null,
  mem: null,
};

let resourcesLoaded = false;
let persistedRefreshTimer = null;
let exitAutosaveTriggered = false;

function setPreviewNote(message) {
  const previewEl = document.getElementById('sensor-preview-note');
  if (previewEl) {
    previewEl.textContent = message;
  }
}

function formatMetricValue(value, decimals = 1, suffix = '') {
  if (value == null || Number.isNaN(Number(value))) {
    return 'N/D';
  }
  return `${Number(value).toFixed(decimals)}${suffix}`;
}

function describePhSimple(ph) {
  if (ph == null || !Number.isFinite(Number(ph))) return 'Significado: sin lectura';
  const value = Number(ph);
  if (value < 6.5) return 'Significado: agua acida (puede irritar o corroer).';
  if (value > 8.5) return 'Significado: agua alcalina alta (sabor y tratamiento afectados).';
  return 'Significado: pH en rango saludable para uso general.';
}

function describeNtuSimple(ntu) {
  if (ntu == null || !Number.isFinite(Number(ntu))) return 'Significado: sin lectura';
  const value = Number(ntu);
  if (value <= 1) return 'Significado: agua clara, baja presencia de particulas.';
  if (value <= 5) return 'Significado: agua algo turbia, requiere vigilancia.';
  return 'Significado: agua muy turbia, no apta sin tratamiento.';
}

function describeTdsSimple(tds) {
  if (tds == null || !Number.isFinite(Number(tds))) return 'Significado: sin lectura';
  const value = Number(tds);
  if (value <= 600) return 'Significado: minerales disueltos en nivel aceptable.';
  if (value <= 900) return 'Significado: minerales altos, conviene tratar el agua.';
  return 'Significado: minerales muy altos, riesgo para consumo directo.';
}

function explainStatusSimple(status) {
  if (status === 0) return 'Apta: puede usarse con tranquilidad.';
  if (status === 1) return 'Tolerable: se puede usar con precaucion y monitoreo.';
  if (status === 2) return 'No apta: requiere tratamiento antes de usar.';
  return 'Sin datos suficientes para decidir.';
}

function normalizeTimestamp(value) {
  if (value == null) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 0 && numeric < 10_000_000_000) {
      return Math.trunc(numeric * 1000);
    }
    return Math.trunc(numeric);
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function persistedSourceLabel(source) {
  if (source === '3nf') return '3NF local';
  if (source === 'timeseries_fallback') return 'Respaldo TS';
  if (source === 'error') return 'Sin confirmar';
  return 'Pendiente';
}

function persistedSourceClass(source) {
  if (source === '3nf') return 'persisted-source-primary';
  if (source === 'timeseries_fallback') return 'persisted-source-fallback';
  if (source === 'error') return 'persisted-source-error';
  return 'persisted-source-idle';
}

function statusSortOrder(status) {
  if (status === 2) return 0;
  if (status === 1) return 1;
  if (status === 0) return 2;
  return 3;
}

function upsertLatestSnapshot(locKey, payload = {}) {
  if (!locKey || !LOCATIONS[locKey]) {
    return null;
  }

  const existing = latestByLocation[locKey] || {};
  const ph = payload.ph != null && Number.isFinite(Number(payload.ph)) ? Number(payload.ph) : null;
  const ntu = payload.ntu != null && Number.isFinite(Number(payload.ntu)) ? Number(payload.ntu) : null;
  const tds = payload.tds != null && Number.isFinite(Number(payload.tds)) ? Number(payload.tds) : null;
  const rawStatus = payload.status != null ? Number(payload.status) : null;
  const status = Number.isFinite(rawStatus)
    ? rawStatus
    : (ph != null && ntu != null ? computeStatus(ph, ntu, tds) : null);
  const normalized = {
    ...existing,
    ...payload,
    location: locKey,
    name: payload.name || LOCATIONS[locKey]?.name || locKey,
    ph,
    ntu,
    tds,
    status,
    ts: normalizeTimestamp(payload.ts) ?? normalizeTimestamp(existing.ts),
  };

  latestByLocation[locKey] = normalized;
  return normalized;
}

function renderComparisonTable() {
  const tbody = document.getElementById('comparison-tbody');
  if (!tbody) return;

  const rows = Object.keys(LOCATIONS).map((locKey) => {
    const source = latestByLocation[locKey] || {};
    const ph = source.ph != null && Number.isFinite(Number(source.ph)) ? Number(source.ph) : null;
    const ntu = source.ntu != null && Number.isFinite(Number(source.ntu)) ? Number(source.ntu) : null;
    const tds = source.tds != null && Number.isFinite(Number(source.tds)) ? Number(source.tds) : null;
    const statusCandidate = source.status != null ? Number(source.status) : null;
    const status = Number.isFinite(statusCandidate)
      ? statusCandidate
      : (ph != null && ntu != null ? computeStatus(ph, ntu, tds) : null);

    return {
      location: locKey,
      name: source.name || LOCATIONS[locKey].name,
      ph,
      ntu,
      tds,
      status,
      ts: normalizeTimestamp(source.ts),
    };
  });

  rows.sort((a, b) => {
    const byStatus = statusSortOrder(a.status) - statusSortOrder(b.status);
    if (byStatus !== 0) return byStatus;

    const byNtu = (b.ntu ?? -1) - (a.ntu ?? -1);
    if (byNtu !== 0) return byNtu;

    return a.name.localeCompare(b.name, 'es');
  });

  const badgeBase = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border';
  tbody.innerHTML = rows.map((row, index) => {
    const validStatus = Number.isInteger(row.status) && row.status >= 0 && row.status < STATUS_BADGE.length;
    const rowCls = validStatus ? STATUS_ROW[row.status] : '';
    const badgeCls = validStatus ? STATUS_BADGE[row.status] : 'bg-muted text-muted-foreground border-border';
    const label = validStatus ? STATUS_LABEL[row.status] : 'Sin datos';
    const meaning = explainStatusSimple(row.status);
    const altBg = index % 2 === 1 ? 'bg-muted/30' : '';
    const tsLabel = row.ts ? fmtTS(row.ts) : 'Sin lectura';

    return `
      <tr class="${rowCls} ${altBg} text-sm">
        <td class="px-3 py-2 font-medium">${row.name}</td>
        <td class="px-3 py-2 font-mono">${row.ph != null ? row.ph.toFixed(2) : '—'}</td>
        <td class="px-3 py-2 font-mono">${row.ntu != null ? row.ntu.toFixed(1) : '—'}</td>
        <td class="px-3 py-2 font-mono">${row.tds != null ? row.tds.toFixed(0) : '—'}</td>
        <td class="px-3 py-2"><span class="${badgeBase} ${badgeCls}">${label}</span></td>
        <td class="px-3 py-2 text-xs">${meaning}</td>
        <td class="px-3 py-2 whitespace-nowrap text-xs font-mono">${tsLabel}</td>
      </tr>
    `;
  }).join('');

  const updatedAtEl = document.getElementById('comparison-updated-at');
  if (updatedAtEl) {
    const newestTs = rows.reduce((maxTs, row) => {
      if (row.ts && row.ts > maxTs) return row.ts;
      return maxTs;
    }, 0);
    updatedAtEl.textContent = newestTs
      ? `Actualizado: ${fmtTS(newestTs)}`
      : 'Sin lecturas guardadas todavía';
  }
}

function updateLivePreviewTab() {
  const locationEl = document.getElementById('live-location-val');
  const phEl = document.getElementById('live-ph-val');
  const ntuEl = document.getElementById('live-ntu-val');
  const tdsEl = document.getElementById('live-tds-val');
  const statusEl = document.getElementById('live-status-val');
  const statusMeaningEl = document.getElementById('live-status-meaning');
  const tsEl = document.getElementById('live-ts-val');
  const noteEl = document.getElementById('live-preview-note');

  if (!locationEl || !phEl || !ntuEl || !tdsEl || !statusEl || !statusMeaningEl || !tsEl) {
    return;
  }

  const locationName = LOCATIONS[currentLocation]?.name || currentLocation;
  locationEl.textContent = locationName;

  const preview = livePreviewByLocation[currentLocation] || null;
  const badgeBase = 'inline-flex items-center self-start rounded-full px-2.5 py-0.5 text-xs font-semibold border';

  if (!preview) {
    phEl.textContent = '—';
    ntuEl.textContent = '—';
    tdsEl.textContent = '—';
    statusEl.textContent = 'Sin datos';
    statusEl.className = `${badgeBase} bg-muted text-muted-foreground border-border`;
    statusMeaningEl.textContent = 'Sin lectura en vivo.';
    tsEl.textContent = 'Sin preview en vivo';
    if (noteEl) {
      noteEl.textContent = 'Esta vista muestra solo datos en tiempo real. No se guardan en la base de datos hasta pulsar "Tomar Lectura".';
    }
    return;
  }

  phEl.textContent = preview.ph != null ? Number(preview.ph).toFixed(2) : '—';
  ntuEl.textContent = preview.ntu != null ? Number(preview.ntu).toFixed(1) : '—';
  tdsEl.textContent = preview.tds != null ? Number(preview.tds).toFixed(0) : '—';

  const status = Number.isFinite(Number(preview.status)) ? Number(preview.status) : null;
  if (status != null && status >= 0 && status < STATUS_BADGE.length) {
    statusEl.textContent = STATUS_LABEL[status];
    statusEl.className = `${badgeBase} ${STATUS_BADGE[status]}`;
    statusMeaningEl.textContent = explainStatusSimple(status);
  } else {
    statusEl.textContent = 'Sin datos';
    statusEl.className = `${badgeBase} bg-muted text-muted-foreground border-border`;
    statusMeaningEl.textContent = 'Sin lectura en vivo.';
  }

  const ts = normalizeTimestamp(preview.ts);
  tsEl.textContent = ts ? `Actualizado: ${fmtTS(ts)} (en vivo)` : 'En vivo (sin timestamp)';
  if (noteEl) {
    noteEl.textContent = `Vista en vivo de ${locationName}: estos datos no se guardan hasta pulsar "Tomar Lectura".`;
  }
}

function buildExitAutosavePayload() {
  if (testMode || !captureEnabled) {
    return null;
  }

  const preview = livePreviewByLocation[currentLocation] || null;
  if (!preview) {
    return null;
  }

  const ph = Number(preview.ph);
  const ntu = Number(preview.ntu);
  if (!Number.isFinite(ph) || !Number.isFinite(ntu)) {
    return null;
  }

  const tds = preview.tds != null && Number.isFinite(Number(preview.tds)) ? Number(preview.tds) : null;
  const temp_c = preview.tempC != null && Number.isFinite(Number(preview.tempC)) ? Number(preview.tempC) : null;
  const humidity = preview.humidity != null && Number.isFinite(Number(preview.humidity)) ? Number(preview.humidity) : null;

  return {
    location: currentLocation,
    ph,
    ntu,
    tds,
    temp_c,
    humidity,
    ts: normalizeTimestamp(preview.ts) || Date.now(),
    reason: 'page_exit_autosave',
  };
}

function sendKeepAlivePost(path, payload = null) {
  const hasBeacon = typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function';

  if (hasBeacon) {
    try {
      if (payload == null) {
        if (navigator.sendBeacon(path)) {
          return;
        }
      } else {
        const body = JSON.stringify(payload);
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(path, blob)) {
          return;
        }
      }
    } catch {
      // Fallback a fetch keepalive.
    }
  }

  const options = {
    method: 'POST',
    keepalive: true,
    headers: payload == null ? undefined : { 'Content-Type': 'application/json' },
    body: payload == null ? undefined : JSON.stringify(payload),
  };

  fetch(path, options).catch(() => {
    // No-op en salida de página.
  });
}

function triggerExitAutosave() {
  if (exitAutosaveTriggered) {
    return;
  }

  const shouldStopCapture = !testMode && captureEnabled;
  const autosavePayload = buildExitAutosavePayload();
  if (!shouldStopCapture && !autosavePayload) {
    return;
  }

  exitAutosaveTriggered = true;

  if (autosavePayload) {
    sendKeepAlivePost('/autosave_preview_on_exit', autosavePayload);
  }

  if (shouldStopCapture) {
    sendKeepAlivePost('/set_capture_enabled/off');
  }
}

function bindExitAutosaveHooks() {
  window.addEventListener('pagehide', triggerExitAutosave);
  window.addEventListener('beforeunload', triggerExitAutosave);

  document.querySelectorAll('a[href="landing.html"], a[href="components.html"]').forEach((link) => {
    link.addEventListener('click', () => {
      triggerExitAutosave();
    });
  });
}

function buildReportDataForCurrentLocation() {
  const locationName = LOCATIONS[currentLocation]?.name || currentLocation;
  const fromLatest = latestByLocation[currentLocation];

  if (fromLatest && fromLatest.ph != null && fromLatest.ntu != null) {
    const latestStatus = Number.isFinite(Number(fromLatest.status))
      ? Number(fromLatest.status)
      : computeStatus(Number(fromLatest.ph), Number(fromLatest.ntu), fromLatest.tds != null ? Number(fromLatest.tds) : null);
    return {
      location: currentLocation,
      locationName,
      ph: Number(fromLatest.ph),
      ntu: Number(fromLatest.ntu),
      tds: fromLatest.tds != null && Number.isFinite(Number(fromLatest.tds)) ? Number(fromLatest.tds) : null,
      status: latestStatus,
      timestamp: normalizeTimestamp(fromLatest.ts) || Date.now(),
    };
  }

  const phVal = Number.parseFloat(document.getElementById('card-ph-val')?.textContent || '');
  const ntuVal = Number.parseFloat(document.getElementById('card-ntu-val')?.textContent || '');
  const tdsVal = Number.parseFloat(document.getElementById('card-tds-val')?.textContent || '');

  if (!Number.isFinite(phVal) || !Number.isFinite(ntuVal)) {
    return null;
  }

  const safeTds = Number.isFinite(tdsVal) ? tdsVal : null;
  return {
    location: currentLocation,
    locationName,
    ph: phVal,
    ntu: ntuVal,
    tds: safeTds,
    status: computeStatus(phVal, ntuVal, safeTds),
    timestamp: Date.now(),
  };
}

function updateTestModeVisibility() {
  // Los indicadores visuales de TEST_MODE fueron retirados del layout.
}

function updateSaveStatusPanel(copy) {
  const panel = document.getElementById('save-status-panel');
  const chipEl = document.getElementById('save-status-chip');
  const titleEl = document.getElementById('save-status-title');
  const detailEl = document.getElementById('save-status-detail');
  const metaEl = document.getElementById('save-status-meta');
  if (!panel || !chipEl || !titleEl || !detailEl || !metaEl) return;

  panel.classList.remove(
    'save-status-idle',
    'save-status-preview',
    'save-status-saving',
    'save-status-saved',
    'save-status-error',
    'save-status-test',
  );
  panel.classList.add(`save-status-${copy.tone}`);
  chipEl.textContent = copy.chip;
  titleEl.textContent = copy.title;
  detailEl.textContent = copy.detail;
  metaEl.textContent = copy.meta;
}

function buildSaveStateCopy(state, data = {}) {
  const locationName = data.name || LOCATIONS[data.location]?.name || LOCATIONS[currentLocation]?.name || currentLocation;
  const measuredAt = data.ts ? fmtTS(data.ts) : null;
  const storageInfo = data && typeof data.storage === 'object' ? data.storage : null;
  const isFallback = data.source === 'timeseries_fallback';

  if (state === 'preview') {
    return {
      tone: 'preview',
      chip: 'Preview',
      title: `Vista previa en vivo en ${locationName}`,
      detail: `pH ${formatMetricValue(data.ph, 2)}, NTU ${formatMetricValue(data.ntu, 1)}, TDS ${formatMetricValue(data.tds, 0, ' ppm')}.`,
      meta: 'Aún no está guardada en la base de datos.',
      note: `Vista previa (no guardada) en ${locationName}: pH ${formatMetricValue(data.ph, 2)}, NTU ${formatMetricValue(data.ntu, 1)}, TDS ${formatMetricValue(data.tds, 0, ' ppm')}.`,
    };
  }

  if (state === 'saving') {
    return {
      tone: 'saving',
      chip: 'Guardando',
      title: `Guardando lectura para ${locationName}`,
      detail: 'Esperando confirmación del dispositivo y del almacenamiento.',
      meta: 'No cierres la pestaña hasta recibir confirmación.',
      note: `Guardando lectura para ${locationName}: esperando confirmación del dispositivo.`,
    };
  }

  if (state === 'saved') {
    const chip = isFallback ? 'Respaldo' : (storageInfo?.queued ? 'Guardado local' : 'Guardado OK');
    const detail = isFallback
      ? 'La lectura visible proviene del respaldo de series temporales; el almacenamiento 3NF no estuvo disponible.'
      : (storageInfo?.queued
        ? 'La lectura quedó guardada localmente y está pendiente de sincronización remota.'
        : 'La lectura quedó confirmada en la base de datos y ya debe aparecer en la vista de persistidas.');
    const meta = measuredAt
      ? `Última confirmación: ${measuredAt}`
      : (isFallback ? 'Última lectura cargada desde respaldo.' : 'Lectura persistida recientemente.');

    return {
      tone: isFallback ? 'preview' : 'saved',
      chip,
      title: isFallback ? `Última lectura recuperada para ${locationName}` : `Guardado confirmado para ${locationName}`,
      detail,
      meta,
      note: isFallback
        ? `Lectura visible para ${locationName} desde respaldo persistido.${measuredAt ? ` Última lectura: ${measuredAt}.` : ''}`
        : `Lectura guardada en base de datos para ${locationName}.${measuredAt ? ` Última lectura: ${measuredAt}.` : ''}`,
    };
  }

  if (state === 'error') {
    const reason = data.error || 'Reintenta cuando termine la calibración.';
    return {
      tone: 'error',
      chip: 'Sin guardar',
      title: 'Guardado no confirmado',
      detail: reason,
      meta: `Ubicación: ${locationName}`,
      note: `No se guardó la lectura. ${reason}`,
    };
  }

  if (state === 'test') {
    return {
      tone: 'preview',
      chip: 'No persistido',
      title: `Lectura visible en ${locationName}`,
      detail: 'Los valores se muestran en tiempo real, pero aún no están confirmados en la base de datos.',
      meta: `Ubicación: ${locationName}`,
      note: 'Lectura visible sin confirmación de persistencia en base de datos.',
    };
  }

  return {
    tone: 'idle',
    chip: 'Pendiente',
    title: 'Confirmación de guardado pendiente',
    detail: 'La lectura en vivo no entra al historial persistido hasta quedar confirmada.',
    meta: 'Esperando la primera lectura guardada.',
    note: 'Estado de datos: esperando la primera lectura guardada en base de datos.',
  };
}

function setReadingStateNote(state, data = {}) {
  const noteEl = document.getElementById('reading-state-note');
  if (!noteEl) return;
  const copy = buildSaveStateCopy(state, data);

  noteEl.classList.remove(
    'reading-state-idle',
    'reading-state-preview',
    'reading-state-saving',
    'reading-state-saved',
    'reading-state-error',
    'reading-state-test',
  );
  noteEl.classList.add(`reading-state-${copy.tone}`);
  noteEl.textContent = copy.note;
  updateSaveStatusPanel(copy);
}

function buildIdlePreviewNote() {
  const locationName = LOCATIONS[currentLocation]?.name || currentLocation;
  if (!captureEnabled) {
    return `Captura en pausa para ${locationName}. Pulsa "Tomar Lectura" para reanudar y guardar una medición.`;
  }
  const gapHint = minTakeReadingGapS > 0 ? ` Intervalo mínimo sugerido: ${minTakeReadingGapS}s.` : '';
  return `Lectura activa para ${locationName}. Pulsa "Parar de tomar lectura" para detener la captura.${gapHint}`;
}

function updatePrimaryActionNote() {
  const actionNote = document.getElementById('primary-action-note');
  if (!actionNote) return;

  if (readingInProgress) {
    actionNote.textContent = 'Ejecutando lectura en curso. Espera confirmación de guardado.';
    return;
  }

  actionNote.textContent = captureEnabled
    ? 'Lectura activa. Pulsa "Parar de tomar lectura" para detener la captura.'
    : 'Lectura detenida. Pulsa "Tomar Lectura" para iniciar y guardar una medición.';
}

function updatePrimaryActionButtonLabel() {
  const btn = document.getElementById('take-reading-btn');
  const btnText = document.getElementById('btn-text');
  if (!btn || !btnText || readingInProgress) return;

  btn.classList.remove('capture-btn-running', 'capture-btn-paused');

  if (captureEnabled) {
    btn.classList.add('capture-btn-running');
    btn.setAttribute('aria-pressed', 'true');
    btnText.innerHTML = `
      <i data-lucide="pause-circle" class="w-4 h-4"></i>
      <span class="hidden sm:inline">Parar de tomar lectura</span>
      <span class="sm:hidden">Parar</span>
    `;
  } else {
    btn.classList.add('capture-btn-paused');
    btn.setAttribute('aria-pressed', 'false');
    btnText.innerHTML = `
      <i data-lucide="droplets" class="w-4 h-4"></i>
      Tomar Lectura
    `;
  }

  updatePrimaryActionNote();
}

function setCaptureUi(enabled) {
  captureEnabled = Boolean(enabled);

  if (!readingInProgress) {
    setPreviewNote(buildIdlePreviewNote());
  }
  updatePrimaryActionButtonLabel();
  updateCalibrationUi();

  if (global.lucide && typeof global.lucide.createIcons === 'function') {
    global.lucide.createIcons();
  }
}

function updateCalibrationUi() {
  const now = Date.now();
  const noteEl = document.getElementById('calibration-note');
  const takeBtn = document.getElementById('take-reading-btn');

  if (testMode) {
    if (noteEl) {
      noteEl.textContent = captureEnabled
        ? 'Calibración informativa: puedes continuar con la lectura cuando lo necesites.'
        : 'Lectura detenida. Pulsa "Tomar Lectura" para iniciar.';
    }
    if (takeBtn) takeBtn.disabled = readingInProgress;
    updatePrimaryActionNote();
    return;
  }

  if (!captureEnabled) {
    if (noteEl) {
      noteEl.textContent = 'Captura en pausa. La vista en vivo queda disponible y puedes guardar al pulsar "Tomar Lectura".';
    }
    if (takeBtn && !readingInProgress) {
      takeBtn.disabled = false;
    }
    updatePrimaryActionNote();
    return;
  }

  const msLeft = Math.max(0, calibrationEndsAt - now);
  const secondsLeft = Math.ceil(msLeft / 1000);
  const isCalibrating = secondsLeft > 0;

  if (noteEl) {
    noteEl.textContent = isCalibrating
      ? `Calibrando sensores para ${LOCATIONS[currentLocation]?.name || currentLocation}: espera ${secondsLeft}s antes de iniciar lectura manual.`
      : 'Sensores estabilizados. Puedes tomar lectura o detener la captura cuando lo necesites.';
  }

  if (takeBtn && !readingInProgress) {
    takeBtn.disabled = false;
  }

  updatePrimaryActionNote();
}

function startCalibrationCountdown() {
  calibrationEndsAt = Date.now() + calibrationSeconds * 1000;
  updateCalibrationUi();

  if (calibrationTimer) {
    clearInterval(calibrationTimer);
  }

  calibrationTimer = setInterval(() => {
    updateCalibrationUi();
    if (Date.now() >= calibrationEndsAt) {
      clearInterval(calibrationTimer);
      calibrationTimer = null;
    }
  }, 1000);
}

function showError(message) {
  const el = document.getElementById('error-container');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  el.classList.add('flex');
  setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('flex');
  }, 6000);
}

function updateNotificationConfigUi() {
  const noteEl = document.getElementById('alerts-config-note');
  const testBtn = document.getElementById('test-alerts-btn');
  if (!noteEl) return;

  const discord = notificationConfig.discordConfigured ? 'Discord: OK' : 'Discord: falta webhook';
  const emailReports = notificationConfig.emailConfigured ? 'Correo reportes: OK' : 'Correo reportes: falta Resend';
  const emailAlerts = notificationConfig.emailAlertsConfigured
    ? 'Correo alertas: OK'
    : 'Correo alertas: falta destinatarios';
  const telegram = notificationConfig.telegramConfigured
    ? (notificationConfig.telegramTargets > 0
      ? `Telegram: OK (${notificationConfig.telegramTargets} chat)`
      : 'Telegram: bot listo, sin chat destino')
    : 'Telegram: bot no disponible';

  noteEl.textContent = `Alertas configuradas -> ${discord} | ${emailReports} | ${emailAlerts} | ${telegram}`;
  if (testBtn) {
    const enabled = notificationConfig.discordConfigured
      || notificationConfig.emailAlertsConfigured
      || (notificationConfig.telegramConfigured && notificationConfig.telegramTargets > 0);
    testBtn.disabled = !enabled;
    testBtn.title = enabled
      ? 'Enviar prueba real por los canales configurados.'
      : 'Configura Discord, Resend (con ALERT_RECIPIENTS) o Telegram (con chat destino) en .env para habilitar la prueba.';
  }
}

function updateStorageConfigUi() {
  const noteEl = document.getElementById('storage-config-note');
  if (!noteEl) return;

  if (testMode) {
    noteEl.textContent = 'Guardado DB: temporalmente desactivado en este entorno de ejecución.';
    return;
  }

  if (storageConfig.ready) {
    const modeLabel = storageConfig.mode || 'activo';
    noteEl.textContent = `Guardado DB: activo (${modeLabel}). Busca confirmación verde abajo y en la vista “Persistidas DB”.`;
    return;
  }

  const errorDetail = storageConfig.error ? ` Detalle: ${storageConfig.error}` : '';
  noteEl.textContent = `Guardado DB: no disponible. Las lecturas en vivo pueden verse pero no persistiran.${errorDetail}`;
}

function initMap() {
  if (mapInstance) return;
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return;
  if (typeof L === 'undefined') {
    mapContainer.innerHTML = '<div class="h-full w-full flex items-center justify-center text-sm text-muted-foreground">No se pudo cargar el mapa (Leaflet bloqueado o sin red).</div>';
    showError('No se pudo cargar Leaflet; revisa conexión o integridad de scripts.');
    return;
  }
  mapInstance = L.map('map-container').setView([8.9, -80.0], 8);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(mapInstance);

  for (const [key, loc] of Object.entries(LOCATIONS)) {
    const marker = L.circleMarker([loc.lat, loc.lon], {
      radius: 14,
      color: '#ffffff',
      weight: 2,
      fillColor: NO_DATA_COLOR,
      fillOpacity: 0.92,
    }).addTo(mapInstance);
    marker.bindPopup(`<b>${loc.name}</b><br>Sin datos aún`);
    mapMarkers[key] = marker;
  }
}

function updateMarker(locKey, data) {
  const marker = mapMarkers[locKey];
  if (!marker) return;

  const hasData = data.status !== null && data.status !== undefined;
  const color = hasData ? MARKER_COLOR[data.status] : NO_DATA_COLOR;
  marker.setStyle({ fillColor: color });

  let popupHTML = `<b>${data.name}</b><br>`;
  if (data.ph !== null && data.ntu !== null) {
    popupHTML += `pH: <b>${data.ph.toFixed(2)}</b><br>`;
    popupHTML += `Turbidez: <b>${data.ntu.toFixed(1)} NTU</b><br>`;
    if (data.tds !== null && data.tds !== undefined) {
      popupHTML += `TDS: <b>${Number(data.tds).toFixed(0)} ppm</b><br>`;
    }
    popupHTML += `Estado: <b style="color:${color}">${STATUS_LABEL[data.status]}</b>`;
  } else {
    popupHTML += 'Sin datos aún';
  }
  marker.setPopupContent(popupHTML);
}

function updateCards(data) {
  document.getElementById('card-location-val').textContent = data.name || LOCATIONS[data.location]?.name || '—';
  document.getElementById('card-ph-val').textContent = data.ph != null ? data.ph.toFixed(2) : '—';
  document.getElementById('card-ntu-val').textContent = data.ntu != null ? data.ntu.toFixed(1) : '—';
  const tdsEl = document.getElementById('card-tds-val');
  if (tdsEl) tdsEl.textContent = data.tds != null ? `${Number(data.tds).toFixed(0)}` : '—';

  const phMeaningEl = document.getElementById('card-ph-meaning');
  if (phMeaningEl) phMeaningEl.textContent = describePhSimple(data.ph);
  const ntuMeaningEl = document.getElementById('card-ntu-meaning');
  if (ntuMeaningEl) ntuMeaningEl.textContent = describeNtuSimple(data.ntu);
  const tdsMeaningEl = document.getElementById('card-tds-meaning');
  if (tdsMeaningEl) tdsMeaningEl.textContent = describeTdsSimple(data.tds);

  const statusEl = document.getElementById('card-status-val');
  const statusMeaningEl = document.getElementById('card-status-meaning');
  const badgeBase = 'inline-flex items-center self-start rounded-full px-2.5 py-0.5 text-xs font-semibold mt-1 border';
  if (data.status != null) {
    statusEl.textContent = STATUS_LABEL[data.status];
    statusEl.className = `${badgeBase} ${STATUS_BADGE[data.status]}`;
    if (statusMeaningEl) statusMeaningEl.textContent = `Interpretacion: ${explainStatusSimple(data.status)}`;
  } else {
    statusEl.textContent = 'Sin datos';
    statusEl.className = `${badgeBase} bg-muted text-muted-foreground border-border`;
    if (statusMeaningEl) statusMeaningEl.textContent = 'Interpretacion: sin lectura';
  }

  const tsEl = document.getElementById('card-ts');
  if (tsEl && data.ts) tsEl.textContent = fmtTS(data.ts);

  const cardIds = ['card-ph', 'card-ntu', 'card-tds', 'card-status'];
  const cardBase = 'rounded-2xl border-2 bg-card/90 backdrop-blur shadow-sm p-4 flex flex-col gap-1 transition-colors duration-300';
  for (const id of cardIds) {
    const card = document.getElementById(id);
    if (!card) continue;
    card.className = data.status != null ? `${cardBase} ${STATUS_BORDER[data.status]}` : `${cardBase} border-border`;
  }
}

function renderLog() {
  const tbody = document.getElementById('log-tbody');
  if (!tbody) return;
  if (logEntries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-3 py-8 text-center text-muted-foreground">Sin lecturas aún</td></tr>';
    return;
  }

  const badgeBase = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border';
  tbody.innerHTML = logEntries.map((entry, index) => {
    const rowCls = entry.status != null ? STATUS_ROW[entry.status] : '';
    const badgeCls = entry.status != null ? STATUS_BADGE[entry.status] : 'bg-muted text-muted-foreground border-border';
    const label = entry.status != null ? STATUS_LABEL[entry.status] : '—';
    const altBg = index % 2 === 1 ? 'bg-muted/30' : '';
    return `
      <tr class="${rowCls} ${altBg} text-sm">
        <td class="px-3 py-2 whitespace-nowrap font-mono text-xs">${fmtTS(entry.ts)}</td>
        <td class="px-3 py-2 font-medium">${entry.name || LOCATIONS[entry.location]?.name || '—'}</td>
        <td class="px-3 py-2 font-mono">${entry.ph != null ? entry.ph.toFixed(2) : '—'}</td>
        <td class="px-3 py-2 font-mono">${entry.ntu != null ? entry.ntu.toFixed(1) : '—'}</td>
        <td class="px-3 py-2 font-mono">${entry.tds != null ? Number(entry.tds).toFixed(0) : '—'}</td>
        <td class="px-3 py-2"><span class="${badgeBase} ${badgeCls}">${label}</span></td>
      </tr>
    `;
  }).join('');
}

function addLogEntry(data) {
  logEntries.unshift(data);
  if (logEntries.length > 50) logEntries.pop();
  renderLog();
}

function setLogEntries(entries) {
  if (!Array.isArray(entries)) {
    logEntries = [];
    renderLog();
    return;
  }
  logEntries = entries.slice(0, 50);
  renderLog();
}

function renderPersistedOverview() {
  const tbody = document.getElementById('persisted-tbody');
  const noteEl = document.getElementById('persisted-view-note');
  const updatedAtEl = document.getElementById('persisted-updated-at');
  const sourcePillEl = document.getElementById('persisted-source-pill');
  if (!tbody || !noteEl || !updatedAtEl || !sourcePillEl) return;

  const source = persistedOverviewMeta.source || 'idle';
  sourcePillEl.className = `persisted-source-pill ${persistedSourceClass(source)}`;
  sourcePillEl.textContent = persistedSourceLabel(source);
  updatedAtEl.textContent = persistedOverviewMeta.updatedAt
    ? `Actualizado: ${fmtTS(persistedOverviewMeta.updatedAt)}`
    : 'Pendiente';

  if (testMode) {
    noteEl.textContent = 'Persistencia no disponible en este entorno de ejecución.';
    tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-8 text-center text-amber-700 dark:text-amber-300">Persistencia no disponible para nuevas lecturas en este entorno.</td></tr>';
    return;
  }

  if (persistedOverviewMeta.warning) {
    const detail = persistedOverviewMeta.detail ? ` Detalle: ${persistedOverviewMeta.detail}` : '';
    noteEl.textContent = `${persistedOverviewMeta.warning}${detail}`;
  } else {
    const modeLabel = persistedOverviewMeta.mode ? ` (${persistedOverviewMeta.mode})` : '';
    noteEl.textContent = `Esta vista muestra únicamente lecturas ya persistidas. Fuente actual: ${persistedSourceLabel(source)}${modeLabel}.`;
  }

  if (persistedOverviewRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-8 text-center text-muted-foreground">Sin lecturas persistidas confirmadas todavía.</td></tr>';
    return;
  }

  const badgeBase = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border';
  tbody.innerHTML = persistedOverviewRows.map((row, index) => {
    const validStatus = Number.isInteger(row.status) && row.status >= 0 && row.status < STATUS_BADGE.length;
    const badgeCls = validStatus ? STATUS_BADGE[row.status] : 'bg-muted text-muted-foreground border-border';
    const label = validStatus ? STATUS_LABEL[row.status] : 'Sin datos';
    const altBg = index % 2 === 1 ? 'bg-muted/30' : '';
    const isCurrent = row.location === currentLocation ? 'persisted-row-current' : '';
    const sourceLabel = persistedSourceLabel(row.source || source);
    const sourceCls = persistedSourceClass(row.source || source);

    return `
      <tr class="${altBg} ${isCurrent} text-sm">
        <td class="px-3 py-2 font-medium">${row.name || LOCATIONS[row.location]?.name || row.location || '—'}</td>
        <td class="px-3 py-2 whitespace-nowrap font-mono text-xs">${row.ts ? fmtTS(row.ts) : '—'}</td>
        <td class="px-3 py-2"><span class="persisted-source-pill ${sourceCls}">${sourceLabel}</span></td>
        <td class="px-3 py-2 font-mono">${row.ph != null ? Number(row.ph).toFixed(2) : '—'}</td>
        <td class="px-3 py-2 font-mono">${row.ntu != null ? Number(row.ntu).toFixed(1) : '—'}</td>
        <td class="px-3 py-2 font-mono">${row.tds != null ? Number(row.tds).toFixed(0) : '—'}</td>
        <td class="px-3 py-2"><span class="${badgeBase} ${badgeCls}">${label}</span></td>
      </tr>
    `;
  }).join('');
}

async function loadPersistedOverview(limit = Object.keys(LOCATIONS).length) {
  if (testMode) {
    persistedOverviewRows = [];
    persistedOverviewMeta = {
      source: 'idle',
      warning: null,
      detail: null,
      mode: null,
      updatedAt: Date.now(),
    };
    renderPersistedOverview();
    return;
  }

  try {
    const result = await apiFetch('GET', `/get_latest_persisted/${limit}`);
    if (!result || result.ok === false) {
      throw new Error(result?.error || 'No fue posible cargar lecturas persistidas.');
    }

    persistedOverviewRows = (Array.isArray(result.rows) ? result.rows : []).map((row) => ({
      location: row?.location || null,
      name: row?.name || LOCATIONS[row?.location]?.name || row?.location || '—',
      ph: row?.ph ?? null,
      ntu: row?.ntu ?? null,
      tds: row?.tds ?? null,
      status: Number.isFinite(Number(row?.status)) ? Number(row.status) : null,
      ts: normalizeTimestamp(row?.ts),
      source: row?.source || result.source || null,
    }));
    persistedOverviewMeta = {
      source: result.source || '3nf',
      warning: result.warning || null,
      detail: result.detail || null,
      mode: result.mode || null,
      updatedAt: normalizeTimestamp(result.generated_at_ms) || Date.now(),
    };
  } catch (error) {
    persistedOverviewRows = [];
    persistedOverviewMeta = {
      source: 'error',
      warning: 'No fue posible cargar la vista de lecturas persistidas.',
      detail: error.message,
      mode: null,
      updatedAt: Date.now(),
    };
  }

  renderPersistedOverview();
}

async function loadRecentReadings(loc, limit = 50) {
  if (testMode) {
    return;
  }

  try {
    const result = await apiFetch('GET', `/get_recent_readings/${loc}/${limit}`);
    if (!result || result.ok === false) {
      throw new Error(result?.error || 'No fue posible cargar lecturas recientes.');
    }

    const locationName = LOCATIONS[loc]?.name || loc;
    const rows = Array.isArray(result.rows) ? result.rows : [];

    if (result.warning) {
      console.warn(`[Log] ${result.warning}`);
    }

    const normalized = rows.map((row) => ({
      location: loc,
      name: locationName,
      ph: row?.ph ?? null,
      ntu: row?.ntu ?? null,
      tds: row?.tds ?? null,
      status: Number.isFinite(Number(row?.status)) ? Number(row.status) : null,
      ts: Number.isFinite(Number(row?.ts)) ? Number(row.ts) : null,
      source: row?.source || result.source || null,
    }));

    if (normalized.length === 0) {
      const latest = latestByLocation[loc] || null;
      if (latest && (latest.ph != null || latest.ntu != null || latest.tds != null)) {
        normalized.push({
          location: loc,
          name: latest.name || locationName,
          ph: latest.ph ?? null,
          ntu: latest.ntu ?? null,
          tds: latest.tds ?? null,
          status: Number.isFinite(Number(latest.status)) ? Number(latest.status) : null,
          ts: normalizeTimestamp(latest.ts),
          source: result.source || null,
        });
      }
    }

    setLogEntries(normalized);
    if (normalized.length > 0) {
      setReadingStateNote('saved', {
        ...normalized[0],
        source: result.source || normalized[0].source || null,
      });
    } else {
      setReadingStateNote('idle', { location: loc, name: locationName });
    }
  } catch (error) {
    setReadingStateNote('error', { error: error.message });
    showError(`Error cargando registro reciente: ${error.message}`);
  }
}

async function loadLatestSnapshot(loc) {
  const latest = await apiFetch('GET', '/get_latest_all');

  latestByLocation = {};
  for (const [key, data] of Object.entries(latest || {})) {
    const normalized = upsertLatestSnapshot(key, data || {});
    if (normalized) {
      updateMarker(key, normalized);
    }
  }

  const selected = latestByLocation[loc];
  if (selected) {
    updateCards({
      ...selected,
      location: selected.location || loc,
      name: selected.name || LOCATIONS[loc]?.name || loc,
    });
  }

  renderComparisonTable();
}

async function loadPhHistory(loc, range, window) {
  if (testMode) {
    renderHistChart(charts.ph, mockHistory(MOCK_READINGS[loc]?.ph ?? 7.0, 0.35), 'ph-hist-nodata');
    return;
  }
  try {
    const data = await apiFetch('GET', `/get_samples/ph_${loc}/-${range}/${window}`);
    renderHistChart(charts.ph, data, 'ph-hist-nodata');
  } catch (error) {
    showError(`Error cargando historial pH: ${error.message}`);
  }
}

async function loadNtuHistory(loc, range, window) {
  if (testMode) {
    renderHistChart(charts.ntu, mockHistory(MOCK_READINGS[loc]?.ntu ?? 1.0, 0.5), 'ntu-hist-nodata');
    return;
  }
  try {
    const data = await apiFetch('GET', `/get_samples/ntu_${loc}/-${range}/${window}`);
    renderHistChart(charts.ntu, data, 'ntu-hist-nodata');
  } catch (error) {
    showError(`Error cargando historial turbidez: ${error.message}`);
  }
}

async function loadTdsHistory(loc, range, window) {
  if (testMode) {
    renderHistChart(charts.tds, mockHistory(MOCK_READINGS[loc]?.tds ?? 420, 60), 'tds-hist-nodata');
    return;
  }
  try {
    const data = await apiFetch('GET', `/get_samples/tds_${loc}/-${range}/${window}`);
    renderHistChart(charts.tds, data, 'tds-hist-nodata');
  } catch (error) {
    showError(`Error cargando historial TDS: ${error.message}`);
  }
}

async function refreshAllHistories() {
  const phBtn = document.querySelector('#tab-ph-hist .htab.active');
  const ntuBtn = document.querySelector('#tab-ntu-hist .htab.active');
  const tdsBtn = document.querySelector('#tab-tds-hist .htab.active');

  if (phBtn) await loadPhHistory(document.getElementById('ph-hist-location').value, phBtn.dataset.range, phBtn.dataset.window);
  if (ntuBtn) await loadNtuHistory(document.getElementById('ntu-hist-location').value, ntuBtn.dataset.range, ntuBtn.dataset.window);
  if (tdsBtn) await loadTdsHistory(document.getElementById('tds-hist-location').value, tdsBtn.dataset.range, tdsBtn.dataset.window);
}

function schedulePersistedRefresh(loc) {
  if (testMode) {
    renderPersistedOverview();
    return;
  }

  const targetLoc = LOCATIONS[loc] ? loc : currentLocation;
  if (persistedRefreshTimer) {
    clearTimeout(persistedRefreshTimer);
  }

  persistedRefreshTimer = setTimeout(async () => {
    try {
      await Promise.all([
        loadLatestSnapshot(targetLoc),
        loadRecentReadings(targetLoc),
        loadPersistedOverview(),
        refreshAllHistories(),
      ]);
    } catch (error) {
      showError(`No se pudo refrescar desde DB luego de guardar: ${error.message}`);
    } finally {
      persistedRefreshTimer = null;
    }
  }, 300);
}

async function loadResourceHistory(range, window) {
  if (testMode) {
    renderHistChart(charts.cpu, mockHistory(35.0, 10.0, 24), 'resource-cpu-nodata');
    renderHistChart(charts.mem, mockHistory(58.0, 6.0, 24), 'resource-mem-nodata');
    return;
  }

  try {
    const [cpuData, memData] = await Promise.all([
      apiFetch('GET', `/get_samples/cpu/-${range}/${window}`),
      apiFetch('GET', `/get_samples/mem/-${range}/${window}`),
    ]);
    renderHistChart(charts.cpu, cpuData, 'resource-cpu-nodata');
    renderHistChart(charts.mem, memData, 'resource-mem-nodata');
    resourcesLoaded = true;
  } catch (error) {
    showError(`Error cargando recursos del Arduino: ${error.message}`);
  }
}

function appendRealtimePoint(chart, nodataId, message, maxPoints = 120) {
  if (!chart || !message || message.value == null || !message.ts) return;
  const nodata = document.getElementById(nodataId);
  if (nodata) nodata.classList.add('hidden');

  chart.data.labels.push(new Date(message.ts).toLocaleString('es-PA', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }));
  chart.data.datasets[0].data.push(message.value);

  if (chart.data.labels.length > maxPoints) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.update();
}

function setReadingUI(loading) {
  readingInProgress = loading;
  const btn = document.getElementById('take-reading-btn');
  const btnText = document.getElementById('btn-text');
  const spinner = document.getElementById('btn-spinner');
  if (!btn || !btnText || !spinner) return;
  btn.disabled = loading;
  btn.setAttribute('aria-busy', loading ? 'true' : 'false');
  btn.setAttribute('aria-pressed', loading ? 'true' : 'false');
  btnText.classList.toggle('hidden', loading);
  spinner.classList.toggle('hidden', !loading);
  spinner.classList.toggle('flex', loading);
  if (!loading) {
    updatePrimaryActionButtonLabel();
  }
  updateCalibrationUi();
}

async function takeReading() {
  if (readingInProgress) return;

  if (!captureEnabled) {
    try {
      const resumeResult = await apiFetch('POST', '/set_capture_enabled/on');
      if (!resumeResult || resumeResult.ok === false) {
        throw new Error(resumeResult?.error || 'No fue posible reanudar la captura.');
      }
      setCaptureUi(Boolean(resumeResult.enabled));
    } catch (error) {
      showError(`Error al reanudar captura: ${error.message}`);
      return;
    }
  }

  setReadingUI(true);
  setReadingStateNote('saving', { location: currentLocation, name: LOCATIONS[currentLocation]?.name || currentLocation });

  if (testMode) {
    await new Promise((resolve) => setTimeout(resolve, 900 + Math.random() * 600));
    const mock = MOCK_READINGS[currentLocation];
    const vary = (value, spread) => +(value + (Math.random() - 0.5) * spread).toFixed(3);
    const data = {
      location: currentLocation,
      name: LOCATIONS[currentLocation].name,
      ph: vary(mock.ph, 0.1),
      ntu: vary(mock.ntu, 0.1),
      tds: vary(mock.tds, 40),
      ts: new Date().toISOString(),
    };
    data.status = computeStatus(data.ph, data.ntu, data.tds);
    setReadingUI(false);
    upsertLatestSnapshot(currentLocation, data);
    updateCards(data);
    updateMarker(currentLocation, data);
    renderComparisonTable();
    addLogEntry(data);
    setReadingStateNote('test', data);
    return;
  }

  if (socket && socket.connected) {
    socket.emit('take_reading', { location: currentLocation });
    return;
  }

  try {
    const result = await apiFetch('POST', '/take_reading');
    if (!result.ok) {
      setReadingStateNote('error', { error: result.error || 'No fue posible guardar la lectura.' });
      showError(`Error al tomar lectura: ${result.error || 'desconocido'}`);
      setReadingUI(false);
    } else {
      setTimeout(() => {
        if (readingInProgress) {
          setReadingUI(false);
          setReadingStateNote('error', { error: 'No se recibió confirmación de guardado a tiempo.' });
          showError('No se recibió respuesta de lectura a tiempo.');
        }
      }, 17000);
    }
  } catch (error) {
    setReadingStateNote('error', { error: error.message });
    showError(`Error al conectar con el Arduino: ${error.message}`);
    setReadingUI(false);
  }
}

async function toggleCaptureMode() {
  if (readingInProgress) return;

  const targetEnabled = !captureEnabled;
  const targetState = targetEnabled ? 'on' : 'off';
  const button = document.getElementById('take-reading-btn');
  if (button) button.disabled = true;

  try {
    const result = await apiFetch('POST', `/set_capture_enabled/${targetState}`);
    if (!result || result.ok === false) {
      throw new Error(result?.error || 'No fue posible cambiar el estado de captura.');
    }
    setCaptureUi(Boolean(result.enabled));
  } catch (error) {
    showError(`Error al cambiar captura: ${error.message}`);
  } finally {
    if (button) button.disabled = readingInProgress;
  }
}

async function handlePrimaryReadingAction() {
  if (readingInProgress) return;

  if (captureEnabled) {
    await toggleCaptureMode();
    return;
  }

  await takeReading();
}

async function testNotifications() {
  const button = document.getElementById('test-alerts-btn');
  if (!button) return;

  const previous = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Probando...';

  try {
    let result;

    try {
      result = await apiFetch('POST', '/test_notifications');
    } catch (firstError) {
      if (firstError && firstError.status === 422) {
        result = await apiFetch('POST', '/test_notifications', { location: currentLocation });
      } else {
        throw firstError;
      }
    }

    const okChannels = Array.isArray(result.ok_channels) ? result.ok_channels : [];
    if (okChannels.length > 0) {
      showError(`Prueba completada. Canales OK: ${okChannels.join(', ')}`);
    } else {
      console.warn('[Alerts/Test] Ningún canal respondió OK. Revisa logs backend.', result);
      showError('Prueba ejecutada sin envíos confirmados. Revisa logs del backend.');
    }
  } catch (error) {
    console.error('[Alerts/Test] Error probando alertas:', error);
    showError('No se pudo completar la prueba de alertas. Revisa logs del backend.');
  } finally {
    button.innerHTML = previous;
    updateNotificationConfigUi();
    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }
}

async function setLocation(loc) {
  currentLocation = loc;
  document.getElementById('card-location-val').textContent = LOCATIONS[loc]?.name || loc;
  startCalibrationCountdown();
  setPreviewNote(buildIdlePreviewNote());
  setReadingStateNote('idle', { location: loc, name: LOCATIONS[loc]?.name || loc });
  updateLivePreviewTab();
  renderPersistedOverview();

  if (testMode) {
    const mock = MOCK_READINGS[loc];
    if (mock) {
      const data = {
        location: loc,
        name: LOCATIONS[loc].name,
        ph: mock.ph,
        ntu: mock.ntu,
        tds: mock.tds,
        status: computeStatus(mock.ph, mock.ntu, mock.tds),
        ts: new Date().toISOString(),
      };
      upsertLatestSnapshot(loc, data);
      livePreviewByLocation[loc] = { ...data, preview: true };
      updateCards(data);
      updateLivePreviewTab();
      updateMarker(loc, data);
      setLogEntries([data]);
      setReadingStateNote('test', data);
    } else {
      setLogEntries([]);
      setReadingStateNote('test', { location: loc, name: LOCATIONS[loc]?.name || loc });
    }
    renderComparisonTable();
    renderPersistedOverview();
    await refreshAllHistories();
    return;
  }

  try {
    await apiFetch('POST', `/set_location/${loc}`);
    await Promise.all([
      refreshAllHistories(),
      loadLatestSnapshot(loc),
      loadRecentReadings(loc),
      loadPersistedOverview(),
    ]);
  } catch (error) {
    setReadingStateNote('error', { error: error.message });
    showError(`Error al cambiar ubicación: ${error.message}`);
  }
}

function activateTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((tab) => {
    const isActive = tab.dataset.tab === tabId;
    tab.classList.toggle('border-primary', isActive);
    tab.classList.toggle('text-primary', isActive);
    tab.classList.toggle('bg-card', isActive);
    tab.classList.toggle('border-transparent', !isActive);
    tab.classList.toggle('text-muted-foreground', !isActive);
  });

  document.querySelectorAll('.tab-content').forEach((panel) => panel.classList.remove('active'));

  const panel = document.getElementById(tabId);
  if (panel) panel.classList.add('active');

  if (tabId === 'tab-map' && mapInstance) {
    setTimeout(() => mapInstance.invalidateSize(), 80);
  }

  if (tabId === 'tab-resources') {
    const activeBtn = document.querySelector('#resources-range-tabs .htab.active');
    if (activeBtn && !resourcesLoaded) {
      loadResourceHistory(activeBtn.dataset.range, activeBtn.dataset.window);
    }
  }
}

async function exportReadingsJson() {
  const button = document.getElementById('export-json-btn');
  if (!button) return;

  const previous = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin"></i> Exportando...';

  try {
    let result;

    try {
      result = await apiFetch('GET', `/export_readings_json/${currentLocation}/1000`);
      if (!result || result.ok === false) {
        throw new Error(result?.error || 'No fue posible exportar lecturas.');
      }
    } catch (structuredError) {
      const latestSnapshot = await apiFetch('GET', '/get_latest_all');
      result = {
        ok: true,
        format: 'hydrolabs.snapshot.v1',
        scope: currentLocation,
        generated_at_iso_utc: new Date().toISOString(),
        note: `Fallback por exportación estructurada no disponible: ${structuredError?.message || 'error desconocido'}`,
        latest: latestSnapshot,
      };
    }

    const payload = JSON.stringify(result, null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safeLocation = String(currentLocation || 'all').replace(/[^a-z0-9_-]/gi, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    anchor.href = url;
    anchor.download = `hydrolabs-${safeLocation}-${timestamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    showError(`Error exportando JSON: ${error.message}`);
  } finally {
    button.disabled = false;
    button.innerHTML = previous;
    if (global.lucide && typeof global.lucide.createIcons === 'function') {
      global.lucide.createIcons();
    }
  }
}

function bindHistoryTabs(containerId, loadFn, locationSelectId) {
  document.querySelectorAll(`#${containerId} .htab`).forEach((button) => {
    button.addEventListener('click', async () => {
      document.querySelectorAll(`#${containerId} .htab`).forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      const loc = document.getElementById(locationSelectId).value;
      await loadFn(loc, button.dataset.range, button.dataset.window);
    });
  });

  document.getElementById(locationSelectId).addEventListener('change', async () => {
    const active = document.querySelector(`#${containerId} .htab.active`);
    if (!active) return;
    const loc = document.getElementById(locationSelectId).value;
    await loadFn(loc, active.dataset.range, active.dataset.window);
  });
}

function bindSocketEvents() {
  if (!socket) return;

  socket.on('connect', () => {
    socket.emit('get_reading_state', {});
  });

  socket.on('reading_update', (data) => {
    const normalized = upsertLatestSnapshot(data?.location, data || {}) || data;
    if (normalized && normalized.location) {
      livePreviewByLocation[normalized.location] = {
        ...livePreviewByLocation[normalized.location],
        ...normalized,
        preview: true,
      };
      if (normalized.location === currentLocation) {
        updateLivePreviewTab();
      }
    }
    const storageInfo = normalized && typeof normalized.storage === 'object' ? normalized.storage : null;

    if (storageInfo) {
      storageConfig = {
        ready: Boolean(storageInfo.saved),
        mode: storageInfo.mode || storageConfig.mode,
        error: storageInfo.saved ? null : (storageInfo.error || 'No se pudo confirmar guardado en DB.'),
      };
      updateStorageConfigUi();
    }

    setReadingUI(false);
    updateCards(normalized);
    updateMarker(normalized.location, normalized);
    renderComparisonTable();
    addLogEntry(normalized);
    if (storageInfo && storageInfo.saved === false) {
      setReadingStateNote('error', {
        ...normalized,
        error: storageInfo.error || 'Lectura recibida pero no se pudo guardar en la base de datos.',
      });
    } else {
      setReadingStateNote('saved', normalized);
    }
    if (captureEnabled) {
      if (storageInfo && storageInfo.saved === false) {
        setPreviewNote(`Lectura recibida para ${normalized.name}, pero no quedó guardada en DB.`);
      } else {
        setPreviewNote(`Lectura guardada para ${normalized.name}. La vista previa continúa sin guardar.`);
      }
    } else {
      setPreviewNote(buildIdlePreviewNote());
    }
    schedulePersistedRefresh(normalized.location);
    startCalibrationCountdown();
  });
  socket.on('preview_update', (data) => {
    if (data && data.location) {
      livePreviewByLocation[data.location] = {
        ...data,
        ts: normalizeTimestamp(data.ts),
      };
      if (data.location === currentLocation) {
        updateLivePreviewTab();
      }
    }

    if (!captureEnabled || !data || data.location !== currentLocation) {
      return;
    }
    setReadingStateNote('preview', data);
    setPreviewNote(
      `Vista previa en vivo para ${data.name}: pH ${formatMetricValue(data.ph, 2)} | NTU ${formatMetricValue(data.ntu, 1)} | TDS ${formatMetricValue(data.tds, 0)} ppm. Aún no guardado.`
    );
  });
  socket.on('capture_state_update', (state) => {
    if (!state || typeof state.enabled !== 'boolean') return;
    setCaptureUi(state.enabled);
  });
  socket.on('reading_state_update', (state) => {
    if (state && typeof state.in_progress === 'boolean') {
      setReadingUI(state.in_progress);
      if (state.in_progress) {
        setReadingStateNote('saving', { location: state.location || currentLocation });
      }
    }
  });
  socket.on('calibration_state_update', (state) => {
    if (!state || state.location !== currentLocation) {
      return;
    }
    if (Number.isFinite(state.seconds_left) && state.seconds_left > 0) {
      calibrationEndsAt = Date.now() + Number(state.seconds_left) * 1000;
      updateCalibrationUi();
    }
  });
  socket.on('reading_error', (message) => {
    setReadingUI(false);
    if (message && Number.isFinite(message.calibration_seconds_left) && message.calibration_seconds_left > 0) {
      calibrationEndsAt = Date.now() + Number(message.calibration_seconds_left) * 1000;
      updateCalibrationUi();
    }
    const retryAfter = Number(message?.retry_after_s);
    const retryHint = Number.isFinite(retryAfter) && retryAfter > 0 ? ` Reintenta en ${retryAfter}s.` : '';
    setReadingStateNote('error', { error: `${message?.error || 'No fue posible completar la lectura.'}${retryHint}` });
    showError(`${message?.error || 'No fue posible completar la lectura.'}${retryHint}`);
  });
  socket.on('cpu_usage', (message) => appendRealtimePoint(charts.cpu, 'resource-cpu-nodata', message));
  socket.on('memory_usage', (message) => appendRealtimePoint(charts.mem, 'resource-mem-nodata', message));
  socket.on('connect_error', () => showError('Sin conexión con el servidor Arduino.'));
}

function initShell() {
  document.getElementById('app-root').innerHTML = renderAppShell();
}

function initCharts() {
  charts.ph = buildChart('ph-hist-chart', 'pH', '#0f766e', 0, 14);
  charts.ntu = buildChart('ntu-hist-chart', 'NTU', '#2563eb', 0, null);
  charts.tds = buildChart('tds-hist-chart', 'TDS ppm', '#7c3aed', 0, null);
  charts.cpu = buildChart('resource-cpu-chart', 'CPU %', '#2563eb', 0, 100);
  charts.mem = buildChart('resource-mem-chart', 'Memoria %', '#16a34a', 0, 100);
}

function bindUiEvents() {
  document.querySelectorAll('.tab-btn[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });
  bindHistoryTabs('tab-ph-hist', loadPhHistory, 'ph-hist-location');
  bindHistoryTabs('tab-ntu-hist', loadNtuHistory, 'ntu-hist-location');
  bindHistoryTabs('tab-tds-hist', loadTdsHistory, 'tds-hist-location');
  document.querySelectorAll('#resources-range-tabs .htab').forEach((button) => {
    button.addEventListener('click', async () => {
      document.querySelectorAll('#resources-range-tabs .htab').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      await loadResourceHistory(button.dataset.range, button.dataset.window);
    });
  });
  const takeReadingBtn = document.getElementById('take-reading-btn');
  if (takeReadingBtn) {
    takeReadingBtn.addEventListener('click', handlePrimaryReadingAction);
    takeReadingBtn.setAttribute('aria-pressed', 'false');
  }
  const exportJsonBtn = document.getElementById('export-json-btn');
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', exportReadingsJson);
  }
  // Botón de reporte
  const reportBtn = document.getElementById('generate-report-btn');
  if (reportBtn) {
    reportBtn.addEventListener('click', () => {
      const reportData = buildReportDataForCurrentLocation();
      if (!reportData) {
        showError('No hay una lectura válida para generar reporte. Toma y guarda una lectura primero.');
        return;
      }

      if (global.WaterDashboard && global.WaterDashboard.showReportDialog) {
        global.WaterDashboard.showReportDialog(reportData, {
          emailEnabled: Boolean(notificationConfig.emailConfigured),
        });
      }
    });
  }
  
  document.getElementById('location-select').addEventListener('change', async (event) => {
    await setLocation(event.target.value);
  });

  const testAlertsBtn = document.getElementById('test-alerts-btn');
  if (testAlertsBtn) {
    testAlertsBtn.addEventListener('click', testNotifications);
  }
}

async function hydrateInitialState() {
  const selector = document.getElementById('location-select');
  if (selector) {
    selector.value = currentLocation;
  }

  document.getElementById('card-location-val').textContent = LOCATIONS[currentLocation]?.name || currentLocation;
  setPreviewNote(buildIdlePreviewNote());
  setReadingStateNote('idle', { location: currentLocation, name: LOCATIONS[currentLocation]?.name || currentLocation });
  updateLivePreviewTab();
  renderPersistedOverview();

  if (testMode) {
    latestByLocation = {};
    livePreviewByLocation = {};
    for (const [loc, mock] of Object.entries(MOCK_READINGS)) {
      const status = computeStatus(mock.ph, mock.ntu, mock.tds);
      const row = { ...mock, location: loc, name: LOCATIONS[loc].name, status, ts: new Date().toISOString() };
      upsertLatestSnapshot(loc, row);
      livePreviewByLocation[loc] = { ...row, preview: true };
      updateMarker(loc, row);
    }
    renderComparisonTable();
    const initial = MOCK_READINGS[currentLocation];
    const status = computeStatus(initial.ph, initial.ntu, initial.tds);
    const data = { ...initial, location: currentLocation, name: LOCATIONS[currentLocation].name, status, ts: new Date().toISOString() };
    updateCards(data);
    updateLivePreviewTab();
    addLogEntry(data);
    setReadingStateNote('test', data);
    await loadPersistedOverview();
  } else {
    try {
      await Promise.all([
        loadLatestSnapshot(currentLocation),
        loadRecentReadings(currentLocation),
        loadPersistedOverview(),
      ]);
    } catch {
      // no-op
    }
  }

  await refreshAllHistories();

  const activeResourceBtn = document.querySelector('#resources-range-tabs .htab.active');
  if (activeResourceBtn) {
    await loadResourceHistory(activeResourceBtn.dataset.range, activeResourceBtn.dataset.window);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  initShell();
  startCalibrationCountdown();
  
  // Reinicializar el interruptor de tema después de renderizar la estructura base
  if (window.toggleTheme) {
    const toggleButton = document.getElementById('theme-toggle');
    if (toggleButton) {
      toggleButton.addEventListener('click', window.toggleTheme);
    }
  }
  
  const config = await loadRuntimeConfig();
  testMode = config.testMode;
  updateTestModeVisibility();
  if (config.defaultLocation && LOCATIONS[config.defaultLocation]) {
    currentLocation = config.defaultLocation;
  }
  if (Number.isFinite(config.sensorCalibrationS)) {
    calibrationSeconds = Math.max(0, Number(config.sensorCalibrationS));
  }
  if (typeof config.captureEnabled === 'boolean') {
    captureEnabled = config.captureEnabled;
  }

  // UX: el panel inicia en "Tomar Lectura" para que la acción primaria sea explícita.
  if (!testMode && captureEnabled) {
    try {
      const paused = await apiFetch('POST', '/set_capture_enabled/off');
      if (paused && paused.ok !== false && typeof paused.enabled === 'boolean') {
        captureEnabled = paused.enabled;
      } else {
        captureEnabled = false;
      }
    } catch {
      captureEnabled = false;
    }
  }
  if (Number.isFinite(config.minTakeReadingGapS)) {
    minTakeReadingGapS = Math.max(0, Number(config.minTakeReadingGapS));
  }
  if (config.notifications) {
    notificationConfig = {
      discordConfigured: Boolean(config.notifications.discordConfigured),
      emailConfigured: Boolean(config.notifications.emailConfigured),
      emailAlertsConfigured: Boolean(
        typeof config.notifications.emailAlertsConfigured === 'boolean'
          ? config.notifications.emailAlertsConfigured
          : config.notifications.emailConfigured
      ),
      telegramConfigured: Boolean(config.notifications.telegramConfigured),
      telegramTargets: Number(config.notifications.telegramTargets) || 0,
    };
  }
  chatbotBackendConfigured = Boolean(config.chatbotConfigured);
  storageConfig = {
    ready: typeof config.storageReady === 'boolean'
      ? config.storageReady
      : Boolean(config.storageMode && config.storageMode !== 'disabled'),
    mode: config.storageMode || null,
    error: config.storageError || null,
  };
  socket = testMode || typeof io === 'undefined' ? null : io(`http://${window.location.host}`);
  if (!testMode && typeof io === 'undefined') {
    showError('Socket.IO no disponible; la actualización en tiempo real quedó desactivada.');
  }
  bindSocketEvents();
  initMap();
  initCharts();
  bindUiEvents();
  bindExitAutosaveHooks();
  setCaptureUi(captureEnabled);
  updateNotificationConfigUi();
  updateStorageConfigUi();
  await hydrateInitialState();
  
  // Inicializar chatbot
  if (global.WaterDashboard && global.WaterDashboard.initChatbot) {
    global.WaterDashboard.initChatbot({
      backendConfigured: chatbotBackendConfigured,
    });
  }
  
  if (global.lucide && typeof global.lucide.createIcons === 'function') {
    global.lucide.createIcons();
  }
});
}(window));
