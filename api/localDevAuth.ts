import { getAxiosConfig } from '../http/getAxiosConfig';
import http from '../http';
import { ENVIRONMENTS } from '../constants/environments';
import { Environment } from '../types/Config';
import { ScopeData } from '../types/Accounts';
import axios from 'axios';

const LOCALDEVAUTH_API_AUTH_PATH = 'localdevauth/v1/auth';

type AccessTokenResponse = {
  hubId: number;
  oauthAccessToken: string;
  expiresAtMillis: number;
  scopeGroups: Array<string>;
  encodedOauthRefreshToken: string;
};

export async function fetchAccessToken(
  personalAccessKey: string,
  env: Environment = ENVIRONMENTS.PROD,
  portalId?: number
): Promise<AccessTokenResponse> {
  const query = portalId ? { portalId } : {};
  const axiosConfig = getAxiosConfig({
    env,
    localHostOverride: true,

    url: `${LOCALDEVAUTH_API_AUTH_PATH}/refresh`,
    body: {
      encodedOAuthRefreshToken: personalAccessKey,
    },
    params: query,
  });

  const { data } = await axios<AccessTokenResponse>({
    ...axiosConfig,
    method: 'post',
  });

  return data;
}

export async function fetchScopeData(
  accountId: number,
  scopeGroup: string
): Promise<ScopeData> {
  return http.get<ScopeData>(accountId, {
    url: `localdevauth/v1/auth/check-scopes`,
    query: {
      scopeGroup,
    },
  });
}