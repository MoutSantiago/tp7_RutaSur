/**
 * Punto de entrada del simulador de RutaSur.
 *
 * Genera el flujo continuo de envíos y atiende la API HTTP de control
 * (escenarios a pedido e inyección de eventos malformados). La generación de
 * eventos es lógica pura (`cicloVida.js`, `escenarios.js`, `defectos.js`);
 * este módulo solo orquesta la publicación en Kafka.
 */

import {
  TOPICS,
  crearLogger,
  crearProductor,
  registrarApagadoOrdenado,
} from '@rutasur/shared';
import { cargarConfigSimulador } from './config.js';
import { crearPrng } from './prng.js';
import { crearRelojSimulado, dormirSimulados } from './reloj.js';
import { generarCicloDeVida } from './cicloVida.js';
import { planificarPublicaciones } from './defectos.js';
import { generarEscenario, crearMensajeMalformado } from './escenarios.js';
import { crearApiControl } from './api.js';

/** Prefijo de los identificadores de envío generados. */
const PREFIJO_ENVIO = 'ENV';

/**
 * Genera un identificador de envío legible y correlativo.
 * @param {number} numero Número correlativo del envío (1 en adelante).
 * @returns {string} Identificador del envío, p. ej. ENV-000001.
 */
function crearShipmentId(numero) {
  return `${PREFIJO_ENVIO}-${String(numero).padStart(6, '0')}`;
}

/**
 * Publica un ciclo de vida completo: la promesa y luego cada estado a su
 * tiempo simulado (o sin espera si se pide, p. ej. la ráfaga).
 * @param {object} opciones Opciones de publicación.
 * @param {import('./cicloVida.js').CicloDeVida} opciones.ciclo Ciclo a publicar.
 * @param {import('./prng.js').Prng} opciones.prng Generador aleatorio (defectos de publicación).
 * @param {import('./defectos.js').ProbabilidadesDefecto} opciones.probabilidades Defectos.
 * @param {import('./reloj.js').RelojSimulado} opciones.reloj Reloj simulado.
 * @param {import('@rutasur/shared').ProductorEventos} opciones.productor Productor Kafka.
 * @param {import('@rutasur/shared').Logger} opciones.logger Logger estructurado.
 * @param {boolean} opciones.sinEspera Si es verdadero publica todo sin esperar tiempos.
 * @param {() => boolean} opciones.debeDetenerse Si el servicio está apagándose.
 * @returns {Promise<void>} Resuelve cuando se publicó todo el ciclo.
 */
export async function publicarCiclo({
  ciclo,
  prng,
  probabilidades,
  reloj,
  productor,
  logger,
  sinEspera,
  debeDetenerse,
}) {
  const logEnvio = logger.hijo({ shipmentId: ciclo.shipmentId });
  await productor.publicar({ topico: TOPICS.PROMESAS, evento: ciclo.promesa });

  const plan = planificarPublicaciones({ prng, probabilidades, eventos: ciclo.eventos });
  for (const publicacion of plan) {
    if (debeDetenerse()) return;
    if (!sinEspera) {
      const enMs =
        typeof publicacion.valor === 'object' && publicacion.valor !== null
          ? Date.parse(
              /** @type {import('@rutasur/shared/src/eventos/tipos.js').EventoEstado} */ (
                publicacion.valor
              ).ocurridoEn,
            )
          : 0;
      const esperaMs = enMs ? Math.max(0, enMs - reloj.ahoraSimulado()) : 0;
      if (esperaMs > 0) await dormirSimulados(reloj, esperaMs);
    }
    if (debeDetenerse()) return;
    await productor.publicarCrudo({
      topico: TOPICS.ESTADOS,
      clave: publicacion.clave,
      valor: publicacion.valor,
    });
  }
  logEnvio.info('Ciclo de envío publicado', {
    estadoFinal: ciclo.estadoFinal,
    intentos: ciclo.intentos,
  });
}

/**
 * Función principal del servicio: configura, conecta el productor, atiende la
 * API de control y dispara el flujo continuo de envíos hasta detenerse.
 * @returns {Promise<void>} Resuelve cuando el servicio termina de apagarse.
 */
