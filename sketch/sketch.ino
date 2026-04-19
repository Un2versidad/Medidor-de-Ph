/*
 Monitor de Calidad de Agua
 pH + TDS + Turbidez + Buzzer
*/

#include <Wire.h>
#include <hd44780.h>
#include <hd44780ioClass/hd44780_I2Cexp.h>
#include <Arduino_RouterBridge.h>
#include <Arduino_LED_Matrix.h>
#include <math.h>

hd44780_I2Cexp lcd;
Arduino_LED_Matrix matrix;

static const uint8_t MATRIX_STATUS_OK[8][13] = {
  {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0},
  {0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0},
  {0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0},
  {0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0},
  {0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0},
  {0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0},
};

static const uint8_t MATRIX_STATUS_WARN[8][13] = {
  {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0},
};

static const uint8_t MATRIX_STATUS_DANGER[8][13] = {
  {1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1},
  {0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0},
  {0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0},
  {0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0},
  {0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0},
};

static const uint8_t MATRIX_BUSY[8][13] = {
  {0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0},
  {0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0},
  {0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0},
  {0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0},
  {0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0},
  {0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0},
  {0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0},
  {0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0},
};

static const uint8_t MATRIX_STARTUP[8][13] = {
  {0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0},
  {0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0},
  {0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0},
  {0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0},
  {0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0},
};

int lastMatrixStatus = 1;

// -- Zumbador --
#define BUZZER_PIN 7

// -- Sensores --
#define PH_PIN   A0
#define TDS_PIN  A1
#define TURB_PIN A2

// -- Turbidez (escala relativa 0..100) --
#define TURB_BAR_WIDTH 20
#define TURB_ADC_MIN   0
#define TURB_ADC_MAX   1023
#define TURB_SAMPLES   8

#define TURB_SYM_CLEAR  "[ OK ]"
#define TURB_SYM_CLOUDY "[WARN]"
#define TURB_SYM_DIRTY  "[DIRT]"

// -- Calibracion pH --
float calibration_value = 31.64f;

// -- Variables TDS --
#define VREF   5.0f
#define SCOUNT 30
int analogBuffer[SCOUNT];
int analogBufferTemp[SCOUNT];
int analogBufferIndex = 0;
float tdsValue = 0.0f;

// -- LCD paginas --
int paginaLCD = 0;
unsigned long tiempoUltimaPagina = 0;
const unsigned long INTERVALO_PAGINA = 3000UL;

// -- Temporizadores --
unsigned long tdsTimer = 0;
unsigned long printTimer = 0;
bool previewEnabled = true;

// -- Matriz: vista rapida de sensores --
uint8_t lastMatrixSensorFrame[8 * 13] = {0};
bool matrixHasSensorFrame = false;
bool matrixIsBusy = false;
unsigned long matrixSensorFrameUntil = 0;
const unsigned long MATRIX_SENSOR_FRAME_MS = 1400UL;
const bool MATRIX_MIRROR_HORIZONTAL = true;

void loadMatrixFrame(const uint8_t frame[8 * 13]) {
  uint8_t pixels[8 * 13];

  if (!MATRIX_MIRROR_HORIZONTAL) {
    for (int i = 0; i < (8 * 13); i++) {
      pixels[i] = frame[i];
    }
    matrix.loadPixels(pixels, sizeof(pixels));
    return;
  }

  for (int row = 0; row < 8; row++) {
    for (int col = 0; col < 13; col++) {
      pixels[row * 13 + col] = frame[row * 13 + (12 - col)];
    }
  }

  matrix.loadPixels(pixels, sizeof(pixels));
}

void renderMatrixBitmap(const uint8_t bitmap[8][13]) {
  uint8_t frame[8 * 13];
  for (int row = 0; row < 8; row++) {
    for (int col = 0; col < 13; col++) {
      frame[row * 13 + col] = bitmap[row][col];
    }
  }
  loadMatrixFrame(frame);
}

void renderMatrixStatus(int status) {
  if (status <= 0) {
    renderMatrixBitmap(MATRIX_STATUS_OK);
  } else if (status == 1) {
    renderMatrixBitmap(MATRIX_STATUS_WARN);
  } else {
    renderMatrixBitmap(MATRIX_STATUS_DANGER);
  }
}

int toBarHeight(float value, float minValue, float maxValue) {
  if (value <= minValue) {
    return 0;
  }
  if (value >= maxValue) {
    return 8;
  }

  float ratio = (value - minValue) / (maxValue - minValue);
  int height = (int)(ratio * 8.0f + 0.5f);
  return constrain(height, 0, 8);
}

