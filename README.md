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

## Monitor Consolidado — ver varias cuentas desde el celular

[`monitor_dashboard.js`](./monitor_dashboard.js) es un script **separado**
(vive en su propia Google Sheet en blanco, no en ninguna de las planillas
de `monitor_iol.js`) que arma un panel de solo-lectura, mobile-friendly,
con el resumen de varias cuentas a la vez — pensado para verlo desde el
celular sin depender de la app de Sheets ni de modo escritorio.

Cada tarjeta muestra Costo Invertido, Valor Actual, Ganancia, TIR y
distribución Renta Variable/Renta Fija, leídos directamente de la hoja
"Portfolio" de cada planilla — no recalcula nada, solo lee lo que
`monitor_iol.js` ya calculó ahí. Cada persona sigue actualizando su propia
planilla como siempre (a mano o con el trigger diario); este panel es
puramente de lectura.

Las instrucciones de instalación completas (crear la Sheet nueva, pegar el
script, compartir las 4 planillas como Lector, y los ajustes de
implementación que lo mantienen privado — "Ejecutar como: Yo" + "Acceso:
Solo yo") están en el comentario del encabezado del archivo.

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

## v3.46 — Benchmark S&P 500 money-weighted de verdad

Feedback directo apenas se vio v3.45 en uso: "si voy ingresando dinero
mes a mes, así no sirve el cálculo". Correcto — un CAGR simple desde el
primer depósito asume que TODO el dinero estuvo invertido desde el
primer día, algo que no pasa si depositás de forma escalonada en el
tiempo (subestima o sobrestima el benchmark según cómo haya ido el
mercado en el medio).

**Fix de fondo, no un parche**: ahora se simula, para CADA depósito/
extracción real de tu cuenta (misma fecha, mismo monto), haber
comprado/vendido S&P 500 (SPY) ese mismo día en vez de operar tu
cartera — y se le calcula el XIRR a esa plata simulada con el MISMO
método que usa tu TIR real (mismas fechas, misma ponderación). El
resultado es un número directamente comparable al de tu TIR Anualizada,
no una aproximación.

**Cómo está armado** (`Flujos_TIR`, columnas ocultas H/I/K):
- **H**: precio histórico de SPY en la fecha de cada fila (solo se pide
  para filas con Depósito/Extracción real — el `IF` corta antes de
  llegar al `GOOGLEFINANCE` en las demás filas, para no generar más
  consultas históricas de las necesarias).
- **I**: cuántas "acciones" de SPY hubiera comprado (o vendido, si es
  una extracción) ese depósito a ese precio.
- **K**: el flujo que se usa para el benchmark — igual al de la TIR real
  (columna C) en todas las filas, excepto en la fila final de "valor
  actual", donde en vez del valor real de tu cartera va el valor de
  HOY de todas las acciones de SPY simuladas (`SUM(I) × precio actual`).

Portfolio solo necesita un `XIRR(Flujos_TIR!K2:K...;Flujos_TIR!A2:A...)`
— toda la simulación vive en Flujos_TIR, igual que ya vivía ahí toda la
lógica de tu TIR real.

## v3.45 — Benchmark contra S&P 500 en Portfolio

A pedido ("comparación contra benchmark... ¿dónde lo pondrías?" → "sí").
Nueva sección "BENCHMARK" en Portfolio, justo debajo de "TIR DEL
PORTFOLIO": rendimiento anualizado del S&P 500 (SPY, vía
`GOOGLEFINANCE`) desde la fecha de tu primer flujo de capital, con un
semáforo que dice si le ganás o no a tu propia TIR Anualizada.

**Importante — no es money-weighted.** La TIR de arriba pondera cada
depósito por su fecha real (si depositaste 70% del dinero hace 3 meses,
pesa distinto que si lo depositaste hace 3 años). El benchmark del
S&P 500 es un CAGR simple: `(precio hoy / precio en tu primer flujo) ^
(365/días) - 1` — como si hubieras puesto TODO el dinero de una sola vez
el día de tu primer depósito. Si depositaste de forma escalonada en el
tiempo, los dos números no son directamente comparables uno a uno —
por eso queda en su propia sección con la aclaración explícita en la
planilla, no mezclado con la TIR de arriba. Sirve como referencia
aproximada ("¿me convenía estar afuera del mercado?"), no como
comparación exacta.

No se agregó devaluación del CCL como segundo benchmark: necesitaría el
tipo de cambio exacto en la fecha del primer flujo, y la hoja CCL solo
tiene datos desde que se empezó a usar el script — para fechas de
depósito anteriores a eso, la comparación daría error o un dato
incompleto. Se dejó solo el S&P 500, que sí tiene historial completo
vía GOOGLEFINANCE.

## v3.44 — Sacado Precio Teórico/Prima vs. NYSE (a pedido: "ni la prima etc")

Feedback directo de uso: "las comparaciones contra precio teórico no me
están siendo muy útiles". Tiene sentido — un CEDEAR se arbitra todo el
tiempo contra su subyacente (es la razón de ser del instrumento), así
que la prima/descuento contra el precio teórico (`GOOGLEFINANCE` del
ticker NYSE × ratio) casi siempre es ruido de centavos: spread, timing
de la cotización, liquidez del ratio — no una oportunidad real para
alguien que invierte a largo plazo.

**Sacado**:
- Posiciones: columnas Q (Precio Teórico USD), R (Precio Teórico ARS) y
  S (Prima/Desc %) dejan de calcularse — quedan vacías (no se borran
  para no correr los índices fijos que usa el resto del código: U/V/X/
  Y/Z siguen en el mismo lugar).
- "Conviene Operar" (col T): antes, para CEDEARs con ratio y ticker
  NYSE cargado, usaba una fórmula más compleja que metía el teórico
  ("Caro en ambas", "Barato en ambas"); ahora usa siempre la
  comparación simple ARS-vs-USD-del-mismo-ticker que ya usaban el
  resto de los casos (acciones sin ratio, ONs y bonos) — un solo
  criterio para todos.
- Radar → Sugerencia de Inversión: Renta Variable rankeaba los
  candidatos por Prima/Desc vs. teórico; ahora rankea por qué tan por
  debajo de tu propio costo promedio está cotizando cada ticker hoy —
  la lógica de "promediar a la baja", calculable con datos que ya
  tenés (Precio Prom vs. Precio Actual), sin depender de
  `GOOGLEFINANCE` ni de tener ratio/ticker NYSE cargado.

**Lo que NO se tocó**: el Arbitraje ARS/USD del Radar (v3.41) y "Conviene
Operar" ya no tienen nada que ver con el precio teórico — comparan el
mismo ticker cotizado en pesos vs. en dólares, un concepto distinto y
sin este problema (no depende de ningún arbitraje de mercado externo).

## v3.43 — CRCEO, BOPREAL e IRCFO (a pedido explícito: "encará los de CRCEO, BOPREAL e IRCFO también")

**1. CRCEO — en realidad era un bug de toda la cuenta, no solo de CRCEO.**
Investigando el caso puntual de CRCEO aparecieron las filas: casi todo
pago de Renta/Dividendos de la cuenta tiene una fila "hermana" con un
monto NEGATIVO (ej. `Pago de Dividendos(NVDA) -0,61`, repetido en
prácticamente cada dividendo de cada CEDEAR — una retención o gasto que
IOL registra aparte) — y en el caso específico de CRCEO, además, dos
correcciones puntuales con montos negativos grandes y en dólares
directo (`Pago de Renta(CRCEO US$) -12,87` y
`Pago de Amortización(CRCEO US$) -2,52`, del 26/03/2024).

Causa: `calcularPosiciones()` solo sumaba a Ingresos cuando
`montoUSD > 0` — cualquier monto negativo de Renta/Dividendos se
ignoraba en vez de restarse. Se armó un script sobre la planilla real
de Maki que suma TODAS las filas negativas de Renta/Dividendos de toda
la cuenta: 435 filas, ~USD 20 en total que no se estaban restando de
Ingresos (la mayor parte de un solo caso en dólares — CRCEO — el resto
son retenciones de centavos repartidas en cientos de pagos). Arreglado
también el mismo problema en el flujo de TIR individual por ticker, que
además invertía el signo con `Math.abs()`.

**2. BOPREAL — canje de BPO27 no transfería el costo.** El 07/03/2024,
BCRA canjeó 110 nominales de BPO27 por 110 nominales repartidos en
BPOA7 (22) + BPOB7 (22) + BPOC7 (33) + BPOD7 (33), las 5 filas con
Monto=0 (puro cambio de instrumento, sin efectivo). `calcularPosiciones()`
no tenía ningún caso para esto: leía la baja de BPO27 (Amortización,
cantidad negativa, monto $0) como si el bono se hubiera perdido
totalmente — realizando una pérdida igual a TODO el costo invertido — y
las altas de las 4 series nuevas (Amortización, cantidad positiva,
monto $0) les quedaba costo $0. Esa pérdida y esa "ganancia al vender"
quedan fantasma: se cancelan en el tiempo, pero mientras tanto
distorsionan Ganancia Realizada año por año y el G/P No Realizado de
las 4 series nuevas.

**Fix**: se agregó el caso puntual de este canje (fecha + tickers
exactos, igual que las excepciones de GD29/PBA25/BDC24/TLCPD en su
momento) — el costo de BPO27 se transfiere proporcional a los
nominales que recibió cada serie nueva, sin realizar ninguna pérdida.
No es una solución genérica para "cualquier canje" (eso necesitaría
poder distinguir un canje real de un default real con recupero $0, algo
que Movimientos no dice) — si aparece otro canje de este tipo en el
futuro, hay que agregarlo a mano con la misma lógica, con los datos
reales en mano.

