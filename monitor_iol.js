/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         MONITOR DE INVERSIONES IOL — v3.5                    ║
 * ║         Google Apps Script                                    ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  CAMBIOS v3.5:                                               ║
 * ║  - Reentrada ahora es SOLO Renta Variable. En Renta Fija/ONs  ║
 * ║    el precio baja por amortización de capital según           ║
 * ║    cronograma — no es "está barato", es descuento normal del  ║
 * ║    nominal remanente. Para bonos ya existe la sección de       ║
 * ║    Alertas Renta Fija (basada en TIR, que sí aplica ahí).     ║
 * ║  CAMBIOS v3.4:                                               ║
 * ║  - Ajuste de splits en Reentrada: cuando un split llega como  ║
 * ║    acreditación de títulos sin efectivo (cantidad>0, monto=0, ║
 * ║    la misma señal que ya usaba calcularPosiciones() para la   ║
 * ║    cantidad), ahora también se usa para dividir el precio de  ║
 * ║    la última Compra/Venta por el ratio del split antes de     ║
 * ║    compararlo con el precio actual. Antes solo se ajustaba la ║
 * ║    cantidad y quedaba una caída falsa en Reentrada.           ║
 * ║  CAMBIOS v3.3:                                               ║
 * ║  - Detección de splits/canjes de CEDEAR NO capturados por     ║
 * ║    Movimientos (red de seguridad para cuando la acreditación  ║
 * ║    de títulos no llegó como movimiento importable): se        ║
 * ║    compara la cantidad calculada contra la cantidad real que  ║
 * ║    informa HOY la API de IOL (Posiciones, cols "Cantidad IOL  ║
 * ║    (hoy)" / "⚠️ Revisar Split/Canje"). El Radar excluye de     ║
 * ║    "Reentrada" los tickers marcados así y los avisa aparte.   ║
 * ║  CAMBIOS v3.2:                                               ║
 * ║  - Nueva hoja "Config": targets de asignación (RV/RF/Mixta)  ║
 * ║    y umbrales de riesgo/rebalanceo/TIR ahora se leen de la   ║
 * ║    planilla, no están fijos en el código. El MISMO           ║
 * ║    monitor_iol.js sirve para Maki, Frank, Trini, etc. — cada ║
 * ║    quien ajusta su propio perfil editando su hoja Config.    ║
 * ║  CAMBIOS v3.1 (foco: inversora largo placista):               ║
 * ║  - Fix: "Reentrada" del Radar comparaba un objeto contra      ║
 * ║    strings y leía una columna inexistente → nunca disparaba.  ║
 * ║    Ahora reutiliza procesarMovimientos() + precios IOL.       ║
 * ║  - Tickers nuevos sin clasificar: en vez de solo un alert que ║
 * ║    se pierde (y que rompe corridas sin UI), se agregan como   ║
 * ║    fila pendiente (⚠️ COMPLETAR) en Equivalencias.             ║
 * ║  - Nueva sección "Concentración de Riesgo" en el Radar:       ║
 * ║    top posiciones, concentración por emisor ON y por tipo     ║
 * ║    de activo, y exposición "sin clasificar".                  ║
 * ║  - Rebalanceo accionable: la sección de Desbalanceo ahora     ║
 * ║    calcula el monto en USD a comprar/vender por clase y       ║
 * ║    sugiere tickers candidatos (los más baratos/caros vs       ║
 * ║    teórico) para Renta Variable.                              ║
 * ║  - Eficiencia: cotizaciones de la API IOL se piden en batch   ║
 * ║    (UrlFetchApp.fetchAll) en vez de una request por ticker.   ║
 * ║  CAMBIOS v3.0:                                               ║
 * ║  - Integración API IOL (movimientos, precios, saldo)         ║
 * ║  - Precios USD directos via API (sin IMPORTXML)              ║
 * ║  - MEP en lugar de CCL                                       ║
 * ║  - Token temporal (contraseña nunca se guarda)               ║
 * ║  - Hoja Ingresos_Egresos para depósitos manuales            ║
 * ║  - Columna "Conviene Operar" en Posiciones                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────
const HOJAS = {
  MOVIMIENTOS:      'Movimientos',
  INGRESOS_EGRESOS: 'Ingresos_Egresos',
  CCL:              'CCL',
  EQUIVALENCIAS:    'Equivalencias',
  RATIOS:           'Ratios_CEDEAR',
  POSICIONES:       'Posiciones',
  PORTFOLIO:        'Portfolio',
  RENTA_FIJA:       'Renta_Fija',
  HISTORIAL:        'Historial',
  FLUJOS_TIR:       'Flujos_TIR',
  CONFIG:           'Config',
};

const IOL_BASE = 'https://api.invertironline.com';

// Umbrales de riesgo/rebalanceo — valores por DEFECTO, pensados para una
// inversora largo placista. Cada planilla (Maki, Frank, Trini, ...) usa el
// MISMO monitor_iol.js pero puede tener un perfil de riesgo distinto: estos
// valores son solo el fallback cuando la hoja "Config" no existe o no trae
// un valor cargado. Para ajustar el perfil de una persona puntual, se edita
// la hoja Config de SU planilla — no hace falta tocar el código.
const RIESGO = {
  TICKER_REVISAR:   0.15,  // % del portfolio en un solo ticker → revisar
  TICKER_ALERTA:    0.25,  // % del portfolio en un solo ticker → alerta fuerte
  EMISOR_ALERTA:    0.20,  // % del portfolio en ONs/Bonos de un mismo emisor
  REBALANCEO_MIN:   0.03,  // diferencia mínima vs target para sugerir acción
};

// ─────────────────────────────────────────────
// CONFIG POR PLANILLA — targets y umbrales editables sin tocar código
// ─────────────────────────────────────────────
function _cargarConfig() {
  const defaults = {
    targetRV:      0.65,
    targetRF:      0.20,
    targetRM:      0.10,
    tickerRevisar: RIESGO.TICKER_REVISAR,
    tickerAlerta:  RIESGO.TICKER_ALERTA,
    emisorAlerta:  RIESGO.EMISOR_ALERTA,
    rebalanceoMin: RIESGO.REBALANCEO_MIN,
    tirRFObjetivo: 0.08,
  };

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(HOJAS.CONFIG);
  if (!sheet) return defaults;

  const etiquetaAClave = {
    'Target Renta Variable':    'targetRV',
    'Target Renta Fija':        'targetRF',
    'Target Renta Mixta':       'targetRM',
    'Umbral Ticker Revisar':    'tickerRevisar',
    'Umbral Ticker Alerta':     'tickerAlerta',
    'Umbral Emisor Alerta':     'emisorAlerta',
    'Umbral Rebalanceo Min':    'rebalanceoMin',
    'Objetivo TIR Renta Fija':  'tirRFObjetivo',
  };

  const config = Object.assign({}, defaults);
  sheet.getDataRange().getValues().slice(1).forEach(fila => {
    const clave = etiquetaAClave[String(fila[0] || '').trim()];
    if (!clave) return;
    const val = parseFloat(fila[1]);
    if (!isNaN(val) && val >= 0) config[clave] = val;
  });
  return config;
}

function _inicializarConfig() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(HOJAS.CONFIG);
  if (!sheet) sheet = ss.insertSheet(HOJAS.CONFIG);
  if (sheet.getLastRow() > 0) return; // no pisar una config ya cargada

  sheet.getRange(1, 1, 1, 3)
    .setValues([['Parámetro', 'Valor', 'Nota']])
    .setBackground('#1a73e8').setFontColor('white')
    .setFontWeight('bold').setHorizontalAlignment('center');

  const filas = [
    ['Target Renta Variable',   0.65, 'Target + Target RF + Target Mixta debería sumar 100%'],
    ['Target Renta Fija',       0.20, ''],
    ['Target Renta Mixta',      0.10, ''],
    ['Umbral Ticker Revisar',   0.15, '% del portfolio en un solo ticker → revisar'],
    ['Umbral Ticker Alerta',    0.25, '% del portfolio en un solo ticker → alerta fuerte'],
    ['Umbral Emisor Alerta',    0.20, '% en ONs/Bonos de un mismo emisor'],
    ['Umbral Rebalanceo Min',   0.03, 'Diferencia mínima vs target para sugerir comprar/vender'],
    ['Objetivo TIR Renta Fija', 0.08, 'TIR anualizada mínima esperada en USD'],
  ];
  sheet.getRange(2, 1, filas.length, 3).setValues(filas);
  sheet.getRange(2, 2, filas.length, 1).setNumberFormat('0.0%');
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(3, 380);
  sheet.autoResizeColumns(2, 1);
}

// ─────────────────────────────────────────────
// MENÚ
// ─────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Inversiones')
    .addItem('🔄 Actualizar Todo',           'actualizarTodo')
    .addSeparator()
    .addItem('📥 Pegar Movimientos IOL',     'procesarMovimientos')
    .addSeparator()
    .addItem('🔐 Configurar Acceso IOL',     'configurarAccesoIOL')
    .addItem('⚙️ Inicializar Hojas',         'inicializarHojas')
    .addItem('🎛️ Ver/Editar Config (targets y riesgo)', 'abrirConfig')
    .addItem('⚙️ Diagnostico',         'diagnosticarPosiciones')
    .addItem('🔍 Tickers Pendientes',  'verTickersPendientes')
    .addItem('🎯 Generar Radar', 'generarRadar')
    .addToUi();
}

// ─────────────────────────────────────────────
// ABRIR / CREAR HOJA CONFIG
// ─────────────────────────────────────────────
function abrirConfig() {
  _inicializarConfig();
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(HOJAS.CONFIG);
  if (sheet) ss.setActiveSheet(sheet);
}

// ─────────────────────────────────────────────
// AUTENTICACIÓN IOL — TOKEN TEMPORAL
// contraseña NUNCA se guarda
// ─────────────────────────────────────────────
function _getTokenIOL() {
  const props       = PropertiesService.getScriptProperties();
  const tokenGuard  = props.getProperty('iol_token');
  const tokenExpira = parseInt(props.getProperty('iol_token_expira') || '0');

  // Reutilizar token si todavía es válido
  if (tokenGuard && Date.now() < tokenExpira) return tokenGuard;

  // Token vencido → pedir credenciales
  const ui = SpreadsheetApp.getUi();
  ui.alert(
    '🔐 Acceso IOL',
    'El token venció. Se pedirán usuario y contraseña.\n\n' +
    'La contraseña NO se guarda — solo se usa para obtener el token (válido 30 min).',
    ui.ButtonSet.OK
  );

  const respU = ui.prompt('🔐 Usuario IOL', 'Ingresá tu email:', ui.ButtonSet.OK_CANCEL);
  if (respU.getSelectedButton() !== ui.Button.OK) throw new Error('Cancelado por el usuario.');
  const usuario = respU.getResponseText().trim();

  const respP = ui.prompt('🔐 Contraseña IOL', 'Ingresá tu contraseña (no se guardará):', ui.ButtonSet.OK_CANCEL);
  if (respP.getSelectedButton() !== ui.Button.OK) throw new Error('Cancelado por el usuario.');
  const password = respP.getResponseText().trim();

  const resp = UrlFetchApp.fetch(`${IOL_BASE}/token`, {
    method:  'POST',
    payload: `grant_type=password&username=${encodeURIComponent(usuario)}&password=${encodeURIComponent(password)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    muteHttpExceptions: true,
  });

  if (resp.getResponseCode() !== 200) {
    throw new Error('Error al autenticar en IOL (HTTP ' + resp.getResponseCode() + '):\n' + resp.getContentText());
  }

  const data = JSON.parse(resp.getContentText());
  if (!data.access_token) throw new Error('IOL no devolvió token. Respuesta:\n' + resp.getContentText());

  // Guardar SOLO el token, con expiración (30 min menos 1 min de margen)
  props.setProperty('iol_token',        data.access_token);
  props.setProperty('iol_token_expira', String(Date.now() + 1740000));

  return data.access_token;
}

function _fetchIOL(endpoint, method, payload) {
  const token  = _getTokenIOL();
  const opts   = {
    method:  method || 'GET',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    muteHttpExceptions: true,
  };
  if (payload) opts.payload = JSON.stringify(payload);

  const resp   = UrlFetchApp.fetch(`${IOL_BASE}${endpoint}`, opts);
  const codigo = resp.getResponseCode();
  const texto  = resp.getContentText();

  if (codigo === 401) {
    // Token rechazado → limpiar para que la próxima vez pida credenciales
    PropertiesService.getScriptProperties().deleteProperty('iol_token');
    throw new Error('Token rechazado por IOL. Volvé a ejecutar para ingresar credenciales.');
  }
  if (codigo !== 200) throw new Error(`IOL API error ${codigo} (${endpoint}): ${texto.substring(0, 200)}`);

  return JSON.parse(texto);
}

// ─────────────────────────────────────────────
// FETCH EN BATCH — pide varios endpoints IOL en paralelo
// (más eficiente que un fetch por ticker cuando hay varias posiciones)
// ─────────────────────────────────────────────
function _fetchIOLBatch(endpoints) {
  const resultado = {};
  if (!endpoints || endpoints.length === 0) return resultado;

  let token;
  try {
    token = _getTokenIOL();
  } catch(e) {
    Logger.log('Error obteniendo token para batch: ' + e.message);
    return resultado;
  }

  const requests = endpoints.map(ep => ({
    url:     `${IOL_BASE}${ep}`,
    method:  'get',
    headers: { 'Authorization': `Bearer ${token}` },
    muteHttpExceptions: true,
  }));

  let responses;
  try {
    responses = UrlFetchApp.fetchAll(requests);
  } catch(e) {
    Logger.log('Error en fetchAll IOL: ' + e.message);
    return resultado;
  }

  responses.forEach((resp, i) => {
    const ep = endpoints[i];
    if (resp.getResponseCode() !== 200) { resultado[ep] = null; return; }
    try {
      resultado[ep] = JSON.parse(resp.getContentText());
    } catch(e) {
      resultado[ep] = null;
    }
  });

  return resultado;
}

// ─────────────────────────────────────────────
// CONFIGURAR ACCESO (primera vez)
// ─────────────────────────────────────────────
function configurarAccesoIOL() {
  const ui = SpreadsheetApp.getUi();
  try {
    // Limpiar token viejo
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('iol_token');
    props.deleteProperty('iol_token_expira');

    // Intentar obtener token nuevo
    _getTokenIOL();
    ui.alert('✅ Acceso configurado correctamente.\n\nEl token dura 30 minutos. La próxima vez que venza, se pedirán las credenciales de nuevo automáticamente.');
  } catch(e) {
    ui.alert('❌ Error: ' + e.message);
  }
}

// ─────────────────────────────────────────────
// ACTUALIZAR MEP (reemplaza CCL)
// ─────────────────────────────────────────────
function _actualizarMEP() {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(HOJAS.CCL);
    if (!sheet) return;

    // Detectar última fecha cargada en la hoja
    const datosHoja = sheet.getDataRange().getValues();
    let ultimaFecha = null;
    for (let i = 1; i < datosHoja.length; i++) {
      const val = datosHoja[i][0];
      let f = null;
      if (val instanceof Date && !isNaN(val)) f = _fmtFecha(val);
      else if (typeof val === 'string' && val.includes('/')) {
        const p = val.split('/');
        if (p.length === 3) f = `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
      } else if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}$/)) {
        f = val;
      }
      if (f && (!ultimaFecha || f > ultimaFecha)) ultimaFecha = f;
    }

    // Traer histórico completo de la API
    const resp = UrlFetchApp.fetch(
      'https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa',
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) {
      Logger.log('Error MEP API: HTTP ' + resp.getResponseCode());
      return;
    }

    const datos = JSON.parse(resp.getContentText());

    // Filtrar solo fechas nuevas
    const fechasExistentes = new Set(
      datosHoja.slice(1).map(f => {
        const val = f[0];
        if (val instanceof Date && !isNaN(val)) return _fmtFecha(val);
        if (typeof val === 'string') return val.includes('/') 
          ? val.split('/').reverse().join('-') 
          : val;
        return '';
      }).filter(Boolean)
    );

    const nuevasFilas = [];
    datos.forEach(d => {
      const fecha = d.fecha; // formato YYYY-MM-DD
      if (!fecha || fechasExistentes.has(fecha)) return;
      const compra = parseFloat(d.compra) || 0;
      const venta  = parseFloat(d.venta)  || 0;
      if (!compra && !venta) return;
      nuevasFilas.push([fecha, (compra + venta) / 2]);
    });

    if (nuevasFilas.length > 0) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, nuevasFilas.length, 2).setValues(nuevasFilas);
      sheet.getRange(startRow, 1, nuevasFilas.length, 1).setNumberFormat('yyyy-mm-dd');
      // Ordenar descendente
      sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).sort({ column: 1, ascending: false });
      Logger.log('MEP: ' + nuevasFilas.length + ' días nuevos agregados.');
    } else {
      Logger.log('MEP: ya actualizado.');
    }

  } catch(e) {
    Logger.log('Error actualizando MEP: ' + e.message);
  }
}

// ─────────────────────────────────────────────
// OBTENER MEP ACTUAL (última fila de CCL)
// ─────────────────────────────────────────────
function _getMEPActual() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(HOJAS.CCL);
  if (!sheet) return 0;
  const datos = sheet.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    const v = parseFloat(datos[i][1]);
    if (v > 0) return v;
  }
  return 0;
}

// ─────────────────────────────────────────────
// IMPORTAR MOVIMIENTOS DESDE API IOL
// ─────────────────────────────────────────────
function importarMovimientosIOL() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const sheetMov = ss.getSheetByName(HOJAS.MOVIMIENTOS);
  if (!sheetMov) throw new Error('No existe la hoja "Movimientos".');

  // Leer movimientos existentes para deduplicar
  const datos   = sheetMov.getDataRange().getValues();
  const nrosMov = new Set(
    datos.slice(1).map(f => String(f[0]).trim()).filter(Boolean)
  );

  // Detectar fecha más reciente ya cargada
