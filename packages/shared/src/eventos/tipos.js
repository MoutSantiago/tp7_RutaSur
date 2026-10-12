/**
 * Typedefs JSDoc de los eventos de RutaSur. No genera código: solo tipos para
 * el chequeo estático con checkJs y para autocompletado en editores.
 *
 * Cada typedef lista explícitamente los campos comunes (los typedefs parciales
 * con intersecciones no se resuelven de forma fiable en checkJs).
 */

/**
 * Evento de cambio de estado de un envío (topic `envios.estados`).
 * @typedef {object} EventoEstado
 * @property {string} eventId Identificador único del evento.
 * @property {string} shipmentId Clave de partición y de correlación.
 * @property {string} tipo Estado del envío (CREADO, INGRESADO_HUB, ...).
 * @property {string} ocurridoEn Momento en que pasó en el mundo real (ISO 8601).
 * @property {number} secuencia Número creciente por envío.
 * @property {string} hubId Centro de distribución.
 * @property {string} zonaId Zona de entrega.
 * @property {string} repartidorId Repartidor asignado.
 * @property {number} version Versión del esquema del evento.
 * @property {string} [motivo] Motivo de la falla; obligatorio si tipo es ENTREGA_FALLIDA.
 * @property {number} [intento] Número de intento de entrega (1..3).
 */

/**
 * Evento de promesa de entrega (topic `envios.promesas`).
 * @typedef {object} EventoPromesa
 * @property {string} eventId Identificador único del evento.
 * @property {string} shipmentId Clave de partición y de correlación.
 * @property {string} tipo Siempre PROMESA_DEFINIDA.
 * @property {string} ocurridoEn Momento en que pasó en el mundo real (ISO 8601).
 * @property {number} secuencia Número creciente por envío.
 * @property {string} hubId Centro de distribución.
 * @property {string} zonaId Zona de entrega.
 * @property {string} repartidorId Repartidor asignado.
 * @property {number} version Versión del esquema del evento.
 * @property {string} venceEn Fecha límite prometida de entrega (ISO 8601).
 * @property {string} franja Franja horaria comprometida, p. ej. "AM" o "PM".
 */

/**
 * Evento de reprogramación (topic `envios.reprogramaciones`).
 * @typedef {object} EventoReprogramacion
 * @property {string} eventId Identificador único del evento.
 * @property {string} shipmentId Clave de partición y de correlación.
 * @property {string} tipo Siempre REPROGRAMACION_DECIDIDA.
 * @property {string} ocurridoEn Momento en que pasó en el mundo real (ISO 8601).
 * @property {number} secuencia Número creciente por envío.
 * @property {string} hubId Centro de distribución.
 * @property {string} zonaId Zona de entrega.
 * @property {string} repartidorId Repartidor asignado.
 * @property {number} version Versión del esquema del evento.
 * @property {string} resultado REPROGRAMADO, RETENIDO o DEVOLUCION.
 * @property {string} motivo Motivo de la entrega fallida que lo originó.
 * @property {number} intento Número de intento resultante.
 * @property {string} [nuevoIntentoEn] Momento del nuevo intento, si se reprogramó (ISO 8601).
 * @property {string} [franja] Franja del nuevo intento, si se reprogramó.
 */

/**
 * Evento de alerta de SLA (topic `alertas.sla`).
 * @typedef {object} EventoAlertaSla
 * @property {string} eventId Identificador único del evento.
 * @property {string} shipmentId Clave de partición y de correlación.
 * @property {string} tipo Siempre ALERTA_SLA.
 * @property {string} ocurridoEn Momento en que pasó en el mundo real (ISO 8601).
 * @property {number} secuencia Número creciente por envío.
 * @property {string} hubId Centro de distribución.
 * @property {string} zonaId Zona de entrega.
 * @property {string} repartidorId Repartidor asignado.
 * @property {number} version Versión del esquema del evento.
 * @property {string} regla Regla del monitor que disparó la alerta.
 * @property {string} prioridad MEDIA, ALTA o CRITICA.
 * @property {string} estadoAlerta ABIERTA o CERRADA.
 * @property {string} venceEn Vencimiento de la promesa asociada (ISO 8601).
 */

/**
 * Evento de notificación enviada (topic `notificaciones.enviadas`).
 * @typedef {object} EventoNotificacion
 * @property {string} eventId Identificador único del evento.
 * @property {string} shipmentId Clave de partición y de correlación.
 * @property {string} tipo Siempre NOTIFICACION_ENVIADA.
 * @property {string} ocurridoEn Momento en que pasó en el mundo real (ISO 8601).
 * @property {number} secuencia Número creciente por envío.
 * @property {string} hubId Centro de distribución.
 * @property {string} zonaId Zona de entrega.
 * @property {string} repartidorId Repartidor asignado.
 * @property {number} version Versión del esquema del evento.
 * @property {string} canal Canal simulado: EMAIL, SMS o PUSH.
 * @property {string} asunto Descripción breve del aviso.
 * @property {string} cuerpo Texto del aviso al destinatario.
 * @property {string} [eventoOrigenId] eventId del evento que originó el aviso.
 */

/**
 * Campos comunes a todo evento del sistema.
 * @typedef {EventoEstado | EventoPromesa | EventoReprogramacion | EventoAlertaSla | EventoNotificacion} EventoBase
 */

/**
 * Mensaje enviado a la DLQ cuando un evento no supera la validación.
 * @typedef {object} MensajeDlq
 * @property {string} motivoError Razón por la que el evento se consideró inválido.
 * @property {unknown} eventoOriginal Payload original (string o objeto ya parseado).
 * @property {string} consumidor Grupo de consumidores que detectó el problema.
 * @property {string} topicOrigen Topic del que provino el mensaje.
 * @property {number} particion Partición del mensaje original.
 * @property {string} offset Offset del mensaje original.
 * @property {string} enviadoEn Momento en que se envió a la DLQ (ISO 8601).
 */

export {};
