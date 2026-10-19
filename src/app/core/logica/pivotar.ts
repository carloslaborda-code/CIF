/**
 * Lógica de pivotado+.
 *
 * El CSV de entrada viene en formato "largo": una fila por cada medida
 * (timestamp, id del sensor, valor). Aquí lo pasamos a formato "ancho":
 * una fila por timestamp y una columna por cada id.
 *
 *   Entrada (largo)              Salida (ancho)
 *   timestamp, uid, value        timestamp, id1, id2
 *   1, id1, 1                    1,         1,   3
 *   1, id2, 3                    2,         2,   (vacío)
 *   2, id1, 2
 *
 * Este fichero también tiene los tipos que usan los demás (Lectura,
 * TablaPivotada...), por eso fusionar.ts y leer-csv.ts importan de aquí.
 */
import * as Papa from 'papaparse';

/** Nombres de las columnas del CSV que usamos (editables en el formulario). */
export interface ParametrosColumnas {
  timestamp: string;
  id: string;
  valor: string;
  /** Tipo de dato (electricidad, agua...). Se usa al fusionar (fusionar.ts). */
  tipo: string;
}

/** Valores por defecto del formulario. */
export const PARAMETROS_POR_DEFECTO: ParametrosColumnas = {
  timestamp: 'timestamp',
  id: 'uid',
  valor: 'value',
  tipo: 'name',
};

/**
 * Columnas de nombres que no nos interesan. "names" en concreto lleva un JSON
 * enorme en cada fila, así que no se guardan en memoria (ver leer-csv.ts).
 */
export const COLUMNAS_IGNORADAS = ['alias', 'description', 'nombre_interno', 'names'];

/** Una medida suelta, tal y como viene en una fila del CSV de entrada. */
export interface Lectura {
  timestamp: string;
  id: string;
  // El valor lo dejamos como texto. Hasta el paso 3 no hace falta que sea número,
  // y así el CSV que descargamos sale igual que venía.
  valor: string;
  tipo: string;
}

/** Una fila del resultado: un timestamp y un valor por cada id ('' si falta). */
export interface FilaPivotada {
  timestamp: string;
  valores: string[];
}

/** Resultado del pivotado. */
export interface TablaPivotada {
  /** Nombre de la primera columna (la del timestamp). */
  columnaTimestamp: string;
  /** Ids en el orden en que aparecen como columnas. */
  ids: string[];
  /** Filas ordenadas por timestamp. `valores[i]` corresponde a `ids[i]`. */
  filas: FilaPivotada[];
}

/**
 * Comprueba que los parámetros tienen sentido.
 * Devuelve un mensaje de error, o null si todo está bien.
 */
export function validarParametros(p: ParametrosColumnas): string | null {
  const nombres = nombresDeColumnas(p).map((n) => n.trim());

  // Ningún campo del formulario puede quedarse en blanco.
  if (nombres.some((n) => n === '')) {
    return 'Rellena todos los nombres de columna.';
  }
  // Si dos campos apuntan a la misma columna, algo está mal puesto.
  // El Set quita repetidos, así que si mide menos que la lista es que había alguno.
  if (new Set(nombres).size !== nombres.length) {
    return 'Las columnas deben ser distintas.';
  }
  // Tampoco dejamos usar las columnas de nombres, porque esas no se leen.
  const ignorada = nombres.find((n) => COLUMNAS_IGNORADAS.includes(n));
  if (ignorada) {
    return `La columna "${ignorada}" es de nombres y se ignora; elige otra.`;
  }
  return null;
}

/** Lista con los nombres de todas las columnas de los parámetros. */
export function nombresDeColumnas(p: ParametrosColumnas): string[] {
  return [p.timestamp, p.id, p.valor, p.tipo];
}

/** Devuelve las columnas de los parámetros que no están en la cabecera del CSV. */
export function columnasQueFaltan(cabecera: string[], p: ParametrosColumnas): string[] {
  return nombresDeColumnas(p).filter((c) => !cabecera.includes(c));
}

/**
 * Extrae de una fila del CSV (ya convertida a objeto por PapaParse) solo lo
 * que necesitamos. Devuelve null si la fila no tiene timestamp o id.
 */
export function extraerLectura(
  fila: Record<string, string | undefined>,
  p: ParametrosColumnas,
): Lectura | null {
  // El ?? '' es por si en alguna fila falta la celda (PapaParse la deja undefined).
  const timestamp = (fila[p.timestamp] ?? '').trim();
  const id = (fila[p.id] ?? '').trim();
  const valor = (fila[p.valor] ?? '').trim();
  const tipo = (fila[p.tipo] ?? '').trim();

  // Sin timestamp no sabemos en qué fila ponerla y sin id no sabemos en qué columna.
  // El valor vacío sí se acepta: simplemente quedará un hueco en la tabla.
  if (timestamp === '' || id === '') {
    return null;
  }
  return { timestamp, id, valor, tipo };
}