let maxFecha = null;
datos.slice(1).forEach(fila => {
  const val = fila[3];
  let fechaObj = null;
  if (val instanceof Date && !isNaN(val)) {
    fechaObj = val;
  } else if (typeof val === 'number' && val > 40000) {
    fechaObj = new Date((val - 25569) * 86400 * 1000);
  } else if (typeof val === 'string' && val.includes('/')) {
    const p = val.split('/');
    if (p.length === 3) fechaObj = new Date(p[2], p[1]-1, p[0]);
  }
  if (fechaObj && !isNaN(fechaObj)) {
    const fd = _fmtFecha(fechaObj);
    if (fd && (!maxFecha || fd > maxFecha)) maxFecha = fd;
  }
});

  // Desde 7 días antes del último mov, o 90 días si no hay datos
  let desde;
  if (maxFecha) {
    const d = new Date(maxFecha + 'T12:00:00Z');
    d.setDate(d.getDate() - 7);
    desde = _fmtFecha(d);
  } else {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    desde = _fmtFecha(d);
  }
  const hasta = _fmtFecha(new Date());

  // Traer operaciones de la API
  let operaciones = [];
  try {
    operaciones = _fetchIOL(
      `/api/operaciones?fechaDesde=${desde}&fechaHasta=${hasta}`
  );
    if (!Array.isArray(operaciones)) operaciones = [];
  } catch(e) {
    Logger.log('Error importando movimientos: ' + e.message);
    return 0;
  }

  // Convertir al formato de la hoja Movimientos
  const nuevasFilas = [];
  const mepActual   = _getMEPActual();

  operaciones.forEach(op => {
    // Solo terminadas
    if (String(op.estado || '').toLowerCase() !== 'terminada') return;

    const nroMov = String(op.numero || '').trim();
    if (!nroMov || nrosMov.has(nroMov)) return;

    const simbolo  = String(op.simbolo || '').trim();
    const esUSD    = simbolo.endsWith(' US$');
    const ticker   = simbolo.replace(/ US\$$/, '').trim();

    // Construir tipo en formato que ya parsea _parseTipo
    let tipoMov = '';
    const tipo  = String(op.tipo || '').trim();
    if (['Compra', 'Venta'].includes(tipo)) {
      tipoMov = `${tipo}(${ticker})`;
    } else if (tipo === 'Pago de Renta') {
      tipoMov = esUSD ? `Pago de Renta(${ticker} US$)` : `Pago de Renta(${ticker})`;
    } else if (tipo === 'Pago de Dividendos') {
      tipoMov = esUSD ? `Pago de Dividendos(${ticker} US$)` : `Pago de Dividendos(${ticker})`;
    } else if (tipo === 'Pago de Amortización') {
      tipoMov = esUSD ? `Pago de Amortización(${ticker} US$)` : `Pago de Amortización(${ticker})`;
    } else if (tipo === 'Rescate FCI') {
      tipoMov = `Rescate FCI(${ticker})`;
    } else if (tipo.includes('Suscripción') || tipo.includes('Suscripcion')) {
      tipoMov = `Suscripción FCI(${ticker})`;
    } else if (tipo.includes('Transferencia')) {
      tipoMov = tipo.includes('IN') ? `Transferencia de Titulos IN - (${ticker})` : `Transferencia de Titulos OUT - (${ticker})`;
    } else {
      tipoMov = tipo;
    }

    const fecha     = op.fechaOperada || op.fechaOrden || '';
    const fechaFmt  = fecha ? fecha.split('T')[0].split('-').reverse().join('/') : '';
    const cantidad  = op.cantidadOperada ?? 0;
    const precio    = op.precioOperado   ?? 0;
    const monto     = op.montoOperado    ?? 0;
    const tipoCuenta = esUSD
      ? 'Inversion Argentina Dolares'
      : 'Inversion Argentina Pesos';

    nuevasFilas.push([
      nroMov,      // A: Nro. de Mov.
      op.numeroBoleto ?? 0, // B: Nro. de Boleto
      tipoMov,     // C: Tipo Mov.
      fechaFmt,    // D: Concert.
      fechaFmt,    // E: Liquid.
      'Terminada', // F: Est
      cantidad,    // G: Cant. titulos
      precio,      // H: Precio
      0,           // I: Comis. (no disponible en API)
      0,           // J: Iva Com.
      0,           // K: Otros Imp.
      monto,       // L: Monto
      '',          // M: Observaciones
      tipoCuenta,  // N: Tipo Cuenta
    ]);
    nrosMov.add(nroMov);
  });

  if (nuevasFilas.length > 0) {
    sheetMov.getRange(sheetMov.getLastRow() + 1, 1, nuevasFilas.length, 14)
      .setValues(nuevasFilas);
    Logger.log(`${nuevasFilas.length} movimientos nuevos importados.`);
  }

  return nuevasFilas.length;
}

// ─────────────────────────────────────────────
// LEER INGRESOS_EGRESOS MANUALES
// ─────────────────────────────────────────────
function _leerIngresosEgresos() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(HOJAS.INGRESOS_EGRESOS);
  if (!sheet) return [];

  const mep   = _getMEPActual();
  const datos = sheet.getDataRange().getValues();
  const resultado = [];

  datos.slice(1).forEach(fila => {
    const fecha   = _fmtFecha(fila[0]);
    const tipo    = String(fila[1] || '').trim().toLowerCase();
    const monto   = _num(fila[2]);
    const moneda  = String(fila[3] || '').trim().toUpperCase();
    if (!fecha || !monto) return;

    const montoUSD = moneda === 'USD' ? monto : (mep > 0 ? monto / mep : 0);
    resultado.push({
      fecha,
      tipo:     tipo.includes('dep') ? 'DEPOSITO' : 'EXTRACCION',
      montoUSD: tipo.includes('dep') ? -Math.abs(montoUSD) : Math.abs(montoUSD),
      moneda,
      montoOriginal: monto,
    });
  });

  return resultado;
}

// ─────────────────────────────────────────────
// ACTUALIZAR SALDO DESDE API IOL
// ─────────────────────────────────────────────
function _actualizarSaldoIOL() {
  try {
    const data  = _fetchIOL('/api/v2/estadocuenta');
    const props = PropertiesService.getScriptProperties();

    let saldoUSD = 0;
    let saldoARS = 0;

    if (Array.isArray(data.cuentas)) {
      data.cuentas.forEach(cuenta => {
        const moneda = String(cuenta.moneda || '').toLowerCase();
        const disp   = parseFloat(cuenta.disponible || 0);
        if (moneda.includes('dolar')) {
          saldoUSD += disp;
        } else {
          saldoARS += disp;
        }
      });
    }

    if (saldoUSD > 0) props.setProperty('saldo_usd', String(saldoUSD));
    if (saldoARS > 0) props.setProperty('saldo_ars', String(saldoARS));

    Logger.log(`Saldo: USD ${saldoUSD} | ARS ${saldoARS}`);
    return { usd: saldoUSD, ars: saldoARS };

  } catch(e) {
    Logger.log('Error actualizarSaldoIOL: ' + e.message);
    throw e;
  }
}

// ─────────────────────────────────────────────
// OBTENER PRECIOS DESDE API IOL
// devuelve mapa { tickerBase: { precioUSD, precioARS } }
// ─────────────────────────────────────────────
function _obtenerPreciosIOL() {
  const mep      = _getMEPActual();
  const eqMap    = _cargarEquivalencias();
  const tickerUSDMap = _cargarTickerUSD();
  const precios  = {};

  // 1. Traer portfolio completo para tener precios ARS de todos
  let portfolio = [];
  try {
    const data = _fetchIOL('/api/portafolio');
    portfolio  = data.activos || [];
  } catch(e) {
    Logger.log('Error obteniendo portfolio: ' + e.message);
  }

  // Mapa símbolo → ultimoPrecio ARS del portfolio
  const preciosARS = {};
  portfolio.forEach(activo => {
    const simbolo = String(activo.titulo?.simbolo || '').trim();
    if (simbolo) preciosARS[simbolo] = parseFloat(activo.ultimoPrecio || 0);
  });

  // Cantidad REAL que informa IOL hoy, resuelta a tickerBase (sumando si el
  // mismo activo está tenido en ARS y en USD a la vez). Sirve para detectar
  // splits / cambios de ratio de CEDEAR: si no coincide con lo que da la
  // suma de movimientos históricos, algo pasó entre la compra y hoy que no
  // está reflejado en Movimientos (split, canje, ajuste de ratio, etc.).
  const cantidadIOL = {};
  portfolio.forEach(activo => {
    const simboloIOL = String(activo.titulo?.simbolo || '').trim();
    if (!simboloIOL) return;
    const eq         = eqMap[simboloIOL] || {};
    const tickerBase = eq.tickerBase || simboloIOL;
    // El nombre exacto del campo puede variar según la versión de la API;
    // se prueban las variantes más comunes antes de descartar el activo.
    const cant = parseFloat(activo.cantidad ?? activo.cantidadDisponible ?? activo.cantidadValorizada);
    if (!isNaN(cant)) cantidadIOL[tickerBase] = (cantidadIOL[tickerBase] || 0) + cant;
  });

  // 2. Para cada ticker base, obtener precio USD directo si tiene versión D
  // Si no, usar precioARS / MEP
  const tickersBase = new Set([
    ...Object.keys(preciosARS),
    ...Object.keys(tickerUSDMap),
    ...Object.keys(cantidadIOL),
  ]);

  // Pedir todas las cotizaciones USD directas de una sola vez (batch)
  // en lugar de un fetch secuencial por ticker.
  const endpointDe = {}; // tickerBase → endpoint
  const endpoints  = [];
  tickersBase.forEach(tickerBase => {
    const tickerD = tickerUSDMap[tickerBase];
    if (!tickerD) return;
    const ep = `/api/BCBA/Titulos/${tickerD}/Cotizacion`;
    endpointDe[tickerBase] = ep;
    endpoints.push(ep);
  });
  const respuestasD = _fetchIOLBatch(endpoints);

  tickersBase.forEach(tickerBase => {
    const tickerD   = tickerUSDMap[tickerBase];
    const precioARS = preciosARS[tickerBase] || 0;
    let   precioUSD = 0;

    if (tickerD) {
      // Tiene versión D → cotización directa en USD
      const data = respuestasD[endpointDe[tickerBase]];
      precioUSD  = data ? (parseFloat(data.ultimoPrecio) || 0) : 0;
      if (!precioUSD) {
        // Fallback: usar ARS / MEP
        precioUSD = mep > 0 && precioARS > 0 ? precioARS / mep : 0;
      }
    } else {
      // Sin versión D → ARS / MEP
      precioUSD = mep > 0 && precioARS > 0 ? precioARS / mep : 0;
    }

    precios[tickerBase] = {
      precioUSD, precioARS,
      cantidadIOL: cantidadIOL[tickerBase] != null ? cantidadIOL[tickerBase] : null,
    };
  });

  return precios;
}

// ─────────────────────────────────────────────
// ACTUALIZAR TODO
// ─────────────────────────────────────────────
function actualizarTodo() {
  const ui = SpreadsheetApp.getUi();
  try {
    ui.alert('⏳ Iniciando actualización...\n\nEsto puede tardar unos segundos.');

    // 1. MEP
    _actualizarMEP();

    // 2. Importar movimientos nuevos desde API
    let nuevos = 0;
try {
  nuevos = importarMovimientosIOL();
  Logger.log('Movimientos importados: ' + nuevos);
} catch(e) {
  SpreadsheetApp.getUi().alert('Error en importarMovimientosIOL: ' + e.message + '\n' + e.stack);
}

    // 3. Actualizar saldo
    let saldoInfo = '';
    try {
      const saldo = _actualizarSaldoIOL();
      saldoInfo   = `\nSaldo: USD ${saldo.usd.toFixed(2)} | ARS ${saldo.ars.toLocaleString('es-AR')}`;
    } catch(e) {
      Logger.log('Saldo IOL no disponible: ' + e.message);
    }

    // 4. Procesar y calcular posiciones
    procesarMovimientos();
    calcularPosiciones();

    ui.alert(
      `✅ Actualización completada.\n` +
      `📥 Movimientos nuevos: ${nuevos}` +
      saldoInfo
    );
  } catch(e) {
    ui.alert('❌ Error: ' + e.message + '\n\n' + e.stack);
  }
  generarRadar();
}

// ─────────────────────────────────────────────
// NOMBRES DE HOJAS — HELPERS
// ─────────────────────────────────────────────
function _getSheet(nombre) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(nombre);
  if (sheet) return sheet;
  
  // Crear hoja nueva y limpiar cualquier formato heredado
  const nueva = ss.insertSheet(nombre);
  try {
    nueva.setFrozenRows(0);
    nueva.setFrozenColumns(0);
  } catch(e) {}
  return nueva;
}

function _setHeaders(nombreHoja, headers) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(nombreHoja);
  if (!sheet) return;
  
  sheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setBackground('#1a73e8')
    .setFontColor('white')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
}

// ─────────────────────────────────────────────
// HELPERS DE DATOS
// ─────────────────────────────────────────────
function _num(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (!s || s === '000') return 0;
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

function _fmtFecha(val) {
  if (!val) return '';
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s      = String(val).trim();
  const partes = s.split('/');
  if (partes.length === 3) {
    let y = partes[2];
    if (y.length === 2) y = '20' + y;
    return `${y}-${partes[1].padStart(2,'0')}-${partes[0].padStart(2,'0')}`;
  }
  return s;
}

function _cargarCCL() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(HOJAS.CCL);
  if (!sh) return {};
  const map = {};
  sh.getDataRange().getValues().slice(1).forEach(fila => {
    if (!fila[0] || !fila[1]) return;
    const f = _fmtFecha(fila[0]);
    const v = _num(fila[1]);
    if (f && v > 0) map[f] = v;
  });
  return map;
}

function _getCCL(fechaStr, cclMap) {
  if (cclMap[fechaStr]) return cclMap[fechaStr];
  const fechas = Object.keys(cclMap).sort();
  let mejor = 0;
  for (const d of fechas) {
    if (d <= fechaStr) mejor = cclMap[d];
    else break;
  }
  return mejor;
}

function _cargarEquivalencias() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(HOJAS.EQUIVALENCIAS);
  if (!sh) return {};
  const map = {};
  sh.getDataRange().getValues().slice(1).forEach(fila => {
    const iol = String(fila[0] || '').trim();
    if (!iol) return;
    map[iol] = {
      tickerBase: String(fila[1] || '').trim(),
      tickerNYSE: String(fila[2] || '').trim(),
      nombre:     String(fila[3] || '').trim(),
      moneda:     String(fila[4] || '').trim(),
      clase:      String(fila[5] || '').trim(),
      tipo:       String(fila[6] || '').trim(),
      emisorON:   String(fila[7] || '').trim(),
      exchange:   String(fila[8] || '').trim(),
    };
  });
  return map;
}

function _cargarRatios() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(HOJAS.RATIOS);
  if (!sh) return {};
  const map = {};
  sh.getDataRange().getValues().slice(1).forEach(fila => {
    const t = String(fila[0] || '').trim();
    if (!t) return;
    map[t] = {
      num: parseFloat(fila[1]) || 1,
      den: parseFloat(fila[2]) || 1,
    };
  });
  return map;
}

function _cargarTickerUSD() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(HOJAS.EQUIVALENCIAS);
  if (!sh) return {};
  const map = {};
  sh.getDataRange().getValues().slice(1).forEach(fila => {
    const tickerIOL  = String(fila[0] || '').trim();
    const tickerBase = String(fila[1] || '').trim();
    const moneda     = String(fila[4] || '').trim();
    if (!tickerIOL || !tickerBase) return;
    if (moneda === 'USD') map[tickerBase] = tickerIOL;
  });
  return map;
}

function _parseTipo(str) {
  if (!str) return { tipo: null, ticker: null };
  str = str.trim();
  const patrones = [
    [/^Compra\((.+)\)$/,                           'COMPRA'],
    [/^Venta\((.+)\)$/,                            'VENTA'],
    [/^Pago de Renta\((.+?)(?:\s+US\$)?\)$/,       'RENTA'],
    [/^Pago de Dividendos\((.+?)(?:\s+US\$)?\)$/,  'DIVIDENDO'],
    [/^Rescate FCI\((.+)\)$/,                      'RESCATE_FCI'],
    [/^Suscripci[oó]n FCI\((.+)\)$/,               'SUSCRIPCION_FCI'],
    [/^Transferencia de Titulos IN - \((.+)\)$/,   'TRANSF_IN'],
    [/^Transferencia de Titulos OUT - \((.+)\)$/,  'TRANSF_OUT'],
    [/^Pago de Amortización\((.+)\)$/,             'AMORTIZACION'],
    [/[Dd]ep[oó]sito de Fondos/,                   'DEPOSITO',   null],
    [/[Dd][eé]bito\s*-\s*Producto/,                'DEBITO',     null],
    [/^[Cc]r[eé]dito$/,                            'CREDITO',    null],
    [/[Ee]xtracci[oó]n/,                           'EXTRACCION', null],
  ];
  for (const p of patrones) {
    const match = str.match(p[0]);
    if (match) {
      const tickerRaw = p.length > 2 ? p[2] : (match[1] || null);
      const ticker    = tickerRaw != null
        ? tickerRaw.replace(/\s+US\$$/, '').trim()
        : null;
      return { tipo: p[1], ticker };
    }
  }
  return { tipo: 'OTRO', ticker: null };
}

