# Monitor de Inversiones IOL

Script de Google Apps Script para llevar el portfolio de InvertirOnline (IOL)
en una Google Sheet: importa movimientos vía API, calcula posiciones, costo
promedio, TIR (XIRR), MEP, y genera un "Radar" de oportunidades pensado para
una estrategia de inversión de largo plazo.

## Cómo instalarlo / actualizarlo

1. Abrí tu Google Sheet → **Extensiones → Apps Script**.
2. Pegá el contenido de [`monitor_iol.js`](./monitor_iol.js) reemplazando el
   código existente (o creá un proyecto nuevo si es la primera vez).
3. Guardá y volvé a la planilla. Debería aparecer el menú **📊 Inversiones**.
4. Primera vez: `📊 Inversiones → ⚙️ Inicializar Hojas`, después
   `🔐 Configurar Acceso IOL`, y finalmente `🔄 Actualizar Todo`.

## v3.6 (en curso) — camino a automatizar depósitos/extracciones

Hoy `importarMovimientosIOL()` solo consulta `/api/operaciones`, que trae
operaciones de mercado (compras, ventas, pagos de renta/dividendos) — **no**
depósitos ni extracciones, porque esos son movimientos de cuenta, no
operaciones. Por eso siguen necesitando carga manual en `Ingresos_Egresos`.

Se confirmó con datos reales (vía un conector de IOL disponible en la
sesión de análisis) que la API de IOL sí expone depósitos/extracciones,
solo que en un endpoint distinto al que usa el script hoy. Se agregó
**"🔍 Diagnóstico: Movimientos de Cuenta"** en el menú: prueba varios
endpoints candidatos (`/api/v2/estadocuenta`,
`/api/v2/estadocuenta/movimientos`, `/api/v2/movimientos`,
`/api/movimientos`) y muestra cuál responde con datos, para poder
confirmar el endpoint real antes de escribir la importación automática
(sin adivinar en el código de producción).

**Pendiente**: correr el diagnóstico, confirmar el endpoint correcto, y
extender `importarMovimientosIOL()` (o agregar una función nueva) para
traer depósitos/extracciones automáticamente. `Ingresos_Egresos` quedaría
como respaldo solo para lo que la API no capture.

**Ronda 1** (probada contra la cuenta real de Frank): `/api/v2/estadocuenta`
da 200 pero solo trae saldos (nada nuevo, ya lo usa `_actualizarSaldoIOL`).
`/api/v2/estadocuenta/movimientos` da 500 (Runtime Error, no 404) — el
endpoint probablemente existe pero le falta algo. `/api/v2/movimientos` y
`/api/movimientos` dan 404 — no existen.

**Ronda 2** (probada contra la cuenta real de Maki, con el número de cuenta
real en la URL): las 4 variantes con GET dieron 500 igual.

