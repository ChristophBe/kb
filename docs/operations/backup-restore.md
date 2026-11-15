# Backup, restore and migrations

kb keeps state in three servers, each shared by the modules that use it. Back up all three; a database restored without its objects has documents whose files are missing.

| Store | Holds | Backed up with |
|---|---|---|
| Postgres | Schemas `document`, `ingestion` and `chat` (incl. the pgvector embeddings), and each module's migration table | `pg_dump` |
| S3 (SeaweedFS) | Bucket `documents` (`KNOWCEL_S3_BUCKET`): the uploaded files | `aws s3 sync` |
| NATS JetStream | Stream `INGESTION` with its consumer: ingestion events not yet processed | `nats stream backup` |

Postgres and S3 are the data that matters. The stream only holds in-flight events; losing it means uploads that were mid-ingestion have to be re-ingested.

The commands below run the clients in containers on the compose network, so nothing needs installing. They assume the compose project `kb` (network `kb_default`) and the dev credentials from `deploy/infra.compose.yaml`; for another deployment change the network, hosts and credentials ([Configuration](../configuration.md)). `$BACKUP` is a directory on the host.

```sh
export BACKUP=$PWD/backup && mkdir -p $BACKUP
```

## Back up

Take the database dump **before** the S3 copy. The document service removes objects that no document row refers to once they are older than `KNOWCEL_ORPHAN_GRACE`; a copy that is newer than the dump only contains a few extra objects, which the sweeper cleans up after a restore, while an older copy would leave rows pointing at missing files. For a fully consistent backup, stop the writers first (`docker compose stop envoy`).

```sh
# Postgres: one custom-format dump of the whole database
docker compose exec -T postgres pg_dump -U kb -Fc kb > $BACKUP/kb.dump

# S3: every object of the bucket
docker run --rm --network kb_default -v $BACKUP:/backup \
  -e AWS_ACCESS_KEY_ID=kb -e AWS_SECRET_ACCESS_KEY=kb-secret-key -e AWS_DEFAULT_REGION=us-east-1 \
  amazon/aws-cli --endpoint-url http://s3:8333 s3 sync s3://documents /backup/documents

# JetStream: the stream, its messages and consumers
docker run --rm --network kb_default -v $BACKUP:/backup natsio/nats-box \
  nats -s nats://nats:4222 stream backup INGESTION /backup/INGESTION
```

Run these from a scheduler and copy `$BACKUP` off the host. With external managed Postgres or S3, use the provider's snapshots instead and keep the same order.

## Restore into a fresh stack

Restore before the modules start, so no component sees an empty database or creates the stream first (`ensure_stream` creates `INGESTION` when it is missing, and `nats stream restore` refuses an existing stream).

```sh
# 1. Only the infrastructure
docker compose up -d --wait postgres s3 nats

# 2. Postgres. --clean --if-exists makes it safe to re-run; the dump creates the vector extension.
docker compose exec -T postgres pg_restore -U kb -d kb --clean --if-exists --no-owner < $BACKUP/kb.dump

# 3. S3: create the bucket and upload the objects
docker run --rm --network kb_default -v $BACKUP:/backup \
  -e AWS_ACCESS_KEY_ID=kb -e AWS_SECRET_ACCESS_KEY=kb-secret-key -e AWS_DEFAULT_REGION=us-east-1 \
  --entrypoint sh amazon/aws-cli -c '
    aws --endpoint-url http://s3:8333 s3 mb s3://documents &&
    aws --endpoint-url http://s3:8333 s3 sync /backup/documents s3://documents'

# 4. JetStream
docker run --rm --network kb_default -v $BACKUP:/backup natsio/nats-box \
  nats -s nats://nats:4222 stream restore /backup/INGESTION

# 5. The rest of the stack
docker compose up -d --wait
```

Then open the UI and check that a document opens and downloads. The migration tables are part of the dump, so the services find the schema at its backed-up version and apply only newer migrations.

Restoring into the database of a running stack works the same way, but stop the modules first (`docker compose stop document-service ingestion-service chat-service`).

### Verification

The steps above were verified by seeding a fresh infrastructure stack (a pgvector table plus a migration table, an object in the bucket, three messages in `INGESTION`), running the backup, deleting the stack with `docker compose down -v`, and restoring into the new one: the vector row, the migration row, the object's content and the three stream messages came back.

## Migrations

Each module owns its schema and migrates independently.

| Module | Tool | Migrations | Version table |
|---|---|---|---|
| `document` | goose | `modules/document/migrations/*.sql` | `public.document_schema_migrations` |
| `ingestion` | goose | `modules/ingestion/migrations/*.sql` | `public.ingestion_schema_migrations` |
| `chat` | Alembic | `modules/chat/migrations/versions` | `chat.alembic_version` |

`llm` has no database.

### How they run

Every service applies its pending migrations at startup, before it serves requests (`postgres.Migrate` for goose, `knowcel_chat.db.migrate` for Alembic). There is no separate migration step in compose; under [Kubernetes](kubernetes.md) there is no migration Job either, so roll out one pod at a time for services with migrations.

A new release therefore migrates the database as it starts. **Take a [backup](#back-up) before upgrading**: it is the only rollback that also undoes data changes.

### Roll back

Migrations have `Down` steps, so a schema change can be undone, but only after the services that need it are stopped, and a service that is newer than the schema will fail or re-apply the migration when it starts. Roll back together with the images: stop the module, roll back, start the previous release (`KNOWCEL_VERSION=<previous>`, see [Container images](images.md)).

Run the tools from a checkout of the release you are rolling back from, so the migration files are the ones the database has applied. Postgres must be reachable from the host (compose publishes 5432).

goose (`document`, `ingestion`), using the repository's pinned goose; `-table` selects the module's version table:

```sh
export DB='postgres://kb:kb@localhost:5432/kb?sslmode=disable'
goose() { go tool -modfile=tools/go.mod goose -dir modules/document/migrations -table document_schema_migrations postgres "$DB" "$@"; }

goose status           # applied and pending migrations
goose down             # undo the latest migration
goose down-to 3        # undo everything above version 3
```

For `ingestion` use `-dir modules/ingestion/migrations -table ingestion_schema_migrations`.

Alembic (`chat`) has no `alembic.ini`; the service builds its config in code. Run the commands through a short script:

```python
# alembic_run.py: uv run --package knowcel-chat-service python alembic_run.py downgrade -1
import sys
from alembic import command
from alembic.config import Config

cfg = Config()
cfg.set_main_option("script_location", "modules/chat/migrations")
cfg.set_main_option("sqlalchemy.url", "postgresql+asyncpg://kb:kb@localhost:5432/kb")
getattr(command, sys.argv[1])(cfg, *sys.argv[2:])
```

`current` shows the applied revision, `history` lists the revisions, `downgrade -1` undoes the latest and `downgrade 0003` goes back to revision `0003`.

Some downgrades destroy data (dropping a column drops its values), and the first migrations drop their whole schema. A failed or unwanted upgrade of production data is better fixed by restoring the backup.

### Writing migrations

Add migrations as new files, never edit an applied one, and always write the `Down` step (goose `-- +goose Down`, Alembic `downgrade()`). The embedding dimension is the exception that needs both migration and configuration: see the note in [CLAUDE.md](../../CLAUDE.md) and [ADR 0006](../adr/0006-pgvector-with-768-dimensions.md).
