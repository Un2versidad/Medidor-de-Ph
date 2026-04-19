(function attachApiModule(global) {
  const WaterDashboard = global.WaterDashboard || (global.WaterDashboard = {});

  WaterDashboard.apiFetch = async function apiFetch(method, path, body) {
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(path, options);

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const backendError =
        (payload && typeof payload.error === 'string' && payload.error.trim())
        || (payload && typeof payload.detail === 'string' && payload.detail.trim())
        || (payload && typeof payload.message === 'string' && payload.message.trim())
        || '';

      const error = new Error(
        backendError ? `${backendError} (HTTP ${response.status})` : `HTTP ${response.status} - ${path}`,
      );
      error.status = response.status;
      error.path = path;
      error.payload = payload;
      throw error;
    }

    return payload || {};
  };

  WaterDashboard.loadRuntimeConfig = async function loadRuntimeConfig() {
    try {
      const config = await WaterDashboard.apiFetch('GET', '/runtime_config');
      return {
        testMode: Boolean(config && config.test_mode),
        sensorCalibrationS: Number(config && config.sensor_calibration_s),
        captureEnabled: Boolean(config && config.capture_enabled),
        minTakeReadingGapS: Number(config && config.min_take_reading_gap_s),
        defaultLocation: config && config.default_location ? String(config.default_location) : null,
        storageMode: config && config.storage_mode ? String(config.storage_mode) : null,
        storageReady: Boolean(config && config.storage_ready),
        storageError: config && config.storage_error ? String(config.storage_error) : null,
        chatbotConfigured: Boolean(config && config.chatbot_configured),
        notifications: {
          discordConfigured: Boolean(config && config.notifications && config.notifications.discord_configured),
          emailConfigured: Boolean(config && config.notifications && config.notifications.email_configured),
          emailAlertsConfigured: Boolean(
            config
            && config.notifications
            && (typeof config.notifications.email_alerts_configured === 'boolean'
              ? config.notifications.email_alerts_configured
              : config.notifications.email_configured)
          ),
          telegramConfigured: Boolean(config && config.notifications && config.notifications.telegram_configured),
          telegramTargets: Number(config && config.notifications && config.notifications.telegram_targets) || 0,
        },
      };
    } catch {
      return {
        testMode: false,
        sensorCalibrationS: 30,
        captureEnabled: true,
        minTakeReadingGapS: 0,
        defaultLocation: null,
        storageMode: null,
        storageReady: false,
        storageError: null,
        chatbotConfigured: false,
        notifications: {
          discordConfigured: false,
          emailConfigured: false,
          emailAlertsConfigured: false,
          telegramConfigured: false,
          telegramTargets: 0,
        },
      };
    }
  };
}(window));
