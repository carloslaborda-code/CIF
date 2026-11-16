/**
 * Fases 3.1.1 y 3.1.2 del procedimiento 1 del artículo (preparación de datos).
 *
 * El orden es el de la Fig. 1: procesado de características → codificación →
 * valores nulos → contextos. Los nulos ya los trata fusionar.ts (rellenarHuecos)
 * y los contextos, contextos.ts; aquí van las dos primeras fases, que se aplican
 * a la tabla alineada antes de rellenar los huecos.
 *
 * 3.1.1 Procesado de características. Una lista de operaciones (la "Config" del
 * artículo) que se aplican una detrás de otra:
 *   - Extracción (F, Fextrac, op): saca una característica nueva de F. Para fechas,
 *     día, mes, año, hora, minuto o día de la semana; para texto, un trozo.
 *   - Combinación (F1, F2, Fcomb): junta F1 y F2 en una característica nueva.
 *   - Eliminación (F): quita F.
 *   - Adición (Fnew, default): añade Fnew con el valor "default" en todas las filas.
 *   Por defecto se hace lo mismo que el artículo en su experimento (4.2.1): sacar
 *   DD, MM, HH y MIN de la fecha. La fecha original deja de ser característica,
 *   como en el artículo; aquí nunca lo fue, solo identifica la fila.
 *
 * 3.1.2 Codificación. Un diccionario valor de texto → número, único para toda la
 * tabla. Puede empezar vacío o cargado. Cada valor que ya está se cambia por su
 * número; si no está, se le da uno nuevo y se añade. Las características que ya
 * son numéricas no se tocan (4.2.2).
 *
 * Lo que el artículo no concreta y aquí se ha decidido:
 *   - La combinación concatena los dos valores como texto (F1_F2). Como la
 *     codificación va después, el resultado se convierte en número con el
 *     diccionario. Si falta uno de los dos valores, el resultado es un hueco
 *     y lo trata la fase de nulos.
 *   - La hora, el día... se leen tal cual están escritos en el CSV, sin cambiar
 *     de zona horaria, igual que se hace al exportar los CSV.
 *   - Una característica es cualitativa si tiene algún valor que no es un número.
 *     Entonces se codifican todos sus valores, para que un "1" de texto no se
 *     confunda con el número 1 de otra categoría.
 *   - Los códigos empiezan en 1, para no confundirse con el 0 con que se rellenan
 *     por defecto los huecos.
 */
import * as Papa from 'papaparse';

import type { TablaPivotada } from './pivotar';

// ---------------------------------------------------------------------------
// 3.1.1 Procesado de características
// ---------------------------------------------------------------------------

/** Qué se saca en una extracción. */
export type OperacionExtraccion =
  'dia' | 'mes' | 'anio' | 'hora' | 'minuto' | 'diaSemana' | 'subcadena';

/** Opciones para el desplegable de la pantalla. */
export const OPCIONES_EXTRACCION: { valor: OperacionExtraccion; texto: string }[] = [
  { valor: 'dia', texto: 'Día (DD)' },
  { valor: 'mes', texto: 'Mes (MM)' },
  { valor: 'anio', texto: 'Año (YYYY)' },
  { valor: 'hora', texto: 'Hora (HH)' },
  { valor: 'minuto', texto: 'Minuto (MIN)' },
  { valor: 'diaSemana', texto: 'Día de la semana (1 = lunes … 7 = domingo)' },
  { valor: 'subcadena', texto: 'Trozo de texto' },
];

/**
 * Una operación del procesado. `origen`, `a` y `b` pueden ser una columna de
 * datos o la columna del timestamp (por su nombre, p. ej. "timestamp").
 */
export type Operacion =
  | {
      tipo: 'extraer';
      origen: string;
      destino: string;
      op: OperacionExtraccion;
      /** Solo para 'subcadena': posición del primer carácter (desde 1) y cuántos. */
      inicio?: number;
      longitud?: number;
    }
  | { tipo: 'combinar'; a: string; b: string; destino: string }
  | { tipo: 'eliminar'; columna: string }
  | { tipo: 'anadir'; destino: string; valor: string };

