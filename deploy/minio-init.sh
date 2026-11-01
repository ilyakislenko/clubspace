#!/bin/sh
# One-shot storage bootstrap for docker-compose.prod.yml (the minio-init
# service). Idempotent: every run re-applies the same state, so it is also how
# a changed service secret or policy is rolled out — `up minio-init`.
#
# 1. The bucket, PRIVATE. Course video (hls/, raw/) is only reachable through
#    the membership-checked manifest proxy, which signs short-lived segment
#    URLs. Only thumbnails/ and subtitles/ are anonymously readable, because
#    the apps load those unsigned — plus playlists/, where course covers were
#    uploaded before they moved under thumbnails/.
# 2. One service account per app, each with the least it needs, so neither the
#    server nor the worker ever holds the root credentials:
#    - server: read, write and delete objects in the bucket and list it. It
#      signs the browsers' upload and playback URLs, which then act with these
#      same rights, and it deletes a video's files when the video is deleted.
#    - worker: read the raw uploads, write and clean up the HLS renditions.
set -eu

: "${MINIO_ROOT_USER:?}" "${MINIO_ROOT_PASSWORD:?}" "${S3_BUCKET_NAME:?}"
: "${S3_SERVER_ACCESS_KEY_ID:?}" "${S3_SERVER_SECRET_ACCESS_KEY:?}"
: "${S3_WORKER_ACCESS_KEY_ID:?}" "${S3_WORKER_SECRET_ACCESS_KEY:?}"

BUCKET="$S3_BUCKET_NAME"
POLICY_DIR="$(mktemp -d)"
trap 'rm -rf "$POLICY_DIR"' EXIT

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" > /dev/null

mc mb --ignore-existing "local/$BUCKET"
mc anonymous set none "local/$BUCKET"
mc anonymous set download "local/$BUCKET/thumbnails"
mc anonymous set download "local/$BUCKET/subtitles"
mc anonymous set download "local/$BUCKET/playlists"

cat > "$POLICY_DIR/clubspace-server.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::$BUCKET"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::$BUCKET/*"]
    }
  ]
}
EOF

cat > "$POLICY_DIR/clubspace-worker.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::$BUCKET/raw/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::$BUCKET/hls/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::$BUCKET"],
      "Condition": { "StringLike": { "s3:prefix": ["hls/*"] } }
    }
  ]
}
EOF

# ensure_account <policy-name> <access-key> <secret-key>
ensure_account() {
    mc admin policy create local "$1" "$POLICY_DIR/$1.json" > /dev/null
    # `user add` on an existing user updates its secret, so a rotated value in
    # .env.production takes effect on the next run.
    mc admin user add local "$2" "$3" > /dev/null
    # attach refuses a policy that is already attached; that is the state we
    # want, so confirm it instead of failing the run.
    if ! mc admin policy attach local "$1" --user "$2" > /dev/null 2>&1; then
        mc admin user info local "$2" | grep -q "$1" || {
            echo "minio-init: could not attach policy $1 to $2" >&2
            exit 1
        }
    fi
    echo "minio-init: service account $2 -> policy $1"
}

ensure_account clubspace-server "$S3_SERVER_ACCESS_KEY_ID" "$S3_SERVER_SECRET_ACCESS_KEY"
ensure_account clubspace-worker "$S3_WORKER_ACCESS_KEY_ID" "$S3_WORKER_SECRET_ACCESS_KEY"
