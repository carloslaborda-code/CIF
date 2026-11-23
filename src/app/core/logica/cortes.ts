/**
 * Cortes de RI e II del mapa RI–II (como indicó el tutor): se fijan un valor de
 * RI y otro de II, y los registros que quedan por encima de los dos son
 * anomalías CIF. Los demás no.
 *
 * Una anomalía CIF no tiene por qué ser anomalía global: un registro con score
 * global bajo puede salir en muchas particiones y con fuerza, y al revés.
 *
 * II es la media de los scores de las particiones donde el registro es anomalía,
 * y esos scores siempre superan el umbral del Isolation Forest. Por eso II
 * siempre es mayor que el umbral, y el corte de II empieza en él: un corte más
 * bajo no separaría nada.
 */

export interface CortesCif {
  /** Corte de RI: anomalía CIF si RI es mayor. */
  ri: number;
  /** Corte de II: anomalía CIF si II es mayor. */
  ii: number;
}

/** Corte de RI por defecto: el del artículo (RI > 0,25). */
export const CORTE_RI_POR_DEFECTO = 0.25;

/** Cortes por defecto: RI 0,25 (artículo) e II en el umbral del Isolation Forest. */
export function cortesPorDefecto(umbral: number): CortesCif {
  return { ri: CORTE_RI_POR_DEFECTO, ii: umbral };
}

/** Comprueba los cortes. Devuelve un mensaje de error, o null si están bien. */
export function validarCortes(c: CortesCif): string | null {
  const vale = (x: unknown) => typeof x === 'number' && x >= 0 && x <= 1;
  return vale(c.ri) && vale(c.ii) ? null : 'Los cortes de RI e II deben estar entre 0 y 1.';
}

/**
 * true si el registro es anomalía CIF: RI e II por encima de los dos cortes. Sin
 * II (no es anomalía en ninguna partición) nunca lo es.
 */
export function esAnomaliaCif(fila: { ri: number; ii: number | null }, c: CortesCif): boolean {
  return fila.ii !== null && fila.ri > c.ri && fila.ii > c.ii;
}
