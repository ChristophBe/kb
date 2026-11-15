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
