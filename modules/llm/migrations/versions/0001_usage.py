"""record the usage of each generation

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "usage",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        # The id of the user (x-kb-user) the call was made for; empty without one.
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("caller_module", sa.Text, nullable=False),
        sa.Column("provider", sa.Text, nullable=False),
        sa.Column("model", sa.Text, nullable=False),
        sa.Column("input_tokens", sa.Integer, nullable=False),
        sa.Column("output_tokens", sa.Integer, nullable=False),
        sa.Column("latency_ms", sa.Integer, nullable=False),
        schema="llm",
    )
    op.create_index("usage_created_at_idx", "usage", ["created_at"], schema="llm")
    op.create_index("usage_user_id_idx", "usage", ["user_id", "created_at"], schema="llm")


def downgrade() -> None:
    op.drop_table("usage", schema="llm")
