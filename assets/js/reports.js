/**
 * Módulo de reportes
 * Genera reportes PDF y gestiona el envío de correos
 */
(function attachReportsModule(global) {
  const WaterDashboard = global.WaterDashboard || (global.WaterDashboard = {});

  /**
   * Genera reporte PDF con los datos actuales
   */
  async function generatePDFReport(data) {
    try {
      if (!window.jspdf || typeof window.jspdf.jsPDF !== 'function') {
        throw new Error('La librería jsPDF no está disponible en el navegador.');
      }
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      
      // Encabezado
      doc.setFontSize(20);
      doc.setTextColor(15, 118, 110);
      doc.text('Reporte de Calidad del Agua', 20, 20);
      
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Generado: ${new Date().toLocaleString('es-PA')}`, 20, 28);
      
      // Información de ubicación
      doc.setFontSize(14);
      doc.setTextColor(0);
      doc.text(`Ubicación: ${data.locationName}`, 20, 40);
      
      // Dibujar línea
      doc.setDrawColor(200);
      doc.line(20, 45, 190, 45);
      
      // Sección de lecturas actuales
      doc.setFontSize(16);
      doc.setTextColor(15, 118, 110);
      doc.text('Lecturas Actuales', 20, 55);
      
      let yPos = 65;
      
      // pH
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.text('pH:', 20, yPos);
      doc.setFont(undefined, 'bold');
      doc.text(data.ph !== null ? data.ph.toFixed(2) : 'N/A', 50, yPos);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text('(Rango seguro: 6.5 - 8.5)', 70, yPos);
      yPos += 10;
      
      // Turbidez
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.text('Turbidez:', 20, yPos);
      doc.setFont(undefined, 'bold');
      doc.text(data.ntu !== null ? `${data.ntu.toFixed(1)} NTU` : 'N/A', 50, yPos);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text('(Seguro: < 1 NTU)', 80, yPos);
      yPos += 10;

      // TDS
      if (data.tds !== null) {
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.text('TDS:', 20, yPos);
        doc.setFont(undefined, 'bold');
        doc.text(`${data.tds.toFixed(0)} ppm`, 50, yPos);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text('(Seguro: < 600 ppm)', 80, yPos);
        yPos += 10;
      }
      
      // Estado
      yPos += 5;
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.text('Estado del Agua:', 20, yPos);
      doc.setFont(undefined, 'bold');
      
      // Color según el estado
      if (data.status === 0) {
        doc.setTextColor(34, 197, 94); // Verde
        doc.text('APTA', 60, yPos);
      } else if (data.status === 1) {
        doc.setTextColor(234, 179, 8); // Amarillo
        doc.text('TOLERABLE', 60, yPos);
      } else {
        doc.setTextColor(239, 68, 68); // Rojo
        doc.text('NO APTA', 60, yPos);
      }
      
      doc.setFont(undefined, 'normal');
      yPos += 15;
      
      // Dibujar línea
      doc.setDrawColor(200);
      doc.line(20, yPos, 190, yPos);
      yPos += 10;
      
      // Sección de interpretación
      doc.setFontSize(16);
      doc.setTextColor(15, 118, 110);
      doc.text('Interpretación', 20, yPos);
      yPos += 10;
      
      doc.setFontSize(10);
      doc.setTextColor(0);
      
      const interpretation = getInterpretation(data);
      const splitText = doc.splitTextToSize(interpretation, 170);
      doc.text(splitText, 20, yPos);
      yPos += splitText.length * 5 + 10;
      
      // Recomendaciones
      if (data.status !== 0) {
        doc.setFontSize(14);
        doc.setTextColor(239, 68, 68);
        doc.text('⚠ Recomendaciones', 20, yPos);
        yPos += 8;
        
        doc.setFontSize(10);
        doc.setTextColor(0);
        const recommendations = getRecommendations(data);
        const splitRec = doc.splitTextToSize(recommendations, 170);
        doc.text(splitRec, 20, yPos);
      }
      
      // Pie de página
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text('HydroLabs - Sistema de Monitoreo de Calidad del Agua (Panamá)', 20, 280);
      doc.text('Este reporte es generado automáticamente por el sistema IoT', 20, 285);
      
      return doc;
    } catch (error) {
      console.error('[Reports] Error generating PDF:', error);
      throw error;
    }
  }

  /**
    * Obtiene el texto de interpretación según las lecturas
   */
  function getInterpretation(data) {
    if (data.status === 0) {
      return 'El agua analizada cumple con todos los parámetros de calidad establecidos por la OMS. ' +
             'Los niveles de pH y turbidez se encuentran dentro de los rangos seguros para consumo humano. ' +
             'No se requieren acciones correctivas en este momento.';
    } else if (data.status === 1) {
      return 'El agua presenta valores que, aunque tolerables, requieren monitoreo continuo. ' +
             'Se recomienda realizar análisis adicionales y considerar tratamiento preventivo. ' +
             'Los parámetros están cerca de los límites aceptables.';
    } else {
      return 'ALERTA: El agua NO es apta para consumo humano. Los parámetros medidos exceden los límites ' +
             'seguros establecidos por las normas internacionales. Se requiere acción inmediata para ' +
             'identificar la fuente de contaminación y aplicar tratamiento correctivo.';
    }
  }

  /**
    * Obtiene recomendaciones según las lecturas
   */
  function getRecommendations(data) {
    const recs = [];
    
    if (data.ph !== null && (data.ph < 6.5 || data.ph > 8.5)) {
      if (data.ph < 6.5) {
        recs.push('• pH ácido detectado: Considerar neutralización con carbonato de calcio o hidróxido de sodio.');
      } else {
        recs.push('• pH alcalino detectado: Considerar acidificación controlada o dilución.');
      }
    }
    
    if (data.ntu !== null && data.ntu > 1) {
      recs.push('• Turbidez elevada: Implementar filtración (arena, carbón activado) antes del consumo.');
      recs.push('• Realizar análisis microbiológico para descartar contaminación bacteriana.');
    }

    if (data.tds !== null && data.tds > 600) {
      recs.push('• TDS elevado: Revisar mineralización y posibles sales disueltas en la fuente.');
      if (data.tds > 900) {
        recs.push('• TDS crítico: Considerar ósmosis inversa o tratamiento especializado antes de consumo.');
      }
    }
    
    if (recs.length === 0) {
      recs.push('• Continuar con monitoreo regular de los parámetros.');
    }
    
    recs.push('• Documentar todas las lecturas y mantener registro histórico.');
    recs.push('• Notificar a las autoridades competentes si la situación persiste.');
    
    return recs.join('\n');
  }

  /**
    * Descarga el reporte PDF
   */
  async function downloadReport(data) {
    try {
      const doc = await generatePDFReport(data);
      const filename = `reporte-agua-${data.location}-${Date.now()}.pdf`;
      doc.save(filename);
      
      console.log('[Reports] PDF downloaded:', filename);
      return { ok: true, filename };
    } catch (error) {
      console.error('[Reports] Error downloading report:', error);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Envía el reporte por correo (requiere endpoint de backend)
   */
  async function emailReport(data, emailAddress) {
    try {
      // Generar PDF en base64
      const doc = await generatePDFReport(data);
      const pdfBase64 = doc.output('datauristring').split(',')[1];
      
      // Enviar al backend
      const response = await fetch('/send_report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: emailAddress,
          location: data.locationName,
          pdf_data: pdfBase64,
          subject: `Reporte de Calidad del Agua - ${data.locationName}`,
        }),
      });

      let result = {};
      try {
        result = await response.json();
      } catch {
        result = {};
      }

      if (!response.ok) {
        const detail = (result && (result.error || result.detail || result.message))
          || `Error HTTP ${response.status} al enviar correo`;
        throw new Error(detail);
      }
      
      if (result.ok) {
        console.log('[Reports] Email sent successfully');
        return { ok: true };
      } else {
        throw new Error(result.error || 'Error sending email');
      }
    } catch (error) {
      console.error('[Reports] Error sending email:', error);
      return { ok: false, error: error.message };
    }
  }

  /**
    * Muestra el diálogo de reporte
   */
  function showReportDialog(currentData, options = {}) {
    const emailEnabled = options.emailEnabled !== false;

    const dialog = document.createElement('div');
    dialog.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
    dialog.innerHTML = `
      <div class="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        <div class="bg-primary/10 px-6 py-4 border-b border-border">
          <h3 class="text-lg font-bold text-foreground flex items-center gap-2">
            <i data-lucide="file-text" class="w-5 h-5 text-primary"></i>
            Generar Reporte
          </h3>
        </div>
        <div class="p-6 space-y-4">
          <div class="bg-muted/50 rounded-lg p-4">
            <p class="text-sm text-muted-foreground mb-2">Ubicación:</p>
            <p class="font-semibold text-foreground">${currentData.locationName}</p>
          </div>
          
          <div class="space-y-3">
            <button id="download-pdf-btn" class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-xl text-sm font-semibold hover:bg-primary/90 transition-colors">
              <i data-lucide="download" class="w-4 h-4"></i>
              Descargar PDF
            </button>
            
            <div class="relative">
              <div class="absolute inset-0 flex items-center">
                <div class="w-full border-t border-border"></div>
              </div>
              <div class="relative flex justify-center text-xs">
                <span class="bg-card px-2 text-muted-foreground">o</span>
              </div>
            </div>
            
            <div class="space-y-2">
              <input 
                type="email" 
                id="email-input" 
                placeholder="correo@ejemplo.com" 
                ${emailEnabled ? '' : 'disabled'}
                class="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              />
              <button id="email-pdf-btn" ${emailEnabled ? '' : 'disabled'} class="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-secondary text-secondary-foreground rounded-xl text-sm font-semibold hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                <i data-lucide="mail" class="w-4 h-4"></i>
                Enviar por Correo
              </button>
              <p id="email-report-note" class="text-xs text-muted-foreground">${emailEnabled ? 'Resend configurado. El reporte se enviará al correo indicado.' : 'Correo deshabilitado: configura RESEND_API_KEY y RESEND_FROM en .env.'}</p>
            </div>
          </div>
        </div>
        <div class="px-6 py-4 bg-muted/30 border-t border-border flex justify-end">
          <button id="close-dialog-btn" class="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Cerrar
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // Volver a renderizar íconos
    if (global.lucide) global.lucide.createIcons();
    
    // Eventos
    document.getElementById('download-pdf-btn').addEventListener('click', async () => {
      const btn = document.getElementById('download-pdf-btn');
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Generando...';
      
      const result = await downloadReport(currentData);
      
      if (result.ok) {
        btn.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i> Descargado';
        setTimeout(() => dialog.remove(), 1500);
      } else {
        btn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i> Error';
        btn.disabled = false;
        setTimeout(() => {
          btn.innerHTML = '<i data-lucide="download" class="w-4 h-4"></i> Descargar PDF';
          if (global.lucide) global.lucide.createIcons();
        }, 2000);
      }
      
      if (global.lucide) global.lucide.createIcons();
    });
    
    document.getElementById('email-pdf-btn').addEventListener('click', async () => {
      if (!emailEnabled) {
        return;
      }

      const emailInput = document.getElementById('email-input');
      const email = emailInput.value.trim();
      
      if (!email || !email.includes('@')) {
        emailInput.classList.add('border-red-500');
        return;
      }
      
      const btn = document.getElementById('email-pdf-btn');
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Enviando...';
      
      const result = await emailReport(currentData, email);
      
      if (result.ok) {
        btn.innerHTML = '<i data-lucide="check" class="w-4 h-4"></i> Enviado';
        setTimeout(() => dialog.remove(), 1500);
      } else {
        btn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i> Error: ' + result.error;
        btn.disabled = false;
        setTimeout(() => {
          btn.innerHTML = '<i data-lucide="mail" class="w-4 h-4"></i> Enviar por Correo';
          if (global.lucide) global.lucide.createIcons();
        }, 3000);
      }
      
      if (global.lucide) global.lucide.createIcons();
    });
    
    document.getElementById('close-dialog-btn').addEventListener('click', () => {
      dialog.remove();
    });
    
    // Cerrar al hacer clic en el fondo
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        dialog.remove();
      }
    });
  }

  // Exponer funciones
  WaterDashboard.generatePDFReport = generatePDFReport;
  WaterDashboard.downloadReport = downloadReport;
  WaterDashboard.emailReport = emailReport;
  WaterDashboard.showReportDialog = showReportDialog;

}(window));
