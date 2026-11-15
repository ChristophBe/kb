-- name: InsertTeam :one
INSERT INTO iam.teams (id, name) VALUES (sqlc.arg(id), sqlc.arg(name))
RETURNING *;

-- name: UpdateTeamName :one
UPDATE iam.teams SET name = sqlc.arg(name), updated_at = now()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: DeleteTeam :exec
DELETE FROM iam.teams WHERE id = sqlc.arg(id);

-- LockTeam serialises the membership changes of one team, so that two
-- concurrent demotions cannot both leave the team without an admin.
-- name: LockTeam :one
SELECT id FROM iam.teams WHERE id = sqlc.arg(id) FOR UPDATE;

-- GetTeamForUser returns the team with the user's role, or no row when the
-- user is not a member.
-- name: GetTeamForUser :one
SELECT t.id, t.name, m.role
FROM iam.teams t
JOIN iam.team_members m ON m.team_id = t.id
WHERE t.id = sqlc.arg(id) AND m.user_id = sqlc.arg(user_id);

-- name: ListTeamsForUser :many
SELECT t.id, t.name, m.role
FROM iam.teams t
JOIN iam.team_members m ON m.team_id = t.id
WHERE m.user_id = sqlc.arg(user_id)
ORDER BY lower(t.name), t.id;

-- name: ListTeamMembers :many
SELECT m.user_id, u.email, u.display_name, m.role
FROM iam.team_members m
JOIN iam.users u ON u.id = m.user_id
WHERE m.team_id = sqlc.arg(team_id)
ORDER BY m.role, lower(u.display_name), lower(u.email), m.user_id;

-- name: GetTeamMember :one
SELECT m.user_id, u.email, u.display_name, m.role
FROM iam.team_members m
JOIN iam.users u ON u.id = m.user_id
WHERE m.team_id = sqlc.arg(team_id) AND m.user_id = sqlc.arg(user_id);

-- name: InsertTeamMember :exec
INSERT INTO iam.team_members (team_id, user_id, role)
VALUES (sqlc.arg(team_id), sqlc.arg(user_id), sqlc.arg(role));

-- name: SetTeamMemberRole :execrows
UPDATE iam.team_members SET role = sqlc.arg(role)
WHERE team_id = sqlc.arg(team_id) AND user_id = sqlc.arg(user_id);

-- name: DeleteTeamMember :execrows
DELETE FROM iam.team_members
WHERE team_id = sqlc.arg(team_id) AND user_id = sqlc.arg(user_id);

-- name: CountTeamAdmins :one
SELECT count(*) FROM iam.team_members
WHERE team_id = sqlc.arg(team_id) AND role = sqlc.arg(admin_role);
