/**
 * Configuración del simulador: variables de entorno validadas al arrancar.
 * Extiende la configuración común de servicios con los parámetros de la tabla
 * de la especificación.
 */

import { cargarConfiguracion, ErrorConfiguracion, MOTIVOS_FALLO } from '@rutasur/shared';
import { FACTOR_ACELERACION_POR_DEFECTO } from './reloj.js';

/** @readonly bases de las zonas con velocidad de fallo por defecto (5%, 15%, 30%). */
const ZONAS_POR_DEFECTO = Object.freeze([
  { zonaId: 'ZONA-NORTE', tasaFallo: 0.05 },
  { zonaId: 'ZONA-CENTRO', tasaFallo: 0.15 },
  { zonaId: 'ZONA-SUR', tasaFallo: 0.3 },
]);

/** @readonly hubs por defecto. */
const HUBS = Object.freeze(['HUB-1', 'HUB-2', 'HUB-3']);

/**
 * Configuración completa del simulador.
 * @typedef {object} ConfigSimulador
 * @property {import('@rutasur/shared').Configuracion} servicio Configuración común del servicio.
 * @property {number} enviosPorMinuto Envíos nuevos por minuto real (SIM_ENVIOS_POR_MINUTO); 0 = sin flujo continuo.
 * @property {number} factorAceleracion Factor de aceleración (SIM_FACTOR_ACELERACION).
 * @property {number} semilla Semilla fija del PRNG (SIM_SEMILLA).
 * @property {number} enviosTotal Envíos a generar en total; 0 = infinito (SIM_ENVIOS_TOTAL).
 * @property {Zona[]} zonas Zonas de entrega con tasa de fallo.
 * @property {string[]} hubs Identificadores de hubs.
 * @property {number} repartidoresPorZona Cantidad de repartidores por zona.
 * @property {Array<{valor: string, peso: number}>} motivosFalla Distribución ponderada de motivos.
 * @property {number} probabilidadDemoraHub Probabilidad de demora en hub (SIM_DEMORA_HUB).
 * @property {import('./defectos.js').ProbabilidadesDefecto} probabilidades Defectos de publicación.
 */

/** @typedef {import('./cicloVida.js').Zona} Zona */

/**
 * Lee un número decimal del entorno con validación de rango.
 * @param {NodeJS.ProcessEnv} env Variables de entorno.
 * @param {string} nombre Nombre de la variable.
 * @param {number} porDefecto Valor por defecto.
 * @param {object} rango Rango aceptado.
 * @param {number} rango.min Mínimo inclusive.
 * @param {number} rango.max Máximo inclusive.
 * @returns {number} Valor validado.
 * @throws {import('@rutasur/shared').ErrorConfiguracion} Si el valor está fuera de rango o no es numérico.
 */
function leerNumero(env, nombre, porDefecto, { min, max }) {
  const crudo = env[nombre];
  if (crudo === undefined) return porDefecto;
  const valor = Number(crudo);
  if (!Number.isFinite(valor) || valor < min || valor > max) {
    throw new ErrorConfiguracion([`${nombre} debe ser un número entre ${min} y ${max}`]);
  }
  return valor;
}

/**
 * Carga y valida la configuración completa del simulador.
 * @param {object} [opciones] Opciones.
 * @param {NodeJS.ProcessEnv} [opciones.env] Variables de entorno (por defecto process.env).
 * @returns {ConfigSimulador} Configuración validada.
 * @throws {import('@rutasur/shared').ErrorConfiguracion} Si algún parámetro es inválido.
 * @example
 * const config = cargarConfigSimulador();
 * const prng = crearPrng(config.semilla);
 */
export function cargarConfigSimulador({ env = process.env } = {}) {
  const servicio = cargarConfiguracion({ servicio: 'simulador', env });

  const zonas = ZONAS_POR_DEFECTO.map(({ zonaId, tasaFallo }) => ({
    zonaId,
    tasaFallo: leerNumero(env, `SIM_FALLO_${zonaId.replace('ZONA-', '')}`, tasaFallo, {
      min: 0,
      max: 1,
    }),
  }));

  const motivosFalla = [
    { valor: 'AUSENTE', peso: leerNumero(env, 'SIM_MOTIVO_AUSENTE', 0.6, { min: 0, max: 1 }) },
    {
      valor: 'DIRECCION_INCORRECTA',
      peso: leerNumero(env, 'SIM_MOTIVO_DIRECCION', 0.2, { min: 0, max: 1 }),
    },
    { valor: 'RECHAZADO', peso: leerNumero(env, 'SIM_MOTIVO_RECHAZADO', 0.15, { min: 0, max: 1 }) },
    {
      valor: 'ZONA_INACCESIBLE',
      peso: leerNumero(env, 'SIM_MOTIVO_ZONA', 0.05, { min: 0, max: 1 }),
    },
  ].filter((m) => MOTIVOS_FALLO.includes(m.valor));

  return {
    servicio,
    enviosPorMinuto: leerNumero(env, 'SIM_ENVIOS_POR_MINUTO', 20, { min: 0, max: 100000 }),
    factorAceleracion: leerNumero(env, 'SIM_FACTOR_ACELERACION', FACTOR_ACELERACION_POR_DEFECTO, {
      min: 0.0001,
      max: 1000000,
    }),
    semilla: leerNumero(env, 'SIM_SEMILLA', 42, { min: 0, max: 4294967295 }),
    enviosTotal: leerNumero(env, 'SIM_ENVIOS_TOTAL', 0, { min: 0, max: 100000000 }),
    zonas,
    hubs: [...HUBS],
    repartidoresPorZona: leerNumero(env, 'SIM_REPARTIDORES_ZONA', 40, { min: 1, max: 100000 }),
    motivosFalla,
    probabilidadDemoraHub: leerNumero(env, 'SIM_DEMORA_HUB', 0.1, { min: 0, max: 1 }),
    probabilidades: {
      duplicado: leerNumero(env, 'SIM_DUPLICADO', 0.02, { min: 0, max: 1 }),
      fueraDeOrden: leerNumero(env, 'SIM_FUERA_ORDEN', 0.02, { min: 0, max: 1 }),
      malformado: leerNumero(env, 'SIM_MALFORMADO', 0.01, { min: 0, max: 1 }),
    },
  };
}
