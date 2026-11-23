# Herramienta CIF: estado, decisiones y siguientes pasos

**Carlos Laborda Martínez** · 17 de noviembre de 2026

Implementación del método del artículo *Contextual Isolation Forests: Contextual anomaly detection in water distribution networks using semantic partitioning* (Saavedra, Arnau, Berna y Calatayud). La herramienta es general: sirve para cualquier conjunto de sensores en CSV. Se ha probado con los datos de agua y electricidad de la Universidad de Alicante. El código está en la carpeta [`cif/`](./).

---

## 1. Resumen

- **Implementado y comprobado:**
  - **Preparación de datos:** procesado de características, valores nulos y contextos, en el orden de la Fig. 1.
  - **Explicabilidad por contexto:** IF global y por partición, RI, II, Tabla 5 y Fig. 9.

  Hay 123 pruebas automáticas, todas superadas. Un caso con semilla fija sobre datos reales da en la aplicación exactamente los mismos números que por consola.
- **Los valores nulos se tratan fuera de la herramienta**, como indicó el tutor. Si al CSV le falta algún dato, la herramienta dice en qué registros («En el registro 42589 faltan datos») y no deja seguir, porque el Isolation Forest no puede ejecutarse con datos incompletos. Ya no rellena huecos.
- **Cada fila se identifica por su número de registro**, como indicó el tutor. Se puede cargar una tabla sin columna de fecha (como la pestaña 3 del Excel), elegir un rango de registros y los resultados dicen «Registro 960».
- **Z-score opcional**, como pidió el tutor para comparar con otros algoritmos usando el mismo dataset: se puede normalizar, guardar el dataset normalizado, guardar la media y la desviación de cada columna y aplicarlas a otros datos (febrero con las de enero). Al Isolation Forest no le cambia las anomalías.
- **Probado con el Excel del tutor:** el primer trimestre de la pestaña 3 **no está completo** (tiene 4 tramos cortos sin datos) y hay **7 parejas de columnas idénticas** (apartado 5.3, P10 y P11).
- **Datos de la UA:** 3 meses (enero–marzo de 2026, cada 15 minutos) de agua y electricidad. La exportación de producción solar venía vacía y no se ha usado.

### Cambios desde el informe anterior (respuestas del tutor)

| Antes | Ahora |
|---|---|
| Los huecos se rellenaban (valor fijo, valor anterior o vacío) | **No se rellena nada.** Si falta un dato, aviso con el registro y no se sigue (D20) |
| Las filas se identificaban por su fecha; el CSV pivotado tenía que traerla | **Número de registro.** Tabla sin columna de fecha, rango de registros y resultados por registro (D21, D22) |
| Sin z-score | **Z-score opcional** con parámetros que se guardan y se cargan (D23 a D25) |
| `12,5` (coma decimal, como exporta Excel en español) se tomaba como texto | Se lee como número (D26) |
| Para volver a cargar los datos había que pivotar otra vez el CSV largo | Botón para guardar el dataset en columnas y cargarlo como «Una tabla ya hecha» (solo si no le faltan datos) |
| 89 pruebas | 123 pruebas |

---

## 2. Qué hace la herramienta

Es una aplicación web (Angular) que funciona entera en el navegador, sin servidor. Es un asistente de cinco pasos:

1. **Datos.** Cargar uno o varios CSV de sensores en formato largo (una fila por lectura: `timestamp`, `uid`, `value`, `name`, `alias`…) o un CSV ya pivotado, con o sin columna de fecha. Si a un CSV ya pivotado le falta algún dato, no se carga y se dice en qué registros.
2. **Preparar.** Preparación de datos del artículo, en el orden de su Fig. 1:
   - Pivotar y fusionar (una fila por momento y una columna por sensor, `tipo_uid`).
   - **Rango de registros:** desde qué registro hasta cuál se analiza.
   - **Comprobar que no falta ningún dato.** Si falta alguno, se avisa con el registro (y, en el formato largo, el momento) y no se sigue.
   - **Procesado de características.** Una lista de operaciones que se aplican en orden:
     - **Extraer:** de una fecha, día, mes, año, hora, minuto o día de la semana; de un texto, un trozo.
     - **Combinar:** junta dos columnas en una nueva.
     - **Eliminar:** quita una columna.
     - **Añadir:** crea una columna con un valor fijo.
   - **Comprobar que todas las columnas son numéricas.** Si alguna no lo es, se avisa con su nombre y no se sigue.
   - **Z-score (opcional):** con la media y la desviación de estos datos o con unas guardadas.

   Se puede filtrar por tipo de medida, sensor o aulario sin volver a leer el CSV.