void fillMetricBar(uint8_t frame[8 * 13], int startCol, int width, int height) {
  for (int col = startCol; col < startCol + width; col++) {
    for (int level = 0; level < height; level++) {
      int row = 7 - level;
      frame[row * 13 + col] = 1;
    }
  }
}

void drawSensorSeparators(uint8_t frame[8 * 13]) {
  for (int row = 0; row < 8; row += 2) {
    frame[row * 13 + 4] = 1;
    frame[row * 13 + 9] = 1;
  }
}

void drawSensorStatusCue(uint8_t frame[8 * 13], int status) {
  if (status <= 0) {
    frame[0 * 13 + 0] = 1;
    frame[0 * 13 + 12] = 1;
  } else if (status == 1) {
    for (int col = 0; col < 13; col += 2) {
      frame[0 * 13 + col] = 1;
    }
  } else {
    for (int col = 0; col < 13; col++) {
      frame[0 * 13 + col] = 1;
    }
  }
}

void storeAndRenderSensorFrame(float ph_act, float tds_ppm, int turbidity, int status) {
  uint8_t frame[8 * 13] = {0};

  int phHeight = toBarHeight(ph_act, 0.0f, 14.0f);
  int tdsHeight = toBarHeight(tds_ppm, 0.0f, 1200.0f);
  int turbidityHeight = toBarHeight((float)turbidity, 0.0f, 100.0f);

  // Distribucion: pH (0..3), separador (4), TDS (5..8), separador (9), Turb (10..12)
  fillMetricBar(frame, 0, 4, phHeight);
  fillMetricBar(frame, 5, 4, tdsHeight);
  fillMetricBar(frame, 10, 3, turbidityHeight);

  drawSensorSeparators(frame);
  drawSensorStatusCue(frame, status);

  for (int i = 0; i < (8 * 13); i++) {
    lastMatrixSensorFrame[i] = frame[i];
  }

  matrixHasSensorFrame = true;
  matrixSensorFrameUntil = millis() + MATRIX_SENSOR_FRAME_MS;
  loadMatrixFrame(lastMatrixSensorFrame);
}

void refreshMatrixDisplay() {
  if (matrixIsBusy) {
    renderMatrixBitmap(MATRIX_BUSY);
    return;
  }

  if (matrixHasSensorFrame && millis() < matrixSensorFrameUntil) {
    loadMatrixFrame(lastMatrixSensorFrame);
    return;
  }

  matrixHasSensorFrame = false;
  renderMatrixStatus(lastMatrixStatus);
}

void printSeparator() {
  Monitor.println("------------------------------------");
}

void buildBar(int value, int maxVal, char* out, size_t outSize) {
  if (outSize < (size_t)(TURB_BAR_WIDTH + 3)) {
    return;
  }

  int filled = map(value, 0, maxVal, 0, TURB_BAR_WIDTH);
  filled = constrain(filled, 0, TURB_BAR_WIDTH);

  out[0] = '[';
  for (int i = 0; i < TURB_BAR_WIDTH; i++) {
    out[i + 1] = (i < filled) ? '#' : '-';
  }
  out[TURB_BAR_WIDTH + 1] = ']';
  out[TURB_BAR_WIDTH + 2] = '\0';
}

const char* turbiditySymbol(int turbidity) {
  if (turbidity < 20) {
    return TURB_SYM_CLEAR;
  }
  if (turbidity < 50) {
    return TURB_SYM_CLOUDY;
  }
  return TURB_SYM_DIRTY;
}

// -- Mediana TDS --
int getMedianNum(int bArray[], int iFilterLen) {
  int bTab[iFilterLen];
  for (byte i = 0; i < iFilterLen; i++) {
    bTab[i] = bArray[i];
  }

  int i, j, bTemp;
  for (j = 0; j < iFilterLen - 1; j++) {
    for (i = 0; i < iFilterLen - j - 1; i++) {
      if (bTab[i] > bTab[i + 1]) {
        bTemp = bTab[i];
        bTab[i] = bTab[i + 1];
        bTab[i + 1] = bTemp;
      }
    }
  }

  return ((iFilterLen & 1) > 0)
    ? bTab[(iFilterLen - 1) / 2]
    : (bTab[iFilterLen / 2] + bTab[iFilterLen / 2 - 1]) / 2;
}

