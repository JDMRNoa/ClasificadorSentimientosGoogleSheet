// ============================================================
//  ALEGRA FEEDBACK SYSTEM — Google Apps Script
//  Autor: Jesús Mantilla (NOA) — Prueba técnica Alegra 2025
//  Versión: 1.0
// ============================================================
//
//  INSTALACIÓN:
//  1. Abre tu Google Sheet (la hoja debe llamarse "Feedback")
//  2. Ve a Extensiones → Apps Script
//  3. Pega TODO este archivo
//  4. Reemplazar GEMINI_API_KEY con tu clave de aistudio.google.com
//  5. Guarda (Ctrl+S)
//  6. Ejecuta setupTrigger() UNA VEZ para activar la clasificación automática
//  7. Publica como Web App para obtener la URL del webhook (ver SECCIÓN 3)
// ============================================================

// ──────────────────────────────────────────────
// CONFIGURACIÓN — edita solo esta sección
// ──────────────────────────────────────────────
const CONFIG = {
  GEMINI_API_KEY: 'AIzaSyBqywwBr2YQQ0XwMEvdcWAaGhY2whTNSIo',       
  SHEET_NAME: 'Feedback',
  COL: {
    TIMESTAMP: 1,     // A
    PRODUCTO: 2,      // B
    COMENTARIO: 3,    // C
    NOMBRE: 4,        // D
    SENTIMIENTO: 5,   // E
    RESUMEN: 6        // F
  },
  GEMINI_MODEL: 'gemini-2.5-flash-lite',
  MAX_RETRIES: 2
};


// ============================================================
//  SECCIÓN 1 — WEBHOOK: recibe datos desde la interfaz web
// ============================================================

/**
 * Endpoint POST — la interfaz HTML envía datos aquí.
 * Para activar: Implementar > Nueva implementación > Web App
 *   - Ejecutar como: Yo
 *   - Quién tiene acceso: Cualquier persona
 * Copia la URL generada y pégala en feedback-form.html → SCRIPT_URL
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('No se recibieron datos en la petición (postData vacío).');
    }
    const data = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) throw new Error('Hoja "' + CONFIG.SHEET_NAME + '" no encontrada.');

    const timestamp = data.timestamp || new Date().toLocaleString('es-CO');
    const producto  = data.producto  || '';
    const comentario = data.comentario || '';
    const nombre    = data.nombre    || 'Anónimo';

    sheet.appendRow([timestamp, producto, comentario, nombre, '', '']);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', message: 'Feedback registrado.' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * GET simple — prueba que el webhook esté activo.
 */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Alegra Feedback API activa.' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
//  SECCIÓN 2 — CLASIFICACIÓN AUTOMÁTICA CON GEMINI
// ============================================================

/**
 * Clasifica TODAS las filas que aún no tienen sentimiento.
 * Se ejecuta automáticamente cada 5 minutos (ver setupTrigger).
 * También puedes ejecutarla manualmente desde el editor.
 */
