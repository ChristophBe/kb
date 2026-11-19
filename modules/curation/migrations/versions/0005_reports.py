"""reports of documents

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A user has one report per document; reporting again replaces it.
    op.create_table(
        "reports",
        sa.Column("document_id", sa.Uuid, nullable=False),
        sa.Column("reporter", sa.Text, nullable=False),
        # wrong, outdated, inappropriate or other
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("comment", sa.Text, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        # Set when the reports were dismissed or the document deprecated.
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.PrimaryKeyConstraint("document_id", "reporter"),
        sa.CheckConstraint(
            "reason in ('wrong', 'outdated', 'inappropriate', 'other')",
            name="reports_reason_check",
        ),
        schema="curation",
    )
    op.drop_constraint("findings_kind_check", "findings", schema="curation")
    op.create_check_constraint(
        "findings_kind_check",
        "findings",
        "kind in ('duplicate', 'superseded', 'conflict', 'review_due', 'reported')",
        schema="curation",
    )


def downgrade() -> None:
    op.execute("DELETE FROM curation.findings WHERE kind = 'reported'")
    op.drop_constraint("findings_kind_check", "findings", schema="curation")
    op.create_check_constraint(
        "findings_kind_check",
        "findings",
        "kind in ('duplicate', 'superseded', 'conflict', 'review_due')",
        schema="curation",
    )
    op.drop_table("reports", schema="curation")
