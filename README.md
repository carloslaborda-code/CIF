# CIF

Aplicación web (Angular 21) que aplica el método del artículo *Contextual Isolation Forests* (Saavedra, Arnau, Berna y Calatayud) a CSV de sensores. Funciona entera en el navegador, sin servidor.

Para cada momento calcula:

- **Score:** lo raro que es mirando todos los sensores a la vez (Isolation Forest global).
- **RI (recurrencia):** en qué parte de los grupos de sensores aparece la anomalía, de 0 (en ninguno) a 1 (en todos).
- **II (intensidad):** lo fuerte que es en esos grupos.
- **Clase:** grave, límite o normal, a partir de RI e II.

El Isolation Forest es la librería de Emilia Rouanet Feliu, copiada **sin cambios** de su proyecto *Isolation Forest Visualizer*. La semilla se consigue sustituyendo `Math.random` solo mientras se ejecuta su código (`core/logica/semilla.ts`).

## Uso

Requisitos: Node.js 20.19+, 22.12+ o 24+ (los que admite Angular 21).

```bash
npm install
npm start
```

Abre http://localhost:4200. La aplicación es un asistente de cinco pasos; la barra de arriba enseña en qué paso estás y deja volver a los anteriores.

1. **Datos.** Elige cómo vienen los datos y los ficheros:
   - **Formato largo:** uno o varios CSV con una fila por lectura. Se pivotan y se fusionan por tipo.
   - **Ya pivotado:** un solo CSV con una fila por momento y una columna por sensor (por ejemplo, el `dataset.csv` que se guarda en el paso 2). Puede no tener columna de fecha: entonces se marca «El CSV no tiene columna de fecha» y cada fila se identifica por su número de registro. No se pivota ni se fusiona, pero sí pasa por la preparación de datos del paso 2. Un `2_fusionado.csv` ya viene preparado: si se vuelve a cargar con el procesado por defecto, da error porque ya tiene la columna `DD`.

   Si falta algún dato, la tabla no se hace y se dice en qué registros (ver «Datos que faltan»).
2. **Preparar.** Rango de registros, procesado de características y codificación (ver «Preparación de datos»), z-score opcional (ver «Normalización z-score») y revisión de la tabla resultante. Si quieres, filtra las lecturas por tipo de medida (`name`), aulario (`alias`) o sensor (`uid`). Nada de esto vuelve a leer el CSV.
3. **Contextos.** Un contexto es una forma de mirar la instalación (por tipo, por edificio…) y sus particiones son los grupos de sensores que salen al mirarla así. Se pueden crear a mano o con «Contexto automático por tipo de medida». Sin contextos solo se calcula el IF global, sin RI ni II.
4. **Ajustes.** Parámetros del Isolation Forest y semilla. Con «Estimar árboles y umbral» la herramienta propone esos dos valores para tus datos (ver más abajo) y tú decides si los usas.
5. **Resultados.** Resumen arriba (registros, anomalías, graves y límite) y seis pestañas. Cada fila se identifica por su número de registro:
   - **Tabla:** la tabla CIF, como la Tabla 5 del artículo.
   - **Mapa RI–II:** gráfico de burbujas (Fig. 9). Aquí se cambian los cortes de la clasificación.
   - **Global y particiones:** score global frente al de cada partición (Fig. 8).
   - **En el tiempo:** score global por número de registro.
   - **Contextos:** comparación de contextos y particiones.
   - **Descargas:** tabla, resumen por partición y configuración.

Con **Guardar configuración** y **Cargar configuración** (arriba a la derecha) se guarda todo en un JSON. Cargado con el mismo CSV, da exactamente el mismo resultado.

Al pasar el ratón por un gráfico se ven los valores exactos de ese punto. Con el teclado, las flechas pasan de un punto a otro y Escape cierra el recuadro. Todos los gráficos tienen además una tabla alternativa con los mismos datos.

## CSV de entrada

### Formato largo

Con cabecera. Por ejemplo:

```
"timestamp","name","uid","value","alias",...
"2026-10-01T00:00:00.000Z","electricityfacility","6339567","1","Aulario I",...
```

