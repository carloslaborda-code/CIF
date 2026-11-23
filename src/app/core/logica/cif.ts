/**
 * Contextual Isolation Forest (explicabilidad por contexto del artículo).
 *
 *   1. IF sobre la tabla completa: score global de cada fila (AD = las que pasan el umbral).
 *   2. IF por separado sobre cada partición de cada contexto (solo sus columnas).
 *   3. Para cada fila, con los scores de las particiones:
 *        - valor en la partición = su score si pasa el umbral; si no, en blanco (null).
 *          Un score nunca vale 0 (ni 1): poner 0 donde no es anomalía confundía.
 *        - RI = particiones donde es anomalía / total de particiones          (Ec. 1)
 *        - II = media de los scores de las particiones donde es anomalía (se divide
 *          entre esas particiones, no entre el total). Si no es anomalía en ninguna
 *          partición, en blanco (null). Nunca vale 0.
 *      RI e II se calculan para todos los registros, sean o no anomalía global: un
 *      registro que no lo es puede serlo en alguna partición.
 *
 * Ejemplo del tutor (score global 0,65, umbral 0,70, 10 particiones):
 *   anomalía en 3 particiones, con 0,72, 0,75 y 0,91
 *   => RI = 3/10 = 0,30 · II = (0,72 + 0,75 + 0,91) / 3 = 0,79
 *
 * Todo sale de una única semilla: el IF global usa la semilla y la partición
 * k-ésima usa semilla + k (ver derivarSemilla).
 */
import * as Papa from 'papaparse';

import {
  elegirSemilla,
  ParametrosIsolationForest,
  puntuarConSemilla,
  tablaAPuntos,
} from './aplicar-isolation-forest';
import type { Contexto } from './contextos';
import { CortesCif, esAnomaliaCif } from './cortes';
import type { TablaPivotada } from './pivotar';
import { derivarSemilla } from './semilla';

/** Resumen de una partición después de ejecutar su IF. */
export interface ResultadoParticion {
  contexto: string;
  particion: string;
  peso: number;
  /** Columnas de la partición (incluidas las constantes). */
  numColumnas: number;
  /** Columnas constantes de la partición que no se le han pasado al bosque. */
  ignoradas: string[];
  semilla: number;
  numAnomalias: number;
  /** Score medio de las anomalías de la partición (las que pasan el umbral). null si no hay. */
  scoreMedio: number | null;
  scoreMaximo: number;
}

/** Una fila de la tabla CIF. */
export interface FilaCif {
  /** Número de fila en la tabla analizada (empieza en 1), como el ID de la Tabla 5. */
  id: number;
  /**
   * Número de registro: la fila de datos del CSV, desde 1. Con un rango de
   * registros conserva la numeración original (no empieza en 1). Es lo que se
   * enseña: el tutor identifica cada registro por este número.
   */
  registro: number;
  /** Fecha de la fila; sin columna de fecha, el número de registro como texto. */
  timestamp: string;
  /** Score del IF global. */
  score: number;
  anomalia: boolean;
  ri: number;
  /** null si no es anomalía en ninguna partición. */
  ii: number | null;
  /** Valor en cada partición (su score si pasa el umbral; si no, null), en el orden de `particiones`. */
  valores: (number | null)[];
  /** Score de cada partición sin aplicar el umbral (para calcular los valores). */
  brutos: number[];
}

export interface ResultadoCif {
  /** Semilla principal con la que se ha ejecutado todo. */
  semilla: number;
  numArboles: number;
  umbral: number;
  /** Filas que entran en la muestra de cada árbol (puede ser menor que el pedido). */
  tamanoMuestra: number;
  /** Si se han quitado las columnas constantes antes de cada bosque. */
  quitarConstantes: boolean;
  /** Columnas de la tabla que valen lo mismo en todas las filas (se quiten o no). */
  columnasConstantes: string[];
  /** Copia de los contextos usados, para que no cambie si luego se editan. */
  contextos: Contexto[];
  /** Una por partición, en orden: contexto 1 (sus particiones), contexto 2... */
  particiones: ResultadoParticion[];
  /** Una por fila de la tabla, en el mismo orden que la tabla. */
  filas: FilaCif[];
  /** true si la tabla no tenía fecha (el timestamp es el número de registro). */
  sinFecha: boolean;
  numAnomalias: number;
  celdasNoNumericas: number;
}

