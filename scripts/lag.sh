#!/usr/bin/env bash
# scripts/lag.sh — Muestra el lag (mensajes pendientes) de cada grupo de
# consumidores de RutaSur.
#
# Uso: scripts/lag.sh [nombre-del-grupo]
#   Sin argumentos muestra todos los grupos; con argumento, solo ese grupo.

set -euo pipefail

CONTENEDOR="${RUTASUR_KAFKA_CONTENEDOR:-rutasur-kafka}"
BOOTSTRAP="kafka:29092"
GRUPO="${1:-}"
BIN=/opt/kafka/bin/kafka-consumer-groups.sh

echo "== Grupos de consumidores registrados =="
if [[ -n "$GRUPO" ]]; then
  LISTA="$GRUPO"
else
  LISTA=$(docker exec "$CONTENEDOR" "$BIN" --bootstrap-server "$BOOTSTRAP" --list)
fi

for g in $LISTA; do
  echo
  echo "--- Grupo: $g"
  docker exec "$CONTENEDOR" "$BIN" --bootstrap-server "$BOOTSTRAP" \
    --group "$g" --describe
done
