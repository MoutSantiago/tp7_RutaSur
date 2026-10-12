/**
 * Esquemas JSON de los eventos de RutaSur y validadores compilados con Ajv.
 * Cada topic tiene un esquema propio que extiende los campos comunes.
 *
 * @example
 * const r = validarEvento(TOPICS.ESTADOS, evento);
 * if (!r.valido) console.error(r.errores);
 */
import Ajv from 'ajv';
import {
  TOPICS,
  ESTADOS_ENVIO,
  MOTIVOS_FALLO,
  PRIORIDADES_ALERTA,
  REGLAS_SLA,
  RESULTADOS_REPROGRAMACION,
  CANALES_NOTIFICACION,
} from '../constantes.js';

/**
 * Resultado de validar un evento contra su esquema.
 * @typedef {object} ResultadoValidacion
 * @property {boolean} valido Verdadero si el evento cumple el esquema.
 * @property {string[]} errores Lista de errores legibles; vacía si es válido.
 */

const ID_RUTASUR = '^[A-Z][A-Z0-9_-]{1,31}$';

/** @readonly propiedades comunes a todo evento del sistema. */
const PROPIEDADES_COMUNES = Object.freeze({
  eventId: { type: 'string', minLength: 1 },
  shipmentId: { type: 'string', pattern: ID_RUTASUR },
  ocurridoEn: { type: 'string', format: 'date-time' },
  secuencia: { type: 'integer', minimum: 1 },
  hubId: { type: 'string', pattern: ID_RUTASUR },
  zonaId: { type: 'string', pattern: ID_RUTASUR },
  repartidorId: { type: 'string', pattern: ID_RUTASUR },
  version: { type: 'integer', minimum: 1 },
});

/** @readonly campos comunes obligatorios. */
const REQUERIDOS_COMUNES = Object.freeze([
  'eventId',
  'shipmentId',
  'tipo',
  'ocurridoEn',
  'secuencia',
  'hubId',
  'zonaId',
  'repartidorId',
  'version',
]);

/**
 * Construye un esquema de evento a partir de los campos comunes.
 * @param {string} id Identificador `$id` del esquema.
 * @param {Record<string, object>} propiedadesExtra Propiedades específicas del topic.
 * @param {string[]} requeridosExtra Campos específicos obligatorios.
 * @returns {object} Esquema JSON Schema del evento.
 */
function construirEsquema(id, propiedadesExtra, requeridosExtra) {
  return {
    $id: id,
    type: 'object',
    properties: { ...PROPIEDADES_COMUNES, ...propiedadesExtra },
    required: [...REQUERIDOS_COMUNES, ...requeridosExtra],
    additionalProperties: false,
  };
}

/** @readonly esquemas JSON por topic. */
export const ESQUEMAS = Object.freeze({
  [TOPICS.ESTADOS]: construirEsquema(
    'rutasur/evento-estado',
    {
      tipo: { enum: ESTADOS_ENVIO },
      motivo: { enum: MOTIVOS_FALLO },
      intento: { type: 'integer', minimum: 1 },
    },
    [],
  ),
  [TOPICS.PROMESAS]: construirEsquema(
    'rutasur/evento-promesa',
    {
      tipo: { const: 'PROMESA_DEFINIDA' },
      venceEn: { type: 'string', format: 'date-time' },
      franja: { type: 'string', minLength: 1 },
    },
    ['venceEn', 'franja'],
  ),
  [TOPICS.REPROGRAMACIONES]: construirEsquema(
    'rutasur/evento-reprogramacion',
    {
      tipo: { const: 'REPROGRAMACION_DECIDIDA' },
      resultado: { enum: RESULTADOS_REPROGRAMACION },
      motivo: { enum: MOTIVOS_FALLO },
      intento: { type: 'integer', minimum: 1 },
      nuevoIntentoEn: { type: 'string', format: 'date-time' },
      franja: { type: 'string', minLength: 1 },
    },
    ['resultado', 'motivo', 'intento'],
  ),
  [TOPICS.ALERTAS_SLA]: construirEsquema(
    'rutasur/evento-alerta-sla',
    {
      tipo: { const: 'ALERTA_SLA' },
      regla: { enum: REGLAS_SLA },
      prioridad: { enum: PRIORIDADES_ALERTA },
      estadoAlerta: { enum: ['ABIERTA', 'CERRADA'] },
      venceEn: { type: 'string', format: 'date-time' },
    },
    ['regla', 'prioridad', 'estadoAlerta', 'venceEn'],
  ),
  [TOPICS.NOTIFICACIONES]: construirEsquema(
    'rutasur/evento-notificacion',
    {
      tipo: { const: 'NOTIFICACION_ENVIADA' },
      canal: { enum: CANALES_NOTIFICACION },
      asunto: { type: 'string', minLength: 1 },
      cuerpo: { type: 'string', minLength: 1 },
      eventoOrigenId: { type: 'string', minLength: 1 },
    },
    ['canal', 'asunto', 'cuerpo'],
  ),
});

const ajv = new Ajv({ allErrors: true });
ajv.addFormat('date-time', {
  type: 'string',
  /**
   * Valida que un valor sea una fecha ISO 8601 parseable.
   * @param {unknown} valor Valor a chequear.
   * @returns {boolean} Verdadero si es una fecha válida.
   */
  validate: (valor) => typeof valor === 'string' && !Number.isNaN(Date.parse(valor)),
});

/** @type {Record<string, import('ajv').ValidateFunction>} validadores compilados por topic. */
const VALIDADORES = Object.fromEntries(
  Object.entries(ESQUEMAS).map(([topico, esquema]) => [topico, ajv.compile(esquema)]),
);

/**
 * Valida un evento contra el esquema del topic indicado.
 * @param {string} topico Topic del que proviene el evento.
 * @param {unknown} evento Evento a validar.
 * @returns {ResultadoValidacion} Resultado de la validación.
 * @throws {Error} Si el topic no tiene esquema registrado.
 */
export function validarEvento(topico, evento) {
  const validar = VALIDADORES[topico];
  if (!validar) {
    throw new Error(`No hay esquema registrado para el topic "${topico}"`);
  }
  const valido = /** @type {boolean} */ (validar(evento));
  const errores = valido
    ? []
    : /** @type {Array<{instancePath?: string, message?: string}>} */ (validar.errors ?? []).map(
        (error) => `${error.instancePath || '/'} ${error.message ?? 'error desconocido'}`,
      );
  return { valido, errores };
}
