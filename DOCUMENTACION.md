# Plataforma de Feedback – Alegra
**Prueba Técnica: Automation Support Intern (Aprendiz SENA)**  
Autor: Jesús Mantilla · Barranquilla, Colombia · Abril 2026

---

## Descripción general

Sistema centralizado de retroalimentación para los productos **Alegra POS**, **Alegra Contabilidad** y **Alegra Nómina**. Permite capturar comentarios de usuarios, almacenarlos estructuradamente en Google Sheets, clasificarlos automáticamente con IA (Gemini) y visualizarlos en un dashboard de Looker Studio.

### Arquitectura

```
[Usuario] → [Interfaz Web HTML] → [Apps Script Webhook]
                                         ↓
                              [Google Sheets "Feedback"]
                                         ↓
                         [Apps Script + Gemini API (clasificación)]
                                         ↓
                              [Looker Studio Dashboard]
```

---

## Entregables

| # | Entregable | Archivo | Estado |
|---|-----------|---------|--------|
| 1 | Interfaz de recolección | `feedback-form.html` | Completado |
| 2 | Hoja de cálculo estructurada | Google Sheets | Completado |
| 3 | Clasificación con Gemini | `AlegraFeedback.gs` | Completado |
| 4 | Dashboard Looker Studio | Configuración manual | Completado (ver instrucciones) |
| 5 | Documentación técnica | Este archivo | Completado |

---

## Instalación paso a paso

### Requisito previo: API Key de Gemini (gratuita)

