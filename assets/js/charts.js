(function attachChartsModule(global) {
  const WaterDashboard = global.WaterDashboard || (global.WaterDashboard = {});

  WaterDashboard.buildChart = function buildChart(canvasId, label, color, yMin, yMax) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return null;

    return new Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label,
          data: [],
          borderColor: color,
          backgroundColor: `${color}22`,
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.32,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 220 },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxRotation: 0, font: { size: 10 } } },
          y: { min: yMin, max: yMax, ticks: { font: { size: 10 } } },
        },
      },
    });
  };

  WaterDashboard.renderHistChart = function renderHistChart(chart, samples, nodataId) {
    const nodata = document.getElementById(nodataId);
    if (!chart) {
      if (nodata) {
        nodata.textContent = 'No se pudo inicializar la gráfica (Chart.js no disponible).';
        nodata.classList.remove('hidden');
      }
      return;
    }
    if (!samples || samples.length === 0) {
      if (nodata) nodata.classList.remove('hidden');
      if (chart) {
        chart.data.labels = [];
        chart.data.datasets[0].data = [];
        chart.update();
      }
      return;
    }

    if (nodata) nodata.classList.add('hidden');
    chart.data.labels = samples.map((sample) => new Date(sample.ts).toLocaleString('es-PA', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }));
    chart.data.datasets[0].data = samples.map((sample) => sample.value);
    chart.update();
  };
}(window));
