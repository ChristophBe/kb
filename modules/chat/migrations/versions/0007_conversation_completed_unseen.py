"""mark conversations whose answer finished while nobody was watching

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("completed_unseen", sa.Boolean, nullable=False, server_default=sa.false()),
        schema="chat",
    )


def downgrade() -> None:
    op.drop_column("conversations", "completed_unseen", schema="chat")
