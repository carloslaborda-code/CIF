/**
 * Lógica de fusión.
 *
 * Cuando hay datos de varios tipos (electricidad, agua...), cada tipo
 * se pivota por separado y después se juntan todos en una sola tabla:
 *
 *   1. Dividir las lecturas por tipo.
 *   2. Pivotar cada tipo (con la función del paso 1) y renombrar sus columnas
 *      como tipo_id, para que no se mezclen ids iguales de tipos distintos.
 *   3. Alinear: una fila por cada timestamp de cualquier tipo, y todas las columnas.
 *   4. Comprobar que no falta ningún dato.
 *   5. Procesado de características y codificación (preparar.ts).
 *
 * El paso 5 son las fases 3.1.1 y 3.1.2 del artículo. La fase de nulos (3.1.3) no
 * la hace la herramienta: como dijo el tutor, los nulos se tratan antes de pasarle
 * el CSV, y si faltan datos Isolation Forest no puede ejecutarse. Por eso, si al
 * alinear queda algún hueco (un momento en el que un sensor no tiene lectura), se
 * avisa de en qué registros y no se sigue.
 *
 * Esta tabla fusionada es la que luego le pasamos al CIF (paso 4).
 */
import {
  CONSEJO_NULOS,
  lineasDeHuecos,
  registrosIncompletos,
  resumenHuecos,
} from './leer-csv';
import {
  compararIds,
  compararTimestamps,
  FilaPivotada,
  Lectura,
  pivotar,
  TablaPivotada,
} from './pivotar';
import { Diccionario, Preparacion, prepararCaracteristicas, SIN_PREPARACION } from './preparar';
import { aplicarRango, RangoRegistros, SIN_RANGO } from './rango';

/** Nombre que se usa cuando una fila no tiene tipo. */
export const TIPO_DESCONOCIDO = 'sin_tipo';

/** Resumen de un tipo dentro de la fusión. */
// Es lo que sale en la tablita de "Tipo / Columnas / Timestamps" de la pantalla.
export interface ResumenTipo {
  tipo: string;
  /** Número de columnas (ids) de este tipo. */
  columnas: number;
  /** Número de timestamps distintos de este tipo. */
  filas: number;
}

/**
 * Resultado de la fusión. Tiene la misma forma que una TablaPivotada,
 * pero aquí `ids` son los nombres de columna tipo_id.
 * Como extiende TablaPivotada, se puede pasar tal cual a tablaACsv o a la vista previa.
 */
export interface TablaFusionada extends TablaPivotada {
  tipos: ResumenTipo[];
  /** Características que ha añadido el procesado (3.1.1). */
  columnasNuevas: string[];
  /** Características cualitativas que se han codificado (3.1.2). */
  columnasCodificadas: string[];
  /** Diccionario de la codificación: el de entrada más los valores nuevos. */
  diccionario: Diccionario;
  /** Cuántos valores nuevos se han añadido al diccionario. */
  valoresNuevos: number;
}

/** Los registros con huecos de una tabla, con su momento para poder encontrarlos. */
function incompletosDe(tabla: TablaPivotada) {
  return registrosIncompletos(
    tabla.filas.map((f) => f.valores),
    tabla.ids,
    // Sin fecha, el momento es el propio número de registro: no aporta nada.
    tabla.sinFecha ? undefined : tabla.filas.map((f) => f.timestamp),
    tabla.primerRegistro ?? 1,
  );
}

/**
 * Lanza un error si a la tabla alineada le falta algún dato, diciendo en qué
 * registros (y en qué momento, porque con el CSV largo el registro es la fila
 * de la tabla, no la del fichero).
 */
export function comprobarSinHuecos(alineada: TablaPivotada): void {
  const incompletos = incompletosDe(alineada);
  if (incompletos.length > 0) {
    throw new Error(
      [
        `Faltan datos en ${resumenHuecos(incompletos)}: hay momentos en los que algún sensor ` +
          `no tiene lectura. ${CONSEJO_NULOS} También puedes quedarte con una época sin ` +
          'huecos con el rango de registros.',
        ...lineasDeHuecos(incompletos),
      ].join('\n'),
    );
  }
}

/**
 * Comprobación, procesado y codificación, en el orden de la Fig. 1 del artículo.
 * Lo comparten el CSV largo (después de alinear) y el ya pivotado.
 *
 * El procesado también puede dejar celdas vacías (por ejemplo, sacar el día de
 * una columna que no es una fecha, o añadir una columna con valor vacío). Como
 * el IF tampoco puede con ellas, es un error que apunta a las operaciones.
 */