Las columnas `description`, `nombre_interno` y `names` se ignoran. `alias` solo se usa para filtrar por aulario y para `columnas.csv`.

### Ya pivotado

La primera columna es el timestamp y el resto son columnas de datos. Si se marca «El CSV no tiene columna de fecha», todas las columnas son datos. El separador (`;` o `,`) se detecta solo y los números pueden llevar coma decimal (`12,5`, `1,72E-02`), pero no separador de miles. Las filas se usan en el orden del fichero.

No puede faltar ningún dato: si hay celdas vacías (también la fecha) o filas más cortas que la cabecera, no se carga (ver «Datos que faltan»). Las filas vacías del final, que a veces deja Excel, no cuentan. También da error si hay columnas o timestamps repetidos o si una fila tiene más celdas que la cabecera.

**Desde Excel:** «Guardar como» → «CSV UTF-8 (delimitado por comas)». Con el CSV normal se estropean caracteres como `³` o `µ` en los nombres de columna. El CSV tiene que empezar por la cabecera. Con el formato «General», Excel guarda como mucho 11 caracteres por número; para conservar todas las cifras, pon antes formato de número con 15 decimales.

### Datos que faltan

El Isolation Forest no puede ejecutarse si faltan datos, y los nulos se tratan **antes** de cargar el CSV: la herramienta no rellena nada. Si falta algún dato, dice cuántos registros y celdas faltan y en cuáles, con sus columnas:

```
datos.csv: faltan datos en 3 registros (5 celdas vacías). Isolation Forest no puede ejecutarse si faltan datos: trata los nulos antes de cargar el CSV.
En el registro 42589 faltan datos (columna "Caudal2 (m³/h)").
…
```

- **Ya pivotado:** el CSV no se carga.
- **Formato largo:** los huecos aparecen al pivotar, cuando un sensor no tiene lectura en un momento. Se avisa con el registro y el momento («En el registro 5 (2026-10-01T00:20:00.000Z) faltan datos…») y se puede ir al paso 2 para cambiar el filtro o elegir un rango de registros sin huecos.

Si el procesado de características deja celdas vacías (por ejemplo, sacar el día de una columna que no es una fecha), también es un error, que apunta a las operaciones.

## Parámetros

Todos los valores por defecto son los del artículo.

**Datos (pasos 1 y 2)**

| Parámetro | Por defecto | Significado |
|---|---|---|
| Columna timestamp | `timestamp` | Momento de la medida |
| Columna id | `uid` | Identificador del sensor |
| Columna valor | `value` | Valor medido |
| Columna tipo | `name` | Tipo de dato |
| El CSV no tiene columna de fecha | no | Solo con «Una tabla ya hecha». Todas las columnas son datos y cada fila es su número de registro |
| Rango de registros | toda la tabla | Desde y hasta qué registro se analiza (incluidos) |
| Procesado de características | DD, MM, HH y MIN | Operaciones que se aplican en orden. Por defecto, las del experimento del artículo: día, mes, hora y minuto de la fecha. Sin columna de fecha, ninguna |
| Diccionario de la codificación | vacío | Se puede cargar uno guardado para que los mismos valores de texto tengan el mismo número |
| Z-score | no | Normaliza todas las columnas con la media y la desviación de estos datos o con unas guardadas |

**Isolation Forest (paso 4)**

| Parámetro | Por defecto | Significado |
|---|---|---|
| Número de árboles | `10` | Árboles del bosque |
| Umbral | `0.70` | Una fila es anomalía si su score es **mayor** que el umbral |
| Tamaño de muestra | `256` | Filas al azar con las que se entrena cada árbol (si hay menos, se usan todas) |
| Semilla | al azar | Marcando «Usar siempre esta semilla», cada ejecución da el mismo resultado. La partición *k* usa semilla + *k* |
| Quitar columnas constantes | sí | Un sensor que vale siempre lo mismo acerca todos los scores a 0,5 en el IF de Emilia, y las anomalías no llegan al umbral |

**Estimación de árboles y umbral (paso 4, «Ajustes de la estimación»)**

