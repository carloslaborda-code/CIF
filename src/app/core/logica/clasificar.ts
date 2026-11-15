/**
 * Clasificación de cada registro en grave, límite o normal a partir de RI e II
 * (apartado 5 del artículo, junto a la Fig. 9).
 *
 *   - Grave:  RI > 0,25 e II > 0. La anomalía sale en bastantes particiones y con
 *             intensidad. En la Tabla 5 son los 4 registros con RI = 0,63 e II ≈ 0,75.
 *   - Límite: no es grave, pero sale en alguna partición (RI > 0) o es anomalía
 *             global. Son los casos de transición del artículo: el 14341
 *             (RI = 0,38, II = 0) o el 27308 (RI = 0,25, II = 0).
 *   - Normal: no sale en ninguna partición ni en el IF global.
 *
 * Los dos cortes (0,25 y 0) son los del artículo y se pueden cambiar en la pantalla.
 */

export type Clase = 'grave' | 'limite' | 'normal';

export interface CortesClasificacion {
  /** Grave si RI es mayor que este valor... */
  ri: number;
  /** ...e II es mayor que este. */
  ii: number;
}

export const CORTES_POR_DEFECTO: CortesClasificacion = { ri: 0.25, ii: 0 };

/** Nombre de cada clase para enseñarlo. */
export const NOMBRE_CLASE: Record<Clase, string> = {
  grave: 'Grave',
  limite: 'Límite',
  normal: 'Normal',
};

/** Comprueba los cortes. Devuelve un mensaje de error, o null si están bien. */
export function validarCortes(c: CortesClasificacion): string | null {
  const vale = (x: unknown) => typeof x === 'number' && x >= 0 && x <= 1;
  return vale(c.ri) && vale(c.ii) ? null : 'Los cortes de RI e II deben estar entre 0 y 1.';
}

/** Clase de un registro. Solo necesita si es anomalía global, su RI y su II. */
export function clasificar(
  fila: { anomalia: boolean; ri: number; ii: number },
  cortes: CortesClasificacion = CORTES_POR_DEFECTO,
): Clase {
  if (fila.ri > cortes.ri && fila.ii > cortes.ii) {
    return 'grave';
  }
  return fila.anomalia || fila.ri > 0 ? 'limite' : 'normal';
}

/** Cuántos registros hay de cada clase. */
export function contarClases(
  filas: { anomalia: boolean; ri: number; ii: number }[],
  cortes: CortesClasificacion = CORTES_POR_DEFECTO,
): Record<Clase, number> {
  const cuenta: Record<Clase, number> = { grave: 0, limite: 0, normal: 0 };
  for (const f of filas) {
    cuenta[clasificar(f, cortes)]++;
  }
  return cuenta;
}
