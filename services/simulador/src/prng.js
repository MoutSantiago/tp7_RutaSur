/**
 * Generador pseudoaleatorio con semilla (mulberry32).
 * La misma semilla produce exactamente la misma secuencia de valores, lo que
 * permite repetir una corrida del simulador de forma idéntica.
 *
 * @example
 * const prng = crearPrng(42);
 * prng.siguiente(); // siempre el mismo primer valor para la semilla 42
 */

/**
 * Generador pseudoaleatorio determinista.
 * @typedef {object} Prng
 * @property {() => number} siguiente Próximo número en [0, 1).
 * @property {(min: number, max: number) => number} entero Entero uniforme en [min, max] inclusive.
 * @property {(probabilidad: number) => boolean} chance Verdadero con la probabilidad dada.
 * @property {<T>(opciones: Array<{valor: T, peso: number}>) => T} elegirPonderado
 *   Elige un valor según pesos relativos (no necesitan sumar 1).
 * @property {() => number} estadoActual Estado interno del generador (para depuración).
 */

/**
 * Crea un PRNG determinista a partir de una semilla entera.
 * @param {number} semilla Semilla del generador (entero de 32 bits sin signo).
 * @returns {Prng} Generador determinista.
 * @throws {Error} Si la semilla no es un entero válido.
 * @example
 * const prng = crearPrng(1234);
 * if (prng.chance(0.1)) console.log('10% de las veces');
 */
export function crearPrng(semilla) {
  if (!Number.isInteger(semilla)) {
    throw new Error(`La semilla debe ser un entero; recibido: ${semilla}`);
  }
  let estado = semilla >>> 0;

  /**
   * Avanza el generador y devuelve el próximo valor en [0, 1).
   * @returns {number} Valor pseudoaleatorio uniforme en [0, 1).
   */
  function siguiente() {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Devuelve un entero uniforme en el rango cerrado indicado.
   * @param {number} min Cota inferior inclusive.
   * @param {number} max Cota superior inclusive.
   * @returns {number} Entero en [min, max].
   */
  function entero(min, max) {
    return min + Math.floor(siguiente() * (max - min + 1));
  }

  /**
   * Devuelve verdadero con la probabilidad indicada.
   * @param {number} probabilidad Probabilidad entre 0 y 1.
   * @returns {boolean} Resultado del sorteo.
   */
  function chance(probabilidad) {
    return siguiente() < probabilidad;
  }

  /**
   * Elige un valor de una lista ponderada.
   * @template T
   * @param {Array<{valor: T, peso: number}>} opciones Opciones con peso relativo.
   * @returns {T} Valor elegido.
   * @throws {Error} Si la lista está vacía o los pesos no son positivos.
   */
  function elegirPonderado(opciones) {
    const total = opciones.reduce((suma, o) => suma + o.peso, 0);
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error('Las opciones ponderadas deben tener peso total positivo');
    }
    let tiro = siguiente() * total;
    for (const opcion of opciones) {
      tiro -= opcion.peso;
      if (tiro < 0) return opcion.valor;
    }
    return opciones[opciones.length - 1].valor;
  }

  return { siguiente, entero, chance, elegirPonderado, estadoActual: () => estado };
}
