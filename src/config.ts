import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

type Config = {
    clientVersion: string;
    shard: string;
    ssid: string;
    accessToken: string;
    puuid: string;
    entitlementsToken: string;
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

export const getConfig = async (): Promise<Config> => {
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

    const config: Config = {
        clientVersion,
        shard,
        ssid,
        accessToken,
        puuid,
        entitlementsToken
    };

    fs.writeFileSync('config.yaml', yaml.stringify(config));

    return config;
};
