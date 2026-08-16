import { useRef, useState } from "react";
import type { SquadPlayer } from "@/lib/fpl";
import type { PlayerInsight } from "@/components/PlayerModal";

// Drives the "click a player, open a modal, fetch its AI insight (cached per
// player id)" flow shared by the squad page and the /players browser.
export function usePlayerInsight() {
  const [selectedPlayer, setSelectedPlayer] = useState<SquadPlayer | null>(null);
  const [insightCache, setInsightCache] = useState<Map<number, PlayerInsight>>(new Map());
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [insightError, setInsightError] = useState("");
  const activePlayerIdRef = useRef<number | null>(null);

  function openPlayerModal(player: SquadPlayer) {
    setSelectedPlayer(player);
    setInsightError("");
    activePlayerIdRef.current = player.id;

    if (insightCache.has(player.id)) return;

    setLoadingInsight(true);
    fetch("/api/player-insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: player.id,
        name: player.name,
        position: player.position,
        club: player.club,
        price: player.price,
        form: player.form,
        totalPoints: player.totalPoints,
        news: player.news || undefined,
      }),
    })
      .then(async (res) => {
        const data = (await res.json()) as PlayerInsight;
        if (!res.ok) throw new Error(data.error ?? "Failed to load player insight.");
        setInsightCache((prev) => new Map(prev).set(player.id, data));
      })
      .catch((err: Error) => {
        if (activePlayerIdRef.current === player.id) setInsightError(err.message);
      })
      .finally(() => {
        if (activePlayerIdRef.current === player.id) setLoadingInsight(false);
      });
  }

  function closePlayerModal() {
    setSelectedPlayer(null);
  }

  return {
    selectedPlayer,
    insightCache,
    loadingInsight,
    insightError,
    openPlayerModal,
    closePlayerModal,
  };
}