/** Una fila es anomalía si su score es mayor (estrictamente) que el umbral, como en el artículo. */
export function esAnomalia(score: number, umbral: number): boolean {
  return score > umbral;
}

/** Valor de una fila en una partición: su score si es anomalía; si no, null (en blanco). */
export function valorEnParticion(score: number, umbral: number): number | null {
  return esAnomalia(score, umbral) ? score : null;
}

/**
 * RI e II de una fila a partir de sus valores en todas las particiones (ya con
 * el umbral aplicado: null donde no es anomalía).
 *   RI = particiones donde es anomalía / total de particiones   (Ec. 1)
 *   II = media de los scores de las particiones donde es anomalía; null si no
 *        hay ninguna.
 */
export function indicadores(valores: (number | null)[]): { ri: number; ii: number | null } {
  const enAnomalia = valores.filter((v): v is number => v !== null);
  return {
    ri: valores.length === 0 ? 0 : enAnomalia.length / valores.length,
    ii:
      enAnomalia.length > 0
        ? enAnomalia.reduce((suma, v) => suma + v, 0) / enAnomalia.length
        : null,
  };
}

/** Posiciones de las columnas que valen lo mismo en todas las filas. */
export function columnasConstantes(puntos: number[][]): Set<number> {
  const constantes = new Set<number>();
  if (puntos.length === 0) {
    return constantes;
  }
  for (let c = 0; c < puntos[0].length; c++) {
    const primero = puntos[0][c];
    if (puntos.every((p) => p[c] === primero)) {
      constantes.add(c);
    }
  }
  return constantes;
}

/**
 * Columnas (posiciones) que se le pasan al bosque: todas, o todas menos las
 * constantes si se ha elegido quitarlas. Si al quitarlas no quedara ninguna,
 * se dejan todas: no hay nada que distinguir y el bosque da 0.5 a todas las filas.
 */
export function columnasParaElBosque(
  indices: number[],
  constantes: Set<number>,
  quitar: boolean,
): number[] {
  if (!quitar) {
    return indices;
  }
  const quedan = indices.filter((i) => !constantes.has(i));
  return quedan.length > 0 ? quedan : indices;
}

/**
 * Ejecuta el IF global y el de cada partición, y calcula RI e II de cada fila.
 *
 * Columnas constantes: el IF de Emilia, si al azar elige para cortar una columna
 * que vale lo mismo en todo el nodo, deja de dividir esa rama. Con muchas columnas
 * así, todos los scores se acercan a 0.5 (también los de las anomalías) y no pasan
 * el umbral. Por eso hay la opción de no pasárselas: no aportan información y su
 * código no se toca. Ver pruebas/comparar-motores.ts, escenario 3.
 */
