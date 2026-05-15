# AMASS-CRM — db-backup sidecar.
#
# Tiny Alpine image that runs busybox-crond + the backup script on a daily
# schedule (see crontab). The script uploads pg_dump output to an
# S3-compatible bucket via mc (MinIO client).
#
# We pin Alpine 3.20 to keep postgresql16-client + mc versions reproducible.

FROM alpine:3.20

ARG MC_VERSION=RELEASE.2024-11-21T17-21-54Z
ARG TARGETARCH=amd64

# Switch to UTC for filesystem timestamps; the cron schedule uses Europe/Bucharest
# via TZ at runtime (so 02:00 local triggers).
ENV TZ=Europe/Bucharest

# postgresql16-client → pg_dump, pg_restore, dropdb, createdb, psql
# gzip                → not strictly needed (pg_dump --compress=9 handles compression)
#                       but kept per spec, useful for ad-hoc inspection
# curl                → fetch mc binary
# tzdata              → required for TZ=Europe/Bucharest to actually apply
# busybox-suid + busybox-extras → crond ships in busybox-suid on Alpine 3.20
# ca-certificates     → required for mc HTTPS to S3 endpoints
RUN apk add --no-cache \
      postgresql16-client \
      gzip \
      curl \
      tzdata \
      ca-certificates \
      busybox-suid \
      busybox-extras \
 && cp /usr/share/zoneinfo/Europe/Bucharest /etc/localtime \
 && echo "Europe/Bucharest" > /etc/timezone

# mc — MinIO client. Single static binary published by MinIO; we pin to a
# specific RELEASE tag so rebuilds are reproducible.
# shellcheck disable=SC2086
RUN curl -fsSL \
      "https://dl.min.io/client/mc/release/linux-${TARGETARCH}/archive/mc.${MC_VERSION}" \
      -o /usr/local/bin/mc \
 && chmod 0755 /usr/local/bin/mc \
 && /usr/local/bin/mc --version

# Non-root user. uid 1001 matches the spec — avoids collision with common
# default uids (postgres=70, node=1000) inside service meshes.
RUN addgroup -S -g 1001 backup \
 && adduser -S -D -H -u 1001 -G backup backup \
 && mkdir -p /var/spool/cron/crontabs /etc/crontabs /home/backup \
 && chown -R backup:backup /home/backup

# Backup + restore scripts. Build context is the REPO ROOT (compose declares
# `context: ..`) so both scripts/ and infra/db-backup/ are reachable from the
# same COPY. If you ever build this image standalone, run
# `docker build -f infra/db-backup/Dockerfile .` from the repo root.
#
# restore-db.sh is shipped in the same image so operators can use
# `docker compose run --rm --entrypoint /usr/local/bin/restore-db.sh db-backup ...`
# without spinning up a separate restore container (the restore runbook in
# docs/INCIDENT_RESPONSE.md depends on this).
COPY scripts/backup-db.sh /usr/local/bin/backup-db.sh
COPY scripts/restore-db.sh /usr/local/bin/restore-db.sh
RUN chmod 0755 /usr/local/bin/backup-db.sh /usr/local/bin/restore-db.sh

# Crontab. busybox-crond on Alpine 3.20 defaults to /var/spool/cron/crontabs/<user>
# (NOT /etc/crontabs/<user> like the busybox docs suggest). We install in BOTH
# locations so either `crond` default or `crond -c /etc/crontabs` works, and
# keep the explicit `-c /etc/crontabs` in CMD as belt-and-suspenders.
#
# This was caught in a 2026-05-15 Layer-2 review where the original `crond -f -d 8`
# silently never fired the job because the crontab lived in the wrong directory.
COPY infra/db-backup/crontab /etc/crontabs/root
RUN cp /etc/crontabs/root /var/spool/cron/crontabs/root \
 && chmod 0600 /etc/crontabs/root /var/spool/cron/crontabs/root

# Privilege note: Alpine's busybox-crond needs root to read /etc/crontabs/<user>
# and to drop privileges to the target user when running jobs. We keep crond
# running as root inside the container — the container itself is the isolation
# boundary (no host port exposure, no shared volumes with prod data). A
# non-root `backup` user (uid 1001) is created above so future supercronic
# migrations can switch with USER backup without re-shuffling layers.
#
# crond -f → foreground (so docker can supervise);
#       -d 8 → log level 8 (debug) routed to stderr → docker logs picks it up;
#       -c /etc/crontabs → explicit crontab directory (default on BusyBox is
#                          /var/spool/cron/crontabs which is fragile across versions).
CMD ["crond", "-f", "-d", "8", "-c", "/etc/crontabs"]