3. **Contextos.** Un contexto es un punto de vista (por ejemplo "por tipo de suministro" o "por edificio") y sus particiones son grupos de columnas. Se pueden crear a mano o automáticamente por tipo.
4. **Ajustes.** Parámetros del Isolation Forest y semilla.
5. **Resultados.** Un resumen (registros y anomalías globales) y cinco pestañas. Cada fila se identifica por su número de registro:
   - la tabla CIF (como la Tabla 5);
   - el mapa RI–II (Fig. 9), con los cortes de RI e II que deciden qué es anomalía CIF;
   - el score en el tiempo;
   - la comparación de contextos;
   - las descargas.

Para cada momento la herramienta da:

| Indicador | Qué significa | Cómo se calcula (artículo) |
|---|---|---|
| **Score** | Lo raro que es mirando todas las columnas a la vez (0–1) | Isolation Forest sobre todos los datos |
| **RI** (recurrencia) | En qué parte de los grupos aparece la anomalía: 0 = en ninguno, 1 = en todos. Indica si el problema es local o general | Particiones donde el score supera el umbral ÷ total de particiones (Ec. 1) |
| **II** (intensidad) | Lo fuerte que es en esos grupos | Media de los scores de las particiones donde es anomalía (se divide entre esas particiones, no entre el total). Nunca vale 0; si no es anomalía en ninguna partición, en blanco. Se calcula para todos los registros, como RI |

Además de lo que pide el artículo, la herramienta añade:
- **Reproducibilidad:** cada ejecución guarda su semilla. El JSON de configuración guarda todo: columnas, si el CSV tiene fecha, filtro, rango, procesado, z-score con sus parámetros, parámetros del IF, semilla, contextos y cortes de RI e II. Quien lo cargue con el mismo CSV obtiene exactamente el mismo resultado.
- **Descargas:**
  - la tabla CIF completa, con las columnas `registro` y `anomalia_cif`;
  - el resumen por partición;
  - la tabla preparada (`2_fusionado.csv`, en el formato del visualizador de Emilia);
  - el dataset en columnas (`dataset.csv`), para no pivotar otra vez el CSV largo;
  - el dataset normalizado (`dataset_normalizado.csv`) y sus parámetros (`parametros_zscore.csv`);
  - `columnas.csv`, con el sensor y el aulario de cada columna.
- **Comparación de contextos y particiones:** anomalías por grupo, score medio de sus anomalías, score máximo y qué contexto detecta cada anomalía global.
- **Avisos:** cuando no sale ninguna anomalía o cuando hay columnas constantes.

---

## 3. Qué está hecho respecto al artículo

| Parte del artículo | Fase | Estado |
|---|---|---|
| **Preparación de datos** | Procesado de características (combinar, extraer, eliminar, añadir) | ✅ Hecho. Por defecto DD, MM, HH y MIN, como en 4.2.1 |
| | Valores nulos | 🟡 Por indicación del tutor, **fuera de la herramienta**: los nulos se tratan antes de cargar el CSV. Si falta un dato, la herramienta avisa con el registro y no deja seguir (D20). Con el rango de registros se puede elegir una época sin huecos |
| | Contextos y particiones (con pesos) | ✅ Hecho. Los pesos se guardan pero no se usan en RI ni II, igual que en el artículo |
| **Explicabilidad por contexto** | IF global y por partición, RI, II y Tabla 5 | ✅ Hecho |
| | Fig. 9 (burbujas RI–II) | ✅ Hecho, con la forma de la figura y los cortes que indicó el tutor: un círculo por registro que es anomalía en alguna partición, radio según el score global, y los que pasan los dos cortes son anomalías CIF (D18 y D28) |

### Cómo funciona la preparación de datos

Las fases se aplican en el orden de la Fig. 1: primero el procesado y al final los contextos. La fase de nulos se hace antes de cargar el CSV: la herramienta solo comprueba que no falta nada, y lo vuelve a comprobar después del procesado, porque una operación también puede dejar celdas vacías (por ejemplo, sacar el día de una columna que no es una fecha). Después del procesado, todas las columnas tienen que ser numéricas. La fecha nunca es una característica, solo identifica la fila, igual que en el artículo, que la sustituye por DD, MM, HH y MIN. Sin fecha, la fila se identifica por su número de registro. El z-score, si se activa, va al final, sobre la tabla que recibe el Isolation Forest.

