/**
 * Rango de registros: quedarse con un trozo seguido de la tabla, por número de
 * registro (la fila de datos, desde 1). Lo pidió el tutor para usar solo las
 * épocas en las que no faltan datos (por ejemplo, el primer trimestre).
 *
 * - Los dos extremos están incluidos. null = sin límite por ese lado.
 * - Se conserva la numeración original: si el rango empieza en el 500, la
 *   primera fila sigue siendo el registro 500 (TablaPivotada.primerRegistro).
 *   Así el registro N es la misma fila que en el Excel.
 * - Se aplica antes de comprobar los huecos, así lo que falte fuera del rango
 *   no impide analizar lo de dentro.
 */
import type { TablaPivotada } from './pivotar';

export interface RangoRegistros {
  /** Primer registro (incluido). null = desde el principio. */
  desde: number | null;
  /** Último registro (incluido). null = hasta el final. */
  hasta: number | null;
}

export const SIN_RANGO: RangoRegistros = { desde: null, hasta: null };

/** true si el rango deja pasar toda la tabla. */
export function esSinRango(r: RangoRegistros): boolean {
  return r.desde === null && r.hasta === null;
}

/** Número de registro de la fila i (desde 0) de una tabla. */
export function registroDeFila(tabla: TablaPivotada, i: number): number {
  return (tabla.primerRegistro ?? 1) + i;
}

/**
 * Comprueba el rango. Con `numRegistros`, también que esté dentro de la tabla.
 * Devuelve un mensaje de error, o null si está bien.
 */
export function validarRango(r: RangoRegistros, numRegistros?: number): string | null {
  // ngModel deja null si se borra el campo, y NaN no es un entero: los dos casos.
  const entero = (x: number | null) => x === null || (Number.isInteger(x) && x >= 1);
  if (!entero(r.desde) || !entero(r.hasta)) {
    return 'El rango de registros debe ser de números enteros de 1 en adelante.';
  }
  if (r.desde !== null && r.hasta !== null && r.desde > r.hasta) {
    return `El rango de registros empieza después de acabar (del ${r.desde} al ${r.hasta}).`;
  }
  if (numRegistros !== undefined) {
    const fuera = [r.desde, r.hasta].find((x) => x !== null && x > numRegistros);
    if (fuera !== undefined) {
      return `La tabla tiene ${numRegistros} registros: no hay registro ${fuera}.`;
    }
  }
  return null;
}

/**
 * Las filas de la tabla dentro del rango, con primerRegistro puesto. No
 * modifica la de entrada. Lanza un error si el rango no es válido para la tabla.
 */
export function aplicarRango(tabla: TablaPivotada, r: RangoRegistros): TablaPivotada {
  const error = validarRango(r);
  if (error) {
    throw new Error(error);
  }
  if (esSinRango(r)) {
    return tabla;
  }
  // La tabla puede venir ya recortada: se cuenta desde su primer registro.
  const primero = tabla.primerRegistro ?? 1;
  const ultimo = primero + tabla.filas.length - 1;
  const fuera = [r.desde, r.hasta].find((x) => x !== null && (x < primero || x > ultimo));
  if (fuera !== undefined) {
    throw new Error(
      primero === 1
        ? `La tabla tiene ${ultimo} registros: no hay registro ${fuera}.`
        : `La tabla va del registro ${primero} al ${ultimo}: no hay registro ${fuera}.`,
    );
  }
  const desde = r.desde ?? primero;
  const hasta = r.hasta ?? ultimo;
  return {
    ...tabla,
    filas: tabla.filas.slice(desde - primero, hasta - primero + 1),
    primerRegistro: desde,
  };
}