export function ejecutarCif(
  tabla: TablaPivotada,
  p: ParametrosIsolationForest,
  contextos: Contexto[],
): ResultadoCif {
  if (tabla.filas.length < 2) {
    throw new Error('Hacen falta al menos 2 filas para el Isolation Forest.');
  }

  // Los puntos se calculan una vez y cada partición se queda con sus columnas.
  const { puntos, celdasNoNumericas } = tablaAPuntos(tabla);
  const semilla = elegirSemilla(p);
  const constantes = columnasConstantes(puntos);
  /** Los puntos con solo las columnas indicadas (posiciones en la tabla). */
  const quedarseCon = (indices: number[]) => puntos.map((punto) => indices.map((i) => punto[i]));

  // 1. IF global
  const todas = tabla.ids.map((_, i) => i);
  const scores = puntuarConSemilla(
    quedarseCon(columnasParaElBosque(todas, constantes, p.quitarConstantes)),
    p,
    semilla,
  );

  // 2. IF por partición. `scoresParticion[k][i]` es el score de la fila i en la partición k.
  const posicion = new Map(tabla.ids.map((id, i) => [id, i]));
  const particiones: ResultadoParticion[] = [];
  const scoresParticion: number[][] = [];
  let k = 0;
  for (const contexto of contextos) {
    for (const particion of contexto.particiones) {
      k++;
      // Las columnas se cogen en el orden de la tabla y no en el que se marcaron,
      // porque el bosque elige columnas por posición y si no, con la misma
      // semilla podría salir otro resultado.
      const indices = particion.columnas.map((c) => posicion.get(c)!).sort((a, b) => a - b);
      const usadas = columnasParaElBosque(indices, constantes, p.quitarConstantes);
      const semillaParticion = derivarSemilla(semilla, k);
      const scoresDeEsta = puntuarConSemilla(quedarseCon(usadas), p, semillaParticion);
      scoresParticion.push(scoresDeEsta);

      // El score medio, solo de las anomalías de la partición (no de todos los registros).
      let numAnomalias = 0;
      let sumaAnomalias = 0;
      let maximo = -Infinity;
      for (const s of scoresDeEsta) {
        if (esAnomalia(s, p.umbral)) {
          numAnomalias++;
          sumaAnomalias += s;
        }
        maximo = Math.max(maximo, s);
      }
      particiones.push({
        contexto: contexto.nombre,
        particion: particion.nombre,
        peso: particion.peso,
        numColumnas: indices.length,
        ignoradas: indices.filter((i) => !usadas.includes(i)).map((i) => tabla.ids[i]),
        semilla: semillaParticion,
        numAnomalias,
        scoreMedio: numAnomalias > 0 ? sumaAnomalias / numAnomalias : null,
        scoreMaximo: maximo,
      });
    }
  }

  // 3. RI e II de cada fila
  const filas: FilaCif[] = tabla.filas.map((fila, i) => {
    const brutos = scoresParticion.map((s) => s[i]);
    const valores = brutos.map((s) => valorEnParticion(s, p.umbral));
    const anomalia = esAnomalia(scores[i], p.umbral);
    return {
      id: i + 1,
      registro: (tabla.primerRegistro ?? 1) + i,
      timestamp: fila.timestamp,
      score: scores[i],
      anomalia,
      ...indicadores(valores),
      valores,
      brutos,
    };
  });

  return {
    semilla,
    numArboles: p.numArboles,
    umbral: p.umbral,
    tamanoMuestra: Math.min(p.tamanoMuestra, puntos.length),
    quitarConstantes: p.quitarConstantes,
    columnasConstantes: [...constantes].map((i) => tabla.ids[i]),
    // structuredClone hace una copia profunda (también de las listas de columnas).
    contextos: structuredClone(contextos),
    particiones,
    filas,
    sinFecha: tabla.sinFecha === true,
    numAnomalias: filas.filter((f) => f.anomalia).length,
    celdasNoNumericas,
  };
}

/** Nombre de la columna de una partición en el CSV: "Contexto/Partición". */
export function nombreParticion(r: ResultadoParticion): string {
  return `${r.contexto}/${r.particion}`;
}

/**
 * CSV de la tabla CIF con todas las filas (en el orden de la tabla):
 * registro, timestamp (solo si hay fecha: sin fecha sería el mismo número), anomalia
 * (global), anomalia_cif (RI e II por encima de los cortes), score, ii, ri y el valor
 * de cada partición (como en pantalla). II y las particiones donde no es anomalía
 * van en blanco.
 * La semilla va en el nombre del fichero y en el JSON de configuración.
 */
export function cifACsv(r: ResultadoCif, cortes: CortesCif): string {
  const nombres = r.particiones.map(nombreParticion);
  return Papa.unparse({
    fields: [
      'registro',
      ...(r.sinFecha ? [] : ['timestamp']),
      'anomalia',
      'anomalia_cif',
      'score',
      'ii',
      'ri',
      ...nombres,
    ],
    data: r.filas.map((f) => [
      f.registro,
      ...(r.sinFecha ? [] : [f.timestamp]),
      f.anomalia ? 1 : 0,
      esAnomaliaCif(f, cortes) ? 1 : 0,
      f.score,
      f.ii ?? '',
      f.ri,
      ...f.valores.map((v) => v ?? ''),
    ]),
  });
}

/** CSV con el resumen de cada partición (para comparar contextos). */
export function resumenParticionesACsv(r: ResultadoCif): string {
  return Papa.unparse({
    fields: [
      'contexto',
      'particion',
      'peso',
      'columnas',
      'constantes_ignoradas',
      'semilla',
      'anomalias',
      'score_medio',
      'score_maximo',
    ],
    data: r.particiones.map((p) => [
      p.contexto,
      p.particion,
      p.peso,
      p.numColumnas,
      // Los nombres separados por espacios, para que quepan en una celda.
      p.ignoradas.join(' '),
      p.semilla,
      p.numAnomalias,
      p.scoreMedio ?? '',
      p.scoreMaximo,
    ]),
  });
}
