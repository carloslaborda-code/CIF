/**
 * Funciones pequeñas que comparten todos los gráficos (que se dibujan a mano en
 * SVG, sin librerías): pasar de un valor a una posición y elegir las marcas de
 * los ejes para que caigan en números redondos.
 */

/** Devuelve la función que pasa un valor del dominio [d0, d1] a una posición en [r0, r1]. */
export function escalaLineal(
  d0: number,
  d1: number,
  r0: number,
  r1: number,
): (v: number) => number {
  // Si el dominio no tiene ancho (todos los valores iguales), todo va al centro.
  if (d1 === d0) {
    return () => (r0 + r1) / 2;
  }
  return (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

/**
 * Marcas "bonitas" para un eje: unas `cuantas` marcas en múltiplos de 1, 2 o 5
 * (0, 0.2, 0.4... o 0, 25, 50...) que cubren de `min` a `max`.
 */
export function marcasBonitas(min: number, max: number, cuantas = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1];
  }
  if (min === max) {
    // Un solo valor: le damos un poco de margen a los lados.
    const margen = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    min -= margen;
    max += margen;
  }
  const bruto = (max - min) / Math.max(1, cuantas);
  const potencia = Math.pow(10, Math.floor(Math.log10(bruto)));
  const resto = bruto / potencia;
  const paso = (resto >= 5 ? 10 : resto >= 2 ? 5 : resto >= 1 ? 2 : 1) * potencia;
  const marcas: number[] = [];
  for (let v = Math.floor(min / paso) * paso; v <= max + paso * 1e-9; v += paso) {
    // El toFixed quita los decimales de más que deja la suma (0.30000000000000004).
    marcas.push(Number(v.toFixed(10)));
  }
  if (marcas[marcas.length - 1] < max) {
    marcas.push(Number((marcas[marcas.length - 1] + paso).toFixed(10)));
  }
  return marcas;
}

/** Mínimo y máximo de una lista con un bucle (Math.min(...lista) falla con listas muy largas). */
export function extremos(valores: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of valores) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** Número con coma decimal y separador de miles, como se escribe en español. */
export function numero(valor: number, decimales = 0): string {
  return valor.toLocaleString('es-ES', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/** 0.5 => "50 %". */
export function porcentaje(valor: number, decimales = 0): string {
  return `${numero(valor * 100, decimales)} %`;
}