---

## 4. Cómo se ha comprobado que es correcto

Hay 123 pruebas automáticas en `cif/pruebas/`. Se ejecutan con `npm test` en unos segundos y todas usan semillas fijas, así que dan siempre los mismos números. La carpeta `pruebas/` no se sube a git.

| Prueba | Qué comprueba | Resultado |
|---|---|---|
| **A · Fórmulas** | Se meten los valores por partición de las 10 filas de la Tabla 5 del artículo | Las 10 filas dan el mismo RI y anomalía sí/no que el artículo. II es la media de las particiones donde es anomalía, y va en blanco si no lo es en ninguna. También el ejemplo del tutor (RI = 3/10, II = media de 0,72, 0,75 y 0,91) |
| **B · Montaje** | Cada partición ve solo sus columnas; la misma semilla da el mismo resultado; las columnas constantes se quitan bien; las validaciones funcionan | Todas correctas |
| **C · Red simulada** | Una red como la del artículo (4 zonas × 4 medidas = 16 sensores, 2.000 momentos) con 20 averías de un solo sensor y una de toda la red, repetida con 5 semillas | Con 100 árboles: **98 de 100** averías señaladas en sus particiones, **0 de 600** en particiones ajenas y **0 de 9.895** momentos normales marcados por error. La avería de toda la red sale la primera, con RI entre 0,75 y 1 |
| **D · Comparación de motores** | El IF de Emilia frente a un IF hecho por separado ([`isolation-forest-propio/`](../isolation-forest-propio/)) sobre los mismos datos (`npm run comparar`) | Con el consumo de agua real ordenan los momentos igual (correlación 0,96, la misma que cada motor consigo mismo con otra semilla). Aquí apareció el fallo de las columnas constantes (D7) |
| **E · Filtro y configuración** | El filtro por tipo, sensor y aulario; que el JSON guardado se lea igual; que los JSON antiguos sigan funcionando, también los de antes de la preparación | Todo correcto |
| **F · Preparación de datos** | Lectura de fechas; las cuatro operaciones del procesado; que una columna que no es numérica dé error con su nombre; el orden de la Fig. 1 con CSV largo y pivotado; la coma decimal; que un dato que falta dé error con su registro y su momento | Todas correctas. De `DD/MM/YYYY HH:MIN` salen DD, MM, HH y MIN como en 4.2.1. `12,5` y `1,72E-02` se leen como números |
| **G · Datos en columnas y celdas vacías** | Guardar el dataset y volver a cargarlo da lo mismo que el CSV largo; tabla sin columna de fecha (como la pestaña 3); el aviso de celdas vacías (registro, columnas, total, filas vacías del final) | Todas correctas |
| **H · Rango de registros** | Enero (1–8928) da 8.928 filas; febrero empieza en el registro 8929; en el CSV largo, un hueco fuera del rango no bloquea; los resultados y el CSV llevan el registro original | Todas correctas |
| **I · Z-score** | Mismos números que `StandardScaler` de scikit-learn; media 0 y desviación 1; febrero con los parámetros de enero; guardar y cargar los parámetros y el dataset normalizado da los mismos números cifra a cifra; con la misma semilla, el CIF da las mismas anomalías con y sin z-score | Todas correctas |

**Comprobación en la aplicación.** Hecha antes de quitar el relleno de huecos: hoy esos dos ficheros ya no se pueden analizar enteros porque les faltan datos (apartado 5.3). Se cargaron juntos los dos ficheros de 3 meses, con el contexto automático por tipo (2 particiones: agua con 75 columnas y electricidad con 128), 10 árboles y semilla 1. La pantalla dio exactamente lo calculado por consola:

| | Esperado | En la aplicación |
|---|---|---|
| Tabla preparada | 8.628 filas × 207 columnas, 101.331 huecos rellenados | Igual |
| Umbral 0,70 | 0 anomalías globales | Igual |
| Umbral 0,39 | 4.103 anomalías globales | Igual |

Los datos del artículo son confidenciales. Por eso la prueba C usa una red simulada: así sabemos qué debería detectarse y podemos medir el porcentaje de aciertos.

**Lo que las pruebas no demuestran:** que cada anomalía detectada en los datos reales sea un problema real. Para eso haría falta compararlas con incidencias conocidas, y no se dispone de ellas (P6). El artículo está en la misma situación.

---

## 5. Resultados con los datos reales

