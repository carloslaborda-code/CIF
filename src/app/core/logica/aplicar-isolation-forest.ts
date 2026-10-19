/**
 * Aplica el Isolation Forest de Emilia Rouanet (core/lib/isolation-forest)
 * a la tabla fusionada del paso 2.
 *
 * El flujo es:
 *   - se convierte la tabla (texto) en puntos numéricos,
 *   - se marca como anomalía cada fila con score mayor que el umbral,
 *   - se resume el resultado y se exporta a CSV.
 *
 * Cada fila de la tabla (un timestamp) es un punto, y cada columna tipo_id
 * es una dimensión de ese punto. Lo que se busca son los momentos raros
 * mirando todos los sensores a la vez.
 */
import { iForest } from '../lib/isolation-forest';
import type { TablaPivotada } from './pivotar';

// ---------------------------------------------------------------------------
// Parámetros
// ---------------------------------------------------------------------------

export interface ParametrosIsolationForest {
  /** Número de árboles del bosque. */
  numArboles: number;
  /** Un punto es anomalía si su score es mayor que este umbral. */
  umbral: number;
  /** Filas con las que se entrena cada árbol (si hay menos, se usan todas). */
  tamanoMuestra: number;
}

/** Valores del artículo "Contextual Isolation Forests". */
// 256 de muestra
export const PARAMETROS_IF_POR_DEFECTO: ParametrosIsolationForest = {
  numArboles: 10,
  umbral: 0.7,
  tamanoMuestra: 256,
};

/** Comprueba los parámetros. Devuelve un mensaje de error, o null si están bien. */
export function validarParametrosIF(p: ParametrosIsolationForest): string | null {
  // Si el usuario borra el input de tipo number, ngModel deja null y no un número,
  // por eso miramos también el typeof y no solo el valor.
  const esEntero = (x: unknown) => typeof x === 'number' && Number.isInteger(x);

  if (!esEntero(p.numArboles) || p.numArboles < 1) {
    return 'El número de árboles debe ser un entero mayor que 0.';
  }
  // El score del Isolation Forest siempre está entre 0 y 1, así que un umbral
  // fuera de ese rango no tendría sentido. El !(...) también pilla el NaN.
  if (typeof p.umbral !== 'number' || !(p.umbral >= 0 && p.umbral <= 1)) {
    return 'El umbral debe ser un número entre 0 y 1.';
  }
  // Con 1 sola fila no se puede partir nada, el árbol no tendría sentido.
  if (!esEntero(p.tamanoMuestra) || p.tamanoMuestra < 2) {
    return 'El tamaño de muestra debe ser un entero de al menos 2.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Uso con la tabla fusionada (paso 2)
// ---------------------------------------------------------------------------

/** Resultado de una fila: su timestamp, su score y si es anomalía. */
export interface FilaScore {
  timestamp: string;
  score: number;
  anomalia: boolean;
}

// Resultado de la aplicación del Isolation Forest en la pantalla del paso 3.
export interface ResultadoIsolationForest {
  /** Una fila por timestamp, en el mismo orden que la tabla. */
  filas: FilaScore[];
  numAnomalias: number;
  scoreMinimo: number;
  scoreMedio: number;
  scoreMaximo: number;
  /** Filas que entran en la muestra de cada árbol (puede ser menor que el pedido). */
  tamanoMuestra: number;
  /** Celdas vacías o no numéricas que se han tratado como 0. */
  celdasNoNumericas: number;
}

/**
 * Convierte la tabla (texto) en puntos numéricos: una fila = un punto,
 * una columna = una característica. Las celdas vacías o que no son números
 * se tratan como 0 y se cuentan.
 */
export function tablaAPuntos(tabla: TablaPivotada): { puntos: number[][]; celdasNoNumericas: number } {
  let celdasNoNumericas = 0;
  const puntos = tabla.filas.map((fila) =>
    fila.valores.map((texto) => {
      const numero = Number(texto);
      // Number('') da 0 y no NaN, por eso el vacío lo comprobamos aparte.
      // Si no, una celda vacía contaría como un 0 "de verdad" y no saldría en el aviso.
      if (texto.trim() === '' || !Number.isFinite(numero)) {
        celdasNoNumericas++;
        return 0;
      }
      return numero;
    }),
  );
  return { puntos, celdasNoNumericas };
}

/** Aplica el Isolation Forest de Emilia Rouanet a una tabla y resume el resultado. */
export function ejecutarIsolationForest(
  tabla: TablaPivotada,
  p: ParametrosIsolationForest,
): ResultadoIsolationForest {
  if (tabla.filas.length < 2) {
    throw new Error('Hacen falta al menos 2 filas para el Isolation Forest.');
  }

  const { puntos, celdasNoNumericas } = tablaAPuntos(tabla);

  // se crea el bosque, se entrena con los puntos
  // y se calcula el score de esos mismos puntos.
  const bosque = new iForest(p.numArboles, p.tamanoMuestra);
  bosque.fit(puntos);
  const scores = bosque.calculateScores(puntos);

  // scores[i] es el de la fila i, porque la librería respeta el orden de entrada.
  const filas = tabla.filas.map((fila, i) => ({
    timestamp: fila.timestamp,
    score: scores[i],
    anomalia: scores[i] > p.umbral,
  }));

  // Mínimo, media y máximo con un bucle (Math.min(...scores) falla con muchas filas).
  let scoreMinimo = Infinity;
  let scoreMaximo = -Infinity;
  let suma = 0;
  for (const score of scores) {
    scoreMinimo = Math.min(scoreMinimo, score);
    scoreMaximo = Math.max(scoreMaximo, score);
    suma += score;
  }

  return {
    filas,
    numAnomalias: filas.filter((f) => f.anomalia).length,
    scoreMinimo,
    scoreMedio: suma / scores.length,
    scoreMaximo,
    // Si la tabla tiene menos filas que la muestra pedida, se usan todas.
    // Lo devolvemos para que en pantalla se vea el número real.
    tamanoMuestra: Math.min(p.tamanoMuestra, puntos.length),
    celdasNoNumericas,
  };
}

/** Las n filas con score más alto, de mayor a menor. */
export function filasConMasScore(filas: FilaScore[], n: number): FilaScore[] {
  // Copiamos con [...filas] antes de ordenar porque sort() cambia el array original,
  // y el original tiene que seguir en orden de timestamp para el CSV.
  return [...filas].sort((a, b) => b.score - a.score).slice(0, n);
}

/** CSV con las columnas timestamp, score, anomalia (1 o 0). */
// Este CSV se hace a mano y no con PapaParse porque son solo tres columnas.
export function scoresACsv(filas: FilaScore[]): string {
  // Entre comillas si el texto lleva comas, comillas o saltos de línea.
  // Las comillas de dentro se duplican, que es como lo marca el formato CSV.
  const celda = (texto: string) => (/[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto);

  const lineas = ['timestamp,score,anomalia'];
  for (const f of filas) {
    lineas.push(`${celda(f.timestamp)},${f.score},${f.anomalia ? 1 : 0}`);
  }
  // \r\n para que Excel en Windows lo abra bien.
  return lineas.join('\r\n');
}
