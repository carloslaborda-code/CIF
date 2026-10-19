# CIF

Aplicación web (Angular 21) que prepara CSV de sensores y detecta anomalías con Isolation Forest. Funciona entera en el navegador, sin servidor.

1. **Pivotado:** pasa del formato largo (una fila por sensor y momento) a una fila por timestamp y una columna por sensor → `1_pivotado.csv`.
2. **Fusionado por tipo:** pivota cada tipo (electricidad, agua...) por separado, nombra las columnas `tipo_id` (p. ej. `electricityfacility_6339567`), alinea los timestamps y rellena los huecos → `2_fusionado.csv`.
3. **Isolation Forest:** da un score de anomalía a cada fila de la tabla fusionada → `3_scores.csv` (`timestamp,score,anomalia`).

El Isolation Forest es la librería de Emilia Rouanet Feliu, copiada sin cambios de su proyecto *Isolation Forest Visualizer*.

## Uso

Requisitos: Node.js 20.19 o superior.

```bash
npm install
npm start
```

Abre http://localhost:4200, elige uno o varios CSV, pulsa **Procesar** y después **Ejecutar Isolation Forest**.

## CSV de entrada

Formato largo, con cabecera. Por ejemplo:

```
"timestamp","name","uid","value",...
"2026-10-01T00:00:00.000Z","electricityfacility","6339567","1",...
```

Las columnas `alias`, `description`, `nombre_interno` y `names` se ignoran.

## Parámetros

| Parámetro | Por defecto | Significado |
|---|---|---|
| Columna timestamp | `timestamp` | Momento de la medida |
| Columna id | `uid` | Identificador del sensor |
| Columna valor | `value` | Valor medido |
| Columna tipo | `name` | Tipo de dato |
| Rellenar huecos con | `0` | `0`, valor anterior de la columna (o `0` si no hay) o dejar vacío |
| Número de árboles | `10` | Árboles del bosque |
| Umbral | `0.70` | Una fila es anomalía si su score es mayor que el umbral |
| Tamaño de muestra | `256` | Filas al azar con las que se entrena cada árbol (si hay menos, se usan todas) |

Los valores del Isolation Forest son los del artículo "Contextual Isolation Forests". La librería usa `Math.random()`, así que dos ejecuciones pueden dar scores algo distintos. Las celdas vacías se tratan como `0`.

## CSV de salida

`1_pivotado.csv` y `2_fusionado.csv` usan el formato del visualizador de Emilia: separador `;` y fecha `DD/MM/YYYY HH:MM:SS`, con la hora tal cual viene en el CSV de entrada. `2_fusionado.csv` se puede cargar directamente en su app.

## Estructura

```
src/app/
├── core/
│   ├── lib/isolation-forest/            librería de Emilia Rouanet (sin modificar)
│   └── logica/                          funciones puras, sin Angular
│       ├── leer-csv.ts                  lectura de los CSV con PapaParse
│       ├── pivotar.ts                   paso 1 y exportación a CSV
│       ├── fusionar.ts                  paso 2
│       └── aplicar-isolation-forest.ts  paso 3: usa la librería, aplica el umbral y genera 3_scores.csv
├── pagina-principal/                    la página (formulario y resultados)
└── vista-previa/                        tabla con las primeras filas de un resultado
```
