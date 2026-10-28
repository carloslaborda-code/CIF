/**
 * Semilla para el Isolation Forest de Emilia Rouanet sin tocar su código.
 *
 * Su librería (core/lib/isolation-forest) usa Math.random() para barajar la
 * muestra y para elegir los cortes, y Math.random() no deja fijar semilla.
 * Lo que hacemos es cambiar Math.random por un generador con semilla solo
 * mientras se ejecuta su código, y dejarlo como estaba al terminar.
 *
 * Como JavaScript ejecuta el código síncrono sin interrupciones, durante ese
 * rato nadie más usa Math.random, así que no afecta al resto de la página.
 */

/** Mayor semilla válida: el generador trabaja con enteros sin signo de 32 bits. */
export const SEMILLA_MAXIMA = 4294967295;

/**
 * mulberry32: generador pseudoaleatorio pequeño y rápido (el mismo que en
 * isolation-forest-propio). Con la misma semilla devuelve siempre la misma
 * secuencia de números en [0, 1).
 */
export function mulberry32(semilla: number): () => number {
  let estado = semilla >>> 0; // entero sin signo de 32 bits
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ejecuta `fn` con Math.random sustituido por mulberry32(semilla).
 * El finally hace que Math.random se restaure aunque `fn` lance un error.
 */
export function conSemilla<T>(semilla: number, fn: () => T): T {
  const original = Math.random;
  Math.random = mulberry32(semilla);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/**
 * Semilla al azar para cuando el usuario no fija una. Es un número de 6 cifras
 * como mucho, para que sea fácil de copiar y de escribir a mano.
 */
export function semillaAleatoria(): number {
  return Math.floor(Math.random() * 1_000_000);
}

/**
 * Semilla de la ejecución número `k` a partir de la principal.
 * El IF global usa la semilla tal cual (k = 0) y la partición k-ésima usa
 * semilla + k, así cada partición tiene su propia secuencia y todo se puede
 * repetir sabiendo solo la semilla principal.
 */
export function derivarSemilla(semilla: number, k: number): number {
  return (semilla + k) >>> 0;
}

/** Comprueba una semilla escrita a mano. Devuelve un mensaje de error, o null si está bien. */
export function validarSemilla(semilla: unknown): string | null {
  // Igual que con los otros inputs number: si se borra, ngModel deja null.
  if (
    typeof semilla !== 'number' ||
    !Number.isInteger(semilla) ||
    semilla < 0 ||
    semilla > SEMILLA_MAXIMA
  ) {
    return `La semilla debe ser un entero entre 0 y ${SEMILLA_MAXIMA}.`;
  }
  return null;
}
