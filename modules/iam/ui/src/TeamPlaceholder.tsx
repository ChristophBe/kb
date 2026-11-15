import { Card, EmptyState } from "@knowcel/ui";
import { UsersRound } from "lucide-react";

export function TeamPlaceholder() {
  return (
    <Card>
      <EmptyState icon={UsersRound}>Select a team to see its members.</EmptyState>
    </Card>
  );
}