**3. IRCFO — investigado, sin tocar.** El G/P No Realizado de -50% que
muestra Posiciones es real en el sentido de que el cálculo está bien
hecho con los datos que hay — pero el dato que hay es incompleto.
IRCFO hace pagos de "Amortización" en efectivo con `cantidad=0` (IOL no
dice cuánto nominal se amortizó en cada pago), así que el código los
trata como "Ingresos" en vez de como devolución parcial de capital —
correcto para el cálculo agregado (Retorno Total e TIR, que ya están
bien, por eso Opus no lo marcó como error de cálculo), pero no reduce
el costo restante, y el Valor Actual sí refleja un nominal/precio
amortizado — de ahí el corrimiento: parte de lo que debería verse como
"ya cobrado, costo recuperado" aparece en cambio como "G/P No
Realizado muy negativo" compensado por "Ingresos" más altos. Arreglarlo
bien necesitaría el cronograma real de amortización del bono (qué % de
nominal devuelve cada pago), un dato que no está en Movimientos ni en
la API — siguiendo la misma línea de "no adivinar" de los pendientes
anteriores (comisiones, movimientos de cuenta), se deja así: es un
corrimiento cosmético entre dos columnas, no un error en la plata total.

## v3.42 — Hallazgos "menores" de la revisión con Opus (Equivalencias, token, HTML)

Siguiente tanda ("Si seguí corrigiendo"): los hallazgos de bajo impacto
que quedaban pendientes de v3.38, los que se pudieron resolver con
evidencia concreta en vez de adivinar.

**1. Tres filas problemáticas en Equivalencias — confirmado bajando la
planilla real de Maki y comparando contra Movimientos.** `PAMPAD` y
`QQDD` son filas de más: mismo `Ticker_Base` y `Moneda_Op=USD` que
`PAMPD`/`QQQD` respectivamente, pero ningún movimiento real usa esos
dos tickers (los trades reales dicen `Venta(PAMPD)`/`Compra(QQQD)`).
`_cargarTickerUSD()` arma un mapa `tickerBase → ticker USD` y, si hay
dos filas USD para la misma base, se queda con la que lee último — en
el peor caso, eso deja el mapa apuntando al ticker que no existe de
verdad, y la cotización USD de esa posición queda vacía en Posiciones.
Encontrado así porque el finding de Opus mencionaba "QQDD" por nombre;
se armó un script que detecta cualquier `Ticker_Base` con más de un
ticker USD en el seed de `poblarEquivalencias()` y salieron exactamente
esos dos pares, más un tercero no mencionado por Opus: `RUCDO` estaba
sembrado con `Moneda_Op=USD`, pero es el ticker ARS del bono (el par
USD es `RUCDD`) — mismo tipo de error que TLCPD en v3.37, y relevante
para la regla general de moneda de v3.40 (hoy decide la moneda de
Compra/Venta por esta misma columna).

Quitadas `PAMPAD` y `QQDD` del seed, y corregido `RUCDO` a
`Moneda_Op=ARS`. **⚠️ Acción manual**: `poblarEquivalencias()` solo
agrega filas que faltan, nunca borra una que ya existe — si tu hoja de
Equivalencias ya tiene `PAMPAD` o `QQDD` (common a varias cuentas, se
sembraron en una versión anterior), hay que borrarlas a mano. Además
apareció una tercera fila fantasma que ni siquiera está en el código
actual: `MSFDT` (duplicado de `MSFTD`, quedó de alguna versión vieja ya
corregida) — bórrala también si existe. `RUCDO` en tu hoja real ya
estaba en ARS (correcto), así que ese no necesita corrección manual.

**2. Token IOL y saldo cacheado: ScriptProperties → UserProperties.**
`ScriptProperties` es compartido por cualquiera con acceso de edición a
la hoja — alguien con ese acceso podía leer tu token de sesión IOL
abriendo el editor de Apps Script (Ver → Propiedades del proyecto).
`UserProperties` aísla el valor a la cuenta de quien ejecuta el script
— como el Web App corre "Ejecutar como: Yo" y los triggers corren como
quien los instaló, en la práctica sigue siendo tu cuenta la que lee/
escribe, pero ya no queda expuesto a quien simplemente tenga edición
sobre la hoja. Efecto colateral esperado: la primera vez después de
este cambio hay que volver a iniciar sesión IOL (el token viejo quedó
guardado en el lugar anterior, que ya no se lee).

**3. HTML sin escapar en la nota de "última corrida" del Web App.** La
nota de A1 en Radar se mete directo en el HTML de `doGet()`. Riesgo
bajo en la práctica (la escribe el propio script — timestamps, mensajes
de error — y el acceso ya es "Solo yo"), pero un mensaje de error podría
arrastrar texto crudo de alguna respuesta de la API y nada garantiza que
no tenga caracteres como `<`/`>`. Se agregó un escape simple por las
dudas.

**Sin tocar todavía** (necesitan más verificación caso por caso antes de
tocar código, siguiendo la misma lógica de "no adivinar" de los
pendientes anteriores): reversas de renta de CRCEO que se duplican
(~USD 15), costo base del canje BOPREAL, el -50% de G/P que muestra
IRCFO en Posiciones por cómo amortiza, y 4 precios guardados como texto
en Movimientos que se leen ~100x de menos (no afecta Costo, que usa la
columna Monto, solo la columna Precio mostrada).

## v3.41 — 3 fixes de Radar (Arbitraje, Alertas RF, Sugerencia) + lock entre corridas

Siguiente tanda de pendientes de la revisión con Opus (v3.38): "Seguí" —
las 3 secciones rotas de Radar y el lock entre corridas. Quedan afuera
todavía: comisiones ausentes desde mayo 2026 (ver nota abajo) y los
hallazgos "menores" de bajo impacto.

**1. Arbitraje ARS/USD marcaba 27 CEDEARs con el mismo ~6%, siempre.**
Causa: tomaba la "Prima/Desc %" de Posiciones (col S), que es la prima
del CEDEAR contra su precio teórico de NYSE (`GOOGLEFINANCE` × ratio) —
una cuenta completamente distinta, y que solo existe para CEDEARs con
ratio y ticker NYSE cargados. El ~6% repetido en todos era en realidad
el gap estructural MEP-vs-CCL de esa fórmula, no un arbitraje ARS/USD
real. Lo que la sección necesita es la prima entre el MISMO ticker
cotizado en pesos (convertido por MEP) y en dólares — ahora se calcula
directo (`precioARS/MEP` vs `precioUSD`), la misma cuenta que ya usa la
columna "Conviene Operar" de Posiciones.

**2. Alertas Renta Fija siempre vacía.** Pedía la TIR a
`/api/BCBA/Titulos/{ticker}/Cotizacion`, pero esa cotización de IOL no
devuelve ningún campo de TIR/rendimiento para ONs/Bonos — la sección
nunca tenía nada que mostrar. La TIR money-weighted por posición ya se
calcula en Posiciones (col M, el mismo `_xirr` que usa Historial/
Portfolio/Sugerencia de Inversión) — ahora Alertas Renta Fija reutiliza
ese dato en vez de pedirle a la API un campo que no expone.

**3. Sugerencia de Inversión no usaba bien el efectivo disponible si
faltaba alguna clase.** El presupuesto se repartía entre Renta
Variable/Fija/Mixta según qué tan lejos estaba cada una de su target —
pero si no tenías ninguna posición de Renta Mixta/FCI, `pctRM=0` y el
gap de esa clase (su target completo, ej. 10%) se llevaba la mayor
parte del presupuesto para una lista de candidatos vacía a propósito
(la sugerencia nunca propone tickers nuevos). Esa porción quedaba
"sin asignar" con una nota ambigua, en vez de repartirse entre RV/RF que
sí tenían dónde sugerir. Ahora el presupuesto solo compite entre las
clases que tienen al menos un candidato real.

