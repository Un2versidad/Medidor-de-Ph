(function attachDomainModule(global) {
  const WaterDashboard = global.WaterDashboard || (global.WaterDashboard = {});

  WaterDashboard.MOCK_READINGS = {
    chiriqui: { ph: 7.12, ntu: 0.62, tds: 355 },
    cocle: { ph: 7.45, ntu: 1.12, tds: 510 },
    panama_oeste: { ph: 6.85, ntu: 1.94, tds: 690 },
    colon: { ph: 6.22, ntu: 2.45, tds: 830 },
    panama_este: { ph: 6.98, ntu: 1.76, tds: 640 },
    panama: { ph: 7.29, ntu: 0.88, tds: 420 },
    darien: { ph: 6.41, ntu: 3.98, tds: 940 },
    panama_norte_chilibre: { ph: 7.02, ntu: 1.24, tds: 560 },
  };

  WaterDashboard.LOCATIONS = {
    chiriqui: { name: 'Chiriquí', lat: 8.431, lon: -82.426 },
    cocle: { name: 'Coclé', lat: 8.5189, lon: -80.3577 },
    panama_oeste: { name: 'Panamá Oeste', lat: 8.881, lon: -79.784 },
    colon: { name: 'Colón', lat: 9.3598, lon: -79.9009 },
    panama_este: { name: 'Panamá Este', lat: 9.167, lon: -79.097 },
    panama: { name: 'Panamá', lat: 8.9936, lon: -79.5197 },
    darien: { name: 'Darién', lat: 8.033, lon: -77.729 },
    panama_norte_chilibre: { name: 'Panamá Norte (Chilibre)', lat: 9.155, lon: -79.613 },
  };

  WaterDashboard.STATUS_LABEL = ['Apta (Verde)', 'Tolerable (Amarillo)', 'NO APTA (Rojo)'];
  WaterDashboard.STATUS_COLOR = ['#16a34a', '#ca8a04', '#dc2626'];
  WaterDashboard.MARKER_COLOR = WaterDashboard.STATUS_COLOR;
  WaterDashboard.NO_DATA_COLOR = '#94a3b8';
  WaterDashboard.STATUS_BADGE = [
    'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-700',
    'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700',
    'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-900/30 dark:text-rose-200 dark:border-rose-700',
  ];
  WaterDashboard.STATUS_BORDER = ['border-green-400', 'border-yellow-400', 'border-red-400'];
  WaterDashboard.STATUS_ROW = ['row-verde', 'row-amarillo', 'row-rojo'];

  WaterDashboard.computeStatus = function computeStatus(ph, ntu, tds = null) {
    const phBad = ph < 6.0 || ph > 9.0;
    const ntuBad = ntu > 5;
    const phWarn = ph < 6.5 || ph > 8.5;
    const ntuWarn = ntu > 1 && ntu <= 5;
    const tdsBad = tds != null && tds > 900;
    const tdsWarn = tds != null && tds > 600;
    if (phBad || ntuBad || tdsBad) return 2;
    if (phWarn || ntuWarn || tdsWarn) return 1;
    return 0;
  };

  WaterDashboard.mockHistory = function mockHistory(base, spread, count = 24) {
    const now = Date.now();
    return Array.from({ length: count }, (_, index) => ({
      ts: new Date(now - (count - 1 - index) * 3600 * 1000).toISOString(),
      value: +(base + (Math.random() - 0.5) * spread * 2).toFixed(3),
    }));
  };

  WaterDashboard.fmtTS = function fmtTS(ts) {
    return new Date(ts).toLocaleString('es-PA', { hour12: false });
  };
}(window));
