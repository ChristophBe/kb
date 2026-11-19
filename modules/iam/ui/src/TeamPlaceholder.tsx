import { Card, EmptyState, UsersRound } from "@knowcel/ui";

export function TeamPlaceholder() {
  return (
    <Card>
      <EmptyState icon={UsersRound}>Select a team to see its members.</EmptyState>
    </Card>
  );
}
