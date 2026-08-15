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

**Ronda 3**: `POST /cuentas-bancarias/movimientos` dio 404 en las 4
variantes probadas (con/sin `/api`, con/sin body, GET también). Esa ruta
no existe en `api.invertironline.com`.

**Corrección**: la guía (`iol-api-client-guide.md`) de ese otro proyecto de
GitHub documentaba endpoints que ese cliente ni siquiera implementa —
mirando el código fuente real (`client.py`) no hay ningún endpoint de
"cuentas-bancarias". Lo que sí tiene: `get_account_operations()` usa
`/api/v2/operaciones` — con **v2**, mientras que `importarMovimientosIOL()`
usa `/api/operaciones` sin versión. Es un candidato fuerte: v2 podría ser
el endpoint más amplio que junta trades y movimientos de cuenta (depósitos,
créditos) en un solo listado — coincide con el patrón visto en datos reales
(mismo campo de tipo con valores "Comp", "Ven", "Depo", "Credito" mezclados).

**Ronda 4**: `GET /api/v2/operaciones` respondió 200, pero con exactamente
los mismos 7 tipos que la v1 (Compra, Venta, Pago de Dividendos, Pago de
Renta, Pago de Amortización, Suscripción FCI, Rescate FCI) — nada de
depósitos ahí tampoco.

**Cierre**: se revisó el código fuente de dos proyectos de terceros que ya
consumen esta misma API y no se encontró un endpoint de movimientos de
cuenta/depósitos funcional. La documentación oficial
(`api.invertironline.com/help`, `www.invertironline.com/documentacion-api`)
quedó fuera de alcance por bloqueo de red. **Se decidió no seguir
adivinando endpoints contra cuentas reales** y mantener la carga manual en
`Ingresos_Egresos`, que ya funciona bien. El menú "🔍 Diagnóstico:
Movimientos de Cuenta" queda en el script sin usarse, por si en algún
momento se retoma con acceso a la documentación oficial.

## v3.10 — saldo disponible: fix de fallo silencioso + tildes

En la planilla de Trini, "Actualizar Todo" no trajo saldo disponible ni en
ARS ni en USD, y no se vio ningún error. Dos causas posibles y arregladas:

- `actualizarTodo()` tragaba en silencio cualquier fallo de
  `_actualizarSaldoIOL()` — solo quedaba en el log de ejecuciones, nunca
  se veía en el resumen final. Ahora el resumen avisa explícitamente
  cuando el saldo no se pudo traer, o cuando se trajo pero dio $0 en
  ambas monedas (que puede ser real, pero ahora se dice en vez de
  quedar en blanco sin explicación).
- La comparación de moneda (`moneda.includes('dolar')`) no ignoraba
  tildes — si la API devuelve "dólar" con acento para alguna cuenta,
  nunca hubiera matcheado y esa cuenta se sumaría como ARS en vez de
  USD (o quedaría afuera del todo). Ahora se normalizan tildes antes
  de comparar.
- Nuevo menú **🔍 Diagnóstico: Saldo IOL**: muestra cada cuenta con su
  moneda cruda tal como la devuelve la API, cómo se interpretó, y el
  disponible — para confirmar de un vistazo si el problema era real
  (nada en efectivo) o de parseo.

## v3.9 — Equivalencias/Ratios unificadas entre las 3 planillas

Se pidió revisar entre todos los monitores (Maki, Frank, Trini) qué
tickers ya estaban clasificados a mano en cada uno y que el script no
traía de fábrica.

- Se compararon las hojas `Equivalencias` y `Ratios_CEDEAR` reales de las
  3 planillas contra los arrays hardcodeados de `poblarEquivalencias()` /
  `poblarRatios()`.
- **Equivalencias**: 184 → 273 tickers (+89). Se excluyó un typo real
  encontrado en una de las planillas (`MSFDT`, duplicado de `MSFTD` ya
  presente) y se corrigió una inconsistencia de moneda (`RUCDO` decía
  "USD" en el nombre pero tenía ARS cargado).
- **Ratios_CEDEAR**: 89 → 104 tickers (+15). Se excluyeron 4 entradas
  duplicadas cargadas bajo el ticker USD en vez del ticker base (`BRKBD`,
  `GOGLD`, `MSFTD`, `NUD` — ya estaban bien como `BRKB`, `GOOGL`, `MSFT`,
  `NU`, y bajo la clave equivocada nunca se hubiesen usado).
- Sin duplicados dentro de cada array (verificado). Como
  `poblarEquivalencias()`/`poblarRatios()` ya solo agregan lo que falta
  en la hoja real (no pisan nada existente), correr "Inicializar Hojas"
  de nuevo en cualquiera de las 3 planillas es seguro.
- No se pudo revisar una segunda copia de "Monitor IOL Trini" que
  apareció en la búsqueda de Drive — el archivo ya no es accesible
  (borrado o movido).

## v3.8 — hoja Detalle_Compras (precio de cada compra vs actual)

Pediste de vuelta algo que tenías en monitores anteriores: una pestaña con
todas las compras históricas, precio de compra vs precio actual, para ver
cómo venís promediando. `Posiciones` solo muestra el promedio agregado por
ticker — no el detalle lote por lote.

- Nueva hoja **Detalle_Compras**: una fila por cada compra individual
  (no por ticker), de las posiciones que siguen abiertas hoy. Columnas:
  Ticker, Clase, Fecha, Cantidad, Precio Compra, Precio Actual,
  Variación %, Monto Invertido, Valor Actual, G/P, y una Nota que avisa
  cuándo el precio de compra se ajustó por un split detectado después de
  esa compra (misma lógica que ya usa Reentrada).
- La columna Variación % solo se calcula para **Renta Variable** — en
  Renta Fija se muestran igual el precio de compra y el actual (son datos
  factuales útiles), pero sin el %, por el mismo motivo por el que
  Reentrada quedó acotada a Renta Variable: el precio de un bono/ON baja
  por amortización de capital, no por estar "más barato".
- Ordenada por ticker y, dentro de cada ticker, por fecha — con un
  separador visual entre tickers para que sea fácil de leer de un vistazo.

## v3.7 — splits que llegan como Transferencia, no como Dividendo

Con datos reales apareció un caso concreto: el ajuste de ratio de CEDEAR de
BKNG (ratio 700:1, uno de los más altos) entró en `Movimientos` como
**"Transferencia de Titulos IN"** con cantidad grande y monto $0 — no como
"Pago de Dividendos", que era lo único que `_calcularSplitsPorTicker()`
sabía reconocer desde v3.4. Por eso BKNG seguía sin ajustarse y solo caía
en el filtro genérico de "caída >40%, verificar split".

- `_calcularSplitsPorTicker()` ahora también trata una `TRANSF_IN` sin
  valor en efectivo (monto ≈ 0) **sobre una posición que ya existía** como
  señal de split/ajuste de ratio, igual que ya hacía con "Pago de
  Dividendos". Una `TRANSF_IN` con monto real (transferencia de custodia
  genuina) se sigue tratando como una compra más, sin cambios.

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