### 5.1 Datos

| Dataset | Periodo | Momentos | Columnas | Celdas a 0 |
|---|---|---|---|---|
| `ConsumoAgua3meses.csv` | 1 ene – 31 mar 2026 | 8.475 | 75 contadores + DD, MM, HH, MIN | 60 % |
| `ConsumoElectrico3meses.csv` | 1 ene – 31 mar 2026 | 8.620 | 128 contadores + DD, MM, HH, MIN | 22 % |
| Producción solar | — | — | — | La exportación venía vacía; no se ha usado |

Para comparar, el artículo trabaja con 33.096 registros de todo 2024 (cada 15 minutos), 11 variables y 4 zonas.

### 5.2 Rendimiento

Medido por consola con los ficheros de 3 meses:

| Paso | Agua | Electricidad |
|---|---|---|
| Leer el CSV (120 y 250 MB) | 4,3 s | 7,9 s |
| Pivotar y preparar | 0,7 s | 1,4 s |
| CIF con 10 árboles (IF global y 10 particiones) | 0,3 s | 0,5 s |
| CIF con 100 árboles | 1,4 s | 1,7 s |

La lectura del CSV avanza por trozos y no bloquea la pantalla. Pivotar y el CIF sí la bloquean, pero menos de 2 segundos. Con un año serían unas 4 veces más filas (ver apartado 7).

### 5.3 Datos que faltan y Excel del tutor

**Pestaña 3 (`LIMPIOS`) de `data.xlsx`.** 181 días, un registro cada 5 minutos: 52.128 registros y 44 columnas (`daycos`, `daySen`, `timeCos`, `timeSin` y 40 sensores). No tiene fechas ni fórmulas. Encima de la cabecera hay 3 filas auxiliares (máximo, mínimo y número de columna) que hay que quitar antes de guardar el CSV.

Las 9.040 celdas vacías están en 949 registros, en 8 tramos:

| Registros | Día | Registros afectados |
|---|---|---|
| 561–562 | 2 (2 de enero) | 2 |
| 7844–7851 | 28 (28 de enero) | 8 |
| 15907–15908 | 56 (25 de febrero) | 2 |
| 25369–25380 | 89 (30 de marzo) | 12 |
| 32035–32037 | 112 | 3 |
| 36193–36200 | 126 | 8 |
| **42116–43025** | **147–150 (la pérdida de datos de mayo)** | **910** |
| 50180–50183 | 175 | 4 |

**El primer trimestre no está completo:** tiene 4 tramos cortos sin datos, así que ni enero ni el trimestre entero se pueden cargar tal cual (P10). El tramo seguido más largo sin huecos es el **15909–25368** (9.460 registros, del 25 de febrero al 30 de marzo). Se ha exportado desde Excel como CSV UTF-8 y carga bien: 9.460 filas × 44 columnas.

**Columnas idénticas.** Siete parejas tienen el mismo valor en las 52.128 filas (comprobado celda a celda), así que esas medidas pesan el doble o el triple en el IF global. En algunas no cuadran las unidades, por lo que puede que alguna esté mal copiada (P11):

| Columna | Es igual que |
|---|---|
| G · CE02+CE04 (m³/h) | T · Q_salida_panta (m³/h) |
| N · Q_Forriols (m³/h) | AD · Caudal1 (m³/h) |
| O · Q_SADA (m³/h) | AF · Caudal2 (m³/h) |
| Q · Pimp_Forriols (m³/h) | Y · Presión red Forriols (mca) |
| R · Q_ent Pozo 1 (m³/h) | AC · Caudal impulsión (m³/h) y AE · Caudal impulsión pozo. (m³/h) |
| X · Presión impulsión (mca) | AA · Caudal impulsión pozo. (mca) |

**Excel recorta decimales.** Con el formato «General», al guardar como CSV Excel escribe como mucho 11 caracteres por número (`0,570242293` en vez de `0,57024229269178706`). Al Isolation Forest no le afecta, pero si se quieren exactamente los mismos números que en el Excel hay que poner antes formato de número con 15 decimales.

**CSV de la UA.** Con la regla de no rellenar, ninguno de los 8 ficheros se puede analizar entero: en todos hay momentos en los que algún sensor no tiene lectura. Con el rango de registros se puede elegir una época sin huecos.