**4. Sin lock entre corridas simultáneas.** Si el botón del celu y el
trigger diario corrían al mismo tiempo, `importarMovimientosIOL()` no es
atómico (lee los movimientos existentes y pega los nuevos en pasos
separados) — podían duplicar filas en Movimientos o pisarse en
Historial/Posiciones a medio escribir. `_actualizarTodoCore()` ahora usa
`LockService.getScriptLock()`: si ya hay una actualización en curso, la
segunda corta con un mensaje claro ("Ya hay otra actualización en
curso...") en vez de competir por las mismas hojas.

**Sin tocar todavía — comisiones ausentes desde mayo 2026**: se
investigó si la API de IOL expone la comisión en algún campo. El
endpoint que usa `importarMovimientosIOL()` (`/api/operaciones`) no trae
ningún campo de comisión — se confirmó con una consulta real a la cuenta
(una Compra de 6 NFLX a $2.735 = $16.410 bruto). El movimiento de cuenta
sí refleja el efectivo neto con la comisión ya descontada ($16.618,49,
una diferencia de 1,27%), pero viene de un endpoint distinto que ya se
intentó replicar desde Apps Script en una ronda de diagnóstico anterior
(ver v3.x "Diagnóstico: movimientos de cuenta") y dio 404/500 en todas
sus variantes — no se encontró la forma de pegarle a ese mismo dato
desde el script con el token normal de usuario. Mantenerlo pendiente en
vez de adivinar más endpoints, siguiendo la misma decisión que ya se
tomó para depósitos/extracciones por API.

## v3.40 — Regla general de moneda (reemplaza excepciones GD29/PBA25/BDC24)

Siguiente punto pendiente de la revisión con Opus (v3.38), ahora pedido
explícitamente: "Empecemos por la regla general de moneda".

**El problema con el enfoque anterior**: desde v3.21/v3.23/v3.38,
`procesarMovimientos()` tenía una lista fija de 3 tickers "excepción"
(GD29, PBA25, BDC24) donde "Tipo Cuenta" de IOL no es confiable para saber
la moneda real de la fila. Cada excepción se había confirmado con datos
reales, pero era un parche por ticker — no escalaba (cualquier otro bono
con el mismo problema se habría leído mal hasta encontrarlo a mano) y
mezclaba dos reglas distintas bajo un solo campo ("Tipo Cuenta").

**La regla general** (validada por Opus con los datos reales de Maki, y
re-confirmada en esta vuelta contra los 2.256 movimientos con ticker de su
planilla):
- **Filas de ingreso** (Pago de Renta/Dividendos/Amortización): la moneda
  es la del sufijo `" US$"` crudo que IOL pone en el propio texto de la
  fila (ej. `"Pago de Renta(GD29 US$)"` = USD; `"Pago de Renta(PBA25)"`
  sin sufijo = ARS). No importa en qué moneda se opera el título — un bono
  puede operarse en dólares y pagar el cupón en pesos vía el agente de
  pago local (o viceversa).
- **Filas de operación** (Compra/Venta/Suscripción FCI/Rescate FCI/
  Transferencias): la moneda es la `Moneda_Op` del ticker en la hoja
  Equivalencias.
- "Tipo Cuenta" deja de usarse para decidir la moneda de filas con ticker.
  Sigue siendo el respaldo para movimientos de cuenta sin ticker
  (Depósito/Extracción/Débito/Crédito/Otro), donde no aplica ninguna de
  las dos reglas anteriores.

**Cambios de código**:
- `procesarMovimientos()`: se eliminó la lista `esARSExcepcion` (GD29/
  PBA25/BDC24) y su comentario extenso; la moneda ahora sale de las dos
  reglas de arriba.
- `importarMovimientosIOL()`: al traer operaciones desde la API, el
  sufijo `" US$"` que se sintetiza para Pago de Renta/Dividendos/
  Amortización ahora usa solo el sufijo real que manda la API
  (`esUSDSufijo`), no una inferencia desde Equivalencias — para Compra/
  Venta/FCI/Transferencias sigue valiendo el cruce con Equivalencias,
  porque esas filas nunca traen el sufijo " US$" en la API y muchos
  CEDEARs USD (GOGLD, IBITD, METAD, ...) necesitan ese cruce para no
  dividirse por el MEP de nuevo.
- `poblarEquivalencias()`: la fila semilla de GD29 pasó de `Moneda_Op =
  "USD"` a `"ARS"`, para quedar consistente con sus hermanos GD30/GD35/
  GD38/GD41 (ninguno tiene contraparte "D" en dólares en esta cuenta).

**⚠️ Acción manual pendiente para Maki**: la fila de GD29 ya existente en
la hoja Equivalencias de su planilla real sigue diciendo `Moneda_Op =
"USD"` (poblarEquivalencias() solo agrega tickers que faltan, nunca pisa
una fila que ya existe). Hay que editarla a mano — cambiar esa celda a
"ARS" — porque sin eso las Compras/Ventas de GD29 se clasificarían mal
con la regla nueva (se confirmó exactamente este caso corriendo la
validación de abajo contra su planilla real: con el valor viejo "USD" dan
10 diferencias, todas Compra/Venta de GD29; con "ARS" dan 0).

**Validación**: se descargó la planilla real de Maki y se corrió un
script en Python que recalcula la moneda de cada una de las 2.256 filas
con ticker en Movimientos con la regla vieja (exceptions hardcodeadas) y
con la regla nueva, y compara. Con el fix de Equivalencias arriba
aplicado: **0 diferencias** — la regla general reproduce exactamente el
mismo resultado que las 3 excepciones puntuales, pero sin necesidad de
mantener una lista de tickers a mano. 518 de las 2.256 filas tienen
sufijo " US$" (ingresos en dólares), 1.738 no.

**Sin verificar todavía**: esta validación corrió solo contra los datos
de Maki. No se confirmó contra las planillas de Frank, Trini o Jose —
si alguno de ellos tiene un bono/ON con el mismo patrón de "Tipo Cuenta"
poco confiable que no sea GD29/PBA25/BDC24, la regla general debería
cubrirlo igual (es justamente lo que la regla vieja no podía hacer), pero
vale la pena confirmarlo con sus datos reales antes de darlo por cerrado.

## v3.39 — Fix TIR/Ganancia Total sobrestimadas (Crédito fantasma + MEP no histórico)

Primer punto pendiente de v3.38, resuelto con un dato concreto en vez de
una suposición. Se pidió el detalle del Crédito de USD 448,88 (18/11/25)
para confirmarlo contra IOL — la captura de pantalla del broker mostró
algo más claro todavía: un **Débito de exactamente el mismo monto al día
siguiente (19/11/25)**. No es una transferencia externa ni un ingreso
real — es un movimiento interno que se revierte solo, neto $0.

Revisando el código con ese dato: el patrón que reconoce "Débito" exige
el texto "Débito - Producto" — un "Débito" pelado (como este) no
matchea nada y cae en la categoría genérica "OTRO", que ya se ignora
correctamente. Pero el "Crédito" SÍ se reconoce, y `_escribirFlujosTIR()`
lo sumaba como si fuera un **retiro real** (mismo trato que
"Extracción"). Resultado: este par que se cancela solo metía un retiro
fantasma de ~USD 449 que nunca pasó — y había más de 80 "Crédito" chicos
más (probablemente intereses) sumando lo mismo, aunque sin el mismo peso.

**Fix**: "Crédito" ahora se ignora para el cálculo de TIR/retiros, igual
que "Débito"/"Otro" — mismo criterio que cualquier interés que queda
como efectivo en la cuenta (como Pago de Renta/Dividendos, que tampoco
suman como "retiro", porque ya quedan reflejados en la valuación final).

**Segundo fix de la misma tanda**: `_leerIngresosEgresos()` convertía
CUALQUIER depósito/extracción en pesos con el MEP de HOY, sin importar
la fecha real de la fila — a pesar de que Portfolio dice literalmente
"usando MEP histórico para convertir depósitos en ARS". Ahora usa el MEP
de la fecha real de cada depósito (mismo helper `_getCCL` que ya usa
`procesarMovimientos()` para todo lo demás).

Con ambos fixes, "Total Retirado" en Portfolio debería bajar en
~USD 449-598 y la TIR Anualizada acercarse a la estimación de Opus
(~5,46% en vez de 7,20%) — quedan los demás pendientes de v3.38 por
resolver (la regla general de moneda, comisiones ausentes, Radar, lock
entre corridas).

## v3.38 — Revisión independiente (Opus): 3 fixes aplicados, varios pendientes de decisión

A pedido explícito ("revisa con fable la planilla y el código y evalúalo"),
se corrió una revisión independiente de todo el código y de la planilla
real de Maki (Fable falló por falta de créditos; se corrió con Opus en su
lugar). El agente tuvo acceso a Drive y verificó cada hallazgo contra los
datos reales, no solo leyendo el código.

**Arreglado ya** (bugs concretos, sin ambigüedad, bajo riesgo):

1. **Grave — token vencido pisaba todo con $0.** Antes, si el token de
   IOL vencía, cada función que pega contra la API (`_obtenerPreciosIOL`,
   `_fetchIOLBatch`) atrapaba el error por separado y el script seguía de
   largo calculando con precios en $0 — Posiciones/Portfolio quedaban
   pisados con valuaciones en cero, y Radar llegaba a sugerir comprar
   miles de dólares de más con el portfolio entero en $0. Esto se iba a
   disparar justo con el flujo que más se usa ahora (botón del celu,
   trigger diario) cada vez que el token de 30 min ya estuviera vencido
   al momento de correr. `_actualizarTodoCore()` ahora confirma el token
   ANTES de tocar nada — si no hay sesión válida, no actualiza nada y
   avisa, en vez de pisar datos buenos.
2. **La excepción de GD29 aplastaba sus pagos genuinamente en dólares.**
   GD29 sí tiene renta/amortización marcada "US$" (montos sensatos como
   USD: 0,73 = 0,5% de 146 nominales; 14,6 = 10% exacto) mezclada con
   pagos en pesos — pero la excepción de v3.21 trataba TODO como pesos
   sin mirar el sufijo. Resultado: ~USD 22,5 de ingresos reales se
   registraban como USD 0,04 en Historial. Ahora se respeta el sufijo
   "US$" de la fila cruda.
3. **Saldo IOL nunca se actualizaba si daba exactamente $0.** Si gastás
   todo el efectivo de una moneda, la API devuelve 0 correctamente, pero
   el código solo guardaba el saldo `if (saldoUSD > 0)` — un 0 genuino se
   descartaba y quedaba el último saldo viejo (positivo) para siempre.

**Pendiente — necesitan una decisión, no los toqué todavía:**

- **TIR/Ganancia Total sobrestimadas.** Dos causas en los datos reales:
  (a) las filas "Crédito" (85, USD 598 total) se cuentan como retiros
  cuando son dinero entrando a la cuenta (probablemente intereses, salvo
  una de USD 448,88 el 18/11/2025 que podría ser una transferencia
  externa real — hay que confirmar qué es); (b) los depósitos en pesos
  de `Ingresos_Egresos` se convierten al MEP de HOY en vez del MEP de la
  fecha del depósito (10 filas, ARS 10,5M desde mayo 2026), a pesar de
  que la etiqueta de Portfolio dice "usando MEP histórico". Recalculado:
  TIR pasaría de 7,20% a ~5,46%, y Ganancia Total de USD 4.428 a
  ~USD 3.365 (sobrestimada en ~USD 1.063).
- **Pregunta de fondo que ya tiene respuesta validada**: ¿el parche
  ticker-por-ticker (GD29/PBA25/BDC24) sigue siendo lo correcto, o ya
  conviene una regla general? El agente probó una regla general contra
  los 1.072 movimientos de renta/dividendo/amortización reales de Maki:
  **la moneda de estos pagos se puede leer del sufijo "US$" de la fila
  cruda, no de "Tipo Cuenta"** — y para Compra/Venta, de Moneda_Op en
  Equivalencias (con GD29 corregido a ARS ahí, como sus hermanos
  GD30/35/38/41). Esa regla reproduce exactamente las 25 excepciones
  hardcodeadas actuales sin ningún ticker especial, y de paso arregla el
  bug #2 de arriba. Falta: ajustar `importarMovimientosIOL()` para que
  no invente el sufijo "US$" en pagos de renta (hoy lo agrega según
  Equivalencias, lo cual rompería la nueva regla), y confirmar que el
  patrón se sostenga en Frank/Trini/Jose, no solo en esta cuenta.
- **Comisiones ausentes desde mayo 2026.** Los 106 trades importados por
  API desde entonces tienen Monto = Cant×Precio exacto, Comis = 0 — antes
  todas las compras pegadas a mano traían comisión (mediana ~1,27% del
  bruto). Afecta Costo/G-P/TIR por ticker y por clase en ~USD 200+ sobre
  USD 17,8k operados; el TIR de Portfolio no se ve afectado porque usa el
  efectivo real de la API. Falta confirmar si la API de IOL expone la
  comisión en algún campo antes de tocar nada.
- **Radar, 3 secciones con problemas**: "Arbitraje ARS/USD" filtra por la
  columna equivocada (termina marcando las 27 CEDEARs con el mismo ~6%,
  que parece ser el gap MEP-vs-CCL, no sobreprecio real) y tiene un typo
  de formato ("08%" en vez de "7,5%"); "Sugerencia de Inversión" nunca
  sugiere nada mientras el target de Renta Mixta (10%) no tenga ninguna
  posición — se come todo el presupuesto; "Alertas Renta Fija" está
  muerta porque la cotización de IOL no devuelve el campo de TIR.
- **Sin lock entre corridas simultáneas** (`LockService`) — si el botón
  del celu y el trigger diario corren a la vez, pueden duplicar filas o
  chocar en Historial.
- **Menores** (bajo impacto, no urgentes): tres filas de más en
  Equivalencias (MSFDT/PAMPAD/QQDD) hacen que QQQ se cotice mal por una
  de ellas; reversas negativas de renta (CRCEO) se ignoran y duplican
  ~USD 15; el canje BOPREAL no arrastra costo base bien; bonos que
  amortizan (IRCFO) muestran G/P de -50% en Posiciones aunque el retorno
  total y el TIR estén bien; 4 precios en Movimientos están guardados
  como texto y se leen ~100x de menos (no afecta Costo, que usa Monto);
  posible doble conteo de depósitos si se pega un export de IOL que
  solape con el rango ya cargado a mano en Ingresos_Egresos; el token
  queda en ScriptProperties (compartido entre quien edite la hoja) en vez
  de UserProperties; la nota de última corrida en la página web no
  escapa HTML (bajo riesgo, acceso ya es "Solo yo").
- **Revisado y confirmado SIN problema**: el escaneo de pares D/ARS en
  Equivalencias no encontró ningún otro TLCPD — BBD, YPFD y BMA.D son
  excepciones legítimas al patrón "D=dólar". La ganancia realizada de
  PBA25, el split de YPFD, el precio bajo de CRCEO, la pérdida de TO23 y
  los rangos de Flujos_TIR (incluido el fix de v3.29) están todos bien.

Decime cuáles de los puntos pendientes querés que encare y en qué orden.

## v3.37 — Fix TLCPD: Equivalencias tenía el par ARS/USD mal cargado

Reporte: "la compra de 500 nominales de hoy de tlcpd está poniendo mal
el monto invertido que debería ser del orden de 500usd".

Causa encontrada directo en la data, sin necesidad de reconstruir nada
con el MEP: **TLCPD estaba cargado con Moneda_Op=ARS en Equivalencias**,
igual que su par TLCPO — rompiendo el patrón D=USD que sí tenían bien
sus hermanos (TLCMD/TLCMO, TLCTD/TLCTO). Como `importarMovimientosIOL()`
usa esa misma tabla para decidir si una Compra/Venta nueva es en pesos o
dólares (`esUSD = eqMap[ticker].moneda === 'USD'`), la compra de hoy se
importó etiquetada "Inversion Argentina Pesos" en vez de "Dolares", y su
precio (que ya estaba en USD) terminó dividido por el MEP de más — el
mismo mecanismo de fondo que GD29/PBA25/BDC24, pero esta vez el error
estaba en el dato semilla de Equivalencias, no en la lógica de
conversión.

**Fix**: TLCPD corregido a Moneda_Op=USD en `poblarEquivalencias()`. Se
revisó además TODA la tabla buscando el mismo patrón (ticker-D
emparejado con su base, misma moneda en los dos) — el único caso real
era TLCPD; el otro que salió en el barrido (BBD) no es un par de
monedas, es Banco Bradesco, un ticker sin relación con BB (BlackBerry)
que coincide en terminar en D por casualidad — descartado.

**Para la fila ya importada hoy**: corregir Equivalencias (ya sea
pegando este script o a mano en la fila de TLCPD) no alcanza sola — la
fila mala ya quedó escrita en Movimientos. Hace falta además correr
"🔧 Reparar Tipo Cuenta (precios USD mal etiquetados)" para corregir esa
fila puntual, y recién después "Actualizar Todo" para que Posiciones/
Detalle_Compras recalculen con el dato bien.

## v3.36 — Ratio de TSM confirmado (9:1)

Maki confirmó el ratio real de TSM (9 CEDEARs = 1 acción ordinaria) y
completó Equivalencias ella misma. Se agregó `['TSM',9,1]` a
`poblarRatios()` — mismo formato que el resto (BABA tiene el mismo 9:1,
por ejemplo). Con esto "Precio Teórico"/arbitraje ARS-USD en Radar ya
funciona para TSM también, cerrando el pendiente que había quedado
abierto en v3.35.

## v3.35 — Agregado TSM (Taiwan Semiconductor) a Equivalencias

Alerta: "Tickers sin clasificar en Equivalencias: TSM". Se verificó contra
la API de IOL (`get_asset_info`) en vez de adivinar: TSM es un CEDEAR,
moneda ARS, con par en dólares TSMD — mismo patrón AAPL/AAPLD de siempre.
Se agregó el par completo a `poblarEquivalencias()`, así que de acá en
más se precarga solo en cualquier planilla (Maki, Frank, Trini, Jose) sin
que haga falta volver a completarlo a mano cada vez que alguien lo opera
por primera vez.

**Pendiente**: no se agregó el ratio de TSM en `Ratios_CEDEAR` — IOL no
devolvió un precio de TSM en NYSE para calcularlo contra el precio del
CEDEAR, y no hay forma de verificarlo sin inventar un número. Mientras
tanto, "Precio Teórico"/arbitraje ARS-USD para TSM en Radar no va a
funcionar (sale en blanco), pero Posiciones, Costo, G/P y TIR sí
calculan bien ya con el fix de Equivalencias solo.

## v3.34 — Link directo a la planilla desde la página del botón

Pedido: "Si haría que el enlace donde pongo el Mail y contraseña me dé el
link del monitor así de ahí ya abro el sheet". No se trataba del
Monitor Consolidado (ese sigue sin instalar) — el pedido era mucho más
puntual: desde la misma página de login/"Actualizar Todo", poder pasar
directo a la Google Sheet real, sin ir a buscarla aparte.

**Fix**: `doGet()` ahora agrega, debajo del botón "Actualizar Todo", un
link **"📄 Abrir planilla completa"** que apunta a la URL de la propia
Google Sheet (`SpreadsheetApp.getActiveSpreadsheet().getUrl()` — cada
planilla ya sabe su propia URL, no hace falta guardarla en ningún lado).
Flujo completo desde el celu: abrir el acceso directo → loguearse si
hace falta → Actualizar Todo → tocar el link → ver los datos frescos en
la Sheet real.

## v3.33 — Fix: "Actualizar Todo" desde el celu daba "Error: undefined"

Reportado con captura de pantalla: recién logueada (sesión IOL activa,
~30 min), tocó "Actualizar Todo" y el resultado fue "❌ Error: undefined"
— sin ninguna pista de qué había fallado.

**Causa**: `generarRadar()` era el único paso de `_actualizarTodoCore()`
que corría **sin** try/catch a su alrededor (todos los demás — importar
movimientos, actualizar saldo, el resto — sí lo tienen). Si tiraba algo
ahí adentro, el error se escapaba crudo fuera de la función, hasta el
cliente — y un error de Apps Script sin agarrar no siempre le llega al
navegador con `.message` poblado, de ahí el "undefined" sin contenido.

**Fix**: `generarRadar()` ahora corre dentro de su propio try/catch, igual
que el resto de los pasos — si falla, el motivo real queda en el
resultado en vez de romper todo con un mensaje vacío. Además, los
manejadores de error de la página web (login y "Actualizar Todo") ya no
muestran "undefined" pelado si el error no trae `.message` — caen a un
texto genérico legible ("Error desconocido — reintentá").

Si la próxima vez que falle generarRadar() se ve el motivo real en la
página, hay que volver a mirarlo con ese dato — esto solo evita que el
error quede mudo, no dice todavía por qué fallaba puntualmente esta vez.

## v3.32 — Se puede iniciar sesión de IOL desde el celular

Pregunta directa, después de aclarar que sin sesión activa el botón del
celu no trae datos nuevos: "¿Puedo loggearme desde el celu?"

Hasta ahora la respuesta era no: el único login posible era el popup de
`SpreadsheetApp.getUi().prompt()`, que solo existe con la planilla abierta
en el menú de Sheets — no dentro de un Web App ni en la app de Sheets
para celular.

**Fix**: la misma página web del botón "Actualizar Todo" (v3.30) ahora
tiene arriba un formulario de usuario/contraseña de IOL, con el estado
de la sesión actual ("🔓 activa (~X min)" o "🔒 vencida"). Se logueás ahí,
en el celular, sin pasar por Sheets. `_getTokenIOL()` se separó en
`_solicitarTokenIOL(usuario, password)` para que la reuse tanto el popup
del menú (uso de siempre) como este login web nuevo — mismo pedido de
token, dos formas de juntar las credenciales.

Se mantiene el mismo criterio de seguridad que ya existía y que el
usuario explícitamente eligió no cambiar: la contraseña **nunca se
guarda** en ningún lado — se usa una sola vez para pedir el token (válido
30 min) y se descarta apenas termina la función.

## v3.31 — Fix: token IOL vencido se ocultaba como "0 movimientos nuevos"

Reportado probando el botón del celu (v3.30): tocó "Actualizar Todo" y el
resultado mostró "✅ Listo, Movimientos nuevos: 0" pero también
"⚠️ Saldo: no se pudo actualizar (Cannot call SpreadsheetApp.getUi() from
this context.)".

