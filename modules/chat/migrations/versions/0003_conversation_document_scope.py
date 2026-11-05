"""add a document scope to conversations

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Ids of documents in the document module (no foreign key across modules);
    # empty means all documents, which keeps existing conversations unchanged.
    op.add_column(
        "conversations",
        sa.Column(
            "document_ids",
            postgresql.ARRAY(sa.Uuid),
            nullable=False,
            server_default="{}",
        ),
        schema="chat",
    )


def downgrade() -> None:
    op.drop_column("conversations", "document_ids", schema="chat")