| Fichero | Registros con huecos |
|---|---|
| Agua1semanas | 733 de 733 |
| ConsumoAgua | 468 de 480 |
| ConsumoAgua3meses | 7.897 de 8.475 |
| ConsumoElectrico1semana | 562 de 741 |
| ConsumoElectrico3meses | 7.542 de 8.620 |
| Electricidad | 266 de 410 |
| ProduccionSolar 1semana | 161 de 1.148 |
| Solar | 95 de 719 |

---

## 6. Decisiones tomadas

| | Decisión | Por qué | Alternativa descartada |
|---|---|---|---|
| **D1** | No modificar el Isolation Forest de Emilia. La semilla se consigue sustituyendo `Math.random` por un generador con semilla solo mientras se ejecuta su código | Respetar el trabajo del TFG y poder seguir usando su librería tal cual | Copiar y modificar su código, o usar nuestro IF propio |
| **D2** | La semilla se registra siempre, sea fija o aleatoria. La partición *k* usa semilla + *k*. Existe un JSON de configuración que se puede volver a cargar | Que cualquier resultado se pueda repetir y compartir | Guardar la semilla solo si es fija |
| **D3** | El tamaño de muestra de cada árbol es el mínimo entre el pedido (256) y el número de filas | Es lo que hace el IF original. Con menos de 256 filas, el IF de Emilia normalizaba con 256 y los scores salían más bajos de lo debido | Pasar siempre 256 |
| **D4** | Valor de un momento en una partición = su score si supera el umbral; si no, **en blanco**. RI = particiones donde es anomalía ÷ total. II = **media** de los scores de las particiones donde es anomalía, dividida entre esas particiones; si no hay ninguna, en blanco. RI e II se calculan para **todos** los momentos, sean o no anomalía global | Lo indicó el tutor: un score nunca vale 0 (ni 1), así que un 0 confunde; II es la media y no la mediana («error nuestro en la traducción»); y un registro que no es anomalía global puede serlo en alguna partición. El texto del artículo (4.4), la Tabla 5 y la Fig. 9 usan la mediana contando los 0 | La mediana contando los 0, como en la Tabla 5 |
| **D5** | Anomalía = score **mayor** que el umbral (no mayor o igual) | En la Tabla 5, el registro 32708 tiene score 0,70 y figura como no anomalía | ≥ umbral |
| **D6** | Se quita el paso "Isolation Forest global" suelto | El CIF ya incluye el IF global (columna IF Sc). Tenerlo aparte era redundante | Mantener dos sitios donde ejecutar lo mismo |
| **D7** | Opción **"Quitar columnas constantes"**, activada por defecto y explicada en la pantalla | Con una columna que nunca cambia, el IF de Emilia deja de dividir esa rama en lugar de probar otra, y los scores se aplastan hacia 0,5. Medido con 4 sensores con datos y 12 constantes: las anomalías pasan de **0,55 a 0,85** al quitarlos. Una columna constante no aporta información, y scikit-learn también las salta | Dejarlo como está, o modificar el código de Emilia |
| **D8** | El filtro se aplica antes de pivotar, y el aulario sale de la columna `alias` | El aulario no existe en la tabla pivotada (las columnas son `tipo_uid`) | Filtrar columnas después de pivotar |
| **D9** | El filtro guarda los valores **elegidos**, no los descartados | Con otro CSV que tenga más sensores, la selección es exactamente la misma | Guardar los descartados |
| **D10** | Los CSV de datos no llevan metadatos. La semilla va en el nombre del fichero y en el JSON, y `columnas.csv` va aparte | `2_fusionado.csv` lo lee el visualizador de Emilia; añadir filas o cambiar cabeceras lo rompería | Meter semilla, filtro o alias dentro del CSV |
| **D11** | Pruebas con el ejecutor que trae Node (`node --test`) y esbuild, sin dependencias nuevas | Cuando se hicieron, `npm install` fallaba en este equipo con un error interno de npm ("edgesOut"). Ahora una instalación de prueba (`--dry-run`) ya funciona, pero las pruebas no necesitan nada más y se han dejado así | Instalar Vitest |
| **D12** | Las carpetas `cif/datasets/` y `cif/pruebas/` están fuera de git | Los datasets ocupan cientos de MB y GitHub rechaza ficheros de más de 100 MB | Subirlos o usar Git LFS |
| **D13** | Gráficos en SVG hechos a mano, sin librería. Cada uno tiene recuadro con los valores exactos (con ratón y con teclado) y tabla alternativa | **Fidelidad:** reproducen la Fig. 9 tal cual. **Accesibilidad:** el SVG se recorre con teclado; Chart.js o ECharts dibujan en un `<canvas>`, que un lector de pantalla no puede leer. **Sin dependencias:** la aplicación pesa menos (una librería como Chart.js añade del orden de 200 KB a los ~340 KB actuales) | Usar una librería de gráficos. Daría zoom y animaciones, que el artículo no necesita |
| **D14** | El procesado por defecto es el del experimento del artículo: DD, MM, HH y MIN de la fecha | Es lo que hace el artículo (4.2.1). Así el IF sabe a qué hora y en qué época pasa cada lectura | No procesar nada por defecto |
| **D15** | **Combinar** une los dos valores como texto con `_` (`zona1` + `bomba` → `zona1_bomba`). Si falta uno, el resultado es un hueco | El artículo no dice cómo se combinan. Sirve para cualquier tipo de dato y no supone nada sobre unidades. El resultado es texto, así que la tabla da error si esa columna se queda | Sumar las dos columnas (solo tiene sentido si miden lo mismo) |
| **D16** | Las fechas se leen tal como están escritas en el CSV (ISO o `DD/MM/YYYY HH:MM:SS`), sin cambiar de zona horaria | Mismo criterio que al exportar los CSV. El resultado no depende de la zona horaria del ordenador | Convertir a hora local |
| **D17** | Un JSON de configuración anterior a la preparación de datos no procesa nada | Así repite exactamente el resultado que dio cuando se guardó | Aplicarle el procesado por defecto |
| **D18** | El mapa RI–II tiene la forma de la Fig. 9 (ejes, fondo de verde a rojo, círculos semitransparentes) y dibuja **todos** los registros que son anomalía en alguna partición. Los que no lo son en ninguna no tienen II y no salen; se dice cuántos son | El tutor explicó que en la gráfica se ven todos los registros y que el radio es el score global: uno grande puede quedar abajo a la izquierda y uno pequeño arriba a la derecha | Solo los 10 de más score, como la figura |
| **D19** | El código se publica con **licencia MIT** (fichero `LICENSE`). La carpeta `core/lib/isolation-forest/` queda fuera de esa licencia: es de Emilia Rouanet Feliu y se incluye sin cambios, con su permiso y citándola como autora en el README | La MIT es la licencia libre más habitual en proyectos JavaScript y Angular y deja reutilizar la herramienta sin trabas. El código de Emilia no se puede relicenciar sin su permiso, y ella solo pidió que se la mencione | GPL-3.0 (obliga a publicar el código de las versiones modificadas); publicar sin licencia (nadie podría reutilizarlo legalmente) |
| **D20** | **No se rellenan huecos.** Si falta un dato (también la fecha, filas cortas o una fila vacía en medio), se avisa con el total y los 10 primeros registros, con sus columnas, y no se sigue. Vale para los dos formatos: en el largo se comprueba al pivotar y el aviso da también el momento. Si los datos se han leído, se puede ir igualmente al paso 2 para cambiar el filtro o el rango. Las filas vacías del final que deja Excel no cuentan | Lo indicó el tutor: los nulos se tratan antes de pasar el CSV a la herramienta y, si faltan datos, el Isolation Forest no puede ejecutarse | Seguir rellenando con 0 o con el valor anterior |
| **D21** | Cada fila se identifica por su **número de registro**: la fila de datos del CSV, desde 1. Una tabla puede no tener columna de fecha. La tabla, los gráficos y el CSV de resultados enseñan el registro; con fecha, también el momento | Lo indicó el tutor: la fecha no se usa en los algoritmos y basta con saber que es el registro 960 | Exigir siempre una columna de fecha |
| **D22** | El **rango de registros** se aplica antes de comprobar los huecos y **conserva la numeración** (si empieza en el 8929, la primera fila es el registro 8929). Con un CSV ya pivotado no salva los huecos, porque un CSV con huecos no se deja cargar | Así se puede usar solo una época completa, como dijo el tutor, y el registro N es siempre la misma fila que en el Excel | Numerar desde 1 dentro del rango |
| **D23** | Z-score con desviación **poblacional (÷N)** | Es la de `StandardScaler` de scikit-learn: si se compara con algoritmos en Python, salen los mismos números. El tutor no lo concretó (P12) | Muestral (÷N−1) |
| **D24** | El z-score se aplica a **todas las columnas** de la tabla que recibe el IF, después del procesado. Una columna constante queda a 0 | El tutor pidió «subir un dataset y aplicarle el z-score». Dejar a 0 una columna constante es lo que hace `StandardScaler` y evita dividir entre 0 | Elegir columnas una a una |
| **D25** | Los parámetros del z-score se guardan en CSV (`columna;media;desviacion`) con todas las cifras. Si a unos parámetros cargados les falta una columna de la tabla, es un error; si traen columnas de más, se avisa y se sigue. Se mantienen al cambiar de CSV y van en el JSON de configuración | Lo pidió el tutor para normalizar febrero con los parámetros de enero. Con todas las cifras, cargar los parámetros da exactamente los mismos números | Recalcular la normalización con cada conjunto de datos |
| **D26** | Se acepta la **coma decimal** (`12,5`, `1,72E-02`): si hay una sola coma y ningún punto, la coma es el decimal. No se acepta separador de miles | Excel en español guarda los CSV con `;` y coma decimal. Los formatos del Excel del tutor (General y `0.0000`) no ponen separador de miles | Exigir punto decimal |
| **D27** | El **score medio** del resumen por partición es el de **sus anomalías** (los scores que pasan el umbral), no el de todos los registros. Si la partición no tiene ninguna, en blanco | Lo indicó el tutor | Media de todos los registros |
| **D28** | **Anomalía CIF:** RI mayor que un corte **e** II mayor que otro. Los cortes se cambian en el mapa y van en el JSON. Por defecto, RI 0,25 (el del artículo) e **II en el umbral del IF** (0,70), porque II es la media de scores que superan el umbral y siempre es mayor que él. No tiene por qué coincidir con la anomalía global: tabla y CSV llevan las dos | Lo indicó el tutor: «se fija un RI y un II en la gráfica y los que tienen RI e II superior son anomalías». Los valores por defecto están pendientes de confirmar | II en 0, como el artículo (con la media no separaría nada) |