La causa real: el token de IOL dura 30 minutos, y para renovarlo
`_getTokenIOL()` pide usuario/contraseña con un popup — algo que solo
existe si hay una sesión interactiva abierta (el menú de Sheets). Desde
el botón del celu o el trigger diario no hay eso, así que pedir el popup
directamente tira un error interno de Google poco claro. El problema no
era solo ese mensaje confuso: `importarMovimientosIOL()` atrapaba ese
mismo crash y devolvía `0` como si simplemente no hubiera movimientos
nuevos — **ocultando** que en realidad no se pudo traer nada de IOL. Con
suerte se notaba por el mensaje de saldo al lado, pero no siempre iba a
fallar también el saldo al mismo tiempo.

**Fix**: `_getTokenIOL()` ahora detecta si hay sesión interactiva antes
de intentar el popup, y si no la hay tira un error claro explicando qué
pasó y qué hacer. `importarMovimientosIOL()` ya no esconde ese error
como un `0` silencioso — lo deja subir para que se reporte como error
real.

**Lo que esto NO resuelve**: sin sesión interactiva abierta, el trigger
diario y el botón del celu solo van a poder traer datos nuevos de IOL si
el token sigue vigente de un login manual de los últimos 30 minutos —
fuera de esa ventana, la actualización automática recalcula con lo que
ya hay guardado en la planilla, pero no trae movimientos/saldo/precios
nuevos de IOL. Ahora esto se va a REPORTAR con claridad en vez de
esconderse, pero seguir necesitando login manual cada 30 min le saca
buena parte del sentido a la automatización — se está evaluando aparte
si vale la pena guardar las credenciales para renovar el token sin
intervención humana (trade-off de seguridad real, no una decisión para
tomar sin preguntar).