// ─────────────────────────────────────────────
// DETECCIÓN DE SPLITS — a partir de acreditaciones de títulos sin
// contrapartida en efectivo (misma señal que calcularPosiciones() ya usa
// para sumar cantidad sin tocar costo: "Pago de Dividendos" con cantidad
// > 0 y monto ≈ 0). Se arma, por ticker, la cantidad tenida en cada
// momento y se detecta el ratio de cada acreditación así.
// ─────────────────────────────────────────────
function _calcularSplitsPorTicker(movs) {
  const porTicker = {};
  movs.forEach(m => {
    if (!m.tickerBase) return;
    if (!porTicker[m.tickerBase]) porTicker[m.tickerBase] = [];
    porTicker[m.tickerBase].push(m);
  });

  const splitsPorTicker = {}; // tickerBase -> [{ fecha, ratio }] ordenados por fecha

  Object.entries(porTicker).forEach(([ticker, lista]) => {
    lista.sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);

    let cantidadAcumulada = 0;
    const splits = [];

    lista.forEach(m => {
      const cantAbs = Math.abs(m.cantidad || 0);
      const montoAbs = Math.abs(m.montoUSD || 0);

      if (['COMPRA', 'SUSCRIPCION_FCI', 'TRANSF_IN'].includes(m.tipo)) {
        cantidadAcumulada += cantAbs;

      } else if (['VENTA', 'RESCATE_FCI', 'TRANSF_OUT'].includes(m.tipo)) {
        cantidadAcumulada -= cantAbs;

      } else if (['RENTA', 'DIVIDENDO'].includes(m.tipo) && cantAbs > 0 && montoAbs < 0.01) {
        // Acreditación de títulos sin valor en efectivo → split / canje de ratio
        if (cantidadAcumulada > 0) {
          splits.push({ fecha: m.fecha, ratio: (cantidadAcumulada + cantAbs) / cantidadAcumulada });
        }
        cantidadAcumulada += cantAbs;

      } else if (m.tipo === 'AMORTIZACION') {
        if (m.cantidad > 0) cantidadAcumulada += cantAbs;
        else if (m.cantidad < 0) cantidadAcumulada = 0;
      }
    });

    if (splits.length > 0) splitsPorTicker[ticker] = splits;
  });

  return splitsPorTicker;
}

// Producto de los ratios de todos los splits ocurridos DESPUÉS de fechaDesde
// — para llevar un precio histórico "pre-split" a equivalente actual.
function _factorSplitDesde(splitsPorTicker, tickerBase, fechaDesde) {
  const splits = splitsPorTicker[tickerBase];
  if (!splits) return 1;
  return splits.reduce((acc, s) => s.fecha > fechaDesde ? acc * s.ratio : acc, 1);
}

// ─────────────────────────────────────────────
// PROCESAR MOVIMIENTOS
// ─────────────────────────────────────────────
function procesarMovimientos() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const sheetMov = ss.getSheetByName(HOJAS.MOVIMIENTOS);
  if (!sheetMov) throw new Error('No existe la hoja "Movimientos".');

  const raw = sheetMov.getDataRange().getValues();
  if (raw.length < 2) throw new Error('La hoja "Movimientos" está vacía.');

  // Detectar fila de headers
let hFila = 0;
for (let i = 0; i < Math.min(raw.length, 10); i++) {
  const filaStr = raw[i].map(c => String(c)).join('|');
  if (filaStr.includes('Nro') && filaStr.includes('Tipo Mov')) {
    hFila = i;
    break;
  }
}

  const headers = raw[hFila].map(h => String(h).trim());
  const col = (prefijo) => headers.findIndex(h => h.startsWith(prefijo));
  const C = {
    nroMov:   col('Nro. de Mov'),
    tipo:     col('Tipo Mov'),
    concert:  col('Concert'),
    estado:   col('Est'),
    cantidad: col('Cant'),
    precio:   col('Precio'),
    monto:    col('Monto'),
    cuenta:   col('Tipo Cuenta'),
  };

  const mepMap = _cargarCCL(); // sigue usando la misma hoja CCL, ahora con valores MEP
  const eqMap  = _cargarEquivalencias();

  // Agrupar por Nro. de Mov para deduplicar
  const porNroMov = {};
  raw.slice(hFila + 1).forEach(fila => {
    const nro = String(fila[C.nroMov] || '').trim();
    if (!nro || nro === '0') return;
    if (!porNroMov[nro]) porNroMov[nro] = [];
    porNroMov[nro].push(fila);
  });

  const resultado = [];

  Object.values(porNroMov).forEach(grupo => {
    let filaMain;
    if (grupo.length > 1) {
      const usdFila = grupo.find(f =>
        String(f[C.cuenta] || '').includes('Dolares') ||
        String(f[C.cuenta] || '').includes('Dólares')
      );
      filaMain = usdFila || grupo[0];
    } else {
      filaMain = grupo[0];
    }

    const estado = String(filaMain[C.estado] || '');
    if (!estado.includes('Terminada')) return;

    const tipoRaw   = String(filaMain[C.tipo] || '');
    const { tipo, ticker } = _parseTipo(tipoRaw);

    const fecha     = _fmtFecha(filaMain[C.concert]);
    const cantidad  = _num(filaMain[C.cantidad]);
    const precio    = _num(filaMain[C.precio]);
    const monto     = _num(filaMain[C.monto]);
    const cuentaTxt = String(filaMain[C.cuenta] || '');
    const esUSD     = cuentaTxt.includes('Dolares') || cuentaTxt.includes('Dólares');
    const mep       = _getCCL(fecha, mepMap);

    let montoUSD = null;
    if (esUSD) {
      montoUSD = monto;
    } else if (mep > 0) {
      montoUSD = monto / mep;
    }

    let precioUSD = null;
    if (esUSD) {
      precioUSD = precio;
    } else if (mep > 0) {
      precioUSD = precio / mep;
    }

    const eq = ticker ? (eqMap[ticker] || {}) : {};

    resultado.push({
      fecha,
      tipo,
      tickerIOL:  ticker         || '',
      tickerBase: eq.tickerBase  || ticker || '',
      tickerNYSE: eq.tickerNYSE  || '',
      nombre:     eq.nombre      || ticker || tipoRaw,
      clase:      eq.clase       || '',
      tipoActivo: eq.tipo        || '',
      emisorON:   eq.emisorON    || '',
      exchange:   eq.exchange    || '',
      cantidad,
      precioUSD:  precioUSD !== null ? precioUSD : 0,
      montoUSD,
      moneda:     esUSD ? 'USD' : 'ARS',
      mep:        mep || 0,
      montoOriginal: monto,
    });
  });

  // Agregar ingresos/egresos manuales
  const ingresosEgresos = _leerIngresosEgresos();
  ingresosEgresos.forEach(ie => {
    resultado.push({
      fecha:      ie.fecha,
      tipo:       ie.tipo,
      tickerIOL:  '',
      tickerBase: '',
      tickerNYSE: '',
      nombre:     ie.tipo === 'DEPOSITO' ? 'Depósito Manual' : 'Extracción Manual',
      clase:      '',
      tipoActivo: '',
      emisorON:   '',
      exchange:   '',
      cantidad:   0,
      precioUSD:  0,
      montoUSD:   ie.montoUSD,
      moneda:     ie.moneda,
      mep:        _getMEPActual(),
      montoOriginal: ie.montoOriginal,
    });
  });

  // Ordenar por fecha
  resultado.sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);

  // Ordenar hoja Movimientos por fecha descendente
  const lastRow = sheetMov.getLastRow();
  if (lastRow > 2) {
    sheetMov.getRange(2, 1, lastRow - 1, 14)
      .sort({ column: 4, ascending: false });
  }

  return resultado;
}

// ─────────────────────────────────────────────
// CALCULAR POSICIONES
// ─────────────────────────────────────────────
function calcularPosiciones() {
  const movs         = procesarMovimientos();
  const ratiosMap    = _cargarRatios();
  const advertencias = new Set();
  const posiciones   = {};

  movs.forEach(m => {
    const { fecha, tipo, tickerBase, tickerNYSE, nombre, clase, tipoActivo,
            emisorON, exchange, cantidad, montoUSD, moneda } = m;

    if (['DEPOSITO','EXTRACCION','CREDITO','DEBITO','OTRO'].includes(tipo)) return;
    if (tipo === null) return;
    if (!tickerBase) return;

    if (!clase && (tipo === 'COMPRA' || tipo === 'SUSCRIPCION_FCI')) {
      advertencias.add(tickerBase);
    }

    if (!posiciones[tickerBase]) {
      posiciones[tickerBase] = {
        tickerBase, tickerNYSE, nombre, clase, tipoActivo, emisorON, exchange,
        monedaOp:          moneda,
        cantActual:        0,
        costoActual:       0,
        gananciaRealizada: 0,
        ingresos:          0,
        primeraCompra:     null,
        ultimaOp:          fecha,
      };
    }

    const pos      = posiciones[tickerBase];
    pos.ultimaOp   = fecha;
    const montoAbs = Math.abs(montoUSD || 0);
    const cantAbs  = Math.abs(cantidad);

    if (['COMPRA','SUSCRIPCION_FCI','TRANSF_IN'].includes(tipo)) {
      if (!pos.primeraCompra) pos.primeraCompra = fecha;
      pos.cantActual  += cantAbs;
      pos.costoActual += montoAbs;

    } else if (['VENTA','RESCATE_FCI','TRANSF_OUT'].includes(tipo)) {
      const costoPromedio    = pos.cantActual > 0 ? pos.costoActual / pos.cantActual : 0;
      const costoVendido     = costoPromedio * cantAbs;
      pos.gananciaRealizada += montoAbs - costoVendido;
      pos.cantActual        -= cantAbs;
      pos.costoActual       -= costoVendido;
      if (pos.cantActual  < 0.0001) pos.cantActual  = 0;
      if (pos.costoActual < 0)      pos.costoActual = 0;

    } else if (tipo === 'AMORTIZACION') {
      if (cantidad < 0) {
        const costoPromedio    = pos.cantActual > 0 ? pos.costoActual / pos.cantActual : 0;
        pos.gananciaRealizada += montoAbs - (costoPromedio * pos.cantActual);
        pos.cantActual  = 0;
        pos.costoActual = 0;
      } else if (cantidad > 0) {
        if (!pos.primeraCompra) pos.primeraCompra = fecha;
        pos.cantActual  += cantAbs;
        pos.costoActual += montoAbs;
      } else if (cantidad === 0 && montoAbs > 0) {
        pos.ingresos += montoUSD;
      }

    } else if (['RENTA','DIVIDENDO'].includes(tipo)) {
      if (cantAbs > 0 && montoAbs === 0) {
        pos.cantActual += cantAbs;
      } else if ((montoUSD || 0) > 0) {
        pos.ingresos += montoUSD;
      }
    }
  });

  // Flujos por ticker para TIR individual
  const flujosPorTicker = {};
  movs.forEach(m => {
    const { fecha, tipo, tickerBase, montoUSD, cantidad } = m;
    if (!tickerBase || montoUSD === null) return;
    if (['DEPOSITO','EXTRACCION','CREDITO','DEBITO','OTRO','CAUCION'].includes(tipo)) return;
    if (tipo === null) return;
    if (!flujosPorTicker[tickerBase]) flujosPorTicker[tickerBase] = [];

    if (['COMPRA','SUSCRIPCION_FCI','TRANSF_IN'].includes(tipo)) {
      flujosPorTicker[tickerBase].push({ fecha, monto: -Math.abs(montoUSD) });
    } else if (['VENTA','RESCATE_FCI','TRANSF_OUT'].includes(tipo)) {
      flujosPorTicker[tickerBase].push({ fecha, monto: Math.abs(montoUSD) });
    } else if (['RENTA','DIVIDENDO'].includes(tipo) && montoUSD > 0) {
      flujosPorTicker[tickerBase].push({ fecha, monto: Math.abs(montoUSD) });
    } else if (tipo === 'AMORTIZACION') {
      if (cantidad > 0) {
        flujosPorTicker[tickerBase].push({ fecha, monto: Math.abs(montoUSD) });
      } else if (cantidad === 0 && (montoUSD || 0) > 0) {
        flujosPorTicker[tickerBase].push({ fecha, monto: Math.abs(montoUSD) });
      }
    }
  });

  const abiertas = Object.values(posiciones).filter(p => p.cantActual > 0.0001);
  const cerradas = Object.values(posiciones).filter(p => p.cantActual <= 0.0001);

  // Obtener precios desde API IOL
  let preciosIOL = {};
  try {
    preciosIOL = _obtenerPreciosIOL();
  } catch(e) {
    Logger.log('Error obteniendo precios IOL: ' + e.message);
  }

  // Config de ESTA planilla — targets/umbrales pueden variar por persona.
  const config = _cargarConfig();

  _escribirPosiciones(abiertas, ratiosMap, flujosPorTicker, preciosIOL);
  _escribirHistorial(cerradas, flujosPorTicker);
  _escribirPortfolio(abiertas, cerradas, config);
  _escribirRentaFija(abiertas, config);
  _escribirFlujosTIR(movs);
  _inicializarIngresosEgresos();
  _inicializarConfig();

  if (advertencias.size > 0) {
    const tickers = [...advertencias];

    // Se agregan como filas pendientes en Equivalencias (no se pierden
    // aunque nadie llegue a leer el alert, y quedan visibles cada vez
    // que se abre la hoja).
    try {
      _registrarTickersFaltantes(tickers);
    } catch(e) {
      Logger.log('Error registrando tickers faltantes: ' + e.message);
    }

    // El alert solo funciona si hay UI activa (no en triggers headless).
    try {
      SpreadsheetApp.getUi().alert(
        '⚠️ Tickers sin clasificar en "Equivalencias":\n\n' +
        tickers.join(', ') +
        '\n\nSe agregaron como filas pendientes (⚠️ COMPLETAR, fondo rojo) ' +
        'en la hoja Equivalencias.\nCompletá Ticker_Base, Clase y Tipo, y volvé a ejecutar.'
      );
    } catch(e) {
      Logger.log('Tickers sin clasificar (UI no disponible): ' + tickers.join(', '));
    }
  }
}

// ─────────────────────────────────────────────
// REGISTRAR TICKERS FALTANTES EN EQUIVALENCIAS
// ─────────────────────────────────────────────
function _registrarTickersFaltantes(tickers) {
  if (!tickers || tickers.length === 0) return;

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(HOJAS.EQUIVALENCIAS);
  if (!sheet) return;

  const existentes = new Set(
    sheet.getDataRange().getValues().slice(1)
      .map(f => String(f[0]).trim()).filter(Boolean)
  );

  const nuevas = tickers.filter(t => t && !existentes.has(t));
  if (nuevas.length === 0) return;

  // Columna J (10) = "Estado", separada de las 9 columnas de datos reales
  // (Ticker_IOL..Exchange_NYSE) para no pisar ningún campo existente.
  if (String(sheet.getRange(1, 10).getValue() || '').trim() !== 'Estado') {
    sheet.getRange(1, 10).setValue('Estado')
      .setBackground('#1a73e8').setFontColor('white').setFontWeight('bold');
  }

  const filas = nuevas.map(t => [
    t, '', '', '', '', '', '', '', '', '⚠️ COMPLETAR'
  ]);

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, filas.length, 10).setValues(filas);
  sheet.getRange(startRow, 1, filas.length, 10).setBackground('#fce8e6');
}

// ─────────────────────────────────────────────
// VER TICKERS PENDIENTES DE CLASIFICAR
// ─────────────────────────────────────────────
function verTickersPendientes() {
  const ui    = SpreadsheetApp.getUi();
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(HOJAS.EQUIVALENCIAS);
  if (!sheet) { ui.alert('No existe la hoja Equivalencias.'); return; }

  const datos = sheet.getDataRange().getValues();
  const pendientes = datos.slice(1)
    .filter(f => String(f[9] || '').includes('COMPLETAR'))
    .map(f => String(f[0]).trim())
    .filter(Boolean);

  if (pendientes.length === 0) {
    ui.alert('✅ No hay tickers pendientes de clasificar en Equivalencias.');
  } else {
    ui.alert(
      `⚠️ Tickers pendientes de clasificar (${pendientes.length}):\n\n` +
      pendientes.join(', ') +
      '\n\nCompletá Ticker_Base, Clase y Tipo en la hoja Equivalencias, ' +
      'y borrá la marca ⚠️ COMPLETAR de la columna J (Estado).'
    );
  }
}

