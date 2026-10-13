'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * Documento de envío tal como llega de la vista MongoDB.
 * @typedef {import("../../lib/mongo.js").DocVista} EnvioVista
 */

/**
 * Panel de la torre de control: contadores por estado, cola de alertas
 * priorizada y últimos envíos, actualizados en vivo por SSE.
 * @param {object} props Props del componente.
 * @param {Record<string, number>} props.contadoresIniciales Contadores por estado (SSR).
 * @param {import("../../lib/mongo.js").DocVista[]} props.alertasIniciales Cola de alertas abierta (SSR).
 * @param {import("../../lib/mongo.js").DocVista[]} props.ultimosIniciales Últimos envíos actualizados (SSR).
 * @returns {import('react').ReactElement} Panel de la torre de control.
 */
export default function TorreControl({ contadoresIniciales, alertasIniciales, ultimosIniciales }) {
  /** @type {[Record<string, EnvioVista>, Function]} */
  const [enviosPorId, setEnvios] = useState(() => {
    const mapa = /** @type {Record<string, EnvioVista>} */ ({});
    for (const e of ultimosIniciales) {
      if (e.shipmentId) mapa[e.shipmentId] = e;
    }
    return mapa;
  });
  const [contadores, setContadores] = useState(contadoresIniciales);
  const [alertas, setAlertas] = useState(alertasIniciales);
  const [conectado, setConectado] = useState(false);

  useEffect(() => {
    // Mapa local con TODOS los envíos conocidos, para recalcular contadores.
    const conocidos = { ...enviosPorId };
    const fuente = new EventSource('/api/stream');
    fuente.onopen = () => setConectado(true);
    fuente.onerror = () => setConectado(false); // EventSource reintenta solo
    fuente.addEventListener('envio', (mensaje) => {
      const envio = JSON.parse(mensaje.data);
      const anterior = conocidos[envio.shipmentId];
      conocidos[envio.shipmentId] = envio;
      setEnvios((/** @type {Record<string, EnvioVista>} */ actual) => ({ ...actual, [envio.shipmentId]: envio }));
      setContadores((/** @type {Record<string, number>} */ actual) => {
        const siguientes = { ...actual };
        if (anterior?.estado && anterior.estado !== envio.estado) {
          siguientes[anterior.estado] = Math.max(0, (siguientes[anterior.estado] ?? 0) - 1);
        }
        if (!anterior || anterior.estado !== envio.estado) {
          siguientes[envio.estado] = (siguientes[envio.estado] ?? 0) + 1;
        }
        return siguientes;
      });
    });
    fuente.addEventListener('alerta', (mensaje) => {
      const alerta = JSON.parse(mensaje.data);
      setAlertas((/** @type {import("../../lib/mongo.js").DocVista[]} */ actual) => {
        const resto = actual.filter(
          (a) => !(a.shipmentId === alerta.shipmentId && a.regla === alerta.regla),
        );
        if (alerta.estado === 'CERRADA') return resto;
        return ordenarPorPrioridad([...resto, alerta]);
      });
    });
    return () => fuente.close();
  }, []);

  const ultimos = useMemo(
    () =>
      Object.values(enviosPorId)
        .sort((a, b) => String(b.ultimaActualizacion).localeCompare(String(a.ultimaActualizacion)))
        .slice(0, 15),
    [enviosPorId],
  );

  return (
    <>
      <section className="panel">
        <h2>
          Envíos por estado{' '}
          <span className={conectado ? 'aviso-vivo' : 'aviso-cortado'}>
            {conectado ? '● en vivo' : '○ reconectando…'}
          </span>
        </h2>
        <div className="contadores">
          {Object.entries(contadores)
            .sort((a, b) => b[1] - a[1])
            .map(([estado, cantidad]) => (
              <div key={estado} className="contador">
                <div className="numero">{cantidad}</div>
                <div className="etiqueta">{estado}</div>
              </div>
            ))}
          {Object.keys(contadores).length === 0 && <p>Sin envíos todavía.</p>}
        </div>
      </section>

      <section className="panel">
        <h2>Alertas de SLA abiertas ({alertas.length})</h2>
        {alertas.length === 0 && <p>Sin alertas abiertas.</p>}
        {alertas.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Prioridad</th>
                <th>Regla</th>
                <th>Envío</th>
                <th>Vence</th>
                <th>Abierta</th>
              </tr>
            </thead>
            <tbody>
              {alertas.map((a) => (
                <tr key={`${a.shipmentId}:${a.regla}`}>
                  <td>
                    <span className={`etiqueta-prioridad prioridad-${a.prioridad}`}>{a.prioridad}</span>
                  </td>
                  <td>{a.regla}</td>
                  <td>
                    <a href={`/envios/${a.shipmentId}`}>{a.shipmentId}</a>
                  </td>
                  <td>{formatearHora(a.venceEn)}</td>
                  <td>{formatearHora(a.abiertaEn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Últimos envíos</h2>
        <table>
          <thead>
            <tr>
              <th>Envío</th>
              <th>Estado</th>
              <th>Zona</th>
              <th>Intentos</th>
              <th>Actualizado</th>
            </tr>
          </thead>
          <tbody>
            {ultimos.map((e) => (
              <tr key={e.shipmentId}>
                <td>
                  <a href={`/envios/${e.shipmentId}`}>{e.shipmentId}</a>
                </td>
                <td>
                  <span className={`etiqueta-estado estado-${e.estado}`}>{e.estado}</span>
                </td>
                <td>{e.zonaId}</td>
                <td>{e.intentos}</td>
                <td>{formatearHora(e.ultimaActualizacion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

/** Orden de prioridad (menor primero: Crítica > Alta > Media). */
const ORDEN_PRIORIDAD = /** @type {Record<string, number>} */ ({ CRITICA: 0, ALTA: 1, MEDIA: 2 });

/**
 * Ordena alertas por prioridad y luego por vencimiento.
 * @param {import('../../lib/mongo.js').DocVista[]} alertas Alertas a ordenar.
 * @returns {import('../../lib/mongo.js').DocVista[]} Alertas ordenadas.
 */
function ordenarPorPrioridad(alertas) {
  return [...alertas].sort(
    (a, b) =>
      (ORDEN_PRIORIDAD[String(a.prioridad)] ?? 9) - (ORDEN_PRIORIDAD[String(b.prioridad)] ?? 9) ||
      String(a.venceEn).localeCompare(String(b.venceEn)),
  );
}

/**
 * Formatea una fecha ISO como hora corta.
 * @param {unknown} iso Fecha en formato ISO.
 * @returns {string} Hora legible.
 */
function formatearHora(iso) {
  if (!iso) return '—';
  const fecha = new Date(String(iso));
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toISOString().slice(5, 16).replace('T', ' ');
}