/** El procesado del experimento del artículo (4.2.1), sobre la columna del timestamp. */
export function procesadoDelArticulo(columnaTimestamp: string): Operacion[] {
  return [
    { tipo: 'extraer', origen: columnaTimestamp, destino: 'DD', op: 'dia' },
    { tipo: 'extraer', origen: columnaTimestamp, destino: 'MM', op: 'mes' },
    { tipo: 'extraer', origen: columnaTimestamp, destino: 'HH', op: 'hora' },
    { tipo: 'extraer', origen: columnaTimestamp, destino: 'MIN', op: 'minuto' },
  ];
}

/** Separador de la combinación: "zona1" + "bomba" => "zona1_bomba". */
export const SEPARADOR_COMBINACION = '_';

/** Partes de una fecha leídas del texto, sin zona horaria. */
interface PartesFecha {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
}

/**
 * Lee una fecha en los formatos que maneja la herramienta: ISO
 * (2026-10-01T00:15:00.000Z, también con espacio en vez de T) o el del
 * visualizador de Emilia (01/10/2026 00:15:00). Sin hora, la hora es 0.
 * Devuelve null si no es una fecha válida.
 */
export function leerFecha(texto: string): PartesFecha | null {
  const t = texto.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(t);
  let partes: PartesFecha | null = null;
  if (m) {
    partes = { anio: +m[1], mes: +m[2], dia: +m[3], hora: +(m[4] ?? 0), minuto: +(m[5] ?? 0) };
  } else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(t);
    if (m) {
      partes = { anio: +m[3], mes: +m[2], dia: +m[1], hora: +(m[4] ?? 0), minuto: +(m[5] ?? 0) };
    }
  }
  if (!partes) {
    return null;
  }
  // Se comprueba que el día existe (que no sea un 31/02) volviendo a montar la fecha.
  const fecha = new Date(Date.UTC(partes.anio, partes.mes - 1, partes.dia));
  const valida =
    fecha.getUTCFullYear() === partes.anio &&
    fecha.getUTCMonth() === partes.mes - 1 &&
    fecha.getUTCDate() === partes.dia &&
    partes.hora < 24 &&
    partes.minuto < 60;
  return valida ? partes : null;
}

/** Aplica una extracción a un valor. Devuelve '' (un hueco) si no se puede. */
export function extraer(valor: string, op: OperacionExtraccion, inicio = 1, longitud = 1): string {
  if (valor === '') {
    return '';
  }
  if (op === 'subcadena') {
    return valor.substring(inicio - 1, inicio - 1 + longitud);
  }
  const f = leerFecha(valor);
  if (!f) {
    return '';
  }
  switch (op) {
    case 'dia':
      return String(f.dia);
    case 'mes':
      return String(f.mes);
    case 'anio':
      return String(f.anio);
    case 'hora':
      return String(f.hora);
    case 'minuto':
      return String(f.minuto);
    case 'diaSemana': {
      // getUTCDay da 0 = domingo … 6 = sábado; se pasa a 1 = lunes … 7 = domingo.
      const d = new Date(Date.UTC(f.anio, f.mes - 1, f.dia)).getUTCDay();
      return String(d === 0 ? 7 : d);
    }
  }
}

/**
 * Comprueba la lista de operaciones contra las columnas de la tabla, en orden
 * (cada operación ve las columnas que han dejado las anteriores).
 * Devuelve un mensaje de error, o null si todo está bien.
 */
export function validarOperaciones(
  operaciones: Operacion[],
  columnaTimestamp: string,
  columnas: string[],
): string | null {
  const existentes = new Set(columnas);
  const existe = (c: string) => c === columnaTimestamp || existentes.has(c);

  for (const [i, o] of operaciones.entries()) {
    const n = `Operación ${i + 1}`;
    if (o.tipo === 'eliminar') {
      if (!existentes.has(o.columna)) {
        return `${n}: no existe la columna "${o.columna}" (la del timestamp no se puede quitar).`;
      }
      existentes.delete(o.columna);
      continue;
    }
    const destino = o.destino.trim();
    if (destino === '') {
      return `${n}: falta el nombre de la característica nueva.`;
    }
    if (existe(destino)) {
      return `${n}: ya hay una columna llamada "${destino}".`;
    }
    if (o.tipo === 'extraer') {
      if (!existe(o.origen)) {
        return `${n}: no existe la columna "${o.origen}".`;
      }
      if (o.op === 'subcadena') {
        const entero = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 1;
        if (!entero(o.inicio) || !entero(o.longitud)) {
          return `${n}: el inicio y la longitud del trozo deben ser enteros de 1 en adelante.`;
        }
      }
    } else if (o.tipo === 'combinar') {
      if (!existe(o.a) || !existe(o.b)) {
        return `${n}: no existe la columna "${existe(o.a) ? o.b : o.a}".`;
      }
    }
    existentes.add(destino);
  }
  return null;
}

