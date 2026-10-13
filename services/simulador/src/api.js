/**
 * API HTTP mínima de control del simulador.
 *
 * Es solo un canal de comando desde el panel de demo (ver docs/DECISIONES.md):
 * no lo usan otros servicios de negocio, que se comunican únicamente por Kafka.
 */

import { createServer } from 'node:http';

/**
 * Controlador de la API de demo.
 * @typedef {object} ControladorSimulador
 * @property {(nombre: string) => Promise<{envios: string[], descripcion: string}>} dispararEscenario
 *   Genera y despacha los envíos de un escenario.
 * @property {() => Promise<{clave: string}>} inyectarMalformado Publica un mensaje malformado en envios.estados.
 * @property {() => Record<string, unknown>} salud Estado básico del servicio.
 */

/**
 * Escribe una respuesta JSON.
 * @param {import('node:http').ServerResponse} res Respuesta HTTP.
 * @param {number} codigo Código de estado.
 * @param {unknown} cuerpo Objeto a serializar.
 * @returns {void}
 */
function responderJson(res, codigo, cuerpo) {
  res.writeHead(codigo, { 'content-type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}

/**
 * Crea el servidor HTTP de control del simulador.
 * @param {object} opciones Opciones.
 * @param {number} opciones.puerto Puerto de escucha (SIM_HTTP_PUERTO).
 * @param {ControladorSimulador} opciones.controlador Operaciones disponibles.
 * @param {import('@rutasur/shared').Logger} opciones.logger Logger estructurado.
 * @returns {import('node:http').Server} Servidor listo para escuchar.
 */
export function crearApiControl({ puerto, controlador, logger }) {
  void puerto; // el listen lo hace quien compone (capa de I/O del servicio)
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/salud') {
        responderJson(res, 200, { ok: true, ...controlador.salud() });
        return;
      }
      if (req.method === 'POST' && url.pathname.startsWith('/escenarios/')) {
        const nombre = url.pathname.slice('/escenarios/'.length);
        const resultado = await controlador.dispararEscenario(nombre);
        responderJson(res, 202, { escenario: nombre, ...resultado });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/eventos/malformado') {
        const resultado = await controlador.inyectarMalformado();
        responderJson(res, 202, { inyectado: true, ...resultado });
        return;
      }
      responderJson(res, 404, { error: `Ruta no encontrada: ${req.method} ${url.pathname}` });
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      const codigo = mensaje.includes('desconocido') ? 404 : 500;
      logger.warn('Error en la API de control', { error: mensaje, ruta: url.pathname });
      responderJson(res, codigo, { error: mensaje });
    }
  });
}