1. Ve a [aistudio.google.com](https://aistudio.google.com)
2. Inicia sesión con tu cuenta de Google
3. Haz clic en **"Get API key"** → **"Create API key"**
4. Copia la clave generada (empieza con `AIza...`)

> **Nota sobre el plan gratuito (2026):** Google redujo los límites del free tier. El modelo recomendado es `gemini-2.5-flash-lite` con un límite de 15 RPM y 1000 solicitudes/día. No uses `gemini-1.5-flash` ni `gemini-2.0-flash` — ambos están deprecados.

---

### Paso 1 — Configurar Google Sheets

1. Abre el sheet de la base de datos inicial:  
   https://docs.google.com/spreadsheets/d/1ZV-h1bb3Gd8wS-2nkd4Bf0gYWT3HQ4czmGThiZkOD8g
2. Verifica que la hoja se llame exactamente **`Feedback`**
3. Confirma que las columnas estén en este orden:

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| Marca de Tiempo | Producto | Comentario | Nombre del Usuario | Categoría de Sentimiento | Resumen IA (Plus) |

---

### Paso 2 — Instalar el Apps Script

1. En el Google Sheet, ve a **Extensiones → Apps Script**
2. Borra todo el contenido del editor
3. Pega el contenido completo de `AlegraFeedback.gs`
4. Reemplaza la API key en la sección CONFIG:
   ```javascript
   GEMINI_API_KEY: 'AIzaSy...',   // ← tu clave aquí
   GEMINI_MODEL: 'gemini-2.5-flash-lite',  // modelo activo en free tier 2026
   ```
5. Guarda con **Ctrl+S** (nombre del proyecto: "Alegra Feedback")
6. Ejecuta `testGemini()` para verificar que la API funciona:
   - Haz clic en el selector de funciones → elige `testGemini`
   - Haz clic en **▶ Ejecutar**
   - Acepta los permisos cuando se soliciten
   - Deberías ver una alerta con el resultado del análisis

---

### Paso 3 — Activar el webhook (interfaz web → Sheet)

1. En Apps Script: **Implementar → Nueva implementación**
2. Configuración:
   - Tipo: **Aplicación web**
   - Descripción: `Alegra Feedback v1.0`
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**
3. Haz clic en **Implementar** → copia la **URL de la aplicación web**
4. Abre `feedback-form.html` en un editor de texto
5. Reemplaza `'TU_APPS_SCRIPT_URL_AQUI'` con la URL copiada:
   ```javascript
   const SCRIPT_URL = 'https://script.google.com/macros/s/AKfy.../exec';
   ```
6. Guarda el archivo HTML

---

### Paso 4 — Activar clasificación automática

1. En Apps Script, ejecuta `setupTrigger()`:
   - Selector de funciones → `setupTrigger` → **▶ Ejecutar**
2. Esto crea un trigger que ejecuta la clasificación cada 5 minutos automáticamente
3. Para cargar los datos iniciales del Sheet de prueba, ejecuta `cargarDatosIniciales()`
4. Luego ejecuta `clasificarManual()` para clasificarlos inmediatamente sin esperar

**Menú en el Sheet:**  
Después de guardar el script, recarga el Google Sheet. Verás el menú **Alegra Feedback** en la barra de herramientas con las siguientes opciones:
- Clasificar pendientes ahora
- Reintentar filas con error
- Cargar datos de prueba
- Activar trigger automático (5 min)
- Inicializar hoja con encabezados

---

### Paso 5 — Configurar Looker Studio

1. Ve a [lookerstudio.google.com](https://lookerstudio.google.com)
2. Haz clic en **Crear → Informe**
3. Fuente de datos: **Google Sheets** → selecciona el sheet → hoja `Feedback`
4. Configura los siguientes elementos:

#### Gráfica 1 – Volumen por producto (Gráfico de barras)
- **Dimensión:** Producto
- **Métrica:** COUNTA(Comentario)
- **Título:** Feedback por producto

#### Gráfica 2 – Distribución de sentimiento (Gráfico de anillo)
- **Dimensión:** Categoría de Sentimiento
- **Métrica:** COUNTA(Comentario)
- **Colores personalizados:**
  - Positivo → Verde `#00C48C`
  - Neutro → Amarillo `#F59E0B`
  - Negativo → Rojo `#EF4444`

#### Gráfica 3 – Tendencia en el tiempo (Gráfico de líneas)
- **Dimensión:** Marca de Tiempo (tipo Fecha)
- **Métrica:** COUNTA(Comentario)
- **Granularidad:** Día

#### Filtros del dashboard
Añade los siguientes controles de filtro:
- **Por fecha:** Control de período → campo `Marca de Tiempo`
- **Por sentimiento:** Lista desplegable → campo `Categoría de Sentimiento`
- **Por producto:** Lista desplegable → campo `Producto`

#### Tabla de detalle
Añade una tabla con todas las columnas para ver registros individuales.

---

## Estructura de código

### `AlegraFeedback.gs` — funciones principales

| Función | Descripción |
|---------|-------------|
| `doPost(e)` | Webhook que recibe datos desde la interfaz HTML |
| `doGet()` | Healthcheck del endpoint |
| `clasificarPendientes()` | Itera filas sin clasificar y llama a Gemini |
| `analizarConGemini(comentario)` | Llama a Gemini API, retorna `{sentimiento, resumen}` |
| `colorearSentimiento(sheet, row, sent)` | Colorea celda E según el resultado |
| `setupTrigger()` | Crea trigger automático cada 5 minutos |
| `clasificarManual()` | Clasificación bajo demanda (menú o ejecución directa) |
| `reintentarErrores()` | Limpia filas con error y las reclasifica automáticamente |
| `inicializarHoja()` | Crea hoja y encabezados si no existen |
| `onOpen()` | Agrega menú personalizado al abrir el Sheet |
| `testGemini()` | Prueba la API key con un comentario de ejemplo |
| `cargarDatosIniciales()` | Inserta los 10 registros de la BD inicial |

### `feedback-form.html` — características

- Formulario responsivo con diseño dark mode branded Alegra
- Validación de campos en cliente (producto requerido, comentario requerido)
- Contador de caracteres en tiempo real (1000 máx.)
- Estado de éxito/error post-envío
- Envío via `fetch()` con `mode: 'no-cors'` al webhook de Apps Script

---

## Prompt de Gemini

El sistema usa el siguiente prompt de clasificación (formato texto plano `SENTIMIENTO | RESUMEN`):

**System prompt:**
```
Eres un experto en experiencia de cliente. Tu tarea es analizar feedback de usuarios de Alegra.

Responde ESTRICTAMENTE en este formato:
SENTIMIENTO | RESUMEN

Instrucciones para el RESUMEN:
- NO uses frases genéricas como "El usuario dice que..." o "El cliente está...".
- Ve directo al grano: ¿Qué le gusta o qué le duele específicamente?
  (Ej: "La app es lenta al cargar" o "Excelente soporte técnico").
- Debe ser una frase en español, máximo 15 palabras.

Valores de SENTIMIENTO: Positivo, Neutro o Negativo.
```

**User prompt:**
```
Analiza este comentario: "{comentario}"
```

**Parámetros de la llamada:**
- Modelo: `gemini-2.5-flash-lite` (disponible en free tier 2026)
- Temperature: `0.1` (respuestas consistentes y predecibles)
- maxOutputTokens: `300`
- Reintentos automáticos: `2`
- Pausa entre llamadas: `20 segundos` (respeta el límite de 15 RPM del plan gratuito)

---

## Posibles problemas y soluciones

| Problema | Causa probable | Solución |
|---------|---------------|----------|
| Error 401 en Gemini | API key incorrecta | Verificar la clave en CONFIG |
| Error 403 en Gemini | API key sin permisos | Habilitar "Generative Language API" en Google Cloud Console |
| Error 429 (rate limit) | Demasiadas solicitudes por minuto o por día | Esperar 1-2 min y usar "Reintentar filas con error". El plan free permite 15 RPM y 1000 req/día |
| Error 400 (bad request) | Nombre de modelo incorrecto o deprecado | Usar `gemini-2.5-flash-lite` en CONFIG. Los modelos `1.5-flash` y `2.0-flash` ya no están disponibles |
| El Sheet no se actualiza | Nombre de hoja incorrecto | Verificar que se llame exactamente `Feedback` |
| Formulario no envía | URL del webhook incorrecta | Volver a publicar el Apps Script y copiar la nueva URL |
| Clasificación siempre "Neutro" | Parseo fallido del separador `\|` | Revisar el log en Apps Script (Ver → Registros) |

---

## Notas de seguridad

- La API key de Gemini se almacena en el código del Apps Script, que es privado por defecto en Google
- El webhook usa `mode: 'no-cors'` — no expone datos sensibles
- Se recomienda validar/sanitizar los inputs del formulario en el servidor (`doPost`) antes de escribir al Sheet en producción
- **No subas tu API key real a repositorios públicos.** Reemplázala por `'TU_API_KEY_AQUI'` antes de publicar el código

---

## Tecnologías utilizadas

- **Google Sheets** — almacenamiento estructurado
- **Google Apps Script** — backend/automatización (JavaScript ES5+)
- **Gemini 2.5 Flash Lite API** — análisis de sentimiento y generación de resúmenes (gratuita, free tier 2026)
- **HTML/CSS/JavaScript** — interfaz de usuario
- **Google Looker Studio** — visualización de datos

---

*Prueba técnica para Automation Support Intern (Aprendiz SENA) — Alegra, 2026.*
