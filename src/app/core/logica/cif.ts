/**
 * Contextual Isolation Forest (procedimiento 3 del artículo).
 *
 *   1. IF sobre la tabla completa: score global de cada fila (AD = las que pasan el umbral).
 *   2. IF por separado sobre cada partición de cada contexto (solo sus columnas).
 *   3. Para cada fila, con los scores de las particiones:
 *        - valor en la partición = su score si pasa el umbral, si no 0 (como la Tabla 5)
 *        - RI = particiones donde es anomalía / total de particiones          (Ec. 1)
 *        - II = mediana de los valores de todas las particiones, con los 0    (Ec. 2 y 3)
 *
 * Ejemplo de la Tabla 5 (fila 30051, 8 particiones):
 *   valores (0.82, 0, 0, 0.75, 0.77, 0.79, 0.77, 0) => RI = 5/8 = 0.63
 *   ordenados (0, 0, 0, 0.75, 0.77, 0.77, 0.79, 0.82) => II = (0.75 + 0.77) / 2 = 0.76
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
  scoreMedio: number;
  scoreMaximo: number;
}

/** Una fila de la tabla CIF. */
export interface FilaCif {
  /** Número de fila en la tabla (empieza en 1), como el ID de la Tabla 5. */
  id: number;
  timestamp: string;
  /** Score del IF global. */
  score: number;
  anomalia: boolean;
  ri: number;
  ii: number;
  /** Valor en cada partición (score si pasa el umbral, si no 0), en el orden de `particiones`. */
  valores: number[];
  /** Score de cada partición sin aplicar el umbral. */
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
  numAnomalias: number;
  celdasNoNumericas: number;
}

/** Mediana de una lista de números (la media de los dos centrales si son pares). */
export function mediana(valores: number[]): number {
  if (valores.length === 0) {
    return 0;
  }
  const ordenados = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1
    ? ordenados[mitad]
    : (ordenados[mitad - 1] + ordenados[mitad]) / 2;
}

/** Una fila es anomalía si su score es mayor (estrictamente) que el umbral, como en el artículo. */
export function esAnomalia(score: number, umbral: number): boolean {
  return score > umbral;
}

/** Valor de una fila en una partición: su score si es anomalía, si no 0 (Tabla 5). */
export function valorEnParticion(score: number, umbral: number): number {
  return esAnomalia(score, umbral) ? score : 0;
}

/**
 * RI e II de una fila a partir de sus valores en todas las particiones
 * (ya con el umbral aplicado, es decir, 0 donde no es anomalía).
 *   RI = particiones con valor > 0 / total de particiones   (Ec. 1)
 *   II = mediana de todos los valores, contando los 0       (Ec. 2 y 3)
 */
export function indicadores(valores: number[]): { ri: number; ii: number } {
  if (valores.length === 0) {
    return { ri: 0, ii: 0 };
  }
  const afectadas = valores.filter((v) => v > 0).length;
  return { ri: afectadas / valores.length, ii: mediana(valores) };
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
function columnasParaElBosque(
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

      let numAnomalias = 0;
      let suma = 0;
      let maximo = -Infinity;
      for (const s of scoresDeEsta) {
        if (esAnomalia(s, p.umbral)) numAnomalias++;
        suma += s;
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
        scoreMedio: suma / scoresDeEsta.length,
        scoreMaximo: maximo,
      });
    }
  }

  // 3. RI e II de cada fila
  const filas: FilaCif[] = tabla.filas.map((fila, i) => {
    const brutos = scoresParticion.map((s) => s[i]);
    const valores = brutos.map((s) => valorEnParticion(s, p.umbral));
    return {
      id: i + 1,
      timestamp: fila.timestamp,
      score: scores[i],
      anomalia: esAnomalia(scores[i], p.umbral),
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
 * id, timestamp, anomalia, score, ii, ri, el valor de cada partición
 * (con umbral, como en pantalla) y después el score sin umbral de cada una.
 * La semilla va en el nombre del fichero y en el JSON de configuración.
 */
export function cifACsv(r: ResultadoCif): string {
  const nombres = r.particiones.map(nombreParticion);
  return Papa.unparse({
    fields: [
      'id',
      'timestamp',
      'anomalia',
      'score',
      'ii',
      'ri',
      ...nombres,
      ...nombres.map((n) => `bruto ${n}`),
    ],
    data: r.filas.map((f) => [
      f.id,
      f.timestamp,
      f.anomalia ? 1 : 0,
      f.score,
      f.ii,
      f.ri,
      ...f.valores,
      ...f.brutos,
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
      p.scoreMedio,
      p.scoreMaximo,
    ]),
  });
}