// ─────────────────────────────────────────────
// ESCRIBIR POSICIONES ABIERTAS
// ─────────────────────────────────────────────
function _escribirPosiciones(abiertas, ratiosMap, flujosPorTicker, preciosIOL) {
  const sheet = _getSheet(HOJAS.POSICIONES);
  sheet.clearContents();
  sheet.clearFormats();
  sheet.clearConditionalFormatRules();

  // ── Definición de columnas ────────────────────────────────────────────
  // VISIBLES:
  // A  Ticker
  // B  Cantidad
  // C  Costo Total USD
  // D  Precio Prom USD
  // E  Precio Actual USD    ← desde API IOL (ticker D)
  // F  Precio Actual ARS    ← desde API IOL (ticker ARS)
  // G  Valor Actual USD
  // H  G/P No Real. USD
  // I  G/P %
  // J  G/P Real. USD
  // K  Ingresos USD
  // L  Retorno Total USD
  // M  TIR
  // N  % Portfolio
  // O  % su Clase
  // P  % su Tipo
  // Q  Precio Teórico USD   ← GOOGLEFINANCE
  // R  Precio Teórico ARS
  // S  Prima/Desc %
  // T  Conviene Operar
  //
  // OCULTAS:
  // U  Nombre
  // V  Clase
  // W  Tipo
  // X  Emisor ON
  // Y  Ticker USD IOL
  // Z  Primera Compra
  // AA Ratio CEDEAR

  const hdrs = ['Ticker','Cantidad','Costo Total USD','Precio Prom USD',
           'Precio USD','Precio ARS','Valor USD','G/P No Real. USD',
           'G/P %','G/P Real. USD','Ingresos USD','Retorno Total USD',
           'TIR','% Portfolio','% su Clase','% su Tipo',
           'Precio Teórico USD','Precio Teórico ARS','Prima/Desc %',
           'Conviene Operar','$ Implícito ARS/USD','vs MEP %'];

  _setHeaders(HOJAS.POSICIONES, hdrs);

  // Cols AD (30) y AE (31): quedan visibles a propósito, DESPUÉS del
  // bloque de columnas ocultas (W-AC, ver más abajo) para no correr los
  // índices de columna que usa el resto del código (generarRadar,
  // Renta_Fija, etc.), que siguen apuntando a W=23..AC=29 igual que antes.
  sheet.getRange(1, 30, 1, 2)
    .setValues([['Cantidad IOL (hoy)', '⚠️ Revisar Split/Canje']])
    .setBackground('#1a73e8').setFontColor('white')
    .setFontWeight('bold').setHorizontalAlignment('center');

  if (abiertas.length === 0) return;

  // Ordenar: Renta Variable primero, luego RF; dentro alfabético
  abiertas.sort((a, b) => {
    if (a.clase !== b.clase) return a.clase === 'Renta Variable' ? -1 : 1;
    return a.tickerBase < b.tickerBase ? -1 : 1;
  });

  const tickerUSDMap = _cargarTickerUSD();
  const mep          = _getMEPActual();
  const hoyStr       = _fmtFecha(new Date());

  const baseRows = abiertas.map(pos => {
    const ratio      = ratiosMap[pos.tickerBase];
    const ratioStr   = ratio ? `${ratio.num}:${ratio.den}` : '';
    const precioProm = pos.cantActual > 0 ? pos.costoActual / pos.cantActual : 0;
    const tickerUSD  = tickerUSDMap[pos.tickerBase] || '';

    // Precios desde API IOL
    const precioData = preciosIOL[pos.tickerBase] || {};
    const precioUSD  = precioData.precioUSD || 0;
    const precioARS  = precioData.precioARS || 0;

    // Valor actual USD
    const esRF       = pos.tipoActivo === 'ON' || pos.tipoActivo === 'Bono';
    let   valorUSD   = 0;
    if (precioUSD > 0) {
      valorUSD = esRF
        ? pos.cantActual * precioUSD / 100
        : pos.cantActual * precioUSD;
    }

    // G/P no realizada
    const gpNoReal   = valorUSD > 0 ? valorUSD - pos.costoActual : 0;
    const gpPct      = pos.costoActual > 0 && valorUSD > 0
      ? gpNoReal / pos.costoActual : 0;

    // Retorno total
    const retorno    = gpNoReal + pos.gananciaRealizada + pos.ingresos;

    // TIR
    let tir = null;
    const flujos = (flujosPorTicker[pos.tickerBase] || []).slice();
    if (valorUSD > 0 && flujos.length > 0 && flujos.some(f => f.monto < 0)) {
      tir = _xirr([...flujos, { fecha: hoyStr, monto: valorUSD }]);
    }

    // Precio teórico (solo para CEDEARs con ratio y ticker NYSE)
    // Se calculará con GOOGLEFINANCE en fórmula

    // Alerta de split/evento corporativo: compara la cantidad que sale de
    // sumar los movimientos históricos contra la que informa HOY la propia
    // API de IOL. Si no coinciden, algo pasó que Movimientos no capturó
    // (split, canje de CEDEAR por cambio de ratio, etc.) — no se corrige
    // solo, se muestra para que se confirme a mano.
    const cantidadIOL = precioData.cantidadIOL;
    let alertaCantidad = '';
    if (cantidadIOL != null && cantidadIOL > 0 && pos.cantActual > 0) {
      const ratioCant = cantidadIOL / pos.cantActual;
      if (ratioCant > 1.05 || ratioCant < 0.95) {
        alertaCantidad = `⚠️ IOL: ${cantidadIOL.toFixed(2)} vs calculada: ${pos.cantActual.toFixed(2)}` +
          ` (x${ratioCant.toFixed(2)}) — revisar split/canje, no fiar Reentrada`;
      }
    }

    return [
      pos.tickerBase,           // A
      pos.cantActual,           // B
      pos.costoActual,          // C
      precioProm,               // D
      precioUSD || '',          // E
      precioARS || '',          // F
      valorUSD  || '',          // G
      gpNoReal  || '',          // H
      gpPct     || '',          // I
      pos.gananciaRealizada,    // J
      pos.ingresos,             // K
      retorno   || '',          // L
      tir !== null ? tir : '',  // M
      '',                       // N % Portfolio — fórmula
      '',                       // O % Clase    — fórmula
      '',                       // P % Tipo     — fórmula
      '',                       // Q Teórico USD — fórmula GOOGLEFINANCE
      '',                       // R Teórico ARS — fórmula
      '',                       // S Prima/Desc  — fórmula
      '',                       // T Conviene    — fórmula
      '',                       // U $ Implícito — fórmula
      '',                       // V vs MEP %    — fórmula
      pos.nombre,               // W oculta
      pos.clase || '',          // X oculta
      pos.tipoActivo || '',     // Y oculta
      pos.emisorON   || '',     // Z oculta
      tickerUSD,                // AA oculta
      pos.primeraCompra || '',  // AB oculta
      ratioStr,                 // AC oculta
      cantidadIOL != null ? cantidadIOL : '',  // AD visible — Cantidad IOL
      alertaCantidad,                          // AE visible — Alerta split
    ];
  });

  const nRows = baseRows.length;
  sheet.getRange(2, 1, nRows, 31).setValues(baseRows);
  // ── Fórmulas fila por fila ────────────────────────────────────────────
  const fMEP = `INDEX(CCL!B:B;MATCH(MAX(CCL!A:A);CCL!A:A;0))`;

  abiertas.forEach((pos, i) => {
    const r      = i + 2;
    const ratio  = ratiosMap[pos.tickerBase];
    const esRF   = pos.tipoActivo === 'ON' || pos.tipoActivo === 'Bono';

    // Col N: % Portfolio
    sheet.getRange(r, 14).setFormula(
      `=IFERROR(G${r}/VLOOKUP("TOTAL PORTFOLIO (USD)";Portfolio!A:B;2;0);"")`
    );

    // Col O: % su Clase — clase ahora en col X
    sheet.getRange(r, 15).setFormula(
      `=IFERROR(G${r}/SUMIF(X$2:X$1000;X${r};G$2:G$1000);"")`
    );

    // Col P: % su Tipo — tipo ahora en col Y
    sheet.getRange(r, 16).setFormula(
      `=IFERROR(G${r}/SUMIF(Y$2:Y$1000;Y${r};G$2:G$1000);"")`
    );

// Col Q: Precio Teórico USD (solo CEDEARs con ratio y ticker NYSE)
    if (ratio && pos.tickerNYSE && pos.clase === 'Renta Variable') {
      const exchange   = pos.exchange || 'NYSE';
      const nyseTicker = pos.tickerNYSE;      
      sheet.getRange(r, 17).setFormula(
        `=IFERROR(GOOGLEFINANCE("${exchange}:${nyseTicker}";"price")*${ratio.den}/${ratio.num};"")`
      );

      // Col R: Precio Teórico ARS
      sheet.getRange(r, 18).setFormula(
        `=IFERROR(Q${r}*${fMEP};"")`
      );

      // Col S: Prima/Descuento %
      sheet.getRange(r, 19).setFormula(
        `=IFERROR(IF(Q${r}<>0;(E${r}-Q${r})/Q${r};"");"")`
      );
// Col T: Conviene Operar — compra Y venta — con teórico NYSE
      sheet.getRange(r, 20).setFormula(
        `=IFERROR(IF(E${r}="";"";IF(Q${r}="";"Sin teórico";` +
        `IF(AND(E${r}>Q${r}*1,01;F${r}/${fMEP}>Q${r}*1,01);` +
          `"🔴 Caro en ambas · Evitá comprar · USD: "&TEXT((E${r}-Q${r})/Q${r};"0,0%")&" · ARS: "&TEXT((F${r}/${fMEP}-Q${r})/Q${r};"0,0%");` +
        `IF(AND(E${r}<Q${r}*0,99;F${r}/${fMEP}<Q${r}*0,99);` +
          `"🟢 Barato en ambas · Comprá cualquiera · USD: "&TEXT((E${r}-Q${r})/Q${r};"0,0%")&" · ARS: "&TEXT((F${r}/${fMEP}-Q${r})/Q${r};"0,0%");` +
        `IF(F${r}/${fMEP}>E${r}*1,005;` +
          `"🟡 ARS "&TEXT((F${r}/${fMEP}-E${r})/E${r};"0,0%")&" más caro · Comprá USD · Vendé ARS";` +
        `IF(E${r}>F${r}/${fMEP}*1,005;` +
          `"🟡 USD "&TEXT((E${r}-F${r}/${fMEP})/(F${r}/${fMEP});"0,0%")&" más caro · Comprá ARS · Vendé USD";` +
          `"⚪ Sin diferencia entre ARS y USD"` +
        `))))));"")`
      );

    } else if (pos.clase === 'Renta Variable') {
      // Sin teórico NYSE — solo comparar ARS vs USD
      sheet.getRange(r, 20).setFormula(
        `=IFERROR(IF(AND(E${r}<>"";F${r}<>"";${fMEP}<>0);` +
        `IF(F${r}/${fMEP}>E${r}*1,005;` +
          `"🟡 ARS "&TEXT((F${r}/${fMEP}-E${r})/E${r};"0,0%")&" más caro · Comprá USD · Vendé ARS";` +
        `IF(E${r}>F${r}/${fMEP}*1,005;` +
          `"🟡 USD "&TEXT((E${r}-F${r}/${fMEP})/(F${r}/${fMEP});"0,0%")&" más caro · Comprá ARS · Vendé USD";` +
          `"⚪ Sin diferencia entre ARS y USD"` +
        `));"");"")`
      );

    } else if (pos.clase === 'Renta Fija' &&
               (pos.tipoActivo === 'ON' || pos.tipoActivo === 'Bono')) {
      // ONs y Bonos: comparar precio ARS/MEP vs precio USD directo
      sheet.getRange(r, 20).setFormula(
        `=IFERROR(IF(AND(E${r}<>"";F${r}<>"";${fMEP}<>0);` +
        `IF(F${r}/${fMEP}>E${r}*1,005;` +
          `"🟡 ARS "&TEXT((F${r}/${fMEP}-E${r})/E${r};"0,0%")&" más caro · Comprá USD · Vendé ARS";` +
        `IF(E${r}>F${r}/${fMEP}*1,005;` +
          `"🟡 USD "&TEXT((E${r}-F${r}/${fMEP})/(F${r}/${fMEP});"0,0%")&" más caro · Comprá ARS · Vendé USD";` +
          `"⚪ Sin diferencia entre ARS y USD"` +
        `));"");"")`
      );
    }
  // Col U — Dólar implícito
    sheet.getRange(r, 21).setFormula(`=IFERROR(F${r}/E${r};"")`);
    sheet.getRange(r, 21).setNumberFormat('"ARS" #,##0.00');

// Col V — vs MEP %
    sheet.getRange(r, 22).setFormula(
      `=IFERROR((F${r}/E${r}-VLOOKUP("MEP del día";Portfolio!A:B;2;0))/VLOOKUP("MEP del día";Portfolio!A:B;2;0);"")`
    );
    sheet.getRange(r, 22).setNumberFormat('0,00%');
  }); // ← cierre del abiertas.forEach
  // ── Formatos numéricos ────────────────────────────────────────────────
  sheet.getRange(2, 2,  nRows, 1).setNumberFormat('#,##0.000');       // Cantidad
  sheet.getRange(2, 3,  nRows, 2).setNumberFormat('"USD" #,##0.00');  // Costo, Precio Prom
  sheet.getRange(2, 5,  nRows, 1).setNumberFormat('"USD" #,##0.000'); // Precio USD
  sheet.getRange(2, 6,  nRows, 1).setNumberFormat('"ARS" #,##0.00');  // Precio ARS
  sheet.getRange(2, 7,  nRows, 1).setNumberFormat('"USD" #,##0.00');  // Valor USD
  sheet.getRange(2, 8,  nRows, 1).setNumberFormat('"USD" #,##0.00');  // G/P No Real00
  sheet.getRange(2, 9,  nRows, 1).setNumberFormat('0.00%');           // G/P %
  sheet.getRange(2, 10, nRows, 2).setNumberFormat('"USD" #,##0.00');  // G/P Real, Ingresos
  sheet.getRange(2, 12, nRows, 1).setNumberFormat('"USD" #,##0.00');  // Retorno
  sheet.getRange(2, 13, nRows, 1).setNumberFormat('0.00%');           // TIR
  sheet.getRange(2, 14, nRows, 3).setNumberFormat('0.0%');            // % Portfolio/Clase/Tipo
  sheet.getRange(2, 17, nRows, 2).setNumberFormat('"USD" #,##0.000'); // Teórico USD
  sheet.getRange(2, 18, nRows, 1).setNumberFormat('"ARS" #,##0.00');  // Teórico ARS
  sheet.getRange(2, 19, nRows, 1).setNumberFormat('0.00%');           // Prima/Desc
  sheet.getRange(2, 21, nRows, 1).setNumberFormat('"ARS" #,##0.00'); // $ Implícito
  sheet.getRange(2, 22, nRows, 1).setNumberFormat('0.00%');          // vs MEP %

  // ── Formato condicional ───────────────────────────────────────────────
  const reglas = [];

  // G/P % (col I) y Retorno (col L) y TIR (col M)
  [
    sheet.getRange(2, 9,  nRows, 1),
    sheet.getRange(2, 12, nRows, 1),
    sheet.getRange(2, 13, nRows, 1),
  ].forEach(rng => {
    reglas.push(SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0)
      .setBackground('#d9ead3').setFontColor('#274e13')
      .setRanges([rng]).build());
    reglas.push(SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(0)
      .setBackground('#fce8e6').setFontColor('#a61c00')
      .setRanges([rng]).build());
  });

  // Prima/Desc (col S)
  const primaRange = sheet.getRange(2, 19, nRows, 1);
  reglas.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0.01)
    .setBackground('#fce8e6').setFontColor('#a61c00')
    .setRanges([primaRange]).build());
  reglas.push(SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThan(-0.01)
    .setBackground('#d9ead3').setFontColor('#274e13')
    .setRanges([primaRange]).build());

  // Alerta de split/canje (col AE) — resaltar en rojo si hay algo para revisar
  const alertaCantidadRange = sheet.getRange(2, 31, nRows, 1);
  reglas.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextContains('⚠️')
    .setBackground('#fce8e6').setFontColor('#a61c00')
    .setRanges([alertaCantidadRange]).build());

  sheet.setConditionalFormatRules(reglas);

  sheet.getRange(2, 30, nRows, 1).setNumberFormat('#,##0.000'); // Cantidad IOL
  sheet.setColumnWidth(30, 130);
  sheet.setColumnWidth(31, 420);

  // ── Columnas ocultas (U en adelante) ─────────────────────────────────
  sheet.hideColumns(23, 7); // cols W a AC

  // ── Separador entre RV y RF ───────────────────────────────────────────
  let primerFijaRow = -1;
  abiertas.forEach((pos, i) => {
    if (pos.clase === 'Renta Fija' && primerFijaRow === -1) primerFijaRow = i + 2;
  });
  if (primerFijaRow > 1) {
    sheet.getRange(primerFijaRow, 1, 1, hdrs.length)
      .setBorder(true, false, false, false, false, false,
        '#666666', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  }

  sheet.autoResizeColumns(1, 20);

}

