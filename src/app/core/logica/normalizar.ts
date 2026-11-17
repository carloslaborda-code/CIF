/**
 * Normalización z-score, opcional. La pidió el tutor para comparar el CIF con
 * otros algoritmos que sí la necesitan, usando el mismo dataset con los mismos
 * números. (Al Isolation Forest no le cambia nada: corta cada columna entre su
 * mínimo y su máximo, así que la escala no le afecta.)
 *
 *   z = (x − media) / desviación
 *
 * Los parámetros (media y desviación de cada columna) se guardan y se pueden
 * cargar para aplicarlos a otros datos: si se normaliza enero, febrero se tiene
 * que normalizar con los parámetros de enero y no con los suyos, para que todo
 * tenga la misma forma estadística.
 *
 * Lo que el tutor no concretó y aquí se ha decidido:
 *   - La desviación es la poblacional (÷N), como StandardScaler de scikit-learn,
 *     para que salgan los mismos números si se compara con algoritmos en Python.
 *   - Se normalizan todas las columnas de la tabla ("subo un dataset y le aplico
 *     el z-score").
 *   - Si una columna tiene desviación 0 (es constante), queda a 0 en vez de
 *     dividir entre 0. Es lo que hace StandardScaler.
 *   - Los parámetros van en CSV (columna;media;desviacion), como el diccionario,
 *     con punto decimal y todas las cifras, para que al cargarlos salgan
 *     exactamente los mismos números.
 */
import * as Papa from 'papaparse';

import type { TablaPivotada } from './pivotar';
import { aNumero } from './preparar';

/** Media y desviación de una columna. */
export interface ParametroColumna {
  columna: string;
  media: number;
  desviacion: number;
}

export type ParametrosNormalizacion = ParametroColumna[];

/** Los valores de la tabla como números. Lanza un error si alguno no lo es. */
function columnasNumericas(tabla: TablaPivotada): number[][] {
  const columnas = tabla.ids.map(() => [] as number[]);
  tabla.filas.forEach((fila, i) => {
    fila.valores.forEach((texto, c) => {
      const x = aNumero(texto);
      if (!Number.isFinite(x)) {
        const registro = (tabla.primerRegistro ?? 1) + i;
        throw new Error(
          `No se puede normalizar: en el registro ${registro}, la columna "${tabla.ids[c]}" ` +
            `no es un número ("${texto}").`,
        );
      }
      columnas[c].push(x);
    });
  });
  return columnas;
}

/** Media y desviación poblacional (÷N) de cada columna. */
export function calcularParametros(tabla: TablaPivotada): ParametrosNormalizacion {
  if (tabla.filas.length === 0) {
    throw new Error('No se puede normalizar una tabla sin filas.');
  }
  return columnasNumericas(tabla).map((valores, c) => {
    const n = valores.length;
    const media = valores.reduce((s, x) => s + x, 0) / n;
    // En dos pasadas (primero la media), que es más exacto que la suma de cuadrados.
    const varianza = valores.reduce((s, x) => s + (x - media) ** 2, 0) / n;
    return { columna: tabla.ids[c], media, desviacion: Math.sqrt(varianza) };
  });
}

/**
 * Comprueba unos parámetros (por ejemplo, cargados de un fichero).
 * Devuelve un mensaje de error, o null si están bien.
 */
export function validarParametros(p: ParametrosNormalizacion): string | null {
  const vistas = new Set<string>();
  for (const { columna, media, desviacion } of p) {
    if (columna === '') {
      return 'Hay parámetros sin nombre de columna.';
    }
    if (vistas.has(columna)) {
      return `La columna "${columna}" sale dos veces en los parámetros.`;
    }
    vistas.add(columna);
    if (!Number.isFinite(media)) {
      return `La media de "${columna}" no es un número.`;
    }
    if (!Number.isFinite(desviacion) || desviacion < 0) {
      return `La desviación de "${columna}" debe ser un número de 0 en adelante.`;
    }
  }
  return null;
}

