#!/usr/bin/env bash
# scripts/lag.sh — Muestra el lag (mensajes pendientes) por grupo de consumidores.
#
# Uso: scripts/lag.sh [grupo]
#   Sin argumentos: todos los grupos del cluster (proyector, notificaciones,
#   reprogramacion, monitor-sla, analitica, analitica-tiempos-hub, etc.).
#   Con argumento: solo ese grupo.
# Exit 0 siempre; las líneas de detalle van al stdout.

set -euo pipefail

CONTENEDOR="${RUTASUR_KAFKA_CONTENEDOR:-rutasur-kafka}"
BOOTSTRAP="kafka:29092"
GRUPO="${1:-}"
BIN=/opt/kafka/bin/kafka-consumer-groups.sh

if [[ -n "$GRUPO" ]]; then
  LISTA="$GRUPO"
else
  LISTA=$(docker exec "$CONTENEDOR" "$BIN" --bootstrap-server "$BOOTSTRAP" --list 2>/dev/null)
fi

total_lag=0
for g in $LISTA; do
  echo "=== Grupo: $g"
  salida=$(docker exec "$CONTENEDOR" "$BIN" --bootstrap-server "$BOOTSTRAP" --group "$g" --describe 2>/dev/null || true)
  echo "$salida"
  lag_grupo=$(echo "$salida" | awk 'NR>1 && $6 ~ /^[0-9]+$/ {suma += $6} END {print suma+0}')
  echo "  -> lag total: $lag_grupo"
  total_lag=$((total_lag + lag_grupo))
  echo
done

echo "== Lag total de todos los grupos: $total_lag"