// ─────────────────────────────────────────────
// ESCRIBIR PORTFOLIO
// ─────────────────────────────────────────────
function _escribirPortfolio(abiertas, cerradas, config) {
  config = config || _cargarConfig();
  const sheet = _getSheet(HOJAS.PORTFOLIO);
  const props = PropertiesService.getScriptProperties();

  let saldoUSD = parseFloat(props.getProperty('saldo_usd') || '0') || 0;
  let saldoARS = parseFloat(props.getProperty('saldo_ars') || '0') || 0;

  sheet.clearContents();
  sheet.clearFormats();

  const POS  = HOJAS.POSICIONES;
  const fMEP = `INDEX(CCL!B:B;MATCH(MAX(CCL!A:A);CCL!A:A;0))`;

  sheet.getRange('A1:B1').merge()
    .setValue('📊  RESUMEN DEL PORTFOLIO')
    .setFontSize(14).setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setBackground('#1a73e8').setFontColor('white');

  const escribirFila = (fila, label, formula, formato) => {
    sheet.getRange(fila, 1).setValue(label);
    if (formula !== null && formula !== undefined) {
      if (String(formula).startsWith('=')) {
        sheet.getRange(fila, 2).setFormula(formula);
      } else {
        sheet.getRange(fila, 2).setValue(formula);
      }
    }
    if (formato) sheet.getRange(fila, 2).setNumberFormat(formato);
  };

  const escribirTitulo = (fila, titulo) => {
    sheet.getRange(fila, 1, 1, 2).setValue(titulo)
      .setFontWeight('bold').setBackground('#e8f0fe');
  };

  let f = 2;

  // ── Valor y Retorno ───────────────────────────────────────────────────
  // Columnas Posiciones:
  // G = Valor Actual USD
  // H = G/P No Real USD
  // I = G/P %
  // J = G/P Real USD
  // K = Ingresos USD
  // L = Retorno Total USD
  // M = TIR
  // C = Costo Total USD
  // V = Clase (oculta)

  f++; escribirTitulo(f, '  VALOR Y RETORNO');

  f++; escribirFila(f, 'Valor Actual Total (USD)',
    `=IFERROR(SUM(${POS}!G:G);"")`, '"USD" #,##0.00');
  const filaValor = f;

  f++; escribirFila(f, 'Costo Total Invertido (USD)',
    `=IFERROR(SUM(${POS}!C:C);"")`, '"USD" #,##0.00');
  const filaCosto = f;

  f++; escribirFila(f, 'G/P No Realizada (USD)',
    `=IFERROR(SUM(${POS}!H:H);"")`, '"USD" #,##0.00');

  f++; escribirFila(f, 'G/P Realizada (USD)',
    `=IFERROR(SUM(${POS}!J:J);"")`, '"USD" #,##0.00');

  f++; escribirFila(f, 'Ingresos (Div/Renta) (USD)',
    `=IFERROR(SUM(${POS}!K:K);"")`, '"USD" #,##0.00');

  f++; escribirFila(f, 'Retorno Total (USD)',
    `=IFERROR(SUM(${POS}!L:L);"")`, '"USD" #,##0.00');
  sheet.getRange(f, 1, 1, 2).setFontWeight('bold');
  const filaRetorno = f;

  f++; escribirFila(f, 'Retorno Total %',
    `=IFERROR(B${filaRetorno}/B${filaCosto};"")`, '0.00%');

  // ── TIR del Portfolio ─────────────────────────────────────────────────
  f++; f++;
  escribirTitulo(f, '  TIR DEL PORTFOLIO');

  f++; sheet.getRange(f, 1, 1, 2).merge().setValue(
    '→ Calculada en USD usando MEP histórico para convertir depósitos en ARS.'
  ).setFontColor('#666666').setFontStyle('italic').setWrap(true);
  sheet.setRowHeight(f, 40);

  f++; escribirFila(f, 'TIR Anualizada (XIRR)',
    `=IFERROR(XIRR(Flujos_TIR!B2:B2000;Flujos_TIR!A2:A2000);"Sin datos suficientes")`,
    '0.00%');
  sheet.getRange(f, 1, 1, 2).setFontWeight('bold').setFontSize(13);

// ── Distribución ──────────────────────────────────────────────────────
  f++; f++;
  escribirTitulo(f, '  DISTRIBUCIÓN POR CLASE');

  f++; escribirFila(f, 'Renta Variable (USD)',
    `=IFERROR(SUMIF(${POS}!X:X;"Renta Variable";${POS}!G:G);"")`, '"USD" #,##0.00');
  const filaRV = f;

  f++; escribirFila(f, 'Renta Fija (USD)',
    `=IFERROR(SUMIF(${POS}!X:X;"Renta Fija";${POS}!G:G);"")`, '"USD" #,##0.00');
  const filaRF = f;

  f++; escribirFila(f, 'Renta Mixta / FCI (USD)',
    `=IFERROR(SUMIF(${POS}!X:X;"Renta Mixta";${POS}!G:G);"")`, '"USD" #,##0.00');
  const filaRM = f;

  f++; escribirFila(f, '% Renta Variable',
    `=IFERROR(B${filaRV}/B${filaValor};"")`, '0.0%');
  f++; escribirFila(f, '% Renta Fija',
    `=IFERROR(B${filaRF}/B${filaValor};"")`, '0.0%');
  f++; escribirFila(f, '% Renta Mixta / FCI',
    `=IFERROR(B${filaRM}/B${filaValor};"")`, '0.0%');

  // ── TIR por clase ─────────────────────────────────────────────────────
  f++; f++;
  escribirTitulo(f, '  TIR POR CLASE (anualizada en USD)');

  f++; escribirFila(f, 'TIR Renta Variable',
    `=IFERROR(XIRR(Flujos_TIR!D2:D2000;Flujos_TIR!A2:A2000);"Sin datos")`, '0.00%');
  sheet.getRange(f, 1, 1, 2).setFontWeight('bold');
  const filaTirRV = f;

  f++; escribirFila(f, 'TIR Renta Fija',
    `=IFERROR(XIRR(Flujos_TIR!E2:E2000;Flujos_TIR!A2:A2000);"Sin datos")`, '0.00%');
  sheet.getRange(f, 1, 1, 2).setFontWeight('bold');
  const filaTirRF = f;

  f++; escribirFila(f, 'TIR Renta Mixta / FCI',
    `=IFERROR(XIRR(Flujos_TIR!F2:F2000;Flujos_TIR!A2:A2000);"Sin datos")`, '0.00%');
  sheet.getRange(f, 1, 1, 2).setFontWeight('bold');

  // Benchmark RF — viene de la hoja Config de ESTA planilla (o del default
  // si no está configurado), no de un valor fijo en el código.
  f++;
  sheet.getRange(f, 1).setValue('Benchmark RF (objetivo)');
  sheet.getRange(f, 2).setValue(config.tirRFObjetivo).setNumberFormat('0.00%');
  const benchmarkRow = f;

  // Semáforo benchmark — referencia la celda del benchmark en vez de
  // repetir el número (así conviven ambos valores sin desincronizarse).
  sheet.getRange(f, 3).setFormula(
    `=IF(B${filaTirRF}="Sin datos";"⚪";IF(B${filaTirRF}>=B${benchmarkRow};"✅ Supera objetivo";"🔴 Bajo objetivo"))`
  );
  sheet.getRange(f, 3).setFontWeight('bold');

  // ── Posiciones ────────────────────────────────────────────────────────
  f++; f++;
  escribirTitulo(f, '  POSICIONES');

  f++; escribirFila(f, 'Posiciones Abiertas', abiertas.length);
  f++; escribirFila(f, '  → Renta Variable',
    abiertas.filter(p => p.clase === 'Renta Variable').length);
  f++; escribirFila(f, '  → Renta Fija',
    abiertas.filter(p => p.clase === 'Renta Fija').length);
  f++; escribirFila(f, '  → Sin clasificar',
    abiertas.filter(p => !p.clase || p.clase === 'Sin clasificar').length);
  f++; escribirFila(f, 'Posiciones Cerradas (Historial)', cerradas.length);

  // ── Saldo Disponible ──────────────────────────────────────────────────
  f++; f++;
  escribirTitulo(f, '  SALDO DISPONIBLE');

  f++; escribirFila(f, 'Efectivo USD disponible',
    saldoUSD > 0 ? saldoUSD : null, '"USD" #,##0.00');
  const filaEfectivoUSD = f;

  f++; escribirFila(f, 'Efectivo ARS disponible',
    saldoARS > 0 ? saldoARS : null, '"ARS" #,##0.00');
  const filaEfectivoARS = f;

  f++; escribirFila(f, 'Efectivo ARS en USD (MEP)',
    `=IFERROR(B${filaEfectivoARS}/${fMEP};"")`, '"USD" #,##0.00');
  const filaEfectivoARSusd = f;

  f++; escribirFila(f, 'Total Disponible USD',
    `=IFERROR(IFERROR(B${filaEfectivoUSD};0)+IFERROR(B${filaEfectivoARSusd};0);"")`,
    '"USD" #,##0.00');
  sheet.getRange(f, 1, 1, 2).setFontWeight('bold');
  const filaTotalDisponible = f;

  // ── Total General ─────────────────────────────────────────────────────
  f++; f++;
  escribirTitulo(f, '  TOTAL GENERAL');

  f++; escribirFila(f, 'Valor Inversiones (USD)',
    `=IFERROR(B${filaValor};"")`, '"USD" #,##0.00');

  f++; escribirFila(f, 'Efectivo Disponible (USD)',
    `=IFERROR(B${filaTotalDisponible};0)`, '"USD" #,##0.00');

  f++; escribirFila(f, 'TOTAL PORTFOLIO (USD)',
    `=IFERROR(B${filaValor}+IFERROR(B${filaTotalDisponible};0);"")`,
    '"USD" #,##0.00');
  sheet.getRange(f, 1, 1, 2)
    .setFontWeight('bold').setFontSize(13)
    .setBackground('#d9ead3').setFontColor('#274e13');
  const filaTotalPortfolio = f;

  // ── Flujos de Capital ─────────────────────────────────────────────────
  f++; f++;
  escribirTitulo(f, '  FLUJOS DE CAPITAL');

  f++; escribirFila(f, 'Total Depositado (USD)',
    `=IFERROR(ABS(SUMIF(Flujos_TIR!B2:B999;"<0";Flujos_TIR!B2:B999));"")`,
    '"USD" #,##0.00');
  const filaDepositado = f;

  f++; escribirFila(f, 'Total Retirado (USD)',
    `=IFERROR(SUMIF(Flujos_TIR!B2:B999;">0";Flujos_TIR!B2:B999)-INDEX(Flujos_TIR!B2:B999;COUNTA(Flujos_TIR!B2:B999));"")`,
    '"USD" #,##0.00');
  const filaRetirado = f;

  f++; escribirFila(f, 'Inversión Neta (USD)',
    `=IFERROR(B${filaDepositado}-B${filaRetirado};"")`,
    '"USD" #,##0.00');
  sheet.getRange(f, 1, 1, 2).setFontWeight('bold');

  f++; escribirFila(f, 'Ganancia Total Absoluta (USD)',
    `=IFERROR(B${filaTotalPortfolio}-B${filaDepositado}+B${filaRetirado};"")`,
    '"USD" #,##0.00');
  sheet.getRange(f, 1, 1, 2)
    .setFontWeight('bold')
    .setBackground('#d9ead3').setFontColor('#274e13');

  // ── MEP actual ────────────────────────────────────────────────────────
  f++; f++;
  escribirTitulo(f, '  REFERENCIA');
  f++; escribirFila(f, 'MEP del día',
    `=${fMEP}`, '"ARS" #,##0.00');

  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(2, 180);
}

// ─────────────────────────────────────────────
// ESCRIBIR RENTA FIJA
// ─────────────────────────────────────────────
function _escribirRentaFija(abiertas, config) {
  config = config || _cargarConfig();
  const sheet = _getSheet(HOJAS.RENTA_FIJA);
  sheet.clearContents();
  sheet.clearFormats();
  sheet.clearConditionalFormatRules();

  const hdrs = [
    'Ticker','Nombre','Tipo','Emisor',
    'Cantidad','Costo Total USD','Precio Actual %','Valor Actual USD',
    'TIR','% sobre RF','% sobre Portfolio','⚠️ Concentración ON'
  ];
  _setHeaders(HOJAS.RENTA_FIJA, hdrs);

  const rf = abiertas.filter(p => p.clase === 'Renta Fija');
  if (rf.length === 0) {
    sheet.getRange('A2').setValue('No hay posiciones de Renta Fija.');
    return;
  }

  const orden = { 'ON': 0, 'Bono': 1, 'FCI': 2 };
  rf.sort((a, b) => (orden[a.tipoActivo] ?? 9) - (orden[b.tipoActivo] ?? 9));

  const rows = rf.map(pos => [
    pos.tickerBase,
    pos.nombre,
    pos.tipoActivo,
    pos.emisorON  || '',
    pos.cantActual,
    pos.costoActual,
    '',  // G: precio % nominal (desde API o manual)
    '',  // H: valor actual
    '',  // I: TIR
    '',  // J: % sobre RF
    '',  // K: % sobre portfolio
    '',  // L: alerta concentración
  ]);

  const nRows = rows.length;
  sheet.getRange(2, 1, nRows, hdrs.length).setValues(rows);

  // Intentar poblar precio desde Posiciones (col E = Precio USD)
  const sheetPos = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(HOJAS.POSICIONES);
  if (sheetPos) {
    const datosPos = sheetPos.getDataRange().getValues();
    const mapaPrecios = {};
    datosPos.slice(1).forEach(fila => {
      const ticker = String(fila[0] || '').trim();
      const precio = parseFloat(fila[4]) || 0; // Col E = Precio USD
      if (ticker && precio > 0) mapaPrecios[ticker] = precio;
    });

    rf.forEach((pos, i) => {
      const r      = i + 2;
      const precio = mapaPrecios[pos.tickerBase];
      if (precio) sheet.getRange(r, 7).setValue(precio);
    });
  }

  for (let i = 0; i < nRows; i++) {
    const r = i + 2;

    // Col H: Valor Actual = Cantidad × (Precio% / 100)
    sheet.getRange(r, 8).setFormula(`=IFERROR(E${r}*G${r}/100;"")`);

    // Col I: TIR desde Posiciones
    sheet.getRange(r, 9).setFormula(
      `=IFERROR(VLOOKUP(A${r};${HOJAS.POSICIONES}!A:M;13;0);"")`
    );

    // Col J: % sobre total RF
    sheet.getRange(r, 10).setFormula(
      `=IFERROR(F${r}/SUM(F$2:F$${nRows+1});"")`
    );

    // Col K: % sobre portfolio total
    sheet.getRange(r, 11).setFormula(
      `=IFERROR(F${r}/VLOOKUP("TOTAL PORTFOLIO (USD)";Portfolio!A:B;2;0);"")`
    );

    // Col L: Alerta concentración ONs — umbral desde la hoja Config (por
    // defecto 20%), formateado con coma decimal porque la fórmula queda en
    // locale es-AR.
    const umbralEmisor = String(config.emisorAlerta).replace('.', ',');
    sheet.getRange(r, 12).setFormula(
  `=IFERROR(IF(C${r}="ON";IF(SUMIF(C$2:C$${nRows+1};"ON";F$2:F$${nRows+1})>0;IF(SUMIF(D$2:D$${nRows+1};D${r};F$2:F$${nRows+1})/SUMIF(C$2:C$${nRows+1};"ON";F$2:F$${nRows+1})>${umbralEmisor};"⚠️ "&TEXT(SUMIF(D$2:D$${nRows+1};D${r};F$2:F$${nRows+1})/SUMIF(C$2:C$${nRows+1};"ON";F$2:F$${nRows+1});"0,0%")&" en "&D${r};"✓");"");"");"")`
);
  }

  sheet.getRange(2, 5, nRows, 1).setNumberFormat('#,##0.000');
  sheet.getRange(2, 6, nRows, 1).setNumberFormat('"USD" #,##0.00');
  sheet.getRange(2, 7, nRows, 1).setNumberFormat('0.00"%"');
  sheet.getRange(2, 8, nRows, 1).setNumberFormat('"USD" #,##0.00');
  sheet.getRange(2, 9, nRows, 1).setNumberFormat('0.00%');
  sheet.getRange(2, 10, nRows, 2).setNumberFormat('0.0%');

  const alertRange = sheet.getRange(2, 12, nRows, 1);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('⚠️')
      .setBackground('#fce8e6').setFontColor('#a61c00')
      .setRanges([alertRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('✓')
      .setBackground('#d9ead3').setFontColor('#274e13')
      .setRanges([alertRange]).build(),
  ]);

  sheet.autoResizeColumns(1, hdrs.length);
}

// ─────────────────────────────────────────────
// ESCRIBIR HISTORIAL
// ─────────────────────────────────────────────
function _escribirHistorial(cerradas, flujosPorTicker) {
  const sheet = _getSheet(HOJAS.HISTORIAL);

// Eliminar la hoja y recrearla para evitar conflictos de formato
const ss    = SpreadsheetApp.getActiveSpreadsheet();
const idx   = sheet.getIndex();
ss.deleteSheet(sheet);
const sheetNueva = ss.insertSheet(HOJAS.HISTORIAL, idx - 1);

  const hdrs = [
    'Ticker','Nombre','Clase','Tipo',
    'G/P Realizada USD','Ingresos USD','Retorno Total USD',
    'Primera Compra','Última Op.','TIR'
  ];
  _setHeaders(HOJAS.HISTORIAL, hdrs);

  if (cerradas.length === 0) {
    sheetNueva.getRange('A2').setValue('No hay posiciones cerradas todavía.');
    return;
  }

  cerradas.sort((a, b) =>
    (b.gananciaRealizada + b.ingresos) - (a.gananciaRealizada + a.ingresos)
  );

  const rows = cerradas.map(pos => [
    pos.tickerBase,
    pos.nombre,
    pos.clase      || '',
    pos.tipoActivo || '',
    pos.gananciaRealizada,
    pos.ingresos,
    pos.gananciaRealizada + pos.ingresos,
    pos.primeraCompra || '',
    pos.ultimaOp      || '',
    '',
  ]);

  const nRows = rows.length;
  sheetNueva.getRange(2, 1, nRows, hdrs.length).setValues(rows);
  sheetNueva.getRange(2, 5, nRows, 3).setNumberFormat('"USD" #,##0.00');

  // TIR por posición cerrada
  cerradas.forEach((pos, i) => {
    const r      = i + 2;
    const flujos = flujosPorTicker[pos.tickerBase] || [];
    if (flujos.length > 0) {
      const tir = _xirr(flujos);
      if (tir !== null) {
        sheetNueva.getRange(r, 10).setValue(tir).setNumberFormat('0.00%');
      }
    }
  });

  // Totales
  const totalRow = nRows + 2;
  sheetNueva.getRange(totalRow, 4).setValue('TOTAL').setFontWeight('bold');
  sheetNueva.getRange(totalRow, 5).setFormula(`=SUM(E2:E${nRows+1})`)
    .setNumberFormat('"USD" #,##0.00').setFontWeight('bold');
  sheetNueva.getRange(totalRow, 6).setFormula(`=SUM(F2:F${nRows+1})`)
    .setNumberFormat('"USD" #,##0.00').setFontWeight('bold');
  sheetNueva.getRange(totalRow, 7).setFormula(`=SUM(G2:G${nRows+1})`)
    .setNumberFormat('"USD" #,##0.00').setFontWeight('bold');

  // Formato condicional Retorno y TIR
  const retRange = sheetNueva.getRange(2, 7, nRows, 1);
  const tirRange = sheetNueva.getRange(2, 10, nRows, 1);
  const reglas   = [];
  [retRange, tirRange].forEach(rng => {
    reglas.push(SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0)
      .setBackground('#d9ead3').setFontColor('#274e13')
      .setRanges([rng]).build());
    reglas.push(SpreadsheetApp.newConditionalFormatRule()
      .whenNumberLessThan(0)
      .setBackground('#fce8e6').setFontColor('#a61c00')
      .setRanges([rng]).build());
  });
  sheetNueva.setConditionalFormatRules(reglas);
  sheetNueva.autoResizeColumns(1, hdrs.length);
}

