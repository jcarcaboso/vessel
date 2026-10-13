#!/bin/sh
set -eu
# One exact IPv4 peer, not a subnet, hostname or arbitrary nginx directive.
proxy=${VESSEL_TRUSTED_PROXY:-}
if [ -n "$proxy" ]; then
    printf '%s\n' "$proxy" | awk -F. '
      NR != 1 || NF != 4 { exit 1 }
      { for (i = 1; i <= 4; i++) if ($i !~ /^[0-9]+$/ || $i > 255 || length($i) > 3) exit 1 }
      $0 == "0.0.0.0" { exit 1 }
      END { if (NR != 1) exit 1 }
    ' || { echo 'VESSEL_TRUSTED_PROXY must be one explicit IPv4 address.' >&2; exit 1; }
fi
{
    if [ -n "$proxy" ]; then
        printf 'set_real_ip_from %s;\nreal_ip_header X-Forwarded-For;\nreal_ip_recursive off;\n' "$proxy"
    fi
    printf 'geo $realip_remote_addr $vessel_trusted_peer {\n default 0;\n'
    if [ -n "$proxy" ]; then printf ' %s 1;\n' "$proxy"; fi
    printf '}\n'
} > /tmp/vessel-trusted-proxy.conf
