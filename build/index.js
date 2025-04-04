import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const DEFAULT_SERVER_URL = process.env.FILEMAKER_SERVER_URL || 'https://obfms.com';
const DEFAULT_DATABASE = process.env.FILEMAKER_DATABASE || '';
const DEFAULT_LAYOUT = process.env.FILEMAKER_LAYOUT || '';
/**
 * === Helper functions ===
 */
/**
 * Type guard for FileMakerResponse
 */
function isTokenResponse(data) {
    return (data &&
        typeof data === 'object' &&
        'response' in data &&
        typeof data.response === 'object' &&
        data.response !== null &&
        'token' in data.response &&
        typeof data.response.token === 'string');
}
/**
 * Make FileMaker request
 */
async function makeFileMakerRequest(url, options) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };
    try {
        const response = await fetch(url, { ...options, headers });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data;
    }
    catch (error) {
        console.error('FileMakerリクエストエラー:', error);
        return null;
    }
}
/**
 * Get FileMaker token
 */
async function getFileMakerToken(fileName, account = process.env.FILEMAKER_ACCOUNT || '', password = process.env.FILEMAKER_PASSWORD || '', serverUrl = DEFAULT_SERVER_URL) {
    const url = `${serverUrl}/fmi/data/v1/databases/${fileName}/sessions`;
    try {
        const response = await makeFileMakerRequest(url, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${account}:${password}`).toString('base64')}`,
            },
        });
        if (!response || !isTokenResponse(response)) {
            return {
                success: false,
                error: {
                    type: 'INVALID_RESPONSE',
                    message: 'FileMakerサーバーからの応答が無効です',
                    details: { url },
                },
            };
        }
        if (response.messages[0].code !== '0') {
            return {
                success: false,
                error: {
                    type: 'FILEMAKER_ERROR',
                    message: response.messages[0].message,
                    details: {
                        code: response.messages[0].code,
                        url,
                    },
                },
            };
        }
        return {
            success: true,
            data: {
                token: response.response.token,
            },
        };
    }
    catch (error) {
        console.error('FileMakerトークン取得エラー:', error);
        return {
            success: false,
            error: {
                type: 'API_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: {
                    url,
                    originalError: String(error),
                },
            },
        };
    }
}
/**
 * Find records in FileMaker
 */
async function findRecords(fileName, fieldName, searchText, token, serverUrl = DEFAULT_SERVER_URL, layoutName = DEFAULT_LAYOUT) {
    try {
        const query = {
            query: [
                {
                    [fieldName]: `=${searchText}`,
                },
            ],
        };
        const response = (await makeFileMakerRequest(`${serverUrl}/fmi/data/v1/databases/${fileName}/layouts/${layoutName}/_find`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(query),
        }));
        if (!response) {
            return {
                success: false,
                error: {
                    type: 'INVALID_RESPONSE',
                    message: 'FileMakerサーバーからの応答が無効です',
                    details: { serverUrl, fileName, layoutName },
                },
            };
        }
        if (response.messages[0].code !== '0') {
            return {
                success: false,
                error: {
                    type: 'FILEMAKER_ERROR',
                    message: response.messages[0].message,
                    details: {
                        code: response.messages[0].code,
                        serverUrl,
                        fileName,
                        layoutName,
                    },
                },
            };
        }
        return {
            success: true,
            data: response.response.data,
        };
    }
    catch (error) {
        console.error('FileMaker検索エラー:', error);
        return {
            success: false,
            error: {
                type: 'API_ERROR',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: {
                    serverUrl,
                    fileName,
                    layoutName,
                    originalError: String(error),
                },
            },
        };
    }
}
/**
 * === Create MCP server instance ===
 */
const server = new McpServer({
    name: 'filemaker-mcp-server',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {
            'get-token': {
                description: 'Get FileMaker Data API token',
                parameters: {
                    fileName: z
                        .string()
                        .optional()
                        .describe('FileMaker database name (uses env FILEMAKER_DATABASE if not provided)'),
                    account: z
                        .string()
                        .optional()
                        .describe('Account name (uses env if not provided)'),
                    password: z
                        .string()
                        .optional()
                        .describe('Password (uses env if not provided)'),
                    serverUrl: z
                        .string()
                        .optional()
                        .describe('FileMaker server URL (uses env if not provided)'),
                },
            },
        },
    },
});
/**
 * === Tools ===
 */
/**
 * get-token
 */
server.tool('get-token', 'Get FileMaker Data API token', {
    fileName: z
        .string()
        .optional()
        .describe('FileMaker database name (uses env FILEMAKER_DATABASE if not provided)'),
    account: z
        .string()
        .optional()
        .describe('Account name (uses env if not provided)'),
    password: z
        .string()
        .optional()
        .describe('Password (uses env if not provided)'),
    serverUrl: z
        .string()
        .optional()
        .describe('FileMaker server URL (uses env if not provided)'),
}, async (params) => {
    const tokenResponse = await getFileMakerToken(params.fileName || DEFAULT_DATABASE, params.account, params.password, params.serverUrl);
    if (!tokenResponse.success) {
        return {
            content: [
                {
                    type: 'text',
                    text: tokenResponse.error?.message || 'Failed to get token',
                },
            ],
        };
    }
    return {
        content: [
            {
                type: 'text',
                text: tokenResponse.data?.token || '',
            },
        ],
    };
});
/**
 * find-records
 */
server.tool('find-records', 'Find records in FileMaker database', {
    fileName: z
        .string()
        .optional()
        .describe('FileMaker database name (uses env FILEMAKER_DATABASE if not provided)'),
    layoutName: z
        .string()
        .optional()
        .describe('Layout name (uses env FILEMAKER_LAYOUT if not provided)'),
    fieldName: z.string().describe('Field name to search (required)'),
    searchText: z.string().describe('Search text (required)'),
}, async (params) => {
    // まずトークンを取得
    const tokenResponse = await getFileMakerToken(params.fileName || DEFAULT_DATABASE);
    if (!tokenResponse.success || !tokenResponse.data?.token) {
        return {
            content: [
                {
                    type: 'text',
                    text: tokenResponse.error?.message || 'Failed to get token',
                },
            ],
        };
    }
    // 検索を実行
    const findResponse = await findRecords(params.fileName || DEFAULT_DATABASE, params.fieldName, params.searchText, tokenResponse.data.token, undefined, params.layoutName || DEFAULT_LAYOUT);
    if (!findResponse.success) {
        return {
            content: [
                {
                    type: 'text',
                    text: findResponse.error?.message || 'Failed to find records',
                },
            ],
        };
    }
    // 検索結果を返す
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(findResponse.data, null, 2),
            },
        ],
    };
});
/**
 * === Start server ===
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('FileMaker MCP Server running on stdio');
}
main().catch((error) => {
    console.error('Fatal error in main():', error);
    process.exit(1);
});