| Parámetro | Por defecto | Significado |
|---|---|---|
| Registros contaminados | `1 %` | Parte del subconjunto de registros normales que se contamina |
| Subida del valor | `50 %` | Cuánto se sube el valor contaminado al estimar los árboles |
| Características contaminadas por registro | `1` | Cuántas columnas se suben en cada registro contaminado. Pueden ser sensores o columnas creadas en el procesado, como DD o HH |

**Clasificación (paso 5, pestaña «Mapa RI–II»)**

| Parámetro | Por defecto | Significado |
|---|---|---|
| Corte de RI | `0.25` | Grave si RI es mayor que este valor… |
| Corte de II | `0` | …e II es mayor que este. Si no es grave pero sale en alguna partición o en el IF global, es límite |

## Preparación de datos

Es el procedimiento 1 del artículo (`core/logica/preparar.ts` y `fusionar.ts`). Sus fases se aplican en el orden de la Fig. 1: procesado de características, codificación, valores nulos y contextos. Antes se aplica el rango de registros y se comprueba que no falta ningún dato.

1. **Procesado de características.** Una lista de operaciones que se aplican una detrás de otra:
   - **Extraer:** saca de una fecha el día, el mes, el año, la hora, el minuto o el día de la semana (1 = lunes … 7 = domingo), o un trozo de un texto.
   - **Combinar:** junta dos columnas en una nueva (`zona1` y `bomba` → `zona1_bomba`).
   - **Eliminar:** quita una columna.
   - **Añadir:** crea una columna con el mismo valor en todas las filas.

   Por defecto se hace lo mismo que el artículo en su experimento: sacar DD, MM, HH y MIN del timestamp. Las columnas nuevas van al final de la tabla y se pueden usar en los contextos. El timestamp nunca es una característica: solo identifica la fila.
2. **Codificación.** El Isolation Forest solo trabaja con números. Las columnas con algún valor de texto se pasan a números con un diccionario único para toda la tabla. Las columnas numéricas no se tocan. El diccionario se puede descargar (`diccionario.csv`) y volver a cargar con otros datos.
3. **Valores nulos.** Se tratan antes de cargar el CSV, no en la herramienta (ver «Datos que faltan»).

Lo que el artículo no concreta y se ha decidido aquí:

- **Combinación:** une los dos valores como texto con `_`. Después la codificación lo convierte en número.
- **Fechas:** se leen tal como están escritas en el CSV (ISO o `DD/MM/YYYY HH:MM:SS`), sin cambiar de zona horaria.
- **Columnas mixtas:** si una columna tiene algún valor de texto, se codifican todos sus valores, también los que son números, para no confundir un código con un valor real.
- **Códigos:** empiezan en 1.

## Rango de registros

`core/logica/rango.ts`. Un registro es una fila de datos del CSV, numerada desde 1 (en el formato largo, una fila de la tabla alineada después del filtro). En el paso 2 se elige desde y hasta qué registro se analiza, los dos incluidos.

- **Se conserva la numeración:** si el rango empieza en el 8929, la primera fila es el registro 8929 en los avisos, la tabla, los gráficos y el CSV de resultados.
- **Se aplica antes de buscar huecos:** en el formato largo, lo que falte fuera del rango no impide analizar lo de dentro. Con un CSV ya pivotado no sirve para eso, porque un CSV con huecos no se carga.
- Al guardar el dataset en columnas con un rango, solo van esas filas; en el fichero, la primera vuelve a ser el registro 1.

## Normalización z-score

`core/logica/normalizar.ts`. Opcional, en el paso 2. Cambia cada valor por (valor − media) / desviación de su columna, para usar el mismo dataset, con los mismos números, en otros algoritmos que necesitan los datos normalizados. Al Isolation Forest no le cambia las anomalías (corta cada columna entre su mínimo y su máximo), pero sí la estimación de árboles y umbral.