/**
 * Aplica las operaciones en orden y devuelve una tabla nueva (no modifica la de
 * entrada). Las características nuevas se añaden al final. Hay que validar antes
 * con validarOperaciones.
 */
export function procesarCaracteristicas(
  tabla: TablaPivotada,
  operaciones: Operacion[],
): TablaPivotada {
  let ids = [...tabla.ids];
  let filas = tabla.filas.map((f) => ({ timestamp: f.timestamp, valores: [...f.valores] }));

  /** Valor de una columna en una fila (la del timestamp también vale). */
  const leer = (columna: string): ((fila: (typeof filas)[number]) => string) => {
    if (columna === tabla.columnaTimestamp) {
      return (fila) => fila.timestamp;
    }
    const c = ids.indexOf(columna);
    return (fila) => fila.valores[c];
  };

  for (const o of operaciones) {
    if (o.tipo === 'eliminar') {
      const c = ids.indexOf(o.columna);
      ids = ids.filter((_, i) => i !== c);
      filas = filas.map((f) => ({ ...f, valores: f.valores.filter((_, i) => i !== c) }));
      continue;
    }
    let calcular: (fila: (typeof filas)[number]) => string;
    if (o.tipo === 'extraer') {
      const origen = leer(o.origen);
      calcular = (fila) => extraer(origen(fila), o.op, o.inicio, o.longitud);
    } else if (o.tipo === 'combinar') {
      const a = leer(o.a);
      const b = leer(o.b);
      calcular = (fila) => {
        const va = a(fila);
        const vb = b(fila);
        return va === '' || vb === '' ? '' : va + SEPARADOR_COMBINACION + vb;
      };
    } else {
      calcular = () => o.valor;
    }
    for (const fila of filas) {
      fila.valores.push(calcular(fila));
    }
    ids.push(o.destino.trim());
  }

  return { ...tabla, ids, filas };
}

// ---------------------------------------------------------------------------
// 3.1.2 Codificación
// ---------------------------------------------------------------------------

/** Diccionario de la codificación: valor de texto → número. */
export type Diccionario = Record<string, number>;

/**
 * Convierte el texto de una celda en número. Devuelve NaN si no lo es (y si
 * está vacío: Number('') daría 0).
 *
 * Acepta la coma decimal, porque Excel en español exporta así los CSV
 * (12,5 o 1,72E-02): si hay una sola coma y ningún punto, la coma es el
 * decimal. No hay separador de miles: "1.234,5" no es un número. Los formatos
 * del Excel de los datos (General y 0.0000) no lo usan.
 */
export function aNumero(texto: string): number {
  let t = texto.trim();
  if (t === '') {
    return NaN;
  }
  if (!t.includes('.') && t.indexOf(',') === t.lastIndexOf(',')) {
    t = t.replace(',', '.');
  }
  return Number(t);
}

/** true si el texto es un número (el vacío no cuenta: es un hueco). */
export function esNumero(texto: string): boolean {
  return Number.isFinite(aNumero(texto));
}

/** Comprueba un diccionario cargado. Devuelve un mensaje de error, o null si está bien. */
export function validarDiccionario(d: unknown): string | null {
  if (typeof d !== 'object' || d === null || Array.isArray(d)) {
    return 'El diccionario debe ser un objeto { "valor": número }.';
  }
  const codigos = Object.values(d);
  if (!codigos.every((c) => typeof c === 'number' && Number.isFinite(c))) {
    return 'Todos los códigos del diccionario deben ser números.';
  }
  if (new Set(codigos).size !== codigos.length) {
    return 'Hay dos valores con el mismo código en el diccionario.';
  }
  return null;
}

export interface ResultadoCodificacion {
  tabla: TablaPivotada;
  /** El diccionario de entrada con los valores nuevos añadidos. */
  diccionario: Diccionario;
  /** Columnas que se han codificado (las que tenían algún valor que no es un número). */
  columnasCodificadas: string[];
  /** Cuántos valores se han añadido al diccionario. */
  valoresNuevos: number;
}