function clasificarPendientes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    const errorMsg = 'ERROR: No se encontró la hoja "' + CONFIG.SHEET_NAME + '".';
    Logger.log(errorMsg);
    SpreadsheetApp.getUi().alert(errorMsg);
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('No hay datos nuevos para clasificar (solo está el encabezado).');
    return;
  }

  let clasificados = 0;
  let errores = 0;
  let saltados = 0;

  // Informar al usuario que empezamos
  Logger.log('Iniciando clasificación. Filas a revisar: ' + (lastRow - 1));

  for (let row = 2; row <= lastRow; row++) {
    const comentario = sheet.getRange(row, CONFIG.COL.COMENTARIO).getValue();
    const sentimientoVal = sheet.getRange(row, CONFIG.COL.SENTIMIENTO).getValue();
    const sentimientoStr = sentimientoVal ? sentimientoVal.toString().trim() : "";

    // Saltar si ya está clasificado o no hay comentario
    // Se procesa si está vacía o si contiene un mensaje de "Error" anterior
    if (!comentario || (sentimientoStr !== "" && !sentimientoStr.startsWith("Error"))) {
      saltados++;
      continue;
    }

    try {
      Logger.log('Procesando fila ' + row + '...');
      const resultado = analizarConGemini(comentario.toString());

      sheet.getRange(row, CONFIG.COL.SENTIMIENTO).setValue(resultado.sentimiento);
      sheet.getRange(row, CONFIG.COL.RESUMEN).setValue(resultado.resumen);

      // Colorear la celda de sentimiento
      colorearSentimiento(sheet, row, resultado.sentimiento);

      clasificados++;
      Utilities.sleep(20000); // Pausa de 4.5 seg para no superar el límite de 15 RPM (Plan Gratuito)

    } catch (err) {
      errores++;
      const msgError = err.message.substring(0, 60);
      Logger.log('ERROR en fila ' + row + ': ' + err.message);
      sheet.getRange(row, CONFIG.COL.SENTIMIENTO)
        .setValue('Error: ' + msgError)
        .setBackground('#f8d7da');
    }
  }

  const resumenBody = '✅ Procesados: ' + clasificados + 
                    '\n❌ Errores: ' + errores + 
                    '\n⏭️ Saltados (ya tenían datos): ' + saltados;
  
  Logger.log(resumenBody);
  SpreadsheetApp.getUi().alert('Proceso finalizado\n\n' + resumenBody);
}

/**
 * Llama a la API de Gemini para analizar un comentario.
 * Retorna { sentimiento: string, resumen: string }
 */
function analizarConGemini(comentario) {
  const systemPrompt = `Eres un experto en experiencia de cliente. Tu tarea es analizar feedback de usuarios de Alegra.
  
Responde ESTRICTAMENTE en este formato:
SENTIMIENTO | RESUMEN

Instrucciones para el RESUMEN:
- NO uses frases genéricas como "El usuario dice que..." o "El cliente está...".
- Ve directo al grano: ¿Qué le gusta o qué le duele específicamente? (Ej: "La app es lenta al cargar" o "Excelente soporte técnico").
- Debe ser una frase en español, máximo 15 palabras.

Valores de SENTIMIENTO: Positivo, Neutro o Negativo.`;

  const userPrompt = `Analiza este comentario: "${comentario.replace(/"/g, '\\"')}"`;

  const model = CONFIG.GEMINI_MODEL.trim();
  const apiKey = CONFIG.GEMINI_API_KEY.trim();
  
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              model + ':generateContent?key=' + apiKey;

  const options = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      system_instruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 300
      }
    }),
    muteHttpExceptions: true
  };

  let lastError;
  for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();
      const responseText = response.getContentText();

      if (code !== 200) {
        throw new Error('HTTP ' + code + (code === 403 ? ': API Key inválida o restringida' : ''));
      }

      const json = JSON.parse(responseText);
      
      if (!json.candidates || !json.candidates[0].content || !json.candidates[0].content.parts) {
        throw new Error('La IA no devolvió contenido.');
      }

      const textoRaw = json.candidates[0].content.parts[0].text.trim();
      
      // PARSEO DE TEXTO SIMPLE (SENTIMIENTO | RESUMEN)
      const partes = textoRaw.split('|');
      let sentimiento = 'Neutro';
      let resumen = textoRaw;

      if (partes.length >= 2) {
        sentimiento = partes[0].trim();
        resumen = partes.slice(1).join('|').trim();
      } else {
        // Si no hay separador, intentamos buscar las palabras clave
        if (textoRaw.toLowerCase().includes('positivo')) sentimiento = 'Positivo';
        else if (textoRaw.toLowerCase().includes('negativo')) sentimiento = 'Negativo';
      }

      // Validar sentimiento
      const validos = ['Positivo', 'Neutro', 'Negativo'];
      if (!validos.includes(sentimiento)) {
        sentimiento = 'Neutro';
      }

      return { sentimiento: sentimiento, resumen: resumen };

    } catch (err) {
      lastError = err;
      if (attempt < CONFIG.MAX_RETRIES) Utilities.sleep(25000 * (attempt + 1));
    }
  }

  throw lastError;
}

/**
 * Colorea la celda E según el sentimiento para visual rápida en el Sheet.
 */
