(function attachChatbotModule(global) {
  const WaterDashboard = global.WaterDashboard || (global.WaterDashboard = {});

  const STORAGE_KEY = 'openrouter_api_key';
  const CHAT_ENDPOINT = '/chat';

  // Historial de mensajes
  let messages = [];
  let isLoading = false;

  // Elementos del DOM (inicializados en init)
  let messagesContainer = null;
  let inputField = null;
  let sendButton = null;
  let sendText = null;
  let sendSpinner = null;
  let configPanel = null;
  let configToggle = null;
  let apiKeyInput = null;
  let saveKeyButton = null;
  let clearKeyButton = null;
  let configStatus = null;
  let configStatusText = null;
  let storageUnavailableLogged = false;
  let backendConfigured = false;

  /**
  * Obtiene clave API de localStorage
   */
  function getApiKey() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      if (!storageUnavailableLogged) {
        console.warn('[Chatbot] localStorage no disponible; se usará solo la API key del backend si está configurada.');
        storageUnavailableLogged = true;
      }
      return null;
    }
  }

  /**
  * Guarda clave API en localStorage
   */
  function saveApiKey(key) {
    try {
      if (key && key.trim()) {
        localStorage.setItem(STORAGE_KEY, key.trim());
        return true;
      }
      return false;
    } catch (error) {
      if (!storageUnavailableLogged) {
        console.warn('[Chatbot] localStorage no disponible; no se puede guardar la clave local.');
        storageUnavailableLogged = true;
      }
      return false;
    }
  }

  /**
  * Limpia clave API de localStorage
   */
  function clearApiKey() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      if (!storageUnavailableLogged) {
        console.warn('[Chatbot] localStorage no disponible; no se puede limpiar la clave local.');
        storageUnavailableLogged = true;
      }
    }
  }

  /**
  * Muestra un mensaje de error en el chat con diseño mejorado
   */
  function displayError(message) {
    const errorWrapper = document.createElement('div');
    errorWrapper.className = 'flex justify-center my-2 opacity-0 transition-opacity duration-300';
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'rounded-xl border-2 border-red-200 bg-red-50 p-3.5 text-sm text-red-800 max-w-[85%] shadow-sm';
    errorDiv.innerHTML = `
      <div class="flex items-start gap-2.5">
        <i data-lucide="alert-circle" class="w-4 h-4 shrink-0 mt-0.5 text-red-600"></i>
        <div class="flex-1">
          <p class="font-semibold text-red-900">Error</p>
          <p class="text-xs mt-1 leading-relaxed">${escapeHtml(message)}</p>
        </div>
      </div>
    `;
    
    errorWrapper.appendChild(errorDiv);
    messagesContainer.appendChild(errorWrapper);
    
    // Activar animación
    requestAnimationFrame(() => {
      errorWrapper.classList.remove('opacity-0');
      errorWrapper.classList.add('opacity-100');
    });
    
    if (global.lucide) global.lucide.createIcons();
    scrollToBottom();
  }

  /**
  * Escapa HTML para prevenir XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
  * Agrega un mensaje a la UI con diseño mejorado
   */
  function addMessageToUI(role, content) {
    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'message-wrapper opacity-0 translate-y-2 transition-all duration-300';
    
    const messageDiv = document.createElement('div');
    messageDiv.className = role === 'user' 
      ? 'flex justify-end gap-2.5 items-end' 
      : 'flex justify-start gap-2.5 items-end';

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = role === 'user'
      ? 'flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center text-primary-foreground text-xs font-semibold shadow-sm order-2'
      : 'flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center text-white text-xs font-semibold shadow-sm';
    
    avatar.innerHTML = role === 'user' 
      ? '<i data-lucide="user" class="w-4 h-4"></i>'
      : '<i data-lucide="bot" class="w-4 h-4"></i>';

    // Burbuja del mensaje
    const bubble = document.createElement('div');
    bubble.className = role === 'user'
      ? 'rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-3 max-w-[75%] shadow-sm order-1'
      : 'rounded-2xl rounded-bl-md bg-white border border-border text-foreground px-4 py-3 max-w-[75%] shadow-sm';
    
    // Contenido con mejor tipografía
    const contentDiv = document.createElement('div');
    contentDiv.className = 'text-sm leading-relaxed whitespace-pre-wrap break-words';
    contentDiv.textContent = content;
    
    // Marca de tiempo
    const timestamp = document.createElement('div');
    timestamp.className = role === 'user'
      ? 'text-[10px] text-primary-foreground/70 mt-1.5 font-medium'
      : 'text-[10px] text-muted-foreground mt-1.5 font-medium';
    timestamp.textContent = new Date().toLocaleTimeString('es-PA', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    bubble.appendChild(contentDiv);
    bubble.appendChild(timestamp);
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(bubble);
    messageWrapper.appendChild(messageDiv);
    messagesContainer.appendChild(messageWrapper);
    
    // Activar animación
    requestAnimationFrame(() => {
      messageWrapper.classList.remove('opacity-0', 'translate-y-2');
      messageWrapper.classList.add('opacity-100', 'translate-y-0');
    });
    
    // Volver a renderizar íconos de Lucide
    if (global.lucide) global.lucide.createIcons();
    
    scrollToBottom();
  }

  /**
  * Desplaza el contenedor de mensajes hasta abajo con animación suave
   */
  function scrollToBottom() {
    if (messagesContainer) {
      messagesContainer.scrollTo({
        top: messagesContainer.scrollHeight,
        behavior: 'smooth'
      });
    }
  }

  /**
  * Muestra el indicador de escritura
   */
  function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.id = 'typing-indicator';
    typingDiv.className = 'flex justify-start gap-2.5 items-end opacity-0 transition-opacity duration-300';
    
    const avatar = document.createElement('div');
    avatar.className = 'flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center text-white text-xs font-semibold shadow-sm';
    avatar.innerHTML = '<i data-lucide="bot" class="w-4 h-4"></i>';
    
    const bubble = document.createElement('div');
    bubble.className = 'rounded-2xl rounded-bl-md bg-white border border-border px-4 py-3 shadow-sm';
    bubble.innerHTML = `
      <div class="flex items-center gap-1.5">
        <div class="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style="animation-delay: 0ms"></div>
        <div class="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style="animation-delay: 150ms"></div>
        <div class="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style="animation-delay: 300ms"></div>
      </div>
    `;
    
    typingDiv.appendChild(avatar);
    typingDiv.appendChild(bubble);
    messagesContainer.appendChild(typingDiv);
    
    // Activar animación
    requestAnimationFrame(() => {
      typingDiv.classList.remove('opacity-0');
      typingDiv.classList.add('opacity-100');
    });
    
    if (global.lucide) global.lucide.createIcons();
    scrollToBottom();
  }

  /**
  * Oculta el indicador de escritura
   */
  function hideTypingIndicator() {
    const typingDiv = document.getElementById('typing-indicator');
    if (typingDiv) {
      typingDiv.classList.add('opacity-0');
      setTimeout(() => typingDiv.remove(), 300);
    }
  }

  /**
  * Limpia el mensaje de bienvenida
   */
  function clearWelcomeMessage() {
    const welcome = messagesContainer.querySelector('.text-center');
    if (welcome) {
      welcome.remove();
    }
  }

  /**
  * Establece el estado de carga
   */
  function setLoading(loading) {
    isLoading = loading;
    if (sendButton) {
      sendButton.disabled = loading;
    }
    if (sendText && sendSpinner) {
      if (loading) {
        sendText.classList.add('hidden');
        sendSpinner.classList.remove('hidden');
        sendSpinner.classList.add('flex');
      } else {
        sendText.classList.remove('hidden');
        sendText.classList.add('flex');
        sendSpinner.classList.add('hidden');
        sendSpinner.classList.remove('flex');
      }
    }
    if (inputField) {
      inputField.disabled = loading;
    }
  }

  /**
  * Envía un mensaje a la API del chatbot
   */
  async function sendMessage(userMessage) {
    if (isLoading) {
      return;
    }

    if (!userMessage || !userMessage.trim()) {
      return;
    }

    const apiKey = getApiKey();

    // Limpiar mensaje de bienvenida en la primera interacción
    clearWelcomeMessage();

    // Agregar mensaje del usuario a la UI
    addMessageToUI('user', userMessage);
    messages.push({ role: 'user', content: userMessage });

    // Limpiar campo de entrada
    if (inputField) {
      inputField.value = '';
    }

    // Establecer estado de carga y mostrar indicador de escritura
    setLoading(true);
    showTypingIndicator();

    try {
      const parseJsonSafe = async (resp) => {
        try {
          return await resp.json();
        } catch {
          return {};
        }
      };

      // Llama al endpoint backend /chat
      let response = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: userMessage,
          api_key: apiKey || '',
        }),
      });

      let data = await parseJsonSafe(response);

      // Compatibilidad: algunos runtimes validan prompt por query y responden 422.
      if (response.status === 422) {
        const compatEndpoint = `${CHAT_ENDPOINT}?prompt=${encodeURIComponent(userMessage)}`;
        response = await fetch(compatEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: apiKey || '',
          }),
        });
        data = await parseJsonSafe(response);
      }

      // Ocultar indicador de escritura
      hideTypingIndicator();

      if (!response.ok || !data.ok) {
        let backendError = '';

        if (typeof data.error === 'string' && data.error.trim()) {
          backendError = data.error.trim();
        } else if (typeof data.detail === 'string' && data.detail.trim()) {
          backendError = data.detail.trim();
        } else if (Array.isArray(data.detail) && data.detail.length > 0) {
          const firstDetail = data.detail[0];
          if (typeof firstDetail === 'string') {
            backendError = firstDetail;
          } else if (firstDetail && typeof firstDetail.msg === 'string') {
            backendError = firstDetail.msg;
          }
        }

        throw new Error(backendError || `HTTP ${response.status}`);
      }

      // Agregar respuesta del asistente a la UI
      const assistantMessage = data.reply || 'Sin respuesta';
      addMessageToUI('assistant', assistantMessage);
      messages.push({ role: 'assistant', content: assistantMessage });

    } catch (error) {
      console.error('[Chatbot] Error sending message:', error);
      
      // Ocultar indicador de escritura en error
      hideTypingIndicator();
      
      let errorMessage = 'No se pudo enviar el mensaje. ';
      
      if (error.message.includes('Falta API Key')) {
        errorMessage += 'Configura OPENROUTER_API_KEY en python/.env o guarda una clave en Configurar.';
      } else if (error.message.includes('401') || error.message.includes('API key')) {
        errorMessage += 'Verifica tu API Key.';
      } else if (error.message.includes('429')) {
        errorMessage += 'Límite de tasa excedido. Espera un momento.';
      } else if (error.message.includes('fetch')) {
        errorMessage += 'Error de conexión.';
      } else {
        errorMessage += error.message;
      }
      
      displayError(errorMessage);
    } finally {
      setLoading(false);
    }
  }

  /**
  * Actualiza el indicador de estado de configuración
   */
  function updateConfigStatus() {
    const hasLocalKey = Boolean(getApiKey());
    
    if (configStatus && configStatusText) {
      if (hasLocalKey) {
        configStatus.className = 'flex items-center gap-1.5 text-xs text-green-600';
        configStatusText.textContent = 'Clave local guardada';
      } else if (backendConfigured) {
        configStatus.className = 'flex items-center gap-1.5 text-xs text-teal-600';
        configStatusText.textContent = 'Usando clave del backend (.env)';
      } else {
        configStatus.className = 'flex items-center gap-1.5 text-xs text-muted-foreground';
        configStatusText.textContent = 'Sin clave local ni backend';
      }
      
      // Volver a renderizar íconos de Lucide
      if (global.lucide) global.lucide.createIcons();
    }
  }

  /**
  * Alterna el panel de configuración
   */
  function toggleConfigPanel() {
    if (configPanel) {
      const isHidden = configPanel.classList.contains('hidden');
      if (isHidden) {
        configPanel.classList.remove('hidden');
        // Cargar clave API actual (enmascarada)
        const currentKey = getApiKey();
        if (currentKey && apiKeyInput) {
          apiKeyInput.value = currentKey;
        }
        // Actualizar estado al abrir
        updateConfigStatus();
      } else {
        configPanel.classList.add('hidden');
      }
    }
  }

  /**
  * Guarda clave API desde el campo de entrada
   */
  function handleSaveApiKey() {
    if (apiKeyInput) {
      const key = apiKeyInput.value.trim();
      if (key) {
        if (saveApiKey(key)) {
          // Actualizar indicador de estado
          updateConfigStatus();
          
          // Mostrar confirmación de éxito
          const originalText = saveKeyButton.innerHTML;
          saveKeyButton.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i> Guardado';
          if (global.lucide) global.lucide.createIcons();
          
          setTimeout(() => {
            saveKeyButton.innerHTML = originalText;
            if (global.lucide) global.lucide.createIcons();
            configPanel.classList.add('hidden');
          }, 1500);
        } else {
          displayError('No se pudo guardar la API Key');
        }
      } else {
        displayError('Por favor ingresa una API Key válida');
      }
    }
  }

  /**
  * Limpia clave API del almacenamiento
   */
  function handleClearApiKey() {
    clearApiKey();
    
    // Limpiar campo de entrada
    if (apiKeyInput) {
      apiKeyInput.value = '';
    }
    
    // Actualizar indicador de estado
    updateConfigStatus();
    
    // Mostrar confirmación de éxito
    const originalText = clearKeyButton.innerHTML;
    clearKeyButton.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i> Limpiado';
    if (global.lucide) global.lucide.createIcons();
    
    setTimeout(() => {
      clearKeyButton.innerHTML = originalText;
      if (global.lucide) global.lucide.createIcons();
    }, 1500);
  }

  /**
  * Maneja el clic del botón enviar
   */
  function handleSendClick() {
    if (inputField && !isLoading) {
      const message = inputField.value.trim();
      if (message) {
        sendMessage(message);
      }
    }
  }

  /**
  * Maneja la tecla Enter en el campo de entrada
   */
  function handleInputKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey && !isLoading) {
      event.preventDefault();
      handleSendClick();
    }
  }

  /**
  * Inicializa el módulo del chatbot
   */
  WaterDashboard.initChatbot = function initChatbot(options = {}) {
    backendConfigured = Boolean(options.backendConfigured);

    // Obtener elementos del DOM
    messagesContainer = document.getElementById('chatbot-messages');
    inputField = document.getElementById('chatbot-input');
    sendButton = document.getElementById('chatbot-send');
    sendText = document.getElementById('chatbot-send-text');
    sendSpinner = document.getElementById('chatbot-send-spinner');
    configPanel = document.getElementById('chatbot-config-panel');
    configToggle = document.getElementById('chatbot-config-toggle');
    apiKeyInput = document.getElementById('chatbot-api-key-input');
    saveKeyButton = document.getElementById('chatbot-save-key');
    clearKeyButton = document.getElementById('chatbot-clear-key');
    configStatus = document.getElementById('chatbot-config-status');
    configStatusText = document.getElementById('chatbot-config-status-text');

    if (!messagesContainer || !inputField || !sendButton) {
      console.error('[Chatbot] Required DOM elements not found');
      return;
    }

    // Vincular listeners de eventos
    sendButton.addEventListener('click', handleSendClick);
    inputField.addEventListener('keypress', handleInputKeyPress);
    
    if (configToggle) {
      configToggle.addEventListener('click', toggleConfigPanel);
    }
    
    if (saveKeyButton) {
      saveKeyButton.addEventListener('click', handleSaveApiKey);
    }
    
    if (clearKeyButton) {
      clearKeyButton.addEventListener('click', handleClearApiKey);
    }

    // Vincular manejadores de botones de preguntas rápidas
    const quickButtons = messagesContainer.querySelectorAll('.quick-question');
    quickButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const quickMessage = btn.textContent.trim();
        if (inputField) inputField.value = quickMessage;
        sendMessage(quickMessage);
      });
    });

    // Inicializar indicador de estado
    updateConfigStatus();

    console.log('[Chatbot] Initialized successfully');
  };

  /**
  * Limpia el historial de conversación
   */
  WaterDashboard.clearChatHistory = function clearChatHistory() {
    messages = [];
    if (messagesContainer) {
      messagesContainer.innerHTML = `
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
      `;
      if (global.lucide) global.lucide.createIcons();
      
      // Agregar manejadores de clic para preguntas rápidas
      const quickButtons = messagesContainer.querySelectorAll('.quick-question');
      quickButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const quickMessage = btn.textContent.trim();
          if (inputField) inputField.value = quickMessage;
          sendMessage(quickMessage);
        });
      });
    }
  };

  /**
  * Obtiene el estado actual de la clave API (para depuración)
   */
  WaterDashboard.getChatbotStatus = function getChatbotStatus() {
    return {
      hasApiKey: Boolean(getApiKey()),
      messageCount: messages.length,
      isLoading: isLoading,
    };
  };

}(window));