void sampleTdsSignal() {
  if (millis() - tdsTimer <= 40U) {
    return;
  }

  tdsTimer = millis();
  analogBuffer[analogBufferIndex] = analogRead(TDS_PIN);
  analogBufferIndex++;
  if (analogBufferIndex == SCOUNT) {
    analogBufferIndex = 0;
  }
}

void readPh(float &ph_act) {
  long avgval = 0;
  int buffer_arr[10];

  for (int i = 0; i < 10; i++) {
    buffer_arr[i] = analogRead(PH_PIN);
  }

  for (int i = 0; i < 9; i++) {
    for (int j = i + 1; j < 10; j++) {
      if (buffer_arr[i] > buffer_arr[j]) {
        int temp = buffer_arr[i];
        buffer_arr[i] = buffer_arr[j];
        buffer_arr[j] = temp;
      }
    }
  }

  for (int i = 2; i < 8; i++) {
    avgval += buffer_arr[i];
  }

  float volt_ph = (float)avgval * 5.0f / 1024.0f / 6.0f;
  ph_act = -5.70f * volt_ph + calibration_value;
  ph_act = constrain(ph_act, 0.0f, 14.0f);
}

void readTds(float &tds_ppm) {
  for (int i = 0; i < SCOUNT; i++) {
    analogBufferTemp[i] = analogBuffer[i];
  }

  float avgVoltTDS = getMedianNum(analogBufferTemp, SCOUNT) * VREF / 1024.0f;
  float compVolt = avgVoltTDS;

  tds_ppm = (133.42f * pow(compVolt, 3)
           - 255.86f * pow(compVolt, 2)
           + 857.39f * compVolt) * 0.5f;

  tds_ppm = max(tds_ppm, 0.0f);
}

void readTurbidity(int &turbidity, int &rawTurb) {
  long sum = 0;
  for (int i = 0; i < TURB_SAMPLES; i++) {
    sum += analogRead(TURB_PIN);
  }

  rawTurb = (int)(sum / TURB_SAMPLES);
  rawTurb = constrain(rawTurb, TURB_ADC_MIN, TURB_ADC_MAX);

  turbidity = map(rawTurb, TURB_ADC_MIN, TURB_ADC_MAX, 100, 0);
  turbidity = constrain(turbidity, 0, 100);
}

const char* estadoTurbidez(int turbidity) {
  if (turbidity < 20) return "Clara  ";
  if (turbidity < 50) return "Turbia ";
  return "Sucia  ";
}

const char* calidadTds(float tds_ppm) {
  if (tds_ppm < 300) return "Excelente";
  if (tds_ppm < 600) return "Buena    ";
  if (tds_ppm < 900) return "Regular  ";
  if (tds_ppm < 1200) return "Mala     ";
  return "No apta  ";
}

void processBuzzer(float tds_ppm, int turbidity) {
  if (tds_ppm > 900.0f || turbidity > 50) {
    digitalWrite(BUZZER_PIN, HIGH);
    delayMicroseconds(5000);
    digitalWrite(BUZZER_PIN, LOW);
    delayMicroseconds(100000);
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }
}

void printToMonitor(float ph_act, float tds_ppm, int turbidity, int rawTurb, const char* estadoAgua, const char* calidadAgua) {
  char levelBar[TURB_BAR_WIDTH + 3];
  buildBar(turbidity, 100, levelBar, sizeof(levelBar));

  printSeparator();
  Monitor.print("pH: ");
  Monitor.println(ph_act, 2);
  Monitor.print("TDS: ");
  Monitor.print(tds_ppm, 0);
  Monitor.println(" ppm");
  Monitor.print("Calidad: ");
  Monitor.println(calidadAgua);

  Monitor.print("Turbidez: ");
  Monitor.print(turbidity);
  Monitor.println(" %");
  Monitor.print("ADC Turb: ");
  Monitor.println(rawTurb);
  Monitor.print("Nivel: ");
  Monitor.println(levelBar);

  Monitor.print("Estado: ");
  Monitor.print(turbiditySymbol(turbidity));
  Monitor.print(" Agua ");
  Monitor.println(estadoAgua);
  printSeparator();
  Monitor.println();
}