## v3.30 — Botón "Actualizar Todo" desde el celular (Web App)

Pedido, después de una confusión con `monitor_dashboard.js` (que es otra
cosa — solo-lectura, ver varias cuentas juntas): "Digo con mi planilla
actual yo desde el celu no puedo actualizar y eso es lo que quiero poder
hacer". El pedido real era mucho más puntual: poder correr "Actualizar
Todo" a demanda desde el celular, en la propia planilla.

La causa es simple: el menú "📊 Inversiones" (de donde sale "Actualizar
Todo") es un menú de Apps Script — **no existe en la app de Google Sheets
para celular**, solo en la versión de escritorio del navegador. Por eso
era imposible tocar ese botón desde el celu sin pedir "modo escritorio".

**Fix**: se agregó `doGet(e)` y `webActualizar()` — implementando el mismo
script como **Aplicación web** (Extensiones → Apps Script → Implementar →
Nueva implementación → Aplicación web, con "Ejecutar como: Yo" y "Acceso:
Solo yo"), da una URL con una página mínima: un botón "🔄 Actualizar
Todo" y el resultado de la última corrida. Guardada como acceso directo
en la pantalla de inicio del celular, se abre y se comporta como una app
— sin pasar por Sheets ni por ningún menú.

Reusa `actualizarTodoSilencioso()` (v3.25) tal cual — esa versión ya no
usa `SpreadsheetApp.getUi()` (necesario porque un Web App, igual que un
trigger, no tiene UI disponible), así que no hizo falta tocar nada de esa
lógica, solo exponerla.

## v3.29 — Fix Portfolio: "Flujos de Capital" solo miraba hasta la fila 999

Reporte (cuenta de Jose, mientras se investigaba otro tema de saldo): "En
la pestaña de portfolio en flujos de capital considera hasta la celda
b999 y queda mucho afuera. Fíjate si no se repite el error en otras."

Se revisaron todas las fórmulas de Portfolio que apuntan a Flujos_TIR.
Efectivamente el problema estaba **solo** en "Total Depositado (USD)" y
"Total Retirado (USD)" (sección "Flujos de Capital"): usaban
`Flujos_TIR!B2:B999`, mientras que "TIR Anualizada" y "TIR por clase"
(Renta Variable/Fija/Mixta) usaban `B2:B2000` / `D2:D2000` / etc. — el
mismo tipo de límite fijo, pero un número más grande. En una cuenta activa,
Flujos_TIR fácilmente supera las 999 filas (siempre que haya suficientes
movimientos + pagos de renta/dividendos a lo largo de los años), y esas
dos métricas quedaban truncadas **en silencio**, sin ningún error visible.

**Fix**: en vez de subir el número mágico de 999 a 2000 (que en algún
momento futuro se volvería a quedar corto para una cuenta de mucho tiempo
operando), el rango ahora se calcula del largo REAL de la hoja Flujos_TIR
en cada corrida de `_escribirPortfolio()`, con 200 filas de margen. Para
que ese cálculo use el largo actualizado (no el de la corrida anterior),
`_escribirFlujosTIR()` ahora corre ANTES que `_escribirPortfolio()` en
`calcularPosiciones()` (antes era al revés).

## v3.28 — Fix Detalle_Compras: Cantidad no se ajustaba por split (solo el Precio)

Reporte: "Veo en la columna I de la pestaña de detalle compras
inconsistencias con los precios. Ejemplo bkng. Dice en el registro de la
compra del 2025-11-19 que el precio de la operación fue de 0,27 pero en
monto usd dice 69,33 aunque se compraron 10 nominales. Huelo que el
ajuste del split funcionó mal."

Tenía razón, y era más grave de lo que parecía a simple vista: no era
solo que el Precio se viera raro — **Valor Actual y G/P de esa fila
también estaban mal calculados** (subestimados) para cualquier compra
afectada por un split posterior.

`_escribirDetalleCompras()` ajusta el Precio de cada operación histórica
dividiéndolo por el factor de split correspondiente, para que sea
comparable contra el precio de hoy (ya post-split) — eso está bien. El
problema es que la Cantidad se mostraba **sin ese mismo ajuste**: seguía
siendo la cantidad original, de antes del split. Con Precio dividido por
el split pero Cantidad intacta, "Cantidad × Precio" dejaba de cerrar
contra Monto — exactamente lo que notó Maki con BKNG (10 × 0,27 = 2,70,
muy lejos de los 69,33 reales). Y como Valor Actual se calcula como
Cantidad × Precio Actual (el precio de HOY, ya post-split), usar la
Cantidad vieja ahí también subestimaba el valor actual y la ganancia/
pérdida de esa fila por el mismo factor del split.

**Fix**: la Cantidad ahora también se multiplica por el factor de split,
igual que el Precio se divide — así ambas quedan en equivalente post-
split, "Cantidad × Precio" vuelve a reconciliar contra Monto, y Valor
Actual/G-P usan la cantidad correcta.

## v3.27 — Diagnóstico TIR Renta Fija: ahora por ticker con TODOS los flujos

Pregunta de seguimiento (cuenta de Trini), después de explicar que 4 de 5
posiciones RF cerradas (AL29, GD41, DNC7O, RUCDD) dieron pérdida: "¿Y no
tuve cobros de AL29 en ese tiempo? ¿Y lo mismo con el resto de los
activos?" — pregunta válida: el diagnóstico v3.26 solo mostraba los 15
flujos más grandes de TODA la cuenta juntos, así que un cobro de renta
chico en AL29 (si existió) podía no aparecer, aunque sí se sumaba al TIR
calculado.

**Fix**: el diagnóstico ahora agrupa por ticker (abiertos y cerrados) y
muestra TODOS sus flujos, no solo los más grandes del conjunto — así se
ve de una si hubo cobros de renta/amortización en el medio del período,
no hace falta correr "Diagnóstico: Ticker Puntual" ticker por ticker.
Ordenado por peor TIR primero, para ver de entrada cuáles son los que
están arrastrando el agregado hacia abajo.

## v3.26 — Nuevo diagnóstico: TIR Renta Fija agregado vs. por ticker

Reporte (cuenta de Trini): "El tir de renta fija en portfolio dice 1,17%
pero en posiciones las tir de los activos de renta fija va de 5,07 a
15,11%. No me cierra."

Importante entender primero: el TIR agregado de Portfolio **no** es un
promedio de los TIRs individuales de Posiciones — es un solo XIRR sobre
la suma de TODOS los flujos de Renta Fija mezclados (todas las compras,
ventas y rentas de todos los tickers, juntas). Matemáticamente puede caer
fuera del rango de los TIRs individuales sin ser un bug: el caso típico
es una compra grande y reciente que todavía no tuvo tiempo de generar
retorno y arrastra el promedio ponderado hacia abajo — no es lo mismo que
el patrón real de bug ya visto (GD29/PBA25/BDC24: moneda mal etiquetada
inflando o aplastando un flujo puntual).

Sin ver los flujos reales de la cuenta de Trini no se puede distinguir
un caso del otro a ciegas — por eso, en vez de otra ronda de conjeturas,
se agregó **"🔍 Diagnóstico: TIR Renta Fija (agregado vs. por ticker)"**:
recalcula el TIR agregado en el momento (para confirmar que coincide con
lo que muestra Portfolio) y lista los 15 flujos de Renta Fija más grandes
por magnitud, con fecha, ticker y moneda — el mismo tipo de dato que
permitió encontrar GD29 y PBA25/BDC24 antes.

## v3.25 — Actualización automática por trigger de tiempo (días hábiles)

Pedido: correr "Actualizar Todo" sola, sin depender de abrir la planilla
desde la compu (la app móvil de Sheets no soporta menús de Apps Script).

**Fix necesario primero**: `actualizarTodo()` empezaba con
`const ui = SpreadsheetApp.getUi();` como primera línea — un trigger por
tiempo corre "headless" (sin UI), así que esa línea sola tira error y mata
todo el run antes de hacer nada. Se separó en tres funciones:

- `_actualizarTodoCore()`: el trabajo real (MEP, importar movimientos,
  saldo, procesar posiciones, Radar), sin ningún `getUi()`.
- `actualizarTodo()`: la de siempre desde el menú, con los alerts.
- `actualizarTodoSilencioso()`: para el trigger — nada de alerts, deja
  constancia de cada corrida como **nota en la celda A1 de Radar** (pasar
  el mouse para ver la última: hora, movimientos nuevos, saldo, o el
  error si algo falló).

**Nuevo menú**: "⏰ Programar Actualización Diaria" pide hora y minuto
aproximados (los triggers de Apps Script no son exactos al minuto, disparan
en algún momento dentro de esa hora) e instala un único trigger diario que
internamente se salta sábados y domingos — más simple de instalar/borrar
que 5 triggers separados por día. "⏰ Quitar Actualización Diaria" lo
desinstala.

**Sobre la autorización de cuenta**: se pide UNA sola vez, al instalar el
trigger (o ya quedó dada si "Actualizar Todo" se corrió antes a mano) — no
es algo que vuelva a pedir permiso cada corrida, y no llega como
notificación al celular. Corre en los servidores de Google.

## v3.24 — Detalle_Compras ahora también muestra ventas

Pedido: "Lo que agregaría en detalle_compras es las ventas (de las
empresas que tengo en cartera). Porque no entiendo por ejemplo porque en
la planilla de Frank en radar sí menciona la compra de PBR ya que del
precio de venta ya está en menos de 10%. Si yo no lo puedo ver en todos
los tickers y no me lo pone en el radar se me escapa."

La sección de Reentrada del Radar mira, para CADA ticker de Renta
Variable, su última operación (compra **o venta**) y avisa si el precio
actual cayó ≥10% desde ahí — pero esa comparación no se veía en ningún
lado más que en el resultado final de Radar. Si una venta parcial de PBR
quedaba como referencia y el precio bajó, no había forma de auditar el
número a mano, ni de mirar otros tickers que estén cerca del umbral pero
todavía no lo crucen.

**Fix**: `_escribirDetalleCompras()` ahora lista también las filas de
Venta/Rescate FCI/Transferencia OUT (antes solo Compra/Suscripción FCI/
Transferencia IN), con columna nueva "Tipo" y su propia Variación % vs.
precio actual — la misma cuenta que hace Reentrada, pero visible para
cualquier operación de cualquier ticker en cartera, no solo para lo que
ya cruzó el -10%.

**Límite que sigue igual**: la hoja sigue acotada a tickers con posición
abierta hoy (una venta parcial de PBR aparece si todavía tenés algo de
PBR). Si Radar sugiere reentrar en un ticker que vendiste del todo (cero
posición), esa operación no va a aparecer en Detalle_Compras — para eso
está Historial. Si hace falta verlo ahí también, es un cambio de alcance
aparte.

## v3.23 — fix TIR Renta Fija otra vez (87% → 103%): pagos de renta en pesos etiquetados dólares

Reporte, después de v3.21: "La tir ahora de renta fija dice 103,39% Cada
vez peor [...] Podes concentrarte y revisar bien para no estar iterando
infinitamente y llegando cada vez a peores resultados???" — con toda la
razón: v3.21 arregló GD29 pero dejó peor el número general, porque no se
había revisado sistemáticamente el resto de Renta Fija.

**Esta vez, antes de tocar código**: escaneo completo de TODOS los "Pago
de Renta/Dividendos" de Renta Fija (no ticker por ticker, reactivo) contra
el % que representan de la tenencia nominal en ese momento. Ningún bono
paga más de un pequeño % de su valor nominal en un solo cupón. Aparecieron
106 pagos por encima del 5%, la mayoría ruido menor de $10-300, pero uno
domina todo: **PBA25 solo, calculado de forma aislada, daba un XIRR de
113,21%** — casi idéntico al 103,39% agregado. Mirando su secuencia de
pagos con la tenencia real:

| Fecha | Monto | Tenencia | % |
|---|---|---|---|
| 2021-07-12 | $2.065,87 | 22.000 | 9,4% |
| 2022-04-12 | $1.546,88 | 15.000 | 10,3% |
| 2022-07-12 | $3.045,17 | 28.000 | 10,9% |
| 2023-04-12 | $9.398,65 | 62.000 | 15,2% |
| 2023-07-13 | $17.105,33 | 78.000 | 21,9% |
| 2023-10-18 | $22.181,59 | 83.000 | 26,7% |
| 2024-01-12 | $26.620,77 | 83.000 | 32,1% |

Con la tenencia prácticamente estable desde abril 2023, el monto se
multiplica por 13x en 9 meses — no es un cupón, es un dato mal escalado.
**Maki confirmó contra IOL** que los pagos del 18/10/2023 y 12/1/2024 son
correctos, pero **en pesos argentinos** (no dólares, aunque la fila diga
"Inversion Argentina Dolares"). Dividiendo los 7 pagos por el MEP
histórico de cada fecha, el % de la tenencia da 0,028%-0,056% —
consistente entre todos, muy lejos del 9%-32% que se leía como USD directo.

Se encontró el mismo mecanismo en **BDC24** (mismo patrón exacto: compras
y ventas correctamente en USD, "Pago de Renta" en pesos etiquetado
"Dolares" — 12%-26% de la tenencia leído como USD, 0,03%-0,05% convertido
por MEP). Se descartó aplicarlo como regla general: se comparó contra
BDC28 y TO23 (otros ONs de la misma cuenta) y ahí el "Pago de Renta" YA
viene correctamente etiquetado "Pesos" — no tienen el bug. El patrón real
es: el bono liquida el cupón en pesos vía el agente de pago local aunque
el título se opere en dólares — pero no es así para todos los ONs, solo
para algunos.

**Fix**: `procesarMovimientos()` excluye a PBA25 y BDC24 de la detección
de moneda por Tipo Cuenta específicamente para sus filas de
Renta/Dividendo/Amortización (las compras/ventas de ambos quedan como
estaban, ya correctas). Con los dos fix (v3.21 + v3.23), el TIR de Renta
Fija estimado baja de 103% a **~8%** — coherente con una cartera
diversificada de bonos/ONs argentinos 2021-2026.

**Además**, nuevo menú "🔍 Diagnóstico: Pagos de Renta/Amortización
Implausibles": escanea toda Renta Fija de una sola vez y flagea cualquier
pago que supere el 5% de la tenencia nominal, con el objetivo explícito de
que este tipo de bug se detecte de entrada la próxima vez — no otra ronda
de "se ve raro en el TIR, hay que investigar de nuevo".

## v3.22 — fix Costo Prom. MELI (y similares): v3.20 sumaba de más

Reporte: "Precio promedio de compra dice en IOL que es de 16,16 no 24,77
que dice la planilla [...] Hay un error grande al operar en diferentes
monedas una misma empresa. No sé si fue la herramienta de reparar
Ticker_Base o reparar Tipo Cuenta".

**Investigación**: se descartó que fuera "reparar Ticker_Base" (MELI/MELID
ya tenían Ticker_Base consistente, nada para corregir ahí) y "reparar Tipo
Cuenta" (MELI es ARS, MELID es USD en Equivalencias — ningún movimiento de
MELI quedaba mal clasificado por esa herramienta). Comparando dos
descargas de la misma planilla en momentos distintos, el Costo Prom. de
MELI (mismas 140 unidades en ambas) saltó de **USD 14,76 a USD 24,77**
entre una y otra — la diferencia coincide en el tiempo con el fix v3.20
("sumar todas las filas del mismo Nro. de Mov.").

