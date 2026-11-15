# CIF

Aplicación web (Angular 21) que aplica el método del artículo *Contextual Isolation Forests* (Saavedra, Arnau, Berna y Calatayud) a CSV de sensores. Funciona entera en el navegador, sin servidor.

Para cada momento calcula:

- **Score:** lo raro que es mirando todos los sensores a la vez (Isolation Forest global).
- **RI (recurrencia):** en qué parte de los grupos de sensores aparece la anomalía, de 0 (en ninguno) a 1 (en todos).
- **II (intensidad):** lo fuerte que es en esos grupos.
- **Clase:** grave, límite o normal, a partir de RI e II.

El Isolation Forest es la librería de Emilia Rouanet Feliu, copiada **sin cambios** de su proyecto *Isolation Forest Visualizer*. La semilla se consigue sustituyendo `Math.random` solo mientras se ejecuta su código (`core/logica/semilla.ts`).

## Uso

Requisitos: Node.js 20.19 o superior.

```bash
npm install
npm start
```

Abre http://localhost:4200. La aplicación es un asistente de cinco pasos; la barra de arriba enseña en qué paso estás y deja volver a los anteriores.

1. **Datos.** Elige cómo vienen los datos y los ficheros:
   - **Formato largo:** uno o varios CSV con una fila por lectura. Se pivotan y se fusionan por tipo.
   - **Ya pivotado:** un solo CSV con una fila por momento y una columna por sensor (por ejemplo, un `2_fusionado.csv`). No se pivota ni se fusiona, pero sí pasa por la preparación de datos del paso 2.
2. **Preparar.** Procesado de características y codificación (ver «Preparación de datos»), relleno de huecos y revisión de la tabla resultante. Si quieres, filtra las lecturas por tipo de medida (`name`), aulario (`alias`) o sensor (`uid`). Nada de esto vuelve a leer el CSV.
3. **Contextos.** Un contexto es una forma de mirar la instalación (por tipo, por edificio…) y sus particiones son los grupos de sensores que salen al mirarla así. Se pueden crear a mano o con «Contexto automático por tipo de medida». Sin contextos solo se calcula el IF global, sin RI ni II.
4. **Ajustes.** Parámetros del Isolation Forest y semilla. Con «Estimar árboles y umbral» la herramienta propone esos dos valores para tus datos (ver más abajo) y tú decides si los usas.
5. **Resultados.** Resumen arriba (registros, anomalías, graves y límite) y seis pestañas:
   - **Tabla:** la tabla CIF, como la Tabla 5 del artículo.
   - **Mapa RI–II:** gráfico de burbujas (Fig. 9). Aquí se cambian los cortes de la clasificación.
   - **Global y particiones:** score global frente al de cada partición (Fig. 8).
   - **En el tiempo:** score global a lo largo del tiempo.
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

La primera columna es el timestamp y el resto son columnas de datos. El separador (`;` o `,`) se detecta solo. Las filas se usan en el orden del fichero, las celdas vacías son huecos y las filas sin timestamp se descartan. Da error si hay columnas o timestamps repetidos o si una fila tiene más celdas que la cabecera.

## Parámetros

Todos los valores por defecto son los del artículo.

**Datos (pasos 1 y 2)**

| Parámetro | Por defecto | Significado |
|---|---|---|
| Columna timestamp | `timestamp` | Momento de la medida |
| Columna id | `uid` | Identificador del sensor |
| Columna valor | `value` | Valor medido |
| Columna tipo | `name` | Tipo de dato |
| Procesado de características | DD, MM, HH y MIN | Operaciones que se aplican en orden. Por defecto, las del experimento del artículo: día, mes, hora y minuto de la fecha |
| Diccionario de la codificación | vacío | Se puede cargar uno guardado para que los mismos valores de texto tengan el mismo número |
| Rellenar huecos con | Valor fijo | Valor fijo, valor anterior de la columna (o `0` si no hay) o dejar vacío |
| Valor de relleno | `0` | Con «Valor fijo», número entre 0 y 1 que se pone en cada hueco |

**Isolation Forest (paso 4)**

| Parámetro | Por defecto | Significado |
|---|---|---|
| Número de árboles | `10` | Árboles del bosque |
| Umbral | `0.70` | Una fila es anomalía si su score es **mayor** que el umbral |
| Tamaño de muestra | `256` | Filas al azar con las que se entrena cada árbol (si hay menos, se usan todas) |
| Semilla | al azar | Marcando «Usar siempre esta semilla», cada ejecución da el mismo resultado. La partición *k* usa semilla + *k* |
| Quitar columnas constantes | sí | Un sensor que vale siempre lo mismo acerca todos los scores a 0,5 en el IF de Emilia, y las anomalías no llegan al umbral |

