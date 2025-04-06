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

interface FieldMetaData {
  name: string;
  type: string;
  displayType: string;
  result: string;
  valueList?: string;
  global: boolean;
}

interface LayoutMetaDataResponse {
  response: {
    fieldMetaData: FieldMetaData[];
    portalMetaData: Record<string, unknown>;
    valueLists: Array<{
      name: string;
      type: string;
      values: Array<{
        displayValue: string;
        value: string;
      }>;
    }>;
  };
  messages: FileMakerMessage[];
}

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

const DEFAULT_SERVER_URL = process.env.FILEMAKER_SERVER_URL;
const DEFAULT_DATABASE = process.env.FILEMAKER_DATABASE || 'default_database';
const DEFAULT_LAYOUT = process.env.FILEMAKER_LAYOUT || 'default_layout';

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
 * Abandon FileMaker token
 */
async function abandonFileMakerToken(
  fileName: string,
  token: string
): Promise<void> {
  const url = `${DEFAULT_SERVER_URL}/fmi/data/v1/databases/${fileName}/sessions/${token}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTPエラー! ステータス: ${response.status}`);
    }

    const data = await response.json();
    if (data.messages[0].code !== '0') {
      throw new Error(`FileMakerエラー: ${data.messages[0].message}`);
    }
  } catch (error) {
    console.error('トークン破棄エラー:', error);
    throw error;
  }
}

/**
 * Get layout metadata
 */
async function getLayoutMetaData(
  fileName: string,
  layoutName: string,
  token: string
): Promise<{
  success: boolean;
  data?: LayoutMetaDataResponse;
  error?: {
    type: 'INVALID_RESPONSE' | 'FILEMAKER_ERROR' | 'API_ERROR';
    message: string;
    details: Record<string, unknown>;
  };
}> {
  const url = `${DEFAULT_SERVER_URL}/fmi/data/v1/databases/${fileName}/layouts/${layoutName}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTPエラー! ステータス: ${response.status}`);
    }

    const data = await response.json();
    if (data.messages[0].code !== '0') {
      return {
        success: false,
        error: {
          type: 'FILEMAKER_ERROR',
          message: data.messages[0].message,
          details: {
            code: data.messages[0].code,
            fileName,
            layoutName,
          },
        },
      };
    }

    return {
      success: true,
      data: data as LayoutMetaDataResponse,
    };
  } catch (error) {
    console.error('レイアウトメタデータ取得エラー:', error);
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
          description:
            'Get FileMaker Data API token: FileMaker APIで使用するトークンを取得するツール。\n' +
            '他のツールを実行する前に、まず最初に実行してトークンを取得してください。\n' +
            '取得したトークンは、他のツールで利用します。abandon-tokenの場合も、このtokenを与えてください。',
          parameters: {},
        },
        'abandon-token': {
          description:
            'Abandon FileMaker Data API token:ログイントークンを破棄するツール',
          parameters: {
            token: z
              .string()
              .describe(
                'FileMaker Data API token (uses get-token tool if not provided)'
              ),
          },
        },
        'get-layout-metadata': {
          description:
            'Find records in FileMaker database: データベースからレコードを検索するツール。\n' +
            '以下の手順で検索を行ってください：\n' +
            '1. get-tokenを実行してトークンを取得\n' +
            '2. 取得したトークンを使用してget-layout-metadataを実行し、フィールド情報を取得\n' +
            '3. 取得したフィールド情報と会話の文脈から、最適なフィールドを選択\n' +
            '例：\n' +
            '- ユーザーが「名前が田中さんのレコードを探して」と言った場合 → nameフィールドを選択\n' +
            '- ユーザーが「電話番号が0312345678の人を探して」と言った場合 → phoneフィールドを選択\n' +
            '- ユーザーが日時関係の検索条件を指定してきたら → dateフィールドを選択\n' +
            '4. 選択したフィールド名をfieldNameパラメータに指定\n',
          parameters: {},
        },
        'find-records': {
          description:
            'Find records in FileMaker database: データベースからレコードを検索するツール。' +
            'fieldNameパラメータには、get-layout-metadataで取得したフィールド情報から、' +
            'searchTextの内容に最も適したフィールド名を選択して指定してください。' +
            '検索文字列をsearchTextパラメータに指定\n' +
            'searchTextが日付の場合、mm-dd-yyyyの形式に変換して指定してください。例えば"2025年4月1日"は"04-01-2025"と指定してください。' +
            '検索条件の書き方(searchTextパラメータの書き方)\n' +
            '- 複数フィールドの検索条件の場合、{フィールド名1: 検索文字列1, フィールド名2: 検索文字列2, フィールド名3: 検索文字列3}のように指定してください。\n' +
            '- 数値や日付の範囲指定の書き方は、"04-01-2025...04-30-2025",2...9のように検索文字列を組み立てて下さい\n' +
            '- 数値や日付の大なり小なりの書き方は、"> 04-01-2025"または"<= 04-01-2025"のように検索文字列を組み立てて下さい\n' +
            '検索実行後、abandon-tokenを実行してトークンを破棄',
          parameters: {
            fieldName: z.string().describe('Field name to search (required)'),
            searchText: z.string().describe('Search text (required)'),
            token: z.string().describe('FileMaker Data API token (required)'),
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
server.tool('get-token', 'Get FileMaker Data API token', {}, async () => {
  const tokenResponse = await getFileMakerToken(DEFAULT_DATABASE);
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
});

/**
 * abandon-token
 */
server.tool(
  'abandon-token',
  'Abandon FileMaker Data API token',
  {
    token: z
      .string()
      .describe(
        'FileMaker Data API token (uses get-token tool if not provided)'
      ),
  },
  async (args: { token: string }) => {
    await abandonFileMakerToken(DEFAULT_DATABASE, args.token);
    return {
      content: [{ type: 'text', text: 'Token abandoned successfully' }],
    };
  }
);

/**
 * get-layout-metadata
 */
server.tool(
  'get-layout-metadata',
  'Get FileMaker layout metadata',
  {
    token: z.string().describe('FileMaker Data API token (required)'),
  },
  async (params: { token: string }) => {
    const metaDataResponse = await getLayoutMetaData(
      DEFAULT_DATABASE,
      DEFAULT_LAYOUT,
      params.token
    );

    if (!metaDataResponse.success || !metaDataResponse.data) {
      return {
        content: [
          {
            type: 'text',
            text: metaDataResponse.error?.message || 'Failed to get metadata',
          },
        ],
      };
    }

    // フィールド情報を整形して返す
    const fieldInfo = metaDataResponse.data.response.fieldMetaData.map(
      (field) => ({
        name: field.name,
        type: field.type,
        displayType: field.displayType,
        result: field.result,
        valueList: field.valueList,
        global: field.global,
      })
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(fieldInfo, null, 2) }],
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
    fieldName: z.string().describe('Field name to search (required)'),
    searchText: z.string().describe('Search text (required)'),
    token: z.string().describe('FileMaker Data API token (required)'),
  },
  async (params: { fieldName: string; searchText: string; token: string }) => {
    const findResponse = await findRecords(
      params.fieldName || '',
      params.searchText,
      params.token,
      DEFAULT_DATABASE,
      DEFAULT_LAYOUT
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
