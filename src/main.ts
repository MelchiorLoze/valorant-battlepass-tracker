import * as fs from 'node:fs';
import process from 'node:process';
import { getConfig } from './config.ts';
import { Contract, Season } from './types.ts';

const CONTRACT_BATTLEPASS_ID = '07ba5d79-4245-03d8-7996-13baf5d08c1a';
const BATTLEPASS_TIER_COUNT = 50;
const BATTLEPASS_EPILOGUE_TIER_COUNT = 5;

const getBattlepassData = async ({ retry }: { retry?: boolean } = {}): Promise<
    Contract | undefined
> => {
    const config = await getConfig();

    const response = await fetch(
        `https://pd.${config.shard}.a.pvp.net/contracts/v1/contracts/${config.puuid}`,
        {
            method: 'GET',
            headers: {
                Accept: '*/*',
                Authorization: 'Bearer ' + config.accessToken,
                'User-Agent': '',
                'X-Riot-ClientVersion': config.clientVersion,
                'X-Riot-Entitlements-JWT': config.entitlementsToken,
                'X-Riot-ClientPlatform': config.clientPlatform,
            },
        },
    );
    const data = await response.json();

    const battlepassData = data?.Contracts?.find(
        (contract: Contract) => contract.ContractDefinitionID === CONTRACT_BATTLEPASS_ID,
    );
    if (battlepassData) return battlepassData;
    if (retry) return undefined;
    throw new Error('Failed to get battlepass data');
};

const getActiveActEndDate = async (): Promise<Date> => {
    const config = await getConfig();
    const response = await fetch(
        `https://shared.${config.shard}.a.pvp.net/content-service/v3/content`,
        {
            method: 'GET',
            headers: {
                Accept: '*/*',
                Authorization: 'Bearer ' + config.accessToken,
                'User-Agent': '',
                'X-Riot-ClientVersion': config.clientVersion,
                'X-Riot-Entitlements-JWT': config.entitlementsToken,
                'X-Riot-ClientPlatform': config.clientPlatform,
            },
        },
    );
    const data = await response.json();
    const activeAct: Season = data.Seasons.find(
        (season: Season) => season.IsActive && season.Type === 'act',
    );
    return new Date(activeAct.EndTime);
};

const getTotalXpRequired = ({
    withEpilogue,
}: { withEpilogue?: boolean } = {}): number => {
    let result = 0;
    for (let i = 1; i <= BATTLEPASS_TIER_COUNT; i++) {
        if (i !== 1) result += i * 750 + 500;
    }

    if (withEpilogue) {
        const xpRequriedPerEpilogueTier = 36500;
        result += BATTLEPASS_EPILOGUE_TIER_COUNT * xpRequriedPerEpilogueTier;
    }

    return result;
};

const handleError = (message: string): void => {
    fs.appendFileSync('error.log', message + '\n');
    console.log('An error occurred. Check error.log for more information.');
    process.exit(1);
};

const main = async (): Promise<void> => {
    fs.writeFileSync('error.log', '');

    try {
        let battlepassData = await getBattlepassData({ retry: true });
        if (!battlepassData) {
            fs.appendFileSync('error.log', 'Retrying...\n');
            fs.writeFileSync('config.yaml', '');
            battlepassData = await getBattlepassData();
        }
        if (!battlepassData) throw new Error('Failed to get progress');

        const battlepassProgress = battlepassData.ContractProgression.TotalProgressionEarned;
        const battlepassLevel = battlepassData.ProgressionLevelReached;

        const totalXpRequired = getTotalXpRequired();
        const totalXpRequiredWithEpilogue = getTotalXpRequired({
            withEpilogue: true,
        });

        const progressPercentage = Math.min(
            100,
            (battlepassProgress / totalXpRequired) * 100,
        );
        const progressPercentageWithEpilogue = Math.min(
            100,
            (battlepassProgress / totalXpRequiredWithEpilogue) * 100,
        );

        const xpRemaining = Math.max(0, totalXpRequired - battlepassProgress);
        const xpRemainingWithEpilogue = Math.max(
            0,
            totalXpRequiredWithEpilogue - battlepassProgress,
        );

        console.log('VALORANT Battlepass Progress:');
        console.log('-'.repeat(30));
        console.log('Without epilogue:');
        console.log(
            `\tProgress: ${
                progressPercentage.toFixed(
                    2,
                )
            }% (tier ${battlepassLevel}/${BATTLEPASS_TIER_COUNT})`,
        );
        console.log(`\tXP remaining: ${xpRemaining}`);
        console.log('With epilogue:');
        console.log(
            `\tProgress: ${
                progressPercentageWithEpilogue.toFixed(
                    2,
                )
            }% (tier ${battlepassLevel}/${BATTLEPASS_TIER_COUNT + BATTLEPASS_EPILOGUE_TIER_COUNT})`,
        );
        console.log(`\tXP remaining: ${xpRemainingWithEpilogue}`);

        const activeActEndDate = await getActiveActEndDate();
        const remainingTimeInSeconds = (activeActEndDate.getTime() - (Date.now() + 1000 * 60 * 60 * 2)) / 1000; // UTC+2
        console.log(
            `\nTime remaining: ${
                Math.floor(
                    remainingTimeInSeconds / 86400,
                )
            } days ${
                Math.floor(
                    (remainingTimeInSeconds % 86400) / 3600,
                )
            } hours ${Math.floor((remainingTimeInSeconds % 3600) / 60)} minutes`,
        );

        // Wait for the user to read the output
        while (true);
    } catch (error) {
        handleError((error as Error).message);
    }
};

main();
