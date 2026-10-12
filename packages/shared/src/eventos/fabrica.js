/**
 * Factoría de eventos tipados de RutaSur. Crea eventos completos a partir de
 * datos mínimos y los valida contra el esquema de su topic antes de devolverlos.
 *
 * @example
 * const evento = crearEventoEstado({ shipmentId, tipo: 'CREADO', secuencia: 1, ...dimensiones });
 */
import { randomUUID } from 'node:crypto';
import { TOPICS, VERSION_ESQUEMA } from '../constantes.js';
import { validarEvento } from './esquemas.js';

/**
 * Datos mínimos que comparte toda creación de evento.
 * @typedef {object} DatosBase
 * @property {string} shipmentId Identificador del envío.
 * @property {number} secuencia Número de secuencia del envío.
 * @property {string} hubId Centro de distribución.
 * @property {string} zonaId Zona de entrega.
 * @property {string} repartidorId Repartidor asignado.
 * @property {string} [ocurridoEn] Momento del hecho (ISO 8601); por defecto, ahora.
 */

/**
 * Completa los campos comunes de un evento y lo valida contra su esquema.
 * @param {string} topico Topic destino del evento.
 * @param {string} tipo Tipo del evento.
 * @param {DatosBase} datos Datos base del evento.
 * @param {Record<string, unknown>} extras Campos específicos del tipo de evento.
 * @returns {import('./tipos.js').EventoBase} Evento completo y validado.
 * @throws {Error} Si el evento resultante no cumple el esquema del topic.
 */
function construirEvento(topico, tipo, datos, extras) {
  const evento = /** @type {import('./tipos.js').EventoBase} */ ({
    eventId: randomUUID(),
    shipmentId: datos.shipmentId,
    tipo,
    ocurridoEn: datos.ocurridoEn ?? new Date().toISOString(),
    secuencia: datos.secuencia,
    hubId: datos.hubId,
    zonaId: datos.zonaId,
    repartidorId: datos.repartidorId,
    version: VERSION_ESQUEMA,
    ...extras,
  });
  const resultado = validarEvento(topico, evento);
  if (!resultado.valido) {
    throw new Error(
      `Evento inválido para ${topico} (${tipo}): ${resultado.errores.join('; ')}`,
    );
  }
  return evento;
}

/**
 * Crea un evento de cambio de estado de un envío (`envios.estados`).
 * @param {DatosBase & { tipo: string, motivo?: string, intento?: number }} datos
 *   Datos del evento; `motivo` es obligatorio cuando el tipo es ENTREGA_FALLIDA.
 * @returns {import('./tipos.js').EventoEstado} Evento de estado validado.
 * @throws {Error} Si el evento no cumple el esquema.
 */
export function crearEventoEstado(datos) {
  const extras = /** @type {Record<string, unknown>} */ ({});
  if (datos.motivo !== undefined) extras.motivo = datos.motivo;
  if (datos.intento !== undefined) extras.intento = datos.intento;
  return /** @type {import('./tipos.js').EventoEstado} */ (
    construirEvento(TOPICS.ESTADOS, datos.tipo, datos, extras)
  );
}

/**
 * Crea un evento de promesa de entrega (`envios.promesas`).
 * @param {DatosBase & { venceEn: string, franja: string }} datos Datos de la promesa.
 * @returns {import('./tipos.js').EventoPromesa} Evento de promesa validado.
 * @throws {Error} Si el evento no cumple el esquema.
 */
export function crearEventoPromesa(datos) {
  return /** @type {import('./tipos.js').EventoPromesa} */ (
    construirEvento(TOPICS.PROMESAS, 'PROMESA_DEFINIDA', datos, {
      venceEn: datos.venceEn,
      franja: datos.franja,
    })
  );
}

/**
 * Crea un evento de decisión de reprogramación (`envios.reprogramaciones`).
 * @param {DatosBase & { resultado: string, motivo: string, intento: number, nuevoIntentoEn?: string, franja?: string }} datos
 *   Decisión tomada; `nuevoIntentoEn` y `franja` solo si el resultado es REPROGRAMADO.
 * @returns {import('./tipos.js').EventoReprogramacion} Evento de reprogramación validado.
 * @throws {Error} Si el evento no cumple el esquema.
 */
export function crearEventoReprogramacion(datos) {
  const extras = /** @type {Record<string, unknown>} */ ({
    resultado: datos.resultado,
    motivo: datos.motivo,
    intento: datos.intento,
  });
  if (datos.nuevoIntentoEn !== undefined) extras.nuevoIntentoEn = datos.nuevoIntentoEn;
  if (datos.franja !== undefined) extras.franja = datos.franja;
  return /** @type {import('./tipos.js').EventoReprogramacion} */ (
    construirEvento(TOPICS.REPROGRAMACIONES, 'REPROGRAMACION_DECIDIDA', datos, extras)
  );
}

/**
 * Crea un evento de alerta de SLA (`alertas.sla`).
 * @param {DatosBase & { regla: string, prioridad: string, estadoAlerta: string, venceEn: string }} datos
 *   Alerta emitida por el monitor.
 * @returns {import('./tipos.js').EventoAlertaSla} Evento de alerta validado.
 * @throws {Error} Si el evento no cumple el esquema.
 */
export function crearEventoAlertaSla(datos) {
  return /** @type {import('./tipos.js').EventoAlertaSla} */ (
    construirEvento(TOPICS.ALERTAS_SLA, 'ALERTA_SLA', datos, {
      regla: datos.regla,
      prioridad: datos.prioridad,
      estadoAlerta: datos.estadoAlerta,
      venceEn: datos.venceEn,
    })
  );
}

/**
 * Crea un evento de notificación enviada (`notificaciones.enviadas`).
 * @param {DatosBase & { canal: string, asunto: string, cuerpo: string, eventoOrigenId?: string }} datos
 *   Aviso simulado al destinatario.
 * @returns {import('./tipos.js').EventoNotificacion} Evento de notificación validado.
 * @throws {Error} Si el evento no cumple el esquema.
 */
export function crearEventoNotificacion(datos) {
  const extras = /** @type {Record<string, unknown>} */ ({
    canal: datos.canal,
    asunto: datos.asunto,
    cuerpo: datos.cuerpo,
  });
  if (datos.eventoOrigenId !== undefined) extras.eventoOrigenId = datos.eventoOrigenId;
  return /** @type {import('./tipos.js').EventoNotificacion} */ (
    construirEvento(TOPICS.NOTIFICACIONES, 'NOTIFICACION_ENVIADA', datos, extras)
  );
}
