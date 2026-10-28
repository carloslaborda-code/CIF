/**
 * Aplica el Isolation Forest de Emilia Rouanet (core/lib/isolation-forest)
 * a la tabla fusionada del paso 2. Lo usa cif.ts, tanto para el IF global
 * como para el de cada partición.
 *
 * Aquí están los parámetros, el paso de la tabla (texto) a puntos numéricos
 * y el entrenamiento con semilla.
 *
 * Cada fila de la tabla (un timestamp) es un punto, y cada columna tipo_id
 * es una dimensión de ese punto. Lo que se busca son los momentos raros
 * mirando todos los sensores a la vez.
 */
import { iForest } from '../lib/isolation-forest';
import type { TablaPivotada } from './pivotar';
import { conSemilla, semillaAleatoria, validarSemilla } from './semilla';

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
  /** Si es true se usa `semilla`; si no, se genera una al azar en cada ejecución. */
  semillaFija: boolean;
  /** Semilla del generador aleatorio: misma semilla => mismo resultado. */
  semilla: number;
  /**
   * Si es true, las columnas que valen lo mismo en todas las filas no se le pasan
   * al bosque (ver columnasConstantes en cif.ts y el desplegable de la página).
   */
  quitarConstantes: boolean;
}

/** Valores del artículo "Contextual Isolation Forests". */
// 256 de muestra
export const PARAMETROS_IF_POR_DEFECTO: ParametrosIsolationForest = {
  numArboles: 10,
  umbral: 0.7,
  tamanoMuestra: 256,
  semillaFija: false,
  semilla: 42,
  quitarConstantes: true,
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
  // La semilla escrita solo importa si está fija; si no, se genera sola.
  if (p.semillaFija) {
    return validarSemilla(p.semilla);
  }
  return null;
}

/** Semilla que toca usar en una ejecución: la fija, o una nueva al azar. */
export function elegirSemilla(p: ParametrosIsolationForest): number {
  return p.semillaFija ? p.semilla : semillaAleatoria();
}

/**
 * Entrena el bosque de Emilia con los puntos y devuelve el score de cada uno,
 * en el mismo orden. Todo lo aleatorio sale de la semilla (ver semilla.ts).
 *
 * Al bosque se le pasa como muestra min(tamanoMuestra, nº de puntos), igual
 * que en el IF original: su score normaliza con c(tamaño de muestra), y si le
 * pidiéramos 256 con 47 filas los scores saldrían más bajos de lo que tocan.
 */
export function puntuarConSemilla(
  puntos: number[][],
  p: ParametrosIsolationForest,
  semilla: number,
): number[] {
  const muestra = Math.min(p.tamanoMuestra, puntos.length);
  return conSemilla(semilla, () => {
    const bosque = new iForest(p.numArboles, muestra);
    bosque.fit(puntos);
    return bosque.calculateScores(puntos);
  });
}

/**
 * Convierte la tabla (texto) en puntos numéricos: una fila = un punto,
 * una columna = una característica. Las celdas vacías o que no son números
 * se tratan como 0 y se cuentan.
 */
export function tablaAPuntos(tabla: TablaPivotada): {
  puntos: number[][];
  celdasNoNumericas: number;
} {
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
