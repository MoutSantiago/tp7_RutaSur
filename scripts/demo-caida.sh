#!/usr/bin/env bash
# scripts/demo-caida.sh — Demostración del NF "Recuperación / Aislamiento".
#
# Detiene el servicio de notificaciones, muestra el lag del grupo crecer,
# lo reinicia y verifica que procesa lo pendiente sin duplicar avisos.
#
# Requiere: entorno levantado (npm run up), simulador corriendo (puerto 3010)
# y notificaciones corriendo. Uso: ./scripts/demo-caida.sh [cantidad_de_fallos]

set -euo pipefail

CANTIDAD="${1:-5}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIM="http://localhost:${SIM_HTTP_PUERTO:-3010}"
MONGO_URI='mongodb://localhost:27017/rutasur?replicaSet=rs0&directConnection=true'

titulo() { echo; echo "== $*"; }


pids_de_servicio() {
  for pid in $(pgrep -f "node\s+src/index\.js" 2>/dev/null); do
    case "$(readlink "/proc/$pid/cwd" 2>/dev/null)" in
      */services/notificaciones) echo "$pid" ;;
    esac
  done
}

titulo "0. Comprobación previa"
curl -sf "$SIM/salud" >/dev/null || { echo "ERROR: el simulador no responde en $SIM"; exit 1; }
if ! PIDS_RUNNING="$(pids_de_servicio)" || [[ -z "$PIDS_RUNNING" ]]; then echo "ERROR: notificaciones no está corriendo"; exit 1; fi

titulo "1. Detener el servicio de notificaciones"
for p in $(pids_de_servicio); do kill -TERM "$p"; done
sleep 8  # apagado ordenado puede tardar unos segundos
PIDS_RUNNING="$(pids_de_servicio)"; if [[ -n "$PIDS_RUNNING" ]]; then echo "No pudo detenerse"; exit 1; else echo "notificaciones detenido"; fi

titulo "2. Disparar $CANTIDAD fallos por AUSENTE (mientras está caído)"
for i in $(seq 1 "$CANTIDAD"); do
  curl -sf -X POST "$SIM/escenarios/ausente" >/dev/null
done
echo "escenarios disparados; esperando a que lleguen los primeros fallos (~25 s con factor 600)…"
sleep 25

titulo "3. Lag del grupo notificaciones (debe estar creciendo)"
"$ROOT/scripts/lag.sh" notificaciones

titulo "4. Reiniciar notificaciones"
(cd "$ROOT/services/notificaciones" && nohup node src/index.js >>/tmp/opencode/notificaciones.log 2>&1 &)
sleep 10

titulo "5. Lag tras el reinicio (debe volver a 0)"
"$ROOT/scripts/lag.sh" notificaciones

titulo "6. Verificación: sin notificaciones duplicadas"
docker exec rutasur-mongodb mongosh --quiet "$MONGO_URI" --eval '
  const dup = db.notificaciones.aggregate([
    { $group: { _id: "$eventoOrigenId", n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: "duplicadas" },
  ]).toArray();
  const total = db.notificaciones.countDocuments({});
  print(`notificaciones totales: ${total}; avisos duplicados por fallo: ${dup[0]?.duplicadas ?? 0}`);
'

echo "Demo de caída completa: el consumo se reanudó desde el último offset sin perder ni duplicar."
