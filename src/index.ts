import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

interface FileMakerMessage {
  message: string;
  code: string;
}

interface FileMakerTokenResponse {
  response: {
    token: string;
  };
  messages: FileMakerMessage[];
}

interface FileMakerDataResponse {
  response: {
    data: Array<Record<string, unknown>>;
  };
  messages: FileMakerMessage[];
}

type FileMakerResponse = FileMakerTokenResponse | FileMakerDataResponse;

/**
 * FileMaker検索クエリの型定義
 */
interface FindQueryRequest {
  [fieldName: string]: string | number | boolean | undefined;
}

interface FindQuery {
  query: FindQueryRequest[];
  sort?: Array<{
    fieldName: string;
    sortOrder: 'ascend' | 'descend';
  }>;
  limit?: number;
  offset?: number;
  portal?: string[];
}

/**
 * FileMaker検索レスポンスの型定義
 */
interface FindResponse {
  response: {
    data: Array<Record<string, unknown>>;
  };
  messages: FileMakerMessage[];
}

interface TokenResponse {
  success: boolean;
  data?: {
    token: string;
  };
  error?: {
    type: 'INVALID_RESPONSE' | 'FILEMAKER_ERROR' | 'API_ERROR';
    message: string;
    details: Record<string, unknown>;
  };
}

/**
 * 検索結果のレスポンス型定義
 */
interface FindRecordsResponse {
  success: boolean;
  data?: Array<Record<string, unknown>>;
  error?: {
    type: 'INVALID_RESPONSE' | 'FILEMAKER_ERROR' | 'API_ERROR';
    message: string;
    details: Record<string, unknown>;
  };
}

const DEFAULT_SERVER_URL =
  process.env.FILEMAKER_SERVER_URL || 'https://obfms.com';
const DEFAULT_DATABASE = process.env.FILEMAKER_DATABASE || '';
const DEFAULT_LAYOUT = process.env.FILEMAKER_LAYOUT || '';

/**
 * === Helper functions ===
 */

/**
 * Type guard for FileMakerResponse
 */
function isTokenResponse(data: any): data is FileMakerTokenResponse {
  return (
    data &&
    typeof data === 'object' &&
    'response' in data &&
    typeof data.response === 'object' &&
    data.response !== null &&
    'token' in data.response &&
    typeof data.response.token === 'string'
  );
}

/**
 * Make FileMaker request
 */
async function makeFileMakerRequest(
  url: string,
  options: RequestInit & {
    fieldName?: string;
    searchText?: string;
  }
): Promise<FileMakerResponse | null> {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // 検索リクエストの場合はクエリを構築
  if (options.fieldName && options.searchText && url.includes('/_find')) {
    const query: FindQuery = {
      query: [
        {
          [options.fieldName]: `=${options.searchText}`,
        },
      ],
    };
    options.body = JSON.stringify(query);
  }

  try {
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data as FileMakerResponse;
  } catch (error) {
    console.error('FileMakerリクエストエラー:', error);
    return null;
  }
}

/**
 * Get FileMaker token
 */
async function getFileMakerToken(fileName: string): Promise<TokenResponse> {
  const url = `${DEFAULT_SERVER_URL}/fmi/data/v1/databases/${fileName}/sessions`;

  try {
    const response = await makeFileMakerRequest(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${process.env.FILEMAKER_ACCOUNT}:${process.env.FILEMAKER_PASSWORD}`
        ).toString('base64')}`,
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
  } catch (error) {
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
async function findRecords(
  fieldName: string,
  searchText: string,
  token: string,
  fileName: string,
  layoutName: string
): Promise<FindRecordsResponse> {
  try {
    const response = (await makeFileMakerRequest(
      `${DEFAULT_SERVER_URL}/fmi/data/v1/databases/${fileName}/layouts/${layoutName}/_find`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        fieldName,
        searchText,
      }
    )) as FindResponse;

    if (!response) {
      return {
        success: false,
        error: {
          type: 'INVALID_RESPONSE',
          message: 'FileMakerサーバーからの応答が無効です',
          details: { fileName, layoutName },
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
  } catch (error) {
    console.error('FileMaker検索エラー:', error);
    return {
      success: false,
      error: {
        type: 'API_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: {
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
const server = new McpServer(
  {
    name: 'filemaker-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {
        'get-token': {
          description: 'Get FileMaker Data API token',
          parameters: {
            fileName: z
              .string()
              .optional()
              .describe(
                'FileMaker database name (uses env FILEMAKER_DATABASE if not provided)'
              ),
          },
        },
      },
    },
  }
);

/**
 * === Tools ===
 */

/**
 * get-token
 */
server.tool(
  'get-token',
  'Get FileMaker Data API token',
  {
    fileName: z
      .string()
      .optional()
      .describe(
        'FileMaker database name (uses env FILEMAKER_DATABASE if not provided)'
      ),
  },
  async (params: { fileName?: string }) => {
    const tokenResponse = await getFileMakerToken(
      params.fileName || DEFAULT_DATABASE
    );
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
      content: [{ type: 'text', text: tokenResponse.data?.token || '' }],
    };
  }
);

/**
 * find-records
 */
server.tool(
  'find-records',
  'Find records in FileMaker database',
  {
    fileName: z
      .string()
      .optional()
      .describe(
        'FileMaker database name (uses env FILEMAKER_DATABASE if not provided)'
      ),
    layoutName: z
      .string()
      .optional()
      .describe('Layout name (uses env FILEMAKER_LAYOUT if not provided)'),
    fieldName: z.string().describe('Field name to search (required)'),
    searchText: z.string().describe('Search text (required)'),
  },
  async (params: {
    fileName?: string;
    layoutName?: string;
    fieldName: string;
    searchText: string;
  }) => {
    // トークンを取得して検索を実行
    const tokenResponse = await getFileMakerToken(
      params.fileName || DEFAULT_DATABASE
    );
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

    const findResponse = await findRecords(
      params.fieldName,
      params.searchText,
      tokenResponse.data.token,
      params.fileName || DEFAULT_DATABASE,
      params.layoutName || DEFAULT_LAYOUT
    );

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

    return {
      content: [
        { type: 'text', text: JSON.stringify(findResponse.data, null, 2) },
      ],
    };
  }
);

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
