/**
 * Planificador de defectos de publicación (lógica pura).
 *
 * Dada la lista ordenada de eventos de estado de un envío, aplica las
 * probabilidades configuradas de:
 * - duplicado (republica el mismo mensaje),
 * - fuera de orden (intercambia dos eventos consecutivos del mismo envío),
 * - malformado (el mensaje viaja como una cadena inválida, para ejercitar la DLQ).
 */

/**
 * Publicación planificada de un mensaje.
 * @typedef {object} Publicacion
 * @property {string} clave Clave de partición (shipmentId, o 'desconocido' si el mensaje es malformado).
 * @property {unknown} valor Valor a publicar: evento objeto o cadena malformada.
 * @property {string} paraQue Etiqueta del defecto aplicado ('normal' | 'duplicado' | 'malformado').
 */

/**
 * Configuración de probabilidades de defectos.
 * @typedef {object} ProbabilidadesDefecto
 * @property {number} duplicado Probabilidad de republicar un mensaje.
 * @property {number} fueraDeOrden Probabilidad de intercambiar dos eventos consecutivos.
 * @property {number} malformado Probabilidad de enviar un mensaje inválido.
 */

/**
 * Planifica las publicaciones de los eventos de un envío aplicando defectos.
 * El plan resultante conserva los desajustes en forma determinista para una
 * semilla dada (el PRNG decide todo).
 * @param {object} opciones Opciones del plan.
 * @param {import('./prng.js').Prng} opciones.prng Generador aleatorio.
 * @param {ProbabilidadesDefecto} opciones.probabilidades Probabilidades de cada defecto.
 * @param {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado[]} opciones.eventos Eventos de estado en orden correcto.
 * @returns {Publicacion[]} Plan de publicación (puede tener más mensajes o cambiar el orden).
 * @throws {Error} Si la lista de eventos está vacía.
 */
export function planificarPublicaciones({ prng, probabilidades, eventos }) {
  if (eventos.length === 0) {
    throw new Error('Se requiere al menos un evento para planificar publicaciones');
  }

  // 1. Malformados: reemplazar el contenido por una cadena inválida.
  const mensajes = eventos.map((evento) =>
    prng.chance(probabilidades.malformado)
      ? /** @type {Publicacion} */ ({
          clave: evento.shipmentId,
          valor: `{"mensaje":"malformado","eventId":"${evento.eventId}"`,
          paraQue: 'malformado',
        })
      : /** @type {Publicacion} */ ({ clave: evento.shipmentId, valor: evento, paraQue: 'normal' }),
  );

  // 2. Fuera de orden: un intercambio de dos mensajes válidos consecutivos.
  if (
    mensajes.length >= 2 &&
    mensajes.every((m) => m.paraQue !== 'malformado') &&
    prng.chance(probabilidades.fueraDeOrden)
  ) {
    const i = prng.entero(0, mensajes.length - 2);
    const j = i + 1;
    [mensajes[i].valor, mensajes[j].valor] = [mensajes[j].valor, mensajes[i].valor];
  }

  // 3. Duplicados: republicar algunos mensajes inmediatamente después.
  /** @type {Publicacion[]} */
  const plan = [];
  for (const mensaje of mensajes) {
    plan.push(mensaje);
    if (prng.chance(probabilidades.duplicado)) {
      plan.push({ ...mensaje, paraQue: 'duplicado' });
    }
  }
  return plan;
}