- **Todas las columnas** de la tabla que recibe el IF, después del procesado y la codificación.
- **Desviación poblacional (÷N)**, como `StandardScaler` de scikit-learn. Una columna constante (desviación 0) queda a 0.
- **Parámetros:** la media y la desviación pueden ser las de estos datos o unas guardadas («Cargar parámetros…»). Así, febrero se normaliza con los parámetros de enero y todo tiene la misma forma estadística. Si a los parámetros les falta una columna de la tabla, es un error; si traen columnas de más, se avisa. Los parámetros cargados se mantienen al cambiar de CSV.
- **Ficheros:** `parametros_zscore.csv` (`columna;media;desviacion`, con todas las cifras) y `dataset_normalizado.csv`. Este último se puede volver a cargar como «Una tabla ya hecha» sin normalizar otra vez.

## Estimación de árboles y umbral

Es el procedimiento 2 del artículo (`core/logica/estimar.ts`). Tiene tres fases, que la pantalla enseña con sus gráficos:

1. **Subconjunto de registros normales (Fig. 5).** Se hace un IF sobre toda la tabla y se cogen los registros de la zona más repetida del histograma de scores. Tamaño: entre 256 registros y el 20 % de la tabla.
2. **Número de árboles (Fig. 6).** Se contamina el 1 % de esos registros subiendo un 50 % una característica al azar y se prueba con 2, 4, 6… 100 árboles. Se propone el primero a partir del cual ya no mejora.
3. **Umbral (Fig. 7).** Con esos árboles se contamina del 10 % al 200 % y se propone el umbral donde la curva se queda plana.

Lo único que el artículo no concreta y se ha decidido aquí: la característica que se contamina se elige entre las que no valen 0 en ese registro, porque subir un 50 % un 0 sigue dando 0.

La estimación se da por fiable si el IF encuentra los registros contaminados (F1 de al menos 0,8) y el umbral llega a estabilizarse. Si no, la pantalla lo avisa y el botón pasa a decir «Usarlos de todos modos». También avisa, aparte, si el subconjunto supera el 20 % de la tabla o si con los valores propuestos saldría más del 5 % de la tabla como anomalía.

La estimación funciona mejor cuando los registros normales tienen valores en la mitad del rango de cada columna, como los niveles, caudales y presiones del artículo. Con contadores de consumo sale **poco fiable**. Los registros más normales son los de noche, con valores cerca de 0, y subirlos un 50 % apenas los mueve dentro del rango de su columna. Con 3 meses de agua y de electricidad de la UA, el IF solo encuentra 1 de los 17 registros contaminados.

## CSV y JSON de salida

| Fichero | Dónde | Contenido |
|---|---|---|
| `dataset.csv` | Paso 2 (solo con CSV largo) | El dataset en columnas para volver a cargarlo como «Una tabla ya hecha» sin pivotar otra vez: columnas `tipo_uid`, con el filtro y el rango aplicados, sin procesado ni codificación. Solo se guarda si no le faltan datos. Al cargarlo da lo mismo que el CSV largo |
| `1_pivotado.csv` | Paso 2 | Una fila por momento y una columna por sensor, sin separar por tipo |
| `2_fusionado.csv` | Paso 2 | La tabla preparada: columnas `tipo_uid` (p. ej. `electricityfacility_6339567`) más las del procesado, ya codificadas. Sin z-score. Se puede cargar directamente en el visualizador de Emilia |
| `columnas.csv` | Paso 2 | Qué sensor y qué aulario hay detrás de cada columna |
| `diccionario.csv` | Paso 2 | Diccionario de la codificación (`valor;codigo`). Se puede volver a cargar en el paso 2 |
| `parametros_zscore.csv` | Paso 2 (con z-score) | Media y desviación de cada columna (`columna;media;desviacion`). Se puede volver a cargar para normalizar otros datos igual |
| `dataset_normalizado.csv` | Paso 2 (con z-score) | La tabla que recibe el IF, normalizada, con todas las cifras y punto decimal |
| `4_cif_semilla-N.csv` | Paso 5 | Tabla CIF: `registro`, `timestamp` (solo si hay fecha), `anomalia`, `clase`, `score`, `ii`, `ri` y el valor de cada partición |
| `4_cif_particiones_semilla-N.csv` | Paso 5 | Resumen por partición |
| `configuracion_semilla-N.json` | Arriba o paso 5 | Columnas, si el CSV tiene fecha, filtro, rango, procesado de características, diccionario, z-score con sus parámetros, parámetros del IF, semilla, contextos, ajustes de la estimación y cortes. Los JSON antiguos siguen funcionando: si no traen procesado, no se procesa nada, para repetir el resultado de entonces; si traen relleno, se ignora |