export interface ResultadoNormalizacion {
  /** La tabla con cada valor cambiado por su z-score. */
  tabla: TablaPivotada;
  /** Columnas de los parámetros que no están en la tabla (no se usan). */
  columnasSinUsar: string[];
}

/**
 * Normaliza la tabla con los parámetros dados (los suyos o unos cargados) y
 * devuelve una tabla nueva; no modifica la de entrada. Lanza un error si a los
 * parámetros les falta alguna columna de la tabla.
 */
export function normalizar(
  tabla: TablaPivotada,
  parametros: ParametrosNormalizacion,
): ResultadoNormalizacion {
  const error = validarParametros(parametros);
  if (error) {
    throw new Error(error);
  }
  const porColumna = new Map(parametros.map((p) => [p.columna, p]));
  const faltan = tabla.ids.filter((id) => !porColumna.has(id));
  if (faltan.length > 0) {
    const nombres = faltan.slice(0, 3).map((c) => `"${c}"`).join(', ');
    const resto = faltan.length > 3 ? ` y ${faltan.length - 3} más` : '';
    throw new Error(
      `A los parámetros de normalización les ${faltan.length === 1 ? 'falta la columna' : 'faltan las columnas'} ` +
        `${nombres}${resto}. Tienen que ser de unos datos con las mismas columnas.`,
    );
  }

  const columnas = columnasNumericas(tabla);
  const usados = tabla.ids.map((id) => porColumna.get(id)!);
  const filas = tabla.filas.map((fila, i) => ({
    timestamp: fila.timestamp,
    valores: usados.map(({ media, desviacion }, c) =>
      // Columna constante: 0, como StandardScaler (sin dividir entre 0).
      String(desviacion === 0 ? 0 : (columnas[c][i] - media) / desviacion),
    ),
  }));
  const enTabla = new Set(tabla.ids);
  return {
    tabla: { ...tabla, filas },
    columnasSinUsar: parametros.map((p) => p.columna).filter((c) => !enTabla.has(c)),
  };
}

/** Los parámetros como CSV (columna;media;desviacion), en el orden de las columnas. */
export function parametrosACsv(p: ParametrosNormalizacion): string {
  return (
    Papa.unparse(
      {
        fields: ['columna', 'media', 'desviacion'],
        // String(x) da las cifras justas para que, al leerlo, salga el mismo número.
        data: p.map((x) => [x.columna, String(x.media), String(x.desviacion)]),
      },
      { delimiter: ';' },
    ) + '\n'
  );
}

/**
 * Lee unos parámetros en el CSV que genera parametrosACsv. También acepta la
 * coma decimal, por si se han tocado en Excel. Lanza un Error con un mensaje
 * entendible si no tienen ese formato.
 */
export function leerParametrosCsv(texto: string): ParametrosNormalizacion {
  const { data } = Papa.parse<string[]>(texto.replace(/^﻿/, ''), {
    delimiter: ';',
    skipEmptyLines: true,
  });
  const [cabecera, ...filas] = data;
  const nombres = (cabecera ?? []).map((c) => c.trim());
  if (nombres[0] !== 'columna' || nombres[1] !== 'media' || nombres[2] !== 'desviacion') {
    throw new Error(
      'Los parámetros de normalización deben ser un CSV con la cabecera "columna;media;desviacion".',
    );
  }
  if (filas.length === 0) {
    throw new Error('El fichero de parámetros no tiene ninguna columna.');
  }
  const p: ParametrosNormalizacion = filas.map((fila, i) => {
    if (fila.length < 3) {
      throw new Error(`Fila ${i + 2} de los parámetros: faltan la media o la desviación.`);
    }
    return { columna: fila[0].trim(), media: aNumero(fila[1]), desviacion: aNumero(fila[2]) };
  });
  const error = validarParametros(p);
  if (error) {
    throw new Error(error);
  }
  return p;
}