/**
 * Codifica las características cualitativas. Recorre las columnas de izquierda a
 * derecha y las filas de arriba abajo, así que con los mismos datos y el mismo
 * diccionario de entrada sale siempre lo mismo. Los huecos se quedan como huecos.
 */
export function codificar(tabla: TablaPivotada, entrada: Diccionario = {}): ResultadoCodificacion {
  const diccionario: Diccionario = { ...entrada };
  let siguiente = Math.max(0, ...Object.values(diccionario)) + 1;
  let valoresNuevos = 0;

  const codificadas = tabla.ids
    .map((_, c) => c)
    .filter((c) => tabla.filas.some((f) => f.valores[c] !== '' && !esNumero(f.valores[c])));
  const filas = tabla.filas.map((f) => ({ timestamp: f.timestamp, valores: [...f.valores] }));

  for (const c of codificadas) {
    for (const fila of filas) {
      const v = fila.valores[c];
      if (v === '') {
        continue;
      }
      if (!Object.hasOwn(diccionario, v)) {
        diccionario[v] = siguiente++;
        valoresNuevos++;
      }
      fila.valores[c] = String(diccionario[v]);
    }
  }

  return {
    tabla: { ...tabla, filas },
    diccionario,
    columnasCodificadas: codificadas.map((c) => tabla.ids[c]),
    valoresNuevos,
  };
}

/** El diccionario como CSV (valor;codigo), ordenado por código. */
export function diccionarioACsv(d: Diccionario): string {
  const comillas = (t: string) => (/[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
  const filas = Object.entries(d)
    .sort((a, b) => a[1] - b[1])
    .map(([valor, codigo]) => `${comillas(valor)};${codigo}`);
  return ['valor;codigo', ...filas].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Las dos fases juntas
// ---------------------------------------------------------------------------

export interface Preparacion {
  /** Operaciones del procesado de características (3.1.1), en orden. */
  operaciones: Operacion[];
  /** Diccionario de entrada de la codificación (3.1.2). Puede estar vacío. */
  diccionario: Diccionario;
}

/** Sin procesado ni diccionario: la tabla pasa tal cual (salvo codificar lo que sea texto). */
export const SIN_PREPARACION: Preparacion = { operaciones: [], diccionario: {} };

export interface ResultadoPreparacion extends ResultadoCodificacion {
  /** Características que ha añadido el procesado. */
  columnasNuevas: string[];
}

/** Procesado (3.1.1) y después codificación (3.1.2), como en la Fig. 1. */
export function prepararCaracteristicas(
  tabla: TablaPivotada,
  p: Preparacion,
): ResultadoPreparacion {
  const error = validarOperaciones(p.operaciones, tabla.columnaTimestamp, tabla.ids);
  if (error) {
    throw new Error(error);
  }
  const errorDiccionario = validarDiccionario(p.diccionario);
  if (errorDiccionario) {
    throw new Error(errorDiccionario);
  }
  const procesada = procesarCaracteristicas(tabla, p.operaciones);
  const antes = new Set(tabla.ids);
  return {
    ...codificar(procesada, p.diccionario),
    columnasNuevas: procesada.ids.filter((id) => !antes.has(id)),
  };
}

/**
 * Lee un diccionario en el CSV que genera diccionarioACsv (valor;codigo, con
 * cabecera). Lanza un Error con un mensaje entendible si no tiene ese formato.
 */
export function leerDiccionarioCsv(texto: string): Diccionario {
  const { data } = Papa.parse<string[]>(texto.replace(/^﻿/, ''), {
    delimiter: ';',
    skipEmptyLines: true,
  });
  const [cabecera, ...filas] = data;
  if (!cabecera || cabecera[0]?.trim() !== 'valor' || cabecera[1]?.trim() !== 'codigo') {
    throw new Error('El diccionario debe ser un CSV con la cabecera "valor;codigo".');
  }
  const d: Diccionario = {};
  for (const [i, fila] of filas.entries()) {
    const codigo = Number(fila[1]);
    if (fila.length < 2 || fila[1].trim() === '' || !Number.isFinite(codigo)) {
      throw new Error(`Fila ${i + 2} del diccionario: el código debe ser un número.`);
    }
    if (Object.hasOwn(d, fila[0])) {
      throw new Error(`El valor "${fila[0]}" sale dos veces en el diccionario.`);
    }
    d[fila[0]] = codigo;
  }
  const error = validarDiccionario(d);
  if (error) {
    throw new Error(error);
  }
  return d;
}
