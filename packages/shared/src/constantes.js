/**
 * Constantes de dominio de RutaSur: topics, grupos de consumidores, estados,
 * motivos de fallo, prioridades y reglas de SLA. Fuente: docs/spec.md.
 */

/** @readonly nombres de los topics de Kafka del catálogo de eventos. */
export const TOPICS = Object.freeze({
  ESTADOS: 'envios.estados',
  PROMESAS: 'envios.promesas',
  REPROGRAMACIONES: 'envios.reprogramaciones',
  ALERTAS_SLA: 'alertas.sla',
  NOTIFICACIONES: 'notificaciones.enviadas',
  DLQ_ESTADOS: 'envios.estados.dlq',
});

/** @readonly grupos de consumidores de Kafka (uno por servicio). */
export const GRUPOS = Object.freeze({
  PROYECTOR: 'proyector',
  NOTIFICACIONES: 'notificaciones',
  REPROGRAMACION: 'reprogramacion',
  MONITOR_SLA: 'monitor-sla',
  ANALITICA: 'analitica',
});

/** @readonly estados del ciclo de vida de un envío (topic envios.estados). */
export const ESTADOS_ENVIO = Object.freeze([
  'CREADO',
  'INGRESADO_HUB',
  'CLASIFICADO',
  'EN_REPARTO',
  'ENTREGADO',
  'ENTREGA_FALLIDA',
]);

/** @readonly motivos posibles de una entrega fallida. */
export const MOTIVOS_FALLO = Object.freeze([
  'AUSENTE',
  'DIRECCION_INCORRECTA',
  'RECHAZADO',
  'ZONA_INACCESIBLE',
]);

/** @readonly prioridades de una alerta de SLA. */
export const PRIORIDADES_ALERTA = Object.freeze(['MEDIA', 'ALTA', 'CRITICA']);

/** @readonly reglas del monitor de SLA que disparan alertas. */
export const REGLAS_SLA = Object.freeze([
  'SIN_INGRESO',
  'SIN_SALIDA',
  'FALLO_DIA_LIMITE',
  'VENCIDO',
]);

/** @readonly resultados posibles de una reprogramación. */
export const RESULTADOS_REPROGRAMACION = Object.freeze([
  'REPROGRAMADO',
  'RETENIDO',
  'DEVOLUCION',
]);

/** @readonly canales simulados de notificación al destinatario. */
export const CANALES_NOTIFICACION = Object.freeze(['EMAIL', 'SMS', 'PUSH']);

/** @readonly versión actual del esquema de eventos. */
export const VERSION_ESQUEMA = 1;

/** @readonly prefijo de identificadores de envío generados por el simulador. */
export const PREFIJO_SHIPMENT = 'ENV';