// ─────────────────────────────────────────────
// ESCRIBIR FLUJOS TIR
// ─────────────────────────────────────────────
function _escribirFlujosTIR(movs) {
  const sheet = _getSheet(HOJAS.FLUJOS_TIR);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, 6).setValues([[
    'Fecha', 'Flujo Total USD',
    'Depósitos/Extracciones',
    'Renta Variable', 'Renta Fija', 'Renta Mixta'
  ]]);

  // Cargar equivalencias para saber la clase de cada ticker
  const eqMap = _cargarEquivalencias();

  const flujos = [];

  movs.forEach(m => {
    const fecha    = m.fecha;
    const tipo     = m.tipo;
    const ticker   = m.tickerBase;
    const montoUSD = m.montoUSD || 0;

    // Flujo de depósitos/extracciones (col C)
    if (tipo === 'DEPOSITO') {
      flujos.push({ fecha, total: -Math.abs(montoUSD), deposito: -Math.abs(montoUSD), rv: 0, rf: 0, rm: 0 });
      return;
    }
    if (tipo === 'EXTRACCION' || tipo === 'CREDITO') {
      flujos.push({ fecha, total: Math.abs(montoUSD), deposito: Math.abs(montoUSD), rv: 0, rf: 0, rm: 0 });
      return;
    }

    // Flujos operativos por clase
    if (!ticker || montoUSD === null) return;
    if (['CREDITO','DEBITO','OTRO'].includes(tipo)) return;

    const eq    = eqMap[ticker] || eqMap[m.tickerIOL] || {};
    const clase = m.clase || eq.clase || '';

    let flujoDir = 0;
    if (['COMPRA','SUSCRIPCION_FCI','TRANSF_IN'].includes(tipo)) {
      flujoDir = -Math.abs(montoUSD);
    } else if (['VENTA','RESCATE_FCI','TRANSF_OUT'].includes(tipo)) {
      flujoDir = Math.abs(montoUSD);
    } else if (['RENTA','DIVIDENDO'].includes(tipo) && montoUSD > 0) {
      flujoDir = Math.abs(montoUSD);
    } else if (tipo === 'AMORTIZACION' && montoUSD > 0) {
      flujoDir = Math.abs(montoUSD);
    }

    if (flujoDir === 0) return;

    const rv = clase === 'Renta Variable' ? flujoDir : 0;
    const rf = clase === 'Renta Fija'     ? flujoDir : 0;
    const rm = clase === 'Renta Mixta'    ? flujoDir : 0;

    flujos.push({ fecha, total: 0, deposito: 0, rv, rf, rm });
  });

  if (flujos.length === 0) return;

  flujos.sort((a, b) => a.fecha < b.fecha ? -1 : 1);

  const rows = flujos.map(f => [f.fecha, f.total, f.deposito, f.rv, f.rf, f.rm]);
  sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  sheet.getRange(2, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, 2, rows.length, 5).setNumberFormat('"USD" #,##0.00');

  // Último flujo: valor actual por clase
  const ultimaFila = rows.length + 2;
  sheet.getRange(ultimaFila, 1).setValue(new Date()).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(ultimaFila, 2).setFormula(
    `=IFERROR(SUM(Posiciones!G:G)+IFERROR(VLOOKUP("Efectivo USD disponible";Portfolio!A:B;2;0);0)+IFERROR(VLOOKUP("Efectivo ARS disponible";Portfolio!A:B;2;0)/INDEX(CCL!B:B;MATCH(MAX(CCL!A:A);CCL!A:A;0));0);0)`
  );
  sheet.getRange(ultimaFila, 4).setFormula(
    `=IFERROR(SUMIF(Posiciones!X:X;"Renta Variable";Posiciones!G:G);0)`
  );
  sheet.getRange(ultimaFila, 5).setFormula(
    `=IFERROR(SUMIF(Posiciones!X:X;"Renta Fija";Posiciones!G:G);0)`
  );
  sheet.getRange(ultimaFila, 6).setFormula(
    `=IFERROR(SUMIF(Posiciones!X:X;"Renta Mixta";Posiciones!G:G);0)`
  );
}
// ─────────────────────────────────────────────
// XIRR
// ─────────────────────────────────────────────
function _xirr(flujos) {
  if (!flujos || flujos.length < 2) return null;
  if (!flujos.some(f => f.monto > 0)) return null;
  if (!flujos.some(f => f.monto < 0)) return null;

  const fechaBase = new Date(flujos[0].fecha + 'T12:00:00Z');

  const npv = (tasa) => flujos.reduce((sum, f) => {
    const dias = (new Date(f.fecha + 'T12:00:00Z') - fechaBase) / (1000 * 60 * 60 * 24);
    return sum + f.monto / Math.pow(1 + tasa, dias / 365);
  }, 0);

  let tasa = 0.1;
  for (let i = 0; i < 100; i++) {
    const fv = npv(tasa);
    const df = flujos.reduce((sum, fl) => {
      const dias = (new Date(fl.fecha + 'T12:00:00Z') - fechaBase) / (1000 * 60 * 60 * 24);
      return sum - (dias / 365) * fl.monto / Math.pow(1 + tasa, dias / 365 + 1);
    }, 0);
    if (Math.abs(df) < 1e-10) break;
    const nuevaTasa = tasa - fv / df;
    if (Math.abs(nuevaTasa - tasa) < 1e-6) { tasa = nuevaTasa; break; }
    tasa = nuevaTasa;
    if (tasa <= -1) tasa = -0.999;
  }
  if (!isFinite(tasa) || tasa <= -1) return null;
  if (tasa > 20 || tasa < -0.999) return null;
  return tasa;
}

// ─────────────────────────────────────────────
// INICIALIZAR HOJA INGRESOS_EGRESOS
// ─────────────────────────────────────────────
function _inicializarIngresosEgresos() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(HOJAS.INGRESOS_EGRESOS);
  if (!sheet) {
    sheet = ss.insertSheet(HOJAS.INGRESOS_EGRESOS);
  }

  // Solo crear headers si la hoja está vacía
  if (sheet.getLastRow() > 0) return;

  sheet.getRange(1, 1, 1, 4)
    .setValues([['Fecha', 'Tipo', 'Monto', 'Moneda']])
    .setBackground('#1a73e8').setFontColor('white')
    .setFontWeight('bold').setHorizontalAlignment('center');

  // Nota
  sheet.getRange(2, 1, 1, 4)
    .setValue(
      '💡 Ingresá acá depósitos y extracciones manualmente.\n' +
      'Tipo: "Depósito" o "Extracción" | Moneda: "ARS" o "USD"'
    )
    .setFontColor('#666666').setFontStyle('italic').setWrap(true);
  sheet.setRowHeight(2, 50);

  // Formato de la columna Fecha
  sheet.getRange('A3:A1000').setNumberFormat('dd/mm/yyyy');
  sheet.autoResizeColumns(1, 4);
}

// ─────────────────────────────────────────────
// INICIALIZAR HOJAS
// ─────────────────────────────────────────────
function inicializarHojas() {
  const ui = SpreadsheetApp.getUi();
  const r  = ui.alert(
    '¿Crear/verificar todas las hojas del sistema?\n\n' +
    'Las hojas existentes no se borran.',
    ui.ButtonSet.YES_NO
  );
  if (r !== ui.Button.YES) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.values(HOJAS).forEach(nombre => {
    if (!ss.getSheetByName(nombre)) ss.insertSheet(nombre);
  });

  _setHeaders(HOJAS.MOVIMIENTOS, [
    'Nro. de Mov.','Nro. de Boleto','Tipo Mov.','Concert.','Liquid.',
    'Est','Cant. titulos','Precio','Comis.','Iva Com.','Otros Imp.',
    'Monto','Observaciones','Tipo Cuenta'
  ]);
  _setHeaders(HOJAS.CCL, ['Fecha','CCL','','⬅ Pegá acá el MEP histórico (col A=fecha, col B=valor)']);
  _setHeaders(HOJAS.EQUIVALENCIAS, [
    'Ticker_IOL','Ticker_Base','Ticker_NYSE','Nombre',
    'Moneda_Op','Clase','Tipo','Emisor_ON','Exchange_NYSE','Estado'
  ]);
  _setHeaders(HOJAS.RATIOS, [
    'Ticker_Base','Ratio_CEDEAR','Ratio_Subyacente',
    '','⬅ X:Y = X CEDEARs equivalen a Y acciones subyacentes'
  ]);

  _inicializarIngresosEgresos();
  _inicializarConfig();
  poblarEquivalencias();
  poblarRatios();

  ui.alert(
    '✅ Hojas verificadas.\n\n' +
    'PRÓXIMOS PASOS:\n\n' +
    '1️⃣  Menú → 🔐 Configurar Acceso IOL\n' +
    '2️⃣  Revisá la hoja "Config" — ahí se ajustan los targets de\n' +
    '     asignación y los umbrales de riesgo para ESTA planilla\n' +
    '     (cada persona puede tener los suyos, sin tocar el código)\n' +
    '3️⃣  Verificá que CCL tenga datos históricos de MEP\n' +
    '4️⃣  Ejecutá "🔄 Actualizar Todo"'
  );
}

