/**
 * Lectura del CSV con PapaParse (sin Angular).
 *
 * Usamos PapaParse porque la columna "names" contiene un JSON con comas
 * dentro de comillas; un simple split(',') rompería las filas.
 */
import * as Papa from 'papaparse';
import {
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

/**
 * Convierte las filas de un CSV ya pivotado (cabecera incluida) en una TablaPivotada.
 * La primera columna es el timestamp y el resto son las columnas de datos.
 *
 * - Las filas se quedan en el orden del fichero (se supone que ya van por tiempo).
 * - Las filas sin timestamp se descartan, como en el formato largo.
 * - Si a una fila le faltan celdas al final, se completan con '' (huecos).
 * - Es un error que una fila tenga más celdas que la cabecera, que haya
 *   columnas o timestamps repetidos, o que no haya ninguna fila con datos.
 */
export function filasATablaPivotada(filas: string[][], nombreFichero: string): TablaPivotada {
  const [cabecera, ...datos] = filas;
  const nombres = (cabecera ?? []).map((n) => n.trim());

  if (nombres.length < 2) {
    throw new Error(`${nombreFichero}: hace falta una columna de timestamp y al menos una columna de datos.`);
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
  const filasTabla: FilaPivotada[] = [];
  for (let i = 0; i < datos.length; i++) {
    const celdas = datos[i].map((c) => c.trim());
    // +2 porque i empieza en 0 y la línea 1 es la cabecera.
    const linea = i + 2;
    if (celdas.length > nombres.length) {
      throw new Error(`${nombreFichero}: la línea ${linea} tiene más columnas que la cabecera.`);
    }
    const [timestamp, ...valores] = celdas;
    if (!timestamp) {
      continue;
    }
    if (timestampsVistos.has(timestamp)) {
      throw new Error(`${nombreFichero}: el timestamp "${timestamp}" está repetido (línea ${linea}).`);
    }
    timestampsVistos.add(timestamp);
    // Completamos con huecos si la fila se queda corta.
    while (valores.length < ids.length) {
      valores.push('');
    }
    filasTabla.push({ timestamp, valores });
  }

  if (filasTabla.length === 0) {
    throw new Error(`${nombreFichero}: el CSV no tiene filas con datos.`);
  }
  return { columnaTimestamp, ids, filas: filasTabla };
}

/**
 * Lee un CSV ya pivotado (por ejemplo un 2_fusionado.csv) para usarlo
 * directamente en el paso 3. El separador (';' o ',') lo detecta PapaParse.
 *
 * Aquí no se lee por trozos: un CSV pivotado no lleva la columna "names"
 * y ocupa mucho menos que el de formato largo.
 */
export function leerCsvPivotado(fichero: File): Promise<TablaPivotada> {
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
          resolve(filasATablaPivotada(resultado.data, fichero.name));
        } catch (e) {
          reject(e);
        }
      },
      error: (err) => reject(err),
    });
  });
}