void renderLCD(float ph_act, float tds_ppm, int turbidity, const char* estadoAgua) {
  if (millis() - tiempoUltimaPagina > INTERVALO_PAGINA) {
    tiempoUltimaPagina = millis();
    paginaLCD = (paginaLCD + 1) % 2;
    lcd.clear();
  }

  switch (paginaLCD) {
    case 0:
      lcd.setCursor(0, 0);
      lcd.print("pH:");
      lcd.print(ph_act, 2);
      lcd.print("      ");

      lcd.setCursor(0, 1);
      lcd.print("TDS:");
      lcd.print((int)tds_ppm);
      lcd.print("ppm   ");
      break;

    case 1:
      lcd.setCursor(0, 0);
      lcd.print("Turb:");
      lcd.print(turbidity);
      lcd.print("%     ");

      lcd.setCursor(0, 1);
      lcd.print(estadoAgua);
      lcd.print("      ");
      break;
  }
}

void performReadingCycle(bool emitPersisted) {
  float ph_act;
  float tds_ppm;
  int turbidity;
  int rawTurb = 0;

  readPh(ph_act);
  readTds(tds_ppm);
  readTurbidity(turbidity, rawTurb);

  const char* estadoAgua = estadoTurbidez(turbidity);
  const char* calidadAgua = calidadTds(tds_ppm);

  processBuzzer(tds_ppm, turbidity);
  printToMonitor(ph_act, tds_ppm, turbidity, rawTurb, estadoAgua, calidadAgua);
  renderLCD(ph_act, tds_ppm, turbidity, estadoAgua);

  // Vista previa local de estado en matriz mientras el backend calcula el estado canónico.
  int localStatus = 0;
  if (tds_ppm > 900.0f || turbidity > 50) {
    localStatus = 2;
  } else if (tds_ppm > 600.0f || turbidity > 20) {
    localStatus = 1;
  }
  lastMatrixStatus = localStatus;
  storeAndRenderSensorFrame(ph_act, tds_ppm, turbidity, lastMatrixStatus);

  if (emitPersisted) {
    Bridge.notify("receive_reading", ph_act, (float)turbidity, tds_ppm, -1.0f, -1.0f);
  } else {
    Bridge.notify("preview_reading", ph_act, (float)turbidity, tds_ppm, -1.0f, -1.0f);
  }
}

// Compatibilidad con backend del dashboard
void take_reading() {
  performReadingCycle(true);
}

void set_status(int status) {
  if (status < 0) {
    status = 0;
  } else if (status > 2) {
    status = 2;
  }

  lastMatrixStatus = status;
  if (status == 2) {
    // El estado critico se prioriza sobre la vista temporal de sensores.
    matrixHasSensorFrame = false;
    matrixSensorFrameUntil = 0;
  }
  refreshMatrixDisplay();
}

void set_led_state(bool state) {
  matrixIsBusy = state;
  digitalWrite(LED_BUILTIN, state ? LOW : HIGH);
  refreshMatrixDisplay();
}

void set_preview_enabled(bool enabled) {
  previewEnabled = enabled;
  Monitor.print("Preview ");
  Monitor.println(previewEnabled ? "ON" : "OFF");

  if (!previewEnabled) {
    matrixHasSensorFrame = false;
    matrixSensorFrameUntil = 0;
    refreshMatrixDisplay();
  }
}

void setup() {
  Bridge.begin();
  Monitor.begin();
  Wire.begin();

  matrix.begin();
  matrix.setGrayscaleBits(1);
  matrix.clear();
  renderMatrixBitmap(MATRIX_STARTUP);
  delay(700);

  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  pinMode(LED_BUILTIN, OUTPUT);
  set_led_state(false);

  for (int i = 0; i < SCOUNT; i++) {
    analogBuffer[i] = analogRead(TDS_PIN);
  }

  int status = lcd.begin(16, 2);
  if (status) {
    Monitor.println("Error LCD");
    while (1) {
      // bloquea para indicar error de LCD
    }
  }

  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print(" Monitor Agua ");
  lcd.setCursor(0, 1);
  lcd.print(" Iniciando... ");
  delay(2000);
  lcd.clear();

  Bridge.provide("take_reading", take_reading);
  Bridge.provide("set_status", set_status);
  Bridge.provide("set_led_state", set_led_state);
  Bridge.provide("set_preview_enabled", set_preview_enabled);

  printSeparator();
  Monitor.println("  SENSOR DE TURBIDEZ  v1.0");
  Monitor.println("  Iniciando sistema...");
  printSeparator();
  Monitor.println();

  Monitor.println("Sistema iniciado");
}

void loop() {
  sampleTdsSignal();

  if (!matrixIsBusy && matrixHasSensorFrame && millis() >= matrixSensorFrameUntil) {
    refreshMatrixDisplay();
  }

  if (previewEnabled && millis() - printTimer > 2000U) {
    printTimer = millis();
    performReadingCycle(false);
  }
}