// ─────────────────────────────────────────────
// POBLAR EQUIVALENCIAS Y RATIOS
// (mismas funciones que v2.0 — sin cambios)
// ─────────────────────────────────────────────
function poblarEquivalencias() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(HOJAS.EQUIVALENCIAS);
  if (!sheet) return;

  const datos = [
    ['AAPL','AAPL','AAPL','Apple Inc.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['AAPLD','AAPL','AAPL','Apple Inc. (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['ADBE','ADBE','ADBE','Adobe Systems','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['ADBED','ADBE','ADBE','Adobe Systems (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['ADCGLOA','ADCGLOA','','FCI/ON Adcap Global USD','USD','Renta Fija','FCI','Adcap',''],
    ['ADCUSAD','ADCUSAD','','FCI Adcap USD','USD','Renta Fija','FCI','Adcap',''],
    ['ADRDOLA','ADRDOLA','','FCI Adcap/ARS','ARS','Renta Fija','FCI','Adcap',''],
    ['AE38','AE38','','Bono Soberano AE38 (Ley Local)','ARS','Renta Fija','Bono','Tesoro Nacional',''],
    ['AE38D','AE38','','Bono Soberano AE38 USD','USD','Renta Fija','Bono','Tesoro Nacional',''],
    ['AL30','AL30','','Bono Soberano AL30 (Ley Local)','ARS','Renta Fija','Bono','Tesoro Nacional',''],
    ['AL30D','AL30','','Bono Soberano AL30 USD','USD','Renta Fija','Bono','Tesoro Nacional',''],
    ['AL29D','AL29D','','Bono Soberano AL29 USD','USD','Renta Fija','Bono','Tesoro Nacional',''],
    ['AL35D','AL35D','','Bono Soberano AL35 USD','USD','Renta Fija','Bono','Tesoro Nacional',''],
    ['AMAT','AMAT','AMAT','Applied Materials Inc.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['AMATD','AMAT','AMAT','Applied Materials Inc. USD','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['AMD','AMD','AMD','Advanced Micro Devices','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['AMDD','AMD','AMD','Advanced Micro Devices (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['AMGN','AMGN','AMGN','Amgen Inc.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['AMZN','AMZN','AMZN','Amazon.com Inc.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['AMZND','AMZN','AMZN','Amazon.com Inc. (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['ARKK','ARKK','ARKK','ARK Innovation ETF','ARS','Renta Variable','ETF','','NYSE'],
    ['ASML','ASML','ASML','ASML Holding N.V.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['ASMLD','ASML','ASML','ASML Holding (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['AXP','AXP','AXP','American Express Co.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['AXPD','AXP','AXP','American Express Co. (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['BA.C','BA.C','BAC','Bank of America','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['BAC','BA.C','BAC','Bank of America','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['BABA','BABA','BABA','Alibaba Group','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['BDC28','BDC28','','Bono Dual BDC28','ARS','Renta Fija','Bono','Tesoro Nacional',''],
    ['BKNG','BKNG','BKNG','Booking Holdings','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['BKNGD','BKNG','BKNG','Booking Holdings (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['BMA','BMA','BMA','Banco Macro S.A.','ARS','Renta Variable','Accion','',''],
    ['BMA.D','BMA','BMA','Banco Macro S.A. USD','USD','Renta Variable','Accion','',''],
    ['BPOA7','BPOA7','','BOPREAL Serie 1A 2027','ARS','Renta Fija','Bono','BCRA',''],
    ['BPOB7','BPOB7','','BOPREAL Serie 1B 2027','ARS','Renta Fija','Bono','BCRA',''],
    ['BPOC7','BPOC7','','BOPREAL Serie 1C 2027','ARS','Renta Fija','Bono','BCRA',''],
    ['BPOD7','BPOD7','','BOPREAL Serie 1-D 2027','ARS','Renta Fija','Bono','BCRA',''],
    ['BPD7D','BPOD7','','BOPREAL Serie 1-D2 2027 (BCRA)','USD','Renta Fija','Bono','BCRA',''],
    ['BPY26','BPY6','','BOPREAL Serie 3 - 2026 (BCRA)','ARS','Renta Fija','Bono','BCRA',''],
    ['BRKB','BRKB','BRK-B','Berkshire Hathaway B','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['BRKBD','BRKB','BRK-B','Berkshire Hathaway B (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['BYMA','BYMA','','BYMA','ARS','Renta Variable','Accion','',''],
    ['C','C','C','Citigroup Inc.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['COIN','COIN','COIN','Coinbase Global','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['COPX','COPX','COPX','Global X Copper Miners ETF','ARS','Renta Variable','ETF','','NYSE'],
    ['CRCEO','CRCEO','','ON CRCE serie O ARS','ARS','Renta Fija','ON','Celulosa',''],
    ['CRM','CRM','CRM','Salesforce Inc.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['CRMD','CRM','CRM','Salesforce Inc. (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['CS47D','CS47O','','ON CS serie 47 USD','USD','Renta Fija','ON','Cresud',''],
    ['CS47O','CS47O','','ON CS serie 47 ARS','ARS','Renta Fija','ON','Cresud',''],
    ['CS48D','CS48O','','ON CS serie 48 USD','USD','Renta Fija','ON','Cresud',''],
    ['CS48O','CS48O','','ON CS serie 48 ARS','ARS','Renta Fija','ON','Cresud',''],
    ['DISN','DISN','DIS','The Walt Disney Co.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['DNC3O','DNC3O','','ON Edenor Clase 3 ARS','ARS','Renta Fija','ON','Edenor',''],
    ['DNC5O','DNC5O','','ON Edenor Clase 5 ARS','ARS','Renta Fija','ON','Edenor',''],
    ['DNC7D','DNC7O','','ON Edenor Clase 7 USD','USD','Renta Fija','ON','Edenor',''],
    ['DNC7O','DNC7O','','ON Edenor Clase 7 ARS','ARS','Renta Fija','ON','Edenor',''],
    ['EEM','EEM','EEM','iShares MSCI Emerging','ARS','Renta Variable','ETF','','NYSE'],
    ['EWZ','EWZ','EWZ','iShares MSCI Brazil','ARS','Renta Variable','ETF','','NYSE'],
    ['EWZD','EWZ','EWZ','iShares MSCI Brazil (USD)','USD','Renta Variable','ETF','','NYSE'],
    ['F','F','F','Ford Motor Company','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['FD','F','F','Ford Motor Company (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['GD29','GD29','','Global 2029','USD','Renta Fija','Bono','Tesoro Nacional',''],
    ['GD30','GD30','','Global 2030 (Ley Local)','ARS','Renta Fija','Bono','Tesoro Nacional',''],
    ['GD35','GD35','','Global 2035 (Ley Local)','ARS','Renta Fija','Bono','Tesoro Nacional',''],
    ['GD38','GD38','','Global 2038','ARS','Renta Fija','Bono','Tesoro Nacional',''],
    ['GD41','GD41','','Global 2041 (Ley Local)','ARS','Renta Fija','Bono','Tesoro Nacional',''],
    ['GD41D','GD41','','Global 2041 USD','USD','Renta Fija','Bono','Tesoro Nacional',''],
    ['GLOB','GLOB','GLOB','Globant S.A.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['GLOBD','GLOB','GLOB','Globant S.A. (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['GOOGL','GOOGL','GOOGL','Alphabet Inc. (A)','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['GOGLD','GOOGL','GOOGL','Alphabet Inc. (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['IBIT','IBIT','IBIT','iShares Bitcoin Trust','ARS','Renta Variable','ETF','','NASDAQ'],
    ['IBITD','IBIT','IBIT','iShares Bitcoin Trust (USD)','USD','Renta Variable','ETF','','NASDAQ'],
    ['IBM','IBM','IBM','IBM Corp.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['IBMD','IBM','IBM','IBM Corp. (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['INTC','INTC','INTC','Intel Corp.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['IRCFD','IRCFO','','ON IRSA serie F USD','USD','Renta Fija','ON','IRSA',''],
    ['IRCFO','IRCFO','','ON IRSA serie F ARS','ARS','Renta Fija','ON','IRSA',''],
    ['IRCPD','IRCPO','','ON IRSA serie P USD','USD','Renta Fija','ON','IRSA',''],
    ['IRCPO','IRCPO','','ON IRSA serie P ARS','ARS','Renta Fija','ON','IRSA',''],
    ['JD','JD','JD','JD.com Inc.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['JDD','JD','JD','JD.com Inc. (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['JNJ','JNJ','JNJ','Johnson & Johnson','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['JNJD','JNJ','JNJ','Johnson & Johnson (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['KO','KO','KO','The Coca-Cola Co.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['KOD','KO','KO','The Coca-Cola Co. (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['LLY','LLY','LLY','Eli Lilly & Co.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['MCD','MCD','MCD',"McDonald's Corp.",'ARS','Renta Variable','CEDEAR','','NYSE'],
    ['MELI','MELI','MELI','MercadoLibre Inc.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['MELID','MELI','MELI','MercadoLibre (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['META','META','META','Meta Platforms Inc.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['METAD','META','META','Meta Platforms (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['MMM','MMM','MMM','3M Company','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['MO','MO','MO','Altria Group Inc.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['MOD','MO','MO','Altria Group Inc. (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['MR39O','MR39O','','ON Mastellone ARS','ARS','Renta Fija','ON','Mastellone',''],
    ['MR39D','MR39O','','ON Mastellone USD','USD','Renta Fija','ON','Mastellone',''],
    ['MRK','MRK','MRK','Merck & Co.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['MSFT','MSFT','MSFT','Microsoft Corp.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['MSFTD','MSFT','MSFT','Microsoft Corp. (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['NFLX','NFLX','NFLX','Netflix Inc.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['NFLXD','NFLX','NFLX','Netflix Inc. (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['NKE','NKE','NKE','Nike Inc.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['NKED','NKE','NKE','Nike Inc. (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['NU','NU','NU','Nu Holdings Ltd.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['NUD','NU','NU','Nu Holdings Ltd. (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['NVDA','NVDA','NVDA','NVIDIA Corp.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['NVDAD','NVDA','NVDA','NVIDIA Corp. (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['ORCL','ORCL','ORCL','Oracle Corp.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['PAMP','PAMP','','Pampa Energía','ARS','Renta Variable','Accion','',''],
    ['PAMPAD','PAMP','','Pampa Energía (USD)','USD','Renta Variable','Accion','',''],
    ['PBR','PBR','PBR','Petrobras','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['PBRD','PBR','PBR','Petrobras (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['PEP','PEP','PEP','PepsiCo Inc.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['PEPD','PEP','PEP','PepsiCo Inc. (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['PFE','PFE','PFE','Pfizer Inc.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['PFED','PFE','PFE','Pfizer Inc. (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['PLTR','PLTR','PLTR','Palantir Technologies','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['PRPEDOB','PRPEDOB','','FCI Premier Performance Dólares B','USD','Renta Fija','FCI','',''],
    ['PRERMDB','PRERMDB','','FCI Premier Renta Mixta Dólares B','USD','Renta Fija','FCI','',''],
    ['PYPL','PYPL','PYPL','PayPal Holdings','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['QQQ','QQQ','QQQ','Invesco QQQ Trust','ARS','Renta Variable','ETF','','NASDAQ'],
    ['QQDD','QQQ','QQQ','Invesco QQQ Trust (USD)','USD','Renta Variable','ETF','','NASDAQ'],
    ['RIO','RIO','RIO','Rio Tinto PLC','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['RIOD','RIO','RIO','Rio Tinto PLC (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['RUCAD','RUCAO','','ON MSU Energy Clase 10 USD','USD','Renta Fija','ON','MSU Energy',''],
    ['RUCAO','RUCAO','','ON MSU Energy Clase 10 ARS','ARS','Renta Fija','ON','MSU Energy',''],
    ['RUCDD','RUCDO','','ON MSU Energy Clase 12 USD','USD','Renta Fija','ON','MSU Energy',''],
    ['SBUX','SBUX','SBUX','Starbucks Corp.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['SHOP','SHOP','SHOP','Shopify Inc.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['SLV','SLV','SLV','iShares Silver Trust','ARS','Renta Variable','ETF','','NYSE'],
    ['SMH','SMH','SMH','VanEck Semiconductors','ARS','Renta Variable','ETF','','NASDAQ'],
    ['SPGI','SPGI','SPGI','S&P Global Inc.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['SPGID','SPGI','SPGI','S&P Global Inc. (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['SPOT','SPOT','SPOT','Spotify Technology S.A.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['SPOTD','SPOT','SPOT','Spotify Technology (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['SPY','SPY','SPY','SPDR S&P 500 ETF','ARS','Renta Variable','ETF','','NYSE'],
    ['SPYD','SPY','SPY','SPDR S&P 500 ETF (USD)','USD','Renta Variable','ETF','','NYSE'],
    ['T','T','T','AT&T Inc.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['TLCMD','TLCMO','','ON Telecom serie MD USD','USD','Renta Fija','ON','Telecom Argentina',''],
    ['TLCMO','TLCMO','','ON Telecom serie MD ARS','ARS','Renta Fija','ON','Telecom Argentina',''],
    ['TLCTD','TLCTO','','ON Telecom serie TD USD','USD','Renta Fija','ON','Telecom Argentina',''],
    ['TLCTO','TLCTO','','ON Telecom serie TD ARS','ARS','Renta Fija','ON','Telecom Argentina',''],
    ['TM','TM','TM','Toyota Motor Corp.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['TSLA','TSLA','TSLA','Tesla Inc.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['TSLAD','TSLA','TSLA','Tesla Inc. (USD)','USD','Renta Variable','CEDEAR','','NASDAQ'],
    ['TXN','TXN','TXN','Texas Instruments Inc.','ARS','Renta Variable','CEDEAR','','NASDAQ'],
    ['UBER','UBER','UBER','Uber Technologies','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['UNH','UNH','UNH','UnitedHealth Group Inc.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['UNHD','UNH','UNH','UnitedHealth Group (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['V','V','V','Visa Inc.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['VD','V','V','Visa Inc. (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['VALE','VALE','VALE','Vale S.A.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['VALED','VALE','VALE','Vale S.A. (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['VIST','VIST','VIST','Vista Energy S.A.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['VISTD','VIST','VIST','Vista Energy (USD)','USD','Renta Variable','CEDEAR','','NYSE'],
    ['VSCRD','VSCRO','','ON Vista Energy serie R USD','USD','Renta Fija','ON','Vista Energy',''],
    ['VSCRO','VSCRO','','ON Vista Energy serie R ARS','ARS','Renta Fija','ON','Vista Energy',''],
    ['VSCVD','VSCVO','','ON Vista Energy serie V USD','USD','Renta Fija','ON','Vista Energy',''],
    ['VSCVO','VSCVO','','ON Vista Energy serie V ARS','ARS','Renta Fija','ON','Vista Energy',''],
    ['VZ','VZ','VZ','Verizon Communications','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['WFC','WFC','WFC','Wells Fargo & Co.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['WMT','WMT','WMT','Walmart Inc.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['XLE','XLE','XLE','Energy Select SPDR','ARS','Renta Variable','ETF','','NYSE'],
    ['XLF','XLF','XLF','Financial Select SPDR','ARS','Renta Variable','ETF','','NYSE'],
    ['XLK','XLK','XLK','Technology Select SPDR','ARS','Renta Variable','ETF','','NYSE'],
    ['XLV','XLV','XLV','Health Care Select SPDR','ARS','Renta Variable','ETF','','NYSE'],
    ['XLVD','XLV','XLV','Health Care Select SPDR (USD)','USD','Renta Variable','ETF','','NYSE'],
    ['XOM','XOM','XOM','Exxon Mobil Corp.','ARS','Renta Variable','CEDEAR','','NYSE'],
    ['YFCJD','YFCJO','','ON YPF serie J USD','USD','Renta Fija','ON','YPF S.A.',''],
    ['YFCJO','YFCJO','','ON YPF serie J ARS','ARS','Renta Fija','ON','YPF S.A.',''],
    ['YM34D','YM34O','','ON YPF 2034 USD','USD','Renta Fija','ON','YPF S.A.',''],
    ['YM34O','YM34O','','ON YPF 2034 ARS','ARS','Renta Fija','ON','YPF S.A.',''],
    ['YM39D','YM39O','','ON YPF 2039 USD','USD','Renta Fija','ON','YPF S.A.',''],
    ['YM39O','YM39O','','ON YPF 2039 ARS','ARS','Renta Fija','ON','YPF S.A.',''],
    ['YMCIO','YMCIO','','ON YMC serie I ARS','ARS','Renta Fija','ON','YMC S.A.',''],
    ['YMCID','YMCIO','','ON YMC serie I USD','USD','Renta Fija','ON','YMC S.A.',''],
    ['YMCJO','YMCJO','','ON YMC serie J ARS','ARS','Renta Fija','ON','YMC S.A.',''],
    ['YMCJD','YMCJO','','ON YMC serie J USD','USD','Renta Fija','ON','YMC S.A.',''],
    ['YMCXO','YMCXO','','ON YMC serie X ARS','ARS','Renta Fija','ON','YMC S.A.',''],
    ['YMCXD','YMCXO','','ON YMC serie X USD','USD','Renta Fija','ON','YMC S.A.',''],
    ['YPFD','YPFD','','YPF S.A.','ARS','Renta Variable','Accion','',''],
    ['ZM','ZM','ZM','Zoom Video Communications','ARS','Renta Variable','CEDEAR','','NASDAQ'],
  ];

  const existentes = new Set(
    sheet.getDataRange().getValues().slice(1)
      .map(fila => String(fila[0]).trim()).filter(Boolean)
  );
  const porAgregar = datos.filter(d => !existentes.has(d[0]));
  if (porAgregar.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, porAgregar.length, 9).setValues(porAgregar);
    sheet.autoResizeColumns(1, 9);
  }
}

function poblarRatios() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(HOJAS.RATIOS);
  if (!sheet) return;

  const datos = [
    ['AAPL',20,1],['AMZN',144,1],['MSFT',30,1],['GOOGL',58,1],['NVDA',24,1],
    ['META',24,1],['TSLA',15,1],['NFLX',48,1],['BRKB',22,1],['JPM',15,1],
    ['V',18,1],['MA',33,1],['JNJ',15,1],['UNH',33,1],['HD',32,1],
    ['PG',15,1],['KO',5,1],['PEP',18,1],['MCD',24,1],['DIS',12,1],
    ['MELI',120,1],['NU',2,1],['GLOB',18,1],['BABA',9,1],['INTC',5,1],
    ['AMD',10,1],['QCOM',11,1],['AVGO',39,1],['CSCO',5,1],['IBM',15,1],
    ['ORCL',3,1],['ADBE',44,1],['CRM',18,1],['COIN',27,1],['PLTR',3,1],
    ['UBER',2,1],['PYPL',8,1],['SHOP',107,1],['BKNG',700,1],
    ['SPY',20,1],['QQQ',20,1],['GLD',50,1],['SLV',6,1],['GDX',10,1],
    ['EWZ',2,1],['EEM',5,1],['ARKK',10,1],['SMH',50,1],['IWM',10,1],
    ['XLF',2,1],['XLE',2,1],['XLK',46,1],['XLV',29,1],['COPX',5,1],
    ['VALE',2,1],['PBR',1,1],['ITUB',1,1],['FCX',3,1],['BAC',4,1],
    ['C',3,1],['WFC',5,1],['GS',13,1],['XOM',10,1],['CVX',16,1],
    ['OXY',5,1],['AMGN',30,1],['PFE',4,1],['MRK',5,1],['LLY',56,1],
    ['NKE',12,1],['SBUX',12,1],['WMT',18,1],['TGT',24,1],['COST',48,1],
    ['DISN',12,1],['F',1,1],['RIO',8,1],['SPOT',28,1],['T',4,1],
    ['TXN',10,1],['ASML',44,1],['CAT',12,1],['AUY',3,1],['HMY',2,1],
    ['VIST',2,1],['SPGI',33,1],['AXP',10,1],['IBIT',5,1],['AMAT',5,1],
  ];

  const existentes = new Set(
    sheet.getDataRange().getValues().slice(1)
      .map(fila => String(fila[0]).trim()).filter(Boolean)
  );
  const porAgregar = datos.filter(d => !existentes.has(d[0]));
  if (porAgregar.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, porAgregar.length, 3).setValues(porAgregar);
  }
}



function diagnosticarMovimientos() {
  const ui = SpreadsheetApp.getUi();
  try {
    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const sheetMov = ss.getSheetByName(HOJAS.MOVIMIENTOS);
    const datos    = sheetMov.getDataRange().getValues();

    // Detectar fecha más reciente en la hoja
let maxFecha = null;
datos.slice(1).forEach(fila => {
  const val = fila[3]; // Col D = Concert.
  let fechaObj = null;
  
  if (val instanceof Date && !isNaN(val)) {
    fechaObj = val;
  } else if (typeof val === 'number' && val > 40000) {
    // Número de serie de Excel → convertir a fecha
    // Excel cuenta desde 1/1/1900, con bug del año 1900
    fechaObj = new Date((val - 25569) * 86400 * 1000);
  } else if (typeof val === 'string' && val.includes('/')) {
    const p = val.split('/');
    if (p.length === 3) fechaObj = new Date(p[2], p[1]-1, p[0]);
  }
  
  if (fechaObj && !isNaN(fechaObj)) {
    const fd = _fmtFecha(fechaObj);
    if (fd && (!maxFecha || fd > maxFecha)) maxFecha = fd;
  }
});

    // Calcular desde donde buscaría
    let desde;
    if (maxFecha) {
      const d = new Date(maxFecha + 'T12:00:00Z');
      d.setDate(d.getDate() - 7);
      desde = _fmtFecha(d);
    } else {
      desde = 'sin fecha';
    }

    const hasta = _fmtFecha(new Date());

    // Traer operaciones
    const operaciones = _fetchIOL(
      `/api/operaciones?fechaDesde=${desde}&fechaHasta=${hasta}`
    );

    // Leer nros existentes
    const nrosMov = new Set(
      datos.slice(1).map(f => String(f[0]).trim()).filter(Boolean)
    );

    let terminadas  = 0;
    let duplicadas  = 0;
    let nuevas      = 0;
    let ejemploNuevo = null;

    operaciones.forEach(op => {
      const estado = String(op.estado || '').toLowerCase();
      if (estado !== 'terminada') return;
      terminadas++;

      const nro = String(op.numero || '').trim();
      if (nrosMov.has(nro)) {
        duplicadas++;
      } else {
        nuevas++;
        if (!ejemploNuevo) ejemploNuevo = op;
      }
    });

    ui.alert(
      `📊 DIAGNÓSTICO MOVIMIENTOS\n\n` +
      `Última fecha en hoja: ${maxFecha}\n` +
      `Buscando desde: ${desde}\n` +
      `Buscando hasta: ${hasta}\n\n` +
      `Total operaciones API: ${operaciones.length}\n` +
      `Terminadas: ${terminadas}\n` +
      `Ya en hoja (duplicadas): ${duplicadas}\n` +
      `Nuevas a agregar: ${nuevas}\n\n` +
      (ejemploNuevo ? `Ejemplo nuevo:\n${JSON.stringify(ejemploNuevo, null, 2).substring(0, 300)}` : 'Sin ejemplos nuevos')
    );

  } catch(e) {
    ui.alert('❌ Error: ' + e.message + '\n' + e.stack);
  }
}


function diagnosticarPosiciones() {
  const ui = SpreadsheetApp.getUi();
  try {
    const movs = procesarMovimientos();
    
    // Contar por tipo
    const porTipo = {};
    movs.forEach(m => {
      porTipo[m.tipo] = (porTipo[m.tipo] || 0) + 1;
    });

    // Ver cuántos tienen tickerBase
    const conTicker    = movs.filter(m => m.tickerBase).length;
    const sinTicker    = movs.filter(m => !m.tickerBase).length;
    const conMontoUSD  = movs.filter(m => m.montoUSD !== null).length;

    // Simular calcularPosiciones parcialmente
    const posiciones = {};
    movs.forEach(m => {
      if (['DEPOSITO','EXTRACCION','CREDITO','DEBITO','OTRO'].includes(m.tipo)) return;
      if (m.tipo === null) return;
      if (!m.tickerBase) return;
      if (!posiciones[m.tickerBase]) posiciones[m.tickerBase] = 0;
      posiciones[m.tickerBase]++;
    });

    const abiertas = Object.keys(posiciones).length;
    const primeros5 = movs.slice(0, 5).map(m => 
      `${m.fecha} | ${m.tipo} | ${m.tickerBase} | USD: ${m.montoUSD}`
    ).join('\n');

    ui.alert(
      `📊 DIAGNÓSTICO POSICIONES\n\n` +
      `Total movimientos procesados: ${movs.length}\n` +
      `Con tickerBase: ${conTicker}\n` +
      `Sin tickerBase: ${sinTicker}\n` +
      `Con montoUSD: ${conMontoUSD}\n\n` +
      `Tickers únicos encontrados: ${abiertas}\n\n` +
      `Tipos de movimiento:\n${JSON.stringify(porTipo, null, 2)}\n\n` +
      `Primeros 5 movimientos:\n${primeros5}`
    );
  } catch(e) {
    ui.alert('❌ Error: ' + e.message + '\n' + e.stack);
  }
}

// ═══════════════════════════════════════════════════════════════
// BLOQUE 5 — RADAR DE OPORTUNIDADES
// ═══════════════════════════════════════════════════════════════

function generarRadar() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  let sheet   = ss.getSheetByName('Radar');
  if (!sheet) sheet = ss.insertSheet('Radar');
  sheet.clearContents();
  sheet.clearFormats();

  // Paleta de colores
  const C = {
    TITULO   : '#1a1a2e',
    SUBTITULO: '#16213e',
    VERDE    : '#d4edda',
    AMARILLO : '#fff3cd',
    ROJO     : '#f8d7da',
    GRIS     : '#f8f9fa',
    BLANCO   : '#ffffff',
    TEXTO    : '#212529',
  };

  let f = 1;

  // ── Helper escribir celda ────────────────────────────────────
  function tit(fila, texto) {
    sheet.getRange(fila, 1, 1, 4).merge()
      .setValue(texto)
      .setBackground(C.TITULO)
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setFontSize(11);
  }

  function subtit(fila, cols) {
    const r = sheet.getRange(fila, 1, 1, cols);
    r.setBackground(C.SUBTITULO)
     .setFontColor('#ffffff')
     .setFontWeight('bold')
     .setFontSize(9);
  }

  function fila(fila, valores, color) {
    const r = sheet.getRange(fila, 1, 1, valores.length);
    r.setValues([valores]);
    if (color) r.setBackground(color);
  }

  // Config de ESTA planilla — targets y umbrales pueden ser distintos
  // para cada persona (Maki, Frank, Trini, ...) sin tocar el código.
  const config = _cargarConfig();

  // Posiciones — se leen UNA sola vez y se reutilizan en varias secciones
  // (concentración, arbitraje, alertas RF) en vez de re-leer la hoja cada vez.
  const posSheet = ss.getSheetByName(HOJAS.POSICIONES);
  const posData  = posSheet ? posSheet.getDataRange().getValues() : [];

  // Candidatos de Renta Variable para sugerir en el rebalanceo, según
  // qué tan cara/barata está cada tenencia vs su precio teórico (col S, índice 18).
  function _candidatosRV(direccion) {
    const candidatos = [];
    for (let i = 1; i < posData.length; i++) {
      const clase = String(posData[i][23] || '');
      if (clase !== 'Renta Variable') continue;
      const ticker = String(posData[i][0] || '').trim();
      const prima  = parseFloat(posData[i][18]);
      if (!ticker || isNaN(prima)) continue;
      candidatos.push({ ticker, prima });
    }
    candidatos.sort((a, b) => direccion === 'comprar' ? a.prima - b.prima : b.prima - a.prima);
    return candidatos.slice(0, 2).map(c => `${c.ticker} (${(c.prima * 100).toFixed(1)}%)`);
  }

  // ════════════════════════════════════════════════════════════
  // SECCIÓN 1 — DESBALANCEO Y REBALANCEO ACCIONABLE
  // ════════════════════════════════════════════════════════════
  tit(f, '  📊  DESBALANCEO VS POLÍTICA DE INVERSIÓN');
  f++;

  // Headers
  const h1 = sheet.getRange(f, 1, 1, 6);
  h1.setValues([['Clase', 'Target', 'Actual', 'Diferencia', 'Estado', 'Acción Sugerida']]);
  subtit(f, 6);
  f++;

  // Leer distribución actual y valor total desde Portfolio
  const port = ss.getSheetByName(HOJAS.PORTFOLIO);
  let pctRV = 0, pctRF = 0, pctRM = 0, totalPortfolio = 0;
  if (port) {
    const portData = port.getDataRange().getValues();
    portData.forEach(r => {
      const label = String(r[0]).trim();
      const val   = parseFloat(r[1]) || 0;
      if (label === '% Renta Variable')        pctRV = val;
      if (label === '% Renta Fija')            pctRF = val;
      if (label === '% Renta Mixta / FCI')     pctRM = val;
      if (label === 'TOTAL PORTFOLIO (USD)')   totalPortfolio = val;
    });
  }

  const targets = [
    { clase: 'Renta Variable', target: config.targetRV, actual: pctRV },
    { clase: 'Renta Fija',     target: config.targetRF, actual: pctRF },
    { clase: 'Renta Mixta / FCI', target: config.targetRM, actual: pctRM },
  ];

  targets.forEach(t => {
    const diff  = t.actual - t.target;
    const absDiff = Math.abs(diff);
    const estado = absDiff < 0.05 ? '✅ OK'
                 : absDiff < 0.10 ? '🟡 Revisar'
                 : '🔴 Desbalanceado';
    const color  = absDiff < 0.05 ? C.VERDE
                 : absDiff < 0.10 ? C.AMARILLO
                 : C.ROJO;
    const signo  = diff >= 0 ? '+' : '';

    // Monto sugerido a comprar (+) o vender (−) para volver al target.
    let accion = '—';
    if (absDiff >= config.rebalanceoMin && totalPortfolio > 0) {
      const montoAjuste = -diff * totalPortfolio;
      accion = (montoAjuste > 0 ? 'Comprar ≈ USD ' : 'Vender ≈ USD ')
        + Math.abs(montoAjuste).toFixed(0);
      if (t.clase === 'Renta Variable') {
        const candidatos = _candidatosRV(montoAjuste > 0 ? 'comprar' : 'vender');
        if (candidatos.length) accion += ' → ' + candidatos.join(', ');
      }
    }

    fila(f, [
      t.clase,
      (t.target * 100).toFixed(0) + '%',
      (t.actual * 100).toFixed(1) + '%',
      signo + (diff * 100).toFixed(1) + '%',
      estado,
      accion
    ], color);
    f++;
  });

  f++;

  // ════════════════════════════════════════════════════════════
  // SECCIÓN 2 — CONCENTRACIÓN DE RIESGO
  // ════════════════════════════════════════════════════════════
  tit(f, '  ⚠️  CONCENTRACIÓN DE RIESGO');
  f++;

  sheet.getRange(f, 1, 1, 4).setValues([[
    'Posición / Grupo', 'Tipo', '% del Portfolio', 'Estado'
  ]]);
  subtit(f, 4);
  f++;

  const posicionesRiesgo = [];
  const porTipoActivo    = {};
  const porEmisor        = {};
  let   sinClasificarUSD = 0;

  for (let i = 1; i < posData.length; i++) {
    const ticker = String(posData[i][0] || '').trim();
    if (!ticker) continue;
    const valorUSD = parseFloat(posData[i][6])  || 0; // col G
    const pct      = parseFloat(posData[i][13]) || 0; // col N — % Portfolio
    const clase    = String(posData[i][23] || '').trim(); // col X (oculta)
    const tipo     = String(posData[i][24] || '').trim() || 'Sin Tipo'; // col Y (oculta)
    const emisor   = String(posData[i][25] || '').trim(); // col Z (oculta)

    posicionesRiesgo.push({ ticker, pct });
    porTipoActivo[tipo] = (porTipoActivo[tipo] || 0) + valorUSD;
    if (emisor) porEmisor[emisor] = (porEmisor[emisor] || 0) + valorUSD;
    if (!clase) sinClasificarUSD += valorUSD;
  }

  const totalPosicionesUSD = Object.values(porTipoActivo).reduce((s, v) => s + v, 0);

  if (posicionesRiesgo.length === 0) {
    fila(f, ['Sin posiciones abiertas', '', '', ''], C.GRIS);
    f++;
  } else {
    // Top 5 posiciones individuales por concentración
    posicionesRiesgo.sort((a, b) => b.pct - a.pct);
    posicionesRiesgo.slice(0, 5).forEach(p => {
      const estado = p.pct >= config.tickerAlerta  ? '🔴 Muy concentrado'
                   : p.pct >= config.tickerRevisar ? '🟡 Revisar'
                   : '✅ OK';
      const color  = p.pct >= config.tickerAlerta  ? C.ROJO
                   : p.pct >= config.tickerRevisar ? C.AMARILLO
                   : C.VERDE;
      fila(f, [p.ticker, 'Posición individual', (p.pct * 100).toFixed(1) + '%', estado], color);
      f++;
    });

    // Concentración por emisor (ONs/Bonos del mismo emisor, cruzando toda la cartera)
    Object.entries(porEmisor).forEach(([emisor, valor]) => {
      const pct = totalPosicionesUSD > 0 ? valor / totalPosicionesUSD : 0;
      if (pct < config.tickerRevisar) return;
      const estado = pct >= config.emisorAlerta ? '🔴 Muy concentrado' : '🟡 Revisar';
      const color  = pct >= config.emisorAlerta ? C.ROJO : C.AMARILLO;
      fila(f, [emisor, 'Emisor (ON/Bono)', (pct * 100).toFixed(1) + '%', estado], color);
      f++;
    });

    // Posiciones sin clasificar en Equivalencias — riesgo "punto ciego"
    if (sinClasificarUSD > 0) {
      const pct = totalPosicionesUSD > 0 ? sinClasificarUSD / totalPosicionesUSD : 0;
      fila(f, [
        '⚠️ Sin clasificar en Equivalencias', 'Ver hoja Equivalencias',
        (pct * 100).toFixed(1) + '%', '🔴 Completar'
      ], C.ROJO);
      f++;
    }
  }

  f++;

  // Distribución por tipo de activo (informativa, para diversificar más allá de RV/RF)
  sheet.getRange(f, 1, 1, 3).setValues([['Tipo de Activo', '% del Portfolio', 'Valor USD']]);
  subtit(f, 3);
  f++;
  Object.entries(porTipoActivo)
    .sort((a, b) => b[1] - a[1])
    .forEach(([tipo, valor]) => {
      const pct = totalPosicionesUSD > 0 ? valor / totalPosicionesUSD : 0;
      fila(f, [tipo, (pct * 100).toFixed(1) + '%', 'USD ' + valor.toFixed(2)], C.BLANCO);
      f++;
    });

  f++;

  // ════════════════════════════════════════════════════════════
  // SECCIÓN 3 — REENTRADA (-10% desde última operación)
  // ════════════════════════════════════════════════════════════
  tit(f, '  🎯  OPORTUNIDADES DE REENTRADA — Renta Variable  (−10% desde última operación)');
  f++;

  sheet.getRange(f, 1, 1, 5).setValues([[
    'Ticker', 'Última Operación', 'Precio Ref. (USD)', 'Precio Actual (USD)', 'Variación'
  ]]);
  subtit(f, 5);
  f++;

  // Reutiliza los movimientos ya normalizados (con tickerBase y precioUSD
  // resueltos) en vez de re-parsear la hoja cruda con columnas que no existen.
  // El precio actual se toma de Posiciones (col E, ya calculado por
  // calcularPosiciones) en lugar de volver a golpear la API: cero requests
  // extra y consistente con lo que ya muestran las demás secciones del Radar.
  const movs          = procesarMovimientos();
  const precioActualMap = {}; // tickerBase -> precioUSD (desde Posiciones)
  for (let i = 1; i < posData.length; i++) {
    const ticker = String(posData[i][0] || '').trim();
    const precio = parseFloat(posData[i][4]) || 0; // col E — Precio USD
    if (ticker && precio > 0) precioActualMap[ticker] = precio;
  }

  // Tickers con cantidad IOL ≠ cantidad calculada (col AE, índice 30):
  // señal de split/canje que Movimientos no capturó. Comparar el precio
  // histórico contra el precio actual para ESOS tickers da variaciones
  // falsas (no son una oportunidad real), así que se excluyen de la lista
  // y se avisan aparte en vez de mezclarlos con oportunidades genuinas.
  const tickersRevisar = new Set();
  for (let i = 1; i < posData.length; i++) {
    const ticker  = String(posData[i][0] || '').trim();
    const clase   = String(posData[i][23] || ''); // col X
    const alerta  = String(posData[i][30] || ''); // col AE
    // Solo importa acá si es Renta Variable — el resto de las clases ya
    // queda afuera de Reentrada por el filtro de clase, no por esto.
    if (ticker && clase === 'Renta Variable' && alerta.includes('⚠️')) {
      tickersRevisar.add(ticker);
    }
  }

  // Splits detectados a partir de acreditaciones de títulos sin efectivo
  // (ver _calcularSplitsPorTicker) — para llevar el precio de la última
  // operación a equivalente "post-split" antes de comparar contra el
  // precio actual.
  const splitsPorTicker = _calcularSplitsPorTicker(movs);

  // Solo Renta Variable: en Renta Fija/ONs el precio baja por amortización
  // de capital (parcial o total, según cronograma) a medida que se acerca
  // el vencimiento — no es una señal de "está barato", es descuento normal
  // del valor nominal remanente. Para eso ya está la sección de Alertas
  // Renta Fija más abajo, que compara TIR (sí tiene sentido para bonos).
  const ultimaOp = {}; // tickerBase -> { fecha, fechaStr, precioUSD, tipo }
  movs.forEach(m => {
    if (!['COMPRA', 'VENTA'].includes(m.tipo)) return;
    if (!m.tickerBase) return;
    if (m.clase !== 'Renta Variable') return;
    const cantAbs = Math.abs(m.cantidad);
    const precioUSD = m.precioUSD || (cantAbs > 0 ? Math.abs(m.montoUSD) / cantAbs : 0);
    if (!precioUSD) return;

    const fecha    = new Date(m.fecha + 'T12:00:00Z');
    const existing = ultimaOp[m.tickerBase];
    if (!existing || fecha > existing.fecha) {
      ultimaOp[m.tickerBase] = { fecha, fechaStr: m.fecha, precioUSD, tipo: m.tipo };
    }
  });

  const reentradas = [];
  Object.entries(ultimaOp).forEach(([tickerBase, op]) => {
    if (tickersRevisar.has(tickerBase)) return; // posible split/canje sin detectar → no comparar

    const precioActual = precioActualMap[tickerBase] || 0;
    if (!precioActual) return;

    // Ajustar el precio de referencia por los splits ocurridos DESPUÉS de
    // esa operación — si no, un split infla artificialmente la caída.
    const factorSplit = _factorSplitDesde(splitsPorTicker, tickerBase, op.fechaStr);
    const precioRefAjustado = op.precioUSD / factorSplit;

    const variacion = (precioActual - precioRefAjustado) / precioRefAjustado;
    if (variacion <= -0.10) {
      reentradas.push({
        ticker: tickerBase,
        factorSplit,
        fechaOp: _fmtFecha(op.fecha),
        precioRef: precioRefAjustado,
        precioActual,
        variacion,
        // Una caída >40% en un solo nombre entre dos operaciones propias es
        // rara — más probable un split/evento corporativo no detectado por
        // cantidad (p.ej. si la posición ya se cerró y no queda en
        // Posiciones para cruzar). Se muestra pero marcada para chequear.
        sospechosa: variacion <= -0.40,
        tipo: op.tipo
      });
    }
  });

  if (reentradas.length === 0 && tickersRevisar.size === 0) {
    fila(f, ['Sin oportunidades de reentrada por ahora', '', '', '', ''], C.GRIS);
    f++;
  } else {
    reentradas.sort((a, b) => a.variacion - b.variacion);
    reentradas.forEach(r => {
      const signo = r.variacion >= 0 ? '+' : '';
      const variacionTxt = signo + (r.variacion * 100).toFixed(1) + '%'
        + (r.sospechosa ? ' ⚠️ verificar split' : '');
      const opTxt = r.tipo + ' ' + r.fechaOp
        + (r.factorSplit > 1.001 ? ` (ajustado x${r.factorSplit.toFixed(2)} por split)` : '');
      fila(f, [
        r.ticker,
        opTxt,
        'USD ' + r.precioRef.toFixed(2),
        'USD ' + r.precioActual.toFixed(2),
        variacionTxt
      ], r.sospechosa ? C.AMARILLO : C.VERDE);
      f++;
    });
    if (reentradas.length === 0) {
      fila(f, ['Sin oportunidades de reentrada por ahora', '', '', '', ''], C.GRIS);
      f++;
    }
  }

  if (tickersRevisar.size > 0) {
    fila(f, [
      `⚠️ ${tickersRevisar.size} ticker(s) excluidos por posible split/canje: ` +
        [...tickersRevisar].join(', '),
      'Ver columna "⚠️ Revisar Split/Canje" en Posiciones', '', '', ''
    ], C.AMARILLO);
    f++;
  }

  f++;

  // ════════════════════════════════════════════════════════════
  // SECCIÓN 4 — ARBITRAJE ARS/USD
  // ════════════════════════════════════════════════════════════
  tit(f, '  💱  ARBITRAJE ARS / USD  (prima o descuento > 1,5%)');
  f++;

  sheet.getRange(f, 1, 1, 5).setValues([[
    'Ticker', 'Precio ARS / MEP', 'Precio USD directo', 'Prima/Descuento', 'Conviene'
  ]]);
  subtit(f, 5);
  f++;

  // Cols: A=ticker, E=precioUSD, F=precioARS, S=prima/desc%, T=conviene, X=clase
  const arbitrajes = [];
  const mepActual  = _getMEPActual();

  for (let i = 1; i < posData.length; i++) {
    const ticker  = String(posData[i][0] || '').trim();
    if (!ticker || ticker === 'LIQUIDEZ') continue;
    const precioUSD  = parseFloat(posData[i][4]) || 0;
    const precioARS  = parseFloat(posData[i][5]) || 0;
    const primaDesc  = parseFloat(posData[i][18]) || 0; // col S (índice 18)
    const conviene   = String(posData[i][19] || '');    // col T (índice 19)
    const clase      = String(posData[i][23] || '');    // col X (índice 23)

    if (clase === 'Renta Mixta') continue;
    if (Math.abs(primaDesc) < 0.015) continue;
    if (!precioUSD || !precioARS) continue;

    arbitrajes.push({
      ticker,
      precioARSenUSD: mepActual > 0 ? precioARS / mepActual : 0,
      precioUSD,
      primaDesc,
      conviene
    });
  }

  if (arbitrajes.length === 0) {
    fila(f, ['Sin arbitrajes significativos por ahora', '', '', '', ''], C.GRIS);
    f++;
  } else {
    arbitrajes.sort((a, b) => Math.abs(b.primaDesc) - Math.abs(a.primaDesc));
    arbitrajes.forEach(a => {
      const color = a.primaDesc > 0 ? C.AMARILLO : C.VERDE;
      const signo = a.primaDesc >= 0 ? '+' : '';
      fila(f, [
        a.ticker,
        'USD ' + a.precioARSenUSD.toFixed(2),
        'USD ' + a.precioUSD.toFixed(2),
        signo + (a.primaDesc * 100).toFixed(1) + '%',
        a.conviene
      ], color);
      f++;
    });
  }

  f++;

  // ════════════════════════════════════════════════════════════
  // SECCIÓN 5 — ALERTAS RENTA FIJA (TIR < objetivo de Config)
  // ════════════════════════════════════════════════════════════
  const tirObjetivoPct = (config.tirRFObjetivo * 100).toFixed(0);
  tit(f, `  📉  ALERTAS RENTA FIJA  (TIR actual < ${tirObjetivoPct}%)`);
  f++;

  sheet.getRange(f, 1, 1, 4).setValues([[
    'Ticker', 'Nombre', 'TIR actual (IOL)', 'Estado'
  ]]);
  subtit(f, 4);
  f++;

  // Buscar posiciones de RF y traer TIR desde API — en batch, no una request por ticker.
  const rfTickers = [];
  for (let i = 1; i < posData.length; i++) {
    const ticker = String(posData[i][0] || '').trim();
    const clase  = String(posData[i][23] || '');
    if (!ticker || clase !== 'Renta Fija') continue;
    rfTickers.push(ticker);
  }
  const rfEndpoints  = rfTickers.map(t => `/api/BCBA/Titulos/${t}/Cotizacion`);
  const rfRespuestas = _fetchIOLBatch(rfEndpoints);

  const alertasRF = [];
  rfTickers.forEach((ticker, idx) => {
    const data = rfRespuestas[rfEndpoints[idx]];
    if (!data) return;
    const tir = parseFloat(data.tir || data.rendimiento || 0);
    if (!tir) return;
    alertasRF.push({ ticker, nombre: data.descripcion || ticker, tir });
  });

  if (alertasRF.length === 0) {
    fila(f, ['No hay posiciones de RF o TIR no disponible en API', '', '', ''], C.GRIS);
    f++;
  } else {
    alertasRF.sort((a, b) => a.tir - b.tir);
    alertasRF.forEach(r => {
      const bajo   = r.tir < config.tirRFObjetivo;
      const color  = bajo ? C.ROJO : C.VERDE;
      const estado = bajo ? '🔴 Por debajo del objetivo' : `✅ Supera ${tirObjetivoPct}%`;
      fila(f, [
        r.ticker,
        r.nombre,
        (r.tir * 100).toFixed(2) + '%',
        estado
      ], color);
      f++;
    });
  }

  // Timestamp
  f++;
  sheet.getRange(f, 1).setValue('Actualizado: ' + new Date().toLocaleString('es-AR'))
    .setFontStyle('italic').setFontColor('#6c757d');

  // Anchos de columna
  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 160);
  sheet.setColumnWidth(3, 160);
  sheet.setColumnWidth(4, 160);
  sheet.setColumnWidth(5, 180);
  sheet.setColumnWidth(6, 260);

  Logger.log('Radar generado correctamente.');
}