/**
 * Lectura del CSV con PapaParse (sin Angular).
 *
 * Usamos PapaParse porque la columna "names" contiene un JSON con comas
 * dentro de comillas; un simple split(',') rompería las filas.
 */
import * as Papa from 'papaparse';
import {
  COLUMNA_REGISTRO,
  columnasQueFaltan,
  extraerLectura,
  FilaPivotada,
  Lectura,
  ParametrosColumnas,
  TablaPivotada,
} from './pivotar';

/**
 * Lee el fichero CSV y devuelve solo las lecturas (timestamp, id, valor, tipo).
 *
 * El fichero se procesa por trozos ("chunk"): de cada fila nos quedamos con
 * las cuatro columnas de los parámetros y descartamos el resto en el momento,
 * incluidas las columnas de nombres (alias, description, nombre_interno, names).
 * Así no guardamos en memoria el JSON enorme de "names".
 *
 * Devuelve una Promise porque PapaParse lee el fichero de forma asíncrona y
 * nos va avisando con callbacks (chunk, complete, error). La envolvemos para
 * poder usar await desde fuera.
 */
export function leerLecturasCsv(fichero: File, p: ParametrosColumnas): Promise<Lectura[]> {
  return new Promise((resolve, reject) => {
    const lecturas: Lectura[] = [];
    // La cabecera solo hay que mirarla una vez, en el primer trozo.
    let cabeceraComprobada = false;
    // Si abortamos por falta de columnas, PapaParse llama igualmente a complete,
    // y no queremos resolver la promesa después de haberla rechazado.
    let abortado = false;

    Papa.parse<Record<string, string>>(fichero, {
      header: true, // la primera fila es la cabecera: cada fila llega como objeto
      skipEmptyLines: true, // las líneas en blanco (p. ej. la del final) se saltan
      transformHeader: (nombre) => nombre.trim(), // por si la cabecera trae espacios sueltos

      // Se llama una vez por cada trozo del fichero que va leyendo.
      chunk: (resultado, parser) => {
        // En el primer trozo comprobamos que existen las columnas pedidas.
        if (!cabeceraComprobada) {
          cabeceraComprobada = true;
          const faltan = columnasQueFaltan(resultado.meta.fields ?? [], p);
          if (faltan.length > 0) {
            abortado = true;
            parser.abort();
            // Ponemos en el mensaje las columnas que sí hay, para que el usuario
            // vea enseguida qué nombre tendría que haber escrito en el formulario.
            reject(
              new Error(
                `${fichero.name}: no existe la columna ${faltan.map((c) => `"${c}"`).join(', ')} en el CSV. ` +
                  `Columnas disponibles: ${(resultado.meta.fields ?? []).join(', ')}.`,
              ),
            );
            return;
          }
        }

        // De cada fila del trozo sacamos solo lo que nos interesa.
        // Si la fila no tiene timestamp o id, extraerLectura devuelve null y se descarta.
        for (const fila of resultado.data) {
          const lectura = extraerLectura(fila, p);
          if (lectura) {
            lecturas.push(lectura);
          }
        }
      },

      // Fin del fichero: devolvemos todo lo leído (salvo que hayamos abortado antes).
      complete: () => {
        if (!abortado) {
          resolve(lecturas);
        }
      },

      // Error de lectura del propio fichero.
      error: (err) => reject(err),
    });
  });
}

/**
 * Lee varios ficheros CSV (todos con el mismo formato largo) y junta
 * todas sus lecturas en una sola lista. Se leen uno detrás de otro para
 * no tener varios ficheros grandes en memoria a la vez.
 */
export async function leerVariosCsv(ficheros: File[], p: ParametrosColumnas): Promise<Lectura[]> {
  const todas: Lectura[] = [];
  for (const fichero of ficheros) {
    // El await dentro del for es a propósito: así no se leen en paralelo.
    const lecturas = await leerLecturasCsv(fichero, p);
    for (const lectura of lecturas) {
      todas.push(lectura); // push en bucle: con spread (...) muchos elementos podrían desbordar la pila
    }
  }
  return todas;
}

// ---------------------------------------------------------------------------
// CSV ya pivotado
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Celdas vacías
// ---------------------------------------------------------------------------

/** Un registro (fila de datos, desde 1) al que le faltan datos, y en qué columnas. */
export interface RegistroIncompleto {
  registro: number;
  /**
   * El timestamp de la fila, si sirve para encontrarla. Con el CSV largo el
   * número de registro es la fila de la tabla pivotada, no la del fichero.
   */
  momento?: string;
  columnas: string[];
}

/** Cuántos registros incompletos se nombran en el aviso, y cuántas columnas de cada uno. */
const REGISTROS_EN_AVISO = 10;
const COLUMNAS_EN_AVISO = 3;

