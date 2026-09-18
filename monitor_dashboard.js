/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         MONITOR CONSOLIDADO — Dashboard multi-cuenta          ║
 * ║         Google Apps Script — v1.0                              ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Panel de SOLO LECTURA para ver, desde el celular, un resumen  ║
 * ║  de varias planillas de monitor_iol.js a la vez (una por       ║
 * ║  persona), sin tener que abrir cada Google Sheet.              ║
 * ║                                                                 ║
 * ║  NO actualiza nada — cada persona sigue corriendo su propio    ║
 * ║  "Actualizar Todo" (a mano o con el trigger diario) en su       ║
 * ║  propia planilla. Este script solo LEE la hoja "Portfolio" de  ║
 * ║  cada una y arma una vista combinada.                          ║
 * ║                                                                 ║
 * ║  INSTALACIÓN (hacerlo UNA vez):                                ║
 * ║  1. Creá una Google Sheet nueva y en blanco (cualquier nombre, ║
 * ║     ej. "Monitor Consolidado"). NO uses ninguna de las 4        ║
 * ║     planillas existentes — esta va aparte.                     ║
 * ║  2. Extensiones → Apps Script → borrá el código de ejemplo y    ║
 * ║     pegá este archivo completo → Guardar.                       ║
 * ║  3. Volvé a la hoja → refrescá → te va a aparecer el menú       ║
 * ║     "📊 Dashboard" → "⚙️ Inicializar hoja Config".               ║
 * ║  4. En la hoja "Config" que se crea, completá el ID de la      ║
 * ║     Spreadsheet de cada persona (está en la URL de SU planilla, ║
 * ║     la parte entre /d/ y /edit) — necesitás que Frank, Trini y ║
 * ║     Jose te compartan su Google Sheet con tu cuenta de Google, ║
 * ║     alcanza con permiso de "Lector".                            ║
 * ║  5. Apps Script → Implementar → Nueva implementación → tipo     ║
 * ║     "Aplicación web".                                           ║
 * ║       - Ejecutar como: YO (tu cuenta) — así el panel usa TU     ║
 * ║         acceso de lectura a las 4 planillas.                    ║
 * ║       - Quién tiene acceso: SOLO YO — así la URL no queda       ║
 * ║         pública para cualquiera que la encuentre. Esta es la    ║
 * ║         parte que hace que sea seguro: nadie más que vos puede  ║
 * ║         abrir el panel, aunque tenga el link.                   ║
 * ║  6. Te da una URL (termina en /exec) — esa es la que agregás    ║
 * ║     como acceso directo en la pantalla de inicio del celular.   ║
 * ║     La primera vez que la abrís te va a pedir autorizar el      ║
 * ║     script con tu cuenta de Google (una sola vez).              ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const CONFIG_SHEET = 'Config';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Dashboard')
    .addItem('⚙️ Inicializar hoja Config', 'inicializarConfig')
    .addToUi();
}

// ─────────────────────────────────────────────
// CONFIG — lista de personas y el ID de cada Spreadsheet
// ─────────────────────────────────────────────
function inicializarConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG_SHEET);
  if (!sheet) sheet = ss.insertSheet(CONFIG_SHEET);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, 3).setValues([['Persona', 'ID de la Spreadsheet', 'Emoji (opcional)']]);
    sheet.getRange(1, 1, 1, 3)
      .setFontWeight('bold').setBackground('#1a73e8').setFontColor('white');
    sheet.getRange(2, 1, 4, 3).setValues([
      ['Maki',  '', '👩'],
      ['Frank', '', '👨'],
      ['Trini', '', '👧'],
      ['Jose',  '', '🧑'],
    ]);
    sheet.autoResizeColumns(1, 3);
  }

  SpreadsheetApp.getUi().alert(
    '✅ Hoja "Config" lista.\n\n' +
    'Completá el ID de la Spreadsheet de cada persona (la parte de la URL ' +
    'de SU planilla entre /d/ y /edit).\n\n' +
    'Antes tenés que pedirle a cada una que comparta su Google Sheet con ' +
    'tu cuenta de Google — con permiso de "Lector" alcanza, no hace falta ' +
    'que puedan editar nada.'
  );
}