Mirando los movimientos reales de MELID, apareció un segundo patrón
distinto al de TLCMO (que sí era una comisión legítima, ~10% del monto
principal): pares de filas con la MISMA Cantidad y el MISMO Precio, pero
Montos de magnitud COMPARABLE entre sí (ej. -289,46 y -244,84 para la
misma compra de 20 títulos) — no es un principal + una comisión chica, es
otra cosa (probablemente una particularidad de cómo IOL exporta fills
múltiples para estos montos chicos en dólares). Sumar ambas filas duplicaba
el costo de esa operación.

Se analizó la distribución de |fila secundaria| / |fila principal| en las
3 planillas reales: **334 filas caen entre 0% y 20%** (comisiones/impuestos
reales, como TLCMO) y **225 filas caen entre 70% y 100%+** (este patrón
tipo MELID) — con un hueco completamente vacío entre 20% y 70%. Es una
distribución bimodal limpia, no un continuo, así que hay un corte natural
y seguro en el medio.

**Fix**: `procesarMovimientos()` ahora suma una fila secundaria solo si su
|Monto| es ≤30% del |Monto| de la fila principal del grupo (ese 30% queda
cómodo en el hueco vacío de la distribución real). Lo que no entra en ese
rango se descarta y se usa solo el Monto de la fila principal — que es
como funcionaba antes de v3.20, y que para MELID da un Costo Prom. de
USD 15,76 (mucho más cerca de los USD 16,16 reales de IOL que los 24,77
que mostraba antes de este fix).