---

## 7. Limitaciones y riesgos conocidos

1. **El resultado depende del azar.** En la red simulada se acierta la partición el 85 % de las veces con 10 árboles, el 98 % con 100 y el 100 % con 300. La semilla fija permite repetir cada resultado, pero no lo hace más estable.
2. **Columnas casi constantes.** La opción D7 quita las columnas que no cambian nunca. Una que vale 0 casi siempre puede seguir afectando dentro de algunas ramas del árbol, aunque mucho menos.
3. **Todo se calcula en el navegador.** Con 3 meses la pantalla se queda quieta como mucho 1–2 s (apartado 5.2). Con un año serían unos 6 s al pivotar y unos 7 s en el CIF con 100 árboles. Un *Web Worker* lo evitaría, pero de momento no compensa. Con un año preocupa más la **memoria**: se guardan unos 4 millones de lecturas, y eso no lo arregla un Web Worker.
4. **La semilla depende de que el IF de Emilia sea síncrono.** Si algún día su librería pasa a ser asíncrona, habría que revisar D1.
5. **Los datos con huecos no se pueden analizar sin tratarlos antes.** Es lo que indicó el tutor, pero hoy deja fuera los 8 CSV de la UA enteros y la pestaña 3 entera (apartado 5.3). Se pueden usar trozos sin huecos con el rango de registros (en el formato largo) o recortándolos en Excel (en el ya pivotado).
6. **En el formato largo, el número de registro depende del filtro.** El registro es la fila de la tabla alineada después de filtrar: si se quita un tipo de medida, puede cambiar la lista de momentos y con ella la numeración. Por eso el aviso de huecos da también el momento.
7. **Con una sola partición, RI solo puede valer 0 o 1** y el mapa RI–II se queda en dos líneas. Pasa con el contexto automático por tipo si el CSV tiene un solo tipo, como cada fichero de 3 meses por separado. Para que RI e II digan algo hacen falta contextos con varias particiones con sentido.
8. **El z-score no cambia las anomalías del Isolation Forest**, porque el IF corta cada columna entre su mínimo y su máximo y la escala no le afecta (prueba I4). Sirve para usar el mismo dataset con otros algoritmos, que es para lo que lo pidió el tutor.

