/**
 * check_socials Tool - Basic HTTP-only handle checks.
 *
 * Returns three states:
 * - available
 * - taken
 * - unknown
 *
 * Unknown is used when a platform blocks verification, lacks a stable public
 * username URL, or returns an ambiguous response.
 */

import { z } from 'zod';
import axios from 'axios';
import type {
  SocialPlatform,
  SocialHandleResult,
  SocialCheckStatus,
} from '../types.js';
import { wrapError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { TtlCache } from '../utils/cache.js';

const CACHE_TTL_TAKEN = 86400;
const CACHE_TTL_AVAILABLE = 3600;
const CACHE_TTL_UNKNOWN = 300;

const socialCache = new TtlCache<SocialHandleResult>(CACHE_TTL_TAKEN, 5000);

type ErrorType = 'status_code' | 'message' | 'not_supported';

type PlatformConfig = {
  url: string;
  profileUrl: string;
  errorType: ErrorType;
  errorCode?: number;
  errorMsg?: string[];
  method: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  regexCheck?: RegExp;
  note?: string;
};

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
};

const API_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'Domain-Search-MCP/1.0',
};

const ALL_PLATFORMS = [
  'insta',
  'tiktok',
  'x',
  'fb',
  'reddit',
  'linkedin',
  'youtube',
  'twitch',
  'github',
  'medium',
  'telegram',
  'npm',
] as const satisfies readonly SocialPlatform[];

const PLATFORM_CONFIGS: Record<SocialPlatform, PlatformConfig> = {
  insta: {
    url: 'https://www.instagram.com/{}/',
    profileUrl: 'https://instagram.com/{}',
    errorType: 'status_code',
    errorCode: 404,
    method: 'HEAD',
    headers: BROWSER_HEADERS,
    regexCheck: /^[a-zA-Z0-9_.]{1,30}$/,
  },
  tiktok: {
    url: 'https://www.tiktok.com/@{}',
    profileUrl: 'https://tiktok.com/@{}',
    errorType: 'status_code',
    errorCode: 404,
    method: 'HEAD',
    headers: BROWSER_HEADERS,
    regexCheck: /^[a-zA-Z0-9_.]{2,24}$/,
  },
  x: {
    url: 'https://publish.twitter.com/oembed?url=https://x.com/{}',
    profileUrl: 'https://x.com/{}',
    errorType: 'status_code',
    errorCode: 404,
    method: 'GET',
    headers: API_HEADERS,
    regexCheck: /^[A-Za-z0-9_]{1,15}$/,
  },
  fb: {
    url: 'https://facebook.com/{}',
    profileUrl: 'https://facebook.com/{}',
    errorType: 'status_code',
    errorCode: 404,
    method: 'HEAD',
    headers: BROWSER_HEADERS,
  },
  reddit: {
    url: 'https://www.reddit.com/user/{}/about.json',
    profileUrl: 'https://reddit.com/user/{}',
    errorType: 'message',
    errorMsg: ['"error": 404'],
    method: 'GET',
    headers: {
      'User-Agent': 'Domain-Search-MCP/1.0 (checking username availability)',
    },
    regexCheck: /^[A-Za-z0-9_-]{3,20}$/,
  },
  linkedin: {
    url: 'https://linkedin.com/company/{}',
    profileUrl: 'https://linkedin.com/company/{}',
    errorType: 'status_code',
    errorCode: 404,
    method: 'HEAD',
    headers: BROWSER_HEADERS,
  },
  youtube: {
    url: 'https://www.youtube.com/@{}',
    profileUrl: 'https://youtube.com/@{}',
    errorType: 'status_code',
    errorCode: 404,
    method: 'HEAD',
    headers: BROWSER_HEADERS,
  },
  twitch: {
    url: 'https://twitch.tv/{}',
    profileUrl: 'https://twitch.tv/{}',
    errorType: 'status_code',
    errorCode: 404,
    method: 'HEAD',
    headers: BROWSER_HEADERS,
    regexCheck: /^[a-z0-9_]{4,25}$/i,
  },
  github: {
    url: 'https://api.github.com/users/{}',
    profileUrl: 'https://github.com/{}',
    errorType: 'status_code',
    errorCode: 404,
    method: 'GET',
    headers: API_HEADERS,
    regexCheck: /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i,
  },
  medium: {
    url: 'https://medium.com/@{}',
    profileUrl: 'https://medium.com/@{}',
    errorType: 'status_code',
    errorCode: 404,
    method: 'HEAD',
    headers: BROWSER_HEADERS,
  },
  telegram: {
    url: 'https://t.me/{}',
    profileUrl: 'https://t.me/{}',
    errorType: 'status_code',
    errorCode: 404,
    method: 'HEAD',
    headers: BROWSER_HEADERS,
    regexCheck: /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/,
  },
  npm: {
    url: 'https://registry.npmjs.org/{}',
    profileUrl: 'https://www.npmjs.com/~{}',
    errorType: 'status_code',
    errorCode: 404,
    method: 'GET',
    headers: API_HEADERS,
    regexCheck: /^[a-z0-9][a-z0-9._-]*$/i,
  },
};

export const checkSocialsSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(30)
    .describe("The username/handle to check (e.g., 'vibecoding')."),
  platforms: z
    .array(z.enum(ALL_PLATFORMS))
    .optional()
    .describe('Optional platform list. Defaults to the reduced social set.'),
});

export type CheckSocialsInput = z.infer<typeof checkSocialsSchema>;

