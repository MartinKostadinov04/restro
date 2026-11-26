#!/bin/sh
# The start command of every Restro image (see the root Dockerfile). It writes the database's CA
# certificate to a fixed file, then replaces itself with the service's own command (`exec`), so
# that command receives the platform's stop signal directly.
#
# SUPABASE_CA_CERT is the public certificate text that verifies the hosted database's TLS (the same
# text the migrate workflow writes for its runner). The connection strings name the file:
# `...?sslmode=verify-full&sslrootcert=/tmp/supabase-ca.crt`. Unset, nothing is written (a
# database without that certificate, such as CI's); set but not a certificate, the start stops here.
set -eu

CA_FILE=/tmp/supabase-ca.crt

if [ -n "${SUPABASE_CA_CERT:-}" ]; then
  case "$SUPABASE_CA_CERT" in
    *"-----BEGIN CERTIFICATE-----"*) ;;
    *)
      echo "SUPABASE_CA_CERT is set but holds no PEM certificate (no BEGIN CERTIFICATE line)." >&2
      exit 1
      ;;
  esac
  printf '%s\n' "$SUPABASE_CA_CERT" > "$CA_FILE"
fi

exec "$@"