---

## 8. Preguntas abiertas

Respondidas:
- **P2** (¿más histórico?): se han conseguido 3 meses de agua y electricidad.
- **P7** (¿figuras?): hechas.
- **P8** (¿cómo se rellenan los huecos?): no se rellenan; los nulos se tratan antes de cargar el CSV (D20).
- **Z-score** (¿se pone aunque no cambie las anomalías?): sí, opcional, con parámetros que se guardan y se cargan (D23 a D25).
- **Fecha** (¿pestaña 1 o 3?): no hace falta; se usa el número de registro (D21).
- **Rango** (¿por fechas o por fila?): por número de registro (D22).
- **Excel** (¿leer `.xlsx`?): no; se guarda como CSV desde Excel.

| | Pregunta | Por qué importa |
|---|---|---|
| **P6** | ¿Hay forma de contrastar las anomalías con incidencias reales? | Ahora mismo no se dispone de incidencias. El artículo tampoco las tiene y lo deja como trabajo futuro |
| **P10** | El primer trimestre de la pestaña 3 tiene 4 tramos cortos sin datos (5.3). ¿Usamos tramos completos, como el 15909–25368, o se rellenan esos pocos registros en el Excel antes de exportar? | Sin eso no se puede cargar enero entero ni comparar enero con febrero completos |
| **P11** | En la pestaña 3 hay 7 parejas de columnas idénticas, y en algunas no cuadran las unidades (5.3). ¿Cuáles sobran o están mal copiadas? | Una medida repetida pesa el doble o el triple en el IF global |
| **P12** | ¿Desviación del z-score poblacional (÷N, como scikit-learn) o muestral (÷N−1)? | Con los mismos datos, los números cambian un poco; para comparar con otros algoritmos tienen que coincidir |
| **P13** | Los 8 CSV de la UA tienen huecos y ya no se pueden analizar enteros (5.3). ¿Se tratan sus nulos fuera, se usan solo tramos completos o se dejan? | Con la regla de no rellenar, hoy solo sirven por trozos |

