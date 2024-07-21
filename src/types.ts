export type Config = {
    clientVersion: string;
    shard: string;
    ssid: string;
    accessToken: string;
    puuid: string;
    entitlementsToken: string;
    clientPlatform: string;
};

export type Contract = {
    ContractDefinitionID: string;
    ContractProgression: {
        TotalProgressionEarned: number;
        TotalProgressionEarnedVersion: number;
        HighestRewardedLevel: {
            [x: string]: {
                Amount: number;
                Version: number;
            };
        };
    };
    ProgressionLevelReached: number;
    ProgressionTowardsNextLevel: number;
};

export type Season = {
    Type: 'episode' | 'act';
    IsActive: boolean;
    EndTime: string;
};