## v3.21 — fix TIR Renta Fija ~87%: GD29 traía Precio/Monto en pesos etiquetados como dólares

Reporte: en Posiciones todo se veía bien, pero en Portfolio "TIR por clase"
seguía mostrando Renta Fija ≈ 87% — un valor imposible como retorno anual.

**Investigación**: se descargó la planilla real y se recorrió `Flujos_TIR`
buscando el flujo que más pesaba. Apareció uno de US$129.191,26 el
2025-05-30 — más de 13 veces el valor total actual de Renta Fija en la
cuenta. Se rastreó hasta Movimientos: `Venta(GD29)`, Cantidad=146,
Precio=89.390, Comisión=1.305,09, Monto=129.191,26, Tipo Cuenta="Inversion
Argentina Dolares". Maki confirmó estos números contra el comprobante real
de IOL (3 boletos por 100+3+43 títulos, mismo precio y comisión) — los
datos en la planilla son fieles a lo que IOL registró.

El problema no es un error de tipeo: es que **GD29 en esta cuenta no tiene
contraparte "GD29D"** (a diferencia de AL29/AL29D, AL30/AL30D, GD30/GD30D,
que sí reparten sus operaciones entre un ticker en pesos y uno en dólares
según corresponda). Todas las filas de GD29 vienen etiquetadas "Inversion
Argentina Dolares" — pero Precio y Monto están en PESOS. Se confirmó
reconstruyendo, para cada operación, el % de la par implícito (Precio ÷
MEP histórico de esa fecha ÷ 100):

| Fecha       | Precio (ARS) | MEP      | % de la par implícito |
|-------------|-------------:|---------:|-----------------------:|
| 2021-06-17  | 6.990        | 164,03   | 42,6% |
| 2021-06-29  | 6.500        | 165,69   | 39,2% |
| 2022-06-30  | 6.100        | 252,71   | 24,1% |
| 2023-08-11  | 21.100       | 601,24   | 35,1% |
| 2025-05-30  | 89.390       | 1.204,92 | 74,2% |

Esa curva (42%→39%→32%→24%→27%→35%→**74%** entre 2021 y 2025) calca la
cotización real del Bonar 2029: piso durante la crisis de 2022, recuperación
post-elecciones 2023, y rally fuerte 2024-2025. Tomando Precio/Monto como
dólares directos, en cambio, la venta de 2025-05-30 quedaba contabilizada
como **US$129.191** en vez de los ~US$107 reales (129.191,26 ÷ 1.204,92) —
un solo flujo mal escalado por ~1.205x (justo el MEP de esa fecha, la
huella típica de "faltó dividir por el MEP") que alcanzaba para inflar todo
el XIRR de Renta Fija a niveles imposibles.

Se descartó que fuera un problema genérico de "todo ticker sin par D es
peso" — se comparó contra PBA25 (otro ON sin contraparte "D" en esta misma
cuenta) y ahí Precio/Monto sí están correctamente en dólares (84-101%, ya
usables tal cual). El fix es puntual a GD29, con la evidencia dejada como
comentario en el código.

**Fix**: en `procesarMovimientos()`, GD29 queda excluido de la detección de
moneda por "Tipo Cuenta" y se convierte por MEP como cualquier operación en
pesos. Si en el futuro aparece un "GD29D" operado, hay que sacar la
excepción y dejar que el Ticker_Base distinga los pares como con AL29/AL30.

## v3.20 — fix de fondo: operaciones partidas en varias filas se sumaban mal

El diagnóstico de v3.19 encontró **252 casos**, no uno solo — descarta la
teoría de "duplicado por error". El patrón es sistemático: IOL parte
muchas operaciones en más de una fila bajo el mismo Nro. de Mov. —
importe principal en una fila, comisión/impuesto en otra, misma moneda,
signos coherentes entre sí (ej. venta: principal positivo + comisión
negativa). Esto incluye el caso de TLCMO reportado antes — **no era una
fila mala, probablemente eran dos partes reales del mismo trade** (se
retira la recomendación anterior de borrar esa fila).

- `procesarMovimientos()` agrupaba por Nro. de Mov. y, ante más de una
  fila, se quedaba con "la primera que diga Dólares" **descartando el
  resto** — a veces perdiendo la parte más grande del monto real (como
  en TLCMO, donde solo se usaba la comisión y se perdía el principal).
  Ahora se **suman** todas las filas de la moneda predominante del
  grupo (Dólares si hay alguna, si no Pesos); la fila "principal" (de
  la que salen Cantidad y Precio) es la de mayor cantidad de títulos.
- El diagnóstico correspondiente pasó de "Movimientos Duplicados" a
  **"Operaciones Partidas en Varias Filas"** y cambió de tono: ya no
  sugiere borrar nada (el código las suma solo), queda como lista
  informativa para espiar algún caso con una diferencia inusualmente
  grande entre las partes.

**Impacto esperado**: con 252 operaciones afectadas, correr "Actualizar
Todo" con esta versión probablemente cambie costos, G/P y TIR en varias
posiciones (para mejor — hacia el valor correcto). Es normal ver números
distintos a los de antes.

## v3.19 — causa real de TLCMO: filas duplicadas con Monto distinto

Con el diagnóstico de ticker puntual (v3.18) se encontró la causa real:
dos filas en `Movimientos` con el **mismo Nro. de Mov. y Boleto**
(110047728 — la misma compra pegada dos veces, probablemente de dos
pegadas manuales que se superpusieron), con Montos distintos:

- Fila 1: Monto = -113,50 (mal — "Otros Imp." tiene 113,5 en vez de la
  comisión real)
- Fila 2: Monto = -1.121,10 = 1000 × 111 ÷ 100 (principal) + 11,10
  (comisión) — esta es la correcta

`procesarMovimientos()` agrupa por Nro. de Mov. para no procesar la
misma operación dos veces, pero cuando hay más de una fila para el mismo
número se queda con "la primera que diga Dólares" sin chequear cuál es
la correcta — así la fila mala (113,50) ganó en silencio, dejando el
costo ~10 veces más chico de lo real. Eso explicaba tanto el precio
incomparable como la TIR de Renta Fija en 88% (comprar algo a $113 que
"vale" $1.134 es una ganancia de 10x que en realidad nunca pasó).

- Nuevo menú **🔍 Diagnóstico: Movimientos Duplicados**: recorre TODA la
  hoja Movimientos agrupando por Nro. de Mov., y reporta cualquier grupo
  con más de una fila y Montos que no coinciden — para encontrar otros
  casos similares (con cualquier ticker) antes de que aparezcan como un
  número raro en Posiciones o Portfolio.
- **Corrección manual necesaria**: borrar la fila con el Monto
  incorrecto de cada duplicado que aparezca — el diagnóstico solo
  detecta y reporta, no corrige solo (para no arriesgarse a borrar la
  fila que en realidad era la correcta).

## v3.18 — diagnóstico de ticker puntual (TLCMO/TLCTO seguían mal)

Se reportó que TLCMO/TLCTO en `Posiciones` seguían con Precio Prom vs
Precio Actual no comparables, a pesar de que el diagnóstico de
Clasificación Renta Fija (v3.17) no encontró nada raro en `Equivalencias`
— y la duda de si "Reparar Tipo Cuenta" (v3.11) las afectó. Revisando el
código: para "Pago de Renta(TLCMO US$)", `_parseTipo()` resuelve al mismo
ticker `TLCMO` que la pata en pesos (la moneda se determina por la
columna Tipo Cuenta, no por el ticker), así que `repararTipoCuenta...()`
no debería tocarlas — pero sin acceso a la planilla real para confirmarlo
(se perdió el acceso a Drive en esta sesión), no se puede asegurar sin
ver los datos.

- Nuevo menú **🔍 Diagnóstico: Ticker Puntual**: pide un ticker por
  prompt y muestra de una sola vez sus filas de Equivalencias (más
  cualquier otro ticker que comparta su Ticker_Base — para revelar pares
  ARS/USD mal vinculados), todos sus movimientos con cómo se interpreta
  cada uno (tipo, moneda, precio, monto, tipoActivo, clase), el
  cantActual/costoActual acumulado, y el precio que trae la API — todo
  junto, en vez de pedir datos sueltos de a poco.

## v3.17 — el fix de v3.16 no alcanzaba a todas las ONs