function comprobarYPreparar(
  alineada: TablaPivotada,
  preparacion: Preparacion,
): Omit<TablaFusionada, 'tipos'> {
  comprobarSinHuecos(alineada);
  const p = prepararCaracteristicas(alineada, preparacion);
  const incompletos = incompletosDe(p.tabla);
  if (incompletos.length > 0) {
    throw new Error(
      [
        `El procesado de características ha dejado celdas vacías en ` +
          `${resumenHuecos(incompletos)}. Revisa las operaciones.`,
        ...lineasDeHuecos(incompletos),
      ].join('\n'),
    );
  }
  return {
    ...p.tabla,
    columnasNuevas: p.columnasNuevas,
    columnasCodificadas: p.columnasCodificadas,
    diccionario: p.diccionario,
    valoresNuevos: p.valoresNuevos,
  };
}

/** Divide las lecturas por tipo. Los tipos salen ordenados alfabéticamente. */
export function dividirPorTipo(lecturas: Lectura[]): Map<string, Lectura[]> {
  const porTipo = new Map<string, Lectura[]>();

  for (const lectura of lecturas) {
    // Si la fila venía sin tipo la metemos en "sin_tipo" en vez de perderla.
    const tipo = lectura.tipo || TIPO_DESCONOCIDO;
    let lista = porTipo.get(tipo);
    if (!lista) {
      lista = [];
      porTipo.set(tipo, lista);
    }
    lista.push(lectura);
  }

  // Un Map recuerda el orden en que se insertan las claves, así que creamos
  // uno nuevo con los tipos ya ordenados. Así las columnas salen siempre en el
  // mismo orden aunque los CSV vengan mezclados.
  const tiposOrdenados = [...porTipo.keys()].sort((a, b) => a.localeCompare(b));
  return new Map(tiposOrdenados.map((tipo) => [tipo, porTipo.get(tipo)!]));
}

/** Nombre de columna de un id dentro de su tipo: "electricityfacility_6339567". */
export function nombreColumna(tipo: string, id: string): string {
  return `${tipo}_${id}`;
}

/** Pivota un tipo con la función del paso 1 y renombra sus columnas como tipo_id. */
export function pivotarTipo(
  tipo: string,
  lecturas: Lectura[],
  columnaTimestamp: string,
): TablaPivotada {
  const tabla = pivotar(lecturas, columnaTimestamp);
  // Solo cambian los nombres de las columnas, las filas se quedan igual.
  return { ...tabla, ids: tabla.ids.map((id) => nombreColumna(tipo, id)) };
}

/**
 * Alinea varias tablas pivotadas por timestamp.
 * La tabla final tiene todos los timestamps (ordenados) y todas las columnas,
 * en el mismo orden que las tablas de entrada. Si una tabla no tiene un
 * timestamp, sus columnas quedan vacías ('') en esa fila.
 *
 * Hace falta porque cada tipo puede medir en momentos distintos (por ejemplo
 * la electricidad cada 15 min y el agua cada hora).
 */
export function alinear(tablas: TablaPivotada[], columnaTimestamp: string): TablaPivotada {
  // Todos los timestamps de todas las tablas, sin repetir y ordenados.
  const todosLosTimestamps = new Set<string>();
  for (const tabla of tablas) {
    for (const fila of tabla.filas) {
      todosLosTimestamps.add(fila.timestamp);
    }
  }
  const timestamps = [...todosLosTimestamps].sort(compararTimestamps);

  // Para cada tabla, un índice timestamp -> valores, para buscar rápido.
  const indices = tablas.map(
    (tabla) => new Map(tabla.filas.map((fila) => [fila.timestamp, fila.valores])),
  );

  // Cada fila final se forma pegando, una detrás de otra, las columnas de cada tabla.
  const filas: FilaPivotada[] = timestamps.map((timestamp) => {
    const valores: string[] = [];
    tablas.forEach((tabla, i) => {
      const valoresDeLaTabla = indices[i].get(timestamp);
      // Si esta tabla no tiene ese timestamp, metemos tantos '' como columnas tenga,
      // para que el resto de valores no se descoloquen.
      for (let c = 0; c < tabla.ids.length; c++) {
        valores.push(valoresDeLaTabla ? valoresDeLaTabla[c] : '');
      }
    });
    return { timestamp, valores };
  });

  return {
    columnaTimestamp,
    // Las columnas en el mismo orden en que hemos ido pegando los valores.
    ids: tablas.flatMap((tabla) => tabla.ids),
    filas,
  };
}

