/**
 * Estimación de hiperparámetros (procedimiento 2 del artículo, apartados 3.2 y 4.3).
 *
 * Propone el número de árboles y el umbral para unos datos concretos, en tres fases:
 *
 *   1. Subconjunto representativo DE (Fig. 5). Se lanza un IF sobre toda la tabla,
 *      se hace el histograma de los scores y se cogen los registros de la zona más
 *      repetida (la moda), no los de score más alto. Son los de comportamiento
 *      normal. Tamaño: entre 256 registros y el 20 % de la tabla.
 *
 *   2. Número de árboles (Fig. 6). Se contaminan P registros de DE subiendo un 50 %
 *      el valor de una característica elegida al azar (sensor o, si hay, DD, MM...). Se entrena el IF con 2, 4, 6... 100
 *      árboles y se mira cuántos contaminados hay entre los P scores más altos.
 *      Se propone el primer número de árboles a partir del cual ya no mejora.
 *
 *   3. Umbral (Fig. 7). Con esos árboles, se contamina del 10 % al 200 % de 10 en 10.
 *      En cada nivel se apunta el umbral mínimo que detecta todos los contaminados
 *      (el score más bajo de los contaminados). Se propone el valor donde la curva
 *      se queda plana.
 *
 * Lo único que el artículo no concreta y aquí se ha decidido: qué hacer con los
 * sensores a 0. Subir un 50 % un 0 sigue siendo 0, así que el sensor a contaminar
 * se elige entre los que no valen 0 en ese registro. Todo lo demás son los valores
 * del artículo: 1 % de registros, 1 sensor, +50 % para los árboles.
 *
 * Todo sale de una semilla, igual que el CIF, así que se puede repetir.
 * El IF de Emilia no se toca: se usa a través de puntuarConSemilla.
 */
import {
  elegirSemilla,
  ParametrosIsolationForest,
  puntuarConSemilla,
  tablaAPuntos,
} from './aplicar-isolation-forest';
import { columnasConstantes, columnasParaElBosque, esAnomalia } from './cif';
import type { TablaPivotada } from './pivotar';
import { derivarSemilla, mulberry32 } from './semilla';

// ---------------------------------------------------------------------------
// Parámetros y constantes
// ---------------------------------------------------------------------------

/** Lo que se puede cambiar de la estimación desde la pantalla. */
export interface ParametrosEstimacion {
  /** Parte de DE que se contamina (0.01 = 1 %, como en el artículo). */
  fraccionContaminada: number;
  /** Cuánto se sube el valor al estimar los árboles (0.5 = 50 %, como en el artículo). */
  contaminacionArboles: number;
  /**
   * Sensores que se suben en cada registro contaminado. El artículo habla de
   * "algunas características al azar" y en su experimento usa 1 (de 11).
   */
  sensoresPorRegistro: number;
}

export const ESTIMACION_POR_DEFECTO: ParametrosEstimacion = {
  fraccionContaminada: 0.01,
  contaminacionArboles: 0.5,
  sensoresPorRegistro: 1,
};

/** Árboles del IF con el que se hace el histograma (el valor clásico del IF). */
export const ARBOLES_HISTOGRAMA = 100;
/** Ancho de cada barra del histograma (el artículo habla de la zona 0,39–0,40). */
export const ANCHO_BARRA = 0.01;
/** DE tiene como mínimo 256 registros (la muestra del IF original)... */
export const MINIMO_DE = 256;
/** ...y como máximo el 20 % de la tabla, si eso es más de 256. */
export const FRACCION_MAXIMA_DE = 0.2;
/** Se prueban 2, 4, 6... hasta 100 árboles (el máximo que recomienda el IF clásico). */
export const PASO_ARBOLES = 2;
export const MAX_ARBOLES = 100;
/** Niveles de contaminación para el umbral: 10 %, 20 %... 200 %. */
export const NIVELES_CONTAMINACION = Array.from({ length: 20 }, (_, i) => (i + 1) / 10);
/** El umbral se da por estable si no cambia más que esto... */
export const TOLERANCIA_UMBRAL = 0.02;
/** ...durante estos incrementos seguidos (evita quedarse en un mínimo local). */
export const INCREMENTOS_ESTABLES = 3;
/** Las métricas se dan por estables si no bajan más que esto respecto a su máximo. */
export const TOLERANCIA_METRICA = 0.05;
/** Si con lo propuesto saldría anómala más de esta parte de la tabla, se avisa. */
export const FRACCION_ANOMALIAS_AVISO = 0.05;
/** F1 mínimo para fiarse de la estimación (en el artículo todas las métricas pasan de 0,80). */
export const F1_FIABLE = 0.8;

