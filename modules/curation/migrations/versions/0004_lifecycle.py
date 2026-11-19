"""lifecycle of documents, and review-due findings

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Every change is a row; the latest of a document is its current lifecycle.
    op.create_table(
        "document_lifecycle",
        sa.Column("id", sa.Uuid, primary_key=True),
        sa.Column("document_id", sa.Uuid, nullable=False),
        # draft, in_review, approved, deprecated or archived
        sa.Column("state", sa.Text, nullable=False),
        # The user responsible for the review.
        sa.Column("owner", sa.Text, nullable=False),
        sa.Column("review_by", sa.DateTime(timezone=True)),
        sa.Column("note", sa.Text, nullable=False),
        sa.Column("changed_by", sa.Text, nullable=False),
        sa.Column(
            "changed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "state in ('draft', 'in_review', 'approved', 'deprecated', 'archived')",
            name="document_lifecycle_state_check",
        ),
        schema="curation",
    )
    op.create_index(
        "document_lifecycle_document_idx",
        "document_lifecycle",
        ["document_id", sa.text("changed_at desc")],
        schema="curation",
    )
    op.drop_constraint("findings_kind_check", "findings", schema="curation")
    op.create_check_constraint(
        "findings_kind_check",
        "findings",
        "kind in ('duplicate', 'superseded', 'conflict', 'review_due')",
        schema="curation",
    )


def downgrade() -> None:
    op.execute("DELETE FROM curation.findings WHERE kind = 'review_due'")
    op.drop_constraint("findings_kind_check", "findings", schema="curation")
    op.create_check_constraint(
        "findings_kind_check",
        "findings",
        "kind in ('duplicate', 'superseded', 'conflict')",
        schema="curation",
    )
    op.drop_table("document_lifecycle", schema="curation")
