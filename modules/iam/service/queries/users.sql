-- UpsertUser registers a user or refreshes their email and display name. A
-- claim the token lacks (empty) keeps the stored value. platform_admin is
-- only set on insert: later changes belong to the admins, not to the token.
-- name: UpsertUser :one
INSERT INTO iam.users (id, email, display_name, platform_admin)
VALUES (sqlc.arg(id), sqlc.arg(email), sqlc.arg(display_name), sqlc.arg(platform_admin))
ON CONFLICT (id) DO UPDATE
SET email        = coalesce(nullif(EXCLUDED.email, ''), iam.users.email),
    display_name = coalesce(nullif(EXCLUDED.display_name, ''), iam.users.display_name),
    updated_at   = now()
RETURNING *;

-- FindUserByEmail matches the email case-insensitively. Should several users
-- share an email, the one registered first wins.
-- name: FindUserByEmail :one
SELECT * FROM iam.users
WHERE lower(email) = lower(sqlc.arg(email)) AND email <> ''
ORDER BY created_at, id
LIMIT 1;

-- GetUser returns a registered user by id.
-- name: GetUser :one
SELECT * FROM iam.users WHERE id = sqlc.arg(id);

-- ListUsers returns the user directory, by display name, then email.
-- name: ListUsers :many
SELECT * FROM iam.users
ORDER BY lower(display_name), lower(email), id;

-- LockPlatformAdmins takes the rows of all platform admins in a fixed order,
-- so that concurrent demotions run one after the other and cannot both leave
-- the platform without an admin.
-- name: LockPlatformAdmins :many
SELECT id FROM iam.users WHERE platform_admin ORDER BY id FOR UPDATE;

-- name: SetPlatformAdmin :one
UPDATE iam.users SET platform_admin = sqlc.arg(platform_admin), updated_at = now()
WHERE id = sqlc.arg(id)
RETURNING *;