function _leerPersonas() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET);
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1)
    .filter(f => f[0] && f[1])
    .map(f => ({
      nombre: String(f[0]).trim(),
      id:     String(f[1]).trim(),
      emoji:  String(f[2] || '💼').trim(),
    }));
}

// ─────────────────────────────────────────────
// LEER "Portfolio" de una planilla ajena, por label → valor
// ─────────────────────────────────────────────
// Portfolio (en monitor_iol.js) tiene todo en pares Columna A = label /
// Columna B = valor — no hace falta saber el número de fila de cada cosa,
// alcanza con buscar por el texto exacto de la etiqueta. Así este panel
// no se rompe si el otro script agrega o reordena filas de Portfolio.
function _mapaPortfolio(spreadsheetId) {
  try {
    const ss    = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getSheetByName('Portfolio');
    if (!sheet) return { error: 'Esa planilla no tiene una hoja "Portfolio".' };

    const datos = sheet.getDataRange().getValues();
    const mapa  = {};
    datos.forEach(fila => {
      const label = String(fila[0] || '').trim();
      if (label) mapa[label] = fila[1];
    });
    mapa.__url = ss.getUrl();
    return mapa;
  } catch (e) {
    // Motivo típico: la planilla no fue compartida con esta cuenta, o el
    // ID en Config está mal copiado.
    return { error: 'No se pudo abrir (¿está compartida con tu cuenta? ¿el ID es correcto?): ' + e.message };
  }
}

