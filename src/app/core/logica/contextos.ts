/**
 * Contextos y particiones del artículo "Contextual Isolation Forests" (apartado 3.1.4).
 *
 * - Un contexto es un punto de vista para analizar las anomalías
 *   (por ejemplo "por tipo de medida" o "por zona").
 * - Dentro de un contexto, cada partición es un grupo de columnas de la tabla
 *   (por ejemplo "Presión" o "Z1"). Las particiones pueden compartir columnas
 *   y no hace falta que estén todas las columnas.
 *
 * La agrupación es por columnas, no por filas: cada partición tiene todas las
 * filas (timestamps) de la tabla pero solo algunas columnas.
 */
import type { ResumenTipo } from './fusionar';

export interface Particion {
  nombre: string;
  /** Nombres de columna de la tabla (tipo_id en la fusionada). */
  columnas: string[];
  /**
   * Relevancia de la partición entre 0 y 1 (W en el artículo). El artículo la
   * define pero no la usa en RI ni en II, así que aquí solo se guarda y se exporta.
   */
  peso: number;
}

export interface Contexto {
  nombre: string;
  particiones: Particion[];
}

/** Partición vacía con un nombre que no choque con las que ya hay en el contexto. */
export function nuevaParticion(contexto: Contexto): Particion {
  return {
    nombre: nombreLibre(
      'P',
      contexto.particiones.map((p) => p.nombre),
    ),
    columnas: [],
    peso: 1,
  };
}

/** Contexto con una partición vacía y un nombre que no choque con los que ya hay. */
export function nuevoContexto(contextos: Contexto[]): Contexto {
  const contexto: Contexto = {
    nombre: nombreLibre(
      'Contexto ',
      contextos.map((c) => c.nombre),
    ),
    particiones: [],
  };
  contexto.particiones.push(nuevaParticion(contexto));
  return contexto;
}

/** Primer "prefijo + número" (P1, P2...) que no está en la lista. */
function nombreLibre(prefijo: string, usados: string[]): string {
  let i = 1;
  while (usados.includes(`${prefijo}${i}`)) {
    i++;
  }
  return `${prefijo}${i}`;
}

/**
 * Contexto automático con una partición por cada tipo del paso 2.
 *
 * En la tabla fusionada las columnas van en bloques, un tipo detrás de otro
 * y en el mismo orden que `tipos` (ver alinear en fusionar.ts), así que basta
 * con ir cortando la lista de columnas. Es más seguro que mirar si el nombre
 * empieza por "tipo_", porque un tipo podría ser el principio de otro.
 *
 * Si no hay tipos (CSV ya pivotado), se agrupa por el texto que hay antes del
 * primer "_" del nombre de la columna, que es como salen los 2_fusionado.csv.
 */
export function contextoPorTipo(columnas: string[], tipos: ResumenTipo[]): Contexto {
  if (tipos.length > 0) {
    let inicio = 0;
    const particiones = tipos.map((t) => {
      const particion = {
        nombre: t.tipo,
        columnas: columnas.slice(inicio, inicio + t.columnas),
        peso: 1,
      };
      inicio += t.columnas;
      return particion;
    });
    return { nombre: 'Por tipo', particiones };
  }

  // Map para que las particiones salgan en el orden en que aparece cada prefijo.
  const porPrefijo = new Map<string, string[]>();
  for (const columna of columnas) {
    const guion = columna.indexOf('_');
    const prefijo = guion > 0 ? columna.slice(0, guion) : 'otros';
    let lista = porPrefijo.get(prefijo);
    if (!lista) {
      lista = [];
      porPrefijo.set(prefijo, lista);
    }
    lista.push(columna);
  }
  return {
    nombre: 'Por prefijo',
    particiones: [...porPrefijo].map(([nombre, cols]) => ({ nombre, columnas: cols, peso: 1 })),
  };
}

/**
 * Columnas cuyo nombre, o su etiqueta (el alias del sensor), contiene el texto
 * (sin distinguir mayúsculas). Texto vacío => todas.
 */
export function filtrarColumnas(
  columnas: string[],
  texto: string,
  etiquetas: Record<string, string> = {},
): string[] {
  const buscado = texto.trim().toLowerCase();
  if (buscado === '') {
    return columnas;
  }
  return columnas.filter(
    (c) =>
      c.toLowerCase().includes(buscado) || (etiquetas[c] ?? '').toLowerCase().includes(buscado),
  );
}

/** Columnas de la tabla que no están en ninguna partición del contexto. */
export function columnasSinUsar(columnas: string[], contexto: Contexto): string[] {
  const usadas = new Set(contexto.particiones.flatMap((p) => p.columnas));
  return columnas.filter((c) => !usadas.has(c));
}

/**
 * Comprueba los contextos antes de ejecutar el CIF.
 * Devuelve un mensaje de error, o null si están bien.
 */
export function validarContextos(contextos: Contexto[], columnasTabla: string[]): string | null {
  if (contextos.length === 0) {
    return 'Define al menos un contexto con una partición.';
  }
  const existentes = new Set(columnasTabla);
  const nombresContexto = new Set<string>();

  for (const contexto of contextos) {
    const nombre = contexto.nombre.trim();
    if (nombre === '') {
      return 'Hay un contexto sin nombre.';
    }
    if (nombresContexto.has(nombre)) {
      return `Hay dos contextos que se llaman "${nombre}".`;
    }
    nombresContexto.add(nombre);
    if (contexto.particiones.length === 0) {
      return `El contexto "${nombre}" no tiene particiones.`;
    }

    const nombresParticion = new Set<string>();
    for (const particion of contexto.particiones) {
      const nombreP = particion.nombre.trim();
      if (nombreP === '') {
        return `En el contexto "${nombre}" hay una partición sin nombre.`;
      }
      if (nombresParticion.has(nombreP)) {
        return `En el contexto "${nombre}" hay dos particiones que se llaman "${nombreP}".`;
      }
      nombresParticion.add(nombreP);
      if (particion.columnas.length === 0) {
        return `La partición "${nombre} / ${nombreP}" no tiene columnas.`;
      }
      // Puede pasar al cargar una configuración hecha con otro CSV.
      const falta = particion.columnas.find((c) => !existentes.has(c));
      if (falta !== undefined) {
        return `La partición "${nombre} / ${nombreP}" usa la columna "${falta}", que no está en la tabla.`;
      }
      // Igual que con el umbral: el !(...) también pilla null y NaN.
      if (typeof particion.peso !== 'number' || !(particion.peso >= 0 && particion.peso <= 1)) {
        return `El peso de "${nombre} / ${nombreP}" debe estar entre 0 y 1.`;
      }
    }
  }
  return null;
}