async function main() {
  const config = cargarConfigSimulador();
  const logger = crearLogger({ servicio: 'simulador', nivel: config.servicio.logNivel });
  logger.info('Simulador iniciando', {
    enviosPorMinuto: config.enviosPorMinuto,
    factorAceleracion: config.factorAceleracion,
    semilla: config.semilla,
  });

  const productor = await crearProductor({
    brokers: config.servicio.kafkaBrokers,
    clientId: 'simulador',
    logger,
  });

  const prng = crearPrng(config.semilla);
  const reloj = crearRelojSimulado({ factor: config.factorAceleracion });
  let numeroEnvio = 0;
  let deteniendo = false;
  const debeDetenerse = () => deteniendo;

  /**
   * Genera y publica el ciclo del envío número n.
   * @param {number} n Número correlativo del envío.
   * @returns {Promise<void>} Resuelve cuando terminó de publicarse.
   */
  const ejecutarEnvio = (n) =>
    publicarCiclo({
      ciclo: generarCicloDeVida({
        prng,
        config,
        shipmentId: crearShipmentId(n),
        inicioMs: reloj.ahoraSimulado(),
      }),
      prng,
      probabilidades: config.probabilidades,
      reloj,
      productor,
      logger,
      sinEspera: false,
      debeDetenerse,
    });

  // Flujo continuo (0 = desactivado, solo escenarios por API).
  const intervaloMsReal = config.enviosPorMinuto > 0 ? 60000 / config.enviosPorMinuto : null;
  /** @type {NodeJS.Timeout | null} */
  const temporizador =
    intervaloMsReal === null
      ? null
      : setInterval(() => {
          numeroEnvio += 1;
          if (config.enviosTotal > 0 && numeroEnvio > config.enviosTotal) {
            if (temporizador) clearInterval(temporizador);
            return;
          }
          ejecutarEnvio(numeroEnvio).catch((error) =>
            logger.error('Falló el envío simulado', { envio: numeroEnvio, error }),
          );
        }, intervaloMsReal);

  // API de control (canal del panel de demo; no lo usan otros servicios).
  const puertoApi = Number(process.env.SIM_HTTP_PUERTO ?? 3010);
  const servidor = crearApiControl({
    puerto: puertoApi,
    logger,
    controlador: {
      salud: () => ({
        servicio: 'simulador',
        enviosGenerados: numeroEnvio,
        ahoraSimulado: new Date(reloj.ahoraSimulado()).toISOString(),
      }),

      async dispararEscenario(nombre) {
        const resultado = generarEscenario({
          nombre,
          prng,
          config,
          inicioMs: reloj.ahoraSimulado(),
          numeroBase: numeroEnvio + 1,
          crearShipmentId,
        });
        numeroEnvio += resultado.cantidadUsados;
        const sinEspera = nombre === 'rafaga';
        let indice = 0;
        for (const ciclo of resultado.ciclos) {
          const publicacion = publicarCiclo({
            ciclo,
            prng,
            probabilidades: config.probabilidades,
            reloj,
            productor,
            logger,
            sinEspera,
            debeDetenerse,
          }).catch((error) =>
            logger.error('Falló un envío de escenario', { shipmentId: ciclo.shipmentId, error }),
          );
          if (sinEspera) {
            indice += 1;
            // Cede el event loop cada 50 envíos para no acaparar el proceso.
            if (indice % 50 === 0) await new Promise((resolver) => setImmediate(resolver));
            continue;
          }
          await publicacion;
        }
        logger.info('Escenario disparado', {
          escenario: nombre,
          envios: resultado.ciclos.map((c) => c.shipmentId),
        });
        return {
          envios: resultado.ciclos.map((c) => c.shipmentId),
          descripcion: resultado.descripcion,
        };
      },

      async inyectarMalformado() {
        const mensaje = crearMensajeMalformado({
          shipmentId: crearShipmentId(numeroEnvio + 1),
        });
        await productor.publicarCrudo({
          topico: TOPICS.ESTADOS,
          clave: mensaje.clave,
          valor: mensaje.valor,
        });
        logger.info('Mensaje malformado inyectado', { clave: mensaje.clave });
        return { clave: mensaje.clave };
      },
    },
  });
  servidor.listen(puertoApi, () => {
    logger.info('API de control escuchando', { puerto: puertoApi });
  });

  registrarApagadoOrdenado({
    logger,
    pasos: [
      {
        nombre: 'temporizador',
        ejecutar: () => {
          deteniendo = true;
          if (temporizador) clearInterval(temporizador);
        },
      },
      {
        nombre: 'api-control',
        ejecutar: () =>
          new Promise((resolver, rechazar) =>
            servidor.close((error) => (error ? rechazar(error) : resolver(null))),
          ),
      },
      { nombre: 'productor-kafka', ejecutar: () => productor.cerrar() },
    ],
  });

  logger.info('Simulador en marcha', { intervaloMsReal, flujoContinuo: intervaloMsReal !== null });
}

await main();
