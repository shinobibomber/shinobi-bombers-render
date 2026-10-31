export interface FeatureRules {
  ranks: [string, string, number][];
  perks: [string, string][];
  statBands: number[][];
  summonCost: number;
  dojoRecovery: number[];
  fusionSuccessPercent: number[];
  withdrawalMinimum: number;
  withdrawalCooldownMs: number;
  studioFeeBps: number;
  maxTransfer: number;
  senseiOfflineCapHours: number;
  senseiReturnPercent: number;
  battleReadyLimit: number;
  deployedLimit: number;
  elements: { key: string; label: string }[];
  bossNames: string[];
  bossHP: number;
  bossReward: number;
}

export interface FeatureSnapshot {
  authenticated: boolean;
  account: string | null;
  balance: number;
  rules?: FeatureRules;
  chest?: { pending: number; claimed: number; pool: number; rewardRatePercent: number } | null;
  profile?: { dojo: number; sensei: boolean; senseiRentalUntil?: number } | null;
  currentStage?: number;
}

export interface FeatureProps {
  snapshot: FeatureSnapshot;
  navigate: (page: number, mode?: number) => void;
  openChest?: () => void;
}
