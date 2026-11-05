"""add a status to messages

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # kb.chat.v1.MessageStatus; existing messages are complete (1).
    op.add_column(
        "messages",
        sa.Column("status", sa.SmallInteger, nullable=False, server_default="1"),
        schema="chat",
    )


def downgrade() -> None:
    op.drop_column("messages", "status", schema="chat")
