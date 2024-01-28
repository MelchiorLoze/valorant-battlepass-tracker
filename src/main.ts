import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

const CONTRACT_BATTLEPASS_ID = 'd3946b6b-49b3-746b-169e-9488f7a3ba35';

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

const getBattlePassProgress = async (): Promise<number | undefined> => {
    const config = fs.existsSync('config.yaml')
        ? yaml.parse(fs.readFileSync('config.yaml', 'utf8'))
        : undefined;

    const clientVersion = config?.clientVersion ?? (await getClientVersion());
    const shard = config?.shard ?? getShard();
    const ssid = config?.ssid ?? getSSID();
    const accessToken = config?.accessToken ?? (await getAccessToken(ssid));
    const puuid = config?.puuid ?? (await getPUUID(accessToken));
    const entitlementsToken =
        config?.entitlementsToken ?? (await getEntitlementsToken(accessToken));

    const newConfig = yaml.stringify({
        clientVersion,
        shard,
        puuid,
        ssid,
        accessToken,
        entitlementsToken
    });
    fs.writeFileSync('config.yaml', newConfig);

    const response = await fetch(`https://pd.${shard}.a.pvp.net/contracts/v1/contracts/${puuid}`, {
        method: 'GET',
        headers: {
            Accept: '*/*',
            Authorization: 'Bearer ' + accessToken,
            'User-Agent': '',
            'X-Riot-ClientVersion': clientVersion,
            'X-Riot-Entitlements-JWT': entitlementsToken
        }
    });
    const data = await response.json();

    const progress = data?.Contracts?.find(
        (contract: { ContractDefinitionID: string }) =>
            contract.ContractDefinitionID === CONTRACT_BATTLEPASS_ID
    )?.ContractProgression?.TotalProgressionEarned;
    if (progress) return progress;
    if (config) return undefined;
    throw new Error('Failed to get progress');
};

const getTotalXpRequired = (withEpilogue = false): number => {
    const numberOfTiers = 50;
    let result = 0;
    for (let i = 1; i <= numberOfTiers; i++) {
        if (i !== 1) result += i * 750 + 500;
    }

    if (withEpilogue) {
        const numberOfEpilogueTiers = 5;
        const xpRequriedPerEpilogueTier = 36500;
        result += numberOfEpilogueTiers * xpRequriedPerEpilogueTier;
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
        let battlePassProgress = await getBattlePassProgress();
        if (!battlePassProgress) {
            fs.appendFileSync('error.log', 'Retrying...\n');
            fs.writeFileSync('config.yaml', '');
            battlePassProgress = await getBattlePassProgress();
        }
        if (!battlePassProgress) throw new Error('Failed to get progress');

        const totalXpRequired = getTotalXpRequired();
        const totalXpRequiredWithEpilogue = getTotalXpRequired(true);
        const progressPercentage = (battlePassProgress / totalXpRequired) * 100;
        const progressPercentageWithEpilogue =
            (battlePassProgress / totalXpRequiredWithEpilogue) * 100;

        console.log(
            `VALORANT BattlePass Progress: ${progressPercentage.toFixed(
                2
            )}% (${progressPercentageWithEpilogue.toFixed(2)}% counting epilogue)`
        );
    } catch (error) {
        handleError((error as Error).message);
    }
};

main();