`dataset.csv`, `1_pivotado.csv`, `2_fusionado.csv` y `dataset_normalizado.csv` usan el formato del visualizador de Emilia: separador `;` y fecha `DD/MM/YYYY HH:MM:SS`, con la hora tal cual viene en el CSV de entrada. Sin columna de fecha, la primera columna es `registro`. Los CSV de datos no llevan metadatos para no romper ese formato; la semilla va en el nombre del fichero y en el JSON.

## Estructura

```
src/app/
├── core/
│   ├── lib/isolation-forest/            librería de Emilia Rouanet (sin modificar)
│   └── logica/                          funciones puras, sin Angular
│       ├── leer-csv.ts                  lectura de los CSV con PapaParse y aviso de celdas vacías
│       ├── pivotar.ts                   pivotado y exportación a CSV
│       ├── fusionar.ts                  fusión por tipo y orden de la preparación de datos (Fig. 1)
│       ├── rango.ts                     rango de registros
│       ├── preparar.ts                  procesado de características y codificación (procedimiento 1)
│       ├── normalizar.ts                z-score y sus parámetros
│       ├── filtrar.ts                   filtro por tipo, sensor y aulario; columnas.csv
│       ├── contextos.ts                 contextos, particiones y su validación
│       ├── semilla.ts                   generador con semilla y sustitución de Math.random
│       ├── aplicar-isolation-forest.ts  parámetros y llamada al IF de Emilia
│       ├── cif.ts                       IF global, IF por partición, RI, II y exportación
│       ├── estimar.ts                   estimación de árboles y umbral (procedimiento 2)
│       ├── clasificar.ts                grave / límite / normal
│       └── configuracion.ts             JSON de configuración (guardar y cargar)
├── pagina-principal/                    el asistente de cinco pasos
├── ui/                                  barra de pasos y pestañas
├── vista-previa/                        primeras filas de una tabla
├── panel-preparacion/                   procesado de características y codificación (paso 2)
├── panel-filtros/                       filtro de lecturas (paso 2)
├── panel-rango/                         rango de registros (paso 2)
├── editor-contextos/                    contextos y particiones (paso 3)
├── panel-estimacion/                    estimación de árboles y umbral (paso 4)
├── resultados/                          resumen y pestañas (paso 5)
├── tabla-cif/                           tabla CIF
├── comparacion-particiones/             comparación de contextos y particiones
└── graficos/                            gráficos en SVG hechos a mano (histograma, líneas, burbujas, particiones)
```

Los gráficos no usan librería a propósito:

- **Fidelidad al artículo:** reproducen las Fig. 5 a 9 tal cual (paneles, métricas y zonas grave / límite), algo difícil de conseguir ajustando el estilo de una librería.
- **Accesibilidad:** son SVG, que se pueden recorrer con teclado, y cada uno tiene su tabla alternativa. Las librerías habituales (Chart.js, ECharts) dibujan en un `<canvas>`, que un lector de pantalla no puede leer.
- **Sin dependencias nuevas:** la aplicación pesa menos y no depende de que una librería siga siendo compatible con Angular.

## Licencia

El código de este proyecto se distribuye bajo la licencia MIT. Consulta el archivo [LICENSE](LICENSE) para más detalles.

**Excepción:** la carpeta `src/app/core/lib/isolation-forest/` es la librería de Emilia Rouanet Feliu, de su proyecto *Isolation Forest Visualizer*. Se incluye sin cambios y con permiso de su autora, que solo pide que se la mencione. No está cubierta por la licencia MIT de este proyecto: si reutilizas esa carpeta, menciona a Emilia Rouanet Feliu como autora.