Si quedan celdas vacías (con «Dejar vacío»), se tratan como `0` y la pantalla lo avisa.

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

Es el procedimiento 1 del artículo (`core/logica/preparar.ts` y `fusionar.ts`). Sus fases se aplican en el orden de la Fig. 1: procesado de características, codificación, valores nulos y contextos.

1. **Procesado de características.** Una lista de operaciones que se aplican una detrás de otra:
   - **Extraer:** saca de una fecha el día, el mes, el año, la hora, el minuto o el día de la semana (1 = lunes … 7 = domingo), o un trozo de un texto.
   - **Combinar:** junta dos columnas en una nueva (`zona1` y `bomba` → `zona1_bomba`).
   - **Eliminar:** quita una columna.
   - **Añadir:** crea una columna con el mismo valor en todas las filas.

   Por defecto se hace lo mismo que el artículo en su experimento: sacar DD, MM, HH y MIN del timestamp. Las columnas nuevas van al final de la tabla y se pueden usar en los contextos. El timestamp nunca es una característica: solo identifica la fila.
2. **Codificación.** El Isolation Forest solo trabaja con números. Las columnas con algún valor de texto se pasan a números con un diccionario único para toda la tabla. Las columnas numéricas no se tocan. El diccionario se puede descargar (`diccionario.csv`) y volver a cargar con otros datos.
3. **Valores nulos.** Los huecos se rellenan como se elija en «Rellenar huecos con».

Lo que el artículo no concreta y se ha decidido aquí:

- **Combinación:** une los dos valores como texto con `_`. Después la codificación lo convierte en número. Si falta uno de los dos valores, queda un hueco y lo trata la fase de nulos.
- **Fechas:** se leen tal como están escritas en el CSV (ISO o `DD/MM/YYYY HH:MM:SS`), sin cambiar de zona horaria.
- **Columnas mixtas:** si una columna tiene algún valor de texto, se codifican todos sus valores, también los que son números, para no confundir un código con un valor real.
- **Códigos:** empiezan en 1, para no confundirse con el 0 con que se rellenan los huecos.

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
| `1_pivotado.csv` | Paso 2 | Una fila por momento y una columna por sensor, sin separar por tipo |
| `2_fusionado.csv` | Paso 2 | La tabla que se analiza: columnas `tipo_uid` (p. ej. `electricityfacility_6339567`) más las del procesado, ya codificadas y con los huecos rellenos. Se puede cargar directamente en el visualizador de Emilia |
| `columnas.csv` | Paso 2 | Qué sensor y qué aulario hay detrás de cada columna |
| `diccionario.csv` | Paso 2 | Diccionario de la codificación (`valor;codigo`). Se puede volver a cargar en el paso 2 |
| `4_cif_semilla-N.csv` | Paso 5 | Tabla CIF: `id`, `timestamp`, `anomalia`, `clase`, `score`, `ii`, `ri` y el valor de cada partición |
| `4_cif_particiones_semilla-N.csv` | Paso 5 | Resumen por partición |
| `configuracion_semilla-N.json` | Arriba o paso 5 | Columnas, filtro, procesado de características, diccionario, relleno, parámetros, semilla, contextos, ajustes de la estimación y cortes. Los JSON antiguos siguen funcionando: si no traen procesado, no se procesa nada, para repetir el resultado de entonces |

`1_pivotado.csv` y `2_fusionado.csv` usan el formato del visualizador de Emilia: separador `;` y fecha `DD/MM/YYYY HH:MM:SS`, con la hora tal cual viene en el CSV de entrada. Los CSV de datos no llevan metadatos para no romper ese formato; la semilla va en el nombre del fichero y en el JSON.

## Estructura

```
src/app/
├── core/
│   ├── lib/isolation-forest/            librería de Emilia Rouanet (sin modificar)
│   └── logica/                          funciones puras, sin Angular
│       ├── leer-csv.ts                  lectura de los CSV con PapaParse
│       ├── pivotar.ts                   pivotado y exportación a CSV
│       ├── fusionar.ts                  fusión por tipo y orden de la preparación de datos (Fig. 1)
│       ├── preparar.ts                  procesado de características y codificación (procedimiento 1)
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

Este proyecto se distribuye bajo la licencia MIT. Consulta el archivo [LICENSE](LICENSE) para más detalles.
