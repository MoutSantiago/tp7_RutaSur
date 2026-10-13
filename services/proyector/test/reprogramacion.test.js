import test from 'node:test';
import assert from 'node:assert/strict';
import { crearEventoEstado, crearEventoReprogramacion } from '@rutasur/shared';
import {
  aplicarEventoAEstado,
  aplicarReprogramacion,
  RESULTADOS_REDUCCION,
} from '../src/reductor.js';

const DIMS = { hubId: 'HUB-1', zonaId: 'ZONA-SUR', repartidorId: 'REP-1' };

/**
 * Crea un documento de envío proyectado hasta el fallo del primer intento.
 * @returns {import('../src/reductor.js').DocumentoEnvio} Documento con un fallo aplicado.
 */
function documentoConFallo() {
  /** @type {import('../src/reductor.js').DocumentoEnvio | null} */
  let doc = null;
  /**
   * Aplica un estado al documento acumulado.
   * @param {number} secuencia Secuencia del evento.
   * @param {string} tipo Tipo de estado.
   * @param {Record<string, unknown>} [extra] Campos extra.
   * @returns {void}
   */
  const aplicar = (secuencia, tipo, extra = {}) => {
    const resultado = aplicarEventoAEstado(
      doc,
      crearEventoEstado({
        shipmentId: 'ENV-000001',
        secuencia,
        tipo,
        ocurridoEn: new Date(Date.parse('2026-10-12T10:00:00Z') + secuencia * 3600000).toISOString(),
        ...DIMS,
        ...extra,
      }),
    );
    assert.equal(resultado.resultado, RESULTADOS_REDUCCION.APLICADO);
    assert.ok(resultado.documento);
    doc = resultado.documento;
  };
  aplicar(1, 'CREADO');
  aplicar(5, 'ENTREGA_FALLIDA', { motivo: 'AUSENTE', intento: 1 });
  return /** @type {import('../src/reductor.js').DocumentoEnvio} */ (/** @type {unknown} */ (doc));
}

/**
 * Crea un evento de reprogramación para la prueba.
 * @param {Record<string, unknown>} extra Campos del evento.
 * @returns {import('@rutasur/shared/src/eventos/tipos.js').EventoReprogramacion} Evento creado.
 */
function reprogramacion(extra) {
  return crearEventoReprogramacion(
    /** @type {import('@rutasur/shared/src/eventos/fabrica.js').DatosBase & { resultado: string, motivo: string, intento: number, nuevoIntentoEn?: string, franja?: string }} */ ({
      shipmentId: 'ENV-000001',
      secuencia: 5,
      ocurridoEn: '2026-10-12T16:00:00Z',
      ...DIMS,
      ...extra,
    }),
  );
}

test('proyector: REPROGRAMADO se registra en el historial sin cambiar el estado', () => {
  const doc = documentoConFallo();
  const { resultado, documento } = aplicarReprogramacion(
    doc,
    reprogramacion({
      resultado: 'REPROGRAMADO',
      motivo: 'AUSENTE',
      intento: 2,
      nuevoIntentoEn: '2026-10-13T09:00:00Z',
      franja: 'AM',
    }),
  );
  assert.equal(resultado, RESULTADOS_REDUCCION.APLICADO);
  assert.ok(documento);
  assert.equal(documento.estado, 'ENTREGA_FALLIDA');
  assert.equal(documento.intentos, 2);
  const entrada = documento.historial[documento.historial.length - 1];
  assert.equal(entrada.tipo, 'REPROGRAMACION:REPROGRAMADO');
  assert.equal(entrada.nuevoIntentoEn, '2026-10-13T09:00:00Z');
  assert.equal(entrada.franja, 'AM');
  assert.equal(documento.ultimaSecuencia, 5, 'las reprogramaciones no mueven ultimaSecuencia');
});

test('proyector: RETENIDO y DEVOLUCION cambian el estado derivado', () => {
  const doc = documentoConFallo();

  const retenido = aplicarReprogramacion(
    doc,
    reprogramacion({ resultado: 'RETENIDO', motivo: 'DIRECCION_INCORRECTA', intento: 1 }),
  );
  assert.ok(retenido.documento);
  assert.equal(retenido.documento.estado, 'RETENIDO');

  const devolucion = aplicarReprogramacion(
    doc,
    reprogramacion({ resultado: 'DEVOLUCION', motivo: 'RECHAZADO', intento: 1 }),
  );
  assert.ok(devolucion.documento);
  assert.equal(devolucion.documento.estado, 'DEVOLUCION');
});

test('proyector: la misma reprogramación no se duplica en el historial', () => {
  const doc = documentoConFallo();
  const evento = reprogramacion({
    resultado: 'REPROGRAMADO',
    motivo: 'AUSENTE',
    intento: 2,
    nuevoIntentoEn: '2026-10-13T09:00:00Z',
    franja: 'AM',
  });
  const primero = aplicarReprogramacion(doc, evento);
  assert.ok(primero.documento);
  const segundo = aplicarReprogramacion(primero.documento, evento);
  assert.equal(segundo.resultado, RESULTADOS_REDUCCION.DESCARTADO_POR_ORDEN);
  assert.equal(segundo.documento, null);
  assert.equal(primero.documento.historial.length, 3);
});

test('proyector: una reprogramación sin envío existente falla con error explícito', () => {
  assert.throws(
    () =>
      aplicarReprogramacion(
        null,
        reprogramacion({ resultado: 'RETENIDO', motivo: 'DIRECCION_INCORRECTA', intento: 1 }),
      ),
    /No existe el envío/,
  );
});