export const checkSocialsTool = {
  name: 'check_socials',
  description: `Check whether a handle is available using basic HTTP checks only.

Returns three states:
- available
- taken
- unknown

Supported platforms:
- insta
- tiktok
- x
- fb
- reddit
- linkedin
- youtube
- twitch
- github
- medium
- telegram
- npm`,
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The username/handle to check.',
      },
      platforms: {
        type: 'array',
        items: {
          type: 'string',
          enum: ALL_PLATFORMS,
        },
        description: 'Optional explicit platform list.',
      },
    },
    required: ['name'],
  },
};

function createResult(
  platform: SocialPlatform,
  username: string,
  profileUrl: string,
  status: SocialCheckStatus,
  error?: string,
): SocialHandleResult {
  return {
    platform,
    handle: username,
    status,
    url: profileUrl,
    checked_at: new Date().toISOString(),
    error,
  };
}

async function checkPlatform(
  username: string,
  platform: SocialPlatform,
): Promise<SocialHandleResult> {
  const config = PLATFORM_CONFIGS[platform];
  const url = config.url.replaceAll('{}', encodeURIComponent(username));
  const profileUrl = config.profileUrl.replaceAll('{}', encodeURIComponent(username));
  const cacheKey = `${platform}:${username.toLowerCase()}`;

  const cached = socialCache.get(cacheKey);
  if (cached) {
    logger.debug(`Cache hit for ${platform}:${username}`);
    return cached;
  }

  if (config.errorType === 'not_supported') {
    const result = createResult(
      platform,
      username,
      profileUrl,
      'unknown',
      config.note || 'Basic HTTP verification is not supported for this platform.',
    );
    socialCache.set(cacheKey, result, CACHE_TTL_UNKNOWN);
    return result;
  }

  if (config.regexCheck && !config.regexCheck.test(username)) {
    const result = createResult(
      platform,
      username,
      profileUrl,
      'unknown',
      'Handle format is not valid for this platform.',
    );
    socialCache.set(cacheKey, result, CACHE_TTL_UNKNOWN);
    return result;
  }

  try {
    const response = await axios({
      method: config.method,
      url,
      timeout: 8000,
      validateStatus: () => true,
      headers: config.headers,
      maxRedirects: 0,
    });

    if ([401, 403, 429].includes(response.status) || response.status >= 500) {
      const result = createResult(
        platform,
        username,
        profileUrl,
        'unknown',
        `Verification blocked or ambiguous (HTTP ${response.status}).`,
      );
      socialCache.set(cacheKey, result, CACHE_TTL_UNKNOWN);
      return result;
    }

    let status: SocialCheckStatus = 'unknown';

    if (config.errorType === 'status_code') {
      if (response.status === (config.errorCode ?? 404)) {
        status = 'available';
      } else if (response.status >= 200 && response.status < 400) {
        status = 'taken';
      }
    } else if (config.errorType === 'message') {
      const dataString =
        typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data);
      status = (config.errorMsg || []).some((msg) => dataString.includes(msg))
        ? 'available'
        : response.status >= 200 && response.status < 400
        ? 'taken'
        : 'unknown';
    }

    const result = createResult(platform, username, profileUrl, status);
    const ttl =
      status === 'available'
        ? CACHE_TTL_AVAILABLE
        : status === 'taken'
        ? CACHE_TTL_TAKEN
        : CACHE_TTL_UNKNOWN;

    socialCache.set(cacheKey, result, ttl);
    return result;
  } catch (error) {
    logger.debug(`Failed to check ${platform}`, {
      username,
      error: error instanceof Error ? error.message : String(error),
    });

    const result = createResult(
      platform,
      username,
      profileUrl,
      'unknown',
      error instanceof Error ? error.message : 'Unknown error',
    );
    socialCache.set(cacheKey, result, CACHE_TTL_UNKNOWN);
    return result;
  }
}

interface CheckSocialsResponse {
  name: string;
  results: SocialHandleResult[];
  summary: {
    available: number;
    taken: number;
    unknown: number;
  };
  insights: string[];
}

export async function executeCheckSocials(
  input: CheckSocialsInput,
): Promise<CheckSocialsResponse> {
  try {
    const { name, platforms } = checkSocialsSchema.parse(input);
    const normalizedName = name.trim();

    const platformsToCheck: SocialPlatform[] = platforms || [
      'insta',
      'tiktok',
      'x',
      'fb',
      'reddit',
      'linkedin',
      'youtube',
      'twitch',
      'github',
      'medium',
      'telegram',
      'npm',
    ];

    const results = await Promise.all(
      platformsToCheck.map((platform) => checkPlatform(normalizedName, platform)),
    );

    const available = results.filter((result) => result.status === 'available');
    const taken = results.filter((result) => result.status === 'taken');
    const unknown = results.filter((result) => result.status === 'unknown');

    const insights: string[] = [];

    if (available.length > 0) {
      insights.push(
        `Available on: ${available.map((result) => result.platform).join(', ')}`,
      );
    }

    if (taken.length > 0) {
      insights.push(
        `Taken on: ${taken.map((result) => result.platform).join(', ')}`,
      );
    }

    if (unknown.length > 0) {
      insights.push(
        `Unknown on: ${unknown.map((result) => result.platform).join(', ')}`,
      );
    }

    return {
      name: normalizedName,
      results,
      summary: {
        available: available.length,
        taken: taken.length,
        unknown: unknown.length,
      },
      insights,
    };
  } catch (error) {
    throw wrapError(error);
  }
}
