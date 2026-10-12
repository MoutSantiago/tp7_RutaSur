/**
 * Punto de entrada del paquete compartido de RutaSur.
 * Reexporta constantes, esquemas, factorías de eventos, clientes Kafka y
 * helpers de MongoDB, configuración, logging y apagado ordenado.
 */

export * from './constantes.js';
export * from './eventos/esquemas.js';
export * from './eventos/fabrica.js';
export * from './kafka/productor.js';
export * from './kafka/consumidor.js';
export * from './mongo/conexion.js';
export * from './mongo/idempotencia.js';
export * from './config.js';
export * from './logger.js';
export * from './apagado.js';

/** @readonly versión actual del paquete. */
export const VERSION = '0.1.0';
