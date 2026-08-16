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