/**
 * Los registros con alguna celda vacía. `filas` son las filas de datos (sin la
 * cabecera), ya recortadas y completadas hasta el número de columnas; `nombres`,
 * el nombre de cada columna. El registro 1 es la primera fila de datos.
 * Con `momentos` (el timestamp de cada fila), cada registro lleva el suyo.
 */
export function registrosIncompletos(
  filas: string[][],
  nombres: string[],
  momentos?: string[],
): RegistroIncompleto[] {
  const incompletos: RegistroIncompleto[] = [];
  filas.forEach((fila, i) => {
    const columnas = nombres.filter((_, c) => fila[c] === '');
    if (columnas.length > 0) {
      incompletos.push(
        momentos ? { registro: i + 1, momento: momentos[i], columnas } : { registro: i + 1, columnas },
      );
    }
  });
  return incompletos;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** "3 registros (5 celdas vacías)". */
export function resumenHuecos(incompletos: RegistroIncompleto[]): string {
  const celdas = incompletos.reduce((n, r) => n + r.columnas.length, 0);
  return (
    `${plural(incompletos.length, 'registro', 'registros')} ` +
    `(${plural(celdas, 'celda vacía', 'celdas vacías')})`
  );
}

/**
 * Una línea por cada uno de los primeros registros ("En el registro 42589
 * faltan datos (columna X)."), y al final cuántos quedan sin nombrar.
 */
export function lineasDeHuecos(incompletos: RegistroIncompleto[]): string[] {
  const lineas = incompletos.slice(0, REGISTROS_EN_AVISO).map(({ registro, momento, columnas }) => {
    const nombres = columnas.slice(0, COLUMNAS_EN_AVISO).map((c) => `"${c}"`).join(', ');
    const resto = columnas.length - COLUMNAS_EN_AVISO;
    const cuales =
      columnas.length === 1
        ? `columna ${nombres}`
        : `columnas ${nombres}${resto > 0 ? ` y ${resto} más` : ''}`;
    const cuando = momento ? ` (${momento})` : '';
    return `En el registro ${registro}${cuando} faltan datos (${cuales}).`;
  });
  const quedan = incompletos.length - REGISTROS_EN_AVISO;
  if (quedan > 0) {
    lineas.push(`… y ${plural(quedan, 'registro más', 'registros más')}.`);
  }
  return lineas;
}

/** Lo que se le dice al usuario: los nulos se tratan antes de pasar el CSV a la herramienta. */
export const CONSEJO_NULOS =
  'Isolation Forest no puede ejecutarse si faltan datos: trata los nulos antes de cargar el CSV.';

/**
 * Mensaje para cuando faltan datos en un CSV: el total y los primeros
 * registros, uno por línea.
 */
export function avisoDeHuecos(nombreFichero: string, incompletos: RegistroIncompleto[]): string {
  return [
    `${nombreFichero}: faltan datos en ${resumenHuecos(incompletos)}. ${CONSEJO_NULOS}`,
    ...lineasDeHuecos(incompletos),
  ].join('\n');
}

/**
 * Prepara las filas de datos de un CSV ya pivotado: recorta los espacios, quita
 * las filas vacías del final (Excel a veces deja ";;;" al exportar) y completa
 * con '' las filas cortas. Lanza un error si una fila tiene más celdas que la
 * cabecera o si falta algún dato, diciendo en qué registros.
 */
function filasCompletas(datos: string[][], nombres: string[], nombreFichero: string): string[][] {
  const filas = datos.map((fila) => fila.map((c) => c.trim()));
  while (filas.length > 0 && filas[filas.length - 1].every((c) => c === '')) {
    filas.pop();
  }
  filas.forEach((fila, i) => {
    if (fila.length > nombres.length) {
      throw new Error(`${nombreFichero}: el registro ${i + 1} tiene más columnas que la cabecera.`);
    }
    while (fila.length < nombres.length) {
      fila.push('');
    }
  });
  if (filas.length === 0) {
    throw new Error(`${nombreFichero}: el CSV no tiene filas con datos.`);
  }
  const incompletos = registrosIncompletos(filas, nombres);
  if (incompletos.length > 0) {
    throw new Error(avisoDeHuecos(nombreFichero, incompletos));
  }
  return filas;
}

// ---------------------------------------------------------------------------
// De filas a tabla
// ---------------------------------------------------------------------------

/**
 * Convierte las filas de un CSV ya pivotado (cabecera incluida) en una TablaPivotada.
 * La primera columna es el timestamp y el resto son las columnas de datos.
 *
 * - Las filas se quedan en el orden del fichero (se supone que ya van por tiempo).
 * - No puede faltar ningún dato, tampoco el timestamp: si hay celdas vacías o
 *   filas cortas, es un error que dice en qué registros (ver filasCompletas).
 *   Los nulos se tratan antes de cargar el CSV.
 * - Es un error que una fila tenga más celdas que la cabecera, que haya
 *   columnas o timestamps repetidos, o que no haya ninguna fila con datos.
 *
 * Con sinFecha, todas las columnas son datos y cada fila se identifica por su
 * número de registro (ver filasSinFecha).
 */
export function filasATablaPivotada(
  filas: string[][],
  nombreFichero: string,
  sinFecha = false,
): TablaPivotada {
  if (sinFecha) {
    return filasSinFecha(filas, nombreFichero);
  }
  const [cabecera, ...datos] = filas;
  const nombres = (cabecera ?? []).map((n) => n.trim());

  if (nombres.length < 2) {
    throw new Error(
      `${nombreFichero}: hace falta una columna de timestamp y al menos una columna de datos.`,
    );
  }
  const [columnaTimestamp, ...ids] = nombres;
  if (ids.some((id) => id === '')) {
    throw new Error(`${nombreFichero}: hay columnas sin nombre en la cabecera.`);
  }
  // Mismo truco que en validarParametros: el Set quita los repetidos.
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${nombreFichero}: hay columnas con el mismo nombre en la cabecera.`);
  }

  const timestampsVistos = new Set<string>();
  const filasTabla: FilaPivotada[] = filasCompletas(datos, nombres, nombreFichero).map(
    ([timestamp, ...valores], i) => {
      if (timestampsVistos.has(timestamp)) {
        throw new Error(
          `${nombreFichero}: el timestamp "${timestamp}" está repetido (registro ${i + 1}).`,
        );
      }
      timestampsVistos.add(timestamp);
      return { timestamp, valores };
    },
  );
  return { columnaTimestamp, ids, filas: filasTabla };
}

/**
 * CSV sin columna de fecha (como la pestaña 3 del Excel del tutor): todas las
 * columnas son datos y cada fila se identifica por su número de registro, que
 * empieza en 1 en la primera fila después de la cabecera. Ese número va en el
 * timestamp de la fila, y la columna se llama COLUMNA_REGISTRO.
 *
 * Como no hay timestamp, no se miran repetidos. Las líneas en blanco ya las
 * salta PapaParse y no cuentan como registro. Igual que con fecha, no puede
 * faltar ningún dato (ver filasCompletas).
 */
function filasSinFecha(filas: string[][], nombreFichero: string): TablaPivotada {
  const [cabecera, ...datos] = filas;
  const ids = (cabecera ?? []).map((n) => n.trim());

  if (ids.length === 0) {
    throw new Error(`${nombreFichero}: hace falta al menos una columna de datos.`);
  }
  if (ids.some((id) => id === '')) {
    throw new Error(`${nombreFichero}: hay columnas sin nombre en la cabecera.`);
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${nombreFichero}: hay columnas con el mismo nombre en la cabecera.`);
  }
  // Se chocaría con la columna del número de registro. Un CSV descargado de la
  // propia herramienta sin fecha empieza por esa columna: se carga con fecha.
  if (ids.includes(COLUMNA_REGISTRO)) {
    throw new Error(
      `${nombreFichero}: hay una columna llamada "${COLUMNA_REGISTRO}". Si es el número de ` +
        'registro, carga el CSV sin marcar «no tiene columna de fecha».',
    );
  }

  const filasTabla: FilaPivotada[] = filasCompletas(datos, ids, nombreFichero).map(
    (valores, i) => ({ timestamp: String(i + 1), valores }),
  );
  return { columnaTimestamp: COLUMNA_REGISTRO, ids, filas: filasTabla, sinFecha: true };
}

/**
 * Lee un CSV ya pivotado (por ejemplo un 2_fusionado.csv) para usarlo
 * directamente en el CIF (paso 4). El separador (';' o ',') lo detecta PapaParse.
 * Con sinFecha, el CSV no tiene columna de fecha (ver filasSinFecha).
 *
 * Aquí no se lee por trozos: un CSV pivotado no lleva la columna "names"
 * y ocupa mucho menos que el de formato largo.
 */
export function leerCsvPivotado(fichero: File, sinFecha = false): Promise<TablaPivotada> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(fichero, {
      // Sin header: así cada fila llega como array y respetamos el orden
      // de las columnas y podemos detectar nombres repetidos.
      header: false,
      skipEmptyLines: true,
      complete: (resultado) => {
        // Si el fichero tiene un formato raro, filasATablaPivotada lanza
        // un error, y lo pasamos a la promesa.
        try {
          resolve(filasATablaPivotada(resultado.data, fichero.name, sinFecha));
        } catch (e) {
          reject(e);
        }
      },
      error: (err) => reject(err),
    });
  });
}