**Encontrado**: buscando en la guía de otro cliente MCP de IOL en GitHub
([fernandezpablo85/mcpiol](https://github.com/fernandezpablo85/mcpiol),
`iol-api-client-guide.md`) apareció el endpoint real — es un recurso
separado de "cuentas bancarias", no de estado de cuenta ni de operaciones,
y se consulta con **POST**, no GET (de ahí los 500 en las rondas
anteriores):

```
POST /cuentas-bancarias/movimientos
POST /cuentas-bancarias/deposito     (informar un depósito)
POST /cuentas-bancarias/extraccion   (pedir una extracción)
```

**Ronda 3**: probar `POST /cuentas-bancarias/movimientos` con body
`{fechaDesde, fechaHasta}`, con y sin prefijo `/api`, y sin body, para
confirmar la forma exacta antes de escribir la importación real.

## v3.5 — Reentrada restringida a Renta Variable

Con datos reales apareció el motivo por el que ni el ajuste de split de v3.4
alcanzaba: en Renta Fija/ONs el precio no cae porque el activo "esté barato"
sino porque va amortizando capital según su cronograma (parcial o total, a
medida que se acerca el vencimiento). Comparar precio de compra contra
precio actual ahí no tiene el mismo significado que en una acción/CEDEAR, y
modelarlo bien requeriría el cronograma de amortización de cada bono, que
no está disponible.

- La sección "Oportunidades de Reentrada" ahora filtra por
  `clase === 'Renta Variable'` — Bonos, ONs y FCI quedan afuera de esta
  comparación de precio. Para Renta Fija ya existe la sección de "Alertas
  Renta Fija" (basada en TIR vía la API de IOL), que es la comparación
  correcta para ese tipo de activo.
- El mensaje de "tickers excluidos por posible split" también se acotó a
  Renta Variable, para no mezclarlo con lo que ya queda afuera por ser
  Renta Fija.

## v3.4 — split ajustado en el PRECIO de Reentrada, no solo en la cantidad

Corrección sobre v3.3: cuando un split llega bien capturado como movimiento
("Pago de Dividendos(TICKER)" con cantidad de títulos > 0 y monto = 0 —
la misma señal que `calcularPosiciones()` ya usaba para sumar cantidad sin
tocar costo), la CANTIDAD ya quedaba correcta, pero el PRECIO de la última
Compra/Venta usado en "Reentrada" seguía siendo el precio pre-split. Eso
inflaba la caída igual, aunque la cantidad estuviera bien.

- Nuevo `_calcularSplitsPorTicker()`: recorre los movimientos de cada
  ticker en orden cronológico, va llevando la cantidad tenida en cada
  momento, y cada vez que aparece una acreditación de títulos sin
  contrapartida en efectivo calcula el ratio (`(cantidad antes +
  acreditados) / cantidad antes`) y la fecha en que pasó.
- En el Radar, el precio de la última operación se divide por el producto
  de todos los ratios de split ocurridos DESPUÉS de esa operación antes de
  comparar contra el precio actual. Si hubo ajuste, la columna "Última
  Operación" lo aclara (`ajustado x2.00 por split`).
- La detección de v3.3 (columna "⚠️ Revisar Split/Canje" en Posiciones,
  comparando contra la cantidad real de la API) queda como red de
  seguridad para el caso en que el split NO haya entrado como movimiento
  importable — ahí sigue sin poder ajustarse el precio automáticamente y
  el ticker se sigue excluyendo de Reentrada en vez de mostrar un número
  incorrecto.

## v3.3 — detección de splits/canjes de CEDEAR

La sección "Reentrada" del Radar comparaba el precio de tu última compra/venta
contra el precio actual. Si en el medio hubo un split o un cambio de ratio de
CEDEAR (que en la práctica se resuelve igual que un split: te acreditan más
títulos y el precio por título baja proporcionalmente) y ese evento no quedó
como un movimiento en `Movimientos`, la comparación queda pisada — un CEDEAR
que en realidad no se movió puede aparecer como una caída de -80%.

- `Posiciones` ahora trae dos columnas nuevas al final: **"Cantidad IOL
  (hoy)"** (lo que informa la propia API de IOL en este momento) y **"⚠️
  Revisar Split/Canje"**, que se completa sola cuando esa cantidad no
  coincide con la que sale de sumar tus movimientos históricos (más de 5%
  de diferencia).
- El script **no corrige nada solo** — no adivina el ratio del split ni
  reescribe la cantidad. Solo lo señala para que se confirme a mano (por
  ejemplo mirando la cartera real en la app de IOL).
- El Radar excluye de "Reentrada" los tickers marcados así, y los lista
  aparte en una fila de aviso. Cualquier otra caída >40% que igual pase el
  filtro se marca "⚠️ verificar split" en vez de mostrarse como una
  oportunidad lisa y llana.
- El campo de cantidad se lee de `/api/portafolio` (`activo.cantidad`, con
  un par de nombres alternativos como fallback por si la API cambia). Si
  después de correr "Actualizar Todo" la columna "Cantidad IOL (hoy)" queda
  vacía para todo, es que el nombre del campo no es el esperado — avisar
  para ajustarlo.

## v3.2 — targets/umbrales configurables por planilla

Este monitor lo usan varias personas (Maki, Frank, Trini, ...) con perfiles
de riesgo distintos, todas corriendo el mismo `monitor_iol.js`. Antes los
targets de asignación (65/20/10) y los umbrales de riesgo estaban fijos en
el código, así que cada persona necesitaba su propia copia editada del
archivo.

- Nueva hoja **Config** en cada planilla (se crea sola al correr
  "⚙️ Inicializar Hojas", "🔄 Actualizar Todo" o el nuevo menú
  "🎛️ Ver/Editar Config"): ahí se edita el target por clase y los umbrales
  de concentración/rebalanceo/TIR objetivo de Renta Fija, sin tocar código.
- Si la hoja Config no existe o un valor está vacío, se usan los defaults
  de siempre (65/20/10, 15%/25% concentración, 20% por emisor, 8% TIR RF)
  — pegar v3.2 sobre una planilla existente no cambia nada hasta que se
  edite la hoja Config.
- El benchmark de TIR de Renta Fija en `Portfolio` y el umbral de
  concentración por emisor ON en `Renta_Fija` ahora también leen ese mismo
  valor de Config, en vez de tener el 8%/20% repetido en tres lugares.

**Validado contra los datos reales de "Monitor IOL Maki"** (Drive): 45
posiciones abiertas, asignación actual 64.5% RV / 23.9% RF / 11.6% Mixta
(muy cerca del target 65/20/10). Se confirmó en producción el bug de
Reentrada de v3.1 — el Radar decía "Sin oportunidades de reentrada por
ahora" pese a tener movimientos con variación de precio real, señal de que
la sección nunca disparaba, tal como se sospechaba. También se ve que
"Alertas Renta Fija" viene vacía ("TIR no disponible en API") — no es un
bug de este script: la API de IOL simplemente no devuelve `tir`/`rendimiento`
para esos tickers de ON/Bonos vía `/Cotizacion`; quedaría pendiente
investigar un endpoint alternativo si se quiere resolver.

## v3.1 — cambios sobre v3.0 (foco: decisiones de largo plazo)

- **Fix Radar → Reentrada**: la sección de "oportunidades de reentrada" nunca
  encontraba nada porque comparaba un objeto (`{tipo, ticker}`) contra un
  array de strings, y además leía una columna "símbolo" que no existe en la
  hoja Movimientos. Ahora reutiliza `procesarMovimientos()` (ya normalizado)
  y el precio ya calculado en Posiciones.
- **Tickers sin clasificar**: antes solo se avisaba con un `alert()` que se
  perdía (y que además rompe la ejecución si corre sin UI, p. ej. en un
  trigger). Ahora los tickers nuevos se agregan automáticamente como fila
  pendiente (⚠️ COMPLETAR, fondo rojo) en la hoja `Equivalencias`, y hay un
  ítem de menú nuevo (**🔍 Tickers Pendientes**) para verlos en cualquier
  momento.
- **Concentración de riesgo** (sección nueva en el Radar): top 5 posiciones
  por % del portfolio con alerta si superan 15%/25%, concentración por
  emisor de ONs/Bonos, exposición "sin clasificar", y distribución por tipo
  de activo (CEDEAR/Acción/Bono/ON/FCI/ETF).
- **Rebalanceo accionable**: la sección de Desbalanceo ya no solo dice
  "desbalanceado" — calcula el monto en USD a comprar/vender por clase para
  volver al target (65/20/10, sin cambios) y, para Renta Variable, sugiere
  los tickers más baratos/caros según su precio teórico.
- **Eficiencia**: las cotizaciones a la API de IOL se piden en batch
  (`UrlFetchApp.fetchAll`) en vez de una request secuencial por ticker, tanto
  para los precios USD directos como para las TIR de Renta Fija en el Radar.
  El Radar además reutiliza los datos ya escritos en Posiciones en vez de
  volver a golpear la API.

## Fuera de alcance (por ahora)

Impuestos (Bienes Personales/Ganancias) y alertas automáticas por email/
triggers no se incluyeron en esta vuelta — quedaron descartados a propósito
para esta iteración.
