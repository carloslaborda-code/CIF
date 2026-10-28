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
 *   4. Rellenar los huecos que quedan.
 *
 * Esta tabla fusionada es la que luego le pasamos al CIF (paso 4).
 */
import { compararTimestamps, FilaPivotada, Lectura, pivotar, TablaPivotada } from './pivotar';

/** Cómo rellenar las celdas vacías de la tabla fusionada. */
export type ModoRelleno = 'fijo' | 'anterior' | 'vacio';

/** Opciones para el desplegable del formulario. */
// "valor" es lo que se guarda internamente y "texto" lo que ve el usuario en el select.
export const OPCIONES_RELLENO: { valor: ModoRelleno; texto: string }[] = [
  { valor: 'fijo', texto: 'Valor fijo (0 a 1)' },
  { valor: 'anterior', texto: 'Valor anterior' },
  { valor: 'vacio', texto: 'Dejar vacío' },
];

/** Valor con el que se rellena en el modo 'fijo' si el usuario no pone otro. */
export const VALOR_RELLENO_POR_DEFECTO = 0;

/**
 * Comprueba el valor de relleno del modo 'fijo'.
 * Devuelve un mensaje de error, o null si está bien.
 */
export function validarRelleno(modo: ModoRelleno, valor: number): string | null {
  // En los otros modos el valor no se usa, así que da igual lo que tenga.
  if (modo !== 'fijo') {
    return null;
  }
  // Igual que con el umbral: si se borra el input, ngModel deja null.
  // El !(...) también pilla el NaN.
  if (typeof valor !== 'number' || !(valor >= 0 && valor <= 1)) {
    return 'El valor de relleno debe ser un número entre 0 y 1.';
  }
  return null;
}

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
  /** Celdas vacías después de alinear (antes de rellenar). */
  huecos: number;
  /** Celdas que se han rellenado según el modo elegido. */
  huecosRellenados: number;
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

/** Cuenta las celdas vacías de una tabla. */
// Lo usamos para enseñar en pantalla cuántos huecos había antes de rellenar.
export function contarHuecos(tabla: TablaPivotada): number {
  let huecos = 0;
  for (const fila of tabla.filas) {
    huecos += fila.valores.filter((v) => v === '').length;
  }
  return huecos;
}

/**
 * Rellena las celdas vacías según el modo y devuelve una tabla nueva
 * (no modifica la de entrada) junto con cuántas celdas se han rellenado.
 *
 * - 'fijo':     cada hueco pasa a ser `valor` (entre 0 y 1, ver validarRelleno).
 * - 'anterior': cada hueco toma el último valor conocido de su columna
 *               (las filas van ordenadas por timestamp). Si la columna empieza
 *               con huecos y no hay valor anterior, se pone "0".
 * - 'vacio':    no se toca nada.
 */
export function rellenarHuecos(
  tabla: TablaPivotada,
  modo: ModoRelleno,
  valor: number = VALOR_RELLENO_POR_DEFECTO,
): { tabla: TablaPivotada; rellenados: number } {
  if (modo === 'vacio') {
    return { tabla, rellenados: 0 };
  }

  // Las celdas de la tabla son texto, así que el valor fijo también.
  const textoFijo = String(valor);
  let rellenados = 0;
  // Último valor visto en cada columna (para el modo 'anterior').
  // Empieza en '0' para cubrir el caso de que la columna arranque con huecos.
  const ultimos: string[] = tabla.ids.map(() => '0');

  // Vamos fila a fila de arriba abajo, que es el orden temporal.
  const filas = tabla.filas.map((fila) => {
    const valores = fila.valores.map((celda, c) => {
      if (celda !== '') {
        // Celda con dato: la dejamos y nos apuntamos el valor para los huecos que vengan.
        ultimos[c] = celda;
        return celda;
      }
      rellenados++;
      return modo === 'fijo' ? textoFijo : ultimos[c];
    });
    return { timestamp: fila.timestamp, valores };
  });

  return { tabla: { ...tabla, filas }, rellenados };
}

/**
 * Proceso completo: divide por tipo, pivota cada tipo, alinea y rellena huecos.
 * Es la única función de este fichero que llama la página principal.
 */
export function fusionar(
  lecturas: Lectura[],
  columnaTimestamp: string,
  modo: ModoRelleno,
  valorRelleno: number = VALOR_RELLENO_POR_DEFECTO,
): TablaFusionada {
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
  const alineada = alinear(tablas, columnaTimestamp);
  // Contamos los huecos antes de rellenar, si no siempre saldría 0
  const huecos = contarHuecos(alineada);
  // 4. Rellenar
  const { tabla, rellenados } = rellenarHuecos(alineada, modo, valorRelleno);

  return { ...tabla, tipos, huecos, huecosRellenados: rellenados };
}

/**
 * Para un CSV que ya viene pivotado: no hay que dividir ni alinear,
 * solo rellenar sus huecos. Se devuelve como TablaFusionada (sin tipos)
 * para que el resto de la página (vista previa, descarga, CIF) lo trate igual.
 */
export function prepararTablaPivotada(
  tablaCargada: TablaPivotada,
  modo: ModoRelleno,
  valorRelleno: number = VALOR_RELLENO_POR_DEFECTO,
): TablaFusionada {
  const huecos = contarHuecos(tablaCargada);
  const { tabla, rellenados } = rellenarHuecos(tablaCargada, modo, valorRelleno);
  return { ...tabla, tipos: [], huecos, huecosRellenados: rellenados };
}
