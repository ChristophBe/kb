package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Team roles as stored in iam.team_members.role. They mirror the values of
// knowcel.iam.v1.TeamRole.
const (
	RoleAdmin  int16 = 1
	RoleMember int16 = 2
)

var (
	// ErrNotMember means the user is not a member of the team (or the team is gone).
	ErrNotMember = errors.New("not a member of the team")
	// ErrLastAdmin means the change would leave the team without an admin.
	ErrLastAdmin = errors.New("the team would have no admin")
)

// Repo adds multi-statement operations on top of the generated queries.
type Repo struct {
	*Queries
	pool *pgxpool.Pool
}

func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{Queries: New(pool), pool: pool}
}

// CreateTeam creates a team with creator as its first admin.
func (r *Repo) CreateTeam(ctx context.Context, name, creator string) (IamTeam, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return IamTeam{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after commit
	q := r.WithTx(tx)
	team, err := q.InsertTeam(ctx, InsertTeamParams{ID: uuid.New(), Name: name})
	if err != nil {
		return IamTeam{}, err
	}
	if err := q.InsertTeamMember(ctx, InsertTeamMemberParams{TeamID: team.ID, UserID: creator, Role: RoleAdmin}); err != nil {
		return IamTeam{}, err
	}
	return team, tx.Commit(ctx)
}

// RemoveMember removes a member, unless they are the team's last admin.
func (r *Repo) RemoveMember(ctx context.Context, teamID uuid.UUID, userID string) error {
	return r.changeMember(ctx, teamID, userID, func(ctx context.Context, q *Queries) error {
		_, err := q.DeleteTeamMember(ctx, DeleteTeamMemberParams{TeamID: teamID, UserID: userID})
		return err
	}, true)
}

// SetMemberRole changes a member's role, unless that demotes the team's last admin.
func (r *Repo) SetMemberRole(ctx context.Context, teamID uuid.UUID, userID string, role int16) error {
	return r.changeMember(ctx, teamID, userID, func(ctx context.Context, q *Queries) error {
		_, err := q.SetTeamMemberRole(ctx, SetTeamMemberRoleParams{TeamID: teamID, UserID: userID, Role: role})
		return err
	}, role != RoleAdmin)
}

// changeMember runs apply under the team's lock. When losesAdmin is set and
// the member is the last admin, it fails with ErrLastAdmin instead.
func (r *Repo) changeMember(ctx context.Context, teamID uuid.UUID, userID string,
	apply func(ctx context.Context, q *Queries) error, losesAdmin bool,
) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after commit
	q := r.WithTx(tx)
	if _, err := q.LockTeam(ctx, teamID); err != nil {
		return notMember(err)
	}
	m, err := q.GetTeamMember(ctx, GetTeamMemberParams{TeamID: teamID, UserID: userID})
	if err != nil {
		return notMember(err)
	}
	if losesAdmin && m.Role == RoleAdmin {
		admins, err := q.CountTeamAdmins(ctx, CountTeamAdminsParams{TeamID: teamID, AdminRole: RoleAdmin})
		if err != nil {
			return err
		}
		if admins <= 1 {
			return ErrLastAdmin
		}
	}
	if err := apply(ctx, q); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func notMember(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotMember
	}
	return err
}
