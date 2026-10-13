import { obtenerDocumentosMetricas, obtenerOpcionesFiltros } from '../../lib/mongo.js';
import { resumirMetricas } from '../../lib/metricas.js';

export const dynamic = 'force-dynamic';

/**
 * Panel analítico de CU4: los tres indicadores con filtros por zona, hub y
 * fecha. Se calcula al cargar la página (agregación en el servidor sobre
 * `metricas_diarias`).
 * @param {object} props Props de la página.
 * @param {Promise<Record<string, string | undefined>>} props.searchParams Filtros de la URL.
 * @returns {Promise<import('react').ReactElement>} Panel analítico.
 */
export default async function PaginaAnalitica({ searchParams }) {
  const params = await searchParams;
  const filtro = {
    zonaId: params.zona || undefined,
    hubId: params.hub || undefined,
    fecha: params.fecha || undefined,
  };
  const [docs, opciones] = await Promise.all([obtenerDocumentosMetricas(), obtenerOpcionesFiltros()]);
  const resumen = resumirMetricas(docs, filtro);

  return (
    <>
      <section className="panel">
        <h2>Filtros</h2>
        <form method="get" className="filtros">
          <label>
            Zona:{' '}
            <select name="zona" defaultValue={filtro.zonaId ?? ''}>
              <option value="">Todas</option>
              {opciones.zonas.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            Hub:{' '}
            <select name="hub" defaultValue={filtro.hubId ?? ''}>
              <option value="">Todos</option>
              {opciones.hubs.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            Día:{' '}
            <select name="fecha" defaultValue={filtro.fecha ?? ''}>
              <option value="">Todos</option>
              {opciones.fechas.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>{' '}
          <button type="submit">Aplicar</button>
        </form>
      </section>

      <section className="panel">
        <h2>Tasa de entrega en primer intento (por día, zona y franja)</h2>
        {resumen.tasaPrimerIntento.length === 0 && <p>Sin datos para el filtro elegido.</p>}
        {resumen.tasaPrimerIntento.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Día</th>
                <th>Zona</th>
                <th>Franja</th>
                <th>Primeros intentos</th>
                <th>Exitosos</th>
                <th>Tasa</th>
              </tr>
            </thead>
            <tbody>
              {resumen.tasaPrimerIntento.map((f) => (
                <tr key={`${f.fecha}-${f.zonaId}-${f.franja}`}>
                  <td>{f.fecha}</td>
                  <td>{f.zonaId}</td>
                  <td>{f.franja}</td>
                  <td>{f.intentos}</td>
                  <td>{f.exitosos}</td>
                  <td>{f.tasa}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Distribución de motivos de fallo (por zona)</h2>
        {resumen.motivos.length === 0 && <p>Sin fallos para el filtro elegido.</p>}
        {resumen.motivos.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Zona</th>
                <th>Motivo</th>
                <th>Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {resumen.motivos.map((m) => (
                <tr key={`${m.zonaId}-${m.motivo}`}>
                  <td>{m.zonaId}</td>
                  <td>{m.motivo}</td>
                  <td>{m.cantidad}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Cumplimiento de SLA por hub y día</h2>
        {resumen.slaHub.length === 0 && <p>Sin entregas evaluables para el filtro elegido.</p>}
        {resumen.slaHub.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Hub</th>
                <th>Día</th>
                <th>Cumplidos</th>
                <th>Incumplidos</th>
                <th>Cumplimiento</th>
              </tr>
            </thead>
            <tbody>
              {resumen.slaHub.map((s) => (
                <tr key={`${s.hubId}-${s.fecha}`}>
                  <td>{s.hubId}</td>
                  <td>{s.fecha}</td>
                  <td>{s.cumplidos}</td>
                  <td>{s.incumplidos}</td>
                  <td>{s.cumplimiento}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
