'use client';

import { useEffect, useState } from 'react';

/**
 * Vista en vivo del detalle de un envío: línea de tiempo, intentos, alertas y
 * notificaciones. Se actualiza por SSE filtrando los eventos de este envío.
 * @param {object} props Props del componente.
 * @param {string} props.shipmentId Identificador del envío.
 * @param {import("../../lib/mongo.js").DocVista | null} props.envioInicial Documento del envío (SSR; null si no existe).
 * @param {import("../../lib/mongo.js").DocVista[]} props.alertasIniciales Alertas del envío (SSR).
 * @param {import("../../lib/mongo.js").DocVista[]} props.notificacionesIniciales Notificaciones del envío (SSR).
 * @returns {import('react').ReactElement} Detalle del envío en vivo.
 */
export default function DetalleEnvio({
  shipmentId,
  envioInicial,
  alertasIniciales,
  notificacionesIniciales,
}) {
  /** @type {[import("../../lib/mongo.js").DocVista | null, Function]} */
  const [envio, setEnvio] = useState(envioInicial);
  const [alertas, setAlertas] = useState(alertasIniciales);
  const [notificaciones, setNotificaciones] = useState(notificacionesIniciales);
  const [conectado, setConectado] = useState(false);

  useEffect(() => {
    const fuente = new EventSource('/api/stream');
    fuente.onopen = () => setConectado(true);
    fuente.onerror = () => setConectado(false); // EventSource reintenta solo
    fuente.addEventListener('envio', (mensaje) => {
      const actualizado = JSON.parse(mensaje.data);
      if (actualizado.shipmentId === shipmentId) setEnvio(actualizado);
    });
    fuente.addEventListener('alerta', (mensaje) => {
      const alerta = JSON.parse(mensaje.data);
      if (alerta.shipmentId !== shipmentId) return;
      setAlertas((/** @type {import("../../lib/mongo.js").DocVista[]} */ actual) => {
        const resto = actual.filter((a) => a.regla !== alerta.regla);
        return [...resto, alerta].sort((a, b) =>
          String(a.abiertaEn).localeCompare(String(b.abiertaEn)),
        );
      });
    });
    fuente.addEventListener('notificacion', (mensaje) => {
      const notif = JSON.parse(mensaje.data);
      if (notif.shipmentId !== shipmentId) return;
      setNotificaciones((/** @type {import("../../lib/mongo.js").DocVista[]} */ actual) =>
        actual.some((n) => n.eventId === notif.eventId) ? actual : [...actual, notif],
      );
    });
    return () => fuente.close();
  }, [shipmentId]);

  if (!envio) {
    return (
      <section className="panel">
        <h2>Envío no encontrado</h2>
        <p>
          No existe ningún envío con identificador <code>{shipmentId}</code>.{' '}
          <a href="/">Volver a la torre</a>
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="panel">
        <h2>
          Envío {shipmentId}{' '}
          <span className={conectado ? 'aviso-vivo' : 'aviso-cortado'}>
            {conectado ? '● en vivo' : '○ reconectando…'}
          </span>
        </h2>
        <p>
          <span className={`etiqueta-estado estado-${envio.estado}`}>{envio.estado}</span>{' '}
          Zona {envio.zonaId} · Hub {envio.hubId} · Repartidor {envio.repartidorId} · Intentos:{' '}
          {envio.intentos}
        </p>
        {envio.promesa && (
          <p>
            Promesa: vence {formatearFecha(envio.promesa.venceEn)} · franja {envio.promesa.franja}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Línea de tiempo</h2>
        <ul className="timeline">
          {(/** @type {import('../../lib/mongo.js').DocVista[]} */ (envio.historial ?? [])).map((paso, i) => (
            <li key={`${paso.secuencia}-${paso.tipo}-${i}`}>
              <strong>{paso.tipo}</strong>
              {paso.motivo ? ` · motivo ${paso.motivo}` : ''}
              {paso.intento ? ` · intento ${paso.intento}` : ''}
              {paso.franja ? ` · franja ${paso.franja}` : ''}
              {paso.nuevoIntentoEn ? ` · nuevo intento ${formatearFecha(paso.nuevoIntentoEn)}` : ''}
              <br />
              <span className="hora">{formatearFecha(paso.ocurridoEn)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Alertas ({alertas.length})</h2>
        {alertas.length === 0 && <p>Sin alertas para este envío.</p>}
        {alertas.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Regla</th>
                <th>Prioridad</th>
                <th>Estado</th>
                <th>Abierta</th>
                <th>Cerrada</th>
              </tr>
            </thead>
            <tbody>
              {alertas.map((a) => (
                <tr key={a.regla}>
                  <td>{a.regla}</td>
                  <td>
                    <span className={`etiqueta-prioridad prioridad-${a.prioridad}`}>{a.prioridad}</span>
                  </td>
                  <td>{a.estado ?? a.estadoAlerta}</td>
                  <td>{formatearFecha(a.abiertaEn ?? a.ocurridoEn)}</td>
                  <td>{a.cerradaEn ? formatearFecha(a.cerradaEn) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Notificaciones ({notificaciones.length})</h2>
        {notificaciones.length === 0 && <p>Sin notificaciones emitidas.</p>}
        {notificaciones.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Canal</th>
                <th>Asunto</th>
                <th>Emitida</th>
              </tr>
            </thead>
            <tbody>
              {notificaciones.map((n) => (
                <tr key={n.eventId}>
                  <td>{n.canal}</td>
                  <td>{n.asunto}</td>
                  <td>{formatearFecha(n.ocurridoEn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/**
 * Formatea una fecha ISO de forma legible.
 * @param {unknown} iso Fecha ISO.
 * @returns {string} Fecha legible o guion.
 */
function formatearFecha(iso) {
  if (!iso) return '—';
  const fecha = new Date(String(iso));
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toISOString().slice(0, 16).replace('T', ' ');
}