/** Comprueba los parámetros. Devuelve un mensaje de error, o null si están bien. */
export function validarEstimacion(e: ParametrosEstimacion): string | null {
  const esNumero = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  if (
    !esNumero(e.fraccionContaminada) ||
    e.fraccionContaminada <= 0 ||
    e.fraccionContaminada > 0.2
  ) {
    return 'El porcentaje de registros contaminados debe estar entre 0 (sin incluir) y 20 %.';
  }
  if (
    !esNumero(e.contaminacionArboles) ||
    e.contaminacionArboles <= 0 ||
    e.contaminacionArboles > 5
  ) {
    return 'La contaminación para los árboles debe estar entre 0 (sin incluir) y 500 %.';
  }
  if (!Number.isInteger(e.sensoresPorRegistro) || e.sensoresPorRegistro < 1) {
    return 'Las características contaminadas por registro deben ser un entero de al menos 1.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

/** Una barra del histograma de scores (Fig. 5). */
export interface BarraHistograma {
  desde: number;
  hasta: number;
  /** Registros de la tabla con el score en esta barra. */
  cuenta: number;
  /** De esos, cuántos han entrado en DE. */
  enSubconjunto: number;
}

/** Un punto de la Fig. 6: las métricas con un número de árboles. */
export interface PuntoArboles {
  numArboles: number;
  /** Contaminados que están entre los P scores más altos. */
  detectados: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

/** Un punto de la Fig. 7: el umbral mínimo con un nivel de contaminación. */
export interface PuntoUmbral {
  /** 0.1 = 10 %, 2 = 200 %. */
  contaminacion: number;
  /** Score más bajo de los contaminados: con un umbral menor se detectan todos. */
  umbral: number;
  /** Registros sin contaminar que también quedarían por encima de ese umbral. */
  normalesPorEncima: number;
}

export interface ResultadoEstimacion {
  semilla: number;
  parametros: ParametrosEstimacion;
  /** Filas de la tabla completa. */
  numFilas: number;
  histograma: BarraHistograma[];
  /** Barra con más registros (la moda). */
  barraModal: { desde: number; hasta: number };
  /** El subconjunto DE. */
  subconjunto: { tamano: number; scoreMinimo: number; scoreMaximo: number };
  /** P: registros contaminados. */
  numContaminados: number;
  arboles: PuntoArboles[];
  arbolesPropuestos: number;
  umbrales: PuntoUmbral[];
  umbralPropuesto: number;
  /** Nivel de contaminación a partir del cual el umbral ya no cambia (null si no se estabiliza). */
  contaminacionEstable: number | null;
  /**
   * Filas de la tabla completa que el IF global marcaría como anomalía con los
   * árboles y el umbral propuestos (y esta misma semilla).
   */
  anomaliasPrevistas: number;
  /** Mejor F1 conseguido al probar árboles (el artículo llega a más de 0,80). */
  mejorF1: number;
  /**
   * Si el resultado es de fiar: el IF encuentra la mayoría de los contaminados
   * (F1 de al menos F1_FIABLE) y el umbral llega a estabilizarse.
   */
  fiable: boolean;
  /** Cosas que conviene saber antes de fiarse del resultado. */
  avisos: string[];
}

/** Por dónde va el cálculo, para la barra de progreso. */
export interface ProgresoEstimacion {
  fase: 'histograma' | 'arboles' | 'umbral' | 'comprobacion';
  hecho: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Piezas (exportadas para poder probarlas por separado)
// ---------------------------------------------------------------------------

/** Número de la barra del histograma en la que cae un score. */
function barraDe(score: number): number {
  // El 1e-9 evita que 0.57 caiga en la barra 56 por los decimales binarios.
  return Math.floor(score / ANCHO_BARRA + 1e-9);
}

/** Cuántos registros debe tener DE con una tabla de `numFilas` filas. */
export function tamanoSubconjunto(numFilas: number): number {
  return Math.min(numFilas, Math.max(MINIMO_DE, Math.floor(FRACCION_MAXIMA_DE * numFilas)));
}

/**
 * Elige DE: los registros con el score más cercano al centro de la barra modal.
 * Devuelve sus posiciones en la tabla (en orden) y el histograma.
 */
export function elegirSubconjunto(scores: number[]): {
  indices: number[];
  histograma: BarraHistograma[];
  barraModal: { desde: number; hasta: number };
} {
  // Histograma: cuántos scores caen en cada barra.
  const cuentas = new Map<number, number>();
  for (const s of scores) {
    cuentas.set(barraDe(s), (cuentas.get(barraDe(s)) ?? 0) + 1);
  }
  // La moda: la barra con más registros (a igualdad, la de score más bajo).
  let modal = 0;
  let maximo = -1;
  for (const [barra, cuenta] of [...cuentas].sort((a, b) => a[0] - b[0])) {
    if (cuenta > maximo) {
      maximo = cuenta;
      modal = barra;
    }
  }

  // Se va cogiendo desde la moda hacia fuera hasta llenar DE.
  const centro = (modal + 0.5) * ANCHO_BARRA;
  const porCercania = scores
    .map((s, i) => ({ i, distancia: Math.abs(s - centro) }))
    .sort((a, b) => a.distancia - b.distancia || a.i - b.i);
  const indices = porCercania
    .slice(0, tamanoSubconjunto(scores.length))
    .map((x) => x.i)
    .sort((a, b) => a - b);

  const dentro = new Map<number, number>();
  for (const i of indices) {
    dentro.set(barraDe(scores[i]), (dentro.get(barraDe(scores[i])) ?? 0) + 1);
  }
  const barras = [...cuentas.keys()];
  const primera = Math.min(...barras);
  const ultima = Math.max(...barras);
  const histograma: BarraHistograma[] = [];
  for (let b = primera; b <= ultima; b++) {
    histograma.push({
      desde: b * ANCHO_BARRA,
      hasta: (b + 1) * ANCHO_BARRA,
      cuenta: cuentas.get(b) ?? 0,
      enSubconjunto: dentro.get(b) ?? 0,
    });
  }
  return {
    indices,
    histograma,
    barraModal: { desde: modal * ANCHO_BARRA, hasta: (modal + 1) * ANCHO_BARRA },
  };
}

/** Qué se contamina en un registro: su fila en DE y las columnas que se suben. */
export interface CeldaContaminada {
  fila: number;
  columnas: number[];
}

/**
 * Elige al azar P registros de DE y, en cada uno, tantos sensores como diga `sensores`
 * de entre los que no
 * valgan 0 (o los que haya, si son menos). Los registros que son todo ceros se
 * saltan (no se pueden contaminar con un %).
 */
export function elegirCeldas(
  puntos: number[][],
  cuantas: number,
  azar: () => number,
  sensores = 1,
): CeldaContaminada[] {
  // Barajar las filas (Fisher-Yates) y recorrerlas hasta tener las que hacen falta.
  const filas = puntos.map((_, i) => i);
  for (let i = filas.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [filas[i], filas[j]] = [filas[j], filas[i]];
  }
  const celdas: CeldaContaminada[] = [];
  for (const fila of filas) {
    if (celdas.length === cuantas) break;
    const noCero = puntos[fila].map((v, c) => (v !== 0 ? c : -1)).filter((c) => c >= 0);
    if (noCero.length > 0) {
      // Se van sacando sensores al azar de los que no valen 0, sin repetir.
      const columnas: number[] = [];
      while (columnas.length < sensores && noCero.length > 0) {
        columnas.push(noCero.splice(Math.floor(azar() * noCero.length), 1)[0]);
      }
      celdas.push({ fila, columnas: columnas.sort((a, b) => a - b) });
    }
  }
  return celdas;
}

/** Copia de los puntos con las celdas elegidas subidas un `nivel` (0.5 = +50 %). */
export function contaminar(
  puntos: number[][],
  celdas: CeldaContaminada[],
  nivel: number,
): number[][] {
  const copia = puntos.map((p) => [...p]);
  for (const { fila, columnas } of celdas) {
    for (const columna of columnas) {
      copia[fila][columna] = copia[fila][columna] * (1 + nivel);
    }
  }
  return copia;
}

/**
 * Métricas de la Fig. 6. Se consideran "detectados por el IF" los P registros con
 * el score más alto (P = número de contaminados) y se comparan con los contaminados.
 * Como se marcan tantos como contaminados hay, precision, recall y F1 valen lo mismo.
 */
export function metricas(
  scores: number[],
  contaminadas: Set<number>,
): Omit<PuntoArboles, 'numArboles'> {
  const n = scores.length;
  const p = contaminadas.size;
  const masAltos = scores
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, p);
  const tp = masAltos.filter((x) => contaminadas.has(x.i)).length;
  const fp = p - tp;
  const fn = p - tp;
  const tn = n - tp - fp - fn;
  const precision = p > 0 ? tp / (tp + fp) : 0;
  const recall = p > 0 ? tp / (tp + fn) : 0;
  return {
    detectados: tp,
    accuracy: (tp + tn) / n,
    precision,
    recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
  };
}

/**
 * Número de árboles propuesto: el más pequeño a partir del cual el F1 ya no baja
 * de su máximo (con un margen). Es "el mínimo de árboles que da el máximo de
 * detecciones" del artículo, pero exigiendo que se mantenga al añadir más.
 */
export function elegirArboles(puntos: PuntoArboles[]): number {
  const maximo = Math.max(...puntos.map((p) => p.f1));
  const margen = TOLERANCIA_METRICA;
  // De atrás hacia delante: el último punto que queda por debajo marca el corte.
  let elegido = puntos[puntos.length - 1].numArboles;
  for (let i = puntos.length - 1; i >= 0; i--) {
    if (puntos[i].f1 < maximo - margen - 1e-9) break;
    elegido = puntos[i].numArboles;
  }
  return elegido;
}

/**
 * Umbral propuesto: el de la zona plana de la Fig. 7. Se busca el primer nivel de
 * contaminación desde el que el umbral no cambia (más que la tolerancia) durante
 * INCREMENTOS_ESTABLES niveles seguidos. Se devuelve el más bajo de ese tramo,
 * redondeado hacia abajo a dos decimales, para que todos los contaminados queden
 * por encima (anomalía = score mayor que el umbral).
 * Si la curva no se estabiliza, se usa el tramo final y se avisa (contaminacion = null).
 */
export function elegirUmbral(puntos: PuntoUmbral[]): {
  umbral: number;
  contaminacion: number | null;
} {
  const haciaAbajo = (x: number) => Math.floor(x * 100 + 1e-9) / 100;
  for (let i = 0; i + INCREMENTOS_ESTABLES < puntos.length; i++) {
    const tramo = puntos.slice(i, i + INCREMENTOS_ESTABLES + 1).map((p) => p.umbral);
    if (tramo.every((u) => Math.abs(u - tramo[0]) <= TOLERANCIA_UMBRAL)) {
      return { umbral: haciaAbajo(Math.min(...tramo)), contaminacion: puntos[i].contaminacion };
    }
  }
  const final = puntos.slice(-(INCREMENTOS_ESTABLES + 1)).map((p) => p.umbral);
  return { umbral: haciaAbajo(Math.min(...final)), contaminacion: null };
}

// ---------------------------------------------------------------------------
// El procedimiento completo
// ---------------------------------------------------------------------------

/**
 * Hace la estimación paso a paso. Es un generador: después de cada Isolation
 * Forest devuelve por dónde va, y así la página puede pintar el progreso y no
 * quedarse congelada (hay 72 bosques que entrenar). El resultado sale al final.
 *
 * De los parámetros del IF solo se usan el tamaño de muestra, la semilla y la
 * opción de quitar columnas constantes; los árboles y el umbral son lo que se estima.
 */
export function* pasosEstimacion(
  tabla: TablaPivotada,
  p: ParametrosIsolationForest,
  e: ParametrosEstimacion,
): Generator<ProgresoEstimacion, ResultadoEstimacion> {
  if (tabla.filas.length < 2) {
    throw new Error('Hacen falta al menos 2 filas para estimar.');
  }
  const numerosArboles: number[] = [];
  for (let t = PASO_ARBOLES; t <= MAX_ARBOLES; t += PASO_ARBOLES) numerosArboles.push(t);
  const total = 2 + numerosArboles.length + NIVELES_CONTAMINACION.length;
  let hecho = 0;
  const avisos: string[] = [];

  // Los mismos puntos y las mismas columnas que usará el IF global del CIF.
  const { puntos: todos } = tablaAPuntos(tabla);
  const columnas = columnasParaElBosque(
    tabla.ids.map((_, i) => i),
    columnasConstantes(todos),
    p.quitarConstantes,
  );
  const puntos = todos.map((punto) => columnas.map((c) => punto[c]));
  const semilla = elegirSemilla(p);

  // --- Fase 1: histograma y subconjunto DE ---
  yield { fase: 'histograma', hecho, total };
  const scores = puntuarConSemilla(puntos, { ...p, numArboles: ARBOLES_HISTOGRAMA }, semilla);
  hecho++;
  const { indices, histograma, barraModal } = elegirSubconjunto(scores);
  // Dentro de DE puede haber sensores que no cambian aunque en la tabla entera sí
  // (por ejemplo, contadores que solo se mueven de día). Se quitan por lo mismo
  // que en el CIF: al IF de Emilia las columnas constantes le aplastan los scores.
  const deCompleto = indices.map((i) => puntos[i]);
  const columnasDe = columnasParaElBosque(
    columnas.map((_, i) => i),
    columnasConstantes(deCompleto),
    p.quitarConstantes,
  );
  const de = deCompleto.map((punto) => columnasDe.map((c) => punto[c]));
  const scoresDe = indices.map((i) => scores[i]);
  if (de.length === puntos.length) {
    avisos.push(
      `La tabla tiene ${puntos.length} filas, menos de las ${MINIMO_DE} que pide el subconjunto: se usan todas, también las raras.`,
    );
  } else if (de.length > FRACCION_MAXIMA_DE * puntos.length) {
    const porcentaje = Math.round((de.length / puntos.length) * 100);
    avisos.push(
      `El subconjunto (${de.length} registros) es el ${porcentaje} % de la tabla, más del 20 % recomendado. Con más datos (a partir de ${MINIMO_DE / FRACCION_MAXIMA_DE} filas) la estimación es más fiable.`,
    );
  }

  // --- Qué registros se contaminan (los mismos en las fases 2 y 3) ---
  // P: el porcentaje pedido de DE (en el artículo, el 1 %). Como poco, un registro.
  const pedidos = Math.max(1, Math.round(e.fraccionContaminada * de.length));
  const celdas = elegirCeldas(
    de,
    Math.min(pedidos, Math.floor(de.length / 2)),
    mulberry32(derivarSemilla(semilla, 1)),
    e.sensoresPorRegistro,
  );
  if (celdas.length === 0) {
    throw new Error(
      'No se puede contaminar ningún registro: en el subconjunto todas las columnas valen 0.',
    );
  }
  if (celdas.length < pedidos) {
    avisos.push(
      `Solo se han podido contaminar ${celdas.length} registros de los ${pedidos} previstos (el resto son todo ceros o no hay suficientes).`,
    );
  }
  const contaminadas = new Set(celdas.map((c) => c.fila));

  // --- Fase 2: número de árboles ---
  // La misma semilla para todos: el bosque de 6 árboles son los 4 de antes y dos
  // más, así la curva cambia por añadir árboles y no por el azar de cada prueba.
  const deArboles = contaminar(de, celdas, e.contaminacionArboles);
  const semillaArboles = derivarSemilla(semilla, 2);
  const arboles: PuntoArboles[] = [];
  for (const numArboles of numerosArboles) {
    yield { fase: 'arboles', hecho, total };
    const s = puntuarConSemilla(deArboles, { ...p, numArboles }, semillaArboles);
    arboles.push({ numArboles, ...metricas(s, contaminadas) });
    hecho++;
  }
  const arbolesPropuestos = elegirArboles(arboles);
  const mejor = Math.max(...arboles.map((a) => a.detectados));
  const mejorF1 = Math.max(...arboles.map((a) => a.f1));
  if (mejorF1 < F1_FIABLE) {
    const sensores =
      e.sensoresPorRegistro === 1
        ? 'una sola característica'
        : `${e.sensoresPorRegistro} características`;
    avisos.push(
      `El Isolation Forest solo encuentra ${mejor} de los ${celdas.length} registros contaminados: en estos datos, subir un ${Math.round(e.contaminacionArboles * 100)} % ${sensores} no se sale de lo normal. Prueba a contaminar más características por registro o con un porcentaje mayor.`,
    );
  }

  // --- Fase 3: umbral ---
  const semillaUmbral = derivarSemilla(semilla, 3);
  const umbrales: PuntoUmbral[] = [];
  for (const contaminacion of NIVELES_CONTAMINACION) {
    yield { fase: 'umbral', hecho, total };
    const s = puntuarConSemilla(
      contaminar(de, celdas, contaminacion),
      { ...p, numArboles: arbolesPropuestos },
      semillaUmbral,
    );
    let umbral = Infinity;
    for (const fila of contaminadas) umbral = Math.min(umbral, s[fila]);
    umbrales.push({
      contaminacion,
      umbral,
      normalesPorEncima: s.filter((x, i) => !contaminadas.has(i) && x >= umbral).length,
    });
    hecho++;
  }
  const { umbral: umbralPropuesto, contaminacion: contaminacionEstable } = elegirUmbral(umbrales);
  if (contaminacionEstable === null) {
    avisos.push(
      'El umbral no llega a estabilizarse al subir la contaminación: se propone el del tramo final, tómalo como orientativo.',
    );
  }

  // --- Comprobación: qué pasaría en la tabla completa con lo propuesto ---
  // Es el mismo bosque que hará el IF global del CIF si se usa esta semilla.
  yield { fase: 'comprobacion', hecho, total };
  const scoresFinales = puntuarConSemilla(puntos, { ...p, numArboles: arbolesPropuestos }, semilla);
  const anomaliasPrevistas = scoresFinales.filter((x) => esAnomalia(x, umbralPropuesto)).length;
  if (anomaliasPrevistas > FRACCION_ANOMALIAS_AVISO * puntos.length) {
    const porcentaje = Math.round((anomaliasPrevistas / puntos.length) * 100);
    avisos.push(
      `Con estos valores, el ${porcentaje} % de la tabla (${anomaliasPrevistas} filas) saldría como anomalía. El umbral se calcula sobre los registros más normales y puede quedarse corto para la tabla entera: revísalo antes de aplicarlo.`,
    );
  }

  return {
    semilla,
    parametros: { ...e },
    numFilas: puntos.length,
    histograma,
    barraModal,
    subconjunto: {
      tamano: de.length,
      scoreMinimo: Math.min(...scoresDe),
      scoreMaximo: Math.max(...scoresDe),
    },
    numContaminados: celdas.length,
    arboles,
    arbolesPropuestos,
    umbrales,
    umbralPropuesto,
    contaminacionEstable,
    anomaliasPrevistas,
    mejorF1,
    fiable: mejorF1 >= F1_FIABLE && contaminacionEstable !== null,
    avisos,
  };
}

/** La estimación de una vez, sin progreso (para las pruebas y los scripts). */
export function estimar(
  tabla: TablaPivotada,
  p: ParametrosIsolationForest,
  e: ParametrosEstimacion = ESTIMACION_POR_DEFECTO,
): ResultadoEstimacion {
  const pasos = pasosEstimacion(tabla, p, e);
  let paso = pasos.next();
  while (!paso.done) paso = pasos.next();
  return paso.value;
}