Se reportó que seguía mal en otras obligaciones negociables (ej. Precio
Prom USD 14,96 vs Precio USD 110,4 — ni de cerca comparables) y que la
TIR de Renta Fija en Portfolio seguía en 88%. Causa: el chequeo
`pos.tipoActivo === 'ON' || pos.tipoActivo === 'Bono'` exigía un match
EXACTO (sensible a mayúsculas/minúsculas y espacios) contra la columna
"Tipo" de `Equivalencias`. Si esa celda dice, por ejemplo, `'on'`, `'ON '`
o algo ligeramente distinto, el ticker deja de tratarse como Renta Fija
en TODOS lados a la vez: no se le aplica el ×100 de precio, no se excluye
de Reentrada, no entra en Alertas RF — y su valor mal escalado infla la
TIR agregada de Renta Fija en Portfolio (que suma el valor de todas las
posiciones de esa clase).

- Nueva función `_esRF(tipoActivo)`: normaliza mayúsculas/espacios antes
  de comparar. Reemplaza los 4 chequeos exactos que había sueltos en el
  script (Posiciones, fórmula de Conviene Operar, Detalle_Compras).
- Nuevo menú **🔍 Diagnóstico: Clasificación Renta Fija**: revisa
  `Equivalencias` buscando tickers cuya Clase "suena a" Renta Fija o
  cuyo Tipo "suena a" ON/Bono pero no matchea exacto — para encontrar el
  ticker puntual sin tener que revisarlos uno por uno a mano.

## v3.16 — fix escala de Precio Prom USD en Renta Fija

Se reportó que en Renta Fija "Precio Prom USD" y "Precio USD" no eran
comparables — uno multiplica por 100 (o más bien, no lo hacía) y el otro
no. Causa real: `costoActual / cantidad` da dólares reales gastados por
unidad nominal (ej. 0,955 para un bono comprado a 95,5% del nominal),
pero "Precio USD" (la cotización en vivo) viene en % del nominal
directamente (ej. 95,5) — 100 veces distintas.

- `_escribirPosiciones()` ahora multiplica por 100 el "Precio Prom USD"
  para Bonos/ONs, quedando en la misma escala que "Precio USD" y
  comparable a simple vista.
- Se revisaron todos los demás usos de la distinción Renta Fija (`esRF`)
  en el script (Valor Actual en Posiciones, Renta_Fija, Detalle_Compras)
  y ya estaban bien escalados — este era el único lugar con el problema.
- La TIR de Renta Fija en 88% que se reportó junto con esto **no** viene
  de este bug (el cálculo de TIR usa costoActual/valorUSD, que ya estaban
  bien escalados) — queda pendiente identificar el ticker puntual para
  revisar su historial de movimientos.

## v3.15 — sugerencia de inversión con el efectivo disponible

Se pidió: sabiendo el dinero disponible, sugerir dónde invertirlo — como
un asesor matriculado largo placista, basado en el valor de las empresas
vs su precio actual, priorizando aumentar posiciones ya existentes.

- Nueva sección en el **Radar**: "💡 Sugerencia de Inversión — ¿Dónde
  poner el efectivo disponible?". Toma el "Total Disponible USD" real de
  `Portfolio` (no una cifra teórica) y lo reparte:
  1. **Por clase**: prioriza la clase con mayor hueco vs su target de
     Config (Renta Variable/Fija/Mixta); si ninguna está por debajo del
     target, reparte según los pesos target.
  2. **Dentro de Renta Variable**: ordena las posiciones existentes por
     "Prima/Desc %" — la misma columna que ya compara el precio del
     CEDEAR contra su valor teórico real (precio en NYSE ÷ ratio) — y
     prioriza las más baratas relativas a ese valor.
  3. **Dentro de Renta Fija**: prioriza la mejor TIR actual entre los
     bonos/ONs que ya tiene.
  4. **Renta Mixta/FCI**: refuerza el que tiene menos peso relativo.
- Nunca supera el techo de concentración por ticker de Config
  (`Umbral Ticker Alerta`), ni pone más de un tercio del presupuesto de
  una clase en un solo ticker.
- A propósito **no propone tickers nuevos** — solo reparte entre lo que
  ya está en la cartera. Si queda presupuesto sin asignar (por límite de
  concentración, o porque no hay ninguna posición existente en esa
  clase), lo dice explícitamente en vez de inventar una sugerencia.

## v3.14 — fix posición fantasma: AL29 vendido seguía en Posiciones

Se reportó que AL29 se vendió pero seguía apareciendo en `Posiciones`.
Causa: `AL29D` (la versión USD del mismo bono) tenía su propio
`Ticker_Base` (`'AL29D'`) en vez de apuntar a `'AL29'` — a diferencia de
`AL30`/`AL30D`, que sí están correctamente vinculados con el mismo
`Ticker_Base`. El script trata cada `Ticker_Base` como una posición
separada: si la compra se registró bajo un ticker y la venta bajo el
otro, cada uno queda con su propia cuenta y ninguno cierra la posición
real — la pata que "compró" sigue mostrando cantidad, aunque en los
hechos ya no queda nada.

- Corregido en el script (`AL29D` ahora usa `Ticker_Base='AL29'`) — para
  instalaciones nuevas.
- Como el problema ya estaba cargado en las 3 planillas reales (Maki,
  Frank, Trini — heredado de antes, no algo introducido en esta vuelta),
  se agregó **🔧 Reparar Ticker_Base**: revisa TODOS los pares ARS/USD de
  `Equivalencias` (no solo AL29D) y corrige en la planilla real
  cualquiera con el mismo problema, antes de volver a correr
  "Actualizar Todo".

## v3.13 — diagnóstico Valor Total vs IOL

En la cuenta de Trini, "Activos valorizados en USD" en la web de IOL
(8304,97) no coincide con lo que muestra el sheet. El sheet calcula el
total de abajo hacia arriba (suma cantidad × precio de cada posición en
`Posiciones`), sin cruzarlo nunca contra el total oficial de IOL.

- Nuevo menú **🔍 Diagnóstico: Valor Total vs IOL**: trae
  `titulosValorizados` de `/api/v2/estadocuenta` por cuenta (ARS y USD),
  convierte la parte en ARS a USD con el MEP del día, y lo compara contra
  `SUM(Posiciones!G:G)` — muestra ambos totales y la diferencia en USD y
  en %. No identifica todavía qué ticker puntual está mal (la API de
  saldo no da ese detalle por posición), pero confirma si hay una
  diferencia real y de qué magnitud antes de salir a buscarla a mano.

## v3.12 — Saldo Manual como respaldo (cuentas donde la API de saldo no anda)

En la cuenta de Trini, `/api/v2/estadocuenta` rechaza el token incluso
recién obtenido — confirmado con un token 100% fresco (pidió credenciales
de nuevo y falló igual). No es un bug del script: apunta a que esa cuenta
no tiene activado el producto de API "Estado de Cuenta" por separado del
de "Operaciones" (revisar en invertironline.com → Mi Cuenta →
Personalización → APIs). El resto del script funciona bien sin esto —
solo afecta "Efectivo Disponible" y "TOTAL PORTFOLIO" en `Portfolio`.

- Nuevos parámetros en **Config**: "Saldo Manual ARS" y "Saldo Manual
  USD" (por defecto en 0 = no usar). Si la API no trae saldo (`saldo_usd`/
  `saldo_ars` en 0), `Portfolio` usa estos valores como respaldo. Si la
  API sí funciona, no hace falta tocarlos.
- `_inicializarConfig()` dejó de ser "todo o nada": antes, si la hoja
  Config ya existía (de una versión anterior), la función no hacía nada y
  los parámetros nuevos nunca le aparecían a nadie que ya la tuviera
  creada. Ahora agrega solo los que falten, igual que
  `poblarEquivalencias()`/`poblarRatios()`.

## v3.11 — fix importante: precios de CEDEARs USD divididos por MEP dos veces

Se reportaron precios absurdamente bajos y variaciones % exageradas en
registros de julio de GOOGL (GOGLD) e IBIT (IBITD). Causa real encontrada:

`importarMovimientosIOL()` detectaba si una operación era en USD **solo**
por el sufijo `" US$"` en el símbolo — eso únicamente aparece en Pago de
Renta/Dividendos (ej. `"AXP US$"`). Una Compra/Venta normal de un CEDEAR
cuyo propio ticker YA es la versión dólar (GOGLD, IBITD, METAD, y
cualquier otro terminado en D) no tiene ese sufijo — el símbolo es
literalmente `"GOGLD"`, sin `" US$"` al final. Sin ese sufijo, la
operación quedaba marcada `"Inversion Argentina Pesos"` aunque el precio
que trae la API ya está en USD. Después, `procesarMovimientos()` ve una
operación "en pesos" y divide ese precio por el MEP **de nuevo** — un
precio que ya era, por ejemplo, USD 5,75 termina en algo como USD 0,0038.

- `importarMovimientosIOL()` ahora también cruza contra `Equivalencias`
  (columna Moneda_Op) para decidir si una operación es en USD, no solo el
  sufijo del símbolo. Afecta a cualquier importación **nueva** desde acá
  en adelante.
- Nuevo menú **🔧 Reparar Tipo Cuenta**: recorre `Movimientos` y corrige
  las filas que ya se importaron mal (dicen "Pesos" pero el ticker es de
  moneda USD según Equivalencias) — cambia solo la etiqueta de cuenta, no
  toca precio/monto/cantidad (esos ya estaban bien). Después de correrlo,
  hay que volver a correr "🔄 Actualizar Todo" para que todo se recalcule
  con los precios correctos.

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