/**
 * Proceso completo: divide por tipo, pivota cada tipo, alinea, se queda con el
 * rango de registros, comprueba que no falta ningún dato y procesa y codifica
 * las características. Lanza un error si faltan datos dentro del rango (ver
 * comprobarSinHuecos) o si el rango no cabe en la tabla.
 */
export function fusionar(
  lecturas: Lectura[],
  columnaTimestamp: string,
  preparacion: Preparacion = SIN_PREPARACION,
  rango: RangoRegistros = SIN_RANGO,
): TablaFusionada {
  const { tabla, tipos } = alinearPorTipo(lecturas, columnaTimestamp);
  // 4 y 5. Rango, comprobar, procesar y codificar
  return { ...comprobarYPreparar(aplicarRango(tabla, rango), preparacion), tipos };
}

/** Pasos 1 a 3: divide por tipo, pivota cada uno y los alinea. Puede dejar huecos. */
function alinearPorTipo(
  lecturas: Lectura[],
  columnaTimestamp: string,
): { tabla: TablaPivotada; tipos: ResumenTipo[] } {
  // 1. Separar por tipo
  const porTipo = dividirPorTipo(lecturas);

  // 2. Pivotar cada tipo y de paso ir guardando su resumen para la pantalla
  const tipos: ResumenTipo[] = [];
  const tablas: TablaPivotada[] = [];
  for (const [tipo, lecturasDelTipo] of porTipo) {
    const tabla = pivotarTipo(tipo, lecturasDelTipo, columnaTimestamp);
    tablas.push(tabla);
    tipos.push({ tipo, columnas: tabla.ids.length, filas: tabla.filas.length });
  }

  // 3. Alinear todas en una sola tabla
  return { tabla: alinear(tablas, columnaTimestamp), tipos };
}

/**
 * Para un CSV que ya viene pivotado: no hay que dividir ni alinear, solo
 * quedarse con el rango de registros, procesar y codificar. Al leerlo ya se ha
 * comprobado que no le faltan datos, pero se vuelve a mirar por si la tabla
 * llega de otro sitio. Se devuelve como TablaFusionada (sin tipos) para que el
 * resto de la página (vista previa, descarga, CIF) lo trate igual.
 */
export function prepararTablaPivotada(
  tablaCargada: TablaPivotada,
  preparacion: Preparacion = SIN_PREPARACION,
  rango: RangoRegistros = SIN_RANGO,
): TablaFusionada {
  return { ...comprobarYPreparar(aplicarRango(tablaCargada, rango), preparacion), tipos: [] };
}

/**
 * El dataset en columnas para guardarlo y cargarlo otra vez como "tabla ya hecha":
 * separado por tipo y alineado (columnas tipo_id), pero sin procesado ni
 * codificación. Al cargarlo, el paso 2 hace lo mismo que con el CSV largo.
 * Si le faltan datos, se devuelve con los huecos vacíos: quien lo guarda tiene
 * que comprobarlo, porque una tabla con huecos no se puede volver a cargar.
 * Con un rango de registros, solo esas filas (en el fichero guardado, la
 * primera vuelve a ser el registro 1).
 *
 * No sirve 2_fusionado.csv, porque ya está preparado (se añadiría DD otra vez), ni
 * 1_pivotado.csv, porque no lleva el tipo en el nombre de las columnas.
 */
export function datasetEnColumnas(
  lecturas: Lectura[],
  columnaTimestamp: string,
  rango: RangoRegistros = SIN_RANGO,
): TablaPivotada {
  const { ids, filas, primerRegistro } = aplicarRango(
    alinearPorTipo(lecturas, columnaTimestamp).tabla,
    rango,
  );
  return { columnaTimestamp, ids, filas, primerRegistro };
}

/**
 * Cuántos registros tiene la tabla alineada del CSV largo antes del rango: uno
 * por cada momento distinto (alinear junta los de todos los tipos). Sirve para
 * decir hasta dónde llega el rango aunque la tabla haya dado error.
 */
export function registrosAlineados(lecturas: Lectura[]): number {
  return new Set(lecturas.map((l) => l.timestamp)).size;
}

/**
 * Columnas que tendrá la tabla fusionada antes del procesado de características
 * (tipo_id, en el mismo orden que fusionar). Sirve para elegir columnas en las
 * operaciones aunque la última preparación haya dado error.
 */
export function columnasFusionadas(lecturas: Lectura[]): string[] {
  return [...dividirPorTipo(lecturas)].flatMap(([tipo, lista]) =>
    [...new Set(lista.map((l) => l.id))].sort(compararIds).map((id) => nombreColumna(tipo, id)),
  );
}
