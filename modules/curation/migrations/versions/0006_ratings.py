"""ratings of documents and passages

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A user has one rating per document and passage; -1 is the document as a whole.
    op.create_table(
        "ratings",
        sa.Column("document_id", sa.Uuid, nullable=False),
        sa.Column("user_id", sa.Text, nullable=False),
        sa.Column("chunk_index", sa.Integer, nullable=False, server_default="-1"),
        # helpful or not_helpful
        sa.Column("rating", sa.Text, nullable=False),
        # The conversation a rating of a chat source was given in; empty otherwise.
        sa.Column("conversation_id", sa.Text, nullable=False, server_default=""),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("document_id", "user_id", "chunk_index"),
        sa.CheckConstraint("rating in ('helpful', 'not_helpful')", name="ratings_rating_check"),
        sa.CheckConstraint("chunk_index >= -1", name="ratings_chunk_check"),
        schema="curation",
    )


def downgrade() -> None:
    op.drop_table("ratings", schema="curation")