function _fmtUSD(v) {
  if (typeof v !== 'number') return v || '—';
  const signo = v < 0 ? '-USD ' : 'USD ';
  return signo + Math.abs(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _fmtPct(v) {
  if (typeof v !== 'number') return v || '—';
  return (v * 100).toFixed(2) + '%';
}

// ─────────────────────────────────────────────
// WEB APP
// ─────────────────────────────────────────────
function doGet(e) {
  const persona  = e.parameter.persona;
  const personas = _leerPersonas();

  let contenido;
  if (!persona) {
    contenido = _renderResumen(personas);
  } else {
    const p = personas.find(x => x.nombre === persona);
    contenido = p ? _renderDetalle(p) : '<div class="card">Persona no encontrada.</div>';
  }

  return HtmlService.createHtmlOutput(_layout(contenido))
    .setTitle('Monitor Consolidado')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function _layout(contenido) {
  return `<!DOCTYPE html><html><head><base target="_top">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, Arial, sans-serif; background:#0f1115; color:#e8e8e8;
         margin:0; padding:16px; max-width:480px; margin-left:auto; margin-right:auto; }
  .card { background:#1a1d24; border-radius:14px; padding:16px; margin-bottom:14px;
          box-shadow:0 1px 3px rgba(0,0,0,.3); }
  .card a { text-decoration:none; color:inherit; display:block; }
  h1 { font-size:20px; margin:0 0 16px; }
  h2 { font-size:17px; margin:0 0 4px; }
  .metric-row { display:flex; justify-content:space-between; gap:12px; padding:7px 0;
                border-bottom:1px solid #2a2d34; font-size:14px; }
  .metric-row:last-child { border-bottom:none; }
  .metric-label { color:#9aa0a6; }
  .metric-value { font-weight:600; text-align:right; }
  .pos { color:#5ec98f; }
  .neg { color:#e8685c; }
  .back { display:inline-block; margin-bottom:14px; color:#8ab4f8; text-decoration:none; font-size:14px; }
  .dist-bar { display:flex; height:10px; border-radius:5px; overflow:hidden; margin-top:10px; background:#2a2d34; }
  .dist-rv { background:#5b8def; }
  .dist-rf { background:#f2a94e; }
  .dist-rm { background:#8a8f98; }
  .dist-labels { display:flex; justify-content:space-between; font-size:11px; color:#9aa0a6; margin-top:4px; }
  .footer-link { display:block; text-align:center; margin-top:8px; font-size:13px; color:#8ab4f8; }
  .warn { color:#f2a94e; font-size:13px; }
</style></head><body>${contenido}</body></html>`;
}

function _distBar(pctRV, pctRF, pctRM) {
  const rv = typeof pctRV === 'number' ? pctRV * 100 : 0;
  const rf = typeof pctRF === 'number' ? pctRF * 100 : 0;
  const rm = typeof pctRM === 'number' ? pctRM * 100 : 0;
  return `<div class="dist-bar">
      <div class="dist-rv" style="width:${rv}%"></div>
      <div class="dist-rf" style="width:${rf}%"></div>
      <div class="dist-rm" style="width:${rm}%"></div>
    </div>
    <div class="dist-labels"><span>RV ${rv.toFixed(0)}%</span><span>RF ${rf.toFixed(0)}%</span><span>Mixta ${rm.toFixed(0)}%</span></div>`;
}

function _renderResumen(personas) {
  let out = '<h1>📊 Monitor Consolidado</h1>';

  if (personas.length === 0) {
    out += '<div class="card"><span class="warn">No hay personas configuradas todavía. ' +
      'Corré "📊 Dashboard → ⚙️ Inicializar hoja Config" desde el editor y completá la hoja Config.</span></div>';
    return out;
  }

  personas.forEach(p => {
    const m = _mapaPortfolio(p.id);
    if (m.error) {
      out += `<div class="card"><h2>${p.emoji} ${p.nombre}</h2><span class="warn">⚠️ ${m.error}</span></div>`;
      return;
    }
    const invertido = m['Costo Total Invertido (USD)'];
    const actual    = m['TOTAL PORTFOLIO (USD)'];
    const ganancia  = m['Ganancia Total Absoluta (USD)'];
    const tir       = m['TIR Anualizada (XIRR)'];
    const gClass    = typeof ganancia === 'number' ? (ganancia >= 0 ? 'pos' : 'neg') : '';

    out += `<div class="card"><a href="?persona=${encodeURIComponent(p.nombre)}">
      <h2>${p.emoji} ${p.nombre}</h2>
      <div class="metric-row"><span class="metric-label">Invertido</span><span class="metric-value">${_fmtUSD(invertido)}</span></div>
      <div class="metric-row"><span class="metric-label">Actual</span><span class="metric-value">${_fmtUSD(actual)}</span></div>
      <div class="metric-row"><span class="metric-label">Ganancia</span><span class="metric-value ${gClass}">${_fmtUSD(ganancia)}</span></div>
      <div class="metric-row"><span class="metric-label">TIR</span><span class="metric-value">${_fmtPct(tir)}</span></div>
      ${_distBar(m['% Renta Variable'], m['% Renta Fija'], m['% Renta Mixta / FCI'])}
    </a></div>`;
  });

  return out;
}

function _renderDetalle(p) {
  const m = _mapaPortfolio(p.id);
  if (m.error) {
    return `<a class="back" href="?">← Volver</a><div class="card"><span class="warn">⚠️ ${m.error}</span></div>`;
  }

  const filas = [
    ['Costo Total Invertido (USD)', 'usd'],
    ['Valor Actual Total (USD)',    'usd'],
    ['Efectivo Disponible (USD)',   'usd'],
    ['TOTAL PORTFOLIO (USD)',       'usd'],
    ['Ganancia Total Absoluta (USD)', 'usd'],
    ['Retorno Total %',             'pct'],
    ['TIR Anualizada (XIRR)',       'pct'],
    ['TIR Renta Variable',          'pct'],
    ['TIR Renta Fija',              'pct'],
    ['Renta Variable (USD)',        'usd'],
    ['Renta Fija (USD)',            'usd'],
    ['Renta Mixta / FCI (USD)',     'usd'],
    ['Posiciones Abiertas',         'num'],
    ['Posiciones Cerradas (Historial)', 'num'],
  ];

  let out = `<a class="back" href="?">← Volver</a><h1>${p.emoji} ${p.nombre}</h1><div class="card">`;
  filas.forEach(([label, tipo]) => {
    const v = m[label];
    let disp;
    if (tipo === 'usd') disp = _fmtUSD(v);
    else if (tipo === 'pct') disp = _fmtPct(v);
    else disp = (v === undefined || v === '') ? '—' : v;
    out += `<div class="metric-row"><span class="metric-label">${label.replace(' (USD)', '')}</span><span class="metric-value">${disp}</span></div>`;
  });
  out += `</div>${_distBar(m['% Renta Variable'], m['% Renta Fija'], m['% Renta Mixta / FCI'])}`;
  out += `<a class="footer-link" href="${m.__url}" target="_blank">Abrir planilla completa de ${p.nombre} →</a>`;

  return out;
}