function colorearSentimiento(sheet, row, sentimiento) {
  const cell = sheet.getRange(row, CONFIG.COL.SENTIMIENTO);
  switch (sentimiento) {
    case 'Positivo':
      cell.setBackground('#d4edda').setFontColor('#155724');
      break;
    case 'Negativo':
      cell.setBackground('#f8d7da').setFontColor('#721c24');
      break;
    case 'Neutro':
      cell.setBackground('#fff3cd').setFontColor('#856404');
      break;
    default:
      cell.setBackground('#e2e3e5').setFontColor('#383d41');
  }
}


// ============================================================
//  SECCIÓN 3 — TRIGGERS Y SETUP
// ============================================================

/**
 * Ejecuta esto UNA VEZ para configurar la clasificación automática.
 * Crea un trigger que ejecuta clasificarPendientes() cada 5 minutos.
 */
function setupTrigger() {
  // Eliminar triggers previos del mismo nombre para evitar duplicados
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'clasificarPendientes') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Crear nuevo trigger cada 5 minutos
  ScriptApp.newTrigger('clasificarPendientes')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('Trigger creado: clasificarPendientes se ejecutará cada 5 minutos.');
  SpreadsheetApp.getUi().alert('✓ Trigger activado. La clasificación automática correrá cada 5 minutos.');
}

/**
 * Clasifica manualmente las filas seleccionadas o todas las pendientes.
 * Útil para testing sin esperar el trigger.
 */
function clasificarManual() {
  clasificarPendientes();
  SpreadsheetApp.getUi().alert('Clasificación completada. Revisa el log para detalles (Ver > Registros).');
}

/**
 * Inicializa la hoja con encabezados si está vacía.
 * Ejecuta esto si tu hoja es nueva.
 */
function inicializarHoja() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    Logger.log('Hoja "' + CONFIG.SHEET_NAME + '" creada.');
  }

  const headers = [
    'Marca de Tiempo',
    'Producto',
    'Comentario',
    'Nombre del Usuario',
    'Categoría de Sentimiento',
    'Resumen IA (Plus)'
  ];

  const headerRange = sheet.getRange(1, 1, 1, headers.length);

  // Solo insertar headers si la fila 1 está vacía
  if (!sheet.getRange(1, 1).getValue()) {
    headerRange.setValues([headers]);
    headerRange.setBackground('#1a3a2a').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);

    // Ancho de columnas
    sheet.setColumnWidth(1, 160); // Timestamp
    sheet.setColumnWidth(2, 170); // Producto
    sheet.setColumnWidth(3, 360); // Comentario
    sheet.setColumnWidth(4, 160); // Nombre
    sheet.setColumnWidth(5, 160); // Sentimiento
    sheet.setColumnWidth(6, 300); // Resumen IA

    Logger.log('Hoja inicializada con encabezados.');
    SpreadsheetApp.getUi().alert('✓ Hoja "Feedback" inicializada correctamente.');
  } else {
    SpreadsheetApp.getUi().alert('La hoja ya tiene contenido. No se modificó.');
  }
}

/**
 * Agrega un menú personalizado en el Google Sheet.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Alegra Feedback')
    .addItem('Clasificar pendientes ahora', 'clasificarManual')
    .addItem('Reintentar filas con error', 'reintentarErrores')
    .addSeparator()
    .addItem('Cargar datos de prueba', 'cargarDatosIniciales')
    .addItem('Activar trigger automático (5 min)', 'setupTrigger')
    .addItem('Inicializar hoja con encabezados', 'inicializarHoja')
    .addToUi();
}


// ============================================================
//  SECCIÓN 4 — UTILIDADES DE TESTING
// ============================================================

/**
 * Prueba la conexión con Gemini sin tocar el Sheet.
 * Ejecuta esto primero para verificar que tu API key funciona.
 */
function testGemini() {
  const comentarioPrueba = 'La interfaz es muy intuitiva y fácil de usar.';
  try {
    const resultado = analizarConGemini(comentarioPrueba);
    Logger.log('TEST OK → Sentimiento: ' + resultado.sentimiento + ' | Resumen: ' + resultado.resumen);
    SpreadsheetApp.getUi().alert(
      'TEST EXITOSO\n\nComentario: "' + comentarioPrueba + '"\nSentimiento: ' + resultado.sentimiento + '\nResumen: ' + resultado.resumen
    );
  } catch (err) {
    Logger.log('TEST FALLIDO → ' + err.message);
    SpreadsheetApp.getUi().alert('ERROR: ' + err.message + '\n\nVerifica tu GEMINI_API_KEY.');
  }
}