/**
 * Ordena timestamps: numéricamente si son números (1, 2, 10),
 * por fecha si son fechas, y si no, como texto.
 */
export function compararTimestamps(a: string, b: string): number {
  // Primero probamos como números. Si ordenáramos "10" y "2" como texto,
  // el "10" saldría antes.
  const numA = Number(a);
  const numB = Number(b);
  if (!isNaN(numA) && !isNaN(numB)) {
    return numA - numB;
  }

  // Luego como fechas (por ejemplo 2026-10-01T00:15:00.000Z).
  const fechaA = Date.parse(a);
  const fechaB = Date.parse(b);
  if (!isNaN(fechaA) && !isNaN(fechaB)) {
    return fechaA - fechaB;
  }

  // Si no es ninguna de las dos cosas, orden alfabético normal.
  return a.localeCompare(b);
}

/** Ordena ids de forma "natural": "id2" va antes que "id10". */
export function compararIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Pivota las lecturas: una fila por timestamp (ordenadas) y una columna por id.
 * Si un id no tiene valor en un timestamp, la celda queda vacía ('').
 * Si hay dos lecturas para el mismo (timestamp, id), se queda la última.
 */
export function pivotar(lecturas: Lectura[], columnaTimestamp: string): TablaPivotada {
  // timestamp -> (id -> valor)
  // Usamos Map en vez de ir buscando en arrays porque con ~51.000 lecturas
  // buscar cada vez con find() sería muy lento.
  const porTimestamp = new Map<string, Map<string, string>>();
  const idsVistos = new Set<string>();

  // Una sola pasada por todas las lecturas para ir colocando cada valor.
  for (const { timestamp, id, valor } of lecturas) {
    let valoresDelTimestamp = porTimestamp.get(timestamp);
    if (!valoresDelTimestamp) {
      // Primera vez que vemos este timestamp: le creamos su mapa vacío.
      valoresDelTimestamp = new Map();
      porTimestamp.set(timestamp, valoresDelTimestamp);
    }
    // Si ya había valor para este id, se pisa (por eso gana la última lectura).
    valoresDelTimestamp.set(id, valor);
    idsVistos.add(id);
  }

  // Las columnas (ids) y las filas (timestamps), cada una ordenada a su manera.
  const ids = [...idsVistos].sort(compararIds);
  const timestamps = [...porTimestamp.keys()].sort(compararTimestamps);

  // Construimos cada fila recorriendo los ids siempre en el mismo orden,
  // así la posición i de valores siempre es la columna ids[i].
  const filas = timestamps.map((timestamp) => {
    const valoresDelTimestamp = porTimestamp.get(timestamp)!; // seguro que existe, sale de las claves del propio Map
    return {
      timestamp,
      valores: ids.map((id) => valoresDelTimestamp.get(id) ?? ''),
    };
  });

  return { columnaTimestamp, ids, filas };
}

/**
 * Pasa una fecha ISO (2026-10-01T00:15:00.000Z) al formato del visualizador
 * de Emilia Rouanet (01/10/2026 00:15:00). Se copian el día y la hora tal
 * cual vienen escritos, sin cambiar de zona horaria. Si el timestamp no es
 * una fecha ISO, se devuelve sin cambios.
 */
export function fechaFormatoEmilia(timestamp: string): string {
  // Captura año, mes, día, hora, minuto y, si están, los segundos.
  // Acepta la T o un espacio entre fecha y hora.
  // No usamos new Date() a propósito: pasaría la hora a la zona local y la cambiaría.
  const partes = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(timestamp);
  if (!partes) {
    return timestamp;
  }
  // El primer elemento es el texto entero que ha encajado, no lo necesitamos.
  const [, anio, mes, dia, hora, minuto, segundo = '00'] = partes;
  return `${dia}/${mes}/${anio} ${hora}:${minuto}:${segundo}`;
}

/**
 * Convierte la tabla pivotada a texto CSV (con cabecera) en el formato del
 * visualizador de Emilia Rouanet: separador ';' y fecha DD/MM/YYYY HH:MM:SS.
 */
export function tablaACsv(tabla: TablaPivotada): string {
  // Papa.unparse se encarga de poner comillas donde haga falta.
  return Papa.unparse(
    {
      fields: [tabla.columnaTimestamp, ...tabla.ids], // cabecera: timestamp + un id por columna
      data: tabla.filas.map((f) => [fechaFormatoEmilia(f.timestamp), ...f.valores]),
    },
    { delimiter: ';' },
  );
}
