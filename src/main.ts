import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

const CONTRACT_BATTLEPASS_ID = '53c858f6-4d23-4111-1dee-b8933ef21929';
const BATTLEPASS_TIER_COUNT = 50;
const BATTLEPASS_EPILOGUE_TIER_COUNT = 5;

type Config = {
    clientVersion: string;
    shard: string;
    puuid: string;
    ssid: string;
    accessToken: string;
    entitlementsToken: string;
};

type Contract = {
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

const getClientVersion = async (): Promise<string> => {
    const response = await fetch('https://valorant-api.com/v1/version');

    const clientVersion = (await response.json())?.data?.riotClientVersion;
    if (clientVersion) return clientVersion;
    throw new Error('Failed to get client version');
};

const getShard = (): string => {
    const localAppDataPath = process.env.LOCALAPPDATA;
    if (!localAppDataPath) throw new Error('LOCALAPPDATA is not defined');

    const filePath = path.join(localAppDataPath, 'VALORANT\\Saved\\Logs\\ShooterGame.log');
    const data = fs.readFileSync(filePath, 'utf8');

    const regex = /https:\/\/glz-(.+?)-1.(.+?).a.pvp.net/;
    const shard = regex.exec(data)?.[1];
    if (shard) return shard;
    throw new Error('Failed to get shard');
};

const getSSID = (): string => {
    const localAppDataPath = process.env.LOCALAPPDATA;
    if (!localAppDataPath) throw new Error('LOCALAPPDATA is not defined');

    const filePath = path.join(
        localAppDataPath,
        'Riot Games\\Riot Client\\Data\\RiotGamesPrivateSettings.yaml'
    );
    const data = fs.readFileSync(filePath, 'utf8');
    const parsedData = yaml.parse(data);

    const ssid = parsedData?.['riot-login']?.persist?.session?.cookies?.find(
        (cookie: { name: string }) => cookie.name === 'ssid'
    )?.value;
    if (ssid) return ssid;
    throw new Error('Failed to get ssid');
};

const getAccessToken = async (ssid: string): Promise<string> => {
    const response = await fetch(
        'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid',
        {
            method: 'GET',
            redirect: 'manual',
            headers: {
                Cookie: `ssid=${ssid}`,
                'User-Agent': ''
            }
        }
    );

    const location = response.headers.get('location');
    if (!location || !location.startsWith('https://playvalorant.com/opt_in'))
        throw new Error('Failed to get access token');

    const searchParams = new URLSearchParams(new URL(location).hash.slice(1));
    const accessToken = searchParams.get('access_token');

    if (accessToken) return accessToken;

    throw new Error('Failed to get access token');
};

const getPUUID = async (accessToken: string): Promise<string | undefined> => {
    const response = await fetch('https://auth.riotgames.com/userinfo', {
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + accessToken,
            'User-Agent': ''
        }
    });

    const puuid = (await response.json())?.sub;
    if (puuid) return puuid;
    throw new Error('Failed to get puuid');
};

const getEntitlementsToken = async (accessToken: string): Promise<string> => {
    const response = await fetch('https://entitlements.auth.riotgames.com/api/token/v1', {
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + accessToken,
            'Content-Type': 'application/json',
            'User-Agent': ''
        }
    });

    const entitlementsToken = (await response.json())?.entitlements_token;
    if (entitlementsToken) return entitlementsToken;
    throw new Error('Failed to get entitlements token');
};

const getConfig = async (): Promise<Config> => {
    const parsedConfig = fs.existsSync('config.yaml')
        ? yaml.parse(fs.readFileSync('config.yaml', 'utf8'))
        : undefined;

    const clientVersion = parsedConfig?.clientVersion ?? (await getClientVersion());
    const shard = parsedConfig?.shard ?? getShard();
    const ssid = parsedConfig?.ssid ?? getSSID();
    const accessToken = parsedConfig?.accessToken ?? (await getAccessToken(ssid));
    const puuid = parsedConfig?.puuid ?? (await getPUUID(accessToken));
    const entitlementsToken =
        parsedConfig?.entitlementsToken ?? (await getEntitlementsToken(accessToken));

    const config = {
        clientVersion,
        shard,
        puuid,
        ssid,
        accessToken,
        entitlementsToken
    };

    fs.writeFileSync('config.yaml', yaml.stringify(config));

    return config;
};

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
                'X-Riot-ClientPlatform':
                    'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9'
            }
        }
    );
    const data = await response.json();

    const battlepassData = data?.Contracts?.find(
        (contract: Contract) => contract.ContractDefinitionID === CONTRACT_BATTLEPASS_ID
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
                'X-Riot-ClientPlatform':
                    'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9'
            }
        }
    );
    const data = await response.json();
    const activeAct = data.Seasons.find((season: { IsActive: boolean }) => season.IsActive);
    return new Date(activeAct.EndTime);
};

const getTotalXpRequired = (withEpilogue = false): number => {
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
        const totalXpRequiredWithEpilogue = getTotalXpRequired(true);
        const progressPercentage = (battlepassProgress / totalXpRequired) * 100;
        const progressPercentageWithEpilogue =
            (battlepassProgress / totalXpRequiredWithEpilogue) * 100;

        console.log('VALORANT Battlepass Progress:');
        console.log('-'.repeat(30));
        console.log('Without epilogue:');
        console.log(
            `\tProgress: ${progressPercentage.toFixed(
                2
            )}% (tier ${battlepassLevel}/${BATTLEPASS_TIER_COUNT})`
        );
        console.log(`\tXP remaining: ${totalXpRequired - battlepassProgress}`);
        console.log('With epilogue:');
        console.log(
            `\tProgress: ${progressPercentageWithEpilogue.toFixed(2)}% (tier ${battlepassLevel}/${
                BATTLEPASS_TIER_COUNT + BATTLEPASS_EPILOGUE_TIER_COUNT
            })`
        );
        console.log(`\tXP remaining: ${totalXpRequiredWithEpilogue - battlepassProgress}`);

        const activeActEndDate = await getActiveActEndDate();
        const timeRemaining = new Date(activeActEndDate.getTime() - Date.now() - 86400000);
        console.log(
            `\nTime remaining: ${timeRemaining.getDate()} days ${timeRemaining.getHours()} hours ${timeRemaining.getMinutes()} minutes ${timeRemaining.getSeconds()} seconds`
        );
    } catch (error) {
        handleError((error as Error).message);
    }
};

main();