/**
 * Inserta los 10 registros de la base de datos inicial para testing.
 */
function cargarDatosIniciales() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) { Logger.log('Hoja no encontrada'); return; }

  const datos = [
    ['2025-02-10 9:15',  'Alegra POS',          'La interfaz es muy intuitiva y fácil de usar.',              'Juan Pérez',      '', ''],
    ['2025-02-10 10:30', 'Alegra Contabilidad',  'Tuve problemas al cargar mis datos, el sistema se bloqueó.', 'María López',     '', ''],
    ['2025-02-10 11:00', 'Alegra Nómina',        'Excelente herramienta para gestionar pagos de empleados.',   'Carlos Martínez', '', ''],
    ['2025-02-10 11:45', 'Alegra POS',           'Algunas funcionalidades no están claras, necesito más tutoriales.', 'Ana Gómez', '', ''],
    ['2025-02-10 12:15', 'Alegra Contabilidad',  'La actualización reciente mejoró notablemente el rendimiento.', 'Luis Ramírez',  '', ''],
    ['2025-02-10 13:00', 'Alegra Nómina',        'La integración con otros sistemas es complicada.',           'Sofía Torres',    '', ''],
    ['2025-02-10 13:30', 'Alegra POS',           'La atención al cliente fue muy rápida y efectiva.',          'Diego Sánchez',   '', ''],
    ['2025-02-10 14:00', 'Alegra Contabilidad',  'El diseño visual del software es un poco anticuado.',        'Laura Jiménez',   '', ''],
    ['2025-02-10 14:30', 'Alegra Nómina',        'Me gustaría ver más opciones de personalización.',           'Fernando Ruiz',   '', ''],
    ['2025-02-10 15:00', 'Alegra POS',           'No se conectó con la impresora fiscal como esperaba.',       'Elena Morales',   '', '']
  ];

  // Encontrar la primera fila vacía
  const lastRow = sheet.getLastRow();
  const startRow = lastRow < 2 ? 2 : lastRow + 1;

  sheet.getRange(startRow, 1, datos.length, 6).setValues(datos);
  Logger.log('10 registros iniciales cargados desde fila ' + startRow);
  SpreadsheetApp.getUi().alert('✓ 10 registros de prueba cargados. Ahora ejecuta "Clasificar pendientes".');
}

function reintentarErrores() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    SpreadsheetApp.getUi().alert('ERROR: No se encontró la hoja "' + CONFIG.SHEET_NAME + '".');
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('No hay datos para revisar.');
    return;
  }

  let limpiadas = 0;

  // Recorrer todas las filas y limpiar las que tengan error
  for (let row = 2; row <= lastRow; row++) {
    const sentimientoVal = sheet.getRange(row, CONFIG.COL.SENTIMIENTO).getValue();
    const sentimientoStr = sentimientoVal ? sentimientoVal.toString().trim() : "";

    if (sentimientoStr.startsWith("Error")) {
      // Limpiar contenido y formato de Sentimiento y Resumen
      sheet.getRange(row, CONFIG.COL.SENTIMIENTO)
        .setValue('')
        .setBackground(null)
        .setFontColor(null);
      sheet.getRange(row, CONFIG.COL.RESUMEN)
        .setValue('')
        .setBackground(null)
        .setFontColor(null);
      limpiadas++;
    }
  }

  if (limpiadas === 0) {
    SpreadsheetApp.getUi().alert('No se encontraron filas con errores.');
    return;
  }

  Logger.log(limpiadas + ' filas limpiadas. Iniciando reclasificación...');
  SpreadsheetApp.getUi().alert(
    limpiadas + ' fila(s) con error limpiadas.\n\nAhora se ejecutará la clasificación automáticamente.'
  );

  // Llamar clasificarPendientes para reprocesar
  clasificarPendientes();
}