---

## 9. Cómo continuamos (propuesta)

1. **Responder P10 y P11** para poder trabajar con la pestaña 3: qué tramos usar y qué columnas sobran. Con eso se puede probar el caso enero → febrero del z-score con datos reales.
2. **Contextos con varias particiones**, para que RI e II aporten información con datos reales. Para la pestaña 3 se ha probado uno por magnitud (caudales, presiones de planta, presiones de red, calidad del agua, pozo y depósito); los definitivos los tiene que decidir quien conoce la planta.
3. **Ejecutable para Windows**, cuando se apruebe. La aplicación se empaqueta tal cual (Electron o Tauri). Un Web Worker solo haría falta si se trabaja con un año de datos.
4. **Probar con un año de datos**, sobre todo para medir memoria y tiempo.

---

## Anexo · Cómo usarlo y repetir las pruebas

Dentro de `cif/`:

| Comando | Qué hace |
|---|---|
| `npm start` | Abre la herramienta en el navegador (http://localhost:4200) |
| `npm test` | Ejecuta las 123 pruebas |
| `npm run comparar` | Compara el IF de Emilia con el IF propio (por defecto con `datasets/ConsumoAgua.csv`; otro fichero: `npm run comparar -- datasets/Solar.csv`) |

Los datasets van en `cif/datasets/`. Ni los datasets ni las pruebas se suben a git (D12): para repetir las pruebas hay que copiar aparte la carpeta `cif/pruebas/`, y `npm run comparar` necesita además la carpeta `isolation-forest-propio/` al lado de `cif/`.

**Ficheros principales** (en `cif/src/app/core/logica/`):

| Fichero | Contenido |
|---|---|
| `leer-csv.ts`, `pivotar.ts` | Lectura, pivotado y aviso de celdas vacías |
| `fusionar.ts` | Fusión por tipo y orden de la preparación de datos (Fig. 1) |
| `preparar.ts` | Procesado de características, lectura de números (coma decimal) y comprobación de que todas las columnas son numéricas |
| `rango.ts` | Rango de registros |
| `normalizar.ts` | Z-score y sus parámetros |
| `filtrar.ts` | Filtro por tipo, sensor y aulario; `columnas.csv` |
| `contextos.ts` | Contextos, particiones y su validación |
| `aplicar-isolation-forest.ts` | Parámetros y llamada al IF de Emilia con semilla |
| `semilla.ts` | Generador con semilla y sustitución temporal de `Math.random` |
| `cif.ts` | El CIF: IF global, IF por partición, RI, II, columnas constantes y exportación |
| `configuracion.ts` | JSON de configuración (guardar y cargar) |
| `../lib/isolation-forest/` | Isolation Forest de Emilia Rouanet, **sin modificar** |

Los gráficos están en `cif/src/app/graficos/` y cada paso del asistente tiene su componente en `cif/src/app/`.
