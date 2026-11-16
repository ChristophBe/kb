"""add a team scope to conversations

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Ids of teams in the iam module (no foreign key across modules); empty
    # means all documents the user can read, which keeps existing
    # conversations unchanged.
    op.add_column(
        "conversations",
        sa.Column(
            "team_ids",
            postgresql.ARRAY(sa.Uuid),
            nullable=False,
            server_default="{}",
        ),
        schema="chat",
    )


def downgrade() -> None:
    op.drop_column("conversations", "team_ids", schema="chat")
